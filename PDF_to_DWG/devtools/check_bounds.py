import xml.etree.ElementTree as ET
import zlib
import re
from shapely.geometry import Polygon, MultiPolygon

tree = ET.parse(r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning.txt')

def get_polygons(level):
    polys = []
    for ann in tree.findall('.//Annotation'):
        if ann.find('Author').text == level:
            name = ann.find('Contents').text.splitlines()[0]
            raw = ann.find('Raw').text
            decomp = zlib.decompress(bytes.fromhex(raw)).decode('latin1', errors='replace')
            v_match = re.search(r'/Vertices\[(.*?)\]', decomp)
            coords = [float(x) / 9.0 for x in v_match.group(1).split()]
            pts = list(zip(coords[0::2], coords[1::2]))
            polys.append((name, Polygon(pts)))
    return polys

l1_polys = get_polygons('Level 1')
l2_polys = get_polygons('Level 2')

print("Level 1 spaces:")
for name, p in l1_polys:
    minx, miny, maxx, maxy = p.bounds
    print(f"  {name:28s}: bounds X=[{minx:6.1f}, {maxx:6.1f}], Y=[{miny:6.1f}, {maxy:6.1f}], area={p.area:7.1f} sf")

print("\nLevel 2 spaces:")
for name, p in l2_polys:
    minx, miny, maxx, maxy = p.bounds
    print(f"  {name:28s}: bounds X=[{minx:6.1f}, {maxx:6.1f}], Y=[{miny:6.1f}, {maxy:6.1f}], area={p.area:7.1f} sf")
