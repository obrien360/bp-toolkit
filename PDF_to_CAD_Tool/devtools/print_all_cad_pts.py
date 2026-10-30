import pymupdf

doc = pymupdf.open('Zoning.pdf')
page = doc[0]
drawings = page.get_drawings()
annots = list(page.annots())

for lvl in ['Level 1', 'Level 2']:
    print(f"\n==================== {lvl} ====================")
    count = 0
    for a in annots:
        author = a.info.get('title', '')
        if author != lvl:
            continue
        count += 1
        content = a.info.get('content', '').split('\r')[0]
        a_rect = a.rect
        best_d = min(drawings, key=lambda d: abs(a_rect.x0 - d['rect'].x0) + abs(a_rect.y0 - d['rect'].y0) + abs(a_rect.x1 - d['rect'].x1) + abs(a_rect.y1 - d['rect'].y1))
        
        pts_page = []
        for item in best_d['items']:
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                if not pts_page:
                    pts_page.append((p1.x, p1.y))
                pts_page.append((p2.x, p2.y))
            elif item[0] == 're':
                r = item[1]
                pts_page = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
        if len(pts_page) > 1 and pts_page[0] == pts_page[-1]:
            pts_page.pop()
        
        pts_cad = [(round(x / 9.0, 3), round((2592.0 - y) / 9.0, 3)) for x, y in pts_page]
        print(f"[{count:2d}] {content:30s} ({len(pts_cad)} pts):")
        for i, p in enumerate(pts_cad):
            print(f"     P{i}: ({p[0]:7.3f}, {p[1]:7.3f})")
