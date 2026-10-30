import ezdxf
from ezdxf.enums import TextEntityAlignment
from verify_level2 import network as l1_network, l2_network, level1_rooms, level2_rooms
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon
import shutil

# Create DXF document
doc = ezdxf.new('R2010')

# Setup Layers
# Level 1 Layers
doc.layers.add('LEVEL_1', color=7)               # White / Black lines
doc.layers.add('LEVEL_1_POLYLOOPS', color=3)     # Green
doc.layers.add('LEVEL_1_TEXT', color=2)          # Yellow

# Level 2 Layers
doc.layers.add('LEVEL_2', color=1)               # Red lines
doc.layers.add('LEVEL_2_POLYLOOPS', color=4)     # Cyan
doc.layers.add('LEVEL_2_TEXT', color=6)          # Magenta

msp = doc.modelspace()

# 1. Add Level 1 single-line wall network
l1_lines_count = 0
for geom in (l1_network.geoms if hasattr(l1_network, 'geoms') else [l1_network]):
    coords = list(geom.coords)
    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i+1]
        msp.add_line((p1[0], p1[1], 0), (p2[0], p2[1], 0), dxfattribs={'layer': 'LEVEL_1'})
        l1_lines_count += 1

# Add Level 1 closed polyloops and text
for name, poly in level1_rooms:
    # Outer ring
    exterior_coords = list(poly.exterior.coords)
    # Add closed LWPOLYLINE
    msp.add_lwpolyline(exterior_coords[:-1], close=True, dxfattribs={'layer': 'LEVEL_1_POLYLOOPS'})
    # Add text label at centroid
    c = poly.centroid
    msp.add_text(
        f"{name}\n{poly.area:.0f} sf",
        dxfattribs={'layer': 'LEVEL_1_TEXT', 'height': 2.0}
    ).set_placement((c.x, c.y, 0), align=TextEntityAlignment.MIDDLE_CENTER)

# 2. Add Level 2 single-line wall network
l2_lines_count = 0
for geom in (l2_network.geoms if hasattr(l2_network, 'geoms') else [l2_network]):
    coords = list(geom.coords)
    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i+1]
        msp.add_line((p1[0], p1[1], 0), (p2[0], p2[1], 0), dxfattribs={'layer': 'LEVEL_2'})
        l2_lines_count += 1

# Add Level 2 closed polyloops and text
for name, poly in level2_rooms:
    exterior_coords = list(poly.exterior.coords)
    msp.add_lwpolyline(exterior_coords[:-1], close=True, dxfattribs={'layer': 'LEVEL_2_POLYLOOPS'})
    c = poly.centroid
    msp.add_text(
        f"{name}\n{poly.area:.0f} sf",
        dxfattribs={'layer': 'LEVEL_2_TEXT', 'height': 2.0}
    ).set_placement((c.x, c.y, 0), align=TextEntityAlignment.MIDDLE_CENTER)

# Save output files
dxf_path = r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning_Clean.dxf'
dwg_path = r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning_Clean.dwg'

doc.saveas(dxf_path)
# Save copy as .dwg for tools that specifically look for .dwg extension
shutil.copyfile(dxf_path, dwg_path)

print(f"Successfully generated:")
print(f"  DXF: {dxf_path}")
print(f"  DWG: {dwg_path}")
print(f"  Level 1 lines: {l1_lines_count}")
print(f"  Level 2 lines: {l2_lines_count}")

# 3. Generate high-resolution verification image
fig, axes = plt.subplots(1, 3, figsize=(28, 10))

# Level 1
ax1 = axes[0]
ax1.set_aspect('equal')
ax1.set_title('Clean Level 1 (Single Lines & Closed Polyloops)', fontsize=14, weight='bold')
for name, p in level1_rooms:
    patch = MplPolygon(list(p.exterior.coords), closed=True, facecolor='#66bb6a' if 'Dwelling' in name else ('#ffa726' if 'Sacred' in name else ('#42a5f5' if 'Circulation' in name else '#ab47bc')), alpha=0.3, edgecolor='black', linewidth=1.5)
    ax1.add_patch(patch)
    c = p.centroid
    ax1.text(c.x, c.y, name.split('(')[0].strip(), fontsize=7, ha='center', va='center', weight='bold')
ax1.autoscale()

# Level 2
ax2 = axes[1]
ax2.set_aspect('equal')
ax2.set_title('Clean Level 2 (Single Lines & Closed Polyloops)', fontsize=14, weight='bold')
for name, p in level2_rooms:
    patch = MplPolygon(list(p.exterior.coords), closed=True, facecolor='#66bb6a' if 'Dwelling' in name else ('#42a5f5' if 'Circulation' in name else '#ab47bc'), alpha=0.3, edgecolor='black', linewidth=1.5)
    ax2.add_patch(patch)
    c = p.centroid
    ax2.text(c.x, c.y, name.split('(')[0].strip(), fontsize=7, ha='center', va='center', weight='bold')
ax2.autoscale()

# Overlay Comparison
ax3 = axes[2]
ax3.set_aspect('equal')
ax3.set_title('Overlay Comparison (Blue: Level 1, Red: Level 2)', fontsize=14, weight='bold')
for geom in (l1_network.geoms if hasattr(l1_network, 'geoms') else [l1_network]):
    coords = list(geom.coords)
    xs, ys = zip(*coords)
    ax3.plot(xs, ys, color='blue', linewidth=2.5, alpha=0.6, label='Level 1' if geom == l1_network.geoms[0] else "")

for geom in (l2_network.geoms if hasattr(l2_network, 'geoms') else [l2_network]):
    coords = list(geom.coords)
    xs, ys = zip(*coords)
    ax3.plot(xs, ys, color='red', linewidth=1.2, linestyle='--', label='Level 2' if geom == l2_network.geoms[0] else "")

ax3.legend(loc='upper right')
ax3.autoscale()

plt.tight_layout()
verification_img = r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning_Clean_Verification.png'
plt.savefig(verification_img, dpi=180)
plt.close()
print(f"Saved verification plot: {verification_img}")
