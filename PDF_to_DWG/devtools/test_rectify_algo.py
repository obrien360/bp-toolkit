import numpy as np
from shapely.geometry import Polygon, LineString, MultiLineString
from shapely.ops import unary_union, polygonize
from test_rectify import l1_raw, l2_raw
from cluster_coords import c_x, c_y

def snap_val(val, clusters):
    return min(clusters, key=lambda c: abs(c - val))

def rectify_polygon(pts, c_x, c_y):
    n = len(pts)
    # Determine direction of each edge: 'H' or 'V'
    edge_types = []
    edge_vals = []
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i+1)%n]
        dx = abs(p2[0] - p1[0])
        dy = abs(p2[1] - p1[1])
        if dx >= dy: # Horizontal edge
            # edge has a fixed Y
            y_avg = (p1[1] + p2[1]) / 2.0
            y_snapped = snap_val(y_avg, c_y)
            edge_types.append('H')
            edge_vals.append(y_snapped)
        else: # Vertical edge
            x_avg = (p1[0] + p2[0]) / 2.0
            x_snapped = snap_val(x_avg, c_x)
            edge_types.append('V')
            edge_vals.append(x_snapped)
            
    # Now, find vertex between edge i-1 and edge i
    # Edge i-1 and Edge i must intersect
    new_pts = []
    for i in range(n):
        prev_type = edge_types[(i-1)%n]
        prev_val = edge_vals[(i-1)%n]
        curr_type = edge_types[i]
        curr_val = edge_vals[i]
        
        if prev_type == 'H' and curr_type == 'V':
            new_pts.append((curr_val, prev_val))
        elif prev_type == 'V' and curr_type == 'H':
            new_pts.append((prev_val, curr_val))
        elif prev_type == 'H' and curr_type == 'H':
            # Collinear horizontal edges
            new_pts.append((pts[i][0], curr_val))
        elif prev_type == 'V' and curr_type == 'V':
            # Collinear vertical edges
            new_pts.append((curr_val, pts[i][1]))
            
    # Remove redundant collinear vertices
    clean_pts = []
    m = len(new_pts)
    for i in range(m):
        p_prev = new_pts[(i-1)%m]
        p_curr = new_pts[i]
        p_next = new_pts[(i+1)%m]
        # check if p_curr is collinear between p_prev and p_next
        if (abs(p_prev[0] - p_curr[0]) < 1e-4 and abs(p_curr[0] - p_next[0]) < 1e-4):
            continue
        if (abs(p_prev[1] - p_curr[1]) < 1e-4 and abs(p_curr[1] - p_next[1]) < 1e-4):
            continue
        # Also skip duplicate points
        if clean_pts and abs(clean_pts[-1][0] - p_curr[0]) < 1e-4 and abs(clean_pts[-1][1] - p_curr[1]) < 1e-4:
            continue
        clean_pts.append(p_curr)
    if len(clean_pts) > 1 and abs(clean_pts[0][0] - clean_pts[-1][0]) < 1e-4 and abs(clean_pts[0][1] - clean_pts[-1][1]) < 1e-4:
        clean_pts.pop()
        
    return clean_pts

print("Rectifying Level 1 polygons...")
l1_rect = []
for z in l1_raw:
    r_pts = rectify_polygon(z['pts'], c_x, c_y)
    poly = Polygon(r_pts)
    print(f"  {z['name']:30s} -> {len(r_pts)} pts, valid={poly.is_valid}, area={poly.area:.1f} sf")
    l1_rect.append({'name': z['name'], 'pts': r_pts, 'poly': poly})
