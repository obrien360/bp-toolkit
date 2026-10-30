import xml.etree.ElementTree as ET
import zlib
import re
import math
from shapely.geometry import Polygon, LineString, MultiLineString, Point, box
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
l2 = load_level('Level 2')

print("Loaded L1:", len(l1), "L2:", len(l2))
