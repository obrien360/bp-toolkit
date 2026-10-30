import pymupdf
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import unary_union, polygonize
import math

doc = pymupdf.open('Zoning.pdf')
page = doc[0]
drawings = page.get_drawings()
annots = list(page.annots())

# Collect polygons for Level 1 and Level 2
l1_polys = []
l2_polys = []

for a in annots:
    author = a.info.get('title', '')
    content = a.info.get('content', '').split('\r')[0]
    # find best drawing
    a_rect = a.rect
    best_d = min(drawings, key=lambda d: abs(a_rect.x0 - d['rect'].x0) + abs(a_rect.y0 - d['rect'].y0) + abs(a_rect.x1 - d['rect'].x1) + abs(a_rect.y1 - d['rect'].y1))
    
    pts_page = []
    for item in best_d['items']:
        if item[0] == 'l':
            p1, p2 = item[1], item[2]
            if not pts_page:
                pts_page.append((p1.x, p1.y))
            pts_page.append((p2.x, p2.y))
        elif item[0] == 're':
            r = item[1]
            pts_page = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
    if len(pts_page) > 1 and pts_page[0] == pts_page[-1]:
        pts_page.pop()
    
    pts_cad = [(x / 9.0, (2592.0 - y) / 9.0) for x, y in pts_page]
    p = Polygon(pts_cad)
    
    data = {'name': content, 'poly': p, 'pts': pts_cad, 'color': a.colors.get('stroke')}
    if author == 'Level 1':
        l1_polys.append(data)
    else:
        l2_polys.append(data)

print(f"Level 1: {len(l1_polys)} zones, Level 2: {len(l2_polys)} zones")

# Print bounds of each zone in Level 1
print("\n--- Level 1 Zones ---")
for i, z in enumerate(l1_polys):
    b = z['poly'].bounds
    print(f"[{i:2d}] {z['name']:30s} X=[{b[0]:6.2f}, {b[2]:6.2f}] Y=[{b[1]:6.2f}, {b[3]:6.2f}]")

print("\n--- Level 2 Zones ---")
for i, z in enumerate(l2_polys):
    b = z['poly'].bounds
    print(f"[{i:2d}] {z['name']:30s} X=[{b[0]:6.2f}, {b[2]:6.2f}] Y=[{b[1]:6.2f}, {b[3]:6.2f}]")
