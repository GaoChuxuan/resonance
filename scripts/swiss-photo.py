"""瑞士国际主义黑白银盐胶片图像处理脚本。

由 scripts/build.mjs 调用：python scripts/swiss-photo.py <spec.json> <out.jpg>
spec 参数：
  photo: 源图路径
  out_w_mm, out_h_mm: 输出尺寸（mm）
  fit: 'cover'（默认裁切填满）| 'contain_dark'（暗底延伸：按宽度/pad缩放放置，上下左右黑底无缝融合）
  anchor_y: fit='contain_dark' 时图片垂直锚点（0=顶，0.5=中，1.0=贴底，默认 0.85）
  pad_x: fit='contain_dark' 时左右留黑比例（默认 0.0）
  focus: [fx, fy] fit='cover' 裁切中心（0–1，默认 [0.5, 0.5]）
  zoom: 放大倍数（默认 1.0）
  dpi: 分辨率（默认 300）
  lum_weights: [wr, wg, wb] 三通道灰度权重（默认 [0.30, 0.56, 0.14]）
  contrast: 反差系数（默认 1.25）
  gamma: 伽马曲线（默认 1.0）
  shadow_crush: 暗部压黑阈值（0–0.4，默认 0.12，用于将暗背景压实为统一深炭黑）
  black_floor: 黑位下限（0–1，默认 0.098 ≈ #191919，避免死黑丢失银盐质感）
  white_ceil: 白位上限（0–1，默认 0.94）
  vignette: 四周边缘暗角强度（0–0.6，默认 0.18，保障边缘白字可读性）
  grain: 35mm 胶片颗粒强度（默认 0.032）
  seed: 随机种子（默认 42）
  quality: JPEG 质量（默认 92）

只输出纯净的灰度摄影位图，文字与画廊外框均在 HTML/CSS 矢量层渲染。
"""
import json
import sys
import numpy as np
from PIL import Image, ImageFilter


def main(spec_path, out_path):
    s = json.load(open(spec_path, encoding='utf8'))
    dpi = s.get('dpi', 300)
    mm = dpi / 25.4
    pw = max(1, round(s['out_w_mm'] * mm))
    ph = max(1, round(s['out_h_mm'] * mm))

    src = Image.open(s['photo']).convert('RGB')
    sw, sh = src.size
    fit = s.get('fit', 'cover')

    if fit == 'contain_dark':
        pad_x = s.get('pad_x', 0.0)
        target_w = max(1, round(pw * (1.0 - 2.0 * pad_x)))
        target_h = max(1, round(sh * (target_w / sw)))
        if target_h > ph:
            target_h = ph
            target_w = max(1, round(sw * (target_h / sh)))
        resized = src.resize((target_w, target_h), Image.LANCZOS)
        canvas = Image.new('RGB', (pw, ph), (0, 0, 0))
        ox = (pw - target_w) // 2
        oy = round((ph - target_h) * s.get('anchor_y', 0.85))
        oy = max(0, min(ph - target_h, oy))
        canvas.paste(resized, (ox, oy))
        crop = canvas
    else:
        zoom = s.get('zoom', 1.0)
        scale = max(pw / sw, ph / sh) * zoom
        cw, ch = pw / scale, ph / scale
        fx, fy = s.get('focus', [0.5, 0.5])
        left = min(max(fx * sw - cw / 2, 0), max(0, sw - cw))
        top = min(max(fy * sh - ch / 2, 0), max(0, sh - ch))
        crop = src.resize((pw, ph), Image.LANCZOS, box=(left, top, left + cw, top + ch))

    rgb = np.asarray(crop, np.float32) / 255.0
    wr, wg, wb = s.get('lum_weights', [0.30, 0.56, 0.14])
    lum = rgb[..., 0] * wr + rgb[..., 1] * wg + rgb[..., 2] * wb

    # 暗部平滑收紧，使暗背景完全融合为一致深黑
    crush = s.get('shadow_crush', 0.12)
    if crush > 0:
        lum = np.clip((lum - crush) / max(1.0 - crush, 1e-4), 0.0, 1.0)

    # 反差与 S 型银盐阶调
    contrast = s.get('contrast', 1.25)
    gamma = s.get('gamma', 1.0)
    lum = np.clip((lum - 0.5) * contrast + 0.5, 0.0, 1.0) ** gamma
    lum = lum * 0.35 + (lum * lum * (3.0 - 2.0 * lum)) * 0.65

    # 边缘暗角（保证四边 3x3 白色网格文字高可读性）
    vig = s.get('vignette', 0.18)
    if vig > 0:
        yy, xx = np.mgrid[0:ph, 0:pw].astype(np.float32)
        nx = (xx / pw - 0.5) * 2.0
        ny = (yy / ph - 0.5) * 2.0
        r2 = np.clip((nx * nx + ny * ny) / 1.4, 0.0, 1.4)
        lum *= np.clip(1.0 - vig * (r2 ** 1.3), 0.35, 1.0)

    # 映射至深炭黑黑位到纸白灰高光
    bf = s.get('black_floor', 0.098)
    wc = s.get('white_ceil', 0.94)
    lum = bf + lum * (wc - bf)

    # 35mm 细腻单色胶片颗粒
    grain_amt = s.get('grain', 0.032)
    if grain_amt > 0:
        rng = np.random.default_rng(s.get('seed', 42))
        noise = rng.normal(0.0, 1.0, (ph, pw)).astype(np.float32)
        n_img = Image.fromarray(((noise * 0.18 + 0.5).clip(0, 1) * 255).astype(np.uint8))
        n_blur = (np.asarray(n_img.filter(ImageFilter.GaussianBlur(0.42)), np.float32) / 255.0 - 0.5) / 0.18
        lum = np.clip(lum + n_blur * grain_amt, 0.0, 1.0)

    out_u8 = (lum * 255.0 + 0.5).clip(0, 255).astype(np.uint8)
    out_rgb = np.stack([out_u8, out_u8, out_u8], axis=-1)
    Image.fromarray(out_rgb).save(
        out_path, quality=s.get('quality', 92), dpi=(dpi, dpi), subsampling=0
    )


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
