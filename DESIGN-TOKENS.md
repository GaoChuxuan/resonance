# 《共鸣 RESONANCE》Design Tokens · v1.0（按现有排校）

> 浙江省桐乡市高级中学 音乐社 × 化学社 × 哲学社 × 新闻社 × 数学社 联袂出品 · 开放校外征稿
> 范围：扉页 + 正文（封面 / 封底不在本仓库构建）
> 渲染链：DOCX → Pandoc → HTML → Playwright + Headless Chrome → PDF（RGB）→ Ghostscript + ICC → DeviceCMYK

**本文件记录的是一切已经在 `dist/` 里印出来的版式事实。** v0.1 里那套"红信号色 / GS Cond / 纯灰中性色"的方案已经作废，现行为"蓝色信号色 / 蓝灰中性 / 两族字体"。

维护规则：`src/tokens.css` 由第 9 节逐字生成；`src/book.css` 的取值必须能在本文件里找到出处。发现文档与成品不符时，**以 `book.css` 的实际渲染为准，回头改本文件**，不要在 CSS 里留没有出处的数值。

---

## 0. 设计原则

1. **网格先行**：所有元素落在 12 栏模块网格与 15 pt 基线网格上；栏宽 240 pt 是按"宋体 9.6 pt 每行 25 字"反推的。
2. **字体即图形**：靠超大编号（260 pt / 150 pt）与字重对比制造张力，不靠装饰图。
3. **一个信号色**：全书只有一个强调色 —— 蓝 `#458CEE`，用于大编号、章名、标题、公式引导词、篇首标签；`#2F6FD6`（蓝深）只做次级文字。
4. **星芒是唯一装饰符**：四角星（`--sparkle`）出现在扉页、章扉页、h2 前、目录刊头，橙 `#ED7207` 或蓝两版。章扉页另有一张网点化的风光照片和一组实色蓝圆（见 §7.2），都在位图里，不算版面装饰符。
5. **中性色带蓝灰相**：k70/k45/k15 都不是纯灰，而是向蓝偏的灰，保证与信号色同一色温。
6. **文学与非文学分族**：文学用思源宋体，非文学用思源黑体 + Google Sans；标题、编号、图注、表格一律 Google Sans。
7. **克制里有节奏**：篇首做足（大编号 + 标题 + 标签行），正文安静（无底色、无双线、无栏线）。

---

## 1. 页面与出血

| Token | 值 | 说明 |
|---|---|---|
| `page.trim` | 210 × 297 mm | A4 成品 |
| `page.bleed` | 3 mm | 四边 |
| `page.media` | 216 × 303 mm | 印刷版 MediaBox |
| `binding` | 胶装，左翻 | 奇数页 = 右页 (recto) |

| 产物 | MediaBox | TrimBox | BleedBox |
|---|---|---|---|
| `resonance-screen.pdf` | 210 × 297 | = Media | = Media |
| `resonance-print-rgb.pdf` | 216 × 303 | 内缩 3 mm | = Media |
| `resonance-print-cmyk.pdf` | 216 × 303 | 内缩 3 mm | = Media |

Chrome 直接按 216 × 303 出页；TrimBox / BleedBox 由 `scripts/merge.py`（pypdf）与 `scripts/build-cmyk.mjs` 写入。

---

## 2. 版心与网格

### 2.1 边距（左右页镜像，单位 mm / pt）

| Token | mm | pt | 备注 |
|---|---|---|---|
| `margin.top` | 20 | 56.69 | `@page` 里写 23 mm（= 20 + 出血 3） |
| `margin.bottom` | 23 | 65.20 | `@page` 里写 26 mm（= 23 + 出血 3） |
| `margin.inner`（订口） | 20 | 56.69 | `@page :right/:left` 用 `calc(var + bleed)` |
| `margin.outer`（切口） | 15 | 42.52 | 同上 |
| 版心 | 175 × 254 | **496 × 720** | 216 − 23 − 18 = 175 mm；303 − 23 − 26 = 254 mm |

> `@page` 里的 `calc(var(--…))` 会被 Chrome 丢弃，导致上下边距失效，所以上下边距写字面值；左右边距可以安全使用 `calc()`。

### 2.2 栏网格

| Token | 值 |
|---|---|
| `grid.columns` | 12 |
| `grid.col` | 26.667 pt |
| `grid.gutter` | 16 pt |
| `text.columns` | 2（正文 = 6 + 6 模块） |
| `text.col-width` | **240 pt**（84.67 mm） |
| `text.col-gap` | 16 pt |
| `text.col-rule` | 无（靠留白分栏） |

单栏篇目（公式密集的 2-5、2-8，或图比一栏宽的 2-1）：`column-count: 1`，栏宽仍 240 pt 会太窄，实际用版心全宽。
诗/歌词：单栏，左起第 4 栏，宽 = 3 栏 + 2 沟。

### 2.3 基线网格

| Token | 值 |
|---|---|
| `baseline` | **15 pt**（5.2917 mm） |
| `baseline.half` | 7.5 pt |
| 每栏行数 | 48（48 × 15 = 720 pt） |

行距、段前段后、图片下的余量、标题区高度都取 7.5 pt 的整数倍。

### 2.4 篇首分区（实际渲染）

```
┌─ 12 cols ───────────────────────────────┐
│ CH 01 — 01 / 10                [社团][文体] │ ← 第 1 行（1 基线高）
│                                          │
│  01                    ┌ 标题 ────────┐  │ ← 第 2–17 行
│  (1–5 栏, 底部对齐)     │ ——副标题      │  │
│                        └──────────────┘  │   标题区 6–12 栏
│  作者 单位                                │ ← 第 18 行 + 2.5 基线
└──────────────────────────────────────────┘
```

