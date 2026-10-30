import pymupdf
import re

doc = pymupdf.open('Zoning.pdf')
page = doc[0]

# In PDF, when an annotation has an AP stream (Form XObject),
# the Form XObject content stream has graphics operators.
# Let's inspect the operators for annotation 0 and annotation 1!

annots_list = list(page.annots())
for i in range(len(annots_list)):
    a = annots_list[i]
    content = a.info.get('content', '').split('\r')[0]
    title = a.info.get('title', '')
    
    pass

drawings = page.get_drawings()
print(f"Total drawings extracted by page.get_drawings(): {len(drawings)}")
for i, d in enumerate(drawings[:5]):
    print(f"Draw {i}: rect={d.get('rect')} color={d.get('color')} fill={d.get('fill')} items={len(d.get('items', []))}")
