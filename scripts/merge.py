import sys, os
from pypdf import PdfReader, PdfWriter
from pypdf import Transformation
from pypdf.generic import RectangleObject
import json

body, overlay, out = sys.argv[1], sys.argv[2], sys.argv[3]
# 可选第 4 个参数：under.json（页码列表，从 1 起）。这些页的 overlay 垫在正文**下面**——
# 满版底色 / 网点照片在 overlay 层，正文字压在上面（篇目跨页，见 build.mjs 的 ART）
under = set(json.load(open(sys.argv[4], encoding='utf8'))) if len(sys.argv) > 4 else set()
MM = 72 / 25.4
W, H, BL = 216 * MM, 303 * MM, 3 * MM
trim = RectangleObject([BL, BL, W - BL, H - BL])
full = RectangleObject([0, 0, W, H])

rb, ro = PdfReader(body), PdfReader(overlay)
assert len(rb.pages) == len(ro.pages), (len(rb.pages), len(ro.pages))

def build(screen):
    w = PdfWriter(clone_from=body)
    for i, pg in enumerate(w.pages):
        if i + 1 in under:
            pg.merge_transformed_page(ro.pages[i], Transformation(), over=False)
        else:
            pg.merge_page(ro.pages[i])
        if screen:
            pg.mediabox = trim; pg.cropbox = trim; pg.trimbox = trim; pg.bleedbox = trim
        else:
            pg.mediabox = full; pg.cropbox = full; pg.bleedbox = full; pg.trimbox = trim
    w.add_metadata({'/Title': '共鸣（RESONANCE）', '/Author': '浙江省桐乡市高级中学 音乐社×化学社×哲学社×新闻社×数学社',
                    '/Subject': 'RESONANCE student journal', '/Creator': 'Resonance build (Playwright + Chrome)'})
    return w

locked = []
for screen, name in [(True, 'resonance-screen.pdf'), (False, 'resonance-print-rgb.pdf')]:
    p = os.path.join(out, name)
    tmp = p + '.tmp'
    with open(tmp, 'wb') as f:
        build(screen).write(f)
    try:
        os.replace(tmp, p)          # 原子替换：先写临时文件，避免写到一半被打断留下坏档
    except PermissionError:
        # Windows 上目标被 Acrobat / 预览面板占用时无法替换：另存一份 .new.pdf 供改名，
        # 并以非零状态退出——否则 demo / cmyk 会悄悄拿旧稿派生，等于发出一份过期文件
        alt = p[:-4] + '.new.pdf'
        os.replace(tmp, alt)
        print('LOCKED', p, '-> 已写出', alt)
        locked.append(alt)
        continue
    print('wrote', p, os.path.getsize(p))

if locked:
    print('请关闭占用该文件的阅读器后重跑；新稿已在：', ', '.join(locked))
    sys.exit(2)
