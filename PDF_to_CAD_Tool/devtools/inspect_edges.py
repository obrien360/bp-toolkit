import xml.etree.ElementTree as ET
import zlib
import re
from shapely.geometry import Polygon, LineString, MultiLineString, Point
from shapely.ops import polygonize, unary_union

tree = ET.parse(r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning.txt')

def load_level(level_name):
    zones = []
    for ann in tree.findall('.//Annotation'):
        if ann.find('Author').text == level_name:
            name = ann.find('Contents').text.splitlines()[0]
            raw = ann.find('Raw').text
            decomp = zlib.decompress(bytes.fromhex(raw)).decode('latin1', errors='replace')
            v_match = re.search(r'/Vertices\[(.*?)\]', decomp)
            coords = [float(x) / 9.0 for x in v_match.group(1).split()]
            pts = list(zip(coords[0::2], coords[1::2]))
            zones.append({'name': name, 'poly': Polygon(pts), 'pts': pts, 'color': ann.find('Color').text})
    return zones

l1 = load_level('Level 1')
print(f"Loaded {len(l1)} Level 1 zones")

# Print edges of each zone in Level 1
for idx, z in enumerate(l1):
    print(f"\n--- [{idx}] {z['name']} ({z['color']}) ---")
    pts = z['pts']
    for i in range(len(pts)):
        p1 = pts[i]
        p2 = pts[(i+1)%len(pts)]
        print(f"  P{i}->P{(i+1)%len(pts)}: ({p1[0]:.2f}, {p1[1]:.2f}) -> ({p2[0]:.2f}, {p2[1]:.2f}) [len={Point(p1).distance(Point(p2)):.2f}]")
