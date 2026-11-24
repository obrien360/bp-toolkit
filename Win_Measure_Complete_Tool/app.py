"""
app.py - Hugging Face Spaces Entrypoint (Gradio + FastAPI Backend)
Serves both the interactive Gradio status page and all REST API endpoints
needed by the GitHub Pages frontend (https://obrien360.github.io/bp-toolkit/).
"""
import os
import sys
import json
import base64

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import fitz
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import gradio as gr

from engine import WindowCompletionEngine, DEFAULT_LABEL_REGEX
import server

# Create FastAPI app
custom_app = FastAPI(title="O'Brien360 Window Measurement Tool API")

# Enable full CORS for GitHub Pages and localhost
custom_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@custom_app.get("/api/status")
async def get_status():
    return {
        "status": "ready",
        "loaded": server.SESSION["doc_original"] is not None,
        "filename": server.SESSION["filename"],
        "page_count": server.SESSION["page_count"],
        "has_analysis": server.SESSION["analysis_result"] is not None,
        "has_completed": server.SESSION["doc_completed"] is not None,
        "added_count": server.SESSION["completion_result"]["added_count"] if server.SESSION["completion_result"] else 0
    }

@custom_app.post("/api/load-sample")
async def load_sample():
    sample_file = server.SAMPLE_FILE
    if not os.path.exists(sample_file):
        return JSONResponse({"error": "Sample file not found"}, status_code=404)
    with open(sample_file, "rb") as f:
        pdf_bytes = f.read()
    server.SESSION["pdf_bytes"] = pdf_bytes
    server.SESSION["filename"] = "Windows_Measure_Test.pdf"
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    server.SESSION["doc_original"] = doc
    server.SESSION["doc_completed"] = None
    server.SESSION["completion_result"] = None
    server.SESSION["page_count"] = len(doc)
    server.SESSION["page_dimensions"] = [
        {"page": i + 1, "width": round(p.rect.width, 1), "height": round(p.rect.height, 1)}
        for i, p in enumerate(doc)
    ]
    res = server.SESSION["engine"].extract_manual_measurements(doc)
    server.SESSION["analysis_result"] = res
    return {
        "status": "success",
        "filename": server.SESSION["filename"],
        "page_count": len(doc),
        "page_dimensions": server.SESSION["page_dimensions"],
        "summary_types": res["summary_types"],
        "learned_types_count": len(res["rules"]),
        "manual_measurements_count": len(res["manual_records"]),
        "manual_records": res["manual_records"][:100]
    }

@custom_app.post("/api/upload")
async def upload_pdf(request: Request):
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    pdf_bytes = None
    filename = "uploaded.pdf"

    if "application/json" in content_type:
        data = json.loads(body.decode("utf-8"))
        filename = data.get("filename", "uploaded.pdf")
        b64_data = data.get("file_base64", "")
        if "," in b64_data:
            b64_data = b64_data.split(",", 1)[1]
        pdf_bytes = base64.b64decode(b64_data)
    else:
        pdf_bytes = body

    if not pdf_bytes or len(pdf_bytes) < 100:
        return JSONResponse({"error": "Invalid PDF data received"}, status_code=400)

    server.SESSION["pdf_bytes"] = pdf_bytes
    server.SESSION["filename"] = filename
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    server.SESSION["doc_original"] = doc
    server.SESSION["doc_completed"] = None
    server.SESSION["completion_result"] = None
    server.SESSION["page_count"] = len(doc)
    server.SESSION["page_dimensions"] = [
        {"page": i + 1, "width": round(p.rect.width, 1), "height": round(p.rect.height, 1)}
        for i, p in enumerate(doc)
    ]
    res = server.SESSION["engine"].extract_manual_measurements(doc)
    server.SESSION["analysis_result"] = res
    return {
        "status": "success",
        "filename": filename,
        "page_count": len(doc),
        "page_dimensions": server.SESSION["page_dimensions"],
        "summary_types": res["summary_types"],
        "learned_types_count": len(res["rules"]),
        "manual_measurements_count": len(res["manual_records"]),
        "manual_records": res["manual_records"][:100]
    }

