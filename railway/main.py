import os
import subprocess
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

RENDER_TOKEN = os.environ.get("RENDER_TOKEN")


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