- 篇首固定 **18 基线 = 270 pt**（`--opener-h`），正文从第 19 行起排。
- 大编号：`--t-mega`（150 pt/135 pt），占 1–5 栏，底边与标题基线对齐（`margin-left:-6pt; margin-bottom:-8pt`）。
- 标题：`--t-title`（30 pt）；标题超过 12 字自动换 `--t-title-long`（24 pt）。
- 署名行：左「作者 + 单位（500 字重、蓝深）」，右社团标签 + 文体标签（7 pt、0.1 em）。
- **注**：markup 里保留了 `.clubbar`（社团色条）与 `.rule`（分割线）两个占位节点，但 `book.css` 里没有对应样式，成品上**没有**色条和分割线 —— 见 §11 待确认第 7 条。

---

## 3. 字体

### 3.1 字族

| CSS 族名 | 文件 | 用途 |
|---|---|---|
| `GS Text` 500/700 | `fonts/GSF-Text-*.ttf` | 西文/数字正文、页眉页脚、图注、表格 |
| `GS Display` 700 | `fonts/GSF-Display-Bold.ttf` | 大编号、字标、章名英文、篇名西文 |
| `GS W` 400/500/700/900 | `fonts/GSF-W-*.ttf` | 章扉页的拉丁字（章名英文、CHAPTER、篇目序号、圆里的字母）；篇目跨页的照片署名 |
| `SHS` 400/500/700 | `fonts/SourceHanSansSC-*.otf` | 非文学正文、中文标题 |
| `SHSerif` 400 | `fonts/NotoSerifCJKsc-*.otf` | 文学正文；篇目跨页（§7.8）的标题与引语另用 500 / 600 / 900 |
| `KaTeX_*` | `node_modules/katex/dist/fonts` | 公式 |

v0.1 计划过的第三族 `GS Cond`（窄体）在正文里**没有进入实现**：大编号与章名用 `GS Display` 的 700 字重。`GS W` 是 Google Sans Flex **只动字重轴**的静态实例：wght 取 400/500/700/900，wdth / opsz / ROND / slnt 全部钉在字体默认值（100 / 18 / 0 / 0），实例里不残留 `fvar` / `gvar`。章扉页禁用除字重以外的可变轴，所以不用 `GS Text`（opsz 12）、`GS Display`（opsz 72）或 `GS Cond`（wdth 25）。`fonts/` 共 223 MB，不入 git（`.gitignore`），由 `scripts/fonts.py` 生成。

### 3.2 字族栈

```
--ff-ui:      "GS Text", "SHS", sans-serif;
--ff-display: "GS Display", "SHS", sans-serif;
--ff-sans:    "GS Text", "SHS", sans-serif;
--ff-serif:   "SHSerif", serif;
```

Google Sans 排在思源前面，西文与数字自动取 Google Sans，汉字回落到思源。

### 3.3 文体 → 字体

由 `content/manifest.json` 的 `form` 驱动：`prose` / `fiction` / `poem` / `lyrics` → `--ff-serif`；`essay` → `--ff-sans`。
例外：1-4《在世界中心呼唤名为爱的野兽》是文学评论，在 `build.mjs` 的 `OVERRIDE` 里强制 serif。

---

## 4. 字号阶梯（单位 pt，行高均为 7.5 的倍数）

### 显示级

| Token | 字号 / 行高 | 字重 | 字距 | 用途 |
|---|---|---|---|---|
| `t.chapter` | 260 / 225 | 700 GS Display | −0.05 em | 章扉页章号 |
| `t.mega` | 150 / 135 | 700 GS Display | −0.05 em | 篇首大编号 |
| `t.wordmark` | 80 / 75 | 700 GS Display | −0.035 em | 正扉页字标 |
| `t.quote` | 44 / 52.5 | 700 GS Display | −0.02 em | 第 ii 页宣言英文 |
| `t.chapter-cn` | 44 / 52.5 | 700 思源黑 | 0.06 em | 章名中文 |
| `t.halfmark` | 40 / 37.5 | 700 GS Display | −0.02 em | 第 i 页字标 |
| `t.title` | 30 / 37.5 | 700 GS Display | −0.01 em + `palt` | 篇名 |
| `t.title-long` | 24 / 30 | 700 GS Display | `palt` | 篇名 > 12 字 |
| `t.h3num` | 18 / 22.5 | 700 GS Display | −0.02 em | 正文内数字小节（2-6 的 1./2./3.） |
| `t.chapter-en` | 18 / 22.5 | 700 GS Display | −0.01 em | 章名英文 |
| `t.tagline` | 12 / 15 | 700 GS Display | −0.01 em | 「resonate w/ you!」 |

### 文本级

| Token | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `t.h2` | 12 / 22.5 | 700 思源黑 | 小节标题（前有 9 pt 星芒） |
| `t.subtitle` | 11 / 22.5 | 500 思源黑 | 副标题（前缀「——」） |
| `t.h3` | 10.5 / 16.5 | 700 思源黑 | 次级小标题（前有 11 × 2.4 pt 蓝条） |
| `t.poem` | 10.5 / 22.5 | 400 宋 | 诗行 |
| `t.body-serif` | **9.6 / 15** | 400 宋 | 文学正文（每行 25 字） |
| `t.body-sans` | **9.25 / 15** | 400 黑 + GS | 非文学正文 |
| `t.list` | 9 / 15 | 700 思源黑 | 章扉页本章篇目 |
| `t.table` | 8 / 11.25 | 400 | 表格 |
| `t.byline` | 8 / 15 | 500 | 作者、单位、目录作者行 |
| `t.caption` | 7.5 / 11.25 | 400 | 图注、表注 |
| `t.note` | 7.5 / 11.25 | 400 | 篇末注释 |
| `t.folio` | 8 / 7.5 | 700 | 页码（等宽数字） |
| `t.tag` | 7 / 7.5 | 700，0.1 em 大写 | 社团 / 文体标签、栏外标题以外的标签 |
| `t.runhead` | 7 / 7.5 | 500，0.08 em | 栏外标题 |

