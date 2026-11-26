// Resonance build: manifest + pandoc fragments -> book.html -> Chrome PDF (2 passes) -> overlay -> merged PDFs
// usage: node scripts/build.mjs [--only 1-1,2-2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { FIGURES } from './figures.mjs';
import { applyRareGlyphs } from './rare-glyphs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = p => path.join(ROOT, 'build', p);
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

const ISSUE = { cn: '2026 冬', en: 'WINTER 2026', no: 'VOL. 02' };   // TODO 期号待确认
// 前置页数（罗马页码）不再写死：由第一章章首页的实际页序推出，见下方 const front = map.dests['ch-1'] - 1
const CHAPTERS = {
  1: { cn: '文学', en: 'LITERATURE' },
  2: { cn: '交叉', en: 'INTERSECTIONS' },
};
const CLUBS = {
  music: { cn: '音乐社', en: 'MUSIC', v: '--c-music' },
  chem: { cn: '化学社', en: 'CHEMISTRY', v: '--c-chem' },
  philo: { cn: '哲学社', en: 'PHILOSOPHY', v: '--c-philo' },
  news: { cn: '新闻社', en: 'JOURNALISM', v: '--c-news' },
  math: { cn: '数学社', en: 'MATH', v: '--c-math' },
  open: { cn: '校外征稿', en: 'OPEN CALL', v: '--c-orange' },
};
const CLUB_ORDER = ['music', 'chem', 'philo', 'news', 'math', 'open'];
const FORM_EN = { prose: 'PROSE', fiction: 'FICTION', poem: 'POETRY', lyrics: 'LYRICS', essay: 'ESSAY' };
const OVERRIDE = {            // DESIGN-TOKENS §3.3 / §6.3 assumptions (pending confirmation)
  '1-4': { font: 'serif' },
  '2-4': { clubs: ['math'] },
  '2-5': { clubs: ['math'] },
};

// ---------- metadata ----------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'manifest.json'), 'utf8'));
const docx = fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.docx'));
function clubsFromTag(tag) {
  const t = tag.replace('征稿', '').trim();
  const out = [];
  if (/歌词/.test(t)) out.push('music');
  for (const ch of t.replace('歌词', '')) {
    if (ch === '数') out.push('math'); else if (ch === '化') out.push('chem');
    else if (ch === '音') out.push('music'); else if (ch === '哲') out.push('philo'); else if (ch === '新' || ch === '闻') { if (!out.includes('news')) out.push('news'); }
  }
  return out.length ? out : ['open'];
}
const articles = manifest.map(m => {
  const f = docx.find(d => d.startsWith(m.id + '_'));
  const tag = (f.match(/_（(.+?)）/) || [, '征稿'])[1];
  const [ch, seq] = m.id.split('-').map(Number);
  const ov = OVERRIDE[m.id] || {};
  const clubs = ov.clubs || clubsFromTag(tag);
  const serif = ov.font ? ov.font === 'serif' : m.form !== 'essay';
  return { ...m, ch, seq, tag, clubs, serif, verse: m.form === 'poem' || m.form === 'lyrics' };
}).sort((a, b) => a.ch - b.ch || a.seq - b.seq);
const rendered = onlyArg ? articles.filter(a => onlyArg.includes(a.id)) : articles;
const pad = n => String(n).padStart(2, '0');
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clubVar = c => `var(${CLUBS[c].v})`;

// ---------- HTML parts ----------
const COPY = {
  manifesto: { en: 'EVERY VOICE<br>FINDS ITS ECHO', cn: '每一个声音，都值得一次回响。' },
  tagline: 'resonate w/ you!',
};

