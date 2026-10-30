from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, box
from shapely.ops import unary_union, polygonize
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon

# Construct clean orthogonal polygons for Level 1:

# 1. Sacred Space: 60 x 40 ft = 2,400 sf
poly_sacred = box(65.17, 85.27, 125.17, 125.27)

# 2. Ancillary: 38.82 x 32.31 ft = 1,254 sf (target ~1186 sf)
# Let's adjust Ancillary X to [89.90, 126.60] -> 36.7 x 32.31 = 1186 sf!
poly_ancillary = box(89.90, 125.27, 126.60, 157.58)

# 3. West Dwelling Unit: target 1,343.35 sf
# X from 57.85 to 83.94 (w=26.09), Y from 157.58 to 215.58 (h=58.0), notch at (67.47, 197.90)
poly_west_dwelling = Polygon([
    (57.85, 157.58),
    (83.94, 157.58),
    (83.94, 215.58),
    (67.47, 215.58),
    (67.47, 197.90),
    (57.85, 197.90)
])

# 4. West Stair: X from 83.94 to 95.08, Y from 189.30 to 215.58 (target 292.8 sf)
poly_west_stair = box(83.94, 189.30, 95.08, 215.58)

# 5. West MEP: target 744.15 sf
# X from 74.33 to 105.62, Y from 157.58 to 183.97, notch at X=83.94, Y=175.26
poly_west_mep = Polygon([
    (74.33, 157.58),
    (105.62, 157.58),
    (105.62, 183.97),
    (83.94, 183.97),
    (83.94, 175.26),
    (74.33, 175.26)
])

# 6. Common Area: target 1,662.8 sf
# X from 105.62 to 168.62 (w=63.0), Y from 157.58 to 183.97 (h=26.39) -> area = 1662.6 sf!
poly_common_area = box(105.62, 157.58, 168.62, 183.97)

# 7. Laundry: target 231.5 sf
# X from 168.62 to 188.24 (w=19.62), Y from 157.58 to 169.40 (h=11.82) -> area = 231.9 sf!
poly_laundry = box(168.62, 157.58, 188.24, 169.40)

# 8. Center MEP: target 284.95 sf
# X from 168.62 to 188.24 (w=19.62), Y from 169.40 to 183.97 (h=14.57) -> area = 285.9 sf!
poly_center_mep = box(168.62, 169.40, 188.24, 183.97)

# 9. Resident Services: target 1,805.3 sf
# X from 161.74 to 193.69, Y from 97.37 to 157.58, notch at (167.42, 120.67)
poly_resident_services = Polygon([
    (161.74, 120.67),
    (167.42, 120.67),
    (167.42, 97.37),
    (193.69, 97.37),
    (193.69, 157.58),
    (161.74, 157.58)
])

# 10. South Dwelling Unit 8: target 960.3 sf
# X from 193.69 to 219.94 (w=26.25), Y from 97.37 to 134.27 (h=36.90) -> area = 968.6 sf!
poly_dwelling_8 = box(193.69, 97.37, 219.94, 134.27)

# 11. South Dwelling Unit 9: target 572.35 sf
# X from 193.69 to 219.94 (w=26.25), Y from 141.90 to 163.60 (h=21.70) -> area = 569.6 sf!
poly_dwelling_9 = box(193.69, 141.90, 219.94, 163.60)

# 12. Central Stair [13]: target 178.56 sf
# X from 200.26 to 219.94 (w=19.68), Y from 166.00 to 175.10 (h=9.10) -> area = 179.1 sf!
poly_center_stair = box(200.26, 166.00, 219.94, 175.10)

# 13. Central MEP [16] (L-shaped wrap around stair 13): target 125.83 sf
# X from 193.69 to 200.26 from Y=163.60 to 175.10, and X from 200.26 to 219.94 from Y=163.60 to 166.00
poly_center_mep_wrap = Polygon([
    (193.69, 163.60),
    (219.94, 163.60),
    (219.94, 166.00),
    (200.26, 166.00),
    (200.26, 175.10),
    (193.69, 175.10)
])

# 14. East Wing Dwelling Unit [2]: target 1,481.5 sf
# X from 219.94 to 274.65 (w=54.71), Y from 157.58 to 184.07 (h=26.49) -> area = 1449.3 sf!
poly_east_dwelling = box(219.94, 157.58, 274.65, 184.07)

