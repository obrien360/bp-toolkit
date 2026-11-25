#!/usr/bin/env python3
"""
Window Example Measurement Tool  (Tool 1)
=========================================
Finds every window type on architectural elevation sheets and draws ONE editable Bluebeam Area measurement per
type, on the window's outer frame, for human review.  The reviewed PDF then goes to the Window Area Measurement
Tool (Tool 2), which completes every remaining window from these examples.

    unmeasured elevations -> Tool 1 -> one blue example per window type -> your review in Bluebeam -> Tool 2

USAGE
    python window_example_tool.py elevations.pdf
    python window_example_tool.py elevations.pdf -o reviewed_examples.pdf --skip-pages 6
    python window_example_tool.py elevations.pdf --scale 1/8        # if the sheet has no readable scale
    python window_example_tool.py measured.pdf --ignore-existing    # test on a sheet you already measured (QC page)

REQUIREMENTS
    pip install pymupdf numpy opencv-python-headless

OUTPUTS (next to the input unless -o is given; the input file is never modified)
    <name>_examples.pdf          the drawing + one blue Area measurement per window type (editable in Revu)
    <name>_examples_report.pdf   review report: summary, scale check, proposal table, close-ups, skipped tags
                                 (the same table is attached inside the report as a CSV)

HOW A WINDOW IS RECOGNISED
    Pane     : a rectangle whose four sides are each a DOUBLE line - an inner line at the glass plus a parallel
               outer line - with about the same gap on every side (the gap is not assumed; any 0.3-2.2 pt works).
               A single-line rectangle (panel, louver, wall joint) is not a pane. A line running fully across a
               rectangle splits it into smaller panes.
    Window   : panes joined through shared double lines (mullions / transoms), grown outward from the pane that
               holds the tag. Growth stops at any pane holding a different tag.
    Special cases handled
               - Double doors whose leaves share one overlaid centre frame (only two centre lines).
               - A pane whose own outer line is not drawn on one side (heavy sill or head bar instead).
               - Railings / pickets drawn in front of the lower part of a window or door: the frame is followed
                 down to its sill.
               - Tag text and tag hexagons are removed before reading lines; only black ink is read
                 (gray centrelines and coloured revision clouds are ignored).
    Type size: several occurrences of each tag are measured; the size most of them share is the type size.
               The proposal is the cleanest occurrence of that size. Tags with no window around them
               (callouts, sheet references) are skipped.
    Scale    : 1) an existing calibrated Bluebeam measurement on the page, else 2) the view-title scale under the
               view (e.g. 1/16" = 1'-0"), cross-checked against 3) level marks (LEVEL 2  341'-0"). If they disagree
               by more than 1 % the page is skipped and reported (the PDF may have been resized). --scale overrides.
"""
import argparse, bisect, collections, csv, datetime, io, math, os, re, statistics, sys, time

try:
    import fitz, numpy as np, cv2
except ImportError as exc:  # pragma: no cover
    sys.exit(f"Missing dependency: {exc.name}.  pip install pymupdf numpy opencv-python-headless")

# ============================================================== settings ===========================================
TAG_REGEX = r'^[A-Za-z]{1,4}\d{1,4}(?:-[A-Za-z0-9]{1,6})?$'
COLOR, FILL_ALPHA, LINE_W = (0.0, 0.31, 1.0), 0.30, 1.0      # #0050FF proposal colour, 30 % fill, 1 pt outline
S = 8                       # raster px per pt
DARK = 175
INK_GRAY, INK_SAT = 150, 60 # drafting ink = dark and unsaturated
MINLEN = 1.2                # pt, shortest line read
GMIN, GMAX = 0.30, 2.2      # pt, gap between a frame line and its outer companion
COV_IN, COV_COMP = .85, .75
GAP_SPREAD = .45            # pt, allowed difference between the four frame gaps of one pane
MAXCELL, MINCELL = 45.0, 2.8
TILE = 70.0                 # pt, half size of the area read around each tag
NON_ELEVATION = re.compile(r'^(?:WINDOW|DOOR|SLIDING DOOR|FENESTRATION|FINISH|HARDWARE|ROOM|WALL|TYPICAL)?\s*(?:SCHEDULES?|LEGENDS?|DETAILS?)$')
NUM = r'[-+]?(?:\d*\.\d+|\d+)'


def log(*a): print(*a, flush=True)


# ============================================================== line reading =======================================
class Lines:
    """collinear line pieces of one orientation, grouped by coordinate"""
    def __init__(self, comps):
        comps.sort(); groups = []
        for c, a, b in comps:
            if groups and abs(groups[-1][0] - c) <= .15: groups[-1][1].append(c); groups[-1][2].append((a, b))
            else: groups.append([c, [c], [(a, b)]])
        self.c, self.iv = [], []
        for _, cs, ivs in groups:
            ivs.sort(); m = []
            for a, b in ivs:
                if m and a <= m[-1][1] + .3: m[-1][1] = max(m[-1][1], b)
                else: m.append([a, b])
            self.c.append(sum(cs) / len(cs)); self.iv.append(m)

    def cov(self, i, a, b):
        if b <= a: return 0.0
        return sum(max(0, min(y, b) - max(x, a)) for x, y in self.iv[i]) / (b - a)

    def touches(self, i, a, b): return any(x <= b and y >= a for x, y in self.iv[i])
    def between(self, lo, hi): return range(bisect.bisect_left(self.c, lo), bisect.bisect_right(self.c, hi))


def covn(L, c, a, b, tol=.3):
    """coverage of [a, b] by the union of all lines within +/-tol of coordinate c"""
    ivs = sorted((x, y) for i in L.between(c - tol, c + tol) for x, y in L.iv[i] if y > a and x < b)
    s, cur = 0.0, a
    for x, y in ivs:
        x, y = max(x, cur, a), min(y, b)
        if y > x: s += y - x; cur = y
    return s / (b - a) if b > a else 0.0