function frontMatter() {
  const CLUB_LIST = ['music', 'chem', 'philo', 'news', 'math'];
  const legend = [...CLUB_LIST, 'open'].map(c =>
    `<div><i style="background:${clubVar(c)}"></i><b>${CLUBS[c].en}</b><span>${CLUBS[c].cn}</span></div>`).join('');
  const clubsList = CLUB_LIST.map(c =>
    `<li><i style="background:${clubVar(c)}"></i>${CLUBS[c].cn}</li>`).join('');
  const tocCh = ch => {
    const items = articles.filter(a => a.ch === ch).map(a => `
      <a class="toc-item" href="#a-${a.id}">
        <span class="n">${pad(a.seq)}</span>
        <span class="t">${esc(a.title)}${a.author ? `<small>${esc(a.author)}${a.author_note && a.author_note !== '化名' ? ' · ' + esc(a.author_note) : ''}</small>` : ''}</span>
        <span class="c">${a.clubs.map(c => `<i style="background:${clubVar(c)}"></i>`).join('')}</span>
        <span class="pn" data-target="a-${a.id}">—</span>
      </a>`).join('');
    return `<div class="toc-chapter"><a class="ch" href="#ch-${ch}" style="color:inherit;text-decoration:none"><span class="n">${pad(ch)}</span><span class="nm">${CHAPTERS[ch].cn}<span>${CHAPTERS[ch].en}</span></span></a>${items}</div>`;
  };
  return `
  <div class="page fm fm-half" id="fm-1">
    <div class="mark">
      <div class="w">RESONANCE<sup>.</sup><i class="spark"></i></div>
      <div class="cn">共鸣</div>
    </div>
  </div>
  <div class="page fm fm-bars" id="fm-2">
    <div class="quote">
      <div class="en">${COPY.manifesto.en}<i class="spark blue"></i></div>
      <div class="cn">${COPY.manifesto.cn}</div>
    </div>
    <div class="legend">${legend}</div>
  </div>
  <div class="page fm fm-title" id="fm-3">
    <div class="kicker">STUDENT JOURNAL <span>/</span> ${ISSUE.en} <span>/</span> ${ISSUE.no}</div>
    <div class="t-en">RESONANCE<sup>.</sup><i class="spark"></i></div>
    <div class="t-cn">共鸣</div>
    <div class="tagline">${COPY.tagline}</div>
    <div class="credit">
      <div class="school">浙江省桐乡市高级中学</div>
      <ul class="clubs">${clubsList}</ul>
      <div class="joint">联袂出品</div>
    </div>
  </div>
  <div class="page fm fm-colophon" id="fm-4">
    <div class="block">
      <h4>COLOPHON / 版权信息</h4>
      <dl>
        <dt>刊名</dt><dd>共鸣（RESONANCE）</dd>
        <dt>期号</dt><dd>${ISSUE.cn} <span class="tbd">〔待确认〕</span></dd>
        <dt>出品</dt><dd>浙江省桐乡市高级中学<br>音乐社 × 化学社 × 哲学社 × 新闻社 × 数学社</dd>
        <dt>主编</dt><dd>许恺颉</dd>
        <dt>指导老师</dt><dd>陆佳瑜</dd>
        <dt>编者</dt><dd>陈安浙　钱成昊　钱东成　夏宁　章茹涵</dd>
        <dt>美术</dt><dd>宋静弘</dd>
        <dt>排版</dt><dd>赵奕辉</dd>
        <dt>印务</dt><dd>章茹涵</dd>
        <dt>开本</dt><dd>A4（210 × 297 mm）</dd>
      </dl>
    </div>
  </div>
  <div class="page fm fm-toc" id="fm-5">
    <div class="toc-head"><h2>CONTENTS</h2><div class="cn">目录</div><i class="spark"></i></div>
    <div class="toc-rule"></div>
    ${tocCh(1)}
    ${tocCh(2)}
  </div>`;
}

function chapterOpener(ch) {
  const list = articles.filter(a => a.ch === ch).map(a => `<div><b>${pad(a.seq)}</b><span>${esc(a.title)}</span></div>`).join('');
  return `
  <section class="page chapter-opener" id="ch-${ch}" data-ch="${ch}">
    <div class="num">${pad(ch)}<i class="spark"></i></div>
    <div class="names">
      <div class="cn">${CHAPTERS[ch].cn}</div>
      <div class="en">${CHAPTERS[ch].en}</div>
      <div class="rule"></div>
      <div class="list">${list}</div>
    </div>
  </section>`;
}

// 2-3 表里的五个生僻字、正文的三处括号注音，都在 scripts/rare-glyphs.mjs 里处理
// （字形表、拼音、举例括注与排法同处一个模块，见该文件的 applyRareGlyphs）

