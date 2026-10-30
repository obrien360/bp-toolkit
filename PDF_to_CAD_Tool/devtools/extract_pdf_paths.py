import re

with open('Zoning.pdf', 'rb') as f:
    pdf = f.read()

# Find all annotations in PDF
annot_matches = list(re.finditer(rb'<<\s*/Type\s*/Annot\s*/Subtype\s*/Polygon\b.*?(?:/NM\s*\((.*?)\)).*?>>', pdf, re.DOTALL))
print(f"Found {len(annot_matches)} annot objects")

# Alternatively, find all objects with Subtype /Polygon
objs = re.findall(rb'(\d+)\s+0\s+obj\b(.*?)\bendobj\b', pdf, re.DOTALL)
print(f"Total objects in PDF: {len(objs)}")

annot_objs = []
stream_objs = {}

for num, body in objs:
    num = int(num)
    if b'/Subtype /Polygon' in body or b'/Subtype/Polygon' in body:
        annot_objs.append((num, body))
    if b'stream' in body:
        m = re.search(rb'stream[\r\n]+(.*?)[\r\n]+endstream', body, re.DOTALL)
        if m:
            stream_objs[num] = (body, m.group(1))

print(f"Polygon annot objects: {len(annot_objs)}")
print(f"Stream objects: {len(stream_objs)}")

results = []
for num, body in annot_objs:
    # get Contents
    contents_m = re.search(rb'/Contents\s*<feff(.*?)>', body)
    contents = ""
    if contents_m:
        hex_str = contents_m.group(1).decode()
        contents = bytes.fromhex(hex_str).decode('utf-16-be', errors='replace').replace('\r', ' ')
    
    # get Title / Author / OC
    oc_m = re.search(rb'/OC\s*\((.*?)\)', body)
    oc = oc_m.group(1).decode() if oc_m else ""
    
    # get color
    c_m = re.search(rb'/C\s*\[(.*?)\]', body)
    color = c_m.group(1).decode() if c_m else ""
    
    # get AP stream
    ap_m = re.search(rb'/AP\s*<<\s*/N\s*(\d+)\s+0\s+R', body)
    ap_num = int(ap_m.group(1)) if ap_m else None
    
    stream_text = ""
    if ap_num in stream_objs:
        s_body, s_data = stream_objs[ap_num]
        stream_text = s_data.decode('latin1', errors='replace')
    
    # parse path from stream
    # look for coordinates followed by m, l, etc.
    # e.g. "617.8622 1174.508 m 1155.807 1127.444 l ..."
    ops = re.findall(r'([-+]?[0-9]*\.?[0-9]+)\s+([-+]?[0-9]*\.?[0-9]+)\s+([ml])', stream_text)
    pts = [(float(x) / 9.0, float(y) / 9.0) for x, y, op in ops]
    
    results.append({
        'num': num,
        'oc': oc,
        'contents': contents.strip(),
        'color': color,
        'pts_count': len(pts),
        'pts': pts
    })

print(f"\nExtracted paths for {len(results)} annotations:")
for r in results:
    pts_summary = f"{r['pts'][0]} -> {r['pts'][1]} ... ({len(r['pts'])} pts)" if r['pts'] else "NO PTS"
    print(f"[{r['oc']:7s}] {r['contents']:35s} | {pts_summary}")