class Tile:
    """the drawing around one tag, read into horizontal and vertical lines"""
    def __init__(self, dl, prect, cx, cy, symbols=()):
        clip = fitz.Rect(cx - TILE, cy - TILE, cx + TILE, cy + TILE) & prect
        pm = dl.get_pixmap(matrix=fitz.Matrix(S, S), colorspace=fitz.csRGB, alpha=False, clip=clip)
        C = np.frombuffer(pm.samples, np.uint8).reshape(pm.height, pm.width, 3).astype(np.int16)
        G = (C.sum(axis=2) // 3).astype(np.uint8)
        G = np.where((G < INK_GRAY) & (C.max(axis=2) - C.min(axis=2) < INK_SAT), G, 255).astype(np.uint8)
        self.ox, self.oy = pm.x / S + prect.x0, pm.y / S + prect.y0
        self.rect = fitz.Rect(self.ox, self.oy, self.ox + pm.width / S, self.oy + pm.height / S)
        self.sym = [q for q in symbols if (q[0] == 'v' and self.rect.x0 - 20 < q[1] < self.rect.x1 + 20) or
                    (q[0] == 'h' and self.rect.y0 - 20 < q[1] < self.rect.y1 + 20)]
        D = (G < DARK).astype(np.uint8); k = max(3, int(MINLEN * S))
        hc = self._comps(cv2.morphologyEx(D, cv2.MORPH_OPEN, np.ones((1, k), np.uint8)), True)
        vc = self._comps(cv2.morphologyEx(D, cv2.MORPH_OPEN, np.ones((k, 1), np.uint8)), False)
        self.H = Lines([q[:3] for q in hc]); self.V = Lines([q[:3] for q in vc])
        self.Hc = Lines([q[:3] for q in hc if not q[3]]); self.Vc = Lines([q[:3] for q in vc if not q[3]])  # no tag symbols
        self.cells = []

    def _comps(self, M, horiz):
        A = M if horiz else M.T
        o_c, o_r = (self.oy, self.ox) if horiz else (self.ox, self.oy)
        dd = np.diff(np.hstack([np.zeros((A.shape[0], 1), np.uint8), A, np.zeros((A.shape[0], 1), np.uint8)]).astype(np.int8), axis=1)
        rows = {}
        for r, c0 in zip(*np.where(dd == 1)): rows.setdefault(r, []).append([c0])
        for r, c1 in zip(*np.where(dd == -1)):
            for iv in rows[r]:
                if len(iv) == 1: iv.append(c1); break
        groups, prev, last = [], {}, None
        for r in sorted(rows):
            cur = {}
            for c0, c1 in rows[r]:
                g = None
                if last == r - 1:
                    best = 0
                    for (p0, p1), gi in prev.items():
                        ov = min(c1, p1) - max(c0, p0)
                        if ov > best and ov >= .5 * max(c1 - c0, p1 - p0): best, g = ov, gi
                if g is None: groups.append([[r], [(c0, c1)]]); g = len(groups) - 1
                else: groups[g][0].append(r); groups[g][1].append((c0, c1))
                cur[(c0, c1)] = g
            prev, last = cur, r
        kind, out = ('h' if horiz else 'v'), []
        for rs, ivs in groups:
            if len(set(rs)) > 12: continue                      # filled area, not a line
            c = (sum(rs) / len(rs) + .5) / S + o_c
            ivs.sort(); m = []
            for a_, b_ in ivs:
                if m and a_ <= m[-1][1] + 1: m[-1][1] = max(m[-1][1], b_)
                else: m.append([a_, b_])
            for a_, b_ in m:
                pa, pb = a_ / S + o_r, b_ / S + o_r
                sym = any(q[0] == kind and abs(q[1] - c) <= .35 and pa >= q[2] - 1.0 and pb <= q[3] + 1.0 for q in self.sym)
                out.append((c, pa, pb, sym))
        return out

    # ---------------------------------------------------------------- panes ------------------------------------------
    def _side(self, L, i, a, b, outward):
        if L.cov(i, a, b) < COV_IN: return []
        c = L.c[i]; lo, hi = (c + GMIN, c + GMAX) if outward > 0 else (c - GMAX, c - GMIN)
        out = [(abs(L.c[j] - c), L.c[j]) for j in L.between(lo, hi) if L.cov(j, a, b) >= COV_COMP]
        if not out:   # outer line drawn with a 1 px step part way along
            out = [(abs(L.c[j] - c), L.c[j]) for j in L.between(lo, hi) if L.cov(j, a, b) >= .3 and covn(L, L.c[j], a, b, .2) >= .95]
        return out

    def _capable(self, L, i, a, b, outward):
        c = L.c[i]; lo, hi = (c + GMIN, c + GMAX) if outward > 0 else (c - GMAX, c - GMIN)
        return any(L.touches(j, a, b) for j in L.between(lo, hi))

    def _crossed(self, x0, x1, y0, y1, m=.35, cov=.85):
        return any(self.Hc.cov(i, x0, x1) >= cov for i in self.Hc.between(y0 + m, y1 - m)) or \
               any(self.Vc.cov(i, y0, y1) >= cov for i in self.Vc.between(x0 + m, x1 - m))

    def cell_at(self, px, py, k=7, relax=None):
        """smallest double-framed pane whose glass contains (px, py). relax = frame gap of an accepted neighbour:
        then one side may sit on a wider line (its own outer line not drawn) if the other three match that gap."""
        for c in self.cells:
            if c['ix0'] < px < c['ix1'] and c['iy0'] < py < c['iy1']: return c
        V, H = self.V, self.H
        Ls = [i for i in reversed(V.between(px - MAXCELL, px)) if V.touches(i, py - 2, py + 2) and self._capable(V, i, py - 2, py + 2, -1)][:k]
        Rs = [i for i in V.between(px, px + MAXCELL) if V.touches(i, py - 2, py + 2) and self._capable(V, i, py - 2, py + 2, +1)][:k]
        Ts = [i for i in reversed(H.between(py - MAXCELL, py)) if H.touches(i, px - 2, px + 2) and self._capable(H, i, px - 2, px + 2, -1)][:k]
        Bs = [i for i in H.between(py, py + MAXCELL) if H.touches(i, px - 2, px + 2) and self._capable(H, i, px - 2, px + 2, +1)][:k]
        combos = sorted((((V.c[r] - V.c[l]) * (H.c[b] - H.c[t])), l, r, t, b) for l in Ls for r in Rs for t in Ts for b in Bs
                        if MINCELL <= V.c[r] - V.c[l] <= MAXCELL and MINCELL <= H.c[b] - H.c[t] <= MAXCELL)
        for _, l, r, t, b in combos[:400]:
            x0, x1, y0, y1 = V.c[l], V.c[r], H.c[t], H.c[b]
            sl = self._side(V, l, y0, y1, -1)
            if not sl: continue
            sr = self._side(V, r, y0, y1, +1)
            if not sr: continue
            st = self._side(H, t, x0, x1, -1)
            if not st: continue
            sb = self._side(H, b, x0, x1, +1)
            if not sb: continue
            if self._crossed(x0, x1, y0, y1): continue
            best = None
            for gl in sl[:3]:
                for gr in sr[:3]:
                    for gt in st[:3]:
                        for gb in sb[:3]:
                            g = (gl[0], gr[0], gt[0], gb[0]); key = (max(g) - min(g), sum(g))
                            if best is None or key < best[0]: best = (key, gl[1], gr[1], gt[1], gb[1], g)
            wide = None
            if best[0][0] > GAP_SPREAD:
                if relax is None: continue
                alt = None
                for gl in sl[:3]:
                    for gr in sr[:3]:
                        for gt in st[:3]:
                            for gb in sb[:3]:
                                g = (gl[0], gr[0], gt[0], gb[0])
                                for idx in range(4):
                                    rest = g[:idx] + g[idx + 1:]; dev = max(abs(x - relax) for x in rest)
                                    if dev <= GAP_SPREAD and g[idx] > max(rest) and (alt is None or dev < alt[0]):
                                        alt = (dev, gl[1], gr[1], gt[1], gb[1], rest, 'LRTB'[idx])
                if alt is None: continue
                _, ol, orr, ot, ob, gaps, wide = alt
                if wide == 'L': ol = x0 - relax                      # place the undrawn outer line at the usual gap
                elif wide == 'R': orr = x1 + relax
                elif wide == 'T': ot = y0 - relax
                else: ob = y1 + relax
                gaps = tuple(gaps) + (sum(gaps) / 3,)
            else:
                _, ol, orr, ot, ob, gaps = best
            cell = dict(ix0=x0, ix1=x1, iy0=y0, iy1=y1, ox0=ol, ox1=orr, oy0=ot, oy1=ob, gap=sum(gaps) / 4, wide=wide)
            for c in self.cells:
                if all(abs(c[q] - cell[q]) < .4 for q in ('ix0', 'ix1', 'iy0', 'iy1')): return c
            self.cells.append(cell); return cell
        return None

    def mirror_leaf(self, c, side):
        """double door / pair of leaves sharing ONE overlaid centre frame: build the other leaf from the same two centre
        lines + the shared head and sill + the nearest double-line jamb beyond"""
        V, H = self.V, self.H
        y0, y1 = c['iy0'], c['iy1']
        inner_c, comp = (c['ix1'], c['ox1']) if side == 'R' else (c['ix0'], c['ox0'])
        d = 1 if side == 'R' else -1
        if covn(V, comp, y0, y1, .2) < COV_IN or covn(V, inner_c, y0, y1, .2) < COV_IN: return None
        lo, hi = sorted((comp + d * .25, comp + d * MINCELL))
        if any(V.cov(j, y0, y1) >= .6 for j in V.between(lo, hi)): return None
        lo, hi = sorted((comp + d * MINCELL, comp + d * MAXCELL))
        for j in (V.between(lo, hi) if d > 0 else reversed(V.between(lo, hi))):
            if V.cov(j, y0, y1) < COV_IN: continue
            far = self._side(V, j, y0, y1, d)
            if not far: break
            a, b = sorted((comp, V.c[j]))
            if covn(H, y0, a, b, .2) < COV_IN or covn(H, y1, a, b, .2) < COV_IN: return None
            if covn(H, c['oy0'], a, b, .2) < COV_COMP or covn(H, c['oy1'], a, b, .2) < COV_COMP: return None
            if self._crossed(a, b, y0, y1): return None
            w0, w1 = b - a, c['ix1'] - c['ix0']
            if not .5 * w1 <= w0 <= 2 * w1: return None
            leaf = dict(ix0=a, ix1=b, iy0=y0, iy1=y1, oy0=c['oy0'], oy1=c['oy1'], gap=c['gap'], mirror=True)
            leaf.update(ox0=inner_c, ox1=min(far)[1]) if d > 0 else leaf.update(ox0=min(far)[1], ox1=inner_c)
            for q in self.cells:
                if all(abs(q[k] - leaf[k]) < .4 for k in ('ix0', 'ix1', 'iy0', 'iy1')): return q
            self.cells.append(leaf); return leaf
        return None


def outer(c): return fitz.Rect(c['ox0'], c['oy0'], c['ox1'], c['oy1'])


def adjacent(a, b):
    ov = lambda p0, p1, q0, q1: max(0, min(p1, q1) - max(p0, q0))
    hy = ov(a['iy0'], a['iy1'], b['iy0'], b['iy1']); mh = min(a['iy1'] - a['iy0'], b['iy1'] - b['iy0'])
    hx = ov(a['ix0'], a['ix1'], b['ix0'], b['ix1']); mw = min(a['ix1'] - a['ix0'], b['ix1'] - b['ix0'])
    if hy >= .8 * mh and ((b['ix0'] >= a['ix1'] and -2.6 <= b['ox0'] - a['ox1'] <= 1.0) or
                          (a['ix0'] >= b['ix1'] and -2.6 <= a['ox0'] - b['ox1'] <= 1.0)): return True
    if hx >= .8 * mw and ((b['iy0'] >= a['iy1'] and -2.6 <= b['oy0'] - a['oy1'] <= 1.0) or
                          (a['iy0'] >= b['iy1'] and -2.6 <= a['oy0'] - b['oy1'] <= 1.0)): return True
    return False


def neighbours(T, c):
    """panes attached to c, strictest evidence first: normal panes, shared centre frame, one undrawn outer line"""
    w, h = c['ix1'] - c['ix0'], c['iy1'] - c['iy0']
    ys = [c['iy0'] + f * h for f in (.5, .2, .8)]; xs = [c['ix0'] + f * w for f in (.5, .2, .8)]
    probes = [(c['ox1'] + d, y) for y in ys for d in (1.0, 2.0, 3.2)] + [(c['ox0'] - d, y) for y in ys for d in (1.0, 2.0, 3.2)] + \
             [(x, c['oy1'] + d) for x in xs for d in (1.0, 2.0, 3.2)] + [(x, c['oy0'] - d) for x in xs for d in (1.0, 2.0, 3.2)]
    out, seen = [], set()
    for px, py in probes:
        n = T.cell_at(px, py)
        if n is not None and n is not c and id(n) not in seen and adjacent(c, n): out.append(n); seen.add(id(n))
    for side in ('L', 'R'):
        if any((n['ix0'] >= c['ix1']) if side == 'R' else (n['ix1'] <= c['ix0']) for n in out): continue
        m = T.mirror_leaf(c, side)
        if m is not None and m is not c and id(m) not in seen: out.append(m); seen.add(id(m))
    for px, py in probes:
        n = T.cell_at(px, py, relax=c['gap'])
        if n is not None and n is not c and id(n) not in seen and adjacent(c, n): out.append(n); seen.add(id(n))
    return out


def extend_behind_railing(T, U, inner_l, inner_r):
    """railing / pickets drawn in front of the lower part: frame lines continue through the pickets to a double sill"""
    V, H = T.V, T.H; y = U.y1; hgt = U.y1 - U.y0
    for i in H.between(y + 2.0, y + 1.2 * hgt):
        yb = H.c[i]
        if H.cov(i, U.x0 + 1, U.x1 - 1) < .85: continue
        if not [j for j in H.between(yb - GMAX, yb - GMIN) if H.cov(j, U.x0 + 1, U.x1 - 1) >= .85]: continue
        if not all(covn(V, x, y, yb - .5) >= .85 for x in (U.x0, inner_l, inner_r, U.x1)): continue
        if sum(1 for j in V.between(U.x0 + 1.5, U.x1 - 1.5) if V.cov(j, y + .5, yb - 1) >= .6) < 3: continue
        sill = yb
        for k in H.between(yb, yb + 3):
            if H.c[k] - sill <= .8 and H.cov(k, U.x0 + 1, U.x1 - 1) >= .85: sill = H.c[k]
        return sill
    return None


def tag_symbol_sides(page, centres):
    """straight sides of the tag symbols (hexagon etc.): segments whose ends are equidistant from the tag centre,
    >= 4 per symbol; parts overlapped by other drawn lines are kept as real lines"""
    segs = []
    for g in page.get_drawings():
        for it in g['items']:
            if it[0] == 'l': segs.append((it[1].x, it[1].y, it[2].x, it[2].y))
            elif it[0] == 're':
                r = it[1]; segs += [(r.x0, r.y0, r.x1, r.y0), (r.x0, r.y1, r.x1, r.y1), (r.x0, r.y0, r.x0, r.y1), (r.x1, r.y0, r.x1, r.y1)]
    grid = collections.defaultdict(list)
    for s in segs:
        for gx in range(int(min(s[0], s[2]) // 20), int(max(s[0], s[2]) // 20) + 1):
            for gy in range(int(min(s[1], s[3]) // 20), int(max(s[1], s[3]) // 20) + 1): grid[(gx, gy)].append(s)
    out = []
    for cx, cy in centres:
        near = {s for gx in range(int(cx // 20) - 1, int(cx // 20) + 2) for gy in range(int(cy // 20) - 1, int(cy // 20) + 2) for s in grid[(gx, gy)]}
        byR = collections.defaultdict(list)
        for s in near:
            if not 2 <= math.dist(s[:2], s[2:]) <= 20: continue
            d1, d2 = math.dist((cx, cy), s[:2]), math.dist((cx, cy), s[2:])
            if 3 <= d1 <= 16 and abs(d1 - d2) < .4: byR[round((d1 + d2) * 2) / 4].append(s)
        sym = {s for ss in byR.values() if len(ss) >= 4 for s in ss}
        others = [s for s in near if s not in sym]
        for x0, y0, x1, y1 in sym:
            if abs(x0 - x1) < .05: kind, c, a, b = 'v', x0, min(y0, y1), max(y0, y1)
            elif abs(y0 - y1) < .05: kind, c, a, b = 'h', y0, min(x0, x1), max(x0, x1)
            else: continue
            pieces = [(a, b)]
            for o in others:
                if kind == 'v' and abs(o[0] - o[2]) < .05 and abs(o[0] - c) <= .2: ca, cb = sorted((o[1], o[3]))
                elif kind == 'h' and abs(o[1] - o[3]) < .05 and abs(o[1] - c) <= .2: ca, cb = sorted((o[0], o[2]))
                else: continue
                nxt = []
                for pa, pb in pieces:
                    if cb <= pa or ca >= pb: nxt.append((pa, pb)); continue
                    if ca > pa: nxt.append((pa, ca))
                    if cb < pb: nxt.append((cb, pb))
                pieces = nxt
            out += [(kind, c, pa, pb) for pa, pb in pieces if pb - pa > .3]
    return out


def find_window(dl, prect, tc, tag_centres, symbols):
    """window (outer frame rectangle) around one tag, or None"""
    cx, cy = tc
    T = Tile(dl, prect, cx, cy, symbols)
    seed = None
    for dx, dy in ((0, 0), (0, -1.5), (0, 1.5), (-1.5, 0), (1.5, 0), (0, -3), (0, 3), (-3, 0), (3, 0)):
        seed = T.cell_at(cx + dx, cy + dy)
        if seed: break
    if not seed: return None
    others = [q for q in tag_centres if q != tc and T.rect.contains(fitz.Point(*q))]
    key = lambda c: (round(c['ix0'], 1), round(c['iy0'], 1), round(c['ix1'], 1), round(c['iy1'], 1))
    got, todo, depth = [seed], [seed], {key(seed): 0}
    while todo:
        c = todo.pop(0)
        for n in neighbours(T, c):
            if any(key(n) == key(g) for g in got): continue
            if any(n['ox0'] < x < n['ox1'] and n['oy0'] < y < n['oy1'] for x, y in others): continue   # other tag's pane
            got.append(n); todo.append(n); depth[key(n)] = depth[key(c)] + 1
    u = outer(got[0])
    for c in got[1:]: u |= outer(c)
    yb = extend_behind_railing(T, u, min(c['ix0'] for c in got), max(c['ix1'] for c in got))
    return dict(cells=[dict(c) for c in got], depth=depth, ext=yb, key=key)


# ============================================================== scale ===============================================
def frac(s):
    s = s.strip()
    if ' ' in s: return sum(frac(x) for x in s.split())
    if '/' in s: n, d = s.split('/'); return float(n) / float(d)
    return float(s)


def parse_scale(s):
    """'1/16', '1/16"=1'-0"', '0.0625', '3/32' -> inches of paper per foot"""
    m = re.match(r'\s*([0-9./ ]+?)\s*(?:"|in)?\s*(?:=\s*1\s*\'.*)?$', s)
    if not m: raise ValueError(f'cannot read scale "{s}"; use e.g. 1/16 or 1/8')
    return frac(m.group(1))


def page_scale(doc, page, manual, override):
    """returns (pt_per_ft or None, source text, level_pt_per_ft or None, problem or None, view titles)"""
    titles = []
    for b in page.get_text('blocks'):
        t = ' '.join(b[4].split())
        for m in re.finditer(r'(\d+(?:/\d+)?|\d*\.\d+)"\s*=\s*1\'\s*-\s*0"', t): titles.append((fitz.Rect(b[:4]), frac(m.group(1)) * 72))
    lv = set()
    for b in page.get_text('blocks'):
        m = re.search(r"LEVEL\s+\w+\s+(\d+)'\s*-\s*(\d+(?:\s+\d+/\d+|/\d+)?)", ' '.join(b[4].split()))
        if m: lv.add((round((b[1] + b[3]) / 2, 2), int(m.group(1)) + frac(m.group(2)) / 12))
    level = None
    if len({e for _, e in lv}) >= 3:
        y = np.array([a for a, _ in lv]); e = np.array([b for _, b in lv]); k, _ = np.polyfit(e, y, 1); level = abs(k)
    if override: ptft, src = override * 72, 'given with --scale'
    elif manual:
        raw = doc.xref_object(manual[0]['measure'], False)
        ptft, src = 1 / float(re.search(r'/X\s*\[\s*<<.*?/C\s+([0-9.]+)', raw, re.S).group(1)), 'existing Bluebeam calibration'
    elif titles:
        ptft = statistics.mode(round(t[1], 4) for t in titles); src = f'view title{"s" if len(titles) > 1 else ""} ({len(titles)} found)'
    else:
        return None, 'no scale found on the page', level, 'no scale - run again with --scale', titles
    if level and not override and abs(level - ptft) / ptft > .01:
        return None, src, level, (f'{src} says {ptft:.3f} pt/ft but the level marks measure {level:.3f} pt/ft - the PDF may have '
                                  f'been resized when printed. Confirm the scale and run again with --scale.'), titles
    return ptft, src, level, None, titles


def view_scale(titles, pt, default):
    """scale of the view a point belongs to: the nearest view title below it (titles sit under their view)"""
    below = [t for t in titles if t[0].y0 >= pt[1] - 5]
    return min(below, key=lambda t: (t[0].y0 - pt[1]) + .2 * abs((t[0].x0 + t[0].x1) / 2 - pt[0]))[1] if below else default


def measure_object(doc, ptft):
    ftpt = 1 / ptft; x = doc.get_new_xref()
    doc.update_object(x, f"""<< /Type /Measure /Subtype /RL /R ({ptft / 72:g} in = 1 ft' in")
 /X [ << /Type /NumberFormat /U (') /C {ftpt:.7f} /F /F /D 4 /FD true /SS () >> ]
 /D [ << /Type /NumberFormat /U (') /C 1 /F /F /D 4 /FD true /PS () /SS (-) >> << /Type /NumberFormat /U (") /C 12 /F /F /D 4 /FD true /PS () /SS () >> ]
 /A [ << /Type /NumberFormat /U (sf) /C 1 /D 100 /FD true /SS () >> ]
 /T [ << /Type /NumberFormat /U <B0> /C 1 /D 100 /FD true /PS () /SS () >> ]
 /V [ << /Type /NumberFormat /U (cu ft) /C 1 /D 100 /FD true /SS () >> ]
 /TargetUnitConversion {ftpt / 192:.7f} >>""")
    return x


# ============================================================== annotations ========================================
def manual_measures(doc, page, tags):
    out = []
    for a in page.annots() or []:
        raw = doc.xref_object(a.xref, False)
        if a.type[1] != 'Polygon' or '/Measure' not in raw: continue
        m = re.search(r'/Vertices\s*\[([^\]]+)\]', raw, re.S)
        if not m: continue
        v = [float(z) for z in re.findall(NUM, m.group(1))]
        q = [fitz.Point(v[i], v[i + 1]) * page.transformation_matrix for i in range(0, len(v) - 1, 2)]
        r = fitz.Rect(min(z.x for z in q), min(z.y for z in q), max(z.x for z in q), max(z.y for z in q))
        ins = [t for t in tags if r.x0 - 3 <= t['c'][0] <= r.x1 + 3 and r.y0 - 3 <= t['c'][1] <= r.y1 + 3]
        tag = min(ins, key=lambda t: math.dist(t['c'], ((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)))['tag'] if ins else None
        out.append(dict(rect=r, tag=tag, content=a.info.get('content'), xref=a.xref,
                        measure=int(re.search(r'/Measure\s+(\d+)\s+0\s+R', raw).group(1))))
    return out


def add_measurement(doc, page, R, measure_xref, ptft, label):
    hexc = '#%02X%02X%02X' % tuple(round(c * 255) for c in COLOR); rgb = ' '.join(f'{c:g}' for c in COLOR)
    an = page.add_polygon_annot([R.tl, R.bl, R.br, R.tr]); an.set_colors(stroke=COLOR); an.set_border(width=LINE_W)
    an.set_info(title='Tool 1 example', subject='Area Measurement', content=label); an.update()
    x = an.xref; ftpt = 1 / ptft; now = datetime.datetime.now().strftime('D:%Y%m%d%H%M%S')
    for k, v in (('IT', '/PolygonDimension'), ('MeasurementTypes', '129'), ('Cap', 'true'), ('AlignOnSegment', 'true'),
                 ('SlopeType', '0'), ('PitchRun', '12'), ('Measure', f'{measure_xref} 0 R'), ('IC', f'[{rgb}]'), ('CA', '1'),
                 ('FillOpacity', f'{FILL_ALPHA:g}'), ('BS', f'<< /W {LINE_W:g} /S /S >>'),
                 ('DepthUnit', f"[ << /Type /NumberFormat /U (') /C {ftpt / 192:.7f} /D 100 /FD true /SS () >> ]")):
        doc.xref_set_key(x, k, v)
    style = f'font:Helvetica 12pt; text-align:center; line-height:13.8pt; color:{hexc}'
    doc.xref_set_key(x, 'DS', fitz.get_pdf_str(style.replace('font:', 'font: ')))
    doc.xref_set_key(x, 'RC', fitz.get_pdf_str('<?xml version="1.0"?><body xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" '
                     'xfa:contentType="text/html" xfa:APIVersion="BluebeamPDFRevu:2018" xfa:spec="2.2.0" '
                     f'style="{style}" xmlns="http://www.w3.org/1999/xhtml">{label}</body>'))
    doc.xref_set_key(x, 'CreationDate', fitz.get_pdf_str(now)); doc.xref_set_key(x, 'M', fitz.get_pdf_str(now))
    # explicit appearance (opaque outline, translucent fill) so every viewer shows it like Revu
    v = [float(z) for z in re.findall(NUM, re.search(r'/Vertices\s*\[([^\]]+)\]', doc.xref_object(x, False), re.S).group(1))]
    xs, ys = v[0::2], v[1::2]
    path = f'{xs[0]:.4f} {ys[0]:.4f} m ' + ' '.join(f'{a:.4f} {b:.4f} l' for a, b in zip(xs[1:], ys[1:])) + ' h'
    ap = doc.get_new_xref()
    doc.update_object(ap, f'<< /Type /XObject /Subtype /Form /BBox [{min(xs) - 1:.4f} {min(ys) - 1:.4f} {max(xs) + 1:.4f} {max(ys) + 1:.4f}] '
                          f'/Resources << /ExtGState << /GF << /Type /ExtGState /ca {FILL_ALPHA:g} /CA 1 >> >> >> >>')
    doc.update_stream(ap, f'q /GF gs {rgb} rg {path} f Q\nq {LINE_W:g} w {rgb} RG {path} S Q\n'.encode())
    doc.xref_set_key(x, 'AP', f'<< /N {ap} 0 R >>')


# ============================================================== main ================================================
def parse_pages(spec, n):
    out = set()
    for part in (spec or '').split(','):
        part = part.strip()
        if not part: continue
        if '-' in part: a, b = part.split('-', 1); out.update(range(int(a), int(b) + 1))
        else: out.add(int(part))
    return {x - 1 for x in out if 1 <= x <= n}


def scale_text(ptft):
    """4.5 pt/ft -> 1/16\" = 1'-0\""""
    from fractions import Fraction
    f = Fraction(ptft / 72).limit_denominator(256)
    return (f'{f.numerator}/{f.denominator}' if f.denominator > 1 else f'{f.numerator}') + '" = 1\'-0"'


def ftin(pt, ptft):
    inch = round(pt / ptft * 12 * 4) / 4; f = int(inch // 12); return f"{f}'-{inch - 12 * f:g}\""


def main():
    ap = argparse.ArgumentParser(description='Draw one example Area measurement per window type, for review before Tool 2.')
    ap.add_argument('pdf'); ap.add_argument('-o', '--out', help='output PDF (default <name>_examples.pdf)')
    ap.add_argument('--pages', help='only these pages, e.g. "1-4"'); ap.add_argument('--skip-pages', help='never use these pages')
    ap.add_argument('--no-auto-skip', action='store_true', help='do not skip pages titled SCHEDULE / LEGEND / DETAILS')
    ap.add_argument('--scale', help='drawing scale if the sheet has none, e.g. 1/16 (inches = 1 foot)')
    ap.add_argument('--tag-regex', default=TAG_REGEX); ap.add_argument('--types', help='only these tags, e.g. "B4,D6"')
    ap.add_argument('--exclude-types', help='never propose these tags')
    ap.add_argument('--sample', type=int, default=12, help='occurrences checked per tag to find its size (0 = all)')
    ap.add_argument('--ignore-existing', action='store_true',
                    help='remove existing Area measurements and propose every type (test on an already measured sheet)')
    ap.add_argument('--no-report', action='store_true')
    args = ap.parse_args()
    t0 = time.time()
    src = os.path.abspath(args.pdf)
    if not os.path.isfile(src): sys.exit(f'File not found: {src}')
    out = os.path.abspath(args.out) if args.out else os.path.splitext(src)[0] + '_examples.pdf'
    if out == src: sys.exit('Output would overwrite the input; choose another -o.')
    report_path = os.path.splitext(out)[0] + '_report.pdf'
    try: override = parse_scale(args.scale) if args.scale else None
    except ValueError as e: sys.exit(str(e))
    tag_re = re.compile(args.tag_regex)
    only = {t.strip() for t in (args.types or '').split(',') if t.strip()}
    excl = {t.strip() for t in (args.exclude_types or '').split(',') if t.strip()}

    doc = fitz.open(src); n = len(doc)
    clean = fitz.open(src)                                       # working copy: tag text removed, drawings intact
    pages = sorted(parse_pages(args.pages, n)) if args.pages else list(range(n)); skip = parse_pages(args.skip_pages, n)
    log(f'Input: {src}  ({n} page{"s" if n > 1 else ""})')
    plan, page_info, notes = [], {}, []
    for i in pages:
        if i in skip: notes.append((i + 1, 'skipped (--skip-pages)')); continue
        if not args.no_auto_skip:
            title = next((' '.join(l.upper().split()) for l in doc[i].get_text('text').splitlines()
                          if NON_ELEVATION.match(' '.join(l.upper().split()))), None)
            if title: notes.append((i + 1, f'skipped - titled "{title}"')); continue
        plan.append(i)
    for pi in plan:
        cp = clean[pi]
        for w in cp.get_text('words'):
            if tag_re.fullmatch(w[4]): cp.add_redact_annot(fitz.Rect(w[:4]))
        cp.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE, text=fitz.PDF_REDACT_TEXT_REMOVE)

    # ---- pages: tags, existing measurements, scale ------------------------------------------------------------------
    occ = collections.defaultdict(list); existing = []
    for pi in plan:
        p = doc[pi]
        tags = [dict(tag=w[4], c=((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), page=pi) for w in p.get_text('words') if tag_re.fullmatch(w[4])]
        manual = manual_measures(doc, p, tags)
        ptft, ssrc, level, problem, titles = page_scale(doc, p, [] if args.ignore_existing else manual, override)
        page_info[pi] = dict(tags=tags, manual=manual, ptft=ptft, src=ssrc, level=level, problem=problem, titles=titles,
                             dl=clean[pi].get_displaylist(annots=False), centres=[t['c'] for t in tags])
        msg = f'  page {pi + 1}: {len(tags)} tags, {len(manual)} existing measurement(s), scale '
        msg += f'{scale_text(ptft)} ({ssrc})' if ptft else f'NOT SET - {problem}'
        if ptft and level: msg += f', level marks agree ({level:.3f} pt/ft)'
        log(msg)
        if problem: continue
        existing += [dict(m, page=pi) for m in manual]
        for t in tags: occ[t['tag']].append(t)
    for pg, why in notes: log(f'  page {pg}: {why}')
    if not occ: sys.exit('No pages with a usable scale and window tags. Nothing written.')
    measured_types = set() if args.ignore_existing else {m['tag'] for m in existing if m['tag']}

    # ---- detect windows for a sample of each tag's occurrences -----------------------------------------------------
    todo = []
    for t, lst in occ.items():
        if (only and t not in only) or t in excl or t in measured_types: continue
        lst = sorted(lst, key=lambda q: (q['page'], q['c'][1], q['c'][0]))
        if args.sample and len(lst) > args.sample:
            lst = [lst[round(i * (len(lst) - 1) / (args.sample - 1))] for i in range(args.sample)]
        todo += lst
    symbols = {}
    for pi in plan:
        if not page_info[pi]['problem']: symbols[pi] = tag_symbol_sides(doc[pi], page_info[pi]['centres'])
    log(f'Reading the frame around {len(todo)} tag occurrence(s) ({len(occ)} tag types)...')
    last = time.time()
    for k, t in enumerate(todo):
        I = page_info[t['page']]
        t['found'] = find_window(I['dl'], doc[t['page']].rect, t['c'], I['centres'], symbols[t['page']])
        if time.time() - last > 15 or k == len(todo) - 1:
            el = time.time() - t0; log(f'  {k + 1}/{len(todo)}  ({el:.0f}s elapsed, ~{el / (k + 1) * (len(todo) - k - 1):.0f}s left)'); last = time.time()

    # a pane reached from two tags belongs to the nearer one
    claims = collections.defaultdict(list)
    for i, t in enumerate(todo):
        f = t['found']
        if not f: continue
        for c in f['cells']:
            k = (t['page'],) + f['key'](c); cc = ((c['ix0'] + c['ix1']) / 2, (c['iy0'] + c['iy1']) / 2)
            claims[k].append((f['depth'].get(f['key'](c), 9), math.dist(cc, t['c']), i))
    owner = {k: min(v)[2] for k, v in claims.items()}
    for i, t in enumerate(todo):
        f = t['found']; t['rect'] = None
        if not f: continue
        keep = [c for c in f['cells'] if owner[(t['page'],) + f['key'](c)] == i]
        if not keep: continue
        u = outer(keep[0])
        for c in keep[1:]: u |= outer(c)
        if f['ext'] and f['ext'] > u.y1: u = fitz.Rect(u.x0, u.y0, u.x1, f['ext'])
        t['rect'], t['cells'] = u, keep

    # ---- type size by consensus, pick the cleanest occurrence --------------------------------------------------------
    by = collections.defaultdict(list)
    for t in todo: by[t['tag']].append(t)
    props, skipped = [], []
    for t in sorted(occ):
        if t in measured_types: skipped.append((t, len(occ[t]), 'already measured on the sheet - kept as your example')); continue
        if (only and t not in only) or t in excl: skipped.append((t, len(occ[t]), 'excluded by --types / --exclude-types')); continue
        rs = by[t]; found = [r for r in rs if r['rect'] is not None]
        if not found: skipped.append((t, len(occ[t]), 'no window around the tag (callout / sheet reference?)')); continue
        clusters = []
        for r in found:
            w, h = r['rect'].width, r['rect'].height
            for cl in clusters:
                if abs(cl['w'] - w) <= max(1.0, .03 * w) and abs(cl['h'] - h) <= max(1.0, .03 * h):
                    cl['m'].append(r); cl['w'] = statistics.median(x['rect'].width for x in cl['m'])
                    cl['h'] = statistics.median(x['rect'].height for x in cl['m']); break
            else: clusters.append(dict(w=w, h=h, m=[r]))
        clusters.sort(key=lambda c: -len(c['m'])); best = clusters[0]; share = len(best['m']) / len(rs)
        conf = 'High' if len(best['m']) >= 3 and share >= .6 else ('Medium' if (len(best['m']) >= 2 and len(clusters) == 1) or len(rs) == 1 else 'Low')
        cons = best['m']; W, H = best['w'], best['h']
        ext_major = sum(1 for r in cons if r['found']['ext']) > len(cons) / 2
        mode_cells = collections.Counter(len(r['cells']) for r in cons).most_common(1)[0][0]
        def score(r):
            R = r['rect']; sc = abs(R.width - W) + abs(R.height - H)
            if bool(r['found']['ext']) != ext_major: sc += 1.0
            if any(c.get('mirror') or c.get('wide') for c in r['cells']): sc += .5      # prefer a directly found frame
            if len(r['cells']) != mode_cells: sc += 1.0
            if not (R.x0 + 1 < r['c'][0] < R.x1 - 1 and R.y0 + 1 < r['c'][1] < R.y1 - 1): sc += 2.0
            return (round(sc, 1), r['page'], R.y0, R.x0)
        pick = min(cons, key=score)
        notes_ = []
        if conf == 'Low': notes_.append('occurrences disagree - check first')
        if len(clusters) > 1: notes_.append('other sizes: ' + ', '.join(f"{c['w']:.1f}x{c['h']:.1f} pt ({len(c['m'])})" for c in clusters[1:3]))
        props.append(dict(tag=t, rec=pick, conf=conf, agree=len(cons), checked=len(rs), occ=len(occ[t]),
                          outliers=len(found) - len(cons), none=len(rs) - len(found), note='; '.join(notes_)))
    props.sort(key=lambda p: (-p['occ'], p['tag']))

    # ---- write the measurements -------------------------------------------------------------------------------------
    if args.ignore_existing:
        for pi in plan:
            pg_ = doc[pi]
            for a in list(pg_.annots() or []):
                if a.type[1] == 'Polygon' and '/Measure' in doc.xref_object(a.xref, False): pg_.delete_annot(a)
    measure_cache = {}
    for pi in plan:                                              # reuse the page's own calibration where it exists
        I = page_info[pi]
        if I['ptft'] and I['manual'] and not args.ignore_existing: measure_cache[(pi, round(I['ptft'], 4))] = I['manual'][0]['measure']
    for p in props:
        r = p['rec']; I = page_info[r['page']]; R = r['rect']
        ptft = view_scale(I['titles'], r['c'], I['ptft']) if not (override or (I['manual'] and not args.ignore_existing)) else I['ptft']
        key = (r['page'], round(ptft, 4))
        if key not in measure_cache: measure_cache[key] = measure_object(doc, ptft)
        area = R.width * R.height / ptft ** 2
        p.update(rect=R, area=area, label=f'{area:.2f} sf', ptft=ptft, page=r['page'])
        add_measurement(doc, doc[r['page']], R, measure_cache[key], ptft, p['label'])
    doc.save(out, garbage=3, deflate=True)

    # ---- QC against measurements that were already on the sheet (test mode) ---------------------------------------
    qc = []
    if args.ignore_existing:
        for m in existing:
            p = next((q for q in props if q['tag'] == m['tag']), None)
            if not m['tag']: continue
            if not p: qc.append([m['tag'], m['content'], '-', '', '', '', 'no proposal', '']); continue
            R, M = p['rect'], m['rect']; same = p['page'] == m['page'] and (R & M).get_area() > .5 * M.get_area() if R.intersects(M) else False
            try: ad = f"{(p['area'] / float(m['content'].split()[0]) - 1) * 100:+.1f} %"
            except (ValueError, AttributeError, ZeroDivisionError): ad = ''
            qc.append([m['tag'], m['content'] or '', p['label'], f"{(R.width - M.width) / p['ptft'] * 12:+.1f}\"",
                       f"{(R.height - M.height) / p['ptft'] * 12:+.1f}\"", ad, 'same window' if same else 'other occurrence',
                       f"{max(abs(R[i] - M[i]) for i in range(4)):.2f} pt" if same else ''])

    # ---- summary ------------------------------------------------------------------------------------------------------
    cc = collections.Counter(p['conf'] for p in props)
    log(f'\nDone in {time.time() - t0:.0f}s.  {len(props)} example measurement(s) drawn: '
        f'{cc.get("High", 0)} high, {cc.get("Medium", 0)} medium, {cc.get("Low", 0)} low confidence.')
    for p in props:
        if p['conf'] == 'Low': log(f'  check first: {p["tag"]} - {p["note"]}')
    for t, k, why in skipped: log(f'  not proposed: {t} ({k}x) - {why}')
    log(f'  PDF:    {out}')
    if not args.no_report:
        write_report(report_path, out, src, props, skipped, page_info, plan, notes, qc, args, time.time() - t0)
        log(f'  Report: {report_path}')


# ============================================================== report ==============================================
def write_report(path, out_pdf, src, props, skipped, page_info, plan, notes, qc, args, secs):
    drawing = fitz.open(out_pdf); rep = fitz.open(); W, H = 792, 612
    def T(pg, x, y, s, size=9, bold=False, color=(0, 0, 0)): pg.insert_text((x, y), s, fontsize=size, fontname='hebo' if bold else 'helv', color=color)
    cc = collections.Counter(p['conf'] for p in props)
    pg = rep.new_page(width=W, height=H)
    T(pg, 36, 44, 'Window Example Measurement Tool (Tool 1) - review report', 15, True)
    L = [f'Drawing: {os.path.basename(src)}' + ('   (test mode: existing measurements were removed first)' if args.ignore_existing else ''),
         f'Run: {datetime.datetime.now():%Y-%m-%d %H:%M}, {secs:.0f} s.   Output: {os.path.basename(out_pdf)}',
         f'Examples drawn: {len(props)} (one per window type) - {cc.get("High", 0)} High, {cc.get("Medium", 0)} Medium, {cc.get("Low", 0)} Low confidence.',
         f'Not proposed: {len(skipped)} tag type(s) - see the last page.', '', 'Scale']
    for pi in plan:
        I = page_info[pi]
        if I['ptft']: L.append(f'  Page {pi + 1}: {scale_text(I["ptft"])} ({I["ptft"]:.3f} pt/ft) from {I["src"]}' +
                               (f'; level marks {I["level"]:.3f} pt/ft - the PDF was not resized.' if I['level'] else '; no level marks to cross-check.'))
        else: L.append(f'  Page {pi + 1}: NOT PROCESSED - {I["problem"]}')
    for pg_, why in notes: L.append(f'  Page {pg_}: {why}')
    L += ['', 'How to review (in Bluebeam Revu)',
          '  Each window type has ONE blue Area measurement on its outer frame. Check the Low and Medium ones first (close-ups on',
          '  the next pages). Move, resize or delete any that are wrong; add one yourself for any type that is missing.',
          '  Then run Tool 2 on the reviewed PDF - it treats every blue example exactly like a measurement you drew.', '',
          'Confidence',
          '  High   - 3 or more checked occurrences of the tag share the same window size (at least 60 % of those checked).',
          '  Medium - few occurrences to compare (tag used once or twice); the frame itself was found cleanly.',
          '  Low    - occurrences of the tag disagree on size; possibly a wrong tag on the drawing. Check first.']
    y = 72
    for s in L: T(pg, 36, y, s, 9.5, s in ('Scale', 'How to review (in Bluebeam Revu)', 'Confidence')); y += 14.5

    def table(title, header, rows, widths, note=None):
        pg = rep.new_page(width=W, height=H); T(pg, 36, 34, title, 12, True); y = 52
        if note: pg.insert_textbox(fitz.Rect(36, 40, W - 36, 74), note, fontsize=8); y = 80
        for k, r in enumerate([header] + rows):
            if y > H - 30: pg = rep.new_page(width=W, height=H); y = 40
            x = 36
            for s, w in zip(r, widths): T(pg, x, y, str(s)[:int(w / 4.2)], 8, k == 0, (.65, 0, 0) if 'Low' in r[1:2] else (0, 0, 0)); x += w
            y += 12
    rows = [[p['tag'], p['conf'], f"{p['agree']}/{p['checked']}", p['occ'], ftin(p['rect'].width, p['ptft']), ftin(p['rect'].height, p['ptft']),
             p['label'], p['page'] + 1, p['note']] for p in props]
    table('Example measurements (one per window type)', ['Tag', 'Confidence', 'Agree/checked', 'On sheet', 'Width', 'Height', 'Area', 'Page', 'Note'],
          rows, [55, 60, 70, 50, 55, 55, 60, 35, 280],
          '"Agree/checked": how many of the checked occurrences have the same window size. "On sheet": total occurrences of the tag. '
          'Width and height are real-world dimensions of the outer frame at the drawing scale.')
    order = sorted(props, key=lambda p: ({'Low': 0, 'Medium': 1, 'High': 2}[p['conf']], p['tag'])); k = 0
    while k < len(order):
        pg = rep.new_page(width=W, height=H); T(pg, 36, 30, 'Close-ups (Low and Medium first)', 12, True)
        for i in range(12):
            if k >= len(order): break
            p = order[k]; k += 1; R = p['rect']; pad = max(6, .4 * max(R.width, R.height)); box = R + (-pad, -pad, pad, pad)
            cw, ch = 172, 160; s = min(cw / box.width, (ch - 14) / box.height) * 2
            img = drawing[p['page']].get_pixmap(matrix=fitz.Matrix(s, s), clip=box, alpha=False)
            x0 = 36 + (i % 4) * (cw + 10); y0 = 42 + (i // 4) * (ch + 14)
            T(pg, x0, y0 + 10, f"{p['tag']}  {p['conf']}  {p['label']}", 8.5, True, (.65, 0, 0) if p['conf'] == 'Low' else (0, 0, 0))
            pg.insert_image(fitz.Rect(x0, y0 + 14, x0 + cw, y0 + ch), stream=img.tobytes('png'), keep_proportion=True)
    if qc:
        table('QC - examples vs the measurements that were on the sheet', ['Tag', 'Sheet area', 'Example', 'Width diff', 'Height diff', 'Area diff', 'Window', 'Max edge diff'],
              qc, [55, 65, 65, 60, 60, 60, 100, 80], '"Other occurrence": the tool picked a different window of the same type, so only sizes compare. '
              'Differences are real-world inches.')
    table('Tags not proposed', ['Tag', 'On sheet', 'Reason'], [[t, n, r] for t, n, r in skipped], [80, 60, 450])
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(['tag', 'confidence', 'agree', 'checked', 'on_sheet', 'width', 'height', 'area', 'page', 'x0', 'y0', 'x1', 'y1', 'note'])
    for p in props:
        R = p['rect']; w.writerow([p['tag'], p['conf'], p['agree'], p['checked'], p['occ'], ftin(R.width, p['ptft']), ftin(R.height, p['ptft']),
                                   p['label'], p['page'] + 1, *[round(v, 2) for v in R], p['note']])
    for t, n, r in skipped: w.writerow([t, 'not proposed', '', '', n, '', '', '', '', '', '', '', '', r])
    rep.embfile_add('examples.csv', buf.getvalue().encode(), filename='examples.csv', desc='example measurements table')
    rep.save(path, garbage=3, deflate=True)


if __name__ == '__main__':
    main()
