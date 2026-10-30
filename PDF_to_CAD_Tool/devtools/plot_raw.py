import xml.etree.ElementTree as ET
import zlib
import re
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon

tree = ET.parse(r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning.txt')

for level in ['Level 1', 'Level 2']:
    fig, ax = plt.subplots(figsize=(16, 12))
    ax.set_aspect('equal')
    ax.set_title(f'Raw Bluebeam Polygons - {level}', fontsize=16)
    
    count = 0
    for ann in tree.findall('.//Annotation'):
        if ann.find('Author').text == level:
            count += 1
            name = ann.find('Contents').text.replace('\n', ' ')
            color = ann.find('Color').text
            raw = ann.find('Raw').text
            decomp = zlib.decompress(bytes.fromhex(raw)).decode('latin1', errors='replace')
            v_match = re.search(r'/Vertices\[(.*?)\]', decomp)
            coords = [float(x) / 9.0 for x in v_match.group(1).split()]
            pts = list(zip(coords[0::2], coords[1::2]))
            
            # Draw polygon
            poly = MplPolygon(pts, closed=True, facecolor=color, edgecolor='black', alpha=0.35, linewidth=1.5)
            ax.add_patch(poly)
            
            # Label
            cx = sum(x for x, y in pts) / len(pts)
            cy = sum(y for x, y in pts) / len(pts)
            short_name = name.split()[0]
            ax.text(cx, cy, f"{short_name}\n({len(pts)}p)", fontsize=8, ha='center', va='center', weight='bold')

    ax.autoscale()
    plt.savefig(f'{level.lower().replace(" ", "_")}_raw.png', dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved {level.lower().replace(' ', '_')}_raw.png")
