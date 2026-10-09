import fitz

doc = fitz.open('Zoning.pdf')
page = doc[0]
print(f"Page rect: {page.rect}")
annots = list(page.annots())
print(f"Page annots: {len(annots)}")

for i, a in enumerate(annots):
    info = a.info
    vertices = a.vertices
    rect = a.rect
    colors = a.colors
    content = info.get("content", "").splitlines()[0] if info.get("content") else ""
    title = info.get("title", "")
    print(f"[{i:2d}] {title:7s}: {content:32s} | Rect={rect} | vertices={len(vertices)}")