// 另行替换的插图：{ 篇号: { 原文件名: { src, alt(图注) } } }
// 原图是带「百度百科」水印的截图，换成 Google Art Project 的斯米尔伯特原作
const SWAP_IMG = {
  '2-4': {
    'image1.png': { src: '../assets/berkeley.jpg', alt: '乔治·贝克莱主教（绘于1720年代末）' },
  },
};

// 个别插图按需重设原稿宽度（英寸）：2-2 的折线图略缩，使末页的两行收尾并回上一页，
// 同时把 640×480 的源图提到 116dpi 左右，印刷更实
// 值为 [宽, 高] 英寸，必须成对比缩放：只改 width 会把图纵向拉长（原稿的 height 写在行内样式里）
const FIG_W = {
  '2-2': { 'image1.png': [5.5, 3.924] },
  // 2-3：三张右绕排图收窄让正文回宽；四联图限高 76pt 使整篇回到三页
  '2-3': {
    'image1.jpeg': [1.85, 1.407],
    'image2.png': [2.15, 1.397],
    'image3.png': [2.05, 0.55],
    'image2.jpeg': [1.3868, 1.0556],
    'image4.jpeg': [1.077, 1.0556],
    'image5.jpeg': [1.0556, 1.0556],
  },
};

// pandoc 转换丢段的地方在这里补回来：docx 里那段正文前面挂着一个「图注文本框」，
// 转换器只把文本框里的字（谢尔宾斯基三角形）单独提成一段，整段正文被吞掉了。
const TEXT_FIX = {
  // 插图重绘后配色改为全刊的蓝／橙，正文里的颜色描述随之同步
  '2-1': [
    [
      '红线表示自然对数函数，紫线是它的导数',
      '蓝线表示自然对数函数，橙线是它的导数',
    ],
    // 正文里的单变量原本是普通正文字体，与相邻的 KaTeX 公式不同源；
    // 统一改为行内公式，斜体、字距跟后面的 p＝m/(M+m) 一致
    [
      '称为厚度（p），新记忆数（m），已有记忆数（M）则有',
      '称为厚度（<span class="math inline">p</span>），新记忆数（<span class="math inline">m</span>），'
      + '已有记忆数（<span class="math inline">M</span>）则有',
    ],
  ],
  '2-3': [[
    '<p>谢尔宾斯基三角形</p>',
    '<p>分形（fractal），意为“破碎的图形”。如果一个图形在放大后得到的部分与图形整体相似（即自相似性），'
    + '那么这个图形即为狭义上的分形。[[fig:image1.jpeg]]为谢尔宾斯基三角形，蓝色边框圈出的部分与整体相似，'
    + '因此谢尔宾斯基三角形为分形。分形不仅有一种独特的美感，还有一些神奇的性质。'
    + '维度便是我们将探讨的，分形具有的神奇特性之一。</p>',
  ]],
};

// 正文里对插图的指代（「上图」「右图」「这幅图」）一律改成带编号的「图 X」。
// 编号不写死：[[fig:文件名]] 交给 transform.js 按该篇实际的出图顺序解析
// （类似 LaTeX 的 \ref），增删、调序插图后引用自动跟着变，且排成蓝色强调。
const FIG_REF = {
  '2-1': [['在这幅图中，', '在[[fig:image1.jpeg]]中，']],
  '2-2': [['（上图最左、最右侧的直线）', '（[[fig:image1.png]]最左、最右侧的直线）']],
  '2-3': [['如上图可得：', '由[[fig:image3.png]]可得：']],
  '2-5': [
    ['（见右图）', '（见[[fig:image1.jpeg]]）'],
    // 肖像在版面上居中、正文另起，说「右边」既不对也不是坐标；改指图号
    ['认识右边这个人吗？', '认识[[fig:image2.png]]里的这个人吗？'],
  ],
};

// 竖幅肖像默认不绕排（绕排会把行宽挤窄，Chrome 把浮动图推到页顶时还会留空洞），
// 但单栏篇目里 60 mm 宽的肖像绕排后仍有 100 mm 行宽，值得省下近 80 mm 版面。
// 需要绕排的图在这里点名，transform.js 看到 data-float 就跳过「只绕横幅」的默认判断。
const FIG_FLOAT = ['2-5/image2.png'];

