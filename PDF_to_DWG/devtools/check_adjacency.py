import xml.etree.ElementTree as ET
import zlib
import re
from shapely.geometry import Polygon, LineString, MultiLineString, Point
from shapely.ops import unary_union

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

# Check overlaps and gaps between pairs of zones
for i in range(len(l1)):
    for j in range(i+1, len(l1)):
        p1 = l1[i]['poly']
        p2 = l1[j]['poly']
        inter = p1.intersection(p2)
        dist = p1.distance(p2)
        if inter.area > 0.01:
            print(f"OVERLAP: [{i}] {l1[i]['name']} and [{j}] {l1[j]['name']} area={inter.area:.2f} sf")
        elif dist < 1.0: # within 1 foot
            print(f"ADJACENT: [{i}] {l1[i]['name']} and [{j}] {l1[j]['name']} dist={dist:.4f} ft")
