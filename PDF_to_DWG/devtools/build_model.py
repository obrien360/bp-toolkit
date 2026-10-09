from shapely.geometry import Polygon, MultiLineString, LineString, Point, box
from shapely.ops import unary_union, polygonize
import networkx as nx
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon

# Define the clean, snapped orthogonal coordinate grid in feet:
# Let's define the rooms of Level 1 as clean orthogonal polygons:

# 1. Sacred Space: 60.0 ft wide x 40.0 ft high
# In PDF: X from 65.17 to 125.17, Y from 85.27 to 125.27
p_sacred = box(65.17, 85.27, 125.17, 125.27)

# 2. Ancillary Space:
# In PDF: touches Sacred Space on south (Y=125.27), touches spine on north (Y=157.58)
# X from 89.90 to 128.72 (width 38.82 ft), Y from 125.27 to 157.58 (height 32.31 ft)
p_ancillary = box(89.90, 125.27, 128.72, 157.58)

# 3. West Dwelling Unit:
# In PDF: X from 57.85 to 83.94, Y from 157.58 to 215.58 with notch at (67.47, 197.90)
p_west_dwelling = Polygon([
    (57.85, 157.58),
    (83.94, 157.58),
    (83.94, 215.58),
    (67.47, 215.58),
    (67.47, 197.90),
    (57.85, 197.90)
])

# 4. West Stair (Circulation - Not Ventilated):
# X from 83.94 to 95.08, Y from 189.30 to 215.58
p_west_stair = box(83.94, 189.30, 95.08, 215.58)

# 5. West MEP:
# In PDF: X from 74.33 to 105.62, Y from 157.58 to 183.97 with notch for west dwelling unit at (83.94, 175.0)
# Notice in PDF, MEP [15] is from X=74.33 to 105.62, Y=157.58 to 183.97, notch at X=96.04, Y=166.23
# Wait! Let's check MEP [15] bounds:
# X from 74.33 to 105.62, Y from 157.58 to 183.97
p_west_mep = Polygon([
    (74.33, 157.58),
    (105.62, 157.58),
    (105.62, 183.97),
    (74.33, 183.97),
    (74.33, 175.00),
    (83.94, 175.00),
    (83.94, 157.58)
])
# Let's verify p_west_mep against west dwelling unit:
# West dwelling unit has (83.94, 157.58) to (83.94, 215.58)!
# If west dwelling unit right wall is X=83.94, then MEP west wall must be at X=83.94 or west dwelling unit wraps around!
# In PDF: MEP [15] minX is 74.33. That means west dwelling unit has a notch from Y=157.58 to 175.0!

print("Testing geometry setup...")