### 组件级（不单设 token）

| 用途 | 值 |
|---|---|
| 条目小标题（`1. 韦伯——费希纳对数定律`） | 9.8 / 13，700 思源黑，墨色；编号蓝色（`--c-blue-deep`）占 1.28 em 定宽列，后接 0.32 em；上方 8 pt、下方 1 pt，标题折行与首字对齐；行数 ≥2 时仍与紧随的公式同页 |
| 生僻字 | 34 / 1.1，SimSun-ExtG 主栈 |
| 正扉页上标 `sup` | 26 / 30，`vertical-align: 46pt` |
| 第 i 页上标 `sup` | 16 / 15，`vertical-align: 18pt` |
| 正扉页中文刊名 | 18 / 30，0.08 em |
| 目录刊头 h2 | 56 / 54，−0.035 em |

---

## 5. 中文排版规则

| 项 | 值 |
|---|---|
| `p.indent` | 2 em（散文、小说、科普都缩进） |
| `p.space` | 0；段落靠缩进区分 |
| `text-align` | `justify` |
| `line-break` | `strict` |
| `text-spacing-trim` | `space-first` |
| `text-autospace` | `normal` |
| `hyphens` | `auto`（只影响西文） |
| `palt` | 只开在标题、篇名、副标题、h2/h3 |
| `orphans` / `widows` | 2 / 2 |
| h2 / h3 / 公式引导段 | `break-after: avoid`（引出公式的那段与公式不分页） |

**破折号**（思源黑体 U+2014 字身仅 0.894 em，两个并排会露白口）：
`transform.js` 里把连续 `——` 拆成 `<span class="em">—<i>—</i></span>`；若字体没有 `ccmp` 破折号连字（实测无），加 `nj` 类，用 `margin-left:-.32em` 把两段墨迹接成一条线。这是当前唯一合法的写法，不要在正文里直接打两个 `—`。

**预处理清洗**（`transform.js`）：
删行首全角空格 / `&nbsp;` / 手打缩进；删中西文间手打半角空格（避免与 `text-autospace` 叠成双倍）；引号统一 `“ ”`；省略号统一 `……`；公式后紧跟「当/若/且/则/即/故/其中」时自动补逗号。

---

## 6. 色彩

### 6.1 原则

- 只允许实色：CSS 里没有 `opacity` / `rgba()` / 渐变 / 混合模式（否则 PDF 出现透明组，无法稳定转 CMYK）。
- 每个 hex 唯一，便于按 hex 做映射。
- 中性色带蓝相（k70/k45/k15 都是蓝灰），与信号色同色温。

### 6.2 调色板

| Token | RGB | 近似 CMYK* | 用途 |
|---|---|---|---|
| `c.paper` | `#FFFFFF` | 0/0/0/0 | 纸白 |
| `c.ink` | `#1D1D1B` | 0/0/7/89 | 正文、标题、粗线 |
| `c.k70` | `#56657F` | 32/20/0/50 | 副信息、图注、栏外标题 |
| `c.k45` | `#9AA6B8` | 16/10/0/28 | 页码细线、弱化线 |
| `c.k15` | `#D9E2EE` | 9/5/0/7 | 表格行线 |
| `c.blue` | `#458CEE` | 71/41/0/7 | **信号色**：大编号、标题、h2、页码 |
| `c.blue-deep` | `#2F6FD6` | 78/48/0/16 | 副标题、引导词、表头字 |
| `c.orange` | `#ED7207` | 0/52/97/7 | 星芒、开放征稿、PART 标签 |
| `c.tint` | `#E6F1FF` | 10/5/0/0 | 引用块、表头底色 |
| `c.gridline` | `#C2DEF7` | 21/10/0/3 | 章目录细线 |
| `c.music` | `#F08A24` | 0/43/85/6 | 音乐社 |
| `c.chem` | `#1FA67A` | 81/0/27/35 | 化学社 |
| `c.philo` | `#7A5BD6` | 43/57/0/16 | 哲学社 |
| `c.news` | `#F2B705` | 0/24/98/5 | 新闻社 |
| `c.math` | `#1E5BC6` | 85/54/0/22 | 数学社 |
| `c.open` | = `c.blue` | 同上 | 校外征稿 |

\* 近似值 = 由 RGB 做朴素换算得到的参考，**不是**交付值。实际交付由 Ghostscript 用 ICC 统一换算（见 6.3）。

### 6.3 CMYK 构建的真实做法

1. Chrome 只输出 DeviceRGB。
2. `scripts/build-cmyk.mjs` 调 Ghostscript：`-sColorConversionStrategy=CMYK -sProcessColorModel=DeviceCMYK -sOutputICCProfile=<icc>`，整本按 ICC 一次性换算。
3. pypdf 给每页挂 `/OutputIntents`（`/S /GTS_PDFX`、`/N 4`、`/DestOutputProfile`）。
4. 必须 `-dNOSAFER`：SAFER 模式下 Skia 生成的 PDF 最后一页会报 `/undefined in --runpdf--`。

