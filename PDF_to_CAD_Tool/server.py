"""
server.py - Lightweight REST API & Web Server for O'Brien360 PDF to Clean CAD Tool
Zero external server dependencies required (uses standard library http.server).
"""

import http.server
import socketserver
import urllib.parse
import json
import os
import sys
import webbrowser
import mimetypes
import traceback
import base64
import pymupdf

from cad_engine import (
    detect_pdf_scale,
    inspect_pdf_levels,
    extract_raw_zones,
    process_cad_conversion,
    export_cad_files,
    generate_verification_plot,
    open_pdf_document,
    COMMON_SCALES
)

PORT = 8085
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output_cad")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# In-memory session store
CURRENT_SESSION = {
    "pdf_doc": None,
    "pdf_filename": "Zoning.pdf",
    "pdf_bytes": None,
    "scale_info": None,
    "levels_info": None,
    "processed_data": None,
    "raw_levels": None
}


class CADToolHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, format, *args):
        # Clean logging
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

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

        if path == "/api/load-example":
            self.handle_load_example()
        elif path == "/api/common-scales":
            self.send_json({"scales": COMMON_SCALES})
        elif path.startswith("/api/download/"):
            filename = urllib.parse.unquote(path.replace("/api/download/", ""))
            self.handle_download(filename)
        else:
            # Fall back to standard static file serving
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_length)

        if path == "/api/analyze-pdf":
            self.handle_analyze_pdf(post_body)
        elif path == "/api/convert":
            self.handle_convert(post_body)
        elif path == "/api/export":
            self.handle_export(post_body)
        else:
            self.send_error_json("Unknown API endpoint", 404)

    def handle_load_example(self):
        try:
            example_path = os.path.join(BASE_DIR, "Zoning.pdf")
            if not os.path.exists(example_path):
                self.send_error_json("Zoning.pdf example not found", 404)
                return

            with open(example_path, "rb") as f:
                pdf_bytes = f.read()

            doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
            CURRENT_SESSION["pdf_doc"] = doc
            CURRENT_SESSION["pdf_bytes"] = pdf_bytes
            CURRENT_SESSION["pdf_filename"] = "Zoning.pdf"

            pts_per_ft, scale_label, scale_source = detect_pdf_scale(doc)
            sorted_levels, levels_dict = inspect_pdf_levels(doc)
            raw_levels = extract_raw_zones(doc, scale=pts_per_ft)

            CURRENT_SESSION["raw_levels"] = raw_levels
            CURRENT_SESSION["scale_info"] = {
                "pts_per_ft": pts_per_ft,
                "label": scale_label,
                "source": scale_source
            }
            CURRENT_SESSION["levels_info"] = {
                "levels": sorted_levels,
                "details": levels_dict
            }

            self.send_json({
                "status": "success",
                "filename": "Zoning.pdf",
                "scale": CURRENT_SESSION["scale_info"],
                "levels": sorted_levels,
                "levels_details": levels_dict,
                "raw_levels": raw_levels,
                "common_scales": COMMON_SCALES
            })
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(str(e), 500)

    def handle_analyze_pdf(self, body):
        try:
            data = json.loads(body.decode("utf-8"))
            filename = data.get("filename", "Uploaded.pdf")
            base64_content = data.get("file_data", "")

            if "," in base64_content:
                base64_content = base64_content.split(",", 1)[1]

            pdf_bytes = base64.b64decode(base64_content)
            doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")

            CURRENT_SESSION["pdf_doc"] = doc
            CURRENT_SESSION["pdf_bytes"] = pdf_bytes
            CURRENT_SESSION["pdf_filename"] = filename

            pts_per_ft, scale_label, scale_source = detect_pdf_scale(doc)
            sorted_levels, levels_dict = inspect_pdf_levels(doc)
            raw_levels = extract_raw_zones(doc, scale=pts_per_ft)

            CURRENT_SESSION["raw_levels"] = raw_levels
            CURRENT_SESSION["scale_info"] = {
                "pts_per_ft": pts_per_ft,
                "label": scale_label,
                "source": scale_source
            }
            CURRENT_SESSION["levels_info"] = {
                "levels": sorted_levels,
                "details": levels_dict
            }

            self.send_json({
                "status": "success",
                "filename": filename,
                "scale": CURRENT_SESSION["scale_info"],
                "levels": sorted_levels,
                "levels_details": levels_dict,
                "raw_levels": raw_levels,
                "common_scales": COMMON_SCALES
            })
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(str(e), 500)

    def handle_convert(self, body):
        try:
            if CURRENT_SESSION["pdf_doc"] is None:
                self.send_error_json("No PDF loaded. Please upload a PDF or load the example first.", 400)
                return

            params = json.loads(body.decode("utf-8"))
            base_level = params.get("base_level")
            conversion_order = params.get("conversion_order", [])
            level_bases = params.get("level_bases")
            spread_order = params.get("spread_order")
            scale = float(params.get("scale", 9.0))
            tol_deg = float(params.get("tol_deg", 5.0))
            cluster_tol = float(params.get("cluster_tol", 2.0))
            spacing_pct = float(params.get("spacing_pct", 120.0))
            spacing_ft = params.get("spacing_ft")

            if not base_level:
                levels_avail = CURRENT_SESSION["levels_info"]["levels"]
                base_level = levels_avail[0] if levels_avail else "Level 1"

            if not conversion_order:
                conversion_order = CURRENT_SESSION["levels_info"]["levels"]

            doc = CURRENT_SESSION["pdf_doc"]
            processed = process_cad_conversion(
                doc=doc,
                base_level=base_level,
                conversion_order=conversion_order,
                scale=scale,
                tol_deg=tol_deg,
                cluster_tol=cluster_tol,
                level_bases=level_bases,
                spread_order=spread_order
            )
            CURRENT_SESSION["processed_data"] = processed
            spacing_ft = float(spacing_ft) if spacing_ft is not None else processed["global_max_width"] * spacing_pct / 100.0

            # Convert Shapely objects to clean serializable dict
            serializable_levels = {}
            for lvl_name, lvl in processed["levels"].items():
                serializable_levels[lvl_name] = {
                    "level_name": lvl["level_name"],
                    "is_base": lvl["is_base"],
                    "zones": lvl["zones"],
                    "planar_graph": {
                        "segments": lvl["planar_graph"]["segments"],
                        "segment_count": lvl["planar_graph"]["segment_count"],
                        "polyloops": lvl["planar_graph"]["polyloops"],
                        "polyloop_count": lvl["planar_graph"]["polyloop_count"],
                        "dangling_count": lvl["planar_graph"]["dangling_count"],
                        "dangling_points": lvl["planar_graph"]["dangling_points"]
                    },
                    "overlay_stats": lvl.get("overlay_stats"),
                    "bounds": lvl["bounds"]
                }

            self.send_json({
                "status": "success",
                "base_level": base_level,
                "conversion_order": processed["conversion_order"],
                "spread_order": processed["spread_order"],
                "level_bases": processed["level_bases"],
                "global_max_width": processed["global_max_width"],
                "global_max_height": processed["global_max_height"],
                "spacing_ft": spacing_ft,
                "levels": serializable_levels
            })
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(str(e), 500)

    def handle_export(self, body):
        try:
            if CURRENT_SESSION["processed_data"] is None:
                self.send_error_json("Please run CAD conversion before exporting.", 400)
                return

            params = json.loads(body.decode("utf-8")) if body else {}
            spacing_pct = float(params.get("spacing_pct", 120.0))
            spacing_ft = params.get("spacing_ft")
            layout_mode = params.get("layout_mode", "both")
            raw_prefix = os.path.splitext(CURRENT_SESSION["pdf_filename"])[0]
            file_prefix = params.get("file_prefix", f"{raw_prefix}_Clean")

            files = export_cad_files(
                processed_data=CURRENT_SESSION["processed_data"],
                output_dir=OUTPUT_DIR,
                file_prefix=file_prefix,
                spacing_pct=spacing_pct,
                layout_mode=layout_mode,
                spacing_ft=float(spacing_ft) if spacing_ft is not None else None
            )

            # Also generate high-resolution verification plot PNG
            png_name = f"{file_prefix}_Verification.png"
            png_path = os.path.join(OUTPUT_DIR, png_name)
            generate_verification_plot(CURRENT_SESSION["processed_data"], png_path)

            file_downloads = []
            for f in files:
                file_downloads.append({
                    "mode": f["mode"],
                    "dxf_name": f["dxf_name"],
                    "dxf_url": f"/api/download/{f['dxf_name']}",
                    "dwg_name": f["dwg_name"],
                    "dwg_url": f"/api/download/{f['dwg_name']}"
                })

            self.send_json({
                "status": "success",
                "files": file_downloads,
                "verification_plot": {
                    "filename": png_name,
                    "url": f"/api/download/{png_name}"
                }
            })
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(str(e), 500)

    def handle_download(self, filename):
        file_path = os.path.join(OUTPUT_DIR, filename)
        if not os.path.exists(file_path):
            self.send_error_json("File not found", 404)
            return

        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            if filename.endswith(".dwg"):
                mime_type = "application/acad"
            elif filename.endswith(".dxf"):
                mime_type = "application/dxf"
            else:
                mime_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()

            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_json(str(e), 500)


def run_server():
    global PORT
    handler = CADToolHandler
    server = None
    for p in range(PORT, PORT + 20):
        try:
            server = socketserver.TCPServer(("", p), handler)
            PORT = p
            break
        except OSError:
            continue

    if not server:
        print("Error: Could not bind to any port.")
        sys.exit(1)

    url = f"http://localhost:{PORT}"
    print("=" * 65)
    print("  O'Brien360 Tools — PDF to Clean CAD Tool")
    print(f"  Web Interface running at: {url}")
    print("=" * 65)
    print("Press Ctrl+C to stop the server.")

    # Automatically open browser
    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()


if __name__ == "__main__":
    run_server()