@custom_app.post("/api/analyze")
async def analyze_pdf(request: Request):
    if server.SESSION["doc_original"] is None:
        return JSONResponse({"error": "No PDF loaded"}, status_code=400)
    payload = await request.json() if (await request.body()) else {}
    label_regex = payload.get("label_regex", DEFAULT_LABEL_REGEX)
    res = server.SESSION["engine"].extract_manual_measurements(server.SESSION["doc_original"], label_regex=label_regex)
    server.SESSION["analysis_result"] = res
    return {
        "status": "success",
        "summary_types": res["summary_types"],
        "learned_types_count": len(res["rules"]),
        "manual_measurements_count": len(res["manual_records"]),
        "manual_records": res["manual_records"][:100]
    }

@custom_app.get("/api/page-preview")
async def page_preview(page: int = 0, mode: str = "original", zoom: float = 1.3):
    target_doc = server.SESSION["doc_completed"] if (mode == "completed" and server.SESSION["doc_completed"]) else server.SESSION["doc_original"]
    if target_doc is None or page < 0 or page >= len(target_doc):
        return JSONResponse({"error": "Invalid page index"}, status_code=400)
    p = target_doc[page]
    zoom = max(0.5, min(zoom, 2.5))
    preview_info = WindowCompletionEngine.render_page_preview_image(p, zoom=zoom)
    annots_geom = []
    for a in p.annots():
        rc, rect = WindowCompletionEngine._get_annot_geometry(a)
        if rc and rect:
            annots_geom.append({
                'rect': [rect.x0, rect.y0, rect.x1, rect.y1],
                'center': [rc[0], rc[1]],
                'type': a.type[1],
                'content': a.info.get('content', '')
            })
    preview_info['annots'] = annots_geom
    preview_info['page_num'] = page + 1
    preview_info['page_rect'] = [0, 0, p.rect.width, p.rect.height]
    return preview_info

@custom_app.post("/api/process")
async def process_measurements(request: Request):
    if server.SESSION["doc_original"] is None or server.SESSION["analysis_result"] is None:
        return JSONResponse({"error": "No PDF loaded or analyzed"}, status_code=400)
    payload = await request.json() if (await request.body()) else {}
    selected_pages = payload.get("pages", None)
    selected_types = payload.get("types", None)
    doc_completed = fitz.open(stream=server.SESSION["pdf_bytes"], filetype="pdf")
    res = server.SESSION["analysis_result"]
    comp_result = server.SESSION["engine"].complete_measurements(
        doc=doc_completed,
        rules=res["rules"],
        page_indices=selected_pages,
        selected_types=selected_types
    )
    server.SESSION["doc_completed"] = doc_completed
    server.SESSION["completion_result"] = comp_result
    return {
        "status": "success",
        "added_count": comp_result["added_count"],
        "counts_by_type": comp_result["counts_by_type"],
        "counts_by_page": comp_result["counts_by_page"],
        "snapped_count": comp_result["snapped_count"],
        "added_annotations": comp_result["added_annotations"][:200]
    }

@custom_app.get("/api/download")
async def download_completed():
    if server.SESSION["doc_completed"] is None:
        return JSONResponse({"error": "No completed PDF generated"}, status_code=400)
    pdf_bytes = server.SESSION["doc_completed"].tobytes(garbage=0, deflate=True)
    base_name = os.path.splitext(server.SESSION["filename"])[0]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{base_name}_completed.pdf"'}
    )

@custom_app.get("/api/export-csv")
async def export_csv():
    if server.SESSION["analysis_result"] is None:
        return JSONResponse({"error": "No analysis data available"}, status_code=400)
    added_counts = server.SESSION["completion_result"]["counts_by_type"] if server.SESSION["completion_result"] else {}
    csv_str = WindowCompletionEngine.generate_takeoff_csv(
        server.SESSION["analysis_result"]["summary_types"],
        added_counts
    )
    base_name = os.path.splitext(server.SESSION["filename"])[0]
    return Response(
        content=csv_str.encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{base_name}_window_takeoff.csv"'}
    )

# Visual status landing page for direct browser visits to Hugging Face
with gr.Blocks(title="O'Brien360 Window Measurement Tool API") as demo:
    gr.Markdown("# 🪟 O'Brien360 Window Measurement Tool API Backend")
    gr.Markdown("### 🟢 Status: Running and Connected")
    gr.Markdown("This backend powers the interactive client application on GitHub Pages:")
    gr.Markdown("👉 **[Launch Window Measurement Completion Tool](https://obrien360.github.io/bp-toolkit/Win_Measure_Complete_Tool/)**")

app = gr.mount_gradio_app(custom_app, demo, path="/")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