**尚未实现**：v0.1 承诺的"按 hex 精确映射到指定 CMYK、小字强制 K100"没有落地。现状是 ICC 整本换算，`#1D1D1B` 会变成带 7% 黄的近黑，9.25 pt 正文因此是四色黑 —— 见 §11 待确认第 6 条。

---

## 7. 版式组件（实际值）

### 7.1 页眉页脚（overlay 页，与正文层分离）

| 元素 | 位置 | 样式 |
|---|---|---|
| 页码 | 切口侧，基线距成品下边 14 mm | `t.folio`，`c.ink`；上方 26.667 pt × 0.5 pt `c.k45` 细线，间距 5 pt |
| 栏外标题（右页） | 切口侧，距成品上边 12 mm | `CHAPTER 01 §03　篇名`，`t.runhead`，`c.k70` |
| 栏外标题（左页） | 同上 | `RESONANCE　共鸣　2026 冬` |
| 社团色标 | 右页切口，出血到页边 | 宽 3 mm + 4 pt、高 30 pt；按社团序 `top: 23mm + n × 34pt` |
| 章扉页页脚带 | 版心宽通栏，细线与页码细线同高 | 0.5 pt `c.k45` 线；切口侧页码 `t.folio` `c.ink`，订口侧「# 章名 英文」`t.runhead` `c.k70`。章扉页不画章色标 |

页码规则：前置页用罗马数字，且**第 i–iii 页不印页码**（第 iv 页起 `iv`、`v`…）；正文从 `1` 起。overlay 里"前置页数"由第一章章首页的实际页序推算，目录占一页还是两页都不会算错。

### 7.2 章扉页（网点风光照片 + 纸纹）

参照两张图：一张是雪山照片挂粗网、上面压一格格实色蓝圆、圆里落字母的海报；一张是米色纸上的网点插画，四色网点有轻微套印错位。本刊做法：

- **画在 overlay 层**（`build.mjs` 的 `chapterSheet` + `src/chapter.css`），正文层只留一张空页和 `#ch-N` 锚点。正文层里任何超出版心的元素都会让 Chrome 把整份文档等比缩小（57 页的稿子会缩成 49 页）。
- **底图**：`scripts/chapter-art.py` 生成整张出血页位图（216 × 303 mm，300 dpi，JPEG q90），由 `renderChapterArt` 在出 overlay 之前调用；章首页在左页还是右页由实际页序决定，几何随之镜像。
  - 纸：暖白 RGB(238, 233, 222)，叠低频斑驳（±0.55% / ±0.4%）、细颗粒（σ ≈ 2%）与随机短纤维；整页（含照片与蓝圆）都乘上同一张纸纹。
  - 照片：朴素分色成 CMYK（骨架黑，K 从灰成分 12% 以上开始），42 lpi 余弦圆点网，网角 C15° / M75° / Y0° / K45°；套印错位 C (+3, +1) px、M (−2, +2) px、Y (+1, −3) px、K 不动（300 dpi 下约 0.1–0.25 mm）；油墨按纸纹深浅吸墨（0.75–1.05）。
  - 蓝圆：`c.blue` 实色，4 列 × 5 行，直径 24 mm，中距 35.5 mm，在照片区里水平、垂直各自居中。
- **照片块**：右页从版心左缘偏进 30.1 mm（两栏 + 两沟）起、向切口出血；上沿距成品上边 95 mm（出血页 y = 98 mm），下沿 = 版心底线。左页按页面中线镜像。
- **照片来源**：只用公有领域 / CC0，出处同时印在版权页（`CH_PHOTO`）：
  - 01「文学」：“Sea of clouds”，liu qiaojun 摄，CC0（Wikimedia Commons）。
  - 02「交叉」：“Chitina River Below the Nizina River and Chakina River Confluences (2)”，美国国家公园管理局阿拉斯加区摄，公有领域（Wikimedia Commons）。
  - 入库的是缩到长边 3200 px 的版本（`assets/chapters/ch1.jpg`、`ch2.jpg`）。
- **上部纸面**（版心坐标）：`CHAPTER 0N` 7 pt GS W 700、0.14 em、`c.blue`；中文章名 `t.chapter-cn`（第 15 pt 起）；英文章名 14 / 15 GS W 500 `c.blue`（第 72 pt）；引语 11 / 18 思源黑 500，左 6 栏宽（第 112.5 pt），出处 7.5 / 11.25 `c.k70`。右 6 栏为本章篇目，8.5 / 12 思源黑 500，序号 8 pt GS W 700 `c.blue`，行内边距 2.25 pt，行线 0.25 pt `c.k45`。
- **圆里的字母**：章名英文按行逐字落在圆里（LITE / RATU / RE…、INTE / RSEC / TION / S），白色 15 pt GS W 700，矢量文字压在底图上，圆心与底图同一套 mm 几何。
- **页脚带**：见 §7.1。

### 7.3 正文元素

