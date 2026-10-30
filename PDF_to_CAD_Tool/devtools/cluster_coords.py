import numpy as np
from test_rectify import l1_raw, l2_raw

all_pts = []
for z in l1_raw:
    all_pts.extend(z['pts'])

xs = [p[0] for p in all_pts]
ys = [p[1] for p in all_pts]

def cluster_1d(vals, tol=1.5):
    sorted_vals = sorted(vals)
    clusters = []
    curr = [sorted_vals[0]]
    for v in sorted_vals[1:]:
        if v - curr[-1] <= tol:
            curr.append(v)
        else:
            clusters.append(np.mean(curr))
            curr = [v]
    clusters.append(np.mean(curr))
    return sorted(clusters)

c_x = cluster_1d(xs, tol=2.0)
c_y = cluster_1d(ys, tol=2.0)

print(f"X clusters ({len(c_x)}):")
for x in c_x:
    print(f"  {x:7.2f}")

print(f"\nY clusters ({len(c_y)}):")
for y in c_y:
    print(f"  {y:7.2f}")
