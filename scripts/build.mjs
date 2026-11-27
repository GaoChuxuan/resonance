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
// 正扉页字标：RE— / SON / —ANCE 逐字落在格子里（[字, 列, 行]），参照宽字距断词海报
const TITLE_GRID = [['R', 0, 0], ['E', 1, 0], ['–', 2, 0], ['S', 1, 1], ['O', 2, 1], ['N', 3, 1],
  ['–', 1, 2], ['A', 2, 2], ['N', 3, 2], ['C', 4, 2], ['E', 5, 2]];
// 正扉页底图：颗粒渐变光球 + 竖条半透明磨砂层（scripts/orb-art.py），色标取刊物色板（橙 → 音乐社橙 → 哲学社紫 → 信号蓝 → 深蓝）
const TITLE_ORB = { kind: 'orb', bg: [0xE6, 0xF1, 0xFF],
  stops: [[0, [0xED, 0x72, 0x07]], [0.22, [0xF0, 0x8A, 0x24]], [0.5, [0x7A, 0x5B, 0xD6]], [0.78, [0x45, 0x8C, 0xEE]], [1, [0x2F, 0x6F, 0xD6]]],
  center: [96, 156], radius: [114, 132], edge: 0.1, angle: 12,
  strips: [[132, 151], [151, 170], [170, 189]], grain: 0.04, seed: 3 };
const COPY = {
  manifesto: { en: 'EVERY VOICE<br>FINDS ITS ECHO', cn: '每一个声音，都值得一次回响。' },
  tagline: 'resonate w/ you!',
};

