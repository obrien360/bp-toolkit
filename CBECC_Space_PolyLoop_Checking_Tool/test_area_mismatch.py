"""Quick test to verify area-mismatch detection against Shoebox MDL.cibd19."""
import sys
sys.path.insert(0, '.')

from polyloop_engine import CBECCModel

with open('Shoebox MDL.cibd19', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

model = CBECCModel(content, 'Shoebox MDL.cibd19')

print(f'Total spaces:                      {len(model.spaces)}')
print(f'Missing/invalid + mismatch spaces: {len(model.missing_spaces)}')
print(f'Valid spaces (no mismatch):        {len(model.valid_spaces)}')
print()

mismatch_spaces = [s for s in model.spaces if s.get('area_mismatch')]
purely_missing  = [s for s in model.spaces if not s.get('has_polyloop')]

print(f'Area-mismatch spaces (>5% diff):   {len(mismatch_spaces)}')
for s in mismatch_spaces:
    poly_area = s.get('existing_poly_area', 0)
    floors = s.get('floors', [])
    print(f"  Space: {s['name']}")
    print(f"    Existing PolyLp area : {poly_area:.2f} sq ft")
    print(f"    Child floors         : {len(floors)}")

print()
print(f'Purely missing/no-coords spaces:   {len(purely_missing)}')
for s in purely_missing:
    print(f"  Space: {s['name']}  (has_polylp_header={s['has_polylp_header']})")