| 元素 | 规则 |
|---|---|
| `h2` | `t.h2`，`c.blue`，前 9 pt 星芒（右距 5 pt），段前 1.15 bl、段后 0.5 bl |
| `h2.part` | 前缀 `PART 1`：`t.tag` 尺寸、`c.orange`、0.14 em、右距 10 pt |
| `h3` | `t.h3`，`c.blue-deep`，前 11 × 2.4 pt 蓝条（右距 6 pt），段前 0.8 bl、段后 3.75 pt |
| `h3.num` | `t.h3num`，`c.blue`，无前缀符号 |
| 行内公式 | KaTeX，`1.05em`；分数线压到 `0.032em`（默认 0.04 em 打印会吸成整像素） |
| 独立公式 | 居中，上下各 0.5 bl、`padding-top:3pt`、`break-inside:avoid`；超栏宽 `column-span:all` |
| 公式同行说明 | `.fline` 行高 2.1；含 `\frac` 的段落行高放到 23 pt，避免与上下行相撞 |
| 推导行 `.led` | `1fr auto 1fr` 网格：引导词右对齐（右距 9 pt）＋公式居中 |
| ①②③ 步骤 | 悬挂缩进 1.2 em；编号 700 `c.blue-deep`，等宽数字 |
| 引用 / 题记 | `c.tint` 底、内边距 7.5 pt / 1 em、`c.blue-deep` 字 |
| 生僻字 | `.rare` 34 pt，SimSun-ExtG 主栈，矢量文字不转图 |

### 7.4 图片

| 变体 | 规则 |
|---|---|
| 默认 `figure` | 上下 0.5 bl / 1 bl；`break-inside:avoid`；图按原稿宽度出图，不拉满栏宽 |
| `.col` | 单图按图宽收缩并居中，图注仍贴图左缘 |
| `.float` | 单栏篇目的小图右浮，宽 ≤ 44%，图注在图下；`build.mjs` 的 `FIG_FLOAT` 可逐张强制绕排（1）或不绕排（0） |
| `.wide` | 比一栏宽的图通栏居中（`column-span:all`） |
| `.row` | 3–5 张等高并排（图高 60 pt，`object-fit:contain`） |
| 图注 | `t.caption`，`c.k70`，距图 3.75 pt；图号 7.5 pt 700 `c.blue`，右距 4 pt |
| 重绘图 `svg.dfig` | 内联 SVG，与 `img` 走同一套 figure 布置；宽度由 `data-fw` 可选放宽（仅 2-1 用 56%） |

**插图重绘**（`scripts/figures.mjs`，2026-11 起）：原稿里由 Word / Excel / Desmos / GeoGebra 生成的图表一律改为程序生成的矢量 SVG，随页面字体一起排版，印刷时无栅格化。

- **单位**：`viewBox` 用户单位 = pt，与成品尺寸 1:1，因此 `stroke-width` 和 `font-size` 写的就是实际磅值；不设额外缩放，避免图内小字被整体缩小。
- **线条**：网格 0.25 pt（`c.gridline`）；坐标轴 0.55 pt（`c.k70`）；数据曲线 1.5 pt；几何线框 0.6–0.7 pt；分形 0.42–0.55 pt。
- **色彩**：主数据序列 `c.blueDeep`，次序列 `c.orange`，单序列 `c.blue`；「整体 vs 分割」用 `c.k70` / `c.blueDeep` 区分；不用填充底色，分形的密度靠小三角之间的白缝（0.29 pt ≈ 0.1 mm）表现。
- **字号**：刻度 6.2 pt、轴名 6.6 pt、图例 6.4 pt，全部 `font-feature-settings:"tnum" 1,"pnum" 0`（数字等宽，刻度不跳动）；轴名不加箭头，网格不加外框。
- **忠实原文**：解析式、坐标范围、数据点一律照原稿（2-1 为 `y=ln x` 与 `y=1/x`，2-8 为 `a(x)=Σ(1/n)sin((2n−1)πx)`，2-2 为原图的 10 个实测点），只重做线条、色板与标注；唯一例外是 2-1 的说明文字随配色由「红线 / 紫线」改为「蓝线 / 橙线」。
- **已重绘 10 张**：2-1 函数图；2-2 折线；2-3 正方形四等分、线段二等分、图 1 谢尔宾斯基（实心 + 蓝框）、四联分形（谢尔宾斯基 / 科赫 / 维切克 / 希尔伯特，原 alt 即「希尔伯特曲线」）；2-8 傅里叶波形。
- **不重绘**：照片（2-4 贝克莱肖像）、作者手迹（2-8 手写笔记）、网页与实验截图（2-6）、字体渲染的汉字（2-3 的 並 / biáng 等，本身是讨论对象）。

遗留：2-3 的 `image1.jpeg` 原图为 5 层实心分形，重绘后仍 5 层；四联图里的谢尔宾斯基用线框版（照原稿），与主图的实心版并存。

### 7.5 表格

| 部位 | 规则 |
|---|---|
| 顶线 / 底线 | 1 pt `c.blue` |
| 表头行 | `c.tint` 底、`c.blue-deep` 700、下 0.5 pt `c.blue` |
| 行线 | 0.25 pt `c.k15` |
| 单元格 | 内边距 3.75 / 4 pt，垂直居中，左对齐（数字列未开等宽数字，靠右对齐需手工加类） |
| 跨栏 | `.tbl.wide`（≥ 5 列时手工加类） |

### 7.6 篇末注释 / 诗

- 注释：上方 0.5 pt `c.blue` 线，标签为「注释」或「注」（由 `transform.js` 按原文判定），7.5 pt 700 `c.blue`、0.14 em；条目悬挂 12 pt，编号绝对定位、等宽数字；正文 `c.k70`。
- 诗：单栏，左起第 4 栏，宽 3 栏 + 2 沟；`t.poem`，不缩进、不两端对齐；节间空 1.5 bl；诗末注释回正文双栏排。

### 7.7 目录（v–vi）

