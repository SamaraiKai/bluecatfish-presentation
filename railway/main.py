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

MANIM_SYSTEM_PROMPT = """You write Manim Community Edition code for short educational animations about blue catfish in the Chesapeake Bay, for 10-14 year olds.

SETUP
- Class must be named exactly "GeneratedScene", extending Scene.
- Begin with:
  from manim import *
  from catfish_shapes import *
- End with self.wait(1).

USE A READY-MADE ANIMATION — this is the most important rule.
catfish_shapes has tested helpers that play a whole animation in ONE call. Your construct()
should almost always be exactly one animate_* call with the step's own words and numbers,
passing duration=<the target duration>, followed by self.wait(1). Pick the one that fits:

- One striking number to count up to (plain number)     → animate_count_up(self, end_value, label, prefix="", suffix="", duration=D)
- One figure that isn't a plain number ("8-9%", "1/4")   → animate_big_number(self, value, label, duration=D)
- A share of a whole (percent)                            → animate_percent(self, pct, label, duration=D, style="bar" or "pie")
- "X out of Y" (a ratio of things)                        → animate_out_of(self, total, highlighted, label, duration=D)
- Several quantities to compare                           → animate_bars(self, [(label, value), ...], title="", duration=D)
- A value before vs after (change over time)              → animate_before_after(self, before_label, before_value, after_label, after_value, title="", duration=D)
- Something rising or falling, no exact numbers           → animate_trend(self, "up" or "down", label, duration=D)
- Few fish becoming many (population growth)              → animate_population_boom(self, before_count, after_count, before_label, after_label, duration=D)
- Spreading from place to place (rivers, regions)         → animate_spread(self, [place1, place2, ...], duration=D)
- Sizes of creatures side by side                         → animate_size_compare(self, [(label, relative_size, "fish"|"small_fish"|"crab"|"kid"), ...], duration=D)
- One thing outweighs another (dominates, outnumbers)     → animate_heavier(self, heavy_label, light_label, duration=D)
- What the catfish eats (list of prey)                    → animate_eats(self, predator_label, [prey, ...], duration=D)
- What the catfish affects all around it (food web)       → animate_food_web(self, center_label, [others, ...], duration=D)
- Cause and effect in a row                               → animate_chain(self, [cause, effect, effect, ...], duration=D)
- A loop / cycle / feedback                               → animate_cycle(self, [stage1, stage2, stage3, ...], duration=D)
- Dated events in order                                   → animate_timeline(self, [(when, what), ...], duration=D)
- Two things side by side (this vs that)                  → animate_compare(self, left_title, [points], right_title, [points], duration=D)
- A list of actions or ways to help                       → animate_checklist(self, [item, ...], title="", duration=D)
- Catch it and eat it (the solution)                      → animate_catch_and_cook(self, catch_label, cook_label, duration=D)
- A key idea or definition with no numbers                → animate_fact(self, title, text, duration=D)   (warning=True for a danger/"don't")

Only if truly none of these fit, build a simple scene from the shape helpers (fish, small_fish, crab, kid,
school_of_fish, water_scene, river, fishing_hook, plate_with_fish, warning_sign, fact_card, labeled_bars,
percent_bar, pie_share, dot_grid, compare_columns, cycle_diagram, radial_web, checklist, balance_scale,
trend_arrow, flow_chain, eats, big_number, timeline, growth_curve, proportion_circles) and animate a change.
Never draw your own fish, crab or chart from raw shapes.

WORDS ON SCREEN
- Labels are short: 1-5 words each. Keep lists to 2-5 items.
- Numbers must appear exactly as in the source content. Never round, approximate, or invent a figure.
- Values passed to animate_count_up / animate_bars / animate_before_after / animate_percent must be plain numbers.

CONSTRAINTS
- No MathTex, Tex, Axes, NumberLine, DecimalNumber, Integer, SVGMobject, or ImageMobject (no LaTeX is installed).
- One idea only. If the description mentions several, animate the first.

Output ONLY the Python code. No markdown fences, no explanation."""


def render_to_bytes(code: str):
    workdir = Path(tempfile.mkdtemp())
    try:
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
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        
def estimate_duration(step: dict) -> int:
    # match the animation to what is spoken when there is a narration script
    text = step.get("narration") or " ".join(str(v) for v in step.values() if isinstance(v, str))
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
        model="gpt-6-sol", reasoning_effort="medium", messages=messages, max_completion_tokens=4200,
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
        elif t == "compare":
            lines.append(f"{idx}: compare — {s.get('leftTitle')}: {', '.join(s.get('left') or [])} vs {s.get('rightTitle')}: {', '.join(s.get('right') or [])}")
        elif t == "detail":
            lines.append(f"{idx}: detail ({s.get('heading') or ''}) — {s.get('narration') or ''}")
        else:
            lines.append(f"{idx}: {t} — {s.get('narration') or s.get('text') or s.get('question') or s.get('statement') or ''}")

    resp = openai_client.chat.completions.create(
        model="gpt-6-luna",
        reasoning_effort="low", 
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": """You decide which teaching steps would benefit from a simple animated diagram.

Choose a step if it involves ANY of: a number, quantity, proportion or percentage; a comparison between two or more things; a sequence of causes or stages; growth, decline, or change over time; movement or spread across space; a relationship between parts.
Steps of type "numberSpotlight", "compare" and "processFlow" should almost always be chosen — they are inherently visual.

Skip a step only if it is purely a definition, a question with no quantity, or a statement with no visual structure at all.
Never choose a step marked "imageFocus".

Choose 2-3 steps per section (sections now have 4-7 steps), spread across the section rather than bunched together.

For each chosen step write a "description": a SIMPLE animation, describable in under 15 seconds. Diagram, not picture. Be specific about what appears and what moves, and name the exact labels and numbers from the step.
Ready-made animations exist for: counting up to a number, a percent bar or pie slice, "X out of Y" dots, bar charts, before vs after, a rising/falling arrow, a few fish becoming many, spreading along a river, creature size comparison, a tipping balance scale, a catfish and what it eats, a food web, a cause-and-effect chain, a cycle, a timeline of dated events, two columns side by side, a checklist of ways to help, catching and cooking a fish, and a fact card or warning sign. Describe the animation in those terms when one fits.

The description must specify exactly what shapes appear, what text labels them, and what single change occurs. If you cannot describe it that concretely in one sentence, do not choose that step.

Favor steps where a quantity can be shown changing, or where one thing visibly affects another. A description should be able to complete this sentence: "the viewer watches ___ happen." If it cannot, skip that step.

Output JSON: { "animations": [ { "stepIndex": 0, "description": "..." } ] }"""},
            {"role": "user", "content": f"Section: \"{section.get('title')}\"\n\nSteps:\n" + "\n".join(lines)},
        ],
        max_completion_tokens=1500,
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
