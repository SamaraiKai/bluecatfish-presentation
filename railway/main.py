import os
import subprocess
import tempfile
import uuid
from pathlib import Path
import json
import threading
from openai import OpenAI
from supabase import create_client

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

STRICT CONSTRAINTS — code that violates these will fail:
- The scene class MUST be named exactly "GeneratedScene" and extend Scene.
- Start the file with: from manim import *
- Use ONLY these objects: Text, Circle, Square, Rectangle, Dot, Line, Arrow, VGroup
- Use ONLY these animations: Write, FadeIn, FadeOut, Create, Transform, ReplacementTransform, GrowArrow, Indicate
- NEVER use MathTex, Tex, Axes, NumberLine, or anything requiring LaTeX.
- For charts or comparisons, build bars from Rectangle objects positioned manually.
- NEVER use SVGMobject, ImageMobject, or any external asset.
- Keep the total animation under 15 seconds.
- Keep all objects inside the frame: x roughly -6 to 6, y roughly -3.5 to 3.5.
- End with self.wait(1).

Output ONLY the Python code. No markdown fences, no explanation."""


def render_to_bytes(code: str):
    workdir = Path(tempfile.mkdtemp())
    script = workdir / "scene.py"
    script.write_text(code)

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


def write_manim_code(description: str, prev_error=None, prev_code=None) -> str:
    messages = [
        {"role": "system", "content": MANIM_SYSTEM_PROMPT},
        {"role": "user", "content": f"Animate this: {description}"},
    ]
    if prev_error and prev_code:
        messages.append({"role": "assistant", "content": prev_code})
        messages.append({
            "role": "user",
            "content": f"That code failed with this error:\n\n{prev_error}\n\nFix it and output the corrected code only.",
        })

    resp = openai_client.chat.completions.create(
        model="gpt-4o", messages=messages, temperature=0.3, max_tokens=1200,
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
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": """You decide which teaching steps would benefit from a simple animated diagram.

Choose a step if it involves ANY of: a number, quantity, proportion or percentage; a comparison between two or more things; a sequence of causes or stages; growth, decline, or change over time; movement or spread across space; a relationship between parts.
Steps of type "numberSpotlight" and "processFlow" should almost always be chosen — they are inherently visual.

Skip a step only if it is purely a definition, a question with no quantity, or a statement with no visual structure at all.
Never choose a step marked "imageFocus".

Choose 1-2 steps per section.

For each chosen step write a "description": a SIMPLE animation using only basic shapes, text, arrows and lines, describable in under 15 seconds. Diagram, not picture. Be specific about what appears and what moves.

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
    
                code = write_manim_code(description)
                video, err = None, None
                for attempt in range(3):
                    video, err = render_to_bytes(code)
                    if video:
                        break
                    code = write_manim_code(description, err, code)
    
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
                except Exception as e:
                    print(f"UPLOAD FAILED section {i} step {step_index}: {e}")
    
        # Store the finished map so the app can pick it up later
        supabase.table("animation_jobs").upsert({
            "cache_key": cache_key,
            "animations": results,
            "status": "done",
        }).execute()
        print(f"Animation pass complete for {cache_key}: {len(results)} animations")
    except Exception as e:
        import traceback
        print(f"ANIMATION PASS CRASHED for {cache_key}: {e}")
        traceback.print_exc()

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
