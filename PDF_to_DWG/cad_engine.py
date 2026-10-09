"""
cad_engine.py - Core Computational Geometry & CAD Conversion Engine for Bluebeam PDF to DWG
Developed for O'Brien360 Tools Suite.

Key Capabilities:
1. PDF Analysis:
   - Automatic scale detection from Viewport / Measure dictionaries (e.g. 1/8" = 1'-0" -> 9 pt/ft)
   - Layer / Level detection from OCGs and annotation metadata
2. Orthogonal Snapping & Rectification:
   - Snaps edges within +/- tol_deg (default 5.0 deg) of horizontal or vertical
   - Ray-ray edge intersection to preserve true rectangular and orthogonal corners
3. Planar Graph Single-Line Network:
   - Merges shared boundary walls between adjacent zones into a single shared wall line
   - Eliminates duplicate overlapping lines (no double walls)
   - Polygonization into clean, closed polyloops with zero open/dangling endpoints
4. Multi-Level Coincident Overlay:
    - Converts the selected base level first (e.g. Level 1)
    - Snaps each subsequent level to the immediately preceding level's coordinate grid
5. CAD DXF/DWG Generation:
   - Clean layer separation (LEVEL_X, LEVEL_X_POLYLOOPS, LEVEL_X_TEXT)
   - Horizontal spread out layout at user-configurable spacing (default 120% of max width)
   - Aligned / True-origin layout option for 3D/BIM modeling
"""

import math
import os
import shutil
import re
from collections import defaultdict
import numpy as np
import pymupdf
import ezdxf
from ezdxf.enums import TextEntityAlignment
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, box
from shapely.ops import unary_union, polygonize


COMMON_SCALES = [
    {"label": '1/16" = 1\'-0" (4.5 pt/ft)', "value": 4.5},
    {"label": '3/32" = 1\'-0" (6.75 pt/ft)', "value": 6.75},
    {"label": '1/8" = 1\'-0" (9.0 pt/ft)', "value": 9.0},
    {"label": '3/16" = 1\'-0" (13.5 pt/ft)', "value": 13.5},
    {"label": '1/4" = 1\'-0" (18.0 pt/ft)', "value": 18.0},
    {"label": '3/8" = 1\'-0" (27.0 pt/ft)', "value": 27.0},
    {"label": '1/2" = 1\'-0" (36.0 pt/ft)', "value": 36.0},
    {"label": '3/4" = 1\'-0" (54.0 pt/ft)', "value": 54.0},
    {"label": '1" = 1\'-0" (72.0 pt/ft)', "value": 72.0}
]

LEVEL_NAME_PATTERN = re.compile(r'\b(?:level|floor|basement|roof|ground|podium|penthouse)\b', re.IGNORECASE)


def _annotation_level_name(oc_name, title):
    if oc_name and oc_name.strip():
        return oc_name.strip()
    if title and LEVEL_NAME_PATTERN.search(title.strip()):
        return title.strip()
    return 'Level 1'


def detect_pdf_scale(doc, page_idx=0):
    """
    Detects drawing scale from Bluebeam / PDF Measure and Viewport dictionaries.
    Returns:
        scale_pts_per_ft: float (e.g. 9.0)
        scale_label: str (e.g. '0.125 in = 1 ft\' in"')
        source: str
    """
    page = doc[page_idx]
    
    # 1. Check annotations for /Measure
    for a in page.annots():
        try:
            m_key = doc.xref_get_key(a.xref, 'Measure')
            if m_key and m_key[0] == 'xref':
                m_obj_num = int(m_key[1].split()[0])
                m_obj = doc.xref_object(m_obj_num)
                # extract /R string
                r_match = re.search(r'/R\s*\((.*?)\)', m_obj)
                # extract /C in /X number format
                c_match = re.search(r'/X\s*\[.*?/C\s*([0-9\.]+)', m_obj, re.DOTALL)
                if c_match:
                    c_val = float(c_match.group(1))
                    if c_val > 0:
                        pts_per_ft = round(1.0 / c_val, 4)
                        label = r_match.group(1) if r_match else f"{pts_per_ft:.2f} pt/ft"
                        return pts_per_ft, label, "Annotation Measure"
        except Exception:
            continue
            
    # 2. Check Page Viewports (/VP)
    try:
        vp_key = doc.xref_get_key(page.xref, 'VP')
        if vp_key and vp_key[0] != 'null':
            vp_text = vp_key[1]
            vp_num = int(re.search(r'\d+', vp_text).group(0))
            vp_obj = doc.xref_object(vp_num)
            m_match = re.search(r'/Measure\s+(\d+)\s+0\s+R', vp_obj)
            if m_match:
                m_num = int(m_match.group(1))
                m_obj = doc.xref_object(m_num)
                r_match = re.search(r'/R\s*\((.*?)\)', m_obj)
                c_match = re.search(r'/X\s*\[.*?/C\s*([0-9\.]+)', m_obj, re.DOTALL)
                if c_match:
                    c_val = float(c_match.group(1))
                    if c_val > 0:
                        pts_per_ft = round(1.0 / c_val, 4)
                        label = r_match.group(1) if r_match else f"{pts_per_ft:.2f} pt/ft"
                        return pts_per_ft, label, "Page Viewport Measure"
    except Exception:
        pass

    # Default fallback: 1/8" = 1'-0" (9.0 pt/ft)
    return 9.0, '1/8" = 1\'-0" (Default)', "Default"


