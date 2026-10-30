import pymupdf
from shapely.geometry import Polygon
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon

doc = pymupdf.open('Zoning.pdf')
page = doc[0]
drawings = page.get_drawings()
annots = list(page.annots())
H = 2592.0

fig, axes = plt.subplots(1, 2, figsize=(24, 10))

for lvl_idx, lvl in enumerate(['Level 1', 'Level 2']):
    ax = axes[lvl_idx]
    ax.set_aspect('equal')
    ax.set_title(f"True On-Page Drawings: {lvl}", fontsize=14, weight='bold')
    
    for a in annots:
        if a.info.get('title') != lvl:
            continue
        content = a.info.get('content','').split('\r')[0]
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
            
        pts_cad = [(x / 9.0, (H - y) / 9.0) for x, y in pts_page]
        poly = Polygon(pts_cad)
        patch = MplPolygon(pts_cad, closed=True, facecolor='#8CBD3A' if 'Dwelling' in content else '#4D76AD', alpha=0.3, edgecolor='black', linewidth=1.5)
        ax.add_patch(patch)
        c = poly.centroid
        ax.text(c.x, c.y, content.split('(')[0].strip()[:14], fontsize=7, ha='center', va='center', weight='bold')
        
    ax.autoscale()

plt.tight_layout()
plt.savefig('output_cad/true_drawings_test.png', dpi=150)
plt.close()
print("Saved output_cad/true_drawings_test.png!")
