#!/usr/bin/env python3
"""
Window Area Measurement Tool (v2 - refined-corner matcher)
===========================================================
Completes Bluebeam "Area Measurement" markups on architectural elevation PDFs.

Measure ONE window of each type by hand (a 4-point Area measurement on the window frame, with its tag inside).
The tool learns each type, finds every other tag of that type, snaps an editable Area markup onto each window and
writes a NEW PDF. The input file is never modified.

USAGE (CLI)
    python engine.py elevations.pdf
    python engine.py elevations.pdf -o completed.pdf --skip-pages 6 --types W01,W05
    python engine.py elevations.pdf --no-adjust-manual      # leave your own markups exactly as drawn
    python engine.py elevations.pdf --dry-run               # learn + report only

WEB SUITE INTEGRATION
    Exposes WindowCompletionEngine with:
      - extract_manual_measurements(doc, label_regex)
      - complete_measurements(doc, rules, page_indices, ...)
      - render_page_preview_image(page, zoom)
      - _get_annot_geometry(annot)
      - generate_takeoff_csv(summary_types, counts_by_type)
"""
import argparse, collections, csv, datetime, math, os, re, statistics, sys, time, io, base64

try:
    import fitz, numpy as np, cv2
    from scipy.spatial import cKDTree
    pymupdf = fitz
except ImportError as exc:  # pragma: no cover
    sys.exit(f"Missing dependency: {exc.name}.  pip install pymupdf numpy opencv-python-headless scipy pillow")

DEFAULT_TAG_REGEX = r'^[A-Za-z]{1,4}\d{1,4}(?:-[A-Za-z0-9]{1,6})?$'
DEFAULT_LABEL_REGEX = DEFAULT_TAG_REGEX
S = 6              # px per pt for matching tiles
DARK = 175
ARM = .28          # outer corner arm length, fraction of W / H
INNER_ARM = .09
TAG_TOL = 2.0
CENTER_MAX = .35
SPAN_MIN, END_MIN = .75, .60
SNAP_LIM = 2.5
DUP_OVERLAP = .50
NON_ELEVATION_TITLE = re.compile(
    r'^(?:WINDOW|DOOR|SLIDING DOOR|FENESTRATION|FINISH|HARDWARE|ROOM|WALL|TYPICAL)?\s*(?:SCHEDULES?|LEGENDS?|DETAILS?)$')
COPY_KEYS = ['IT', 'Cap', 'AlignOnSegment', 'MeasurementTypes', 'SlopeType', 'PitchRun', 'DepthUnit', 'Label',
             'FillOpacity', 'CA']
NUM = r'[-+]?(?:\d*\.\d+|\d+)'
DIR = {'BL': (1, -1), 'BR': (-1, -1), 'TL': (1, 1), 'TR': (-1, 1)}
ADJ = {'BL': ['BR', 'TL'], 'BR': ['BL', 'TR'], 'TL': ['TR', 'BL'], 'TR': ['TL', 'BR']}
MANUAL_COLOR = (0.000, 0.447, 0.698)   # #0072B2 blue
GOOD_COLOR = (0.000, 0.620, 0.451)     # #009E73 bluish green
PROBLEM_COLOR = (0.835, 0.369, 0.000)  # #D55E00 vermillion

EVIDENCE = {5: 'Definitive++', 4: 'Definitive', 3: 'Very strong', 2: 'Strong', 1: 'Fallback'}


def log(*a): print(*a, flush=True)


def corners_of(r): return {'BL': (r.x0, r.y1), 'BR': (r.x1, r.y1), 'TL': (r.x0, r.y0), 'TR': (r.x1, r.y0)}


def rect_from(anchor, x, y, w, h):
    return {'BL': fitz.Rect(x, y - h, x + w, y), 'BR': fitz.Rect(x - w, y - h, x, y),
            'TL': fitz.Rect(x, y, x + w, y + h), 'TR': fitz.Rect(x - w, y, x, y + h)}[anchor]


