"""正扉页底图：颗粒渐变光球 + 竖条半透明磨砂层（无折射、无描边白线）。

由 scripts/build.mjs 调用：python scripts/orb-art.py <spec.json> <out.jpg>
spec（单位 mm，原点 = 出血页左上角，整页 216 × 303 mm）：
  bg: 底色 RGB；stops: [[t, [r, g, b]], …] 光球的色标（t 0–1，沿 angle 方向）
  center: [cx, cy]；radius: [rx, ry]；edge: 柔边宽度（相对半径）；angle: 色带方向（度）
  strips: [[x0, x1], …] 竖条半透明磨砂层（每条左浅右渐沉，不改变底层渐变连续性、不画白线）
  grain: 颗粒强度；seed；dpi
色标之间在 OKLab 里插值（直接按 RGB 混，橙和紫中间会发浑发褐）。
输出不透明 RGB 位图；渐变和颗粒都在位图里，版面 CSS 仍只用实色。
"""
import json, sys, math
import numpy as np
from PIL import Image


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])


def to_oklab(rgb):
    lms = srgb_to_lin(np.asarray(rgb, np.float64)) @ M1.T
    return np.cbrt(lms) @ M2.T


def from_oklab(lab):
    lms = (lab @ np.linalg.inv(M2).T) ** 3
    return lin_to_srgb(lms @ np.linalg.inv(M1).T)


def main(spec_path, out_path):
    s = json.load(open(spec_path, encoding='utf8'))
    dpi = s.get('dpi', 300); MM = dpi / 25.4
    W, H = round(216 * MM), round(303 * MM)
    rng = np.random.default_rng(s.get('seed', 1))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    # 对未变形坐标 xx 直接渲染一次平滑渐变，保证无任何折射断口或彩边；
    # 再叠加竖条半透明磨砂层（左浅右渐沉），不画边界白线。
    cx, cy = (v * MM for v in s['center'])
    rx, ry = (v * MM for v in s['radius'])
    ang = math.radians(s.get('angle', 20))
    stops = s['stops']
    ts = np.array([p for p, _ in stops], np.float32)
    labs = to_oklab(np.array([c for _, c in stops], np.float64) / 255).astype(np.float32)
    bg = to_oklab(np.array(s['bg'], np.float64) / 255).astype(np.float32)

    def render(xs):
        d = np.sqrt(((xs - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        alpha = 1 / (1 + np.exp((d - 1) / s.get('edge', 0.09)))
        t = np.clip(((xs - cx) * math.cos(ang) + (yy - cy) * math.sin(ang)) / max(rx, ry) * 0.5 + 0.5, 0, 1)
        lab = np.stack([np.interp(t, ts, labs[:, i]) for i in range(3)], -1)
        lab = bg * (1 - alpha[..., None]) + lab * alpha[..., None]      # 柔边也在 OKLab 里过渡
        return from_oklab(lab.reshape(-1, 3)).reshape(H, W, 3).astype(np.float32)

    rgb = render(xx)
    strips = s.get('strips', [])
    frost = np.zeros((H, W), np.float32)
    dim = np.zeros((H, W), np.float32)
    for strip in strips:
        x0, x1 = strip[0], strip[1]
        a, b = x0 * MM, x1 * MM
        w = b - a
        m = (xx >= a) & (xx < b)
        u = np.clip((xx - a) / w, 0.0, 1.0)
        frost = np.where(m, 0.065 * (1.0 - u) ** 1.35, frost)
        dim = np.where(m, 0.035 * (u ** 1.5), dim)
    rgb = rgb * (1.0 - frost[..., None]) + frost[..., None]
    rgb = rgb * (1.0 - dim[..., None])

    g = s.get('grain', 0.04)
    rgb += rng.normal(0, g, (H, W, 1)).astype(np.float32)
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out_path, quality=s.get('quality', 90), dpi=(dpi, dpi), subsampling=0)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
