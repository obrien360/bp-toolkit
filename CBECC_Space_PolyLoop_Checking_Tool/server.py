"""
server.py
=========
Local HTTP server and REST API for CBECC Space PolyLoop Checking Tool.
Part of O'Brien360 Tools Suite.
Zero external server dependencies (uses standard library http.server + shapely).
"""

import os
import sys
import json
import urllib.parse
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Dict, Any, Optional

from polyloop_engine import CBECCModel, GeometryEngine, PolyLoopInjector

PORT = 8090
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Global in-memory session state for active loaded file
SESSION: Dict[str, Any] = {
    "filename": "",
    "original_content": "",
    "model": None,  # CBECCModel instance
    "space_fixes": {},  # space_name -> list of (x, y, z) vertices
    "space_geom_cache": {},  # space_name -> precomputed GeometryEngine result
    "current_repaired_content": ""
}


def get_space_meta_map() -> Dict[str, Dict[str, Any]]:
    if not SESSION["model"]:
        return {}
    return {
        s["name"]: {
            # Reuse the existing PolyLp name when:
            # (a) it was an incomplete block (<3 pts), OR
            # (b) it's an area-mismatch — we replace the wrong coords in-place
            "can_reuse_poly_name": s.get("can_reuse_poly_name", False) or s.get("area_mismatch", False),
            "existing_poly_name": s.get("existing_poly_name")
        }
        for s in SESSION["model"].spaces
    }



def build_model_response(model: CBECCModel, filename: str) -> Dict[str, Any]:
    """Serializes a CBECCModel and precomputed floor unions into JSON."""
    missing_summary = []
    SESSION["space_geom_cache"].clear()

    for spc in model.missing_spaces:
        # Precompute automatic union for each missing/area-mismatch space
        geom_res = GeometryEngine.combine_floors(
            floors=spc["floors"],
            simplify_tol=0.01,
            snap_tol=0.05
        )
        SESSION["space_geom_cache"][spc["name"]] = geom_res

        area_mismatch = spc.get("area_mismatch", False)
        existing_poly_area = spc.get("existing_poly_area")
        combined_floor_area = geom_res.get("area") if geom_res.get("success") else None

        missing_summary.append({
            "name": spc["name"],
            "line_start": spc["line_start"],
            "thermal_zone": spc.get("thermal_zone", ""),
            "story": spc.get("story", ""),
            "declared_area": spc.get("area"),
            "can_reuse_poly_name": spc.get("can_reuse_poly_name", False),
            "existing_poly_name": spc.get("existing_poly_name"),
            "existing_coords_count": spc.get("existing_coords_count", 0),
            "existing_coords": spc.get("existing_coords", []),
            "existing_poly_area": round(existing_poly_area, 2) if existing_poly_area is not None else None,
            "area_mismatch": area_mismatch,
            "combined_floor_area": round(combined_floor_area, 2) if combined_floor_area is not None else None,
            "floor_count": len(spc["floors"]),
            "floors": [
                {
                    "index": idx,
                    "type": f.get("type"),
                    "name": f.get("name"),
                    "coords_count": len(f.get("coords", [])),
                    "coords": f.get("coords", [])
                }
                for idx, f in enumerate(spc["floors"])
            ],
            "auto_union": geom_res
        })

    valid_summary = [
        {
            "name": spc["name"],
            "thermal_zone": spc.get("thermal_zone", ""),
            "story": spc.get("story", ""),
            "existing_poly_name": spc.get("existing_poly_name"),
            "vertex_count": len(spc.get("existing_coords", [])),
            "coords": spc.get("existing_coords", []),
            "area_mismatch": spc.get("area_mismatch", False),
            "existing_poly_area": round(spc["existing_poly_area"], 2) if spc.get("existing_poly_area") is not None else None,
        }
        for spc in model.valid_spaces
    ]

    return {
        "success": True,
        "filename": filename,
        "ruleset": model.ruleset,
        "software_version": model.software_version,
        "bldg_version": model.bldg_version,
        "total_spaces": len(model.spaces),
        "missing_count": len(model.missing_spaces),
        "valid_count": len(model.valid_spaces),
        "max_polyloop_id": model.max_polyloop_id,
        "max_cartesian_id": model.max_cartesian_id,
        "missing_spaces": missing_summary,
        "valid_spaces": valid_summary
    }