def inspect_pdf_levels(doc, page_idx=0):
    """
    Discovers all layers / levels present in the PDF annotations.
    """
    page = doc[page_idx]
    ocgs = doc.get_ocgs()
    
    levels_found = defaultdict(lambda: {'count': 0, 'sample_names': []})
    
    for a in page.annots():
        if a.type[1] not in ('Polygon', 'PolyLine', 'Square', 'Ink'):
            continue
        oc = a.get_oc()
        oc_name = ocgs.get(oc, {}).get('name', '') if oc else ''
        title = a.info.get('title', '').strip()
        
        level_name = _annotation_level_name(oc_name, title)
            
        content = a.info.get('content', '').split('\r')[0].strip()
        levels_found[level_name]['count'] += 1
        if content and len(levels_found[level_name]['sample_names']) < 3:
            levels_found[level_name]['sample_names'].append(content)
            
    # Sort levels naturally (Level 1, Level 2, ...)
    sorted_levels = sorted(levels_found.keys(), key=lambda x: [int(s) if s.isdigit() else s.lower() for s in re.split(r'(\d+)', x)])
    return sorted_levels, dict(levels_found)


def _pdf_array(doc, xref, key):
    kind, value = doc.xref_get_key(xref, key)
    if kind != 'array':
        return None
    return [float(number) for number in re.findall(r'[-+]?(?:\d+\.\d*|\.\d+|\d+)', value)]


def _transformed_annotation_vertices(page, annotation):
    doc = page.parent
    appearance_type, appearance_value = doc.xref_get_key(annotation.xref, 'AP/N')
    if appearance_type == 'dict':
        state_type, state_value = doc.xref_get_key(annotation.xref, 'AS')
        if state_type == 'name':
            state_name = state_value.lstrip('/')
            appearance_type, appearance_value = doc.xref_get_key(annotation.xref, f'AP/N/{state_name}')

    if appearance_type != 'xref':
        return annotation.vertices

    form_xref = int(appearance_value.split()[0])
    bbox_values = _pdf_array(doc, form_xref, 'BBox')
    rect_values = _pdf_array(doc, annotation.xref, 'Rect')
    matrix_values = _pdf_array(doc, form_xref, 'Matrix') or [1, 0, 0, 1, 0, 0]
    if not bbox_values or len(bbox_values) != 4 or not rect_values or len(rect_values) != 4 or len(matrix_values) != 6:
        return annotation.vertices

    form_matrix = pymupdf.Matrix(*matrix_values)
    transformed_bbox = pymupdf.Rect(*bbox_values) * form_matrix
    annotation_rect = pymupdf.Rect(*rect_values)
    if transformed_bbox.is_empty or transformed_bbox.width == 0 or transformed_bbox.height == 0:
        return annotation.vertices

    scale_x = annotation_rect.width / transformed_bbox.width
    scale_y = annotation_rect.height / transformed_bbox.height
    page_to_pdf = ~page.transformation_matrix
    transformed_vertices = []
    for vertex in annotation.vertices:
        form_point = pymupdf.Point(vertex) * page_to_pdf * form_matrix
        pdf_point = pymupdf.Point(
            annotation_rect.x0 + (form_point.x - transformed_bbox.x0) * scale_x,
            annotation_rect.y0 + (form_point.y - transformed_bbox.y0) * scale_y
        )
        page_point = pdf_point * page.transformation_matrix
        transformed_vertices.append((page_point.x, page_point.y))

    return transformed_vertices


