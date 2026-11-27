"""在 PDF 里找若干段文字的位置：python scripts/findtext.py body.pdf '{"key": "要找的文字", …}'
输出 {"key": [页码(从 1 起), 顶边距页面上缘的 pt, 左边 pt]}；找不到的 key 不输出。
用来给只能在排版之后才知道位置的装饰定位（例如 1-2 雾蓝底色在哪一行收住）。"""
import sys, json
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument(sys.argv[1])
want = json.loads(sys.argv[2])
out = {}
for i in range(len(pdf)):
    page = pdf[i]
    h = page.get_height()
    tp = page.get_textpage()
    for key, s in want.items():
        if key in out:
            continue
        sr = tp.search(s)
        hit = sr.get_next()
        if hit:
            idx, n = hit
            l, b, r, t = tp.get_charbox(idx)
            out[key] = [i + 1, round(h - t, 2), round(l, 2)]
print(json.dumps(out, ensure_ascii=False))