- 刊头：高 3.6 bl，「CONTENTS」56 / 54（必须容得下 54 pt 行盒，压小会向上溢出到上一页），右侧「目录」12 / 15、0.4 em，星芒 26 pt 落在刊头右上空白。
- 章头：序号 21 / 26 + 章名 12 / 15 + 英文 9 / 15；下边框 1 pt `c.blue`，下边距 4 pt，段前 1.2 bl。
- 条目：4 列网格 `52pt / 1fr / 40pt / 36pt`，四列各自垂直居中，上下内边距 8.5 pt，行间 0.25 pt `c.k15`。
- 序号 16 pt/1，`c.blue`，等宽数字；标题 10 / 15；作者行 `t.byline`；圆点 6 pt；页码 10 / 15 700、右对齐、等宽数字。
- 两页自然续排：02 章**不强制另起页**，断点落在条目之间（`break-inside:avoid`），章头不落单（`break-after:avoid`）。当前断点：v 页排到 02 的第 3 条，vi 页排 02 的第 4–9 条。

### 7.8 篇目跨页（第一章 01–03）

参照刊里每篇有自己的「气候」（「时间的长矛」的跨页斜线、p97 的满版色底、p144 的满版夜景细标题、「筑就群山」的竖排大标题）。本刊第一章前三篇各占一个跨页，单独定底色、标题、配图与文字处理；其余篇目仍用通用开篇（§7.3 之前的 `.opener`）。

**机制**

- 配置在 `build.mjs` 的 `ART` / `ART_PHOTO` / `artOpener` / `artFrag` / `artCoda` / `artSheets`，样式在 `src/art.css`（正文层、overlay 层共用一个文件）。
- 满版的东西（底色、网点照片、斜线、雾蓝底）画在 overlay 层，`merge.py` 把这些页的 overlay **垫在正文下面**（页码列表写在 `build/under.json`），正文字直接压在照片上。正文字号、行距、栏宽都不变，所以各篇页数不受影响。
- 照片走同一条网点管线（`scripts/chapter-art.py`）：专色网（`mode: 'inks'`），每种油墨一块版，覆盖率取自暗部（`dark`）或暖色灯光（`warm`）；`fade` 让网点自上而下由无到有（雾）；`net` 画水面细网；`density` 控制实地墨量。
- 只有排版之后才知道的位置（1-2 雾蓝底收在哪一行）由 `scripts/findtext.py` 在 body.pdf 里查字的坐标得到。
- 照片只用 CC0 / CC BY-SA 4.0，来自 Wikimedia Commons，入库的是缩到长边 3200 px 的版本（`assets/articles/`）。每张图角上印一行简短署名（6.5 / 7.5 GS W），版权页「篇目配图」一栏写全：作者、作品名、协议、经裁切与网点化处理；CC BY-SA 的改编图同以 CC BY-SA 4.0 授权。

**01《在铁路口》· 夜里的白光**（左页照片页 + 右页正文，`full`）

- 配图：Killarnee，“Karlsruhe at night – railroad crossing Brunnenstückweg, Karlsruhe-Rüppurr - 3”，CC BY-SA 4.0。夜间道口，火车拖影与车头灯。
- 左页满版：墨 `c.ink`（45°）+ 车灯黄 `c.news`（15°，错位 2 / −1 px）双色网，38 lpi，`density: 1`、`absorb: 0.3`（夜空要实，不能发灰）。
- 右页满版 `c.ink` 矢量底；正文反白 `c.paper`；不印书眉（光线从右上角出去）。
- 标题「在铁路口」900 84 / 90 思源宋，0.06 em，纸白，压在夜空；作者 700 10 / 15。
- 车灯光线：0.35 mm（≈ 1 pt）`c.news` 直线，跨页坐标从左页车头灯（114, 151 mm）到右页切口上角（426, 3 mm；右页 x + 210），对应参照刊的跨页斜线。
- 引语（原文句子，手工断两行）600 20 / 30 思源宋 `c.news`，右齐，落在光线右下方；正文从右页第 29 基线起排到页底。

**02《明天见》· 起雾的车窗**

- 配图：W.carter，“Sleet and rain through a bus window on road 162”，CC BY-SA 4.0。
- 开篇加高到 28 bl（420 pt）；照片 216 × 166 mm 出血，`c.blue` 单色网 42 lpi，纸色即雾蓝 `c.tint`。
- 雾蓝底 `c.tint` 从开篇铺到反转那一句「白色的天花板。」之前（该段前插一条通栏 `.fogline`，高 1 bl，底色收在它中间），之后回到白纸——「雾散了」。
- 标题「明天见」500 66 / 75 思源宋，0.14 em，纸白。
- 「明天见。」改为通栏大字 600 30 / 45 思源宋，0.3 em，`c.blue-deep`。
- 护士交班记录排成记录单：0.5 pt `c.blue-deep` 框，表头「交班记录 / 五路康复环线　第二天」，内文 8.75 / 15 思源黑；末句「他们看上去，都很高兴。」右齐、600 思源宋 `c.blue-deep`，作护士补的一笔。

**03《半片水，半城雾》· 雾里的第一盏灯**（左页照片页 + 右页正文，`full`）

- 配图：Nico le terrible，“Wuzhen by night 5”，CC0。乌镇夜河、船、两岸灯火。
- 左页满版：墨（45°）+ 灯火橙 `c.orange`（15°，错位 2 / −2 px）双色网，40 lpi；网点在页面 45 → 165 mm 之间由无到有（smoothstep），上端化进纸色成雾。水面（205 mm 以下）叠 ±45° 细网，线宽 0.09 mm、间距 4.2 mm、纸色、强度 0.6，在 210 → 290 mm 之间渐显。
- 标题竖排两列「半片水，／半城雾」900 54 / 66 思源宋，0.1 em，`c.ink`，右上压在雾里，第二列下沉两字；篇号与栏目竖排在标题左侧。
- 右页：暖白纸纹底图（150 dpi），正文照常双栏；末段「故乡，水的故乡……」从正文里取出，竖排收尾（500 10.5 / 22.5 思源宋，0.12 em，高 255 pt，右齐），上方 0.25 pt `c.k45` 线。
- 原稿无作者署名，开篇不印作者（待补）。

