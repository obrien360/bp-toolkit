import xml.etree.ElementTree as ET
from collections import defaultdict

tree = ET.parse(r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning.txt')
root = tree.getroot()

annotations = []
for ann in root.findall('.//Annotation'):
    contents = ann.find('Contents').text if ann.find('Contents') is not None else ''
    color = ann.find('Color').text if ann.find('Color') is not None else ''
    author = ann.find('Author').text if ann.find('Author') is not None else ''
    creation = ann.find('CreationDate').text if ann.find('CreationDate') is not None else ''
    idx = ann.find('Index').text if ann.find('Index') is not None else ''
    lines = contents.split('\n')
    name = lines[0].strip() if len(lines) > 0 else ''
    area_str = lines[1].strip() if len(lines) > 1 else ''
    annotations.append({
        'index': idx,
        'author': author,
        'color': color,
        'name': name,
        'area_str': area_str,
    })

print(f"Total annotations: {len(annotations)}")
by_author = defaultdict(list)
for a in annotations:
    by_author[a['author']].append(a)

for auth, items in by_author.items():
    print(f"\n--- {auth} ---")
    tot = 0.0
    for it in items:
        val_str = it['area_str'].replace(' sf', '').replace(',', '')
        try:
            val = float(val_str)
            tot += val
        except:
            val = 0
        print(f"  [{it['color']}] {it['name']}: {it['area_str']}")
    print(f"Total: {tot:,.2f} sf")

# Check unique space categories and their colors
by_cat = defaultdict(float)
cat_colors = {}
for a in annotations:
    val_str = a['area_str'].replace(' sf', '').replace(',', '')
    try:
        val = float(val_str)
    except:
        val = 0
    by_cat[(a['author'], a['name'])] += val
    cat_colors[a['name']] = a['color']

print("\n--- Summary by Program Type and Color ---")
for cat, col in cat_colors.items():
    print(f"Category: {cat} (Color: {col})")
