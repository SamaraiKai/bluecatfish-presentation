import os
import subprocess
import tempfile
import uuid
from pathlib import Path
import json
import threading
import time
from openai import OpenAI
from supabase import create_client
import shutil

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

RENDER_TOKEN = os.environ.get("RENDER_TOKEN")

openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

class RenderRequest(BaseModel):
    code: str
    scene_name: str = "GeneratedScene"
    token: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/render")
def render(req: RenderRequest):
    if RENDER_TOKEN and req.token != RENDER_TOKEN:
        raise HTTPException(status_code=401, detail="bad token")

    job_id = str(uuid.uuid4())[:8]
    workdir = Path(tempfile.mkdtemp())
    script = workdir / "scene.py"
    script.write_text(req.code)

    try:
        result = subprocess.run(
            [
                "manim",
                "-ql",                      # low quality = fast; use -qm later if you want better
                "--media_dir", str(workdir),
                str(script),
                req.scene_name,
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="render timed out")

    if result.returncode != 0:
        raise HTTPException(
            status_code=422,
            detail=(result.stdout[-1500:] + "\n---STDERR---\n" + result.stderr[-2500:]),
        )

    videos = list(workdir.rglob("*.mp4"))
    if not videos:
        raise HTTPException(status_code=500, detail="no output produced")

    return FileResponse(videos[0], media_type="video/mp4", filename=f"{job_id}.mp4")

MANIM_SYSTEM_PROMPT = """You write Manim Community Edition code for short educational animations.

SETUP
- Class must be named exactly "GeneratedScene", extending Scene.
- Begin with:
  from manim import *
  from catfish_shapes import fish, proportion_circles, labeled_bars, timeline, big_number, flow_chain, eats, growth_curve
- End with self.wait(1).


CHOOSE THE RIGHT HELPER — this is the most important decision you make.
- Two percentages or quantities that form a whole → proportion_circles(big_pct, small_pct, big_label, small_label)
- Several quantities to compare → labeled_bars([(label, value), ...])
- One figure with nothing to compare it to → big_number(value, label)
- A value along a range or over time → timeline(start_label, end_label), then animate the dot moving
- Growth or increase over time → growth_curve(start_label, end_label), then Create the line
- A cause-and-effect sequence → flow_chain([step1, step2, step3])
- A predator and what it consumes → eats(predator_label, [prey1, prey2])
- Anything else → big_number, or do not animate at all

If no helper fits the step, use big_number. Never construct your own diagram from raw shapes.


ANIMATE A CHANGE
The viewer must see something happen: a dot travels, a bar grows, a line is drawn, elements appear in sequence. Do not simply fade in a finished picture.


ACCURACY
- Every number must appear verbatim in the source content. Never round, approximate, or invent a figure.
- Never remove or alter labels that a helper generates.


CONSTRAINTS
- No MathTex, Tex, Axes, NumberLine, SVGMobject, or ImageMobject.
- One idea only. If the description mentions several, animate the first.
- Keep everything within x −6 to 6, y −3.5 to 3.5.
- Finish slightly under the target duration rather than over.

Output ONLY the Python code. No markdown fences, no explanation."""


def render_to_bytes(code: str):
    workdir = Path(tempfile.mkdtemp())
    script = workdir / "scene.py"
    script.write_text(code)
    shutil.copy("/app/catfish_shapes.py", workdir / "catfish_shapes.py")

    result = subprocess.run(
        ["manim", "-ql", "--media_dir", str(workdir), str(script), "GeneratedScene"],
        capture_output=True, text=True, timeout=180,
    )
    if result.returncode != 0:
        return None, (result.stdout[-1000:] + "\n" + result.stderr[-2000:])

    videos = list(workdir.rglob("*.mp4"))
    if not videos:
        return None, "no output produced"
    return videos[0].read_bytes(), None

def estimate_duration(step: dict) -> int:
    text = " ".join(str(v) for v in step.values() if isinstance(v, str))
    words = len(text.split())
    return max(4, min(18, int(words / 3)))
    
def write_manim_code(description: str, source_step: str = "", duration: int = 10, prev_error=None, prev_code=None) -> str:
    user_msg = f"Animate this: {description}"
    if source_step:
        user_msg += f"\n\nThe animation must be factually consistent with this source content. Use its exact numbers and wording — never round, rephrase, or invent figures:\n{source_step}"
    messages = [
        {"role": "system", "content": MANIM_SYSTEM_PROMPT + f"\n- The animation must last approximately {duration} seconds. Use run_time and self.wait() to reach that length."},
        {"role": "user", "content": user_msg},
    ]
    if prev_error and prev_code:
        messages.append({"role": "assistant", "content": prev_code})
        messages.append({
            "role": "user",
            "content": f"That code failed with this error:\n\n{prev_error}\n\nFix it and output the corrected code only.",
        })

    resp = openai_client.chat.completions.create(
        model="gpt-6-sol", messages=messages, temperature=0.3, max_tokens=1200,
    )
    code = resp.choices[0].message.content.strip()
    if code.startswith("```"):
        code = code.split("\n", 1)[1].rsplit("```", 1)[0]
    return code


def plan_animations(section: dict):
    lines = []
    for idx, s in enumerate(section.get("steps", [])):
        t = s.get("type")
        if t == "imageFocus":
            lines.append(f"{idx}: imageFocus (has an image already, skip)")
        elif t == "numberSpotlight":
            lines.append(f"{idx}: numberSpotlight — {s.get('value')} {s.get('label')}")
        elif t == "processFlow":
            lines.append(f"{idx}: processFlow — {s.get('intro')}")
        else:
            lines.append(f"{idx}: {t} — {s.get('text') or s.get('question') or s.get('statement') or ''}")

    resp = openai_client.chat.completions.create(
        model="gpt-6-luna",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": """You decide which teaching steps would benefit from a simple animated diagram.

Choose a step if it involves ANY of: a number, quantity, proportion or percentage; a comparison between two or more things; a sequence of causes or stages; growth, decline, or change over time; movement or spread across space; a relationship between parts.
Steps of type "numberSpotlight" and "processFlow" should almost always be chosen — they are inherently visual.

Skip a step only if it is purely a definition, a question with no quantity, or a statement with no visual structure at all.
Never choose a step marked "imageFocus".

Choose 1-2 steps per section.

For each chosen step write a "description": a SIMPLE animation using only basic shapes, text, arrows and lines, describable in under 15 seconds. Diagram, not picture. Be specific about what appears and what moves.

The description must specify exactly what shapes appear, what text labels them, and what single change occurs. If you cannot describe it that concretely in one sentence, do not choose that step.

Favor steps where a quantity can be shown changing, or where one thing visibly affects another. A description should be able to complete this sentence: "the viewer watches ___ happen." If it cannot, skip that step.

Output JSON: { "animations": [ { "stepIndex": 0, "description": "..." } ] }"""},
            {"role": "user", "content": f"Section: \"{section.get('title')}\"\n\nSteps:\n" + "\n".join(lines)},
        ],
        temperature=0.6,
        max_tokens=500,
    )
    try:
        return json.loads(resp.choices[0].message.content).get("animations", [])
    except Exception:
        return []


class AnimateRequest(BaseModel):
    token: str
    cache_key: str
    sections: list


def run_animation_pass(cache_key: str, sections: list):
    try:
        results = {}
        for i, section in enumerate(sections):
            for a in plan_animations(section):
                step_index = a.get("stepIndex")
                description = a.get("description")
                if step_index is None or not description:
                    continue

                step = section.get("steps", [])[step_index]       
                source = json.dumps(step) 
                duration = estimate_duration(step)
    
                code = write_manim_code(description, source_step=source, duration=duration)
                video, err = None, None
                for attempt in range(3):
                    video, err = render_to_bytes(code)
                    if video:
                        break
                    code = write_manim_code(
                        description, source_step=source, duration=duration,
                        prev_error=err, prev_code=code,
                    )
                if not video:
                    print(f"FAILED section {i} step {step_index}: {err[:300] if err else ''}")
                    continue

                path = f"{cache_key}/section{i}_step{step_index}.mp4"
                try:
                    supabase.storage.from_("slide-animations").upload(
                        path, video, {"content-type": "video/mp4", "upsert": "true"}
                    )
                    url = supabase.storage.from_("slide-animations").get_public_url(path)
                    results[f"{i}_{step_index}"] = url
                    print(f"OK section {i} step {step_index}")
                    
                    try:
                     supabase.table("animation_jobs").upsert({
                            "cache_key": cache_key,
                            "animations": results,
                            "status": "done",
                        }).execute()
                    except Exception as e:
                        print(f"Interim write failed: {e}")
                except Exception as e:
                        print(f"UPLOAD FAILED section {i} step {step_index}: {e}")
                    
        for attempt in range(3):
            try:
                supabase.table("animation_jobs").upsert({
                    "cache_key": cache_key,
                    "animations": results,
                    "status": "done",
                }).execute()
                print(f"Animation pass complete for {cache_key}: {len(results)} animations")
                break
            except Exception as e:
                print(f"Status write failed (attempt {attempt + 1}): {e}")
                time.sleep(3)

    except Exception as e:
        import traceback
        print(f"ANIMATION PASS CRASHED for {cache_key}: {e}")
        traceback.print_exc()
        try:
            supabase.table("animation_jobs").upsert({
                "cache_key": cache_key,
                "animations": results if 'results' in dir() else {},
                "status": "failed",
            }).execute()
        except Exception:
            pass
            
@app.post("/animate")
def animate(req: AnimateRequest):
    if RENDER_TOKEN and req.token != RENDER_TOKEN:
        raise HTTPException(status_code=401, detail="bad token")

    supabase.table("animation_jobs").upsert({
        "cache_key": req.cache_key,
        "animations": {},
        "status": "running",
    }).execute()

    threading.Thread(
        target=run_animation_pass,
        args=(req.cache_key, req.sections),
        daemon=True,
    ).start()

    return {"started": True, "cache_key": req.cache_key}
