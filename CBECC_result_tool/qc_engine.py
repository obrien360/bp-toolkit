"""
qc_engine.py - Model Quality Control (QC) Extractor for CBECC-Com / EnergyPlus
Extracts and cross-compares:
  1. Time Setpoint Not Met (Unmet Hours)
  2. Energy & Water Comparisons vs CBECC Model Workbook QC tab
  3. Schedules Equivalent Full Load Hours (Lighting & Receptacle)
  4. Opaque Exterior, Opaque Interior, Exterior Fenestration vs .ibd-Detail ConsAssm/FenCons
  5. Minimum Outdoor Air Mechanical Ventilation vs .ibd-Detail ThrmlZn
"""

import os
import re
import glob
from typing import Dict, Any, List, Optional
def parse_float(val: Any) -> float:
    if val is None:
        return 0.0
    s = str(val).replace(',', '').strip()
    try:
        return float(s)
    except ValueError:
        return 0.0

def extract_baseline_factor(name: str) -> str:
    """Extracts F-Factor, C-Factor, or U-Factor encoded in baseline construction names.
    Examples:
      SlabOnOrBelowGradeF073 -> F-Factor: 0.73
      WallBelowGradeC1140    -> C-Factor: 1.14
      WallSteelFramedU124    -> U-Factor: 0.124
      RoofInsulationEntirelyAboveDeckU063 -> U-Factor: 0.063
    """
    m = re.search(r'([FCU])(\d+)', name, re.IGNORECASE)
    if not m:
        return ""
    kind, num_str = m.group(1).upper(), m.group(2)
    val = parse_float(num_str)
    if kind == 'F':
        formatted = f"{val / 100:.2f}".rstrip('0').rstrip('.')
        return f"F-Factor: {formatted}"
    elif kind == 'C':
        formatted = f"{val / 1000:.3f}".rstrip('0').rstrip('.')
        return f"C-Factor: {formatted}"
    elif kind == 'U':
        formatted = f"{val / 1000:.3f}".rstrip('0').rstrip('.')
        return f"U-Factor: {formatted}"
    return ""

def parse_ibd_detail_file(file_path: str) -> Dict[str, Dict[str, Any]]:
    """Parses a CBECC .ibd-Detail file into structured components.
    Components are formatted as:
      CompType   User: "ComponentName"
         PropName = RVal: Value
         ..
    Returns dict: { comp_type -> { lowercase_name -> { 'name': original_name, 'props': { ... } } } }
    """
    if not os.path.exists(file_path):
        return {}

    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    comp_pattern = re.compile(
        r'^([A-Za-z0-9_]+)\s+User:\s*"([^"]+)"\s*\n(.*?)(?=^\s*\.\.)',
        re.MULTILINE | re.DOTALL
    )

    components: Dict[str, Dict[str, Any]] = {}
    for match in comp_pattern.finditer(content):
        c_type = match.group(1)
        c_name = match.group(2)
        body = match.group(3)
        if c_type not in components:
            components[c_type] = {}

        props: Dict[str, str] = {}
        for line in body.splitlines():
            line_str = line.strip()
            if not line_str or line_str.startswith(';'):
                continue
            prop_m = re.match(r'^([A-Za-z0-9_\[\]]+)\s*=\s*(?:[A-Za-z]+:\s*)?(.*)$', line_str)
            if prop_m:
                p_key = prop_m.group(1)
                p_val_raw = prop_m.group(2).strip()
                str_m = re.match(r'^"([^"]*)"', p_val_raw)
                if str_m:
                    p_val = str_m.group(1)
                else:
                    num_m = re.match(r'^([+-]?[0-9]+(?:\.[0-9]+)?)', p_val_raw)
                    if num_m:
                        p_val = num_m.group(1)
                    else:
                        p_val = p_val_raw
                props[p_key] = p_val

        components[c_type][c_name.strip().lower()] = {
            'name': c_name.strip(),
            'props': props
        }

    return components

