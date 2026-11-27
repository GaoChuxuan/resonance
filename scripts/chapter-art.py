"""网点底图（章扉页、篇目跨页）：真实风光照片 → CMYK 四色网点或单 / 双色专色网 + 轻微套印错位（色散）+ 纸张质感。

由 scripts/build.mjs 调用：python scripts/chapter-art.py <spec.json> <out.jpg>
spec（单位 mm，原点 = 出血页左上角，整页 216 × 303 mm）：
  photo: 源图路径；focus: [fx, fy] 裁切中心（0–1）；rect: [x, y, w, h] 照片在页面上的位置
  circles: [[cx, cy, r], …] 实色蓝圆；circle_rgb: 圆的颜色
  seed: 纸纹随机种子（每章固定，重建结果不变）
  photos: [{photo, focus, rect, zoom, exposure, contrast, lift, lpi, fade: [y0, y1],
            mode: 'cmyk' | 'inks', inks: [{rgb, angle, src: dark|light|warm, gain, gamma, shift}]}]
          （与单张 photo 写法二选一；inks 模式是专色网：每个油墨一块版，覆盖率取自暗部或暖色灯光）
  fills: [{rect, rgb}] 照片之前的实色平涂；paper: 纸色；texture: false 关纸纹；dpi；quality
  out_rect: [x, y, w, h] 只输出页面上的这一块（默认整页）
输出 RGB 位图（默认 300 dpi）。文字不画在这里，由 overlay 用矢量叠上去。

只用 numpy + Pillow；不引入透明：输出是一张不透明位图，CMYK 版由 Ghostscript 整体换算。
"""
import json, sys, math
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

DPI = 300
MM = DPI / 25.4
PAGE_W, PAGE_H = 216, 303

# 纸：暖白（参照图 2 的米色纸，但更浅，正文页仍是白纸，章扉页像一张另外裱进来的印刷品）
PAPER = np.array([238, 233, 222], np.float32) / 255
# 四色油墨（近似胶印油墨在纸上的颜色），叠印按正片叠底
INKS = {
    'c': np.array([0, 158, 224], np.float32) / 255,
    'm': np.array([228, 0, 124], np.float32) / 255,
    'y': np.array([255, 226, 0], np.float32) / 255,
    'k': np.array([38, 36, 37], np.float32) / 255,
}
# 网角（度）与套印错位（像素，300 dpi 下 1 px ≈ 0.085 mm）：错位只有 1–3 px，是「轻微」色散
ANGLE = {'c': 15, 'm': 75, 'y': 0, 'k': 45}
SHIFT = {'c': (3, 1), 'm': (-2, 2), 'y': (1, -3), 'k': (0, 0)}
LPI = 42                      # 网线数：粗到肉眼能看见网点，但不至于糊掉山脊轮廓
CELL = DPI / LPI


