"""
test_app.py
===========
Unit tests for CBECC PolyLoop Fixer engine.
Part of O'Brien360 Tools Suite.
"""

import unittest
import os
from polyloop_engine import CBECCModel, GeometryEngine, PolyLoopInjector


class TestCBECCPolyLoopEngine(unittest.TestCase):

    def setUp(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.shoebox_path = os.path.join(self.base_dir, "Shoebox MDL.cibd19")

    def test_parse_real_shoebox_file(self):
        """
        Verify that Shoebox MDL.cibd19 is correctly parsed:
        - 83 total spaces
        - L02-201_OfceRaccPthpHrv3 is correctly identified as missing because its PolyLoop 175 has 0 coords (< 3)
        - L02-201_OfceRaccPthpHrv3 has can_reuse_poly_name = True and existing_poly_name = 'PolyLoop 175'
        """
        with open(self.shoebox_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        model = CBECCModel(content, "Shoebox MDL.cibd19")
        self.assertEqual(len(model.spaces), 83)

        missing_names = [s["name"] for s in model.missing_spaces]
        self.assertIn("L02-201_OfceRaccPthpHrv3", missing_names)

        l02_spc = next(s for s in model.missing_spaces if s["name"] == "L02-201_OfceRaccPthpHrv3")
        self.assertTrue(l02_spc["can_reuse_poly_name"])
        self.assertEqual(l02_spc["existing_poly_name"], "PolyLoop 175")
        self.assertEqual(l02_spc["existing_coords_count"], 0)

        # Confirm spaces with valid >= 3 points are among valid spaces
        valid_names = [s["name"] for s in model.valid_spaces]
        self.assertIn("B01-001_MechRaccBbrd", valid_names)
        self.assertIn("L01-107_ComlComlSphp", valid_names)
        self.assertIn("L01-114_CorrRaccBbrdHrv2", valid_names)

    def test_floor_union_l02_201(self):
        """Test unioning child floors of L02-201_OfceRaccPthpHrv3."""
        with open(self.shoebox_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        model = CBECCModel(content)
        spc = next(s for s in model.missing_spaces if s["name"] == "L02-201_OfceRaccPthpHrv3")
        self.assertEqual(len(spc["floors"]), 4)

        result = GeometryEngine.combine_floors(spc["floors"], simplify_tol=0.01)
        self.assertTrue(result["success"])
        self.assertEqual(result["vertex_count"], 4)
        self.assertAlmostEqual(result["area"], 641.2, delta=0.1)
        self.assertAlmostEqual(result["z"], 16.0, delta=0.01)

    def test_reuse_existing_polyloop_name_on_injection(self):
        """
        Verify that fixing L02-201 reuses its existing name 'PolyLoop 175'
        instead of generating a new number.
        """
        with open(self.shoebox_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        model = CBECCModel(content)
        l02_spc = next(s for s in model.missing_spaces if s["name"] == "L02-201_OfceRaccPthpHrv3")

        res = GeometryEngine.combine_floors(l02_spc["floors"], simplify_tol=0.01)
        self.assertTrue(res["success"])

        fixes = {l02_spc["name"]: res["vertices"]}
        meta_map = {
            l02_spc["name"]: {
                "can_reuse_poly_name": l02_spc["can_reuse_poly_name"],
                "existing_poly_name": l02_spc["existing_poly_name"]
            }
        }

        repaired_content, summary = PolyLoopInjector.inject_fixes(
            original_content=content,
            fixes=fixes,
            start_poly_id=model.max_polyloop_id + 1,
            start_cart_id=model.max_cartesian_id + 1,
            space_meta_map=meta_map
        )

        self.assertEqual(summary["fixed_count"], 1)
        fix_info = summary["applied_fixes"][l02_spc["name"]]
        # Must reuse the existing name
        self.assertEqual(fix_info["polyloop_name"], "PolyLoop 175")
        self.assertTrue(fix_info["reused_name"])

        # Re-parse repaired content: verify L02-201 is now valid
        repaired_model = CBECCModel(repaired_content)
        repaired_missing_names = [s["name"] for s in repaired_model.missing_spaces]
        self.assertNotIn("L02-201_OfceRaccPthpHrv3", repaired_missing_names)

        fixed_spc = next(s for s in repaired_model.valid_spaces if s["name"] == "L02-201_OfceRaccPthpHrv3")
        self.assertEqual(fixed_spc["existing_poly_name"], "PolyLoop 175")
        self.assertEqual(len(fixed_spc["existing_coords"]), 4)

    def test_area_mismatch_detection(self):
        """
        Verify that spaces with existing PolyLp area differing >5% from
        the union of their child floors are detected as area_mismatch.
        """
        with open(self.shoebox_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        model = CBECCModel(content)
        mismatch_spaces = [s for s in model.spaces if s.get("area_mismatch")]
        mismatch_names = [s["name"] for s in mismatch_spaces]

        self.assertEqual(len(mismatch_spaces), 4)
        expected_mismatches = [
            "L02-200_CorrRaccSphp",
            "L02-213_MfamResiPthp",
            "L02-216_StrsRaccIncd",
            "L02-217_MfamResiPthp"
        ]
        for name in expected_mismatches:
            self.assertIn(name, mismatch_names)

        # Missing spaces include the 2 purely missing/incomplete + 4 area mismatches = 6 total
        self.assertEqual(len(model.missing_spaces), 6)
        self.assertEqual(len(model.valid_spaces), 77)

    def test_area_mismatch_replacement_in_place(self):
        """
        Verify that fixing an area-mismatch space replaces coordinates in-place
        while preserving the existing PolyLoop name.
        """
        with open(self.shoebox_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        model = CBECCModel(content)
        spc = next(s for s in model.spaces if s["name"] == "L02-200_CorrRaccSphp")
        self.assertTrue(spc["area_mismatch"])
        orig_name = spc["existing_poly_name"]

        res = GeometryEngine.combine_floors(spc["floors"])
        self.assertTrue(res["success"])

        fixes = {spc["name"]: res["vertices"]}
        meta_map = {
            spc["name"]: {
                "can_reuse_poly_name": True,
                "existing_poly_name": orig_name
            }
        }

        repaired_content, summary = PolyLoopInjector.inject_fixes(
            original_content=content,
            fixes=fixes,
            start_poly_id=model.max_polyloop_id + 1,
            start_cart_id=model.max_cartesian_id + 1,
            space_meta_map=meta_map
        )

        repaired_model = CBECCModel(repaired_content)
        fixed_spc = next(s for s in repaired_model.spaces if s["name"] == "L02-200_CorrRaccSphp")
        self.assertFalse(fixed_spc["area_mismatch"])
        self.assertEqual(fixed_spc["existing_poly_name"], orig_name)

    def test_batch_apply_all_fixes(self):
        """
        Verify batch repair across all 6 missing and mismatched spaces.
        After repair, 0 missing spaces remain and all 83 are valid.
        """
        with open(self.shoebox_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        model = CBECCModel(content)
        self.assertEqual(len(model.missing_spaces), 6)

        fixes = {}
        meta_map = {}
        for spc in model.missing_spaces:
            geom = GeometryEngine.combine_floors(spc["floors"])
            self.assertTrue(geom["success"], f"Failed to union floors for {spc['name']}")
            fixes[spc["name"]] = geom["vertices"]
            meta_map[spc["name"]] = {
                "can_reuse_poly_name": spc.get("can_reuse_poly_name", False) or spc.get("area_mismatch", False),
                "existing_poly_name": spc.get("existing_poly_name")
            }

        repaired_content, summary = PolyLoopInjector.inject_fixes(
            original_content=content,
            fixes=fixes,
            start_poly_id=model.max_polyloop_id + 1,
            start_cart_id=model.max_cartesian_id + 1,
            space_meta_map=meta_map
        )

        self.assertEqual(summary["fixed_count"], 6)

        repaired_model = CBECCModel(repaired_content)
        self.assertEqual(len(repaired_model.missing_spaces), 0)
        self.assertEqual(len(repaired_model.valid_spaces), 83)

    def test_server_api_endpoints(self):
        """Verify REST API server endpoints (status, samples, load-sample, recalculate, apply-fix)."""
        import socketserver
        import threading
        import urllib.request
        import json
        from server import PolyLoopRequestHandler

        test_port = 8996
        httpd = socketserver.TCPServer(("127.0.0.1", test_port), PolyLoopRequestHandler)
        server_thread = threading.Thread(target=httpd.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        try:
            # 1. GET /api/status
            req = urllib.request.urlopen(f"http://127.0.0.1:{test_port}/api/status")
            self.assertEqual(req.status, 200)
            status_data = json.loads(req.read().decode("utf-8"))
            self.assertTrue(status_data["running"])

            # 2. GET /api/samples
            req_samples = urllib.request.urlopen(f"http://127.0.0.1:{test_port}/api/samples")
            self.assertEqual(req_samples.status, 200)
            samples_data = json.loads(req_samples.read().decode("utf-8"))
            self.assertTrue(samples_data["success"])
            sample_names = [s["name"] for s in samples_data["samples"]]
            self.assertIn("Shoebox MDL.cibd19", sample_names)

            # 3. POST /api/load-sample
            load_body = json.dumps({"filename": "Shoebox MDL.cibd19"}).encode("utf-8")
            req_load = urllib.request.Request(
                f"http://127.0.0.1:{test_port}/api/load-sample",
                data=load_body,
                headers={"Content-Type": "application/json"}
            )
            resp_load = urllib.request.urlopen(req_load)
            self.assertEqual(resp_load.status, 200)
            load_res = json.loads(resp_load.read().decode("utf-8"))
            self.assertTrue(load_res["success"])
            self.assertEqual(load_res["total_spaces"], 83)
            self.assertEqual(load_res["missing_count"], 6)

            # 4. POST /api/recalculate-space
            recalc_body = json.dumps({
                "space_name": "L02-201_OfceRaccPthpHrv3",
                "simplify_tol": 0.01,
                "snap_tol": 0.05
            }).encode("utf-8")
            req_recalc = urllib.request.Request(
                f"http://127.0.0.1:{test_port}/api/recalculate-space",
                data=recalc_body,
                headers={"Content-Type": "application/json"}
            )
            resp_recalc = urllib.request.urlopen(req_recalc)
            self.assertEqual(resp_recalc.status, 200)
            recalc_res = json.loads(resp_recalc.read().decode("utf-8"))
            self.assertTrue(recalc_res["success"])
            self.assertEqual(recalc_res["result"]["vertex_count"], 4)

            # 5. POST /api/apply-fix-all
            req_fix_all = urllib.request.Request(
                f"http://127.0.0.1:{test_port}/api/apply-fix-all",
                data=b"{}",
                headers={"Content-Type": "application/json"}
            )
            resp_fix_all = urllib.request.urlopen(req_fix_all)
            self.assertEqual(resp_fix_all.status, 200)
            fix_all_res = json.loads(resp_fix_all.read().decode("utf-8"))
            self.assertTrue(fix_all_res["success"])
            self.assertEqual(fix_all_res["fixed_count"], 6)

            # 6. GET /api/download
            req_dl = urllib.request.urlopen(f"http://127.0.0.1:{test_port}/api/download")
            self.assertEqual(req_dl.status, 200)
            dl_content = req_dl.read().decode("utf-8")
            self.assertGreater(len(dl_content), 100000)

        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
