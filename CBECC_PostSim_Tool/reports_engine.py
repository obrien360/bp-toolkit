"""
reports_engine.py - Extractor and aggregator for DOE Compliance Workbook Envelope Area tables.
Extracts envelope surfaces from CBECC-Com ' - ap - LEEDSummary.csv' files and generates:
- Table 1: Opaque Envelope - Baseline and Proposed Surface Areas and Properties
- Table 2: Fenestration - Proposed Design Area, and Baseline and Proposed Properties
- Intermediate Combined Big Tables (Opaque & Fenestration)
"""

import os
import csv
import glob
from collections import defaultdict
from typing import Dict, List, Any, Optional


def get_orientation_from_azimuth(surface_type: str, azimuth: Any) -> str:
    """
    Returns Horizontal for Roof, Floor, or Skylight.
    Otherwise maps azimuth (0-360) to one of 8 compass orientations.
    """
    st_low = (surface_type or '').strip().lower()
    if 'roof' in st_low or 'floor' in st_low or 'skylight' in st_low:
        return 'Horizontal'
    
    if azimuth is None or azimuth == '':
        return 'North'
    
    try:
        deg = float(azimuth) % 360.0
    except (ValueError, TypeError):
        return 'North'
    
    # 8 compass directions centered on multiples of 45:
    # North: [337.5, 360) and [0, 22.5)
    # Northeast: [22.5, 67.5)
    # East: [67.5, 112.5)
    # Southeast: [112.5, 157.5)
    # South: [157.5, 202.5)
    # Southwest: [202.5, 247.5)
    # West: [247.5, 292.5)
    # Northwest: [292.5, 337.5)
    if deg >= 337.5 or deg < 22.5:
        return 'North'
    elif deg < 67.5:
        return 'Northeast'
    elif deg < 112.5:
        return 'East'
    elif deg < 157.5:
        return 'Southeast'
    elif deg < 202.5:
        return 'South'
    elif deg < 247.5:
        return 'Southwest'
    elif deg < 292.5:
        return 'West'
    else:
        return 'Northwest'


def normalize_status(status: Any) -> str:
    """
    Status rules:
    a. Keep 'New' as 'New'
    b. Change 'Existing' to 'Ex. Remain'
    c. Change 'Altered' to 'Retrofitted'
    """
    s = str(status or '').strip()
    s_low = s.lower()
    if 'exist' in s_low:
        return 'Ex. Remain'
    if 'alter' in s_low or 'retrofit' in s_low:
        return 'Retrofitted'
    if s_low == 'new':
        return 'New'
    return s if s else 'New'


