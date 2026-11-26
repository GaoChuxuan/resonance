// 带水印的 demo 版：在已排好的印刷版 PDF 上逐页压一层斜向水印
// （灰色 SAMPLE ＋「未经授权 切勿转载」），输出 dist/resonance-demo.pdf
//
// usage:
//   node scripts/build-demo.mjs            压水印并打开
//   node scripts/build-demo.mjs --rebuild  先重新排版全书，再压水印
//   node scripts/build-demo.mjs --no-open  只生成，不打开
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = p => path.join(ROOT, 'build', p);
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const flag = s => args.includes(s);

const SRC = path.join(ROOT, 'dist', 'resonance-print-rgb.pdf');
const OUT = path.join(ROOT, 'dist', 'resonance-demo.pdf');
const WM_HTML = B('demo/watermark.html');
const WM_PDF = B('demo/watermark.pdf');

const MARK = {
  main: 'SAMPLE',
  cn: '未经授权 切勿转载',
  ink: 'rgba(122,122,122,.17)',   // SAMPLE：浅灰
  ink2: 'rgba(96,96,96,.32)',     // 中文说明：略深，缩到 11pt 仍读得出来
  angle: -30,
};

// 单个水印单元的尺寸（mm）：横向 78、纵向 62，斜向排开后疏密合适
const TILE = { w: 78, h: 62, size: 7.4 };

// ---------- 0. 没有正文就先排一版 ----------
if (flag('--rebuild') || !fs.existsSync(SRC)) {
  console.log('排版正文…');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
}

// ---------- 1. 水印页（与正文同尺寸：216 × 303 mm） ----------
// 注意：不能用 SVG <pattern> 平铺。Chrome 打印 tiling pattern 时会把整页水印
// 栅格化成一张 72dpi 的位图贴进 PDF，放大后必然发虚。这里改为绝对定位的
// 真实文本节点，交给 Blink 正常输出矢量字形（PDF 里是嵌入式 Type3/TrueType 字）。
function watermarkHtml() {
  const cellW = TILE.w, cellH = TILE.h;
  const cols = 8, rows = 8;            // 铺满旋转后约 460mm 见方的范围
  const W = cols * cellW, H = rows * cellH;
  let cells = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 隔行错位半格：斜向看过去是交错的菱格，不会出现竖直对齐的「车道」
      const dx = (r % 2) * cellW / 2;
      cells += `<div class="c" style="left:${(c * cellW + dx).toFixed(2)}mm;top:${(r * cellH).toFixed(2)}mm;width:${cellW}mm">`
        + `<b>${MARK.main}</b><span>${MARK.cn}</span></div>`;
    }
  }
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8">
<link rel="stylesheet" href="../../src/fonts.css">
<style>
  @page { size: 216mm 303mm; margin: 0; }
  html, body { margin: 0; background: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { width: 216mm; height: 303mm; overflow: hidden; position: relative; }
  .wm {
    position: absolute; left: 50%; top: 50%;
    width: ${W}mm; height: ${H}mm;
    transform: translate(-50%, -50%) rotate(${MARK.angle}deg);
    transform-origin: 50% 50%;
  }
  .c { position: absolute; text-align: center; line-height: 1; }
  .c b {
    display: block; color: ${MARK.ink};
    font: 700 ${TILE.size}mm/1 "GS Display", "SHS", sans-serif;
    letter-spacing: .16em; text-indent: .16em;
  }
  .c span {
    display: block; margin-top: 3.2mm; color: ${MARK.ink2};
    font: 700 2.9mm/1 "SHS", sans-serif;
    letter-spacing: .26em; text-indent: .26em;
  }
</style></head><body><div class="wm">${cells}</div></body></html>`;
}

fs.mkdirSync(path.dirname(WM_HTML), { recursive: true });
fs.writeFileSync(WM_HTML, watermarkHtml());
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto('file:///' + WM_HTML.replace(/\\/g, '/'));
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: WM_PDF, preferCSSPageSize: true, printBackground: true });
await browser.close();
console.log('水印页', path.relative(ROOT, WM_PDF));

// ---------- 2. 逐页叠加 ----------
const pyTry = ['python', 'py'];
const PY_ALT = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
];
function py(code, argv = []) {
  const cands = [...pyTry, ...PY_ALT.filter(p => p && fs.existsSync(p))];
  for (const c of cands) {
    try {
      return execFileSync(c, ['-c', code, ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    } catch (e) {
      if (e.code === 'ENOENT') continue;   // 换下一个解释器
      throw e;
    }
  }
  throw new Error('找不到 python（需要 pypdf）：请把 Python 加入 PATH，或改 scripts/build-demo.ps1 里的路径');
}

const STAMP = `
import sys
from pypdf import PdfReader, PdfWriter
src, wm, out = sys.argv[1:4]
w = PdfWriter(clone_from=src)
mark = PdfReader(wm).pages[0]
for pg in w.pages:
    pg.merge_page(mark)
w.add_metadata({'/Title': '共鸣（RESONANCE）— DEMO（带水印）',
                '/Subject': 'DEMO ONLY — 未经授权 切勿转载'})
with open(out, 'wb') as f:
    w.write(f)
print(len(w.pages))
`;
const pages = py(STAMP, [SRC, WM_PDF, OUT]).trim();
console.log(`写好 ${path.relative(ROOT, OUT)}（${pages} 页，${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB）`);

if (!flag('--no-open')) {
  try { execFileSync('cmd', ['/c', 'start', '', OUT], { cwd: ROOT }); } catch { /* 打不开就算了 */ }
}
