"""
server.py - Lightweight REST API & Web Server for O'Brien360 PDF Window Measurement Completion Tool
Zero external web framework dependencies (uses standard library http.server).
"""

import http.server
import socketserver
import urllib.parse
import json
import os
import sys
import re
import webbrowser
import mimetypes
import traceback
import base64
import pymupdf

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from engine import WindowCompletionEngine, DEFAULT_LABEL_REGEX

PORT = 8088
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)
SAMPLE_FILE = os.path.join(BASE_DIR, "Windows_Measure_Test.pdf")

# In-memory session store
SESSION = {
    "doc_original": None,
    "doc_completed": None,
    "filename": "Windows_Measure_Test.pdf",
    "pdf_bytes": None,
    "analysis_result": None,
    "completion_result": None,
    "page_count": 0,
    "page_dimensions": [],
    "engine": WindowCompletionEngine()
}


class WinMeasureHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def send_error_json(self, message, status=400):
        self.send_json({"error": str(message)}, status=status)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/status":
            self.handle_status()
        elif path == "/api/page-preview":
            self.handle_page_preview(query)
        elif path == "/api/download":
            self.handle_download(query)
        elif path == "/api/export-csv":
            self.handle_export_csv()
        elif path == "/" or path == "/index.html":
            self.path = "/index.html"
            super().do_GET()
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            if path == "/api/load-sample":
                self.handle_load_sample()
            elif path == "/api/upload":
                self.handle_upload(body)
            elif path == "/api/analyze":
                payload = json.loads(body.decode("utf-8")) if body else {}
                self.handle_analyze(payload)
            elif path == "/api/process":
                payload = json.loads(body.decode("utf-8")) if body else {}
                self.handle_process(payload)
            else:
                self.send_error_json(f"Endpoint not found: {path}", status=404)
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(f"Server error: {str(e)}", status=500)

    # -------------------- API HANDLERS --------------------

    def handle_status(self):
        self.send_json({
            "status": "ready",
            "loaded": SESSION["doc_original"] is not None,
            "filename": SESSION["filename"],
            "page_count": SESSION["page_count"],
            "has_analysis": SESSION["analysis_result"] is not None,
            "has_completed": SESSION["doc_completed"] is not None,
            "added_count": SESSION["completion_result"]["added_count"] if SESSION["completion_result"] else 0
        })

    def handle_load_sample(self):
        if not os.path.exists(SAMPLE_FILE):
            self.send_error_json("Sample file Windows_Measure_Test.pdf not found on disk", status=404)
            return

        with open(SAMPLE_FILE, "rb") as f:
            pdf_bytes = f.read()

        SESSION["pdf_bytes"] = pdf_bytes
        SESSION["filename"] = "Windows_Measure_Test.pdf"
        self._load_and_analyze(pdf_bytes, DEFAULT_LABEL_REGEX)

    def handle_upload(self, body):
        content_type = self.headers.get("Content-Type", "")
        pdf_bytes = None
        filename = "uploaded.pdf"

        if "application/json" in content_type:
            data = json.loads(body.decode("utf-8"))
            filename = data.get("filename", "uploaded.pdf")
            b64_data = data.get("file_base64", "")
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            pdf_bytes = base64.b64decode(b64_data)
        elif "multipart/form-data" in content_type:
            boundary = content_type.split("boundary=")[1].encode()
            parts = body.split(b"--" + boundary)
            for part in parts:
                if b'filename="' in part:
                    header, file_data = part.split(b"\r\n\r\n", 1)
                    file_data = file_data.rsplit(b"\r\n", 1)[0]
                    pdf_bytes = file_data
                    header_str = header.decode("utf-8", errors="ignore")
                    m = re.search(r'filename="([^"]+)"', header_str)
                    if m:
                        filename = os.path.basename(m.group(1))
                    break
        else:
            pdf_bytes = body

        if not pdf_bytes or len(pdf_bytes) < 100:
            self.send_error_json("No valid PDF data received", status=400)
            return

        SESSION["pdf_bytes"] = pdf_bytes
        SESSION["filename"] = filename
        self._load_and_analyze(pdf_bytes, DEFAULT_LABEL_REGEX)

    def _load_and_analyze(self, pdf_bytes, label_regex):
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        SESSION["doc_original"] = doc
        SESSION["doc_completed"] = None
        SESSION["completion_result"] = None
        SESSION["page_count"] = len(doc)
        SESSION["page_dimensions"] = [{"page": i + 1, "width": round(p.rect.width, 1), "height": round(p.rect.height, 1)} for i, p in enumerate(doc)]

        engine = SESSION["engine"]
        res = engine.extract_manual_measurements(doc, label_regex=label_regex)
        SESSION["analysis_result"] = res

        self.send_json({
            "status": "success",
            "filename": SESSION["filename"],
            "page_count": len(doc),
            "page_dimensions": SESSION["page_dimensions"],
            "summary_types": res["summary_types"],
            "learned_types_count": len(res["rules"]),
            "manual_measurements_count": len(res["manual_records"]),
            "manual_records": res["manual_records"][:100]  # First 100 for review
        })

    def handle_analyze(self, payload):
        if SESSION["doc_original"] is None:
            self.send_error_json("No PDF loaded", status=400)
            return

        label_regex = payload.get("label_regex", DEFAULT_LABEL_REGEX)
        engine = SESSION["engine"]
        res = engine.extract_manual_measurements(SESSION["doc_original"], label_regex=label_regex)
        SESSION["analysis_result"] = res

        self.send_json({
            "status": "success",
            "summary_types": res["summary_types"],
            "learned_types_count": len(res["rules"]),
            "manual_measurements_count": len(res["manual_records"]),
            "manual_records": res["manual_records"][:100]
        })

    def handle_page_preview(self, query):
        if SESSION["doc_original"] is None:
            self.send_error_json("No PDF loaded", status=400)
            return

        page_idx = int(query.get("page", [0])[0])
        mode = query.get("mode", ["original"])[0]  # 'original' or 'completed'
        
        target_doc = SESSION["doc_completed"] if (mode == "completed" and SESSION["doc_completed"]) else SESSION["doc_original"]

        if page_idx < 0 or page_idx >= len(target_doc):
            self.send_error_json(f"Page index {page_idx} out of range (0..{len(target_doc)-1})", status=400)
            return

        page = target_doc[page_idx]
        zoom = float(query.get("zoom", [1.3])[0])
        zoom = max(0.5, min(zoom, 2.5))

        preview_info = WindowCompletionEngine.render_page_preview_image(page, zoom=zoom)

        # Also send overlay geometry for fast interactive vector highlight on browser canvas
        annots_geom = []
        for a in page.annots():
            rc, rect = WindowCompletionEngine._get_annot_geometry(a)
            if rc and rect:
                annots_geom.append({
                    'xref': a.xref,
                    'type': a.type[1],
                    'content': a.info.get('content', ''),
                    'title': a.info.get('title', ''),
                    'subject': a.info.get('subject', ''),
                    'rect': [rect.x0, rect.y0, rect.x1, rect.y1],
                    'center': [rc[0], rc[1]]
                })

        preview_info['annots'] = annots_geom
        preview_info['page_num'] = page_idx + 1
        preview_info['page_rect'] = [0, 0, page.rect.width, page.rect.height]
        self.send_json(preview_info)

    def handle_process(self, payload):
        if SESSION["doc_original"] is None or SESSION["analysis_result"] is None:
            self.send_error_json("No PDF loaded or analyzed", status=400)
            return

        enable_snap = payload.get("enable_snap", True)
        search_pt = float(payload.get("search_pt", 18.0))
        step_pt = float(payload.get("step_pt", 0.5))
        min_gain = float(payload.get("min_gain", 0.003))
        max_shift = float(payload.get("max_shift", 16.0))
        overlap_dist = float(payload.get("overlap_distance_threshold", 16.0))
        overlap_iou = float(payload.get("overlap_iou_threshold", 0.35))
        selected_pages = payload.get("pages", None) # list of 0-based page indices
        selected_types = payload.get("types", None) # list of types or None

        # Re-open fresh document from original bytes to preserve original markups intact
        doc_completed = pymupdf.open(stream=SESSION["pdf_bytes"], filetype="pdf")

        engine = WindowCompletionEngine(
            scale_raster=2.0,
            search_pt=search_pt,
            step_pt=step_pt,
            min_gain=min_gain,
            max_shift=max_shift
        )

        res = SESSION["analysis_result"]
        rules = res["rules"]

        comp_result = engine.complete_measurements(
            doc=doc_completed,
            rules=rules,
            page_indices=selected_pages,
            enable_snap=enable_snap,
            overlap_distance_threshold=overlap_dist,
            overlap_iou_threshold=overlap_iou,
            selected_types=selected_types
        )

        SESSION["doc_completed"] = doc_completed
        SESSION["completion_result"] = comp_result

        # Auto-save completed PDF and takeoff CSV directly to output directory on disk
        base_name = os.path.splitext(SESSION["filename"])[0]
        out_pdf_filename = f"{base_name}_completed.pdf"
        out_pdf_path = os.path.join(OUTPUT_DIR, out_pdf_filename)
        doc_completed.save(out_pdf_path, garbage=0, deflate=True)

        out_csv_filename = f"{base_name}_window_takeoff.csv"
        out_csv_path = os.path.join(OUTPUT_DIR, out_csv_filename)
        csv_str = WindowCompletionEngine.generate_takeoff_csv(
            res["summary_types"],
            comp_result["counts_by_type"]
        )
        with open(out_csv_path, "w", encoding="utf-8") as f:
            f.write(csv_str)

        self.send_json({
            "status": "success",
            "added_count": comp_result["added_count"],
            "counts_by_type": comp_result["counts_by_type"],
            "counts_by_page": comp_result["counts_by_page"],
            "snapped_count": comp_result["snapped_count"],
            "saved_pdf": out_pdf_filename,
            "saved_csv": out_csv_filename,
            "output_dir": "output",
            "added_annotations": comp_result["added_annotations"][:200]
        })

    def handle_download(self, query):
        if SESSION["doc_completed"] is None:
            self.send_error_json("No completed PDF generated yet. Please run processing first.", status=400)
            return

        out_pdf_bytes = SESSION["doc_completed"].tobytes(garbage=0, deflate=True)
        base_name = os.path.splitext(SESSION["filename"])[0]
        out_filename = f"{base_name}_completed.pdf"

        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", f'attachment; filename="{out_filename}"')
        self.send_header("Content-Length", str(len(out_pdf_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(out_pdf_bytes)

    def handle_export_csv(self):
        if SESSION["analysis_result"] is None:
            self.send_error_json("No analysis data available", status=400)
            return

        added_counts = SESSION["completion_result"]["counts_by_type"] if SESSION["completion_result"] else {}
        csv_str = WindowCompletionEngine.generate_takeoff_csv(
            SESSION["analysis_result"]["summary_types"],
            added_counts
        )
        csv_bytes = csv_str.encode("utf-8")
        base_name = os.path.splitext(SESSION["filename"])[0]
        out_filename = f"{base_name}_window_takeoff.csv"

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{out_filename}"')
        self.send_header("Content-Length", str(len(csv_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(csv_bytes)


def run_server(port=PORT):
    # Allow socket reuse
    socketserver.TCPServer.allow_reuse_address = True
    server_address = ("", port)
    
    with socketserver.TCPServer(server_address, WinMeasureHandler) as httpd:
        url = f"http://localhost:{port}"
        print("=" * 60)
        print(f"  O'Brien360 - PDF Window Measurement Completion Tool")
        print(f"  Server running at: {url}")
        print("=" * 60)
        print("Press Ctrl+C to stop the server.\n")

        # Automatically open browser
        try:
            webbrowser.open(url)
        except Exception:
            pass

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server gracefully...")
            httpd.shutdown()


if __name__ == "__main__":
    port_to_use = PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port_to_use = int(sys.argv[1])
    run_server(port_to_use)
