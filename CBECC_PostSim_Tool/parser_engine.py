"""
parser_engine.py - Core extractor for CBECC / LEED EAp2-4/5 Performance Rating Method Compliance tables.
Now extracts: Electricity Energy Use [kWh], Electricity Demand [W],
              Natural Gas Energy Use [therm], Natural Gas Demand [Btu/h]
Returns data as categoryMap (keyed by rawCategory) so the JS app can look up fixed rows.
"""

import os
import re
import glob
import json
from html.parser import HTMLParser
from typing import List, Dict, Any, Optional

# Energy Conversion Constants
KWH_TO_KBTU  = 3.412142
THERM_TO_KBTU = 100.0
THERM_TO_KWH  = 29.3071
KWH_TO_THERM  = 1.0 / THERM_TO_KWH

# Canonical scenario order: ap first, then baselines
CANONICAL_ORDER = {'ap': 1, 'ab1': 2, 'ab2': 3, 'ab3': 4, 'ab4': 5}


class ComplianceTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables: List[List[List[str]]] = []
        self.curr_table: List[List[str]] = []
        self.curr_row: List[str] = []
        self.curr_cell: List[str] = []

    def handle_starttag(self, tag: str, attrs):
        if tag == 'table':
            self.curr_table = []
        elif tag == 'tr':
            self.curr_row = []
        elif tag in ('td', 'th'):
            self.curr_cell = []

    def handle_data(self, data: str):
        self.curr_cell.append(data)

    def handle_endtag(self, tag: str):
        if tag in ('td', 'th'):
            text = ''.join(self.curr_cell).strip()
            self.curr_row.append(text)
        elif tag == 'tr':
            if self.curr_row:
                self.curr_table.append(self.curr_row)
        elif tag == 'table':
            if self.curr_table and self._is_target_table(self.curr_table):
                self.tables.append(self.curr_table)

    def _is_target_table(self, table: List[List[str]]) -> bool:
        if not table:
            return False
        header_text = ' '.join(table[0])
        if 'Electricity Energy Use [kWh]' in header_text and 'Natural Gas Energy Use [therm]' in header_text:
            return True
        if len(table) > 1:
            two_row_text = ' '.join(table[0] + table[1])
            if 'Electricity Energy Use [kWh]' in two_row_text:
                return True
        return False


def clean_category_name(raw_name: str) -> str:
    """Cleans CBECC raw category name by removing redundant suffixes."""
    if not raw_name:
        return ""
    if " -- " in raw_name:
        prefix, suffix = raw_name.split(" -- ", 1)
        prefix = prefix.strip()
        suffix = suffix.strip()
        if suffix in ("General", "Not Subdivided"):
            return prefix
        return f"{prefix} ({suffix})"
    return raw_name.strip()