def parse_leed_summary_rows(csv_rows: List[List[str]]) -> Dict[str, Any]:
    """
    Parses rows from ' - ap - LEEDSummary.csv' into Big Table 1, Big Table 2, Table 1, Table 2.
    """
    target_opaque_tables = [
        'Roof',
        'Exterior Wall',
        'Exterior Floor',
        'Underground Wall',
        'Underground Floor',
        'Interior Wall',
        'Interior Floor'
    ]
    target_fenestration_tables = [
        'Vertical Fenestration',
        'Skylight'
    ]
    all_target_tables = target_opaque_tables + target_fenestration_tables
    
    current_table: Optional[str] = None
    headers: List[str] = []
    
    big_table_1: List[Dict[str, Any]] = []
    big_table_2: List[Dict[str, Any]] = []
    
    boundary_sections = [
        'spaces loads summary', 'primary system', 'fluidsystems',
        'boiler', 'chiller', 'hvac system summary'
    ]
    
    for row in csv_rows:
        non_empty = [c.strip() for c in row if c.strip()]
        if not non_empty:
            continue
        
        first_val_low = non_empty[0].lower()
        
        # Check boundary
        if any(sec in first_val_low for sec in boundary_sections):
            current_table = None
            headers = []
            continue
            
        # Check if row is a table title header
        matched_table = None
        for t in all_target_tables:
            if non_empty[0].strip().lower() == t.lower():
                matched_table = t
                break
        
        if matched_table:
            current_table = matched_table
            headers = []
            continue
        
        if current_table:
            # Check if row is the exact header row (contains exact 'surface' cell and 'assembly' or 'fenestration')
            cells_clean_lower = [x.lower() for x in non_empty]
            if 'surface' in cells_clean_lower and ('assembly' in cells_clean_lower or 'fenestration' in cells_clean_lower):
                headers = [c.strip() for c in row]
                continue
            
            # Skip unit hint rows e.g. (ft2), (Deg)...
            if headers and non_empty[0].startswith('('):
                continue
            
            if headers:
                row_dict: Dict[str, str] = {}
                for idx, cell in enumerate(row):
                    if idx < len(headers) and headers[idx]:
                        row_dict[headers[idx]] = cell.strip()
                
                surface = row_dict.get('Surface', '')
                cond_type = row_dict.get('Conditioning Type', '')
                res_nonres = row_dict.get('Res/Non-res', '')
                bdlg_area_type = row_dict.get('Bdlg Area Type', '')
                raw_status = row_dict.get('Status', 'New')
                status = normalize_status(raw_status)
                
                # Multiplier
                mult_raw = row_dict.get('Multiplier', '1')
                try:
                    multiplier = float(mult_raw) if mult_raw else 1.0
                except (ValueError, TypeError):
                    multiplier = 1.0
                
                azimuth_raw = row_dict.get('Azimuth', '')
                orientation = get_orientation_from_azimuth(current_table, azimuth_raw)
                
                if current_table in target_opaque_tables:
                    assembly = row_dict.get('Assembly', '')
                    if not surface and not assembly:
                        continue
                    
                    # Area/Perimeter: check 'Net Area', 'Area', or 'Exposed Perimeter'
                    area_val = 0.0
                    for k in ['Net Area', 'Area', 'Exposed Perimeter']:
                        if k in row_dict and row_dict[k]:
                            try:
                                area_val = float(row_dict[k])
                                break
                            except (ValueError, TypeError):
                                pass
                    
                    total_area = round(area_val * multiplier, 2)
                    
                    big_table_1.append({
                        'surface': surface,
                        'surfaceType': current_table,
                        'assembly': assembly,
                        'conditioningType': cond_type,
                        'resNonres': res_nonres,
                        'bdlgAreaType': bdlg_area_type,
                        'status': status,
                        'multiplier': multiplier,
                        'areaPerimeter': round(area_val, 2),
                        'totalAreaPerimeter': total_area,
                        'azimuth': azimuth_raw,
                        'orientation': orientation
                    })
                    
                elif current_table in target_fenestration_tables:
                    fenestration = row_dict.get('Fenestration', '')
                    if not surface and not fenestration:
                        continue
                    
                    area_val = 0.0
                    if 'Area' in row_dict and row_dict['Area']:
                        try:
                            area_val = float(row_dict['Area'])
                        except (ValueError, TypeError):
                            pass
                            
                    total_area = round(area_val * multiplier, 2)
                    
                    big_table_2.append({
                        'surface': surface,
                        'surfaceType': current_table,
                        'fenestration': fenestration,
                        'conditioningType': cond_type,
                        'resNonres': res_nonres,
                        'bdlgAreaType': bdlg_area_type,
                        'status': status,
                        'multiplier': multiplier,
                        'area': round(area_val, 2),
                        'totalArea': total_area,
                        'azimuth': azimuth_raw,
                        'orientation': orientation
                    })
                    
    # Generate Table 1 Aggregation
    table_1_map = defaultdict(float)
    for row in big_table_1:
        key = (
            row['assembly'],
            row['status'],
            row['bdlgAreaType'],
            row['orientation'],
            row['resNonres']
        )
        table_1_map[key] += row['totalAreaPerimeter']
    
    table_1 = []
    for (assem, st, bdlg, orient, res_nr), net_area in sorted(table_1_map.items()):
        table_1.append({
            'modeledConstructionName': assem,
            'status': st,
            'bdlgAreaType': bdlg,
            'orientation': orient,
            'conditioningCategory': res_nr,
            'netArea': round(net_area, 1)
        })
    
    # Generate Table 2 Aggregation
    table_2_map = defaultdict(float)
    for row in big_table_2:
        key = (
            row['fenestration'],
            row['status'],
            row['bdlgAreaType'],
            row['orientation'],
            row['resNonres']
        )
        table_2_map[key] += row['totalArea']
        
    table_2 = []
    for (fen, st, bdlg, orient, res_nr), net_area in sorted(table_2_map.items()):
        table_2.append({
            'modeledFenestrationName': fen,
            'status': st,
            'bdlgAreaType': bdlg,
            'orientation': orient,
            'conditioningCategory': res_nr,
            'netArea': round(net_area, 1)
        })
    
    unique_constructions = sorted(list(set(r['assembly'] for r in big_table_1 if r['assembly'])))
    unique_fenestrations = sorted(list(set(r['fenestration'] for r in big_table_2 if r['fenestration'])))
    
    return {
        'bigTable1': big_table_1,
        'table1': table_1,
        'bigTable2': big_table_2,
        'table2': table_2,
        'constructions': unique_constructions,
        'fenestrations': unique_fenestrations,
        'counts': {
            'opaqueSurfaces': len(big_table_1),
            'opaqueAggregated': len(table_1),
            'fenSurfaces': len(big_table_2),
            'fenAggregated': len(table_2)
        }
    }


def parse_leed_summary_file(file_path: str) -> Dict[str, Any]:
    """
    Reads a CSV file path and parses it.
    """
    if not os.path.exists(file_path):
        return {'success': False, 'error': f"File not found: {file_path}"}
        
    try:
        with open(file_path, mode='r', encoding='utf-8', errors='ignore') as f:
            reader = csv.reader(f)
            rows = list(reader)
            
        data = parse_leed_summary_rows(rows)
        data['success'] = True
        data['filePath'] = file_path
        data['fileName'] = os.path.basename(file_path)
        return data
    except Exception as e:
        return {'success': False, 'error': str(e)}


def scan_folder_for_leed_summary(folder_path: str) -> Dict[str, Any]:
    """
    Finds '* - ap - LEEDSummary.csv' in folder_path and parses it.
    """
    folder_path = os.path.normpath(folder_path)
    if not os.path.exists(folder_path):
        return {'success': False, 'error': f"Folder not found: {folder_path}"}
        
    candidates = glob.glob(os.path.join(folder_path, '* - ap - LEEDSummary.csv'))
    if not candidates:
        all_csvs = glob.glob(os.path.join(folder_path, '*.csv'))
        for f in all_csvs:
            fname = os.path.basename(f).lower()
            if ' - ap - ' in fname and 'leedsummary' in fname:
                candidates.append(f)
                break
    
    if not candidates:
        return {
            'success': False,
            'folder': folder_path,
            'error': f"No file ending with ' - ap - LEEDSummary.csv' found in {folder_path}"
        }
        
    csv_file = candidates[0]
    result = parse_leed_summary_file(csv_file)
    result['folder'] = folder_path
    return result