# ------------------------------------------------------------------------------------------------------------------
# A small high-resolution tile of the drawing with O(1) line / corner queries
# ------------------------------------------------------------------------------------------------------------------
class Tile:
    def __init__(self, dl, page_rect, clip):
        clip = clip & page_rect
        pm = dl.get_pixmap(matrix=fitz.Matrix(S, S), colorspace=fitz.csGRAY, alpha=False, clip=clip)
        self.G = np.frombuffer(pm.samples, np.uint8).reshape(pm.height, pm.width)
        self.ox, self.oy = pm.x / S + page_rect.x0, pm.y / S + page_rect.y0
        self.H, self.W = self.G.shape
        self.DK = (self.G < DARK).astype(np.uint8)
        k = np.ones((1, 5), np.uint8)
        vb = cv2.dilate(self.DK, k, borderType=cv2.BORDER_CONSTANT, borderValue=0)      # any dark across 5 columns
        hb = cv2.dilate(self.DK, k.T, borderType=cv2.BORDER_CONSTANT, borderValue=0)    # any dark across 5 rows
        self.CV = np.zeros((self.H + 1, self.W), np.int32); np.cumsum(vb, axis=0, out=self.CV[1:])
        self.CH = np.zeros((self.H, self.W + 1), np.int32); np.cumsum(hb, axis=1, out=self.CH[:, 1:])
        self.II = cv2.integral(self.DK)
        self.D3 = cv2.dilate(self.DK, np.ones((3, 3), np.uint8))

    def px(self, x): return int(round((x - self.ox) * S))
    def py(self, y): return int(round((y - self.oy) * S))
    def ptx(self, i): return i / S + self.ox
    def pty(self, j): return j / S + self.oy

    def score(self, name, x, y, w, h, frac=ARM):
        """strength of an L of orientation `name` with its corner exactly at (x, y)"""
        ix, iy = self.px(x), self.py(y); ah = max(5, int(w * S * frac)); av = max(5, int(h * S * frac)); b = 2
        if not (b <= ix < self.W - b and b <= iy < self.H - b): return 0.0
        y0, y1 = (max(0, iy - av), iy + 1) if name in ('BL', 'BR') else (iy, min(self.H, iy + av + 1))
        x0, x1 = (ix, min(self.W, ix + ah + 1)) if name in ('BL', 'TL') else (max(0, ix - ah), ix + 1)
        vv = (self.CV[y1, ix] - self.CV[y0, ix]) / (y1 - y0)
        hh = (self.CH[iy, x1] - self.CH[iy, x0]) / (x1 - x0)
        II = self.II
        cc = (II[iy + b + 1, ix + b + 1] - II[iy - b, ix + b + 1] - II[iy + b + 1, ix - b] + II[iy - b, ix - b]) / 25
        return .45 * min(vv, hh) + .45 * math.sqrt(vv * hh) + .1 * cc

    def corner_index(self, w, h):
        """outer-frame L corners, refined to the real intersection, indexed per orientation"""
        mh = max(4, int(ARM * w * S)); mv = max(4, int(ARM * h * S)); d8 = self.D3
        ero = lambda k, anc: cv2.erode(d8, k, anchor=anc, borderType=cv2.BORDER_CONSTANT, borderValue=0).astype(bool)
        U = ero(np.ones((mv, 1), np.uint8), (0, mv - 1)); Dn = ero(np.ones((mv, 1), np.uint8), (0, 0))
        R = ero(np.ones((1, mh), np.uint8), (0, 0)); L = ero(np.ones((1, mh), np.uint8), (mh - 1, 0))
        out = {}
        for name, cm in {'BL': U & R, 'BR': U & L, 'TL': Dn & R, 'TR': Dn & L}.items():
            n, lab, st, cen = cv2.connectedComponentsWithStats(cm.astype(np.uint8), 8); pts = []; vals = []
            for i in range(1, n):
                if st[i, 4] > 1000: continue
                bx, by, bw, bh = st[i, :4]
                ys, xs = np.where(lab[by:by + bh, bx:bx + bw] == i); ys = ys + by; xs = xs + bx
                c = (self.ptx(cen[i][0]), self.pty(cen[i][1])); best = None
                for k in range(0, len(xs), max(1, len(xs) // 80)):
                    q = (self.ptx(xs[k]), self.pty(ys[k])); sc = self.score(name, *q, w, h)
                    key = (sc, -math.dist(q, c))
                    if best is None or key > best[0]: best = (key, q, sc)
                if best and best[2] >= .58: pts.append(best[1]); vals.append(best[2])
            out[name] = (cKDTree(pts) if pts else None, pts, vals)
        return out

    def inner(self, name, o, w, h):
        """first correctly oriented inner L 0.5-3 pt inward from outer corner o"""
        sx, sy = DIR[name]; best = None
        for dx in np.arange(.5, 3.01, .25):
            for dy in np.arange(.5, 3.01, .25):
                q = (o[0] + sx * dx, o[1] + sy * dy); sc = self.score(name, *q, w, h, INNER_ARM)
                if sc >= .52:
                    k = (dx + dy, -sc)
                    if best is None or k < best[0]: best = (k, q, (dx, dy), sc)
        return best

    def _prof_v(self, x, y0, y1):
        ix = self.px(x); a, b = sorted((self.py(y0), self.py(y1)))
        if ix < 1 or ix >= self.W - 1: return np.zeros(0, bool)
        return (self.G[max(0, a):b + 1, ix - 1:ix + 2] < DARK).any(1)

    def _prof_h(self, y, x0, x1):
        iy = self.py(y); a, b = sorted((self.px(x0), self.px(x1)))
        if iy < 1 or iy >= self.H - 1: return np.zeros(0, bool)
        return (self.G[iy - 1:iy + 2, max(0, a):b + 1] < DARK).any(0)

    @staticmethod
    def _cov(pr):
        if pr.size == 0: return (0.0, 0.0)
        k = max(2, int(len(pr) * .15)); return (float(pr.mean()), float(min(pr[:k].mean(), pr[-k:].mean())))

    def side_span(self, r):
        """(coverage, end coverage) of the best drawn line within +/-0.5 pt of each side"""
        out = {}
        for name in 'LRTB':
            best = (0.0, 0.0)
            for o in range(-3, 4):
                d = o / S
                if name == 'L': pr = self._prof_v(r.x0 + d, r.y0, r.y1)
                elif name == 'R': pr = self._prof_v(r.x1 + d, r.y0, r.y1)
                elif name == 'T': pr = self._prof_h(r.y0 + d, r.x0, r.x1)
                else: pr = self._prof_h(r.y1 + d, r.x0, r.x1)
                best = max(best, self._cov(pr))
            out[name] = best
        return out

    def refine_sides(self, r, lim=SNAP_LIM):
        """move each side to the nearest line that spans it and reaches both corners"""
        def best(cur, fn, *span):
            c = []
            for d in np.arange(-lim, lim + .01, 1 / S):
                v, e = self._cov(fn(cur + d, *span))
                if v >= .80 and e >= .60: c.append((abs(d), cur + d))
            return min(c)[1] if c else cur
        x0 = best(r.x0, self._prof_v, r.y0, r.y1); x1 = best(r.x1, self._prof_v, r.y0, r.y1)
        y0 = best(r.y0, self._prof_h, x0, x1); y1 = best(r.y1, self._prof_h, x0, x1)
        q = fitz.Rect(x0, y0, x1, y1)
        ok = .85 * r.width < q.width < 1.15 * r.width and .85 * r.height < q.height < 1.15 * r.height
        return q if ok else r

    def enclosing(self, tc, w, h):
        cx, cy = tc
        def vs(x):
            pr = self._prof_v(x, cy - .65 * h, cy + .65 * h); return float(pr.mean()) if pr.size else 0.0
        def hs(y):
            pr = self._prof_h(y, cx - .65 * w, cx + .65 * w); return float(pr.mean()) if pr.size else 0.0
        def first(sign, lim, fn, base):
            for d in np.arange(.5, lim + .01, .25):
                if fn(base + sign * d) >= .60: return base + sign * d
            return None
        return (first(-1, w, vs, cx), first(1, w, vs, cx), first(-1, h, hs, cy), first(1, h, hs, cy))


def enclosure_error(r, enc):
    v = [abs(a - z) for a, z in zip((r.x0, r.x1, r.y0, r.y1), enc) if z is not None]
    return sum(v) / len(v) if v else 999.0


def side_ok(sp): return sum(v[0] >= SPAN_MIN and v[1] >= END_MIN for v in sp.values())


# ------------------------------------------------------------------------------------------------------------------
def match_window(dl, prect, tc, w, h, other_tags):
    clip = fitz.Rect(tc[0] - 2.2 * w - 6, tc[1] - 2.2 * h - 6, tc[0] + 2.2 * w + 6, tc[1] + 2.2 * h + 6)
    T = Tile(dl, prect, clip)
    idx = T.corner_index(w, h)
    def near(name, q, r=2.1):
        tree, pts, vals = idx[name]
        if not tree: return None
        ids = tree.query_ball_point(q, r)
        if not ids: return None
        i = max(ids, key=lambda z: (vals[z], -math.dist(pts[z], q))); return pts[i], vals[i]
    enc = T.enclosing(tc, w, h); cands = []
    for anchor in DIR:
        tree, pts, vals = idx[anchor]
        if not tree: continue
        for i in tree.query_ball_point(tc, max(w, h) * 1.42):
            a = pts[i]
            if abs(a[0] - tc[0]) > w or abs(a[1] - tc[1]) > h: continue
            r = rect_from(anchor, a[0], a[1], w, h)
            if not (r.x0 - TAG_TOL <= tc[0] <= r.x1 + TAG_TOL and r.y0 - TAG_TOL <= tc[1] <= r.y1 + TAG_TOL): continue
            cd = math.hypot(((r.x0 + r.x1) / 2 - tc[0]) / w, ((r.y0 + r.y1) / 2 - tc[1]) / h)
            if cd > CENTER_MAX: continue
            if any(r.x0 + .5 < q[0] < r.x1 - .5 and r.y0 + .5 < q[1] < r.y1 - .5 for q in other_tags): continue
            cp = corners_of(r); found = []
            for q in ADJ[anchor]:
                z = near(q, cp[q]); found.append((q, z, T.inner(q, z[0], w, h) if z else None))
            ai = T.inner(anchor, a, w, h)
            no = sum(z is not None for _, z, _ in found); ni = sum(z is not None and ii is not None for _, z, ii in found)
            if ai and no == 2 and ni == 2: lev = 5
            elif ai and no == 2 and ni >= 1: lev = 4
            elif ai and no == 2: lev = 3
            elif ai and ni >= 1: lev = 2
            elif no >= 1: lev = 1
            else: continue
            sp = T.side_span(r)
            cands.append((lev, side_ok(sp), round(min(v[0] for v in sp.values()), 2), -enclosure_error(r, enc), vals[i],
                          -cd, r, anchor, no, ni))
    if not cands: return None
    lev, _, _, _, _, ncd, r, anchor, no, ni = max(cands, key=lambda c: c[:6])
    r2 = T.refine_sides(r); sp = T.side_span(r2)
    return dict(rect=r2, evidence=EVIDENCE[lev], level=lev, anchor=anchor, adj_outer=no, adj_inner=ni,
                sides=side_ok(sp), min_side=round(min(v[0] for v in sp.values()), 2), offset=round(-ncd, 3))


# ------------------------------------------------------------------------------------------------------------------
def read_manual(doc, page, annot):
    raw = doc.xref_object(annot.xref, False)
    if '/Subj (Area Measurement)' not in raw and '/IT /PolygonDimension' not in raw:
        if annot.info.get('subject') != 'Area Measurement':
            return None
    m = re.search(r'/Vertices\s*\[([^\]]+)\]', raw, re.S)
    if not m:
        try:
            verts = annot.vertices
            if verts and len(verts) == 4:
                xs = [pt[0] for pt in verts]
                ys = [pt[1] for pt in verts]
                return fitz.Rect(min(xs), min(ys), max(xs), max(ys)), raw
        except Exception:
            pass
        return None
    v = [float(z) for z in re.findall(NUM, m.group(1))]
    if len(v) != 8:
        try:
            verts = annot.vertices
            if verts and len(verts) == 4:
                xs = [pt[0] for pt in verts]
                ys = [pt[1] for pt in verts]
                return fitz.Rect(min(xs), min(ys), max(xs), max(ys)), raw
        except Exception:
            pass
        return None
    xs, ys = v[0::2], v[1::2]; area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    sh = abs(sum(xs[i] * ys[(i + 1) % 4] - xs[(i + 1) % 4] * ys[i] for i in range(4))) / 2
    if area <= 0 or abs(sh - area) / area > .03: return None
    pts = [fitz.Point(v[i], v[i + 1]) * page.transformation_matrix for i in range(0, 8, 2)]
    return fitz.Rect(min(q.x for q in pts), min(q.y for q in pts), max(q.x for q in pts), max(q.y for q in pts)), raw


def parse_content(t):
    m = re.match(r'\s*([0-9]*\.?[0-9]+)\s*(\S+)', t or ''); return (float(m.group(1)), m.group(2)) if m else (None, None)


def fmt_area(v, unit): return f'{v:.2f}'.rstrip('0').rstrip('.') + f' {unit}'


def overlap(a, b):
    i = a & b; return 0 if i.is_empty else i.get_area() / min(a.get_area(), b.get_area())


def parse_pages(spec, n):
    out = set()
    for part in (spec or '').split(','):
        part = part.strip()
        if not part: continue
        if '-' in part: a, b = part.split('-', 1); out.update(range(int(a), int(b) + 1))
        else: out.add(int(part))
    return {x - 1 for x in out if 1 <= x <= n}


def non_elevation(page):
    for line in page.get_text('text').splitlines():
        s = ' '.join(line.upper().split())
        if NON_ELEVATION_TITLE.match(s): return s
    return None


def set_rich_text(doc, xref, text):
    t, rc = doc.xref_get_key(xref, 'RC')
    if t != 'null' and rc and text:
        doc.xref_set_key(xref, 'RC', fitz.get_pdf_str(re.sub(r'>[^<>]*</body>', f'>{text}</body>', rc)))


def write_vertices(doc, page, xref, r, content):
    """move an existing 4-point polygon to rectangle r (page coords), keeping vertex order, and relabel it"""
    inv = ~page.transformation_matrix
    pts = [fitz.Point(*q) * inv for q in ((r.x0, r.y0), (r.x0, r.y1), (r.x1, r.y1), (r.x1, r.y0))]
    raw = doc.xref_object(xref, False)
    old = [float(z) for z in re.findall(NUM, re.search(r'/Vertices\s*\[([^\]]+)\]', raw, re.S).group(1))]
    oldp = [fitz.Point(old[i], old[i + 1]) for i in range(0, 8, 2)]
    new = [min(pts, key=lambda q: abs(q.x - o.x) + abs(q.y - o.y)) for o in oldp]
    doc.xref_set_key(xref, 'Vertices', '[' + ' '.join(f'{q.x:.4f} {q.y:.4f}' for q in new) + ']')
    if content:
        doc.xref_set_key(xref, 'Contents', fitz.get_pdf_str(content)); set_rich_text(doc, xref, content)
    page.load_annot(xref).update()


def add_measure(doc, page, r, ex, label, problem=False):
    an = page.add_polygon_annot([r.tl, r.bl, r.br, r.tr])
    an.set_info(title=ex.get('author') or 'WindowTool', subject='Area Measurement', content=label)
    color = PROBLEM_COLOR if problem else GOOD_COLOR
    an.set_colors(stroke=color, fill=color)
    an.set_opacity(.30 if problem else .15)
    an.set_border(width=2.0 if problem else 1.0, dashes=[4, 3] if problem else None)
    an.update()
    doc.xref_set_key(an.xref, 'Subj', '(Area Measurement)')
    if ex.get('measure') is not None: doc.xref_set_key(an.xref, 'Measure', f"{ex['measure']} 0 R")
    if 'xref' in ex:
        for key in COPY_KEYS:
            t, val = doc.xref_get_key(ex['xref'], key)
            if t != 'null' and val not in (None, ''): doc.xref_set_key(an.xref, key, val)
    set_rich_text(doc, an.xref, label)
    now = datetime.datetime.now().strftime('D:%Y%m%d%H%M%S')
    doc.xref_set_key(an.xref, 'CreationDate', fitz.get_pdf_str(now)); doc.xref_set_key(an.xref, 'M', fitz.get_pdf_str(now))


# ------------------------------------------------------------------------------------------------------------------
# Web Server & REST Engine Class Adapter
# ------------------------------------------------------------------------------------------------------------------
class WindowCompletionEngine:
    """
    Adapter class integrating the v2 refined-corner matcher into the OB360 web suite and server.py.
    """
    def __init__(self, scale_raster=2.0, search_pt=18.0, step_pt=0.5, min_gain=0.003, max_shift=16.0):
        self.scale_raster = scale_raster
        self.search_pt = search_pt
        self.step_pt = step_pt
        self.min_gain = min_gain
        self.max_shift = max_shift

    @staticmethod
    def _get_annot_geometry(annot):
        """
        Returns (center_point, fitz.Rect) in PyMuPDF page coordinate space.
        Correctly accounts for PDF CropBox / MediaBox origin offsets.
        """
        try:
            page = annot.parent
            doc = page.doc
            got = read_manual(doc, page, annot)
            if got:
                box, _ = got
                rc = ((box.x0 + box.x1) / 2.0, (box.y0 + box.y1) / 2.0)
                return rc, box
        except Exception:
            pass

        try:
            verts = annot.vertices
            if verts:
                xs = [pt[0] for pt in verts]
                ys = [pt[1] for pt in verts]
                rc = ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)
                rect = fitz.Rect(min(xs), min(ys), max(xs), max(ys))
                return rc, rect
        except Exception:
            pass

        if annot.rect:
            r = annot.rect
            rc = ((r.x0 + r.x1) / 2.0, (r.y0 + r.y1) / 2.0)
            return rc, r
        return None, None

    @staticmethod
    def render_page_preview_image(page, zoom=1.5, max_dim=1800):
        """
        Renders a page to high-quality JPEG base64 data URI for browser canvas display.
        Uses annots=False so PDF annotations are NOT rendered into the raster pixels,
        allowing the interactive HTML5 canvas overlay to render transparent or outlined markups.
        """
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, annots=False)
        img_bytes = pix.tobytes("jpeg")
        b64 = base64.b64encode(img_bytes).decode('ascii')
        return {
            'width': pix.width,
            'height': pix.height,
            'zoom': zoom,
            'data_uri': f"data:image/jpeg;base64,{b64}"
        }

    def extract_manual_measurements(self, doc, label_regex=None, skip_pages=None, auto_skip=True):
        """
        Learns window types from manual polygon area measurements using refined-corner Tile matching.
        """
        tag_pat = label_regex or DEFAULT_TAG_REGEX
        tag_re = re.compile(tag_pat)
        n = len(doc)
        skip = parse_pages(skip_pages, n) if skip_pages else set()
        plan = []
        for i in range(n):
            if i in skip: continue
            if auto_skip and non_elevation(doc[i]): continue
            plan.append(i)
        if not plan:
            plan = list(range(n))

        ctx = {}
        for pi in plan:
            p = doc[pi]
            raw_words = p.get_text('words')
            tags = []
            for w in raw_words:
                clean = re.sub(r'^[^\w]+|[^\w]+$', '', w[4])
                if tag_re.fullmatch(clean):
                    tags.append((w[0], w[1], w[2], w[3], clean))
            ctx[pi] = dict(dl=p.get_displaylist(annots=False), tags=tags,
                           centres=[((w[0] + w[2]) / 2, (w[1] + w[3]) / 2) for w in tags])

        examples = collections.defaultdict(list)
        all_manual_records = []
        scale_dicts = {}

        for pi in plan:
            p = doc[pi]; C = ctx[pi]
            for a in p.annots() or []:
                if a.type[1] != 'Polygon': continue
                got = read_manual(doc, p, a)
                if not got: continue
                box, raw = got
                inside = [w for w in C['tags'] if box.x0 - 3 <= (w[0] + w[2]) / 2 <= box.x1 + 3 and box.y0 - 3 <= (w[1] + w[3]) / 2 <= box.y1 + 3]
                if not inside:
                    # Fallback inside search
                    raw_words = p.get_text('words')
                    fb = []
                    for w in raw_words:
                        clean = re.sub(r'^[^\w]+|[^\w]+$', '', w[4])
                        if clean and tag_re.fullmatch(clean):
                            wc = ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
                            if box.x0 - 6 <= wc[0] <= box.x1 + 6 and box.y0 - 6 <= wc[1] <= box.y1 + 6:
                                fb.append((w[0], w[1], w[2], w[3], clean))
                    inside = fb
                if not inside: continue

                c = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
                tg = min(inside, key=lambda w: math.dist(c, ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)))
                T = Tile(C['dl'], p.rect, fitz.Rect(box.x0 - 8, box.y0 - 8, box.x1 + 8, box.y1 + 8))
                snapped = T.refine_sides(box)
                val, unit = parse_content(a.info.get('content'))
                mm = re.search(r'/Measure\s+(\d+)\s+0\s+R', raw)
                measure_xref = int(mm.group(1)) if mm else None
                bs = re.search(r'/W\s+([0-9.]+)', doc.xref_get_key(a.xref, 'BS')[1] or '')
                st = a.colors or {}

                scale_str = ''
                if measure_xref:
                    try:
                        measure_obj = doc.xref_object(measure_xref, compressed=False)
                        scale_dicts[measure_xref] = measure_obj
                        r_match = re.search(r'/R\s*\(([^)]+)\)', measure_obj)
                        if r_match: scale_str = r_match.group(1)
                    except Exception:
                        pass

                tag_name = tg[4]
                ex_item = dict(
                    page=pi,
                    tc=((tg[0] + tg[2]) / 2, (tg[1] + tg[3]) / 2),
                    box=box,
                    snapped=snapped,
                    xref=a.xref,
                    content=a.info.get('content'),
                    k=val / (box.width * box.height) if val else None,
                    unit=unit or 'sf',
                    measure=measure_xref,
                    scale_str=scale_str,
                    author=a.info.get('title') or '',
                    stroke=st.get('stroke'),
                    fill=st.get('fill'),
                    bw=float(bs.group(1)) if bs else 1.0,
                    tag=tag_name
                )
                examples[tag_name].append(ex_item)

                all_manual_records.append({
                    'page': pi,
                    'xref': a.xref,
                    'rect': [box.x0, box.y0, box.x1, box.y1],
                    'snapped_rect': [snapped.x0, snapped.y0, snapped.x1, snapped.y1],
                    'center': [round(c[0], 1), round(c[1], 1)],
                    'w': round(box.width, 1),
                    'h': round(box.height, 1),
                    'content': a.info.get('content', ''),
                    'title': a.info.get('title', 'Manual'),
                    'subject': 'Area Measurement',
                    'matched_label': tag_name,
                    'type': tag_name,
                    'scale_str': scale_str
                })

        rules = {}
        for t, es in examples.items():
            w = statistics.median(e['snapped'].width for e in es)
            h = statistics.median(e['snapped'].height for e in es)
            base_ex = min(es, key=lambda e: abs(e['snapped'].width - w) + abs(e['snapped'].height - h))
            rules[t] = dict(base_ex, w=w, h=h, n=len(es), type=t)

        alltags = collections.Counter(w[4] for pi in plan for w in ctx[pi]['tags'])
        label_page_distribution = collections.defaultdict(set)
        for pi in plan:
            for w in ctx[pi]['tags']:
                label_page_distribution[w[4]].add(pi + 1)

        summary_types = []
        for t in sorted(rules.keys()):
            r = rules[t]
            man_cnt = len(examples[t])
            tot_cnt = max(man_cnt, alltags.get(t, man_cnt))
            miss_cnt = max(0, tot_cnt - man_cnt)
            area_str = r['content'] or (fmt_area(r['k'] * r['w'] * r['h'], r['unit']) if r['k'] else '')
            summary_types.append({
                'type': t,
                'has_rule': True,
                'manual_count': man_cnt,
                'total_count': tot_cnt,
                'missing_count': miss_cnt,
                'pages': sorted(list(label_page_distribution[t])) if label_page_distribution[t] else [e['page'] + 1 for e in examples[t]],
                'width_pt': round(r['w'], 1),
                'height_pt': round(r['h'], 1),
                'area_str': area_str,
                'scale_str': r.get('scale_str', ''),
                'stroke': r.get('stroke') or [0.0, 0.62, 0.451],
                'fill_opacity': 0.15
            })

        return {
            'rules': rules,
            'manual_records': all_manual_records,
            'summary_types': summary_types,
            'scale_dicts': scale_dicts,
            'plan': plan
        }

    def complete_measurements(self, doc, rules, page_indices=None, enable_snap=True,
                              overlap_distance_threshold=16.0, overlap_iou_threshold=0.35,
                              selected_types=None, no_adjust_manual=False):
        """
        Executes matching across pages using the refined-corner Tile matcher.
        """
        n = len(doc)
        if page_indices is None:
            page_indices = list(range(n))

        tag_re = re.compile(DEFAULT_TAG_REGEX)
        ctx = {}
        for pi in page_indices:
            p = doc[pi]
            raw_words = p.get_text('words')
            tags = []
            for w in raw_words:
                clean = re.sub(r'^[^\w]+|[^\w]+$', '', w[4])
                if tag_re.fullmatch(clean):
                    tags.append((w[0], w[1], w[2], w[3], clean))
            ctx[pi] = dict(dl=p.get_displaylist(annots=False), tags=tags,
                           centres=[((w[0] + w[2]) / 2, (w[1] + w[3]) / 2) for w in tags])

        examples = collections.defaultdict(list)
        manual_boxes = collections.defaultdict(list)
        for pi in page_indices:
            p = doc[pi]; C = ctx[pi]
            for a in p.annots() or []:
                if a.type[1] != 'Polygon': continue
                got = read_manual(doc, p, a)
                if not got: continue
                box, raw = got
                manual_boxes[pi].append(box)
                inside = [w for w in C['tags'] if box.x0 - 3 <= (w[0] + w[2]) / 2 <= box.x1 + 3 and box.y0 - 3 <= (w[1] + w[3]) / 2 <= box.y1 + 3]
                if not inside:
                    # Fallback check
                    raw_words = p.get_text('words')
                    fb = []
                    for w in raw_words:
                        clean = re.sub(r'^[^\w]+|[^\w]+$', '', w[4])
                        if clean and tag_re.fullmatch(clean):
                            wc = ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
                            if box.x0 - 6 <= wc[0] <= box.x1 + 6 and box.y0 - 6 <= wc[1] <= box.y1 + 6:
                                fb.append((w[0], w[1], w[2], w[3], clean))
                    inside = fb
                if not inside: continue

                c = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
                tg = min(inside, key=lambda w: math.dist(c, ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)))
                T = Tile(C['dl'], p.rect, fitz.Rect(box.x0 - 8, box.y0 - 8, box.x1 + 8, box.y1 + 8))
                snapped = T.refine_sides(box)
                val, unit = parse_content(a.info.get('content'))
                examples[tg[4]].append(dict(page=pi, tc=((tg[0] + tg[2]) / 2, (tg[1] + tg[3]) / 2), box=box, snapped=snapped,
                                            xref=a.xref, content=a.info.get('content'),
                                            k=val / (box.width * box.height) if val else None, unit=unit or 'sf'))

        # Adjust manual measurements if requested
        if not no_adjust_manual:
            for t, es in examples.items():
                for e in es:
                    r, b = e['snapped'], e['box']
                    moved = max(abs(r[i] - b[i]) for i in range(4))
                    if moved < 0.05: continue
                    p = doc[e['page']]
                    label = fmt_area(e['k'] * r.width * r.height, e['unit']) if e['k'] else None
                    write_vertices(doc, p, e['xref'], r, label)
                    manual_boxes[e['page']] = [r if q == b else q for q in manual_boxes[e['page']]]

        # QA colors: every original/manual Area markup is blue
        for t, es in examples.items():
            for e in es:
                pg = doc[e['page']]
                a = pg.load_annot(e['xref'])
                a.set_colors(stroke=MANUAL_COLOR, fill=MANUAL_COLOR)
                a.set_opacity(.15)
                a.set_border(width=1.5)
                a.update()

        added_annotations = []
        per_type = collections.Counter()
        counts_by_page = collections.Counter()
        rows = []

        for pi in page_indices:
            p = doc[pi]; C = ctx[pi]
            occupied = list(manual_boxes[pi])
            for tg, tc in zip(C['tags'], C['centres']):
                t = tg[4]
                if t not in rules: continue
                if selected_types is not None and t not in selected_types: continue
                R = rules[t]
                if any(o.x0 <= tc[0] <= o.x1 and o.y0 <= tc[1] <= o.y1 for o in manual_boxes[pi]): continue
                others = [q for q in C['centres'] if math.dist(q, tc) > .5]
                f = match_window(C['dl'], p.rect, tc, R['w'], R['h'], others)
                if not f: continue
                r = f['rect']
                if any(overlap(r, o) >= DUP_OVERLAP for o in occupied): continue
                label = fmt_area(R['k'] * r.width * r.height, R['unit']) if R.get('k') else (R.get('content') or '')
                flags = []
                if f['level'] < 4: flags.append(f"evidence {f['evidence']}")
                if f['sides'] < 4: flags.append(f"{f['sides']}/4 sides drawn")
                problem = bool(flags)

                add_measure(doc, p, r, R, label, problem=problem)
                occupied.append(r)
                per_type[t] += 1
                counts_by_page[pi + 1] += 1

                record = {
                    'page': pi + 1,
                    'type': t,
                    'rect': [round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)],
                    'center': [round((r.x0 + r.x1) / 2.0, 1), round((r.y0 + r.y1) / 2.0, 1)],
                    'width_pt': round(r.width, 1),
                    'height_pt': round(r.height, 1),
                    'area_str': label,
                    'evidence': f['evidence'],
                    'anchor': f['anchor'],
                    'sides': f['sides'],
                    'min_side': f['min_side'],
                    'offset': f['offset'],
                    'problem': problem,
                    'review': '; '.join(flags),
                    'snapped': True,
                    'shift': [0.0, 0.0]
                }
                added_annotations.append(record)
                rows.append(record)

        return {
            'added_count': len(added_annotations),
            'added_annotations': added_annotations,
            'counts_by_type': dict(per_type),
            'counts_by_page': dict(counts_by_page),
            'snapped_count': len(added_annotations),
            'rows': rows
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


# ------------------------------------------------------------------------------------------------------------------
# CLI Entrypoint
# ------------------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='Complete Bluebeam window Area measurements on elevation PDFs.')
    ap.add_argument('pdf'); ap.add_argument('-o', '--out')
    ap.add_argument('--pages', help='only these pages, e.g. "1-4,6"')
    ap.add_argument('--skip-pages', help='never mark these pages, e.g. "6"')
    ap.add_argument('--no-auto-skip', action='store_true', help='do not auto-skip SCHEDULE / LEGEND / DETAILS sheets')
    ap.add_argument('--tag-regex', default=DEFAULT_TAG_REGEX)
    ap.add_argument('--types', help='only these tags, e.g. "W01,W05"'); ap.add_argument('--exclude-types')
    ap.add_argument('--no-adjust-manual', action='store_true', help='do not snap your own markups to the drawn frame')
    ap.add_argument('--no-review', action='store_true'); ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    t0 = time.time(); src = os.path.abspath(args.pdf)
    if not os.path.isfile(src): sys.exit(f'File not found: {src}')
    out = os.path.abspath(args.out) if args.out else os.path.splitext(src)[0] + '_windows_completed.pdf'
    if out == src: sys.exit('Output path equals input path; choose another -o.')
    base = os.path.splitext(out)[0].replace('_completed', '')
    report_path, review_path = base + '_report.csv', base + '_review.png'
    tag_re = re.compile(args.tag_regex)
    only = {t.strip() for t in (args.types or '').split(',') if t.strip()}
    excl = {t.strip() for t in (args.exclude_types or '').split(',') if t.strip()}

    doc = fitz.open(src); n = len(doc)
    pages = sorted(parse_pages(args.pages, n)) if args.pages else list(range(n)); skip = parse_pages(args.skip_pages, n)
    plan = []
    for i in pages:
        if i in skip: log(f'  page {i+1}: skipped (--skip-pages)'); continue
        why = None if args.no_auto_skip else non_elevation(doc[i])
        if why: log(f'  page {i+1}: skipped ("{why}")'); continue
        plan.append(i)
    if not plan: sys.exit('No pages to process.')

    ctx = {}
    for pi in plan:
        p = doc[pi]; tags = [w for w in p.get_text('words') if tag_re.fullmatch(w[4])]
        ctx[pi] = dict(dl=p.get_displaylist(annots=False), tags=tags,
                       centres=[((w[0] + w[2]) / 2, (w[1] + w[3]) / 2) for w in tags])

    # ---- learn -------------------------------------------------------------------------------------------------
    examples = collections.defaultdict(list); manual_boxes = collections.defaultdict(list); notes = []
    for pi in plan:
        p = doc[pi]; C = ctx[pi]
        for a in p.annots() or []:
            if a.type[1] != 'Polygon': continue
            got = read_manual(doc, p, a)
            if not got: continue
            box, raw = got; manual_boxes[pi].append(box)
            inside = [w for w in C['tags'] if box.x0 - 3 <= (w[0] + w[2]) / 2 <= box.x1 + 3 and box.y0 - 3 <= (w[1] + w[3]) / 2 <= box.y1 + 3]
            if not inside: notes.append((pi + 1, 'manual markup without a tag inside - ignored')); continue
            c = ((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
            tg = min(inside, key=lambda w: math.dist(c, ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)))
            T = Tile(C['dl'], p.rect, fitz.Rect(box.x0 - 8, box.y0 - 8, box.x1 + 8, box.y1 + 8))
            snapped = T.refine_sides(box)
            val, unit = parse_content(a.info.get('content'))
            mm = re.search(r'/Measure\s+(\d+)\s+0\s+R', raw)
            bs = re.search(r'/W\s+([0-9.]+)', doc.xref_get_key(a.xref, 'BS')[1] or '')
            st = a.colors or {}
            examples[tg[4]].append(dict(page=pi, tc=((tg[0] + tg[2]) / 2, (tg[1] + tg[3]) / 2), box=box, snapped=snapped,
                                        xref=a.xref, content=a.info.get('content'),
                                        k=val / (box.width * box.height) if val else None, unit=unit or 'sf',
                                        measure=int(mm.group(1)) if mm else None, author=a.info.get('title') or '',
                                        stroke=st.get('stroke'), fill=st.get('fill'), bw=float(bs.group(1)) if bs else 1.0))
    rules = {}
    for t, es in examples.items():
        if (only and t not in only) or t in excl: continue
        w = statistics.median(e['snapped'].width for e in es); h = statistics.median(e['snapped'].height for e in es)
        base_ex = min(es, key=lambda e: abs(e['snapped'].width - w) + abs(e['snapped'].height - h))
        rules[t] = dict(base_ex, w=w, h=h, n=len(es))
    log(f'Learned {len(rules)} window type(s) from {sum(len(v) for v in examples.values())} manual measurement(s):')
    for t, r in sorted(rules.items()): log(f'  {t:8s} {r["w"]:6.2f} x {r["h"]:6.2f} pt  ({r["n"]} example{"s" if r["n"] > 1 else ""})')
    for pg, why in notes: log(f'  note p{pg}: {why}')
    if not rules: sys.exit('No usable manual Area measurements found. Nothing written.')

    # self-check: does the matcher find your own windows where you (snapped) put them?
    chk = []
    for t, es in examples.items():
        if t not in rules: continue
        for e in es:
            C = ctx[e['page']]; others = [q for q in C['centres'] if math.dist(q, e['tc']) > .5]
            f = match_window(C['dl'], doc[e['page']].rect, e['tc'], rules[t]['w'], rules[t]['h'], others)
            chk.append(None if f is None else max(abs(f['rect'][i] - e['snapped'][i]) for i in range(4)))
    ok = sum(1 for c in chk if c is not None and c <= 1.0)
    log(f'Self-check: {ok}/{len(chk)} manual windows re-found within 1 pt of their snapped frame')
    if args.dry_run: log('Dry run: nothing written.'); return

    rows = []
    # ---- adjust manual examples ----------------------------------------------------------------------------------
    if not args.no_adjust_manual:
        for t, es in examples.items():
            for e in es:
                r, b = e['snapped'], e['box']; moved = max(abs(r[i] - b[i]) for i in range(4))
                if moved < 0.05: continue
                p = doc[e['page']]
                label = fmt_area(e['k'] * r.width * r.height, e['unit']) if e['k'] else None
                write_vertices(doc, p, e['xref'], r, label)
                manual_boxes[e['page']] = [r if q == b else q for q in manual_boxes[e['page']]]
                rows.append(dict(page=e['page'] + 1, type=t, action='manual adjusted', area=label or '', was=e['content'] or '',
                                 evidence='', anchor='', sides='', min_side='', offset='', moved_pt=round(moved, 2),
                                 REVIEW='', rect=r))
        log(f'Adjusted {len(rows)} manual markup(s) to the drawn frame')
    # QA colors: every original/manual Area markup is blue, whether or not geometry moved.
    for t, es in examples.items():
        for e in es:
            pg = doc[e['page']]; a = pg.load_annot(e['xref']); a.set_colors(stroke=MANUAL_COLOR, fill=MANUAL_COLOR); a.set_opacity(.15); a.set_border(width=1.5); a.update()

    # ---- match ---------------------------------------------------------------------------------------------------
    per_type = collections.Counter(); unmarked = collections.Counter()
    for pi in plan:
        p = doc[pi]; C = ctx[pi]; occupied = list(manual_boxes[pi]); tp = time.time(); cnt = 0
        for tg, tc in zip(C['tags'], C['centres']):
            t = tg[4]
            if t not in rules: continue
            R = rules[t]
            if any(o.x0 <= tc[0] <= o.x1 and o.y0 <= tc[1] <= o.y1 for o in manual_boxes[pi]): continue   # your own
            others = [q for q in C['centres'] if math.dist(q, tc) > .5]
            f = match_window(C['dl'], p.rect, tc, R['w'], R['h'], others)
            if not f: unmarked[t] += 1; continue
            r = f['rect']
            if any(overlap(r, o) >= DUP_OVERLAP for o in occupied): continue
            label = fmt_area(R['k'] * r.width * r.height, R['unit']) if R['k'] else (R['content'] or '')
            flags = []
            if f['level'] < 4: flags.append(f"evidence {f['evidence']}")
            if f['sides'] < 4: flags.append(f"{f['sides']}/4 sides drawn")
            problem = bool(flags)
            add_measure(doc, p, r, R, label, problem=problem); occupied.append(r); per_type[t] += 1; cnt += 1
            rows.append(dict(page=pi + 1, type=t, action='added', area=label, was='', evidence=f['evidence'], anchor=f['anchor'],
                             sides=f['sides'], min_side=f['min_side'], offset=f['offset'], moved_pt='',
                             REVIEW='; '.join(flags), rect=r))
        log(f'  page {pi+1}: {cnt} added in {time.time()-tp:.0f}s')

    doc.save(out, garbage=0, deflate=True)
    summary_path = base + '_tag_summary.csv'
    alltags = collections.Counter(w[4] for pi in plan for w in ctx[pi]['tags'])
    man = collections.Counter(t for t, es in examples.items() for _ in es)
    good = collections.Counter(r['type'] for r in rows if r['action']=='added' and not r['REVIEW'])
    prob = collections.Counter(r['type'] for r in rows if r['action']=='added' and r['REVIEW'])
    with open(summary_path, 'w', newline='', encoding='utf-8') as sf:
        sw=csv.writer(sf); sw.writerow(['tag','status','occurrences','manual','good_added','problem_added','unmeasured','reason'])
        for t in sorted(alltags):
            total, mm, gg, pp = alltags[t], man[t], good[t], prob[t]; miss=max(0,total-mm-gg-pp)
            if t not in rules: status, reason = 'NO MANUAL EXAMPLE', 'type was not learned; no measurements added'
            elif miss: status, reason = 'PARTIALLY COMPLETED', f'{miss} occurrence(s) had no valid candidate'
            elif pp: status, reason = 'COMPLETE WITH REVIEW', f'{pp} added measurement(s) require review'
            else: status, reason = 'COMPLETE', ''
            sw.writerow([t,status,total,mm,gg,pp,miss,reason])
    with open(report_path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['page', 'type', 'classification', 'action', 'area', 'was', 'evidence', 'anchor', 'sides_drawn', 'min_side_cov',
                    'tag_offset', 'moved_pt', 'REVIEW', 'x0', 'y0', 'x1', 'y1'])
        for r in rows:
            w.writerow([r['page'], r['type'], ('MANUAL' if r['action']=='manual adjusted' else ('PROBLEM' if r['REVIEW'] else 'GOOD')), r['action'], r['area'], r['was'], r['evidence'], r['anchor'], r['sides'],
                        r['min_side'], r['offset'], r['moved_pt'], r['REVIEW'], *[round(v, 2) for v in r['rect']]])
    added = [r for r in rows if r['action'] == 'added']; flagged = [r for r in added if r['REVIEW']]
    log(f'\nDone in {time.time()-t0:.0f}s.  Added {len(added)}: ' + ', '.join(f'{k} {v}' for k, v in sorted(per_type.items())))
    log('  Evidence: ' + str(dict(collections.Counter(r['evidence'] for r in added))))
    log('  Sides drawn: ' + str(dict(collections.Counter(r['sides'] for r in added))))
    log(f'  Flagged for review: {len(flagged)}')
    if unmarked: log(f'  Left unmarked (no valid window found): {dict(unmarked)}')
    absent = sorted({w[4] for pi in plan for w in ctx[pi]['tags']} - set(rules))
    if absent: log(f'  Tags with no manual example (left unmarked): {", ".join(absent)}')
    log(f'  PDF: {out}\n  Report: {report_path}\n  Tag summary: {summary_path}')

    if flagged and not args.no_review:
        try:
            from PIL import Image, ImageDraw
            od = fitz.open(out); tiles = []
            for r in flagged[:48]:
                q = r['rect']; pad = max(10, .5 * max(q.width, q.height))
                pm = od[r['page'] - 1].get_pixmap(matrix=fitz.Matrix(6, 6), clip=fitz.Rect(q.x0 - pad, q.y0 - pad, q.x1 + pad, q.y1 + pad), alpha=False)
                im = Image.frombytes('RGB', (pm.width, pm.height), pm.samples); s = 230 / max(im.size)
                im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))))
                c = Image.new('RGB', (240, im.height + 32), 'white'); c.paste(im, (5, 30)); d = ImageDraw.Draw(c)
                d.text((4, 3), f"p{r['page']} {r['type']} {r['evidence']}", fill='black'); d.text((4, 16), r['REVIEW'][:40], fill=(170, 0, 0))
                tiles.append(c)
            cols = 6; hh = max(t.height for t in tiles); M = Image.new('RGB', (cols * 240, -(-len(tiles) // cols) * hh), 'white')
            for i, t in enumerate(tiles): M.paste(t, ((i % cols) * 240, (i // cols) * hh))
            M.save(review_path); log(f'  Review: {review_path}')
        except ImportError:
            log('  (pip install pillow for the review image)')


if __name__ == '__main__':
    main()
