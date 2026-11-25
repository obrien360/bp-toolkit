"""
tool1_jobs.py - Async job manager for Tool 1 (window_example_tool.py).
Shared by both app.py (Hugging Face Spaces / FastAPI) and server.py (local http.server).
"""
import csv
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

try:
    import pymupdf as fitz
except ImportError:
    import fitz

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOOL1_SCRIPT = os.path.join(BASE_DIR, "window_example_tool.py")
JOB_TTL_SECONDS = 600  # 10 minutes expiry for client drawings


def _safe_stem(filename: str) -> str:
    stem = os.path.splitext(os.path.basename(filename or "drawing.pdf"))[0]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return cleaned or "drawing"


class Tool1JobManager:
    """Runs window_example_tool.py in background threads and manages temp job files."""

    def __init__(self, ttl_seconds: int = JOB_TTL_SECONDS):
        self._lock = threading.Lock()
        self._jobs = {}
        self._ttl_seconds = ttl_seconds

    def cleanup_expired(self) -> None:
        now = time.time()
        expired_ids = []
        with self._lock:
            for jid, job in self._jobs.items():
                if job["status"] != "running" and (now - job["updated_at"]) > self._ttl_seconds:
                    expired_ids.append(jid)
            for jid in expired_ids:
                job = self._jobs.pop(jid, None)
                if job:
                    shutil.rmtree(job["job_dir"], ignore_errors=True)

    def start_job(self, pdf_bytes: bytes, filename: str, options: dict | None = None) -> str:
        self.cleanup_expired()
        options = options or {}
        job_id = uuid.uuid4().hex[:12]
        job_dir = tempfile.mkdtemp(prefix=f"ob360_tool1_{job_id}_")
        stem = _safe_stem(filename)
        input_path = os.path.join(job_dir, f"{stem}.pdf")
        examples_path = os.path.join(job_dir, f"{stem}_examples.pdf")
        report_path = os.path.join(job_dir, f"{stem}_examples_report.pdf")

        with open(input_path, "wb") as f:
            f.write(pdf_bytes)

        cmd = [sys.executable, "-u", TOOL1_SCRIPT, input_path, "-o", examples_path]
        if options.get("scale"):
            cmd.extend(["--scale", str(options["scale"]).strip()])
        if options.get("skip_pages"):
            cmd.extend(["--skip-pages", str(options["skip_pages"]).strip()])
        if options.get("types"):
            cmd.extend(["--types", str(options["types"]).strip()])
        if options.get("exclude_types"):
            cmd.extend(["--exclude-types", str(options["exclude_types"]).strip()])
        if options.get("ignore_existing"):
            cmd.append("--ignore-existing")

        now = time.time()
        job = {
            "job_id": job_id,
            "job_dir": job_dir,
            "stem": stem,
            "filename": os.path.basename(filename or f"{stem}.pdf"),
            "input_path": input_path,
            "examples_path": examples_path,
            "report_path": report_path,
            "status": "running",
            "progress": [],
            "error": None,
            "report_rows": [],
            "closeup_pages": [],
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(target=self._run_worker, args=(job_id, cmd), daemon=True)
        thread.start()
        return job_id

    def _run_worker(self, job_id: str, cmd: list[str]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
        if not job:
            return

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=BASE_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            if proc.stdout is not None:
                for raw_line in proc.stdout:
                    line = raw_line.rstrip("\r\n")
                    if not line:
                        continue
                    with self._lock:
                        if job_id in self._jobs:
                            self._jobs[job_id]["progress"].append(line)
                            self._jobs[job_id]["updated_at"] = time.time()
            rc = proc.wait()

            # Remove uploaded input drawing immediately once Tool 1 finishes
            try:
                if os.path.exists(job["input_path"]):
                    os.remove(job["input_path"])
            except OSError:
                pass

            if rc == 0 and os.path.isfile(job["examples_path"]):
                report_rows = self._extract_report_rows(job["report_path"])
                closeup_pages = self._extract_closeup_pages(job["report_path"])
                with self._lock:
                    if job_id in self._jobs:
                        self._jobs[job_id]["report_rows"] = report_rows
                        self._jobs[job_id]["closeup_pages"] = closeup_pages
                        self._jobs[job_id]["status"] = "done"
                        self._jobs[job_id]["updated_at"] = time.time()
            else:
                with self._lock:
                    lines = self._jobs[job_id]["progress"] if job_id in self._jobs else []
                    err_msg = lines[-1] if lines else f"Tool 1 exited with code {rc}"
                    if job_id in self._jobs:
                        self._jobs[job_id]["status"] = "error"
                        self._jobs[job_id]["error"] = err_msg
                        self._jobs[job_id]["updated_at"] = time.time()
        except Exception as exc:
            with self._lock:
                if job_id in self._jobs:
                    self._jobs[job_id]["status"] = "error"
                    self._jobs[job_id]["error"] = str(exc)
                    self._jobs[job_id]["updated_at"] = time.time()

    @staticmethod
    def _extract_report_rows(report_path: str) -> list[dict]:
        if not os.path.isfile(report_path):
            return []
        try:
            doc = fitz.open(report_path)
            csv_bytes = doc.embfile_get("examples.csv")
            doc.close()
            reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8", errors="replace")))
            return list(reader)
        except Exception:
            return []

    @staticmethod
    def _extract_closeup_pages(report_path: str) -> list[str]:
        if not os.path.isfile(report_path):
            return []
        try:
            import base64
            doc = fitz.open(report_path)
            images = []
            for page in doc:
                if "Close-ups" in page.get_text("text"):
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
                    b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
                    images.append(f"data:image/png;base64,{b64}")
            doc.close()
            return images
        except Exception:
            return []

    def get_status(self, job_id: str) -> dict | None:
        self.cleanup_expired()
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return {
                "job_id": job["job_id"],
                "filename": job["filename"],
                "status": job["status"],
                "progress": list(job["progress"]),
                "last_line": job["progress"][-1] if job["progress"] else "Starting Tool 1...",
                "error": job["error"],
                "has_examples": os.path.isfile(job["examples_path"]),
                "has_report": os.path.isfile(job["report_path"]),
                "report_rows": list(job["report_rows"]),
                "closeup_pages": list(job["closeup_pages"]),
            }

    def read_file(self, job_id: str, kind: str) -> tuple[bytes, str] | None:
        self.cleanup_expired()
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if kind == "examples":
                path = job["examples_path"]
                out_name = f"{job['stem']}_examples.pdf"
            elif kind == "report":
                path = job["report_path"]
                out_name = f"{job['stem']}_examples_report.pdf"
            else:
                return None
            if not os.path.isfile(path):
                return None
            job["updated_at"] = time.time()

        with open(path, "rb") as f:
            return f.read(), out_name