class PolyLoopRequestHandler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/status":
            self._send_json({
                "running": True,
                "has_active_file": bool(SESSION["filename"]),
                "filename": SESSION["filename"],
                "fixed_count": len(SESSION["space_fixes"])
            })
            return

        elif parsed.path == "/api/samples":
            sample_files = []
            for f in sorted(os.listdir(BASE_DIR)):
                if f.lower().endswith(('.cibd', '.cibd10', '.cibd16', '.cibd19', '.cibd22', '.cibd25i')):
                    path = os.path.join(BASE_DIR, f)
                    sample_files.append({
                        "name": f,
                        "size_bytes": os.path.getsize(path),
                        "is_default": f == "Shoebox MDL.cibd19"
                    })
            self._send_json({"success": True, "samples": sample_files})
            return

        elif parsed.path == "/api/download":
            if not SESSION["current_repaired_content"] and SESSION["original_content"]:
                # If fixes exist, apply them now
                if SESSION["space_fixes"] and SESSION["model"]:
                    repaired, _ = PolyLoopInjector.inject_fixes(
                        original_content=SESSION["original_content"],
                        fixes=SESSION["space_fixes"],
                        start_poly_id=SESSION["model"].max_polyloop_id + 1,
                        start_cart_id=SESSION["model"].max_cartesian_id + 1,
                        space_meta_map=get_space_meta_map()
                    )
                    SESSION["current_repaired_content"] = repaired
                else:
                    SESSION["current_repaired_content"] = SESSION["original_content"]

            content_bytes = SESSION["current_repaired_content"].encode("utf-8")
            base, ext = os.path.splitext(SESSION["filename"] or "model.cibd19")
            download_name = f"{base}_fixed{ext}"

            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Content-Length", str(len(content_bytes)))
            self.end_headers()
            self.wfile.write(content_bytes)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len)

        try:
            payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            payload = {}

        if parsed.path == "/api/load-sample":
            filename = payload.get("filename", "")
            filepath = os.path.join(BASE_DIR, filename)
            if not os.path.isfile(filepath):
                self._send_json({"success": False, "error": f"Sample file not found: {filename}"}, 404)
                return

            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            SESSION["filename"] = filename
            SESSION["original_content"] = content
            SESSION["model"] = CBECCModel(content, filename)
            SESSION["space_fixes"].clear()
            SESSION["current_repaired_content"] = ""

            resp = build_model_response(SESSION["model"], filename)
            self._send_json(resp)
            return

        elif parsed.path == "/api/upload":
            filename = payload.get("filename", "uploaded_model.cibd")
            content = payload.get("content", "")

            if not content:
                self._send_json({"success": False, "error": "No file content provided."}, 400)
                return

            SESSION["filename"] = filename
            SESSION["original_content"] = content
            SESSION["model"] = CBECCModel(content, filename)
            SESSION["space_fixes"].clear()
            SESSION["current_repaired_content"] = ""

            resp = build_model_response(SESSION["model"], filename)
            self._send_json(resp)
            return

        elif parsed.path == "/api/recalculate-space":
            space_name = payload.get("space_name", "")
            simplify_tol = float(payload.get("simplify_tol", 0.01))
            snap_tol = float(payload.get("snap_tol", 0.05))
            included_floors = payload.get("included_floors", None)

            if not SESSION["model"]:
                self._send_json({"success": False, "error": "No model loaded."}, 400)
                return

            spc = next((s for s in SESSION["model"].missing_spaces if s["name"] == space_name), None)
            if not spc:
                self._send_json({"success": False, "error": f"Space '{space_name}' not found."}, 404)
                return

            res = GeometryEngine.combine_floors(
                floors=spc["floors"],
                simplify_tol=simplify_tol,
                snap_tol=snap_tol,
                included_floor_indices=included_floors
            )
            SESSION["space_geom_cache"][space_name] = res
            self._send_json({"success": True, "result": res})
            return

        elif parsed.path == "/api/apply-fix-single":
            space_name = payload.get("space_name", "")
            vertices = payload.get("vertices", [])  # list of [x, y, z]

            if not SESSION["model"]:
                self._send_json({"success": False, "error": "No active model."}, 400)
                return

            if not vertices:
                self._send_json({"success": False, "error": "No vertices provided."}, 400)
                return

            # Store fix
            SESSION["space_fixes"][space_name] = [(v[0], v[1], v[2]) for v in vertices]

            self._send_json({
                "success": True,
                "space_name": space_name,
                "fixed_count": len(SESSION["space_fixes"]),
                "total_missing": len(SESSION["model"].missing_spaces)
            })
            return

        elif parsed.path == "/api/apply-fix-all":
            # Auto-applies precomputed or cached geometry for all missing spaces
            if not SESSION["model"]:
                self._send_json({"success": False, "error": "No active model."}, 400)
                return

            for spc in SESSION["model"].missing_spaces:
                sname = spc["name"]
                if sname not in SESSION["space_fixes"]:
                    geom = SESSION["space_geom_cache"].get(sname)
                    if not geom:
                        geom = GeometryEngine.combine_floors(spc["floors"])
                        SESSION["space_geom_cache"][sname] = geom

                    if geom.get("success") and geom.get("vertices"):
                        SESSION["space_fixes"][sname] = geom["vertices"]

            # Generate repaired content
            start_poly = SESSION["model"].max_polyloop_id + 1
            start_cart = SESSION["model"].max_cartesian_id + 1

            repaired_text, summary = PolyLoopInjector.inject_fixes(
                original_content=SESSION["original_content"],
                fixes=SESSION["space_fixes"],
                start_poly_id=start_poly,
                start_cart_id=start_cart,
                space_meta_map=get_space_meta_map()
            )
            SESSION["current_repaired_content"] = repaired_text

            self._send_json({
                "success": True,
                "summary": summary,
                "fixed_count": len(SESSION["space_fixes"]),
                "total_missing": len(SESSION["model"].missing_spaces)
            })
            return

        elif parsed.path == "/api/save-disk":
            if not SESSION["current_repaired_content"]:
                if SESSION["space_fixes"] and SESSION["model"]:
                    repaired_text, _ = PolyLoopInjector.inject_fixes(
                        original_content=SESSION["original_content"],
                        fixes=SESSION["space_fixes"],
                        start_poly_id=SESSION["model"].max_polyloop_id + 1,
                        start_cart_id=SESSION["model"].max_cartesian_id + 1,
                        space_meta_map=get_space_meta_map()
                    )
                    SESSION["current_repaired_content"] = repaired_text
                else:
                    SESSION["current_repaired_content"] = SESSION["original_content"]

            base, ext = os.path.splitext(SESSION["filename"] or "model.cibd19")
            save_path = os.path.join(BASE_DIR, f"{base}_fixed{ext}")
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(SESSION["current_repaired_content"])

            self._send_json({
                "success": True,
                "saved_path": save_path,
                "filename": os.path.basename(save_path)
            })
            return

        self._send_json({"error": "Endpoint not found"}, 404)

    def _send_json(self, data: dict, status_code: int = 200):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def run_server(port: int = PORT, open_browser: bool = False):
    server_address = ("127.0.0.1", port)
    attempts = 0
    httpd = None

    while attempts < 10:
        try:
            httpd = HTTPServer(server_address, PolyLoopRequestHandler)
            break
        except OSError:
            port += 1
            server_address = ("127.0.0.1", port)
            attempts += 1

    if not httpd:
        print(f"Error: Could not bind to port {port} or subsequent ports.")
        sys.exit(1)

    url = f"http://localhost:{port}/"
    print("=" * 66)
    print("  O'Brien360 - CBECC Space PolyLoop Checking Tool Server")
    print(f"  Running at: {url}")
    print("=" * 66)

    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down gracefully.")
        httpd.server_close()


if __name__ == "__main__":
    auto_open = "--no-browser" not in sys.argv
    p = PORT
    for arg in sys.argv[1:]:
        if arg.isdigit():
            p = int(arg)
    run_server(port=p, open_browser=auto_open)