// 2-8 原稿那张手写笔记（三角恒等变换）不再画成 SVG 文字：SVG 里没有分式、根号，
// 只能写成「(tan α + tan β) / (1 − tan α tan β)」「(√3/2)」这种伪记号，字号一缩就成糊点。
// 改为直接排 HTML，公式交给 KaTeX（与正文同源），序号 ①–④ 做成带引线的小标题，推导按等号对齐。
const TRIG_CARD = String.raw`<figure class="trigcard">
<div class="tc-head"><b>三角恒等变换</b><i>TRIG IDENTITIES</i><em>这不是英语吗？！</em></div>
<h4 class="tc-h"><span>①</span>和差公式</h4>
<p class="eq"><span class="math display">\begin{aligned}
\cos(\alpha-\beta)&amp;=\cos\alpha\cos\beta+\sin\alpha\sin\beta\\
\cos(\alpha+\beta)&amp;=\cos[\alpha-(-\beta)]\\
&amp;=\cos\alpha\cos(-\beta)+\sin\alpha\sin(-\beta)\\
&amp;=\cos\alpha\cos\beta-\sin\alpha\sin\beta\\
\sin(\alpha+\beta)&amp;=\sin\alpha\cos\beta+\cos\alpha\sin\beta\\
\sin(\alpha-\beta)&amp;=\sin\alpha\cos\beta-\cos\alpha\sin\beta
\end{aligned}</span></p>
<p class="tc-note">※ 余弦：正正，符号相反　　正弦：正余，符号相同</p>
<h4 class="tc-h"><span>②</span>用诱导公式推 sin(α+β)</h4>
<p class="eq"><span class="math display">\begin{aligned}
\cos\left(\tfrac{\pi}{2}-(\alpha+\beta)\right)&amp;=\cos\left[\left(\tfrac{\pi}{2}-\alpha\right)-\beta\right]\\
&amp;=\cos\left(\tfrac{\pi}{2}-\alpha\right)\cos\beta+\sin\left(\tfrac{\pi}{2}-\alpha\right)\sin\beta\\
&amp;=\sin\alpha\cos\beta+\cos\alpha\sin\beta
\end{aligned}</span></p>
<h4 class="tc-h"><span>③</span>和差化积</h4>
<p class="eq"><span class="math display">\begin{aligned}
\tan(\alpha+\beta)&amp;=\dfrac{\tan\alpha+\tan\beta}{1-\tan\alpha\tan\beta}\\[4pt]
\tan(\alpha-\beta)&amp;=\dfrac{\tan\alpha-\tan\beta}{1+\tan\alpha\tan\beta}
\end{aligned}</span></p>
<p class="tc-note">※ 由 <span class="math inline">\tan={\sin}/{\cos}</span>，上下同除 <span class="math inline">\cos\alpha\cos\beta</span> 即得</p>
<h4 class="tc-h"><span>④</span>相位特例</h4>
<p class="eq"><span class="math display">\begin{aligned}
\sin\left(x+\tfrac{\pi}{3}\right)&amp;=\sin x\cos\tfrac{\pi}{3}+\cos x\sin\tfrac{\pi}{3}\\
&amp;=\tfrac{1}{2}\sin x+\tfrac{\sqrt{3}}{2}\cos x\\
\sin\left(x+\tfrac{\pi}{2}\right)&amp;=\sin x\cos\tfrac{\pi}{2}+\cos x\sin\tfrac{\pi}{2}\\
&amp;=0+\cos x=\cos x
\end{aligned}</span></p>
</figure>`;