def find_table_by_fullname(html_content: str, fullname_marker: str) -> Optional[List[List[str]]]:
    idx = html_content.find(fullname_marker)
    if idx == -1:
        return None
    tbl_start = html_content.find('<table', idx)
    if tbl_start == -1:
        return None
    tbl_end = html_content.find('</table>', tbl_start)
    if tbl_end == -1:
        return None
    tbl_html = html_content[tbl_start:tbl_end + 8]
    soup = BeautifulSoup(tbl_html, 'html.parser')
    rows = []
    for r in soup.find_all('tr'):
        cells = [c.get_text(strip=True) for c in r.find_all(['td', 'th'])]
        rows.append(cells)
    return rows

def parse_qc_from_htm(html_content: str, scenario: str, ibd_components: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Parses all required QC tables from an EnergyPlus .htm report."""

    # -------------------------------------------------------------
    # 1. Time Setpoint Not Met
    # -------------------------------------------------------------
    unmet_rows = find_table_by_fullname(html_content, 'FullName:System Summary_Entire Facility_Time Setpoint Not Met')
    zones_unmet = []
    facility_unmet = {'heating': 0.0, 'cooling': 0.0, 'exceeds150': False}
    has_unmet_warning = False

    if unmet_rows and len(unmet_rows) > 1:
        for r in unmet_rows[1:]:
            if not r or not r[0]:
                continue
            z_name = r[0].strip()
            # Col 4 is index 3: During Occupied Heating [hr]
            # Col 5 is index 4: During Occupied Cooling [hr]
            heat_hr = parse_float(r[3]) if len(r) > 3 else 0.0
            cool_hr = parse_float(r[4]) if len(r) > 4 else 0.0

            if z_name.lower() == 'facility':
                facility_unmet = {
                    'heating': round(heat_hr, 2),
                    'cooling': round(cool_hr, 2),
                    'exceeds150': (heat_hr > 150.0 or cool_hr > 150.0)
                }
                continue

            exceeds_150 = (heat_hr > 150.0 or cool_hr > 150.0)
            exceeds_0   = (heat_hr > 0.0 or cool_hr > 0.0)
            if exceeds_150:
                has_unmet_warning = True

            zones_unmet.append({
                'zone': z_name,
                'heatingHours': round(heat_hr, 2),
                'coolingHours': round(cool_hr, 2),
                'exceeds150': exceeds_150,
                'exceeds0': exceeds_0
            })

    # -------------------------------------------------------------
    # 2. Performance Rating Method Compliance & End Uses
    # -------------------------------------------------------------
    compliance_rows = find_table_by_fullname(html_content, 'FullName:LEED Summary_Entire Facility_EAp2-4/5. Performance Rating Method Compliance')
    compliance_map = {}
    if compliance_rows and len(compliance_rows) > 1:
        for r in compliance_rows[1:]:
            if not r or not r[0]:
                continue
            cat = r[0].strip()
            elec_kwh = parse_float(r[1]) if len(r) > 1 else 0.0
            gas_therm = parse_float(r[3]) if len(r) > 3 else 0.0
            compliance_map[cat] = {
                'electricity_kWh': round(elec_kwh, 2),
                'naturalGas_therm': round(gas_therm, 2)
            }

    end_uses_rows = find_table_by_fullname(html_content, 'FullName:Annual Building Utility Performance Summary_Entire Facility_End Uses')
    end_uses_map = {}
    if end_uses_rows and len(end_uses_rows) > 1:
        for r in end_uses_rows[1:]:
            if not r or not r[0]:
                continue
            cat = r[0].strip()
            # Water [gal] is last column
            water_gal = parse_float(r[-1]) if len(r) > 1 else 0.0
            end_uses_map[cat] = {
                'water_gal': round(water_gal, 2)
            }

    # Schedules Equivalent Full Load Hours
    sched_rows = find_table_by_fullname(html_content, 'FullName:LEED Summary_Entire Facility_Schedules-Equivalent Full Load Hours')
    light_schedules = []
    receptacle_schedules = []
    if sched_rows and len(sched_rows) > 1:
        for r in sched_rows[1:]:
            if not r or not r[0]:
                continue
            s_name = r[0].strip()
            eflh = parse_float(r[1]) if len(r) > 1 else 0.0
            item = {'scheduleName': s_name, 'eflh': round(eflh, 2)}
            if 'LIGHT' in s_name.upper():
                light_schedules.append(item)
            if 'RECEPTACLE' in s_name.upper():
                receptacle_schedules.append(item)

    # -------------------------------------------------------------
    # 3. Envelope Constructions
    # -------------------------------------------------------------
    cons_assm_dict = ibd_components.get('ConsAssm', {})
    fen_cons_dict  = ibd_components.get('FenCons', {})

    # Helper to get CBECC ConsAssm factor
    def get_cbecc_cons_ref(raw_cons_name: str) -> str:
        key = raw_cons_name.lower()
        if key in cons_assm_dict:
            c_data = cons_assm_dict[key]
            props = c_data.get('props', {})
            factors = []
            if 'UFactor' in props and parse_float(props['UFactor']) > 0:
                factors.append(f"U-Factor: {round(parse_float(props['UFactor']), 4)}")
            if 'CFactor' in props and parse_float(props['CFactor']) > 0:
                factors.append(f"C-Factor: {round(parse_float(props['CFactor']), 4)}")
            if 'FFactor' in props and parse_float(props['FFactor']) > 0:
                factors.append(f"F-Factor: {round(parse_float(props['FFactor']), 4)}")
            return ', '.join(factors) if factors else 'Found in CBECC'
        return 'Not in CBECC'

    # A. Opaque Exterior
    ext_rows = find_table_by_fullname(html_content, 'FullName:Envelope Summary_Entire Facility_Opaque Exterior')
    opaque_exterior_map = {}
    if ext_rows and len(ext_rows) > 1:
        for r in ext_rows[1:]:
            if not r or len(r) < 9:
                continue
            surface = r[0].strip()
            raw_cons = r[1].strip()
            # Exclude surface name if present in construction name
            clean_cons = raw_cons
            if clean_cons.upper().startswith(surface.upper()):
                clean_cons = clean_cons[len(surface):].strip()

            u_film = parse_float(r[5])
            u_nofilm = parse_float(r[6])
            net_area = parse_float(r[8])

            cons_key = clean_cons.upper()
            if cons_key not in opaque_exterior_map:
                opaque_exterior_map[cons_key] = {
                    'construction': clean_cons,
                    'uFactorWithFilm': u_film,
                    'uFactorNoFilm': u_nofilm,
                    'netArea': 0.0,
                    'referenceFactor': ''
                }
            opaque_exterior_map[cons_key]['netArea'] += net_area

    for key, item in opaque_exterior_map.items():
        item['netArea'] = round(item['netArea'], 2)
        if scenario == 'ap':
            # Find in CBECC ConsAssm
            ref_name = item['construction']
            # Match case-insensitively
            cbecc_match = cons_assm_dict.get(ref_name.lower())
            if cbecc_match:
                item['construction'] = cbecc_match['name']
                item['referenceFactor'] = get_cbecc_cons_ref(ref_name)
            else:
                item['referenceFactor'] = 'Not in CBECC'
        else:
            item['referenceFactor'] = extract_baseline_factor(item['construction'])

    opaque_exterior_list = list(opaque_exterior_map.values())

    # B. Opaque Interior
    int_rows = find_table_by_fullname(html_content, 'FullName:Envelope Summary_Entire Facility_Opaque Interior')
    opaque_interior_map = {}
    if int_rows and len(int_rows) > 1:
        for r in int_rows[1:]:
            if not r or len(r) < 9:
                continue
            surface = r[0].strip()
            raw_cons = r[1].strip()
            clean_cons = raw_cons
            if clean_cons.upper().startswith(surface.upper()):
                clean_cons = clean_cons[len(surface):].strip()

            # Merge 'REVERSED' into base construction name per user instruction
            if clean_cons.upper().endswith(' REVERSED'):
                clean_cons = clean_cons[:-9].strip()

            u_film = parse_float(r[6])
            u_nofilm = parse_float(r[7])
            net_area = parse_float(r[9]) if len(r) > 9 else parse_float(r[8])

            cons_key = clean_cons.upper()
            if cons_key not in opaque_interior_map:
                opaque_interior_map[cons_key] = {
                    'construction': clean_cons,
                    'uFactorWithFilm': u_film,
                    'uFactorNoFilm': u_nofilm,
                    'netArea': 0.0,
                    'referenceFactor': ''
                }
            opaque_interior_map[cons_key]['netArea'] += net_area

    for key, item in opaque_interior_map.items():
        item['netArea'] = round(item['netArea'], 2)
        if scenario == 'ap':
            ref_name = item['construction']
            cbecc_match = cons_assm_dict.get(ref_name.lower())
            if cbecc_match:
                item['construction'] = cbecc_match['name']
                item['referenceFactor'] = get_cbecc_cons_ref(ref_name)
            else:
                item['referenceFactor'] = 'Not in CBECC'
        else:
            item['referenceFactor'] = extract_baseline_factor(item['construction'])

    opaque_interior_list = list(opaque_interior_map.values())

    # C. Exterior Fenestration
    fen_rows = find_table_by_fullname(html_content, 'FullName:Envelope Summary_Entire Facility_Exterior Fenestration')
    fenestration_map = {}
    if fen_rows and len(fen_rows) > 1:
        for r in fen_rows[1:]:
            if not r or len(r) < 13:
                continue
            raw_cons = r[1].strip()
            if not raw_cons:
                continue
            area = parse_float(r[8])
            glass_u = parse_float(r[10])
            glass_shgc = parse_float(r[11])
            glass_vt = parse_float(r[12])

            cons_key = raw_cons.upper()
            if cons_key not in fenestration_map:
                fenestration_map[cons_key] = {
                    'construction': raw_cons,
                    'glassUFactor': glass_u,
                    'glassSHGC': glass_shgc,
                    'glassVT': glass_vt,
                    'totalArea': 0.0,
                    'referenceUFactor': '',
                    'referenceSHGC': '',
                    'referenceVT': ''
                }
            fenestration_map[cons_key]['totalArea'] += area

    for key, item in fenestration_map.items():
        item['totalArea'] = round(item['totalArea'], 2)
        # Find in CBECC FenCons
        ref_name = item['construction']
        cbecc_match = fen_cons_dict.get(ref_name.lower())
        if cbecc_match:
            item['construction'] = cbecc_match['name']
            p = cbecc_match.get('props', {})
            item['referenceUFactor'] = str(round(parse_float(p.get('UFactor', 0)), 4)) if 'UFactor' in p else '-'
            item['referenceSHGC'] = str(round(parse_float(p.get('SHGC', 0)), 4)) if 'SHGC' in p else '-'
            item['referenceVT'] = str(round(parse_float(p.get('VT', 0)), 4)) if 'VT' in p else '-'
        else:
            item['referenceUFactor'] = '-'
            item['referenceSHGC'] = '-'
            item['referenceVT'] = '-'

    fenestration_list = list(fenestration_map.values())

    # -------------------------------------------------------------
    # 4. Zone Summary & Minimum Outdoor Air Mechanical Ventilation
    # -------------------------------------------------------------
    zone_summary_rows = find_table_by_fullname(html_content, 'FullName:Input Verification and Results Summary_Entire Facility_Zone Summary')
    zone_areas = {}
    if zone_summary_rows and len(zone_summary_rows) > 1:
        for r in zone_summary_rows[1:]:
            if not r or not r[0]:
                continue
            z_name = r[0].strip()
            area = parse_float(r[1]) if len(r) > 1 else 0.0
            zone_areas[z_name.lower()] = area

    thrml_zn_dict = ibd_components.get('ThrmlZn', {})
    oa_rows = find_table_by_fullname(html_content, 'FullName:Outdoor Air Summary_Entire Facility_Minimum Outdoor Air During Occupied Hours')
    ventilation_list = []

    if oa_rows and len(oa_rows) > 1:
        for r in oa_rows[1:]:
            if not r or not r[0]:
                continue
            raw_zname = r[0].strip()
            vol = parse_float(r[3]) if len(r) > 3 else 0.0
            ach = parse_float(r[4]) if len(r) > 4 else 0.0

            # Space type: 4 chars after '_'
            space_type = ''
            if '_' in raw_zname:
                after_und = raw_zname.split('_', 1)[1]
                space_type = after_und[:4].strip()

            cfm = (ach * vol) / 60.0
            area = zone_areas.get(raw_zname.lower(), 0.0)
            cfm_per_ft2 = (cfm / area) if area > 0 else 0.0

            # Match CBECC ThrmlZn
            cbecc_zn = thrml_zn_dict.get(raw_zname.lower())
            if not cbecc_zn:
                stripped = re.sub(r'^thermal zone:\s*', '', raw_zname.lower())
                cbecc_zn = thrml_zn_dict.get(stripped) or thrml_zn_dict.get(f"thermal zone: {stripped}")
            if not cbecc_zn:
                norm_key = re.sub(r'[^a-z0-9]', '', raw_zname.lower())
                for k, obj in thrml_zn_dict.items():
                    if re.sub(r'[^a-z0-9]', '', k) == norm_key:
                        cbecc_zn = obj
                        break

            display_name = raw_zname
            cbecc_cfm_per_ft2 = 0.0
            cbecc_cfm_flow = 0.0
            if cbecc_zn:
                display_name = cbecc_zn.get('name', raw_zname)
                props = cbecc_zn.get('props', {})
                cbecc_cfm_per_ft2 = parse_float(
                    props.get('VentPerAreaSim') or
                    props.get('DsgnVentPerArea') or
                    props.get('CodeDsgnVentPerArea') or
                    props.get('VentPerAreaFlowSim') or
                    0.0
                )
                cbecc_cfm_flow = parse_float(
                    props.get('VentFlow') or
                    props.get('VentFlowSim') or
                    props.get('MinVentFlow') or
                    0.0
                )

            diff_pct = 0.0
            if cbecc_cfm_per_ft2 > 0:
                diff_pct = ((cfm_per_ft2 - cbecc_cfm_per_ft2) / cbecc_cfm_per_ft2) * 100.0
            elif cfm_per_ft2 > 0:
                diff_pct = 100.0

            ventilation_list.append({
                'zoneName': display_name,
                'spaceType': space_type,
                'mechanicalVentCFM': round(cfm, 2),
                'areaSqFt': round(area, 2),
                'ventPerAreaSimCalculated': round(cfm_per_ft2, 4),
                'ventPerAreaSimCBECC': round(cbecc_cfm_per_ft2, 4),
                'cbeccVentFlow': round(cbecc_cfm_flow, 2),
                'diffPercent': round(diff_pct, 2)
            })

    return {
        'scenario': scenario,
        'unmetHours': {
            'facility': facility_unmet,
            'hasWarning': has_unmet_warning,
            'zones': zones_unmet
        },
        'complianceEnergy': compliance_map,
        'endUses': end_uses_map,
        'schedules': {
            'lighting': light_schedules,
            'receptacle': receptacle_schedules
        },
        'envelope': {
            'opaqueExterior': opaque_exterior_list,
            'opaqueInterior': opaque_interior_list,
            'exteriorFenestration': fenestration_list
        },
        'ventilation': ventilation_list
    }

def parse_excel_qc_sheet(file_path: str) -> Dict[str, Any]:
    """Parses the 'QC' sheet of a CBECC Model Workbook (.xlsm or .xlsx).
    Returns dict:
      {
        'categories': [
          {
            'name': 'Interior Lighting -- ComplianceLtg',
            'baseline': { 'elec_kwh': ..., 'gas_therm': ..., 'water_gal': ... },
            'proposed': { 'elec_kwh': ..., 'gas_therm': ..., 'water_gal': ... }
          },
          ...
        ]
      }
    """
    if not os.path.exists(file_path):
        return {'success': False, 'error': f'Workbook not found: {file_path}'}

    try:
        import openpyxl
        wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
        if 'QC' not in wb.sheetnames:
            wb.close()
            return {'success': False, 'error': "Worksheet 'QC' not found in workbook."}

        ws = wb['QC']
        categories = []
        for r in range(3, ws.max_row + 1):
            cat_name = ws.cell(r, 1).value
            if not cat_name or not str(cat_name).strip():
                continue
            cat_str = str(cat_name).strip()
            b_elec  = parse_float(ws.cell(r, 2).value)
            b_gas   = parse_float(ws.cell(r, 3).value)
            b_water = parse_float(ws.cell(r, 4).value)
            p_elec  = parse_float(ws.cell(r, 5).value)
            p_gas   = parse_float(ws.cell(r, 6).value)
            p_water = parse_float(ws.cell(r, 7).value)

            categories.append({
                'category': cat_str,
                'baseline': {
                    'electricity_kWh': round(b_elec, 2),
                    'naturalGas_therm': round(b_gas, 2),
                    'water_gal': round(b_water, 2)
                },
                'proposed': {
                    'electricity_kWh': round(p_elec, 2),
                    'naturalGas_therm': round(p_gas, 2),
                    'water_gal': round(p_water, 2)
                }
            })
        wb.close()
        return {'success': True, 'categories': categories}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def scan_model_folder_for_qc(folder_path: str) -> Dict[str, Any]:
    """Scans a CBECC model run folder for ab1, ap HTM files and .ibd-Detail files."""
    if not os.path.exists(folder_path):
        return {'success': False, 'error': f'Directory not found: {folder_path}'}

    # Smart .ibd-Detail file finder supporting specific scenario names, subfolders, and generic fallbacks
    def find_ibd_for_scenario(scenario_key: str) -> Optional[str]:
        cands = [f for f in glob.glob(os.path.join(folder_path, f'*{scenario_key}*.ibd-Detail*'))
                 if not f.endswith('-B4Eval') and not f.endswith('-PostSim')]
        if not cands:
            cands = glob.glob(os.path.join(folder_path, f'*{scenario_key}*.ibd-Detail*'))
        if cands:
            return cands[0]
        sub_cands = glob.glob(os.path.join(folder_path, scenario_key, '*.ibd-Detail*'))
        if sub_cands:
            return sub_cands[0]
        generic = [f for f in glob.glob(os.path.join(folder_path, '*.ibd-Detail*'))
                   if not f.endswith('-B4Eval') and not f.endswith('-PostSim') and 'RangeReqd' not in f]
        if generic:
            return generic[0]
        generic_any = glob.glob(os.path.join(folder_path, '*.ibd-Detail*'))
        return generic_any[0] if generic_any else None

    ibd_ab1_path = find_ibd_for_scenario('ab1')
    ibd_ap_path  = find_ibd_for_scenario('ap')

    components_ab1 = parse_ibd_detail_file(ibd_ab1_path) if ibd_ab1_path else {}
    components_ap  = parse_ibd_detail_file(ibd_ap_path) if ibd_ap_path else {}

    # Find HTM files in ab1 and ap directories
    def find_htm_in_subfolder(subname: str) -> Optional[str]:
        sub_dir = os.path.join(folder_path, subname)
        if not os.path.isdir(sub_dir):
            return None
        htms = glob.glob(os.path.join(sub_dir, '*.htm')) + glob.glob(os.path.join(sub_dir, '*.html'))
        return htms[0] if htms else None

    htm_ab1_path = find_htm_in_subfolder('ab1')
    htm_ap_path  = find_htm_in_subfolder('ap')

    data_ab1 = None
    if htm_ab1_path and os.path.exists(htm_ab1_path):
        with open(htm_ab1_path, 'r', encoding='utf-8', errors='ignore') as f:
            data_ab1 = parse_qc_from_htm(f.read(), scenario='ab1', ibd_components=components_ab1)
            data_ab1['filePath'] = htm_ab1_path

    data_ap = None
    if htm_ap_path and os.path.exists(htm_ap_path):
        with open(htm_ap_path, 'r', encoding='utf-8', errors='ignore') as f:
            data_ap = parse_qc_from_htm(f.read(), scenario='ap', ibd_components=components_ap)
            data_ap['filePath'] = htm_ap_path

    return {
        'success': True,
        'folder': folder_path,
        'hasAb1': (data_ab1 is not None),
        'hasAp': (data_ap is not None),
        'ab1IbdPath': ibd_ab1_path,
        'apIbdPath': ibd_ap_path,
        'ab1': data_ab1,
        'ap': data_ap
    }
