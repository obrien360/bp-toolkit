import pypdf

reader = pypdf.PdfReader('Zoning.pdf')
page = reader.pages[0]
print(f"Page MediaBox: {page.mediabox}")

for idx, annot in enumerate(page.annotations):
    obj = annot.get_object()
    subj = obj.get('/Subj')
    contents = obj.get('/Contents', '')
    first_line = contents.split('\r')[0] if contents else ''
    rect = obj.get('/Rect')
    rot = obj.get('/Rotation')
    ap = obj.get('/AP')
    ap_form = ap.get('/N').get_object() if ap and '/N' in ap else None
    matrix = ap_form.get('/Matrix') if ap_form else None
    bbox = ap_form.get('/BBox') if ap_form else None
    vertices = obj.get('/Vertices')
    v_len = len(vertices) // 2 if vertices else 0
    print(f"[{idx:2d}] {first_line:35s} | Rect={rect} | Rot={rot} | Matrix={matrix} | BBox={bbox} | Vertices={v_len} pts")
