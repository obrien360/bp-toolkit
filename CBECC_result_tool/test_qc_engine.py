import os
import unittest
from qc_engine import scan_model_folder_for_qc, parse_excel_qc_sheet

class TestQCEngine(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.example_folder = os.path.join(self.base_dir, 'example_project_folder2')
        self.example_wb = os.path.join(self.base_dir, 'CBECC Model Workbook - example2.xlsm')

    def test_scan_folder(self):
        res = scan_model_folder_for_qc(self.example_folder)
        self.assertTrue(res['success'])
        self.assertTrue(res['hasAb1'])
        self.assertTrue(res['hasAp'])
        
        # Test Unmet Hours
        ap_data = res['ap']
        self.assertIn('unmetHours', ap_data)
        self.assertTrue(ap_data['unmetHours']['hasWarning']) # 4 zones > 150 hrs
        self.assertEqual(ap_data['unmetHours']['facility']['heating'], 0.0)
        self.assertEqual(ap_data['unmetHours']['facility']['cooling'], 8760.0)

        # Test Schedules
        self.assertIn('schedules', ap_data)
        light_scheds = ap_data['schedules']['lighting']
        self.assertTrue(len(light_scheds) > 0)
        self.assertTrue(any('LIGHT' in s['scheduleName'] for s in light_scheds))

        # Test Envelope
        env = ap_data['envelope']
        self.assertTrue(len(env['opaqueExterior']) > 0)
        self.assertTrue(len(env['opaqueInterior']) > 0)
        self.assertTrue(len(env['exteriorFenestration']) > 0)

        # Verify reversed was merged in interior
        int_names = [c['construction'].upper() for c in env['opaqueInterior']]
        self.assertNotIn('INTERIOR WALL REVERSED', int_names)
        self.assertIn('INTERIOR WALL', int_names)

        # Test Baseline factor parsing
        ab1_data = res['ab1']
        ab1_env = ab1_data['envelope']
        f_factors = [c['referenceFactor'] for c in ab1_env['opaqueExterior'] if 'F-Factor' in c['referenceFactor']]
        self.assertTrue(len(f_factors) > 0)

        # Test Ventilation
        vents = ap_data['ventilation']
        self.assertTrue(len(vents) > 0)
        mprp = next((v for v in vents if 'MPRP' in v['spaceType']), None)
        self.assertIsNotNone(mprp)
        self.assertEqual(mprp['spaceType'], 'MPRP')
        self.assertGreater(mprp['mechanicalVentCFM'], 300)
        self.assertGreater(mprp['ventPerAreaSimCalculated'], 0.1)

    def test_parse_excel(self):
        wb_data = parse_excel_qc_sheet(self.example_wb)
        self.assertTrue(wb_data['success'])
        cats = wb_data['categories']
        self.assertEqual(len(cats), 6)
        cat_names = [c['category'] for c in cats]
        self.assertIn('Interior Lighting -- ComplianceLtg', cat_names)
        self.assertIn('Water Systems -- General', cat_names)

if __name__ == '__main__':
    unittest.main()