---

## 8. 前置页（Front Matter）

共 **6 页**（目录占两页），罗马数字；第 i–iii 页不印页码。

| 页 | 内容 | 版式 |
|---|---|---|
| i | 半题页 | 字标 `t.halfmark` + 22 pt 星芒（`left:77pt; top:7pt`）+「共鸣」11 / 22.5；起点第 20 基线 |
| ii | 宣言页 | 英文宣言 `t.quote`（两行）+「每一个声音，都值得一次回响。」14 / 30；底部 6 列社团图例（10 pt 圆点 + 标签） |
| iii | 正扉页 | 见下方「正扉页」 |
| iv | 版权页 | `t.caption`，贴底左栏（240 pt 宽）；`dl` 两列 56 pt + 1fr；待定项 `c.orange` |
| v–vi | 目录 | 见 7.7 |

**正扉页（iii）**：参照宽字距断词海报，满版颗粒渐变光球 + 竖条玻璃，字压在上面。

- 底图 `scripts/orb-art.py`（spec 在 `build.mjs` 的 `TITLE_ORB`），overlay 层垫在正文下面（同 §7.8 的 under 页）。底色 `c.tint`；光球中心 (96, 156) mm、半径 114 × 132 mm、柔边 0.1；色标 `c.orange` → `c.music` → `c.philo` → `c.blue` → `c.blue-deep`，方向 12°，**在 OKLab 里插值**（按 RGB 直接混，橙紫之间会发褐）；颗粒 σ 0.04。右侧三条竖玻璃 132–151 / 151–170 / 170–189 mm，按玻璃棒折射取样：条内放大（取样随位置反向收缩 0.7 倍条宽）、整体错位 0.5 倍条宽，RGB 三通道错位差 ±0.04 倍条宽（色散），条内叠 +5% 柔高光（35% 处）与右缘 −6% 渐暗。**不画描边、不画亮线**，条与条之间只靠折射断口分界。
- 字标 RE— / SON / —ANCE：逐字落在 58 × 66 pt 的格子里（`TITLE_GRID`），GS W 400 56 / 66，纸白；「O」用 `c.orange`，代替原字标里的星芒。
- 「共鸣」思源黑 300 36 / 45、0.5 em；tagline GS W 400 10 / 15、0.24 em。
- 右上期号块 `c.blue`：年份 GS W 400 30 / 36、0.24 em，1 pt 横线 92 pt，「VOL 02」「› WINTER」17 / 27、0.3 em。
- 右缘竖排出品方（思源黑 400 9 / 15、0.28 em，`vertical-rl`）；左下侧排「STUDENT JOURNAL · 宣言」（GS W 8.5 / 15，`sideways-lr`，自下而上）。
- 底边居中五社团：纸白社名 500 8 / 15、0.12 em，社名之间用「×」（GS W 400）分隔，左右各 10 pt，不加色点。

v0.1 规划的「v 卷首语」没有实现，目录占用 v–vi。

---

## 9. CSS 变量（生成 `src/tokens.css`）

```css
:root {
  /* page */
  --trim-w: 210mm; --trim-h: 297mm; --bleed: 3mm;
  --m-top: 20mm; --m-bottom: 23mm; --m-inner: 20mm; --m-outer: 15mm;

  /* layout grid (text) */
  --bl: 15pt; --bl-half: 7.5pt;
  --grid-col: 26.667pt; --grid-gap: 16pt;
  --col-w: 240pt; --col-gap: 16pt;
  --block-w: 496pt; --block-h: 720pt;
  --opener-h: calc(var(--bl) * 18);

  /* families */
  --ff-ui: "GS Text", "SHS", sans-serif;
  --ff-display: "GS Display", "SHS", sans-serif;
  --ff-sans: "GS Text", "SHS", sans-serif;
  --ff-serif: "SHSerif", serif;

  /* scale — display */
  --t-mega: 700 150pt/135pt var(--ff-display);
  --t-chapter: 700 260pt/225pt var(--ff-display);
  --t-wordmark: 700 80pt/75pt var(--ff-display);
  --t-halfmark: 700 40pt/37.5pt var(--ff-display);
  --t-quote: 700 44pt/52.5pt var(--ff-display);
  --t-chapter-cn: 700 44pt/52.5pt "SHS", sans-serif;
  --t-chapter-en: 700 18pt/22.5pt var(--ff-display);
  --t-title: 700 30pt/37.5pt var(--ff-display);
  --t-title-long: 700 24pt/30pt var(--ff-display);
  --t-subtitle: 500 11pt/22.5pt var(--ff-ui);
  --t-tagline: 700 12pt/15pt var(--ff-display);
  --t-h2: 700 12pt/22.5pt var(--ff-ui);
  --t-h3: 700 10.5pt/16.5pt var(--ff-ui);
  --t-h3num: 700 18pt/22.5pt var(--ff-display);
  --t-list: 700 9pt/15pt "SHS", sans-serif;

  /* scale — text */
  --t-body-serif: 400 9.6pt/15pt var(--ff-serif);
  --t-body-sans: 400 9.25pt/15pt var(--ff-sans);
  --t-poem: 400 10.5pt/22.5pt var(--ff-serif);
  --t-byline: 500 8pt/15pt var(--ff-ui);
  --t-tag: 700 7pt/7.5pt var(--ff-ui);
  --t-caption: 400 7.5pt/11.25pt var(--ff-ui);
  --t-table: 400 8pt/11.25pt var(--ff-ui);
  --t-note: 400 7.5pt/11.25pt var(--ff-ui);
  --t-folio: 700 8pt/7.5pt var(--ff-ui);
  --t-runhead: 500 7pt/7.5pt var(--ff-ui);

  /* color */
  --c-paper: #FFFFFF;
  --c-ink: #1D1D1B;
  --c-k70: #56657F;
  --c-k45: #9AA6B8;
  --c-k15: #D9E2EE;
  --c-blue: #458CEE;
  --c-blue-deep: #2F6FD6;
  --c-orange: #ED7207;
  --c-tint: #E6F1FF;
  --c-gridline: #C2DEF7;
  --c-music: #F08A24;
  --c-chem: #1FA67A;
  --c-philo: #7A5BD6;
  --c-news: #F2B705;
  --c-math: #1E5BC6;
  --c-open: var(--c-blue);

  /* rules */
  --rule-hair: 0.25pt; --rule-thin: 0.5pt; --rule-mid: 1pt;

  /* sparkle — 四角星 data-URI（fill 用 %23 转义，值必须与 tokens.css 一致） */
  --sparkle: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath fill='%23ED7207' d='M50 0C53 37 63 47 100 50C63 53 53 63 50 100C47 63 37 53 0 50C37 47 47 37 50 0Z'/%3E%3C/svg%3E");
  --sparkle-blue: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath fill='%23458CEE' d='M50 0C53 37 63 47 100 50C63 53 53 63 50 100C47 63 37 53 0 50C37 47 47 37 50 0Z'/%3E%3C/svg%3E");
}
```

