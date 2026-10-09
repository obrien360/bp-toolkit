import pymupdf
import re

doc = pymupdf.open('Zoning.pdf')
page = doc[0]

# For each annotation, let's get its appearance XObject Form
# and inspect how MuPDF draws it!
for i, a in enumerate(page.annots()):
    info = a.info
    title = info.get('title', '')
    content = info.get('content', '').split('\r')[0]
    rect = a.rect # in page coords
    
    # Render just this annotation to a pixmap
    pix = a.get_pixmap()
    print(f"[{i:2d}] {title:7s} | {content:32s} | Rect={rect} | Pixmap={pix.width}x{pix.height}")
