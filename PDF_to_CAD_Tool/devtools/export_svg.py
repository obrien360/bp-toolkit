import xml.etree.ElementTree as ET
import zlib
import re

tree = ET.parse(r'c:\Users\JirehPeng\Downloads\PDFtoDWG\Zoning.txt')

def export_svg(level_name, filename):
    polys = []
    min_x, min_y, max_x, max_y = 1e9, 1e9, -1e9, -1e9
    for ann in tree.findall('.//Annotation'):
        if ann.find('Author').text == level_name:
            name = ann.find('Contents').text.replace('\n', ' ')
            color = ann.find('Color').text
            raw = ann.find('Raw').text
            decomp = zlib.decompress(bytes.fromhex(raw)).decode('latin1', errors='replace')
            v_match = re.search(r'/Vertices\[(.*?)\]', decomp)
            coords = [float(x) / 9.0 for x in v_match.group(1).split()]
            pts = list(zip(coords[0::2], coords[1::2]))
            polys.append((name, color, pts))
            for x, y in pts:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    
    # SVG coordinates: flip Y so higher Y is higher up
    pad = 10
    w = (max_x - min_x) + 2 * pad
    h = (max_y - min_y) + 2 * pad
    scale = 3.0  # pixels per foot
    
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w*scale}" height="{h*scale}" viewBox="0 0 {w} {h}">']
    svg.append(f'<rect width="{w}" height="{h}" fill="#f8f9fa"/>')
    svg.append(f'<g transform="translate({pad - min_x}, {max_y + pad}) scale(1, -1)">')
    
    for name, color, pts in polys:
        pt_str = ' '.join(f'{x:.2f},{y:.2f}' for x, y in pts)
        svg.append(f'  <polygon points="{pt_str}" fill="{color}" fill-opacity="0.35" stroke="{color}" stroke-width="0.8" stroke-dasharray="2,2"/>')
        # centroid
        cx = sum(x for x, y in pts) / len(pts)
        cy = sum(y for x, y in pts) / len(pts)
        # short name
        sname = name.split()[0]
        svg.append(f'  <text x="{cx:.1f}" y="{cy:.1f}" font-size="3" fill="#222" transform="scale(1, -1) translate(0, {-2*cy:.1f})" text-anchor="middle">{sname}</text>')
    
    svg.append('</g>')
    svg.append('</svg>')
    with open(filename, 'w') as f:
        f.write('\n'.join(svg))
    print(f'Wrote {filename}')

export_svg('Level 1', 'level1.svg')
export_svg('Level 2', 'level2.svg')