def parse_float(val: Any) -> float:
    """Safe float parser removing commas and whitespace."""
    if val is None:
        return 0.0
    s = str(val).replace(',', '').strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def extract_compliance_data_from_html(html_content: str, source_name: str = "") -> Optional[Dict[str, Any]]:
    """Extracts compliance table from raw HTML content.
    Returns a dict with:
      - categories: list of category objects (for testing and list iterations)
      - categoryMap: {rawCategory -> data object} (for fast lookup in UI)
      - summary: aggregate totals
    """
    parser = ComplianceTableParser()
    parser.feed(html_content)

    if not parser.tables:
        return None

    table = parser.tables[0]
    header = table[0]

    # Locate column indices for each of the 4 energy metrics
    elec_energy_idx = -1
    elec_demand_idx = -1
    gas_energy_idx  = -1
    gas_demand_idx  = -1

    for idx, cell in enumerate(header):
        c = cell.lower().strip()
        if 'electricity energy use' in c or ('electricity' in c and '[kwh]' in c and 'demand' not in c):
            elec_energy_idx = idx
        if 'electricity demand' in c or ('electricity' in c and '[w]' in c):
            elec_demand_idx = idx
        if 'natural gas energy use' in c or ('natural gas' in c and '[therm]' in c and 'demand' not in c):
            gas_energy_idx = idx
        if 'natural gas demand' in c or ('natural gas' in c and '[btu/h]' in c):
            gas_demand_idx = idx

    # Fallbacks to standard column positions
    if elec_energy_idx == -1: elec_energy_idx = 1
    if elec_demand_idx == -1: elec_demand_idx = 2
    if gas_energy_idx  == -1: gas_energy_idx  = 3
    if gas_demand_idx  == -1: gas_demand_idx  = 4

    categories = []
    category_map = {}
    total_elec_kwh  = 0.0
    total_gas_therm = 0.0

    for row in table[1:]:
        if not row or not row[0].strip():
            continue
        cat_label  = row[0].strip()
        elec_kwh   = parse_float(row[elec_energy_idx]) if elec_energy_idx < len(row) else 0.0
        elec_dem_w = parse_float(row[elec_demand_idx]) if elec_demand_idx < len(row) else 0.0
        gas_therm  = parse_float(row[gas_energy_idx])  if gas_energy_idx  < len(row) else 0.0
        gas_dem_bh = parse_float(row[gas_demand_idx])  if gas_demand_idx  < len(row) else 0.0

        is_total = 'total' in cat_label.lower()

        if not is_total:
            total_elec_kwh  += elec_kwh
            total_gas_therm += gas_therm

        elec_kbtu  = elec_kwh  * KWH_TO_KBTU
        gas_kbtu   = gas_therm * THERM_TO_KBTU
        total_kbtu = elec_kbtu + gas_kbtu

        cat_data = {
            'rawCategory':   cat_label,
            'cleanCategory': clean_category_name(cat_label),
            'isTotal':       is_total,
            'electricity': {
                'kWh':  round(elec_kwh, 2),
                'kBtu': round(elec_kbtu, 2),
                'W':    round(elec_dem_w, 2),
            },
            'naturalGas': {
                'therm': round(gas_therm, 2),
                'kBtu':  round(gas_kbtu, 2),
                'Btuh':  round(gas_dem_bh, 2),
            },
            'totalEnergy': {
                'kBtu': round(total_kbtu, 2),
            },
            'elecKwh':     round(elec_kwh,   2),
            'elecDemW':    round(elec_dem_w,  2),
            'gasTherm':    round(gas_therm,   2),
            'gasDemBtuh':  round(gas_dem_bh,  2),
            'elecKbtu':    round(elec_kbtu,   2),
            'gasKbtu':     round(gas_kbtu,    2),
            'totalKbtu':   round(total_kbtu,  2),
        }
        categories.append(cat_data)
        category_map[cat_label] = cat_data

    # Summary totals
    total_elec_kbtu  = total_elec_kwh  * KWH_TO_KBTU
    total_gas_kbtu   = total_gas_therm * THERM_TO_KBTU
    grand_total_kbtu = total_elec_kbtu + total_gas_kbtu

    return {
        'sourceName':  source_name,
        'categories':  categories,
        'categoryMap': category_map,
        'summary': {
            'totalElectricity_kWh':      round(total_elec_kwh,   2),
            'totalNaturalGas_therm':     round(total_gas_therm,  2),
            'totalElectricity_kBtu':     round(total_elec_kbtu,  2),
            'totalNaturalGas_kBtu':      round(total_gas_kbtu,   2),
            'grandTotal_kBtu':           round(grand_total_kbtu, 2),
            'electricitySharePercent':   round((total_elec_kbtu / grand_total_kbtu * 100.0), 2) if grand_total_kbtu > 0 else 0.0,
            'naturalGasSharePercent':    round((total_gas_kbtu  / grand_total_kbtu * 100.0), 2) if grand_total_kbtu > 0 else 0.0,
        }
    }


def scan_directory_for_htm_files(directory_path: str) -> List[Dict[str, Any]]:
    """Recursively scans directory for .htm and .html files and parses compliance tables."""
    results = []
    if not os.path.isdir(directory_path):
        return results

    patterns = [
        os.path.join(directory_path, '**', '*.htm'),
        os.path.join(directory_path, '**', '*.html'),
    ]

    found_files = []
    for pattern in patterns:
        found_files.extend(glob.glob(pattern, recursive=True))

    found_files = sorted(list(set(found_files)))

    for file_path in found_files:
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as fp:
                content = fp.read()

            rel_path      = os.path.relpath(file_path, directory_path)
            parent_folder = os.path.basename(os.path.dirname(file_path))
            file_base     = os.path.splitext(os.path.basename(file_path))[0]

            scenario_name = parent_folder if parent_folder and parent_folder not in ('.', '') else file_base
            if parent_folder == os.path.basename(directory_path):
                scenario_name = file_base

            # Filter out zb and zp scenarios
            scenario_lower = scenario_name.lower()
            if scenario_lower.startswith(('zb', 'zp')) or '- zb' in scenario_lower or '- zp' in scenario_lower:
                continue

            parsed = extract_compliance_data_from_html(content, source_name=scenario_name)
            if parsed:
                parsed['filePath']     = file_path
                parsed['relativePath'] = rel_path
                parsed['fileBaseName'] = os.path.basename(file_path)
                parsed['scenarioName'] = scenario_name
                results.append(parsed)
        except Exception as e:
            print(f"Error parsing file {file_path}: {e}")

    # Sort scenarios alphabetically by scenario name (ab1-ab4, then ap)
    results.sort(key=lambda x: x['scenarioName'].lower())

    return results


if __name__ == '__main__':
    # Quick CLI test on example folder
    test_dir = os.path.join(os.path.dirname(__file__), 'example_project_folder')
    print(f"Testing scan on: {test_dir}")
    data = scan_directory_for_htm_files(test_dir)
    print(f"Parsed {len(data)} compliance tables successfully (ap first, then ab1-ab4)!")
    for item in data:
        print(f" - [{item['scenarioName']}] Total kBtu: {item['summary']['grandTotal_kBtu']:,.2f}")
        print(f"   categoryMap keys: {list(item['categoryMap'].keys())[:3]} ...")