function frontMatter() {
  const CLUB_LIST = ['music', 'chem', 'philo', 'news', 'math'];
  const legend = [...CLUB_LIST, 'open'].map(c =>
    `<div><i style="background:${clubVar(c)}"></i><b>${CLUBS[c].en}</b><span>${CLUBS[c].cn}</span></div>`).join('');
  const clubsList = CLUB_LIST.map(c => `<li>${CLUBS[c].cn}</li>`).join('');   // 正扉页底边：纯白字，× 分隔
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
    <div class="wm" aria-label="RESONANCE">${TITLE_GRID.map(([ch, c, r]) => `<i class="${ch === 'O' ? 'o' : ''}" style="left:calc(${c} * var(--wm-step));top:calc(${r} * var(--wm-row))">${ch}</i>`).join('')}</div>
    <div class="cn">共鸣</div>
    <div class="tl">${COPY.tagline}</div>
    <div class="issue"><b>${ISSUE.en.split(' ')[1]}</b><i></i><span>${ISSUE.no.replace('VOL. ', 'VOL&#8194;')}</span><span>› ${ISSUE.en.split(' ')[0]}</span></div>
    <div class="vr">浙江省桐乡市高级中学　${CLUB_LIST.map(c => CLUBS[c].cn).join(' · ')}　联袂出品</div>
    <div class="vl">STUDENT JOURNAL　·　${COPY.manifesto.cn}</div>
    <ul class="clubs">${clubsList}</ul>
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
        <dt>篇目配图</dt><dd>${Object.keys(ART_PHOTO).map(id => `${id}　${esc(ART_PHOTO[id].credit)}`).join('<br>')}<br>均来自 Wikimedia Commons / Openverse</dd>
        <dt>章扉页照片</dt><dd>${Object.keys(CH_PHOTO).map(ch => `${pad(ch)}　${esc(CH_PHOTO[ch].credit)}`).join('<br>')}</dd>
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

// 章扉页（DESIGN-TOKENS §7.2）：真实风光照片做成「印刷品」——CMYK 四色网点 + 轻微套印错位 + 纸纹，
// 底图由 scripts/chapter-art.py 生成整张出血位图；文字、圆点里的字母都由 overlay 用矢量叠在上面。
// 版式参照两张参考图：上部纸面排章名、引语与篇目；下部照片块从订口侧偏进两栏、向切口出血；
// 照片上压 4 × 5 个实色蓝圆，章名英文按行逐字落在圆里。
// 引语取自本章稿件原文，一字不改，后缀出处
const CH_QUOTE = {
  1: { text: '恰巧，夜的幕墙上被打上了一抹白光——一列火车正缓缓驶来。', from: '在铁路口' },
  2: { text: '数学的严格与哲学的反思，正是自然语言自我超越的两种方式。', from: '自然语言：数学与哲学的纽带' },
};
// 照片：只用公有领域 / CC0（出处同时印在版权页）。focus 为裁切中心（0–1）
const CH_PHOTO = {
  1: { src: 'assets/chapters/ch1.jpg', focus: [0.62, 0.62], credit: '“Sea of clouds”，liu qiaojun 摄，CC0' },
  2: { src: 'assets/chapters/ch2.jpg', focus: [0.5, 0.55], credit: '“Chitina River Below the Nizina River and Chakina River Confluences (2)”，美国国家公园管理局阿拉斯加区摄，公有领域' },
};
// 几何（mm，原点 = 出血页左上角）。右页版心 x 23–198、y 23–277；左页版心 x 18–193，按页面中线镜像
const CH_GEO = { photoX: 53.1, photoY: 98, photoB: 277, pitch: 35.5, r: 12, cols: 4, rows: 5, blkR: 198 };
function chapterGeom(right) {
  const g = CH_GEO, h = g.photoB - g.photoY;
  const padx = (g.blkR - g.photoX - ((g.cols - 1) * g.pitch + 2 * g.r)) / 2;
  const pady = (h - ((g.rows - 1) * g.pitch + 2 * g.r)) / 2;
  const mx = x => right ? x : 216 - x;                       // 左页镜像
  const circles = [];
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++)
    circles.push([+mx(g.photoX + padx + g.r + g.pitch * i).toFixed(2), +(g.photoY + pady + g.r + g.pitch * j).toFixed(2), g.r]);
  // 左页按行仍从左往右读：镜像后每行顺序翻转回来
  if (!right) for (let j = 0; j < g.rows; j++) circles.splice(j * g.cols, g.cols, ...circles.slice(j * g.cols, (j + 1) * g.cols).reverse());
  const rect = right ? [g.photoX, g.photoY, 216 - g.photoX, h] : [0, g.photoY, 216 - g.photoX, h];
  return { rect, circles };
}
// 生成章扉页底图（overlay 之前调用；章首页的左右由实际页序决定）
function renderChapterArt(map) {
  fs.mkdirSync(B('chapters'), { recursive: true });
  for (const ch of new Set(rendered.map(a => a.ch))) {
    const right = map.dests[`ch-${ch}`] % 2 === 1;
    const { rect, circles } = chapterGeom(right);
    const spec = { photo: path.join(ROOT, CH_PHOTO[ch].src), focus: CH_PHOTO[ch].focus, zoom: CH_PHOTO[ch].zoom || 1, rect, circles, circle_rgb: [0x45, 0x8C, 0xEE], seed: 10 + ch };
    fs.writeFileSync(B(`chapters/ch-${ch}.json`), JSON.stringify(spec));
    execFileSync('python', ['-I', path.join(ROOT, 'scripts', 'chapter-art.py'), B(`chapters/ch-${ch}.json`), B(`chapters/ch-${ch}.jpg`)], { cwd: ROOT });
  }
}
// 正文层只留一张空页和锚点（目录链接、页码回填都靠 #ch-N）。
// 满版内容画在 overlay 层：正文层里任何超出版心的元素都会让 Chrome 把整份文档等比缩小，
// 往上溢出的底色还会画到前一页底部
function chapterOpener(ch) {
  return `
  <section class="page chapter-opener" id="ch-${ch}" data-ch="${ch}"></section>`;
}
// overlay 里的章扉页：底图 + 与正文版心同位的 .blk（右页订口在左 23 mm，左页 18 mm）+ 圆里的字母
function chapterSheet(ch, right) {
  const list = articles.filter(a => a.ch === ch).map(a => `<div><b>${pad(a.seq)}</b><span>${esc(a.title)}</span></div>`).join('');
  const q = CH_QUOTE[ch];
  const { circles } = chapterGeom(right);
  const letters = [...CHAPTERS[ch].en].map((L, i) => circles[i]
    ? `<i style="left:${circles[i][0]}mm;top:${circles[i][1]}mm">${esc(L)}</i>` : '').join('');
  return `<div class="cho" data-ch="${ch}"><img class="art" src="chapters/ch-${ch}.jpg" alt="">
    <div class="blk" style="left:${right ? 23 : 18}mm">
      <div class="k">CHAPTER ${pad(ch)}</div>
      <div class="cn">${CHAPTERS[ch].cn}</div>
      <div class="en">${CHAPTERS[ch].en[0]}${CHAPTERS[ch].en.slice(1).toLowerCase()}</div>
      ${q ? `<div class="quote">${esc(q.text)}<span>——《${esc(q.from)}》</span></div>` : ''}
      <div class="list">${list}</div>
    </div>
    <div class="letters">${letters}</div></div>`;
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
// 在这里逐张点名，覆盖 transform.js「只绕横幅」的默认判断：1 = 强制绕排，0 = 不绕排
//   2-5 图3（四种平均数的星形示意）：方图默认会绕排，缩到 44% 栏宽后图里的 H/G/A/Q 标注认不出，
//   紧跟的 M_p 公式又放不进图侧、被推到图下，左边空出一块 → 改为按原稿尺寸居中出图
const FIG_FLOAT = { '2-5/image2.png': 1, '2-5/image2.jpeg': 0 };

// 插图挪锚点：{ 篇号: [[图文件, 挪到哪一段之前（该段开头的原文片段）], …] }
// 浮动图挂在哪一段，就从哪一段的位置起排；挂点离页底太近时，整张图连同图注会被推到下一页顶，
// 而紧随其后的独立公式比图侧剩余行宽还宽、排不进图侧，只能落到图下，留下一个空洞。
//   2-5 洛必达肖像：原稿挂在「小明：0 啊……」，离页底只剩约 174 pt，放不下 208 pt 的图块，
//   跳页后第 43 页左上空出约 190 pt × 330 pt。改挂到公式之后「其中 f(x)、g(x) 均为函数」那段：
//   这段说明有十来行，正好贴着肖像排满，公式本身留在上一页底/本页顶通栏
//   2-5 图3：挪到 M_p 公式之后、结尾「初开天元……」之前，作为整篇的收束图
const FIG_MOVE = {
  '2-5': [
    ['image2.png', '<p>其中<span class="math inline">f(x)'],
    ['image2.jpeg', '<p><strong>初开天元'],
  ],
};

// ---------- 篇目跨页（DESIGN-TOKENS §7.6）----------
// 第一章前三篇与 1-6《几乎处处》各占一个跨页，各换一套「气候」：
// 满版的东西（底色、照片、斜线）画在 overlay 层并垫在正文**下面**（merge.py 的 under 页），
// 正文层只排文字，所以字可以压在照片上，正文度量（字号、行距、栏宽）一概不变。
const ART_PHOTO = {
  '1-1': { src: 'assets/articles/1-1.jpg', short: 'Killarnee · CC BY-SA 4.0 · 经裁切、网点化',
    credit: 'Killarnee 摄，“Karlsruhe at night – railroad crossing Brunnenstückweg, Karlsruhe-Rüppurr - 3”，CC BY-SA 4.0；经裁切与网点化处理，改编图同以 CC BY-SA 4.0 授权' },
  '1-2': { src: 'assets/articles/1-2.jpg', short: 'W.carter · CC BY-SA 4.0 · 经裁切、网点化',
    credit: 'W.carter 摄，“Sleet and rain through a bus window on road 162”，CC BY-SA 4.0；经裁切与网点化处理，改编图同以 CC BY-SA 4.0 授权' },
  '1-3': { src: 'assets/articles/1-3.jpg', short: 'Nico le terrible · CC0',
    credit: 'Nico le terrible 摄，“Wuzhen by night 5”，CC0' },
  '1-6': { src: 'assets/articles/1-6.jpg', short: 'STEVE WALKER · CC BY 2.0',
    credit: 'Steve Walker Photography 摄，“IMG_8531（Tulip Bouquet）”，CC BY 2.0（Openverse / Flickr）；经黑白银盐颗粒化处理；版式设计参考 X@AarzooAly（瑞士国际主义风格）' },
};
const ART = {
  '1-1': { cls: 'art-night', full: true },
  '1-2': { cls: 'art-fog' },
  '1-3': { cls: 'art-mist', full: true },
  '1-6': { cls: 'art-swiss', full: true },
};
// 油墨色（RGB），与 tokens.css 同值：c.ink / c.blue / c.orange / c.news / c.tint
const RGB = { ink: [0x1D, 0x1D, 0x1B], blue: [0x45, 0x8C, 0xEE], orange: [0xED, 0x72, 0x07], news: [0xF2, 0xB7, 0x05], tint: [0xE6, 0xF1, 0xFF] };
// 1-1 的车灯光线：跨页坐标（mm，左页出血左上角为原点；右页 x 在此基础上 +210，即两页成品边在订口相接）
// 起点是左页照片里车头灯的位置，向右上斜穿订口，从右页切口上角出去
const NIGHT_BEAM = [[114, 151], [426, 3]];

// 开篇（正文层）。kicker = 「CH 01 — 01 / 10」，tags = 社团 / 体裁
function artOpener(a, kicker, tags, who) {
  const ph = ART_PHOTO[a.id];
  if (a.id === '1-1') return `
    <header class="opener aop">
      <div class="k"><span>${kicker}</span><span class="tags">${tags}</span></div>
      <h1 class="title">${esc(a.title)}</h1>
      <div class="who">${who}</div>
      <div class="credit">图　${esc(ph.short)}</div>
    </header>`;
  if (a.id === '1-2') return `
    <header class="opener aop">
      <div class="k"><span>${kicker}</span><span class="tags">${tags}</span></div>
      <h1 class="title">${esc(a.title)}</h1>
      <div class="who">${who}</div>
      <div class="credit">图　${esc(ph.short)}</div>
    </header>`;
  if (a.id === '1-3') return `
    <header class="opener aop">
      <h1 class="title"><span>半片水，</span><span>半城雾</span></h1>
      <div class="k">${kicker}　${tags}</div>
      <div class="credit">图　${esc(ph.short)}</div>
    </header>`;
  if (a.id === '1-6') return `
    <header class="opener aop">
      <div class="sw-top"><span>${kicker} // ${FORM_EN[a.form] || ''}</span><span>RESONANCE · VOL. 02</span></div>
      <div class="sw-poster">
        <div class="sw-band top">
          <div class="sw-cell">ALMOST EVERYWHERE<br>MEASURE ZERO<br>LEBESGUE<br>POETRY 06<br>OPEN CALL<span class="gap"></span>// 06</div>
          <div class="sw-cell c">RESONANCE 02</div>
          <div class="sw-cell r">CH 01 LITERATURE<br>XUAN DU<br>10:00 — 06:00<br>SWISS GRID<br>MONOCHROME<span class="gap"></span>26</div>
        </div>
        <div class="sw-band mid">
          <div class="sw-cell">EXISTENCE<br>WITHOUT THICKNESS<br>REALITY<br>WITHOUT WEIGHT<br>CONTINUUM<span class="gap"></span>// AE</div>
          <div class="sw-cell c"><span class="cn-title">几乎处处</span><span class="en-sub">ALMOST EVERYWHERE · 泫渡</span></div>
          <div class="sw-cell r">HEIDEGGER<br>NIETZSCHE<br>RATIONALS IN R<br>DENSE SET<br>ARCHIVE<span class="gap"></span>06</div>
        </div>
        <div class="sw-band bot">
          <div class="sw-cell">TONGXIANG HIGH<br>STUDENT JOURNAL<br>WINTER 2026<br>OPEN CALL<br>MONOCHROME<span class="gap"></span>// 01</div>
          <div class="sw-cell c">POETRY 06</div>
          <div class="sw-cell r">DESIGN REF<br>X@AarzooAly<br>TULIP STUDY<br>CC BY 2.0<br>SWISS GRID<span class="gap"></span>26</div>
        </div>
      </div>
      <div class="sw-bot">
        <span class="ref"><b>DESIGN REF:</b> X@AarzooAly · SWISS INTERNATIONAL STYLE</span>
        <span><b>PHOTO:</b> ${esc(ph.short)}</span>
      </div>
    </header>`;
  return '';
}

// 文字层面的改动（不改字，只加结构）
function artFrag(a, frag) {
  if (a.id === '1-1') {
    // 跨页右页上部：引语（原文句子）；车灯光线从它的右上方斜过去
    frag = `<div class="pull"><p>记忆的胶片从来没有损坏，<br>只不过是我们的读取器早已迭代了。</p></div>\n` + frag;
  }
  if (a.id === '1-2') {
    // 反转处：雾蓝底色在这里收住（位置在排版后量出，见 fogEnd），通栏断开前后两半
    const t = '<p>白色的天花板。';
    if (!frag.includes(t)) console.warn('ART miss 1-2 fog');
    frag = frag.replace(t, `<div class="fogline"></div>\n${t}`);
    frag = frag.replace('<p>“明天见。”</p>', '<p class="bigline">“明天见。”</p>');
    // 护士交班记录排成一张记录单；末句是护士补的一笔
    frag = frag.replace(/<p>“今日观察：([\s\S]*?)”<\/p>/, (m, s) =>
      `<div class="record"><div class="rh"><b>交班记录</b><span>五路康复环线　第二天</span></div><p>“今日观察：${s}”</p></div>`);
    frag = frag.replace('<p>“他们看上去，都很高兴。”</p>', '<p class="addendum">“他们看上去，都很高兴。”</p>');
  }
  if (a.id === '1-6') {
    // 标头单独放在 .text 之前（通过 coda/preText 结构，避免被 transform.js 的 stripHead 误当成原稿标题删掉）
    return frag;
  }
  return frag;
}

// 1-3 末段改竖排，作为整篇的收尾（从正文里取出，排在双栏之后）
function artCoda(a, frag) {
  if (a.id !== '1-3') return { frag, coda: '' };
  const m = frag.match(/<p>(故乡，水的故乡[\s\S]*?)<\/p>\s*$/);
  if (!m) { console.warn('ART miss 1-3 coda'); return { frag, coda: '' }; }
  return { frag: frag.slice(0, m.index), coda: `<div class="coda"><p>${m[1]}</p></div>` };
}

// overlay 层：每篇跨页各页的底图与矢量装饰；返回 { 页码: { html, dark, noRh } }，并写出要渲染的底图 spec
function artSheets(map, pos) {
  const out = {};
  const specs = [];
  const pagesOf = id => {
    const p0 = map.dests[`a-${id}`];
    const nexts = Object.values(map.dests).filter(p => p > p0);
    const p1 = (nexts.length ? Math.min(...nexts) : map.pages + 1) - 1;
    return Array.from({ length: p1 - p0 + 1 }, (_, i) => p0 + i);
  };
  const img = (name, spec) => { specs.push([name, spec]); return name; };
  const imgTag = (name, r) => `<img class="artimg" src="art/${name}.jpg" style="left:${r[0]}mm;top:${r[1]}mm;width:${r[2]}mm;height:${r[3]}mm" alt="">`;
  const full = [0, 0, 216, 303];
  for (const id of Object.keys(ART)) {
    if (!map.dests[`a-${id}`]) continue;
    const pages = pagesOf(id);
    const photo = path.join(ROOT, ART_PHOTO[id].src);
    if (id === '1-1') {
      const [p0, ...rest] = pages;
      const n = img('1-1-photo', { seed: 21, photos: [{ photo, focus: [0.6, 0.5], rect: full, mode: 'inks', exposure: 1.5, contrast: 1.2, lpi: 38, absorb: 0.3, density: 1,
        inks: [{ rgb: RGB.news, src: 'warm', gain: 1.6, angle: 15, shift: [2, -1] }, { rgb: RGB.ink, src: 'dark', gain: 1.08, gamma: 0.75, angle: 45 }] }] });
      const beam = off => `<svg class="beam" viewBox="${off} 0 216 303"><line x1="${NIGHT_BEAM[0][0]}" y1="${NIGHT_BEAM[0][1]}" x2="${NIGHT_BEAM[1][0]}" y2="${NIGHT_BEAM[1][1]}"/></svg>`;
      out[p0] = { html: imgTag(n, full) + beam(0), dark: true };
      rest.forEach((p, i) => { out[p] = { html: `<div class="night"></div>` + (i === 0 ? beam(210) : ''), dark: true, noRh: i === 0 }; });
    }
    if (id === '1-2') {
      const r = [0, 0, 216, 166];        // 到开篇区底（版心第 405 pt）
      const n = img('1-2-photo', { seed: 22, paper: RGB.tint, texture: false, out_rect: r, photos: [{ photo, focus: [0.5, 0.42], rect: r, mode: 'inks', contrast: 1.35, lift: 0.02, lpi: 42,
        inks: [{ rgb: RGB.blue, src: 'dark', gain: 1.0, gamma: 1.15, angle: 45 }] }] });
      // 雾蓝底色：从开篇一直铺到反转那一行之前（pos.fog = [页, 该行字顶距页面上缘 pt]），之后回到白纸
      const [fp, fy] = pos.fog || [pages[pages.length - 1] + 1, 0];
      for (const p of pages) {
        let fog = '';
        if (p < fp) fog = `<div class="fog" style="height:303mm"></div>`;
        else if (p === fp) fog = `<div class="fog" style="height:calc(${fy}pt - 11pt)"></div>`;
        out[p] = { html: fog + (p === pages[0] ? imgTag(n, r) : '') };
      }
    }
    if (id === '1-3') {
      const [p0, ...rest] = pages;
      const n = img('1-3-photo', { seed: 23, photos: [{ photo, focus: [0.5, 0.6], rect: full, mode: 'inks', exposure: 1.15, contrast: 1.15, lpi: 40, fade: [45, 165], absorb: 0.6,
        inks: [{ rgb: RGB.orange, src: 'warm', gain: 1.2, gamma: 1.7, angle: 15, shift: [2, -2] }, { rgb: RGB.ink, src: 'dark', gain: 1.0, gamma: 0.8, angle: 45 }] }],
        net: { rect: [0, 205, 216, 98], pitch: 4.2, rgb: [238, 233, 222], fade: [210, 290], width: 0.09, strength: 0.6 } });
      out[p0] = { html: imgTag(n, full), dark: true };
      // 正文页：同一张暖白纸（只有纸纹，150 dpi 足够）
      rest.forEach((p, i) => { out[p] = { html: imgTag(img(`1-3-paper-${i + 1}`, { seed: 30 + i, dpi: 150, quality: 82 }), full) }; });
    }
    if (id === '1-6') {
      const [p0, ...rest] = pages;
      const n = img('1-6-photo', {
        kind: 'swiss-photo', photo,
        out_w_mm: 154, out_h_mm: 212,
        fit: 'contain_dark', anchor_y: 0.94, pad_x: 0.0,
        dpi: 300, lum_weights: [0.58, 0.34, 0.08],
        shadow_crush: 0.05, contrast: 1.52, gamma: 0.76,
        black_floor: 0.10, white_ceil: 0.95, vignette: 0.16, grain: 0.032, seed: 16,
      });
      out[p0] = { html: `<div class="swiss-bg"></div>` + imgTag(n, [31, 39, 154, 212]), swiss: true };
      rest.forEach(p => {
        out[p] = { html: `<div class="swiss-bg"></div>`, noRh: true, swiss: true };
      });
    }
  }
  return { out, specs };
}
function renderArt(specs) {
  fs.mkdirSync(B('art'), { recursive: true });
  for (const [name, spec] of specs) {
    fs.writeFileSync(B(`art/${name}.json`), JSON.stringify(spec));
    const script = spec.kind === 'swiss-photo' ? 'swiss-photo.py' : (spec.kind === 'orb' ? 'orb-art.py' : 'chapter-art.py');
    execFileSync('python', ['-I', path.join(ROOT, 'scripts', script), B(`art/${name}.json`), B(`art/${name}.jpg`)], { cwd: ROOT });
  }
}

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
  for (const [key, on] of Object.entries(FIG_FLOAT)) {
    const [id, file] = key.split('/');
    if (id !== a.id) continue;
    const re = new RegExp(`<img(?=[^>]*media/${file.replace('.', '\\.')})([^>]*)>`);
    if (!re.test(frag)) console.warn('FIG_FLOAT miss', key);
    frag = frag.replace(re, (m, attrs) => `<img${attrs} data-float="${on}">`);
  }
  for (const [file, before] of (FIG_MOVE[a.id] || [])) {
    const re = new RegExp(`<img[^>]*media/${file.replace('.', '\\.')}[^>]*>`);
    const tag = (frag.match(re) || [])[0];
    if (!tag || frag.split(before).length !== 2) { console.warn('FIG_MOVE miss', a.id, file); continue; }
    // 原位置只删图，段落文字留着；图单独成段插到目标段之前（transform.js 会把单图段换成 figure）
    frag = frag.replace(tag, '').replace(before, `<p>${tag}</p>\n${before}`);
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
  const art = ART[a.id];
  let coda = '';
  if (art) { frag = artFrag(a, frag); ({ frag, coda } = artCoda(a, frag)); }
  const bar = a.clubs.map(c => `<i style="background:${clubVar(c)}"></i>`).join('');
  const tags = [...a.clubs.map(c => `<b style="color:${clubVar(c === 'news' ? 'open' : c)}">${CLUBS[c].en}</b>`), `<b>${FORM_EN[a.form] || ''}</b>`].join('');
  const total = articles.filter(x => x.ch === a.ch).length;
  const longT = [...a.title].length > 12;
  const who = a.author ? `${esc(a.author)}${a.author_note ? `<span>${esc(a.author_note)}</span>` : ''}` : '';
  const preText = a.id === '1-6'
    ? `<div class="swiss-rh-head"><span><b class="red">06 //</b> 几乎处处</span><span class="sub">ALMOST EVERYWHERE · 泫渡</span></div>`
    : '';
  return `
  <section class="article ${a.serif ? 'serif' : 'sans'} ${a.verse ? 'verse' : ''}${single ? ' single' : ''}${art ? ` art ${art.cls}${art.full ? ' full' : ''}` : ''}" id="a-${a.id}" data-id="${a.id}" data-form="${a.form}"
     data-strip='${esc(JSON.stringify(a.strip_lines))}' style="--club:${clubVar(a.clubs[0])}">
    ${art ? artOpener(a, `CH ${pad(a.ch)} — ${pad(a.seq)} / ${pad(total)}`, tags, who) : `<header class="opener">
      <div class="clubbar">${bar}</div>
      <div class="meta-top">CH ${pad(a.ch)} — ${pad(a.seq)} / ${pad(total)}</div>
      <div class="mega">${pad(a.seq)}</div>
      <div class="head">
        <h1 class="title ${longT ? 'long' : ''}">${esc(a.title)}</h1>
        ${a.subtitle ? `<p class="subtitle">——${esc(a.subtitle)}</p>` : ''}
      </div>
      <div class="rule"></div>
      <div class="byline"><div class="who">${who}</div><div class="tags">${tags}</div></div>
    </header>`}
    ${preText}<div class="text"></div>${coda}
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
<link rel="stylesheet" href="../src/art.css">
<script src="../node_modules/katex/dist/katex.min.js"></script>
</head><body>${body}
<script src="../src/transform.js"></script></body></html>`;
}

// ---------- overlay (page furniture, full-bleed canvas) ----------
const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
function overlayHtml(map, frontPages, arts = {}) {
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
    const art = arts[p];
    let inner = art ? art.html : '';
    // folio
    let folio = '';
    if (p <= FRONT) folio = p >= 4 ? ROMAN[p] : '';
    else folio = String(p - FRONT);
    const chStart = p > FRONT && o && o.kind === 'chapter' && isStart;
    if (chStart) {
      inner += chapterSheet(o.ch, right);
      // 章扉页页脚带：通栏细线，切口侧页码、订口侧「# 章名」（纸面上，墨色）
      inner += `<div class="strip ${right ? 'r' : 'l'}"><span class="tagc"># ${CHAPTERS[o.ch].cn}　${CHAPTERS[o.ch].en}</span><span>${folio}</span></div>`;
    } else if (folio) inner += `<div class="folio ${right ? 'r' : 'l'}${art && art.dark ? ' inv' : ''}${art && art.swiss ? ' swiss' : ''}"><i></i>${folio}</div>`;
    // running head
    if (p > FRONT && o && !isStart && o.kind === 'article' && !(art && art.noRh)) {
      // 书眉：CHAPTER 02 ESSAY 05　标题
      const txt = right ? `CHAPTER ${pad(o.a.ch)} ${FORM_EN[o.a.form] || ''} ${pad(o.a.seq)}　${esc(o.a.title)}` : `RESONANCE　共鸣　${ISSUE.cn}`;
      inner += `<div class="rh ${right ? 'r' : 'l'}${art && art.dark ? ' inv' : ''}">${txt}</div>`;
    }
    // thumb tab (right pages of articles)
    if (p > FRONT && o && o.kind === 'article' && right) {
      const idx = CLUB_ORDER.indexOf(o.a.clubs[0]);
      inner += `<div class="tab" style="top:calc(23mm + ${idx} * 34pt);background:${art && art.swiss ? '#111111' : clubVar(o.a.clubs[0])}"></div>`;
    }
    // page ii 的社团色条改由 .fm-bars .legend 在正文层绘制，overlay 不再重复
    pages += `<div class="sheet">${inner}</div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="../src/tokens.css"><link rel="stylesheet" href="../src/fonts.css">
<link rel="stylesheet" href="../src/chapter.css">
<link rel="stylesheet" href="../src/art.css">
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
.strip{position:absolute;top:calc(303mm - 3mm - 14mm - 6pt - 5pt - var(--rule-thin));display:flex;justify-content:space-between;width:var(--block-w);padding-top:5pt;border-top:var(--rule-thin) solid var(--c-k45);font:var(--t-folio);letter-spacing:.04em;font-variant-numeric:tabular-nums;color:var(--c-ink)}
.strip .tagc{font:var(--t-runhead);letter-spacing:.08em;color:var(--c-k70)}
.strip.r{right:18mm}.strip.l{left:18mm;flex-direction:row-reverse}
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

renderChapterArt(map);
// 篇目跨页：先量出只有排版后才知道的位置（1-2 雾蓝底收在哪一行），再出底图
const pos = JSON.parse(py('scripts/findtext.py', B('body.pdf'), JSON.stringify({ fog: '白色的天花板' })));
console.log('art pos', JSON.stringify(pos));
const { out: arts, specs: artSpecs } = artSheets(map, pos);
// 正扉页（第 iii 页）：光球底图垫在正文下面
artSpecs.push(['title-orb', TITLE_ORB]);
arts[map.dests['fm-3'] || 3] = { html: '<img class="artimg" src="art/title-orb.jpg" style="left:0;top:0;width:216mm;height:303mm" alt="">' };
renderArt(artSpecs);
// 有底图的页：overlay 垫在正文下面
fs.writeFileSync(B('under.json'), JSON.stringify(Object.keys(arts).map(Number)));
fs.writeFileSync(B('overlay.html'), overlayHtml(map, map.dests['ch-1'] - 1, arts));
const op = await browser.newPage();
await op.goto('file:///' + B('overlay.html').replace(/\\/g, '/'));
await op.evaluate(() => document.fonts.ready);
await op.pdf({ preferCSSPageSize: true, printBackground: true, path: B('overlay.pdf') });
await browser.close();

console.log(py('scripts/merge.py', B('body.pdf'), B('overlay.pdf'), path.join(ROOT, 'dist'), B('under.json')));
