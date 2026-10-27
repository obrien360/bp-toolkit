"""
test_reports_engine.py - Unit and Integration Tests for Reports Engine
"""

import unittest
import os
import reports_engine


class TestReportsEngine(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.sample_folder_2 = os.path.join(self.base_dir, 'example_project_folder2')
        self.sample_folder_1 = os.path.join(self.base_dir, 'example_project_folder')

    def test_orientation_calculation(self):
        # Roof / Floor / Skylight are Horizontal
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Roof', 180), 'Horizontal')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Floor', 90), 'Horizontal')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Underground Floor', 270), 'Horizontal')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Interior Floor', 0), 'Horizontal')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Skylight', 45), 'Horizontal')

        # 8 Compass Orientations for Walls & Fenestration
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 0), 'North')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 350), 'North')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 10), 'North')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 45), 'Northeast')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 90), 'East')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 135), 'Southeast')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 180), 'South')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 225), 'Southwest')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 270), 'West')
        self.assertEqual(reports_engine.get_orientation_from_azimuth('Exterior Wall', 315), 'Northwest')

    def test_status_normalization(self):
        self.assertEqual(reports_engine.normalize_status('New'), 'New')
        self.assertEqual(reports_engine.normalize_status('Existing'), 'Ex. Remain')
        self.assertEqual(reports_engine.normalize_status('Existing to Remain'), 'Ex. Remain')
        self.assertEqual(reports_engine.normalize_status('Altered'), 'Retrofitted')
        self.assertEqual(reports_engine.normalize_status('Retrofitted'), 'Retrofitted')

    def test_scan_folder_example2(self):
        res = reports_engine.scan_folder_for_leed_summary(self.sample_folder_2)
        self.assertTrue(res['success'])
        self.assertEqual(res['fileName'], '2527_Shoebox MDL - ap - LEEDSummary.csv')
        
        # Check Big Table 1 counts
        self.assertEqual(res['counts']['opaqueSurfaces'], 518)
        self.assertEqual(res['counts']['fenSurfaces'], 99)
        
        # Verify Table 1 structure
        self.assertGreater(len(res['table1']), 0)
        t1_first = res['table1'][0]
        self.assertIn('modeledConstructionName', t1_first)
        self.assertIn('status', t1_first)
        self.assertIn('bdlgAreaType', t1_first)
        self.assertIn('orientation', t1_first)
        self.assertIn('conditioningCategory', t1_first)
        self.assertIn('netArea', t1_first)
        
        # Verify Table 2 structure
        self.assertGreater(len(res['table2']), 0)
        t2_first = res['table2'][0]
        self.assertIn('modeledFenestrationName', t2_first)
        self.assertIn('status', t2_first)
        self.assertIn('bdlgAreaType', t2_first)
        self.assertIn('orientation', t2_first)
        self.assertIn('conditioningCategory', t2_first)
        self.assertIn('netArea', t2_first)

    def test_scan_folder_example1(self):
        res = reports_engine.scan_folder_for_leed_summary(self.sample_folder_1)
        self.assertTrue(res['success'])
        self.assertEqual(res['fileName'], '1574_GLBH_S901G_CBECC2025 - ap - LEEDSummary.csv')
        self.assertEqual(res['counts']['opaqueSurfaces'], 159)
        self.assertEqual(res['counts']['fenSurfaces'], 54)


if __name__ == '__main__':
    unittest.main()