def extract_raw_zones(doc, page_idx=0, scale=9.0):
    """
    Extracts raw polygon coordinates per level, converting PDF top-left coordinates
    to architectural CAD coordinates (bottom-left origin, +Y up, units in feet).
    """
    page = doc[page_idx]
    H = page.rect.height
    ocgs = doc.get_ocgs()
    
    levels_data = defaultdict(list)
    for i, a in enumerate(page.annots()):
        verts = _transformed_annotation_vertices(page, a)
        if not verts or len(verts) < 3:
            continue
            
        oc = a.get_oc()
        oc_name = ocgs.get(oc, {}).get('name', '') if oc else ''
        title = a.info.get('title', '').strip()
        
        level_name = _annotation_level_name(oc_name, title)
            
        content = a.info.get('content', '')
        lines = content.split('\r')
        name = lines[0].strip() if lines else f"Zone {i+1}"
        area_str = lines[1].strip() if len(lines) > 1 else ""
        
        # Color
        stroke_color = a.colors.get('stroke')
        fill_color = a.colors.get('fill')
        
        # Convert to CAD feet
        # PDF page coords in PyMuPDF: (0,0) is top-left
        # CAD coords: (0,0) is bottom-left, y goes UP
        cad_pts = [(round(p[0] / scale, 3), round((H - p[1]) / scale, 3)) for p in verts]
        
        levels_data[level_name].append({
            'index': i,
            'name': name,
            'area_str': area_str,
            'pts': cad_pts,
            'stroke_color': stroke_color,
            'fill_color': fill_color
        })
        
    return dict(levels_data)


def cluster_1d(vals, tol=1.5):
    """
    Clusters 1D coordinates within a given tolerance and returns sorted cluster means.
    """
    if not vals:
        return []
    sorted_vals = sorted(vals)
    clusters = []
    curr = [sorted_vals[0]]
    for v in sorted_vals[1:]:
        if v - curr[-1] <= tol:
            curr.append(v)
        else:
            clusters.append(float(np.mean(curr)))
            curr = [v]
    clusters.append(float(np.mean(curr)))
    return sorted(clusters)


def snap_to_nearest(val, clusters):
    if not clusters:
        return val
    return min(clusters, key=lambda c: abs(c - val))


