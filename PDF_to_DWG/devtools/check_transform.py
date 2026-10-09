import pypdf
from shapely.geometry import Polygon

reader = pypdf.PdfReader('Zoning.pdf')
page = reader.pages[0]

transformed_polys = []

for idx, annot in enumerate(page.annotations):
    obj = annot.get_object()
    contents = obj.get('/Contents', '').split('\r')[0]
    author = obj.get('/T', '')
    vertices = obj.get('/Vertices')
    ap = obj.get('/AP')
    ap_form = ap.get('/N').get_object() if ap and '/N' in ap else None
    matrix = ap_form.get('/Matrix') if ap_form else [1, 0, 0, 1, 0, 0]
    
    # In PDF, a Form XObject with Matrix M transforms coordinates from form space to annot space.
    # The annot space is located on the page at Rect.
    # Let's inspect how M maps vertices to page coordinates!
    # Specifically:
    # If Matrix is [a, b, c, d, e, f]:
    # x_page = a*x + c*y + e
    # y_page = b*x + d*y + f
    # But wait! If Matrix is [1, 0, 0, 1, -x0, -y0], then inside the stream, coords were absolute page coords, and Matrix shifts them!
    # Let's inspect the stream ops directly vs vertices!
    stream = ap_form.get_data().decode('latin1', errors='replace')
    import re
    ops = re.findall(r'([-+]?[0-9]*\.?[0-9]+)\s+([-+]?[0-9]*\.?[0-9]+)\s+([ml])', stream)
    raw_pts = [(float(x), float(y)) for x, y, op in ops]
    
    # Let's check how raw_pts relate to Vertices:
    v_pts = list(zip([float(x) for x in vertices[0::2]], [float(y) for y in vertices[1::2]])) if vertices else []
    
    # If Matrix is [-1, 0, 0, -1, e, f]:
    a, b, c, d, e, f_val = [float(val) for val in matrix]
    
    # Try mapping v_pts with matrix:
    m_pts = [(a*x + c*y + e, b*x + d*y + f_val) for x, y in v_pts]
    
    print(f"[{idx:2d}] {author:7s} | {contents:35s}")
    print(f"     Matrix: {matrix}")
    print(f"     V_pts [0]: {v_pts[0] if v_pts else None}")
    print(f"     M_pts [0]: {m_pts[0] if m_pts else None}")
    if raw_pts:
        print(f"     Raw stream pt [0]: {raw_pts[0]}")
