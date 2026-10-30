from assemble_clean_model import *

# Construct Level 2 rooms:
poly_l2_top_dwelling = poly_top_dwelling
poly_l2_east_dwelling = poly_east_dwelling
poly_l2_west_dwelling = poly_west_dwelling
poly_l2_west_stair = poly_west_stair
poly_l2_east_stair = poly_east_stair
poly_l2_east_mep = poly_east_mep
poly_l2_center_stair = poly_center_stair
poly_l2_center_mep = poly_center_mep
poly_l2_center_mep_wrap = poly_center_mep_wrap
poly_l2_laundry = poly_laundry

# Merged spaces on Level 2:
poly_l2_common_mep = unary_union([poly_common_area, poly_west_mep])
poly_l2_resident = poly_resident_services
poly_l2_south_dwelling = unary_union([poly_dwelling_8, poly_dwelling_9, corr_branch])

# Corridor on Level 2 (without the east-west branch into dwelling 8 & 9):
poly_l2_circulation = unary_union([corr_ew, corr_ns, corr_east])

level2_rooms = [
    ('Dwelling Units (Top/East Wing)', poly_l2_top_dwelling),
    ('Dwelling Units (East Wing)', poly_l2_east_dwelling),
    ('Dwelling Units (Center-West, ex-Common/MEP)', poly_l2_common_mep),
    ('Dwelling Units (ex-Resident Services)', poly_l2_resident),
    ('Dwelling Units (West Wing)', poly_l2_west_dwelling),
    ('Dwelling Units (South Combined)', poly_l2_south_dwelling),
    ('Circulation', poly_l2_circulation),
    ('Circulation - Not Ventilated (East Stair)', poly_l2_east_stair),
    ('MEP/BOH (East)', poly_l2_east_mep),
    ('Circulation - Not Ventilated (West Stair)', poly_l2_west_stair),
    ('Circulation - Not Ventilated (Center Stair)', poly_l2_center_stair),
    ('MEP/BOH (Center)', poly_l2_center_mep),
    ('MEP/BOH (Center Wrap)', poly_l2_center_mep_wrap),
    ('Laundry', poly_l2_laundry)
]

print("\n=== Level 2 Clean Geometry ===")
tot_area_l2 = 0
for name, p in level2_rooms:
    print(f"  {name:42s}: {p.area:7.1f} sf, valid={p.is_valid}")
    tot_area_l2 += p.area
print(f"Total Level 2 Area: {tot_area_l2:,.1f} sf")

# Check Planar Graph for Level 2:
l2_boundaries = [p.boundary for name, p in level2_rooms]
l2_network = unary_union(l2_boundaries)
l2_faces = list(polygonize(l2_network))
print(f"\nLevel 2 Planar Graph network: {len(l2_network.geoms) if hasattr(l2_network, 'geoms') else 1} segments")
print(f"Level 2 Polygonize recovered: {len(l2_faces)} closed faces!")

l2_endpoints = defaultdict(int)
for geom in (l2_network.geoms if hasattr(l2_network, 'geoms') else [l2_network]):
    coords = list(geom.coords)
    l2_endpoints[coords[0]] += 1
    l2_endpoints[coords[-1]] += 1

l2_dangling = [pt for pt, count in l2_endpoints.items() if count == 1]
print(f"Level 2 Dangling endpoints (open end lines): {len(l2_dangling)}")

# Check overlay between Level 1 and Level 2:
# For every line in Level 2 that also exists in Level 1, verify exact coordinate match!
l1_edges = set()
for geom in (network.geoms if hasattr(network, 'geoms') else [network]):
    c = tuple(geom.coords)
    l1_edges.add((c[0], c[-1]))
    l1_edges.add((c[-1], c[0]))

matching_edges = 0
total_l2_edges = 0
for geom in (l2_network.geoms if hasattr(l2_network, 'geoms') else [l2_network]):
    total_l2_edges += 1
    c = tuple(geom.coords)
    if (c[0], c[-1]) in l1_edges:
        matching_edges += 1

print(f"\nOverlay verification: {matching_edges} of {total_l2_edges} Level 2 edges are EXACT IDENTICAL MATCHES with Level 1!")