def paper_texture(h, w, rng):
    """纸纹：低频斑驳 + 细颗粒 + 稀疏纤维。返回 (h, w) 的明度系数，均值约 1。"""
    def blurred_noise(scale, radius):
        sh, sw = max(2, h // scale), max(2, w // scale)
        n = Image.fromarray((rng.random((sh, sw)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        if radius:
            n = n.filter(ImageFilter.GaussianBlur(radius))
        a = np.asarray(n, np.float32) / 255
        return (a - a.mean()) / (a.std() + 1e-6)
    mottle = blurred_noise(60, 40) * 0.0055 + blurred_noise(12, 6) * 0.004
    grain = (rng.standard_normal((h, w)).astype(np.float32)) * 0.022
    grain = np.asarray(Image.fromarray(((grain + 0.5) * 255).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255 - 0.5
    tex = 1 + mottle + grain * 0.9
    # 纤维：短弧线，略暗或略亮
    fib = Image.new('L', (w, h), 128)
    d = ImageDraw.Draw(fib)
    for _ in range(int(w * h / 9000)):
        x, y = rng.random() * w, rng.random() * h
        L = 8 + rng.random() * 46
        a0 = rng.random() * math.pi
        bend = (rng.random() - .5) * .6
        pts = [(x + math.cos(a0 + bend * t) * L * t, y + math.sin(a0 + bend * t) * L * t) for t in np.linspace(0, 1, 6)]
        d.line(pts, fill=int(128 + (rng.random() - .62) * 60), width=1)
    fib = np.asarray(fib.filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255 - 0.5
    return tex + fib * 0.10


def separate(rgb):
    """朴素分色：RGB → CMYK（骨架黑 + 灰成分替代），返回 0–1 的覆盖率。"""
    c, m, y = 1 - rgb[..., 0], 1 - rgb[..., 1], 1 - rgb[..., 2]
    k = np.clip((np.minimum(np.minimum(c, m), y) - 0.12) * 1.15, 0, 1)
    d = np.maximum(1 - k, 1e-4)
    out = {'c': (c - k) / d, 'm': (m - k) / d, 'y': (y - k) / d, 'k': k}
    # 网点扩大补偿 + 高光留白：极浅的地方不出网点（纸色就是高光）
    for ch in out:
        v = np.clip(out[ch], 0, 1)
        v = np.where(v < 0.04, 0, v) ** 1.12
        out[ch] = v.astype(np.float32)
    return out


def screen(cov, angle, cell):
    """AM 圆点网：余弦点形，低覆盖是圆点、50% 附近成棋盘、高覆盖是白孔。带 1 px 抗锯齿。"""
    h, w = cov.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = math.radians(angle)
    u = (xx * math.cos(a) + yy * math.sin(a)) / cell
    v = (-xx * math.sin(a) + yy * math.cos(a)) / cell
    t = (np.cos(2 * math.pi * u) + np.cos(2 * math.pi * v)) * 0.25 + 0.5   # 0–1，格心最大
    edge = 1.6 / cell                                                    # 抗锯齿带宽
    return np.clip((t - (1 - cov)) / edge + 0.5, 0, 1)


def shift(a, dx, dy):
    return np.roll(np.roll(a, dy, axis=0), dx, axis=1)


def screen_at(cov, angle, cell, ox, oy):
    """同 screen()，但网格相位按整页坐标（ox, oy 为 cov 左上角在整页里的像素位置），
    这样只算局部区域时网点仍与整页对齐。"""
    h, w = cov.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx += ox; yy += oy
    a = math.radians(angle)
    u = (xx * math.cos(a) + yy * math.sin(a)) / cell
    v = (-xx * math.sin(a) + yy * math.cos(a)) / cell
    t = (np.cos(2 * math.pi * u) + np.cos(2 * math.pi * v)) * 0.25 + 0.5
    edge = 1.6 / cell
    return np.clip((t - (1 - cov)) / edge + 0.5, 0, 1)


def load_crop(p, pw, ph):
    src = Image.open(p['photo']).convert('RGB')
    sw, sh = src.size
    scale = max(pw / sw, ph / sh) * p.get('zoom', 1)
    cw, chh = pw / scale, ph / scale
    fx, fy = p.get('focus', [0.5, 0.5])
    left = min(max(fx * sw - cw / 2, 0), sw - cw)
    top = min(max(fy * sh - chh / 2, 0), sh - chh)
    crop = src.resize((pw, ph), Image.LANCZOS, box=(left, top, left + cw, top + chh))
    rgb = np.asarray(crop, np.float32) / 255
    # 曝光（夜景提亮暗部）→ 反差 → 整体提亮
    if p.get('exposure'):
        rgb = 1 - (1 - rgb) ** p['exposure']
    return np.clip((rgb - 0.5) * p.get('contrast', 1.12) + 0.5 + p.get('lift', 0.0), 0, 1)


def ink_sources(rgb):
    """专色版的覆盖率来源：dark = 暗部（单色网的主版），warm = 暖色灯光（红黄减蓝，且要够亮）。"""
    lum = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    warm = np.clip((rgb[..., 0] - rgb[..., 2]) * 1.6, 0, 1) * np.clip(lum * 1.8, 0, 1)
    return {'dark': 1 - lum, 'light': lum, 'warm': warm}


def place_photo(img, tex, p, ox, oy, W, H, rng):
    """把一张照片按 p 的方式网点化后叠印到 img（img 覆盖整页中 [ox, oy] 起的区域）。"""
    x, y, w, h = p['rect']
    px, py, pw, ph = round(x * MM), round(y * MM), round(w * MM), round(h * MM)
    rgb = load_crop(p, pw, ph)
    cell = DPI / p.get('lpi', LPI)
    # 雾化：覆盖率在 fade 的 y0（mm，整页坐标）处为 0，到 y1 处为 1，中间按 smoothstep 过渡，
    # 网点由大变小、最后只剩纸色——就是「雾」
    fade = np.ones((ph, 1), np.float32)
    if p.get('fade'):
        y0, y1 = p['fade']
        ys = (np.arange(ph, dtype=np.float32) + py) / MM
        t = np.clip((ys - y0) / (y1 - y0), 0, 1)
        fade = (t * t * (3 - 2 * t))[:, None]
    if p.get('mode', 'cmyk') == 'cmyk':
        seps = separate(rgb)
        plates = [(INKS[c], ANGLE[c], SHIFT[c], seps[c]) for c in ('y', 'm', 'c', 'k')]
    else:
        src = ink_sources(rgb)
        plates = []
        for ink in p['inks']:
            cov = np.clip(src[ink.get('src', 'dark')] * ink.get('gain', 1), 0, 1) ** ink.get('gamma', 1)
            cov = np.where(cov < ink.get('floor', 0.04), 0, cov)
            plates.append((np.array(ink['rgb'], np.float32) / 255, ink.get('angle', 45), tuple(ink.get('shift', (0, 0))), cov.astype(np.float32)))
    # 目标区域与输出画幅求交
    ax0, ay0 = max(px, ox), max(py, oy)
    ax1, ay1 = min(px + pw, ox + img.shape[1]), min(py + ph, oy + img.shape[0])
    if ax0 >= ax1 or ay0 >= ay1:
        return
    region = img[ay0 - oy:ay1 - oy, ax0 - ox:ax1 - ox]
    gx = tex[ay0 - oy:ay1 - oy, ax0 - ox:ax1 - ox]
    # 吸墨不匀：深色满版页（夜景）上斑驳太显会发脏，可用 absorb 调弱（1 = 默认强度）
    # density = 实地处的墨量（默认 0.9；深色满版页取 1，否则夜空发灰，与对页的矢量墨底接不上）
    k, base = p.get('absorb', 1), p.get('density', 0.9)
    absorb = np.clip(base + (gx - 1) * 2.5 * k, base - 0.15 * k, base + 0.15 * k)
    for ink_rgb, ang, (dx, dy), cov in plates:
        c = (cov * fade)[ay0 - py:ay1 - py, ax0 - px:ax1 - px]
        dots = screen_at(c, ang, cell, ax0, ay0)
        dots = shift(dots, dx, dy) * absorb
        region *= 1 - dots[..., None] * (1 - ink_rgb)


def main(spec_path, out_path):
    global DPI, MM
    spec = json.load(open(spec_path, encoding='utf8'))
    DPI = spec.get('dpi', 300); MM = DPI / 25.4
    W, H = round(PAGE_W * MM), round(PAGE_H * MM)
    # 输出画幅：默认整张出血页；给 out_rect（mm）就只出这一块（overlay 按同一 mm 位置放图）
    if spec.get('out_rect'):
        x, y, w, h = spec['out_rect']
        ox, oy, ow, oh = round(x * MM), round(y * MM), round(w * MM), round(h * MM)
    else:
        ox, oy, ow, oh = 0, 0, W, H
    rng = np.random.default_rng(spec.get('seed', 1))
    tex = paper_texture(oh, ow, rng) if spec.get('texture', True) else np.ones((oh, ow), np.float32)
    paper = np.array(spec['paper'], np.float32) / 255 if spec.get('paper') else PAPER
    img = np.broadcast_to(paper, (oh, ow, 3)).copy()

    # 实色平涂（雾蓝底等），在照片之前
    for f in spec.get('fills', []):
        x, y, w, h = f['rect']
        x0, y0 = max(round(x * MM) - ox, 0), max(round(y * MM) - oy, 0)
        x1, y1 = min(round((x + w) * MM) - ox, ow), min(round((y + h) * MM) - oy, oh)
        if x0 < x1 and y0 < y1:
            img[y0:y1, x0:x1] = np.array(f['rgb'], np.float32) / 255

    photos = spec.get('photos') or ([{'photo': spec['photo'], 'focus': spec.get('focus'), 'rect': spec['rect'],
                                      'zoom': spec.get('zoom', 1), 'contrast': spec.get('contrast', 1.12),
                                      'lift': spec.get('lift', 0.0)}] if spec.get('photo') else [])
    for p in photos:
        place_photo(img, tex, p, ox, oy, W, H, rng)

    # —— 网：斜向细线交叉成网格（1-3 水面上的「轻纱 / 渔网」），fade 段内由无到有 ——
    if spec.get('net'):
        nt = spec['net']
        x, y, w, h = nt['rect']
        mask = Image.new('L', (ow * 2, oh * 2), 0)
        d = ImageDraw.Draw(mask)
        S = MM * 2
        lw = max(1, round(nt.get('width', 0.12) * S))
        pitch = nt.get('pitch', 4) * S
        x0, y0, x1, y1 = (x * MM - ox) * 2, (y * MM - oy) * 2, ((x + w) * MM - ox) * 2, ((y + h) * MM - oy) * 2
        k = -(y1 - y0) - (x1 - x0)
        while k < (x1 - x0) + (y1 - y0):
            # 两组 ±45° 平行线
            d.line([(x0 + k, y0), (x0 + k + (y1 - y0), y1)], fill=255, width=lw)
            d.line([(x0 + k, y1), (x0 + k + (y1 - y0), y0)], fill=255, width=lw)
            k += pitch
        m = np.asarray(mask.resize((ow, oh), Image.LANCZOS), np.float32) / 255
        ys = (np.arange(oh, dtype=np.float32) + oy) / MM
        f0, f1 = nt.get('fade', [y, y])
        t = np.clip((ys - f0) / max(f1 - f0, 1e-3), 0, 1)
        m[(ys < y) | (ys > y + h), :] = 0
        m = (m * (t * t * (3 - 2 * t))[:, None] * nt.get('strength', 1))[..., None]
        img = img * (1 - m) + np.array(nt['rgb'], np.float32) / 255 * m

    # —— 实色圆（压在照片上，纸纹透上来）——
    if spec.get('circles'):
        mask = Image.new('L', (ow * 2, oh * 2), 0)        # 2× 超采样画圆，抗锯齿
        d = ImageDraw.Draw(mask)
        for cx, cy, r in spec['circles']:
            cx, cy = cx * MM - ox, cy * MM - oy
            d.ellipse([(cx - r * MM) * 2, (cy - r * MM) * 2, (cx + r * MM) * 2, (cy + r * MM) * 2], fill=255)
        m = np.asarray(mask.resize((ow, oh), Image.LANCZOS), np.float32)[..., None] / 255
        blue = np.array(spec['circle_rgb'], np.float32) / 255
        img = img * (1 - m) + blue * m

    img *= tex[..., None]
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        out_path, quality=spec.get('quality', 90), dpi=(DPI, DPI), subsampling=0)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
