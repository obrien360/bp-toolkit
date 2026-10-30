"""
test_app.py - Automated Unit & Integration Tests for PDF to Clean CAD Tool
Run with: python -m unittest test_app.py -v
"""

import unittest
import os
import shutil
import pymupdf
import cad_engine
from unittest.mock import patch
from cad_engine import (
    detect_pdf_scale,
    inspect_pdf_levels,
    extract_raw_zones,
    rectify_level_zones,
    build_planar_graph,
    process_cad_conversion,
    export_cad_files,
    generate_verification_plot,
    open_pdf_document,
    _annotation_level_name
)

class TestPDFToDWG(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base_dir = os.path.dirname(os.path.abspath(__file__))
        cls.pdf_path = os.path.join(cls.base_dir, "Zoning.pdf")
        cls.test_output_dir = os.path.join(cls.base_dir, "test_output")
        os.makedirs(cls.test_output_dir, exist_ok=True)
        cls.doc = pymupdf.open(cls.pdf_path)

    @classmethod
    def tearDownClass(cls):
        if os.path.exists(cls.test_output_dir):
            shutil.rmtree(cls.test_output_dir)

    def test_01_scale_detection(self):
        """Rule 1.a: Scale detection from PDF Viewport/Measure dict"""
        scale_pts, label, src = detect_pdf_scale(self.doc)
        self.assertAlmostEqual(scale_pts, 9.0, places=2)
        self.assertIn("0.125 in = 1 ft", label)
        self.assertIn("Measure", src)

    def test_02_level_detection(self):
        """Rule 1.b: Discover how many levels are in the drawing"""
        levels, details = inspect_pdf_levels(self.doc)
        self.assertIn("Level 1", levels)
        self.assertIn("Level 2", levels)
        self.assertEqual(details["Level 1"]["count"], 18)
        self.assertEqual(details["Level 2"]["count"], 14)

    def test_arbitrary_layer_name_precedes_author_title(self):
        self.assertEqual(_annotation_level_name("  Wing A  ", "JirehPeng"), "Wing A")
        self.assertEqual(_annotation_level_name("", "Level 2"), "Level 2")
        self.assertEqual(_annotation_level_name("", "JirehPeng"), "Level 1")

    def test_shoebox_levels_and_sequential_snapping(self):
        """Floor OCG names take precedence and each level uses its predecessor's grid."""
        doc = pymupdf.open(os.path.join(self.base_dir, "ShoeboxZoning.pdf"))
        levels, _ = inspect_pdf_levels(doc)
        self.assertEqual(levels, ["Basement", "Level 1", "Level 2", "Level 3", "Level 6", "Roof"])

        observed_clusters = []
        produced_clusters = []
        original_rectify = rectify_level_zones

        def track_cluster_handoff(zones, *args, **kwargs):
            observed_clusters.append(kwargs.get("base_clusters"))
            result = original_rectify(zones, *args, **kwargs)
            produced_clusters.append(result[1])
            return result

        with patch("cad_engine.rectify_level_zones", side_effect=track_cluster_handoff):
            result = process_cad_conversion(
                doc,
                base_level=levels[0],
                conversion_order=levels,
                scale=detect_pdf_scale(doc)[0]
            )

        self.assertEqual(result["conversion_order"], levels)
        self.assertIsNone(observed_clusters[0])
        for index in range(1, len(levels)):
            self.assertEqual(observed_clusters[index], produced_clusters[index - 1])

    def test_selected_snap_bases_determine_processing_order(self):
        levels = ["Basement", "Level 1", "Level 2", "Roof"]
        raw_levels = {level: [level] for level in levels}
        produced_clusters = {level: (level, level) for level in levels}
        observed_bases = {}

        def track_rectify(zones, **kwargs):
            level = zones[0]
            observed_bases[level] = kwargs.get("base_clusters")
            return [], produced_clusters[level]

        empty_graph = {
            "segments": [], "segment_count": 0, "polyloops": [], "polyloop_count": 0,
            "dangling_count": 0, "dangling_points": []
        }
        with patch("cad_engine.extract_raw_zones", return_value=raw_levels), \
             patch("cad_engine.rectify_level_zones", side_effect=track_rectify), \
             patch("cad_engine.build_planar_graph", return_value=empty_graph):
            result = process_cad_conversion(
                None,
                base_level="Basement",
                conversion_order=levels,
                level_bases={"Level 1": "Basement", "Level 2": "Basement", "Roof": "Level 1"},
                spread_order=["Basement", "Roof", "Level 2", "Level 1"]
            )

        self.assertEqual(result["conversion_order"], ["Basement", "Level 2", "Level 1", "Roof"])
        self.assertEqual(result["spread_order"], ["Basement", "Roof", "Level 2", "Level 1"])
        self.assertEqual(observed_bases["Level 1"], produced_clusters["Basement"])
        self.assertEqual(observed_bases["Level 2"], produced_clusters["Basement"])
        self.assertEqual(observed_bases["Roof"], produced_clusters["Level 1"])

    def test_annotation_appearance_transform(self):
        """Annotation vertices include the appearance matrix and placement in CAD coordinates."""
        raw_levels = extract_raw_zones(self.doc, scale=9.0)
        first_zone = raw_levels["Level 1"][0]
        self.assertEqual(first_zone["pts"][0], (330.034, 106.832))
        self.assertEqual(first_zone["pts"][1], (272.254, 101.777))

    def test_03_orthogonal_snapping_and_tolerance(self):
        """Rule 2.b: Lines within +- 5.0 deg are snapped to strictly horizontal or vertical"""
        raw_levels = extract_raw_zones(self.doc, scale=9.0)
        l1_clean, (cx, cy) = rectify_level_zones(raw_levels["Level 1"], tol_deg=5.15)
        self.assertEqual(len(l1_clean), 18)
        
        # Verify all polygon edges are purely horizontal (dy=0) or vertical (dx=0)
        for z in l1_clean:
            pts = z['pts']
            for i in range(len(pts)):
                p1 = pts[i]
                p2 = pts[(i+1)%len(pts)]
                dx = abs(p2[0] - p1[0])
                dy = abs(p2[1] - p1[1])
                # Either dx is near 0 or dy is near 0
                is_ortho = (dx < 1e-2) or (dy < 1e-2)
                self.assertTrue(is_ortho, f"Edge {p1}->{p2} in {z['name']} is not strictly orthogonal")

    def test_04_shared_wall_deduplication(self):
        """Rule 2.a: Do not draw two lines when close (shared wall -> single line)"""
        raw_levels = extract_raw_zones(self.doc, scale=9.0)
        l1_clean, _ = rectify_level_zones(raw_levels["Level 1"], tol_deg=5.15)
        graph = build_planar_graph(l1_clean)
        
        # Deduplicated segments should exist without duplicate bidirectional entries
        seg_set = set()
        for p1, p2 in graph['segments']:
            key = tuple(sorted([p1, p2]))
            self.assertNotIn(key, seg_set, f"Duplicate wall detected: {p1} <-> {p2}")
            seg_set.add(key)

    def test_05_zero_open_endpoints(self):
        """Rule 2.c: No open end lines (0 dangling endpoints) to prevent polyloop error"""
        raw_levels = extract_raw_zones(self.doc, scale=9.0)
        l1_clean, _ = rectify_level_zones(raw_levels["Level 1"], tol_deg=5.15)
        graph = build_planar_graph(l1_clean)
        self.assertEqual(graph['dangling_count'], 0, f"Expected 0 dangling endpoints, found {graph['dangling_count']}")
        self.assertGreaterEqual(graph['polyloop_count'], 18)

    def test_06_base_level_overlay_alignment(self):
        """Rule 2.e & 2.f: Convert base level first, next level perfectly overlays coincident walls"""
        result = process_cad_conversion(
            self.doc,
            base_level="Level 1",
            conversion_order=["Level 1", "Level 2"],
            scale=9.0,
            tol_deg=5.15
        )
        l2 = result['levels']['Level 2']
        self.assertIsNotNone(l2.get('overlay_stats'))
        # High percentage of Level 2 perimeter/core walls should match Level 1 exactly
        match_pct = l2['overlay_stats']['match_percentage']
        self.assertGreater(match_pct, 30.0)
        self.assertEqual(l2['planar_graph']['dangling_count'], 0)

    def test_07_export_dwg_spread_out_and_aligned(self):
        """Rule 4: Export spread-out levels at the requested absolute spacing in feet."""
        result = process_cad_conversion(
            self.doc,
            base_level="Level 1",
            conversion_order=["Level 1", "Level 2"],
            scale=9.0
        )
        files = export_cad_files(
            result,
            output_dir=self.test_output_dir,
            file_prefix="Test_Zoning",
            layout_mode="both",
            spacing_ft=400.0
        )
        self.assertEqual(len(files), 2)
        
        spread_file = next(f for f in files if f['mode'] == 'spread')
        aligned_file = next(f for f in files if f['mode'] == 'aligned')
        
        self.assertTrue(os.path.exists(spread_file['dxf_path']))
        self.assertTrue(os.path.exists(spread_file['dwg_path']))
        self.assertTrue(os.path.exists(aligned_file['dxf_path']))
        self.assertTrue(os.path.exists(aligned_file['dwg_path']))
        
        self.assertGreater(os.path.getsize(spread_file['dxf_path']), 1000)
        self.assertGreater(os.path.getsize(spread_file['dwg_path']), 1000)

        import ezdxf
        spread_doc = ezdxf.readfile(spread_file['dxf_path'])
        aligned_doc = ezdxf.readfile(aligned_file['dxf_path'])
        spread_level_two = next(entity for entity in spread_doc.modelspace() if entity.dxftype() == 'LINE' and entity.dxf.layer == 'LEVEL_2')
        aligned_level_two = next(entity for entity in aligned_doc.modelspace() if entity.dxftype() == 'LINE' and entity.dxf.layer == 'LEVEL_2')
        self.assertAlmostEqual(spread_level_two.dxf.start.x - aligned_level_two.dxf.start.x, 400.0)

    def test_08_verification_plot_generation(self):
        """Rule 3: Multi-level visual verification plot export"""
        result = process_cad_conversion(
            self.doc,
            base_level="Level 1",
            conversion_order=["Level 1", "Level 2"],
            scale=9.0
        )
        plot_path = os.path.join(self.test_output_dir, "Test_Verification.png")
        generate_verification_plot(result, plot_path)
        self.assertTrue(os.path.exists(plot_path))
        self.assertGreater(os.path.getsize(plot_path), 50000)

    def test_09_server_api_endpoints(self):
        """Verify server API endpoints (load-example, convert, export)"""
        import socketserver
        import threading
        import urllib.request
        import json
        from server import CADToolHandler

        test_port = 8995
        httpd = socketserver.TCPServer(("", test_port), CADToolHandler)
        server_thread = threading.Thread(target=httpd.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        try:
            # 1. Test /api/load-example
            req = urllib.request.urlopen(f"http://localhost:{test_port}/api/load-example")
            self.assertEqual(req.status, 200)
            data = json.loads(req.read().decode('utf-8'))
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["filename"], "Zoning.pdf")
            self.assertEqual(len(data["levels"]), 2)

            # 2. Test /api/convert
            convert_payload = json.dumps({
                "base_level": "Level 1",
                "conversion_order": ["Level 1", "Level 2"],
                "scale": 9.0,
                "tol_deg": 5.0,
                "cluster_tol": 2.0,
                "spacing_ft": 500.0
            }).encode('utf-8')
            req2 = urllib.request.Request(
                f"http://localhost:{test_port}/api/convert",
                data=convert_payload,
                headers={"Content-Type": "application/json"}
            )
            resp2 = urllib.request.urlopen(req2)
            self.assertEqual(resp2.status, 200)
            data2 = json.loads(resp2.read().decode('utf-8'))
            self.assertEqual(data2["status"], "success")
            self.assertEqual(data2["spacing_ft"], 500.0)
            self.assertIn("Level 1", data2["levels"])
            self.assertIn("Level 2", data2["levels"])
            self.assertEqual(data2["levels"]["Level 1"]["planar_graph"]["dangling_count"], 0)

            # 3. Test /api/export
            export_payload = json.dumps({
                "spacing_ft": 500.0,
                "layout_mode": "both",
                "file_prefix": "APITest_Zoning"
            }).encode('utf-8')
            req3 = urllib.request.Request(
                f"http://localhost:{test_port}/api/export",
                data=export_payload,
                headers={"Content-Type": "application/json"}
            )
            resp3 = urllib.request.urlopen(req3)
            self.assertEqual(resp3.status, 200)
            data3 = json.loads(resp3.read().decode('utf-8'))
            self.assertEqual(data3["status"], "success")
            self.assertGreaterEqual(len(data3["files"]), 2)

            # 4. Test download endpoint
            download_url = f"http://localhost:{test_port}{data3['files'][0]['dxf_url']}"
            req_dl = urllib.request.urlopen(download_url)
            self.assertEqual(req_dl.status, 200)
            content = req_dl.read()
            self.assertGreater(len(content), 1000)

        finally:
            httpd.shutdown()
            httpd.server_close()

if __name__ == '__main__':
    unittest.main()
