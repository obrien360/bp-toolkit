import os
import sys
import pymupdf
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon

script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, script_dir)
from cad_engine import detect_pdf_scale, extract_raw_zones

doc = pymupdf.open(os.path.join(script_dir, 'Zoning.pdf'))
pts_per_ft, _, _ = detect_pdf_scale(doc)
zones_by_level = extract_raw_zones(doc, scale=pts_per_ft)

# Plot Level 1 and Level 2 in CAD coordinates
for lvl in ['Level 1', 'Level 2']:
    fig, ax = plt.subplots(figsize=(16, 12))
    ax.set_aspect('equal')
    ax.set_title(f'Correctly Extracted Drawings (Feet) - {lvl}', fontsize=16)
    
    for zone in zones_by_level.get(lvl, []):
        pts = zone['pts']
        fill = zone['fill_color'] or (0.8, 0.8, 0.8)
        poly = MplPolygon(pts, closed=True, facecolor=fill, edgecolor='black', alpha=0.4, linewidth=1.5)
        ax.add_patch(poly)
        cx = sum(x for x, y in pts) / len(pts)
        cy = sum(y for x, y in pts) / len(pts)
        ax.text(cx, cy, zone['name'].split()[0], fontsize=8, ha='center', va='center', weight='bold')
    
    ax.autoscale()
    output_path = os.path.join(script_dir, 'output_cad', f'{lvl.lower().replace(" ", "_")}_cad.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved {lvl.lower().replace(' ', '_')}_cad.png")