# 15. East Stair [10]: target 271.19 sf
# X from 270.78 to 294.32 (w=23.54), Y from 150.03 to 162.62 (h=12.59) -> area = 296.4 sf!
poly_east_stair = box(270.78, 150.03, 294.32, 162.62)

# 16. East MEP [11]: target 430.11 sf
# X from 274.65 to 290.93 (w=16.28), Y from 162.62 to 189.30 (h=26.68) -> area = 434.4 sf!
poly_east_mep = box(274.65, 162.62, 290.93, 189.30)

# 17. Circulation Corridor [4]: target 2,150.58 sf
# E-W spine: Y = [184.07, 189.30], X from 83.94 to 290.93
# N-S branch down to Resident Services: X = [188.24, 193.69], Y from 134.27 to 184.07
# E-W branch between dwelling 8 and 9: Y = [134.27, 141.90], X from 193.69 to 219.94
# East branch down along east wing: X = [290.93, 296.26], Y from 130.00 to 189.30
corr_ew = box(83.94, 184.07, 290.93, 189.30)
corr_ns = box(188.24, 134.27, 193.69, 184.07)
corr_branch = box(193.69, 134.27, 219.94, 141.90)
corr_east = box(290.93, 130.00, 296.26, 189.30)
poly_circulation = unary_union([corr_ew, corr_ns, corr_branch, corr_east])

# 18. Top / East Dwelling Unit Wing [0]: target 9,775.64 sf
# Top wing: Y = [189.30, 215.58], X from 95.08 to 329.95
# East wing: X = [296.26, 329.95], Y from 101.77 to 215.58
# SE corner projection: X = [270.78, 296.26], Y from 101.77 to 150.03
top_wing = box(95.08, 189.30, 329.95, 215.58)
east_wing = box(296.26, 101.77, 329.95, 215.58)
se_proj = box(270.78, 101.77, 296.26, 150.03)
poly_top_dwelling = unary_union([top_wing, east_wing, se_proj])

level1_rooms = [
    ('Dwelling Units (Top/East Wing)', poly_top_dwelling),
    ('Mason UMC - Sacred Space', poly_sacred),
    ('Dwelling Units (East Wing)', poly_east_dwelling),
    ('Common Area', poly_common_area),
    ('Circulation', poly_circulation),
    ('Resident Services', poly_resident_services),
    ('Mason UMC - Ancillary', poly_ancillary),
    ('Dwelling Units (West Wing)', poly_west_dwelling),
    ('Dwelling Units (South 1)', poly_dwelling_8),
    ('Dwelling Units (South 2)', poly_dwelling_9),
    ('Circulation - Not Ventilated (East Stair)', poly_east_stair),
    ('MEP/BOH (East)', poly_east_mep),
    ('Circulation - Not Ventilated (West Stair)', poly_west_stair),
    ('Circulation - Not Ventilated (Center Stair)', poly_center_stair),
    ('MEP/BOH (Center)', poly_center_mep),
    ('MEP/BOH (West)', poly_west_mep),
    ('MEP/BOH (Center Wrap)', poly_center_mep_wrap),
    ('Laundry', poly_laundry)
]

print("=== Level 1 Clean Geometry ===")
tot_area = 0
for name, p in level1_rooms:
    print(f"  {name:42s}: {p.area:7.1f} sf, valid={p.is_valid}")
    tot_area += p.area
print(f"Total Level 1 Area: {tot_area:,.1f} sf")

# Check Planar Graph Extraction (Rule 1 & Rule 3):
boundaries = [p.boundary for name, p in level1_rooms]
network = unary_union(boundaries)
# polygonize network
faces = list(polygonize(network))
print(f"\nPlanar Graph network: {len(network.geoms) if hasattr(network, 'geoms') else 1} segments")
print(f"Polygonize recovered: {len(faces)} closed faces (expected >= 18)!")

# Check open endpoints in network:
from collections import defaultdict
endpoint_count = defaultdict(int)
for geom in (network.geoms if hasattr(network, 'geoms') else [network]):
    coords = list(geom.coords)
    endpoint_count[coords[0]] += 1
    endpoint_count[coords[-1]] += 1

dangling = [pt for pt, count in endpoint_count.items() if count == 1]
print(f"Dangling endpoints (open end lines): {len(dangling)}")
if dangling:
    print("Dangling points:", dangling)