function article(a) {
  let frag = fs.readFileSync(B(`html/${a.id}.html`), 'utf8')
    .replace(/src="build\//g, 'src="');
  for (const [file, rep] of Object.entries(SWAP_IMG[a.id] || {})) {
    const re = new RegExp(`<img[^>]*media/${file.replace('.', '\\.')}[^>]*>`);
    frag = frag.replace(re, `<img src="${rep.src}" alt="${esc(rep.alt)}" style="width:2.05in" />`);
  }
  for (const [file, spec] of Object.entries(FIG_W[a.id] || {})) {
    const [w, h] = Array.isArray(spec) ? spec : [spec, null];
    const re = new RegExp(`(<img[^>]*media/${file.replace('.', '\\.')}[^>]*style=")width:[\\d.]+in(;height:[\\d.]+in)?`);
    frag = frag.replace(re, (m, p1, p2, p3) => `${p1}width:${w}in` + (h ? `;height:${h}in` : (p2 || '')));
  }
  for (const key of FIG_FLOAT) {
    const [id, file] = key.split('/');
    if (id !== a.id) continue;
    const re = new RegExp(`<img(?=[^>]*media/${file.replace('.', '\\.')})([^>]*)>`);
    if (!re.test(frag)) console.warn('FIG_FLOAT miss', key);
    frag = frag.replace(re, (m, attrs) => `<img${attrs} data-float="1">`);
  }
  for (const [find, rep] of (TEXT_FIX[a.id] || [])) {
    if (!frag.includes(find)) console.warn('TEXT_FIX miss', a.id, find.slice(0, 20));
    frag = frag.split(find).join(rep);
  }
  // 注意：这里必须是数组（[[找, 换], …]），不能套 Object.entries ——
  // 那会把下标 "0" 当成待替换的字符串，全书每个 0 都会被替换掉
  for (const [find, rep] of (FIG_REF[a.id] || [])) {
    if (!frag.includes(find)) console.warn('FIG_REF miss', a.id, find.slice(0, 20));
    frag = frag.split(find).join(rep);
  }
  // 2-8 的手写笔记原图挂在段首（图后紧接着正文），换公式卡时要把整段拆开：
  // 卡片自成一格，原来的那段正文退回普通段落
  if (a.id === '2-8') {
    frag = frag.replace(/<p>\s*<img[^>]*media\/2-8\/media\/image1\.png[^>]*>([\s\S]*?)<\/p>/,
      (m, rest) => `${TRIG_CARD}<p class="noindent">${rest}</p>`);
  }
  // 重绘插图：位图换成内联 SVG，交给 transform.js 走与 <img> 相同的图片布置逻辑
  // （figure 包裹、图注、单栏绕排），尺寸沿用原 <img> 的行内 style —— 见 scripts/figures.mjs
  for (const [key, fn] of Object.entries(FIGURES)) {
    const [id, file] = key.split('/');
    if (id !== a.id) continue;
    const f = fn();
    const inFile = `media/${id}/media/${file}`;
    frag = frag.replace(/<img[^>]*>/g, tag => {
      if (!tag.includes(inFile)) return tag;
      const st = (tag.match(/style="([^"]*)"/) || [, ''])[1];
      const alt = (tag.match(/alt="([^"]*)"/) || [, ''])[1];
      // 宽度沿用原稿（FIG_W 已改过的），高度必须按 SVG 自身比例重算：
      // 原稿 <img> 的 height 是位图的比例，直接照搬会把矢量图纵向拉扁
      const wIn = +((st.match(/width:\s*([\d.]+)in/) || [, 0])[1]) || f.vw / 72;
      const size = `width:${+wIn.toFixed(4)}in;height:${+(wIn * f.vh / f.vw).toFixed(4)}in`;
      // 绕排图默认按 44% 栏宽出图。重绘的矢量图本身画得很小（正方形四等分 155 pt、
      // 线段 148 pt），44% 会把它们再压到 105 pt，图内 6.8 pt 的 a / ½a 只剩 4.6 pt。
      // 这里按篇指定绕排宽度上限：2-1 的宽函数图 56%，2-3 的两张几何图放到 70%
      // （仍在两图自然尺寸之上，不再缩放）
      const FW = { '2-1/image1.jpeg': 56, '2-3/image2.png': 70, '2-3/image3.png': 70, '2-8/image1.png': 70 };
      const nof = FW[key] ? ` data-fw="${FW[key]}"` : '';
      return `<svg class="dfig" width="${f.vw}pt" height="${f.vh}pt" viewBox="0 0 ${f.vw} ${f.vh}"`
        + ` preserveAspectRatio="xMidYMid meet" style="${size}" data-cap="${alt}" data-ref="${file}"${nof}>${f.body}</svg>`;
    });
  }
  // 公式密集的篇目改为单栏：独立公式不再通栏切断双栏正文；
  // 2-1 的插图比一栏还宽、塞进双栏会留出大块空白，也按单栏排
  const single = !a.verse && ((frag.match(/class="math display"/g) || []).length >= 8 || a.id === '2-1');
  if (a.id === '2-3') frag = applyRareGlyphs(frag);
  const bar = a.clubs.map(c => `<i style="background:${clubVar(c)}"></i>`).join('');
  const tags = [...a.clubs.map(c => `<b style="color:${clubVar(c === 'news' ? 'open' : c)}">${CLUBS[c].en}</b>`), `<b>${FORM_EN[a.form] || ''}</b>`].join('');
  const total = articles.filter(x => x.ch === a.ch).length;
  const longT = [...a.title].length > 12;
  const who = a.author ? `${esc(a.author)}${a.author_note ? `<span>${esc(a.author_note)}</span>` : ''}` : '';
  return `
  <section class="article ${a.serif ? 'serif' : 'sans'} ${a.verse ? 'verse' : ''}${single ? ' single' : ''}" id="a-${a.id}" data-id="${a.id}" data-form="${a.form}"
     data-strip='${esc(JSON.stringify(a.strip_lines))}' style="--club:${clubVar(a.clubs[0])}">
    <header class="opener">
      <div class="clubbar">${bar}</div>
      <div class="meta-top">CH ${pad(a.ch)} — ${pad(a.seq)} / ${pad(total)}</div>
      <div class="mega">${pad(a.seq)}</div>
      <div class="head">
        <h1 class="title ${longT ? 'long' : ''}">${esc(a.title)}</h1>
        ${a.subtitle ? `<p class="subtitle">——${esc(a.subtitle)}</p>` : ''}
      </div>
      <div class="rule"></div>
      <div class="byline"><div class="who">${who}</div><div class="tags">${tags}</div></div>
    </header>
    <div class="text"></div>
    <template class="raw">${frag}</template>
  </section>`;
}

function bookHtml() {
  const chs = [...new Set(rendered.map(a => a.ch))];
  let body = frontMatter();
  for (const ch of chs) {
    body += chapterOpener(ch);
    for (const a of rendered.filter(x => x.ch === ch)) body += article(a);
  }
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8">
<link rel="stylesheet" href="../node_modules/katex/dist/katex.min.css">
<link rel="stylesheet" href="../src/tokens.css">
<link rel="stylesheet" href="../src/fonts.css">
<link rel="stylesheet" href="../src/book.css">
<script src="../node_modules/katex/dist/katex.min.js"></script>
</head><body>${body}
<script src="../src/transform.js"></script></body></html>`;
}

// ---------- overlay (page furniture, full-bleed canvas) ----------
const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
function overlayHtml(map, frontPages) {
  const FRONT = frontPages;
  const starts = [];
  for (const ch of new Set(rendered.map(a => a.ch))) starts.push({ p: map.dests[`ch-${ch}`], kind: 'chapter', ch });
  for (const a of rendered) starts.push({ p: map.dests[`a-${a.id}`], kind: 'article', a });
  starts.sort((x, y) => x.p - y.p);
  const owner = p => { let o = null; for (const s of starts) if (s.p <= p) o = s; return o; };
  let pages = '';
  for (let p = 1; p <= map.pages; p++) {
    const right = p % 2 === 1;
    const o = owner(p);
    const isStart = o && o.p === p;
    let inner = '';
    // folio
    let folio = '';
    if (p <= FRONT) folio = p >= 4 ? ROMAN[p] : '';
    else folio = String(p - FRONT);
    if (folio) inner += `<div class="folio ${right ? 'r' : 'l'}"><i></i>${folio}</div>`;
    // running head
    if (p > FRONT && o && !isStart && o.kind === 'article') {
      // 书眉：CHAPTER 02 ESSAY 05　标题
      const txt = right ? `CHAPTER ${pad(o.a.ch)} ${FORM_EN[o.a.form] || ''} ${pad(o.a.seq)}　${esc(o.a.title)}` : `RESONANCE　共鸣　${ISSUE.cn}`;
      inner += `<div class="rh ${right ? 'r' : 'l'}">${txt}</div>`;
    }
    // thumb tab (right pages of articles)
    if (p > FRONT && o && o.kind === 'article' && right) {
      const idx = CLUB_ORDER.indexOf(o.a.clubs[0]);
      inner += `<div class="tab" style="top:calc(23mm + ${idx} * 34pt);background:${clubVar(o.a.clubs[0])}"></div>`;
    }
    if (p > FRONT && o && o.kind === 'chapter' && isStart) {
      inner += `<div class="tab" style="top:23mm;height:60pt;background:var(--c-blue)"></div>`;
    }
    // page ii 的社团色条改由 .fm-bars .legend 在正文层绘制，overlay 不再重复
    pages += `<div class="sheet">${inner}</div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="../src/tokens.css"><link rel="stylesheet" href="../src/fonts.css">
<style>
@page { size: 216mm 303mm; margin: 0; }
html,body{margin:0;background:none;-webkit-print-color-adjust:exact}
.sheet{width:216mm;height:303mm;position:relative;break-after:page;overflow:hidden}
.folio{position:absolute;top:calc(303mm - 3mm - 14mm - 6pt);font:var(--t-folio);letter-spacing:.04em;font-variant-numeric:tabular-nums;color:var(--c-ink)}
.folio i{display:block;width:var(--grid-col);height:var(--rule-thin);background:var(--c-k45);margin-bottom:5pt}
.folio.r{right:18mm;text-align:right}.folio.r i{margin-left:auto}
.folio.l{left:18mm}
.rh{position:absolute;top:calc(3mm + 12mm - 6pt);font:var(--t-runhead);letter-spacing:.08em;color:var(--c-k70);white-space:nowrap}
.rh.r{right:18mm}.rh.l{left:18mm}
.tab{position:absolute;right:0;width:calc(3mm + 4pt);height:30pt}
.bar{position:absolute;bottom:0;width:26.667pt;height:calc(240pt + 3mm)}
</style></head><body>${pages}</body></html>`;
}

// ---------- run ----------
const py = (...a) => execFileSync('python', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(B('book.html'), bookHtml());
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
console.log('chrome', browser.version());
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
await page.goto('file:///' + B('book.html').replace(/\\/g, '/'));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const report = await page.evaluate(() => window.__report);
console.log('transform', JSON.stringify(report));

const pdfOpts = { preferCSSPageSize: true, printBackground: true, outline: true, tagged: true };
await page.pdf({ ...pdfOpts, path: B('body.pass1.pdf') });
let map = JSON.parse(py('scripts/pagemap.py', B('body.pass1.pdf')));
// 前置页数由实际排版推出（第一章章首页之前的所有页），目录若自然续到第二页也不会算错页码
const front = map.dests['ch-1'] - 1;
await page.evaluate(({ m, front }) => {
  document.querySelectorAll('.pn[data-target]').forEach(s => {
    const p = m.dests[s.dataset.target]; s.textContent = p ? String(p - front).padStart(2, '0') : '—';
  });
}, { m: map, front });
await page.pdf({ ...pdfOpts, path: B('body.pdf') });
map = JSON.parse(py('scripts/pagemap.py', B('body.pdf')));
fs.writeFileSync(B('pagemap.json'), JSON.stringify(map, null, 1));
console.log('pages', map.pages, 'front', front, JSON.stringify(map.dests));

fs.writeFileSync(B('overlay.html'), overlayHtml(map, map.dests['ch-1'] - 1));
const op = await browser.newPage();
await op.goto('file:///' + B('overlay.html').replace(/\\/g, '/'));
await op.evaluate(() => document.fonts.ready);
await op.pdf({ preferCSSPageSize: true, printBackground: true, path: B('overlay.pdf') });
await browser.close();

console.log(py('scripts/merge.py', B('body.pdf'), B('overlay.pdf'), path.join(ROOT, 'dist')));