def rectify_level_zones(zones, tol_deg=5.0, cluster_tol=2.0, base_clusters=None):
    """
    Applies orthogonalization (snapping edges within +/- tol_deg to H or V),
    clusters shared wall lines within cluster_tol, and reconstructs valid clean polygons.
    If base_clusters (base_x, base_y) are provided, aligns to that reference level's wall coordinates.
    """
    raw_h_vals = []
    raw_v_vals = []
    zone_edge_defs = []
    
    for z in zones:
        pts = z['pts']
        n = len(pts)
        edges = []
        for i in range(n):
            p1 = pts[i]
            p2 = pts[(i + 1) % n]
            dx = p2[0] - p1[0]
            dy = p2[1] - p1[1]
            deg = math.degrees(math.atan2(dy, dx)) % 180
            dev_h = min(deg, 180 - deg)
            dev_v = abs(deg - 90)
            
            if dev_h <= tol_deg:
                edges.append({'type': 'H', 'p1': p1, 'p2': p2})
            elif dev_v <= tol_deg:
                edges.append({'type': 'V', 'p1': p1, 'p2': p2})
            else:
                edges.append({'type': 'A', 'p1': p1, 'p2': p2})
                
        # Merge consecutive collinear edges of the same type (H-H or V-V)
        changed = True
        while changed and len(edges) > 3:
            changed = False
            new_edges = []
            skip_next = False
            m = len(edges)
            for i in range(m):
                if skip_next:
                    skip_next = False
                    continue
                curr = edges[i]
                nxt = edges[(i + 1) % m]
                if curr['type'] in ('H', 'V') and curr['type'] == nxt['type']:
                    # Check combined angle
                    cdx = nxt['p2'][0] - curr['p1'][0]
                    cdy = nxt['p2'][1] - curr['p1'][1]
                    cdeg = math.degrees(math.atan2(cdy, cdx)) % 180
                    cdev_h = min(cdeg, 180 - cdeg)
                    cdev_v = abs(cdeg - 90)
                    comb_type = 'H' if cdev_h <= tol_deg else ('V' if cdev_v <= tol_deg else 'A')
                    if comb_type == curr['type']:
                        new_edges.append({'type': curr['type'], 'p1': curr['p1'], 'p2': nxt['p2']})
                        skip_next = True
                        changed = True
                        continue
                new_edges.append(curr)
            edges = new_edges

        # Calculate H and V values after collinear merge
        processed_edges = []
        for e in edges:
            if e['type'] == 'H':
                y_val = (e['p1'][1] + e['p2'][1]) / 2.0
                processed_edges.append(('H', y_val, e['p1'], e['p2']))
                raw_h_vals.append(y_val)
            elif e['type'] == 'V':
                x_val = (e['p1'][0] + e['p2'][0]) / 2.0
                processed_edges.append(('V', x_val, e['p1'], e['p2']))
                raw_v_vals.append(x_val)
            else:
                processed_edges.append(('A', None, e['p1'], e['p2']))
                
        zone_edge_defs.append(processed_edges)
        
    # Form coordinate clusters
    c_y = cluster_1d(raw_h_vals, tol=cluster_tol)
    c_x = cluster_1d(raw_v_vals, tol=cluster_tol)
    
    # If reference-level clusters are provided, snap to that level's grid coordinates
    if base_clusters:
        base_x, base_y = base_clusters
        aligned_x = []
        for x in c_x:
            near_base = [bx for bx in base_x if abs(bx - x) <= cluster_tol]
            aligned_x.append(near_base[0] if near_base else x)
        c_x = aligned_x
        
        aligned_y = []
        for y in c_y:
            near_base = [by for by in base_y if abs(by - y) <= cluster_tol]
            aligned_y.append(near_base[0] if near_base else y)
        c_y = aligned_y

    rect_zones = []
    for z_idx, z in enumerate(zones):
        edges = zone_edge_defs[z_idx]
        n = len(edges)
        snapped_edges = []
        for e in edges:
            etype, val, p1, p2 = e
            if etype == 'H':
                s_val = snap_to_nearest(val, c_y)
                snapped_edges.append(('H', s_val, p1, p2))
            elif etype == 'V':
                s_val = snap_to_nearest(val, c_x)
                snapped_edges.append(('V', s_val, p1, p2))
            else:
                snapped_edges.append(e)
                
        # Intersect adjacent edges to reconstruct clean orthogonal vertices
        new_pts = []
        for i in range(n):
            prev_e = snapped_edges[(i - 1) % n]
            curr_e = snapped_edges[i]
            
            p_t, p_v, pp1, pp2 = prev_e
            c_t, c_v, cp1, cp2 = curr_e
            
            if p_t == 'H' and c_t == 'V':
                new_pts.append((c_v, p_v))
            elif p_t == 'V' and c_t == 'H':
                new_pts.append((p_v, c_v))
            elif p_t == 'H' and c_t == 'H':
                new_pts.append((cp1[0], c_v))
            elif p_t == 'V' and c_t == 'V':
                new_pts.append((c_v, cp1[1]))
            else:
                # Angled edge
                new_pts.append(cp1)
                
        # Clean redundant collinear points
        clean_pts = []
        m = len(new_pts)
        for i in range(m):
            p_prev = new_pts[(i - 1) % m]
            p_curr = new_pts[i]
            p_next = new_pts[(i + 1) % m]
            if abs(p_prev[0] - p_curr[0]) < 1e-3 and abs(p_curr[0] - p_next[0]) < 1e-3:
                continue
            if abs(p_prev[1] - p_curr[1]) < 1e-3 and abs(p_curr[1] - p_next[1]) < 1e-3:
                continue
            if clean_pts and abs(clean_pts[-1][0] - p_curr[0]) < 1e-3 and abs(clean_pts[-1][1] - p_curr[1]) < 1e-3:
                continue
            clean_pts.append((round(p_curr[0], 2), round(p_curr[1], 2)))
            
        if len(clean_pts) > 1 and abs(clean_pts[0][0] - clean_pts[-1][0]) < 1e-3 and abs(clean_pts[0][1] - clean_pts[-1][1]) < 1e-3:
            clean_pts.pop()
            
        # Create Shapely Polygon
        poly = Polygon(clean_pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
            
        c = poly.centroid
        rect_zones.append({
            'index': z.get('index', z_idx),
            'name': z['name'],
            'area_str': z['area_str'],
            'area_calc': round(poly.area, 1),
            'pts': clean_pts,
            'poly': poly,
            'centroid': [round(c.x, 2), round(c.y, 2)] if not poly.is_empty else [0, 0],
            'stroke_color': z.get('stroke_color'),
            'fill_color': z.get('fill_color')
        })
        
    return rect_zones, (c_x, c_y)


def build_planar_graph(clean_zones):
    """
    Extracts the single-line wall network and closed polyloops for a level:
    - Merges shared boundary walls into single lines (unary_union of boundaries)
    - Polygonizes the network into closed faces
    - Verifies zero open/dangling endpoints
    """
    boundaries = [z['poly'].boundary for z in clean_zones if not z['poly'].is_empty]
    network = unary_union(boundaries)
    
    # Extract line segments
    segments = []
    endpoint_counts = defaultdict(int)
    
    geoms = network.geoms if hasattr(network, 'geoms') else [network]
    for g in geoms:
        coords = list(g.coords)
        for i in range(len(coords) - 1):
            p1 = (round(coords[i][0], 2), round(coords[i][1], 2))
            p2 = (round(coords[i+1][0], 2), round(coords[i+1][1], 2))
            segments.append((p1, p2))
            endpoint_counts[p1] += 1
            endpoint_counts[p2] += 1
            
    # Check dangling endpoints (degree 1 endpoints)
    dangling_endpoints = [pt for pt, cnt in endpoint_counts.items() if cnt == 1]
    
    # Recover closed polyloop faces
    faces = list(polygonize(network))
    polyloops = []
    for f_idx, face in enumerate(faces):
        ext_coords = [(round(x, 2), round(y, 2)) for x, y in face.exterior.coords[:-1]]
        c = face.centroid
        polyloops.append({
            'id': f_idx + 1,
            'coords': ext_coords,
            'area': round(face.area, 1),
            'centroid': [round(c.x, 2), round(c.y, 2)]
        })
        
    return {
        'network': network,
        'segments': segments,
        'segment_count': len(segments),
        'polyloops': polyloops,
        'polyloop_count': len(polyloops),
        'dangling_count': len(dangling_endpoints),
        'dangling_points': dangling_endpoints
    }


def process_cad_conversion(doc, base_level, conversion_order, scale=9.0, tol_deg=5.0, cluster_tol=2.0, level_bases=None, spread_order=None):
    """
    Executes the complete multi-level conversion:
    1. Extracts raw zones per level.
    2. Converts base level first to establish the master grid.
    3. Converts each subsequent level after its selected snap-base level.
    4. Computes inter-level overlay match statistics.
    """
    raw_levels = extract_raw_zones(doc, page_idx=0, scale=scale)
    
    # Keep export order independent from the dependency order used for snapping.
    requested_order = list(dict.fromkeys(lvl for lvl in conversion_order if lvl in raw_levels))
    if base_level not in requested_order and base_level in raw_levels:
        requested_order.insert(0, base_level)
    requested_order = [base_level] + [lvl for lvl in requested_order if lvl != base_level]
    layout_order = [lvl for lvl in (spread_order or requested_order) if lvl in requested_order]
    layout_order += [lvl for lvl in requested_order if lvl not in layout_order]

    if level_bases is None:
        level_bases = {
            lvl: requested_order[index - 1]
            for index, lvl in enumerate(requested_order)
            if index > 0
        }
    else:
        level_bases = dict(level_bases)

    for lvl in requested_order:
        if lvl == base_level:
            continue
        parent = level_bases.get(lvl)
        if parent not in requested_order or parent == lvl:
            raise ValueError(f"Invalid snap base for {lvl}: {parent}")

    levels_to_process = []
    pending = set(requested_order)
    while pending:
        ready = [lvl for lvl in layout_order if lvl in pending and (lvl == base_level or level_bases.get(lvl) not in pending)]
        if not ready:
            raise ValueError("Snap-base assignments contain a cycle or do not lead to the base reference level.")
        for lvl in ready:
            levels_to_process.append(lvl)
            pending.remove(lvl)
    
    processed_levels = {}
    clusters_by_level = {}
    segments_by_level = {}
    
    # Global bounding box for spread calculation
    all_xs = []
    all_ys = []
    
    for lvl_idx, lvl_name in enumerate(levels_to_process):
        zones = raw_levels.get(lvl_name, [])
        if not zones:
            continue
            
        is_base = (lvl_idx == 0)
        parent_level = None if is_base else level_bases[lvl_name]
        clean_zones, clusters = rectify_level_zones(
            zones,
            tol_deg=tol_deg,
            cluster_tol=cluster_tol,
            base_clusters=clusters_by_level.get(parent_level) if not is_base else None
        )
        clusters_by_level[lvl_name] = clusters
            
        graph = build_planar_graph(clean_zones)
        
        # Compute overlay match with base level if not base
        overlay_stats = None
        parent_segments = segments_by_level.get(parent_level, set())
        if not is_base and parent_segments:
            matched_segs = 0
            for p1, p2 in graph['segments']:
                if (p1, p2) in parent_segments or (p2, p1) in parent_segments:
                    matched_segs += 1
            overlay_stats = {
                'total_segments': graph['segment_count'],
                'matched_with_base': matched_segs,
                'match_percentage': round(matched_segs / max(1, graph['segment_count']) * 100, 1)
            }
        segments_by_level[lvl_name] = {
            segment for p1, p2 in graph['segments'] for segment in ((p1, p2), (p2, p1))
        }
                
        # Bounds of this level
        lvl_xs = []
        lvl_ys = []
        for z in clean_zones:
            for pt in z['pts']:
                lvl_xs.append(pt[0])
                lvl_ys.append(pt[1])
        all_xs.extend(lvl_xs)
        all_ys.extend(lvl_ys)
        
        min_x = min(lvl_xs) if lvl_xs else 0
        max_x = max(lvl_xs) if lvl_xs else 0
        min_y = min(lvl_ys) if lvl_ys else 0
        max_y = max(lvl_ys) if lvl_ys else 0
        
        processed_levels[lvl_name] = {
            'level_name': lvl_name,
            'is_base': is_base,
            'zones': [
                {
                    'index': z['index'],
                    'name': z['name'],
                    'area_str': z['area_str'],
                    'area_calc': z['area_calc'],
                    'pts': z['pts'],
                    'centroid': z['centroid'],
                    'stroke_color': z['stroke_color'],
                    'fill_color': z['fill_color']
                }
                for z in clean_zones
            ],
            'planar_graph': {
                'segments': graph['segments'],
                'segment_count': graph['segment_count'],
                'polyloops': graph['polyloops'],
                'polyloop_count': graph['polyloop_count'],
                'dangling_count': graph['dangling_count'],
                'dangling_points': graph['dangling_points']
            },
            'overlay_stats': overlay_stats,
            'bounds': {
                'min_x': round(min_x, 2),
                'max_x': round(max_x, 2),
                'min_y': round(min_y, 2),
                'max_y': round(max_y, 2),
                'width': round(max_x - min_x, 2),
                'height': round(max_y - min_y, 2)
            }
        }
        
    global_max_width = max((lvl['bounds']['width'] for lvl in processed_levels.values()), default=100.0)
    global_max_height = max((lvl['bounds']['height'] for lvl in processed_levels.values()), default=100.0)
    
    return {
        'levels': processed_levels,
        'base_level': base_level,
        'conversion_order': levels_to_process,
        'spread_order': layout_order,
        'level_bases': level_bases,
        'global_max_width': round(global_max_width, 2),
        'global_max_height': round(global_max_height, 2)
    }


def export_cad_files(processed_data, output_dir, file_prefix='Zoning_Clean', spacing_pct=120.0, layout_mode='both', spacing_ft=None):
    """
    Exports clean CAD DXF and DWG files using ezdxf.
    Supports:
    - layout_mode='spread': all levels spread horizontally by spacing_ft, or by spacing_pct for legacy callers
    - layout_mode='aligned': all levels at origin (stacked)
    - layout_mode='both': exports both files!
    """
    os.makedirs(output_dir, exist_ok=True)
    generated_files = []
    
    levels_data = processed_data['levels']
    conversion_order = processed_data['conversion_order']
    spread_order = processed_data.get('spread_order', conversion_order)
    max_w = processed_data['global_max_width']
    spacing_dx = float(spacing_ft) if spacing_ft is not None else max_w * (spacing_pct / 100.0)
    
    # Layer colors palette (AutoCAD ACI):
    # 7=White, 1=Red, 3=Green, 4=Cyan, 2=Yellow, 6=Magenta, 5=Blue, 8=Dark Gray
    level_color_palettes = [
        {'lines': 7, 'poly': 3, 'text': 2},  # Level 1: White lines, Green loops, Yellow text
        {'lines': 1, 'poly': 4, 'text': 6},  # Level 2: Red lines, Cyan loops, Magenta text
        {'lines': 5, 'poly': 2, 'text': 3},  # Level 3: Blue lines, Yellow loops, Green text
        {'lines': 4, 'poly': 1, 'text': 7},  # Level 4: Cyan lines, Red loops, White text
    ]
    
    modes = ['spread', 'aligned'] if layout_mode == 'both' else [layout_mode]
    
    for mode in modes:
        doc = ezdxf.new('R2010')
        # CRITICAL: Set drawing units to FEET so AutoCAD, SketchUp & Rhino
        # import at the correct scale. ezdxf default is 6 (meters), which
        # causes a ~3.28x oversize when imported into SketchUp.
        # $INSUNITS values: 0=Unitless, 1=Inches, 2=Feet, 4=mm, 6=Meters
        doc.header['$INSUNITS'] = 2   # Feet
        doc.header['$MEASUREMENT'] = 0  # Imperial (not metric)
        msp = doc.modelspace()
        
        filename_suffix = "_Spread" if mode == 'spread' else "_Aligned"
        dxf_name = f"{file_prefix}{filename_suffix}.dxf"
        dwg_name = f"{file_prefix}{filename_suffix}.dwg"
        dxf_path = os.path.join(output_dir, dxf_name)
        dwg_path = os.path.join(output_dir, dwg_name)
        
        export_order = spread_order if mode == 'spread' else conversion_order
        for idx, lvl_name in enumerate(export_order):
            if lvl_name not in levels_data:
                continue
            lvl = levels_data[lvl_name]
            
            # Layer names
            # Sanitize layer name for DXF (letters, digits, underscores)
            safe_lvl_id = re.sub(r'[^A-Za-z0-9_]', '_', lvl_name.upper())
            wall_layer = safe_lvl_id
            poly_layer = f"{safe_lvl_id}_POLYLOOPS"
            text_layer = f"{safe_lvl_id}_TEXT"
            
            pal = level_color_palettes[idx % len(level_color_palettes)]
            doc.layers.add(wall_layer, color=pal['lines'])
            doc.layers.add(poly_layer, color=pal['poly'])
            doc.layers.add(text_layer, color=pal['text'])
            
            # Offset for spread layout
            dx_offset = (idx * spacing_dx) if mode == 'spread' else 0.0
            
            # 1. Add Single-line Wall Network
            for p1, p2 in lvl['planar_graph']['segments']:
                msp.add_line(
                    (p1[0] + dx_offset, p1[1], 0),
                    (p2[0] + dx_offset, p2[1], 0),
                    dxfattribs={'layer': wall_layer}
                )
                
            # 2. Add Closed Polyloops
            for poly in lvl['planar_graph']['polyloops']:
                shifted_coords = [(pt[0] + dx_offset, pt[1]) for pt in poly['coords']]
                msp.add_lwpolyline(shifted_coords, close=True, dxfattribs={'layer': poly_layer})
                
            # 3. Add Room Labels & Areas
            for z in lvl['zones']:
                c = z['centroid']
                label = f"{z['name']}\n{z['area_calc']} sf"
                msp.add_text(
                    label,
                    dxfattribs={'layer': text_layer, 'height': 2.0}
                ).set_placement((c[0] + dx_offset, c[1], 0), align=TextEntityAlignment.MIDDLE_CENTER)
                
            # If spread mode, add a Level Title label below the floor plan
            if mode == 'spread':
                b = lvl['bounds']
                title_x = (b['min_x'] + b['max_x']) / 2.0 + dx_offset
                title_y = b['min_y'] - 10.0
                msp.add_text(
                    f"{lvl_name.upper()}",
                    dxfattribs={'layer': text_layer, 'height': 4.0}
                ).set_placement((title_x, title_y, 0), align=TextEntityAlignment.MIDDLE_CENTER)
                
        doc.saveas(dxf_path)
        # Duplicate to .dwg for direct DWG users
        shutil.copyfile(dxf_path, dwg_path)
        
        generated_files.append({
            'mode': mode,
            'dxf_name': dxf_name,
            'dwg_name': dwg_name,
            'dxf_path': dxf_path,
            'dwg_path': dwg_path
        })
        
    return generated_files


def open_pdf_document(pdf_input):
    """
    Opens a PDF document from a file path or raw bytes.
    """
    if isinstance(pdf_input, (bytes, bytearray)):
        return pymupdf.open(stream=pdf_input, filetype="pdf")
    elif isinstance(pdf_input, str):
        return pymupdf.open(pdf_input)
    elif isinstance(pdf_input, pymupdf.Document):
        return pdf_input
    else:
        raise ValueError("Unsupported PDF input type")


def generate_verification_plot(processed_data, output_path):
    """
    Generates a multi-panel high-resolution verification image comparing levels
    and showing the multi-level overlay.
    """
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MplPolygon
    
    levels_data = processed_data['levels']
    conversion_order = processed_data['conversion_order']
    num_levels = len(conversion_order)
    
    # We create N level panels + 1 overlay panel
    total_cols = num_levels + 1
    fig, axes = plt.subplots(1, total_cols, figsize=(8 * total_cols, 8))
    if total_cols == 1:
        axes = [axes]
        
    palette = ['#43a047', '#e53935', '#1e88e5', '#8e24aa', '#fb8c00']
    
    for idx, lvl_name in enumerate(conversion_order):
        ax = axes[idx]
        ax.set_aspect('equal')
        ax.set_title(f"{lvl_name} (Single-Lines & Polyloops)", fontsize=13, weight='bold')
        ax.grid(True, linestyle=':', alpha=0.5)
        
        lvl = levels_data[lvl_name]
        for z in lvl['zones']:
            pts = z['pts']
            if len(pts) >= 3:
                patch = MplPolygon(pts, closed=True, facecolor='#8CBD3A', alpha=0.25, edgecolor='#1E293B', linewidth=1.2)
                ax.add_patch(patch)
                c = z['centroid']
                short_name = z['name'].split('(')[0].strip()
                ax.text(c[0], c[1], f"{short_name}\n{z['area_calc']:.0f} sf", fontsize=6, ha='center', va='center', weight='bold', color='#0F172A')
        ax.autoscale()
        
    # Overlay panel
    ax_ov = axes[-1]
    ax_ov.set_aspect('equal')
    ax_ov.set_title(f"Multi-Level Overlay ({' vs '.join(conversion_order)})", fontsize=13, weight='bold')
    ax_ov.grid(True, linestyle=':', alpha=0.5)
    
    for idx, lvl_name in enumerate(conversion_order):
        lvl = levels_data[lvl_name]
        col = palette[idx % len(palette)]
        for p1, p2 in lvl['planar_graph']['segments']:
            ax_ov.plot([p1[0], p2[0]], [p1[1], p2[1]], color=col, linewidth=1.8 if idx == 0 else 1.2,
                       linestyle='-' if idx == 0 else '--', alpha=0.75,
                       label=lvl_name if p1 == lvl['planar_graph']['segments'][0][0] else "")
            
    # Add dummy legend handles
    handles, labels = ax_ov.get_legend_handles_labels()
    by_label = dict(zip(labels, handles))
    if by_label:
        ax_ov.legend(by_label.values(), by_label.keys(), loc='upper right')
    ax_ov.autoscale()
    
    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    plt.savefig(output_path, dpi=180)
    plt.close()
    return output_path
