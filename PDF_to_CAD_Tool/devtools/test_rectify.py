import pymupdf
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, box
from shapely.ops import unary_union, polygonize
import math

doc = pymupdf.open('Zoning.pdf')
page = doc[0]
drawings = page.get_drawings()
annots = list(page.annots())

def extract_level_polys(level_name):
    zones = []
    for a in annots:
        if a.info.get('title') != level_name:
            continue
        content = a.info.get('content', '').split('\r')[0]
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
        zones.append({'name': content, 'pts': pts_cad, 'poly': Polygon(pts_cad)})
    return zones

l1_raw = extract_level_polys('Level 1')
l2_raw = extract_level_polys('Level 2')

print(f"Extracted {len(l1_raw)} Level 1 zones, {len(l2_raw)} Level 2 zones")

# Check all segment angles in Level 1
for z in l1_raw:
    pts = z['pts']
    for i in range(len(pts)):
        p1 = pts[i]
        p2 = pts[(i+1)%len(pts)]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        deg = math.degrees(math.atan2(dy, dx)) % 180
        dev = min(deg, 180 - deg, abs(deg - 90))
        if dev > 10.0:
            print(f"Warning: {z['name']} edge {p1}->{p2} has dev {dev:.2f}° > 10°")
print("All edges in Level 1 are within 10° of H/V!")