v1.0 相比 v0.1 删除的死 token：`--c-signal`、`--c-k6`、`--c-rich`、`--ff-cond`、`--clubbar-h`、`--deco-pitch/wobble/stroke`、`--rule-bold`（全书最粗只有 1 pt）。

---

## 10. 输出与构建

| 产物 | 文件 | 说明 |
|---|---|---|
| 屏幕版 | `dist/resonance-screen.pdf` | 只到 TrimBox，无出血 |
| RGB 印刷版 | `dist/resonance-print-rgb.pdf` | 216 × 303 带出血，含 TrimBox |
| 水印 demo | `dist/resonance-demo.pdf` | 矢量水印（SAMPLE / 未经授权 切勿转载），倾斜 30°，逐页叠加 |
| CMYK 付印版 | `dist/resonance-print-cmyk.pdf` | gs 转 DeviceCMYK + OutputIntent |

命令：`npm run build` / `npm run demo` / `npm run cmyk` / `npm run all`（`--only 2-3` 可单篇重建）。

当前全书 **58 页**（前置 6 + 正文 52）。1-1 扩成跨页后比原来多一页，其后各篇整体后移一页，第二章扉页改落在右页（底图按页序自动镜像）。两张章扉页底图与三篇跨页的底图合计约 20 MB，屏幕版 / RGB 版 PDF 约 33 MB，CMYK 版约 51 MB。

**已知问题**（本版未解决）：

1. 没有 preflight：v0.1 规划的 `scripts/preflight.py` 未实现，字体嵌入、总墨量、最小字号、图片 ppi 都没有自动校验。
2. 小字 CMYK 不是单色黑（见 6.3）。
3. 正文仍有 Type3 字体（Chromium 对部分 CJK 的处理），印前需在 Acrobat / PitStop 里转曲或重嵌。
4. `icc/gs_default_cmyk.icc` 是占位 profile，正式付印必须换成印厂的 FOGRA39。

---

## 11. 待确认与待办

1. 期号：「2026 冬 / VOL. 02」为占位，版权页标了〔待确认〕。
2. 章名：「01 文学 LITERATURE / 02 交叉 INTERSECTIONS」待确认。
3. 1-4 按文学篇用宋体排，是否维持。
4. 2-4、2-5 的作者都是钱东成、内容属数学，是否归 `c.math`（现按征稿红蓝处理为 open）。
5. 版权页人员名单与出版信息。
6. **CMYK 逐色映射**：是否补 `scripts/cmyk_map.json` + 内容流改写，把正文黑压成 K100。
7. **未启用的占位样式**：markup 里的 `.clubbar`（篇首社团色条）、`.rule`（篇首分割线）、`.fm-title .open`（正扉页「开放校外征稿」）都没有对应内容，CSS 里却留着规则。要么补内容/补样式，要么从两边一起删。
8. **图片重绘**：已完成（见 §7.4「插图重绘」）。剩余未重绘的是不宜重画的照片、手迹与截图：2-5 的洛必达肖像、2-6 的三张实验/网页截图、2-3 的汉字字形图。
   2-5 肖像原先挂在「小明：0 啊……」一段，离页底只剩约 174 pt、放不下 208 pt 的图块，整块跳到第 43 页顶，紧跟的洛必达公式又比图侧行宽还宽，第 43 页左上空出约 190 × 330 pt。已用 `FIG_MOVE` 把肖像挪到公式之后「其中 f(x)、g(x) 均为函数」一段绕排；图3（四种平均数的星形示意）改为不绕排、按原稿 2.7 in 居中，放在 M_p 公式与结尾句之间。2-5 仍是 5 页，第 44 页正文到 y ≈ 404 pt 结束。
   图3 原图右下角带「百度 AI生成」水印，尚未替换。
9. 新闻社无对应篇目，`c.news` 目前只出现在扉页社团列表。
