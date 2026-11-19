"""
engine.py - Core Engine for PDF Window Measurement Completion Tool
O'Brien360 Tools Suite

Main capabilities:
1. Multi-page elevation PDF parsing & window type label detection.
2. Extraction of representative manual measurements (Polygon/Area markups) as ground truth.
3. Machine-learning / statistical aggregation of window dimensions, offsets, scale calibrations, and Bluebeam styles.
4. Computer-vision drawing edge detection & snapping to vector linework.
5. Strict overlap / collision detection to avoid double-counting.
6. Generation of native, fully editable Bluebeam-compatible Area annotations (/PolygonDimension)
   with 30% fill opacity, exact stroke/fill colors, and scale dictionaries.
7. Verification image rendering and takeoff schedule export.
"""

import os
import re
import math
import statistics
import collections
import io
import csv
import base64
import numpy as np
import pymupdf
from PIL import Image

NUM_REGEX = r'[-+]?(?:\d*\.\d+|\d+)'
DEFAULT_LABEL_REGEX = r'\bW-?\d{1,3}[A-Za-z]?\b'


class WindowCompletionEngine:
    def __init__(self, scale_raster=2.0, search_pt=18.0, step_pt=0.5, min_gain=0.003, max_shift=16.0):
        self.scale_raster = scale_raster
        self.search_pt = search_pt
        self.step_pt = step_pt
        self.min_gain = min_gain
        self.max_shift = max_shift

    @staticmethod
    def render_edges(page, scale=2.0):
        """
        Renders page to grayscale numpy array and computes dark-line edge energy.
        Suppresses faint facade hatching (gray tones) while boosting crisp black window outlines.
        """
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False, annots=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
        # Suppress values above ~205 (light gray hatches), clip to [0, 1]
        edge = np.clip((205.0 - arr) / 205.0, 0.0, 1.0)
        return edge

    @staticmethod
    def rect_score(edge, r, scale=2.0, tolerance=3):
        """
        Calculates edge energy along the 4 borders of candidate rectangle r.
        """
        x0, y0, x1, y1 = [int(round(v * scale)) for v in r]
        h, w = edge.shape
        if x0 < 2 or y0 < 2 or x1 >= w - 2 or y1 >= h - 2 or x1 <= x0 + 5 or y1 <= y0 + 5:
            return -1.0
        
        t = tolerance
        top = edge[max(0, y0 - t):min(h, y0 + t + 1), x0:x1 + 1].max(axis=0).mean()
        bot = edge[max(0, y1 - t):min(h, y1 + t + 1), x0:x1 + 1].max(axis=0).mean()
        lef = edge[y0:y1 + 1, max(0, x0 - t):min(w, x0 + t + 1)].max(axis=1).mean()
        rig = edge[y0:y1 + 1, max(0, x1 - t):min(w, x1 + t + 1)].max(axis=1).mean()
        return float((top + bot + lef + rig) / 4.0)

    def snap(self, edge, pred_center, width, height, search_pt=None, min_gain=None, max_shift=None):
        """
        Fast coarse-to-fine search around predicted window position to snap to actual drawing edges.
        Stage 1: Coarse 1.5pt step across search radius
        Stage 2: Fine 0.5pt refinement around coarse best
        """
        search_pt = search_pt if search_pt is not None else self.search_pt
        min_gain = min_gain if min_gain is not None else self.min_gain
        max_shift = max_shift if max_shift is not None else self.max_shift

        base = pymupdf.Rect(
            pred_center[0] - width / 2.0,
            pred_center[1] - height / 2.0,
            pred_center[0] + width / 2.0,
            pred_center[1] + height / 2.0
        )
        base_score = self.rect_score(edge, base, scale=self.scale_raster)
        best = (base_score, 0.0, 0.0, base)

        # Stage 1: Coarse grid (1.5 pt step)
        coarse_step = 1.5
        coarse_vals = np.arange(-search_pt, search_pt + 0.001, coarse_step)
        for dy in coarse_vals:
            for dx in coarse_vals:
                r = pymupdf.Rect(base.x0 + dx, base.y0 + dy, base.x1 + dx, base.y1 + dy)
                s = self.rect_score(edge, r, scale=self.scale_raster)
                if s > best[0]:
                    best = (s, dx, dy, r)

        # Stage 2: Fine grid (0.5 pt step) around best coarse shift (+/- 2.0 pt)
        cdx, cdy = best[1], best[2]
        fine_step = self.step_pt
        f_y_min = max(-search_pt, cdy - 2.0)
        f_y_max = min(search_pt, cdy + 2.001)
        f_x_min = max(-search_pt, cdx - 2.0)
        f_x_max = min(search_pt, cdx + 2.001)

        fine_y = np.arange(f_y_min, f_y_max, fine_step)
        fine_x = np.arange(f_x_min, f_x_max, fine_step)
        for dy in fine_y:
            for dx in fine_x:
                r = pymupdf.Rect(base.x0 + dx, base.y0 + dy, base.x1 + dx, base.y1 + dy)
                s = self.rect_score(edge, r, scale=self.scale_raster)
                if s > best[0]:
                    best = (s, dx, dy, r)

        gain = best[0] - base_score
        shift_dist = math.hypot(best[1], best[2])
        accepted = (gain >= min_gain) and (shift_dist <= max_shift)

        snapped_rect = best[3] if accepted else base
        shift = (best[1], best[2]) if accepted else (0.0, 0.0)
        return snapped_rect, base_score, best[0], gain, shift, accepted

    @staticmethod
    def _get_annot_geometry(annot):
        """
        Returns (center_point, pymupdf.Rect) in PyMuPDF page coordinate space.
        Uses annot.vertices or annot.rect directly so it correctly accounts
        for PDF CropBox / MediaBox origin offsets across all CAD / Revit exports.
        """
        try:
            verts = annot.vertices
            if verts:
                xs = [pt[0] for pt in verts]
                ys = [pt[1] for pt in verts]
                rc = ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)
                rect = pymupdf.Rect(min(xs), min(ys), max(xs), max(ys))
                return rc, rect
        except Exception:
            pass

        if annot.rect:
            r = annot.rect
            rc = ((r.x0 + r.x1) / 2.0, (r.y0 + r.y1) / 2.0)
            return rc, r
        return None, None

    @staticmethod
    def extract_manual_measurements(doc, label_regex=None):
        """
        Parses all pages in the PDF, detects existing manual area polygon measurements,
        and dynamically reads the window tag label located around the center of each measurement.
        Flexibly recognizes any architectural tag format (e.g. W01, A12, B4, D11, B4-b, D6-b, SD01).
        """
        num_pat = re.compile(NUM_REGEX)
        examples_by_type = {}
        all_manual_records = []
        page_all_words = {}
        scale_dicts = {}

        # 1. First pass: extract all words per page
        for pi, page in enumerate(doc):
            page_all_words[pi] = page.get_text('words')

        # Words that indicate units, annotations, or drawing notes (not window tags)
        ignore_words = {
            'sf', 'sq', 'ft', 'sqft', 'sq.ft.', 'area', 'sq.', 'ft.', 's.f.', 'sq_ft',
            'level', 'elevation', 'sim', 'typ', 'sheet', 'detail', 'plan', 'north', 'south',
            'east', 'west', 'scale', 'high', 'low', 'soffit', 'wall', 'roof', 'pnt', 'acm',
            'grid', 'callout', 'sec', 'section', 'glass', 'glazing', 'arch', 'arch.'
        }

        # 2. Extract manual measurements and read tag around center
        for pi, page in enumerate(doc):
            words = page_all_words[pi]

            for annot in page.annots():
                annot_type = annot.type[1]
                content = annot.info.get('content', '')
                subj = annot.info.get('subject', '')
                
                raw = doc.xref_object(annot.xref, compressed=False)
                is_area_measurement = ('/PolygonDimension' in raw) or (subj == 'Area Measurement') or (annot_type == 'Polygon' and content)

                if is_area_measurement:
                    rc, rect = WindowCompletionEngine._get_annot_geometry(annot)
                    if not rc or not rect:
                        continue

                    min_x, max_x = rect.x0, rect.x1
                    min_y, max_y = rect.y0, rect.y1
                    w_pt = max_x - min_x
                    h_pt = max_y - min_y

                    # Parse content words to exclude (e.g. '40', 'sf', '38.17')
                    content_words = set(re.findall(r'[\w.]+', content.lower()))

                    # Find candidates around measurement center
                    candidates = []
                    for w in words:
                        raw_text = w[4].strip()
                        # Clean surrounding punctuation (e.g. '(B4)' -> 'B4', 'B4,' -> 'B4')
                        clean_text = re.sub(r'^[^\w]+|[^\w]+$', '', raw_text)
                        if not clean_text:
                            continue
                        clean_lower = clean_text.lower()
                        if clean_lower in content_words or clean_lower in ignore_words:
                            continue
                        # Ignore pure numbers (e.g. elevation heights '425', '10', '0')
                        if re.match(r'^\d+(\.\d+)?$', clean_text):
                            continue

                        wx0, wy0, wx1, wy1 = w[0], w[1], w[2], w[3]
                        wc = ((wx0 + wx1) / 2.0, (wy0 + wy1) / 2.0)
                        dist = math.dist(rc, wc)
                        in_bbox = (wx0 >= min_x - 15 and wx1 <= max_x + 15 and wy0 >= min_y - 15 and wy1 <= max_y + 15)

                        # Check if token matches standard architectural window tag structures:
                        # e.g. A12, B4, D11, B4-b, D6-b, W01, W-12, SD01, SG, X1V1, etc.
                        is_tag_like = bool(re.match(r'^[A-Za-z]{1,4}[-_\s]?[0-9]{1,4}([-_][A-Za-z0-9]+)?$', clean_text)) or bool(re.match(r'^[A-Za-z0-9]{2,8}(-[A-Za-z0-9]+)?$', clean_text))

                        if in_bbox or dist < 45.0:
                            candidates.append({
                                'text': clean_text.upper(),
                                'dist': dist,
                                'in_bbox': in_bbox,
                                'is_tag_like': is_tag_like,
                                'center': wc,
                                'bbox': (wx0, wy0, wx1, wy1)
                            })

                    # Sort: words inside bounding box first, then tag-like patterns, then closest distance
                    candidates.sort(key=lambda c: (not c['in_bbox'], not c['is_tag_like'], c['dist']))
                    best_tag = candidates[0] if candidates else None
                    tag_text = best_tag['text'] if best_tag else 'WINDOW'

                    # Extract styling and measure dictionary
                    mm = re.search(r'/Measure\s+(\d+)\s+0\s+R', raw)
                    measure_xref = int(mm.group(1)) if mm else None
                    
                    stroke_m = re.search(r'/C\s*\[([^\]]+)\]', raw)
                    fill_m = re.search(r'/IC\s*\[([^\]]+)\]', raw)
                    op_m = re.search(r'/FillOpacity\s*([0-9.]+)', raw)
                    ca_m = re.search(r'/ca\s*([0-9.]+)', raw)

                    stroke = [float(x) for x in stroke_m.group(1).split()] if stroke_m else [1.0, 0.0, 0.0]
                    fill = [float(x) for x in fill_m.group(1).split()] if fill_m else [1.0, 0.0, 0.0]
                    fill_opacity = float(op_m.group(1)) if op_m else (float(ca_m.group(1)) if ca_m else 0.3)

                    scale_str = ''
                    if measure_xref:
                        measure_obj = doc.xref_object(measure_xref, compressed=False)
                        scale_dicts[measure_xref] = measure_obj
                        r_match = re.search(r'/R\s*\(([^)]+)\)', measure_obj)
                        if r_match:
                            scale_str = r_match.group(1)

                    rec = {
                        'page': pi,
                        'xref': annot.xref,
                        'rect': [min_x, min_y, max_x, max_y],
                        'center': rc,
                        'w': w_pt,
                        'h': h_pt,
                        'content': content,
                        'title': annot.info.get('title', 'OB360'),
                        'subject': subj or 'Area Measurement',
                        'measure_xref': measure_xref,
                        'scale_str': scale_str,
                        'stroke': stroke,
                        'fill': fill,
                        'fill_opacity': fill_opacity,
                        'matched_label': tag_text,
                        'label_dist': best_tag['dist'] if best_tag else 0.0,
                        'dx': (rc[0] - best_tag['center'][0]) if best_tag else 0.0,
                        'dy': (rc[1] - best_tag['center'][1]) if best_tag else 0.0
                    }

                    all_manual_records.append(rec)
                    examples_by_type.setdefault(tag_text, []).append(rec)

        # 3. Build window type learned models from detected tags
        learned_rules = {}
        for typ, es in examples_by_type.items():
            wm = statistics.median([e['w'] for e in es])
            hm = statistics.median([e['h'] for e in es])
            base = min(es, key=lambda e: abs(e['w'] - wm) + abs(e['h'] - hm))
            dxs = [e['dx'] for e in es]
            dys = [e['dy'] for e in es]

            dx_chosen = statistics.median(dxs) if (max(dxs) - min(dxs) <= 4.0) else min(dxs, key=abs)
            dy_chosen = statistics.median(dys) if (max(dys) - min(dys) <= 4.0) else min(dys, key=abs)

            learned_rules[typ] = {
                'type': typ,
                'w': wm,
                'h': hm,
                'dx': dx_chosen,
                'dy': dy_chosen,
                'content': base['content'],
                'measure_xref': base['measure_xref'],
                'scale_str': base['scale_str'],
                'stroke': base['stroke'],
                'fill': base['fill'],
                'fill_opacity': base['fill_opacity'],
                'title': base['title'],
                'subject': base['subject'],
                'sample_count': len(es)
            }

        # 4. Search across all elevation pages for occurrences of all learned tags
        known_tags = set(learned_rules.keys())
        label_totals = collections.Counter()
        label_page_distribution = collections.defaultdict(list)
        page_labels = collections.defaultdict(list)

        for pi, words in page_all_words.items():
            for w in words:
                raw_text = w[4].strip()
                clean_text = re.sub(r'^[^\w]+|[^\w]+$', '', raw_text).upper()
                if clean_text in known_tags:
                    lc = ((w[0] + w[2]) / 2.0, (w[1] + w[3]) / 2.0)
                    page_labels[pi].append({
                        'text': clean_text,
                        'bbox': (w[0], w[1], w[2], w[3]),
                        'center': lc,
                        'page': pi
                    })
                    label_totals[clean_text] += 1
                    label_page_distribution[clean_text].append(pi + 1)

        summary_types = []
        for typ in sorted(learned_rules.keys()):
            manual_cnt = len(examples_by_type.get(typ, []))
            total_cnt = max(manual_cnt, label_totals.get(typ, manual_cnt))
            missing_cnt = max(0, total_cnt - manual_cnt)
            rule = learned_rules.get(typ)

            summary_types.append({
                'type': typ,
                'has_rule': True,
                'manual_count': manual_cnt,
                'total_count': total_cnt,
                'missing_count': missing_cnt,
                'pages': sorted(list(set(label_page_distribution[typ]))) if label_page_distribution[typ] else [e['page'] + 1 for e in examples_by_type[typ]],
                'width_pt': round(rule['w'], 1) if rule else None,
                'height_pt': round(rule['h'], 1) if rule else None,
                'area_str': rule['content'] if rule else None,
                'scale_str': rule['scale_str'] if rule else None,
                'fill_opacity': rule['fill_opacity'] if rule else 0.3,
                'stroke': rule['stroke'] if rule else [1.0, 0.0, 0.0],
                'offset': [round(rule['dx'], 1), round(rule['dy'], 1)] if rule else [0.0, 0.0]
            })

        return {
            'rules': learned_rules,
            'manual_records': all_manual_records,
            'page_labels': page_labels,
            'summary_types': summary_types,
            'scale_dicts': scale_dicts
        }

    def complete_measurements(self, doc, rules, page_indices=None, enable_snap=True,
                              overlap_distance_threshold=16.0, overlap_iou_threshold=0.35,
                              selected_types=None):
        """
        Scans specified pages for unmeasured window labels, predicts window bounds,
        snaps to architectural drawing vector edges, verifies zero overlap with existing markups,
        and adds native Bluebeam-compatible Area polygon annotations (outline only).
        """
        if page_indices is None:
            page_indices = list(range(len(doc)))

        # Gather existing bounding boxes across selected pages to strictly prevent double counting
        existing_markups = collections.defaultdict(list) # page_idx -> list of (center, Rect, typ)

        # 1. Register all existing manual measurements
        for pi in page_indices:
            p = doc[pi]
            for annot in p.annots():
                rc, rect = WindowCompletionEngine._get_annot_geometry(annot)
                if rc and rect:
                    existing_markups[pi].append((rc, rect, 'MANUAL'))

        # Prepare ExtGState for 30% fill opacity if needed in PDF document
        gstate_xref = self._get_or_create_extgstate(doc, opacity=0.3)

        added_annotations = []
        snapping_stats = []

        for pi in page_indices:
            p = doc[pi]
            words = p.get_text('words')

            edge = self.render_edges(p, scale=self.scale_raster) if enable_snap else None

            # Filter candidate window labels matching known rules
            candidates = []
            for w in words:
                raw_text = w[4].strip()
                clean_text = re.sub(r'^[^\w]+|[^\w]+$', '', raw_text).upper()
                if clean_text in rules:
                    if selected_types is not None and clean_text not in selected_types:
                        continue
                    candidates.append({
                        'text': clean_text,
                        'bbox': (w[0], w[1], w[2], w[3]),
                        'center': ((w[0] + w[2]) / 2.0, (w[1] + w[3]) / 2.0)
                    })

            for cand in candidates:
                typ = cand['text']
                R = rules[typ]
                lc = cand['center']
                pred_center = (lc[0] + R['dx'], lc[1] + R['dy'])
                pred_rect = pymupdf.Rect(
                    pred_center[0] - R['w'] / 2.0,
                    pred_center[1] - R['h'] / 2.0,
                    pred_center[0] + R['w'] / 2.0,
                    pred_center[1] + R['h'] / 2.0
                )

                # Overlap check #1: Against predicted position
                is_overlap = False
                for ex_center, ex_rect, ex_typ in existing_markups[pi]:
                    if math.dist(ex_center, pred_center) < overlap_distance_threshold:
                        is_overlap = True
                        break
                    inter = pred_rect & ex_rect
                    if not inter.is_empty:
                        inter_area = inter.get_area()
                        min_box_area = min(pred_rect.get_area(), ex_rect.get_area())
                        if min_box_area > 0 and (inter_area / min_box_area) > overlap_iou_threshold:
                            is_overlap = True
                            break

                if is_overlap:
                    continue

                # Snapping to vector linework
                final_rect = pred_rect
                shift = (0.0, 0.0)
                gain = 0.0
                snapped = False

                if enable_snap and edge is not None:
                    final_rect, bs, ss, gain, shift, snapped = self.snap(
                        edge, pred_center, R['w'], R['h'],
                        search_pt=self.search_pt, min_gain=self.min_gain, max_shift=self.max_shift
                    )

                final_center = ((final_rect.x0 + final_rect.x1) / 2.0, (final_rect.y0 + final_rect.y1) / 2.0)

                # Overlap check #2: Against snapped position
                is_overlap_snapped = False
                for ex_center, ex_rect, ex_typ in existing_markups[pi]:
                    if math.dist(ex_center, final_center) < overlap_distance_threshold:
                        is_overlap_snapped = True
                        break
                    inter = final_rect & ex_rect
                    if not inter.is_empty:
                        inter_area = inter.get_area()
                        min_box_area = min(final_rect.get_area(), ex_rect.get_area())
                        if min_box_area > 0 and (inter_area / min_box_area) > overlap_iou_threshold:
                            is_overlap_snapped = True
                            break

                if is_overlap_snapped:
                    continue

                # Add Polygon annotation — outline only, no fill
                pts = [final_rect.tl, final_rect.bl, final_rect.br, final_rect.tr]
                annot = p.add_polygon_annot(pts)
                annot.set_info(
                    title=R['title'],
                    subject=R['subject'],
                    content=R['content']
                )
                # Clean outline only - no fill blocking architectural details
                annot.set_colors(
                    stroke=tuple(R['stroke']),
                    fill=None
                )
                annot.set_border(width=1)
                annot.set_opacity(1.0)
                annot.update()

                # --- Guarantee no fill in Bluebeam ---
                # /IC [] = empty interior color array → Bluebeam treats as "no fill"
                doc.xref_set_key(annot.xref, 'IC', '[]')

                # Rewrite the AP (Appearance Stream) to stroke-only: remove any fill operators.
                # PyMuPDF may bake rg+b ops; we force a clean 'RG + s' (stroke-only) stream.
                ap_m = re.search(r'/N\s+(\d+)\s+0\s+R',
                                 doc.xref_object(annot.xref, compressed=False))
                if ap_m:
                    ap_xref = int(ap_m.group(1))
                    try:
                        raw_ap = doc.xref_stream(ap_xref)
                        if raw_ap:
                            # Remove fill color set (rg) and fill+stroke op (b) lines,
                            # keep only stroke ops
                            lines = raw_ap.split(b'\n')
                            clean_lines = []
                            for ln in lines:
                                s = ln.strip()
                                # Drop "R G B rg" (set fill color) and "b"/"b*" (fill+stroke)
                                if re.match(rb'^[\d.\s]+rg\s*$', s):
                                    continue
                                if s in (b'b', b'b*'):
                                    clean_lines.append(b's')  # stroke only
                                    continue
                                clean_lines.append(ln)
                            doc.update_stream(ap_xref, b'\n'.join(clean_lines))
                    except Exception:
                        pass  # Non-critical; Bluebeam will use /IC [] for fill decision

                # Set exact Bluebeam Revu dictionary keys
                stroke_hex = "#{:02X}{:02X}{:02X}".format(
                    int(R['stroke'][0] * 255),
                    int(R['stroke'][1] * 255),
                    int(R['stroke'][2] * 255)
                )

                xml_body = (
                    f'<?xml version="1.0"?>'
                    f'<body xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" '
                    f'xfa:contentType="text/html" xfa:APIVersion="BluebeamPDFRevu:2018" xfa:spec="2.2.0" '
                    f'style="font:Helvetica 12pt; text-align:center; line-height:13.8pt; color:{stroke_hex}" '
                    f'xmlns="http://www.w3.org/1999/xhtml"><p>{R["content"]}</p></body>'
                )

                doc.xref_set_key(annot.xref, 'IT', '/PolygonDimension')
                doc.xref_set_key(annot.xref, 'Subj', f'({R["subject"]})')
                doc.xref_set_key(annot.xref, 'Cap', 'true')
                doc.xref_set_key(annot.xref, 'AlignOnSegment', 'true')
                doc.xref_set_key(annot.xref, 'MeasurementTypes', '129')
                doc.xref_set_key(annot.xref, 'SlopeType', '0')
                doc.xref_set_key(annot.xref, 'PitchRun', '12')
                doc.xref_set_key(annot.xref, 'Label', '()')
                doc.xref_set_key(annot.xref, 'DS', f'(font: Helvetica 12pt; text-align:center; line-height:13.8pt; color:{stroke_hex})')
                doc.xref_set_key(annot.xref, 'FillOpacity', '0')
                doc.xref_set_key(annot.xref, 'ca', '0')
                doc.xref_set_key(annot.xref, 'CA', '1.0')
                doc.xref_set_key(annot.xref, 'RC', pymupdf.get_pdf_str(xml_body))

                if R['measure_xref']:
                    doc.xref_set_key(annot.xref, 'Measure', f"{R['measure_xref']} 0 R")

                # Register in existing list so future candidates on the same page don't overlap
                existing_markups[pi].append((final_center, final_rect, typ))
                
                added_record = {
                    'page': pi + 1,
                    'type': typ,
                    'rect': [round(final_rect.x0, 1), round(final_rect.y0, 1), round(final_rect.x1, 1), round(final_rect.y1, 1)],
                    'center': [round(final_center[0], 1), round(final_center[1], 1)],
                    'width_pt': round(final_rect.width, 1),
                    'height_pt': round(final_rect.height, 1),
                    'area_str': R['content'],
                    'snapped': snapped,
                    'shift': [round(shift[0], 2), round(shift[1], 2)],
                    'gain': round(gain, 4)
                }
                added_annotations.append(added_record)
                snapping_stats.append(added_record)

        return {
            'added_count': len(added_annotations),
            'added_annotations': added_annotations,
            'counts_by_type': dict(collections.Counter(a['type'] for a in added_annotations)),
            'counts_by_page': dict(collections.Counter(a['page'] for a in added_annotations)),
            'snapped_count': sum(1 for a in snapping_stats if a['snapped'])
        }

    @staticmethod
    def _get_or_create_extgstate(doc, opacity=0.3):
        """
        Creates or references a PDF ExtGState object for transparent fill.
        """
        # Safely search existing xrefs
        for xref in range(1, min(doc.xref_length(), 500)):
            try:
                if doc.xref_is_free(xref) or doc.xref_is_stream(xref):
                    continue
                obj = doc.xref_object(xref, compressed=False)
                if '/Type /ExtGState' in obj and f'/ca {opacity:.1f}' in obj:
                    return xref
            except Exception:
                continue

        try:
            new_xref = doc.xref_create()
            doc.xref_set_key(new_xref, 'Type', '/ExtGState')
            doc.xref_set_key(new_xref, 'ca', f'{opacity:.2f}')
            doc.xref_set_key(new_xref, 'CA', '1.0')
            return new_xref
        except Exception:
            return None

    @staticmethod
    def render_page_preview_image(page, zoom=1.5, max_dim=1800):
        """
        Renders a page to high-quality JPEG base64 data URI for browser canvas display.
        Uses annots=False so PDF annotations are NOT rendered into the raster pixels,
        allowing the interactive HTML5 canvas overlay to render transparent or outlined markups!
        """
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, annots=False)
        img_bytes = pix.tobytes("jpeg")
        b64 = base64.b64encode(img_bytes).decode('ascii')
        return {
            'width': pix.width,
            'height': pix.height,
            'zoom': zoom,
            'data_uri': f"data:image/jpeg;base64,{b64}"
        }

    @staticmethod
    def generate_takeoff_csv(summary_types, added_counts_by_type):
        """
        Generates CSV takeoff schedule string.
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Window Type", "Manual Measured", "Auto-Completed", "Total Windows",
            "Width (pt)", "Height (pt)", "Unit Area (sf)", "Total Area (sf)", "Elevation Sheets"
        ])
        
        total_windows_all = 0
        total_area_all = 0.0

        for item in summary_types:
            typ = item['type']
            manual = item['manual_count']
            added = added_counts_by_type.get(typ, 0)
            total = manual + added
            total_windows_all += total

            # Parse unit area number from area_str e.g. "40 sf"
            unit_area = 0.0
            if item.get('area_str'):
                num_m = re.search(r'[-+]?(?:\d*\.\d+|\d+)', item['area_str'])
                if num_m:
                    unit_area = float(num_m.group(0))

            tot_area = round(total * unit_area, 2)
            total_area_all += tot_area

            writer.writerow([
                typ,
                manual,
                added,
                total,
                item.get('width_pt', ''),
                item.get('height_pt', ''),
                item.get('area_str', ''),
                f"{tot_area} sf" if unit_area > 0 else '',
                ", ".join(str(p) for p in item.get('pages', []))
            ])

        writer.writerow([])
        writer.writerow(["TOTALS", "", "", total_windows_all, "", "", "", f"{round(total_area_all, 2)} sf", ""])
        return output.getvalue()
