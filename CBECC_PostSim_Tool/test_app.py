"""
test_app.py - Automated validation test suite for Building Energy Performance Rating Compliance Tool.
"""

import os
import unittest
from parser_engine import (
    scan_directory_for_htm_files,
    extract_compliance_data_from_html,
    KWH_TO_KBTU,
    THERM_TO_KBTU,
    clean_category_name
)

class TestBuildingEnergyCompliance(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.example_dir = os.path.join(self.base_dir, 'example_project_folder')

    def test_directory_scan(self):
        """Test scanning the example project folder finds the 5 target scenario files (ab1-ab4, ap)."""
        results = scan_directory_for_htm_files(self.example_dir)
        self.assertEqual(len(results), 5, f"Expected 5 scenarios, found {len(results)}")
        
        scenario_names = [r['scenarioName'] for r in results]
        self.assertEqual(scenario_names, ['ab1', 'ab2', 'ab3', 'ab4', 'ap'])

    def test_ab1_values_and_conversions(self):
        """Verify extraction and conversion accuracy for ab1 baseline scenario."""
        results = scan_directory_for_htm_files(self.example_dir)
        ab1 = next((r for r in results if r['scenarioName'] == 'ab1'), None)
        self.assertIsNotNone(ab1, "ab1 scenario not found")

        # Find Heating row
        heating = next((c for c in ab1['categories'] if 'Heating' in c['rawCategory']), None)
        self.assertIsNotNone(heating, "Heating category missing in ab1")
        self.assertEqual(heating['electricity']['kWh'], 0.0)
        self.assertEqual(heating['naturalGas']['therm'], 1196.35)
        # Check therm to kBtu conversion: 1196.35 * 100 = 119635.0 kBtu
        self.assertAlmostEqual(heating['naturalGas']['kBtu'], 119635.0, places=1)

        # Find Fans row
        fans = next((c for c in ab1['categories'] if 'Fans' in c['rawCategory']), None)
        self.assertIsNotNone(fans, "Fans category missing in ab1")
        self.assertEqual(fans['electricity']['kWh'], 31713.54)
        # Check kWh to kBtu conversion: 31713.54 * 3.412142 = 108211.1 kBtu
        self.assertAlmostEqual(fans['electricity']['kBtu'], 31713.54 * KWH_TO_KBTU, places=1)

        # Total energy checks
        grand_total_kbtu = ab1['summary']['grandTotal_kBtu']
        self.assertAlmostEqual(grand_total_kbtu, 394400.09, places=1)

    def test_clean_category_name(self):
        """Verify category label cleaner."""
        self.assertEqual(clean_category_name('Heating -- General'), 'Heating')
        self.assertEqual(clean_category_name('Fans -- Interior Fans'), 'Fans (Interior Fans)')
        self.assertEqual(clean_category_name('Exterior Lighting -- Not Subdivided'), 'Exterior Lighting')
        self.assertEqual(clean_category_name('Interior Equipment -- Receptacle'), 'Interior Equipment (Receptacle)')

if __name__ == '__main__':
    unittest.main()
