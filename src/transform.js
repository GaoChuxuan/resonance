// In-page DOM transform: pandoc HTML fragment -> typeset article body.
// Runs inside headless Chrome before printing. Sets window.__ready / window.__report.
(function () {
  const report = { warnings: [], math: 0, mathErrors: [], images: 0, tables: 0 };
  const CJK = '\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF';
  const norm = s => (s || '').replace(/[#*\s\u3000\u00a0《》〈〉]/g, '').replace(/^——/, '');

  function cleanText(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('.math, .katex, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      let t = n.nodeValue;
      t = t.replace(/\u00a0/g, ' ');
      t = t.replace(/(?<!-)--(?!-)/g, '——').replace(/—(?!—)(?<!—)/g, '——');
      t = t.replace(/\.{3,}|。{3,}/g, '……');
      t = t.replace(new RegExp('([' + CJK + '])[ \\t]+(?=[A-Za-z0-9])', 'g'), '$1');
      t = t.replace(new RegExp('([A-Za-z0-9%])[ \\t]+(?=[' + CJK + '])', 'g'), '$1');
      n.nodeValue = t;
    }
    // leading indent junk at paragraph start
    root.querySelectorAll('p').forEach(p => {
      let f = p.firstChild;
      while (f && f.nodeType === 3 && /^[\s\u3000]*$/.test(f.nodeValue)) { const nx = f.nextSibling; f.remove(); f = nx; }
      if (f && f.nodeType === 3) f.nodeValue = f.nodeValue.replace(/^[\s\u3000]+/, '');
    });
  }

  function renameEl(el, tag) {
    const n = document.createElement(tag);
    for (const a of el.attributes) n.setAttribute(a.name, a.value);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n); return n;
  }

  function unwrapDivs(root) {
    root.querySelectorAll('div[data-custom-style]').forEach(d => d.replaceWith(...d.childNodes));
    root.querySelectorAll('span[data-custom-style]').forEach(s => s.replaceWith(...s.childNodes));
  }

  // Word 的有序列表常把后续整篇正文吞进同一个 <li>：拆平列表，序号做成悬挂缩进，
  // 否则「2．」会独占一行、标题和表格被裹进列表项里。
  function unwrapLists(root) {
    // 「1. 韦伯——费希纳对数定律」这类短标题：编号单独成列、标题按黑体小标题排，
    // 而不是和正文一样只把数字染蓝。判定只看「去编号后是否一整句短语」，
    // 不带句读、不含公式、且能一行放下，避免把普通列表项误判成标题
    const isHeading = p => {
      const t = p.textContent.replace(/^\s*\d{1,2}\s*[.．]\s*/, '').trim();
      return t.length > 0 && t.length <= 32 && !/[，。；：、,;:]$/.test(t) && !p.querySelector('.math');
    };
    root.querySelectorAll('ol,ul').forEach(list => {
      const start = parseInt(list.getAttribute('start') || '1', 10) || 1;
      const host = list.parentNode;
      [...list.children].filter(el => el.tagName === 'LI').forEach((li, i) => {
        const ps = [...li.children].filter(el => el.tagName === 'P');
        ps.forEach((p, k) => {
          if (k === 0) {
            p.classList.add('li-p');
            const m = document.createElement('span');
            m.className = 'li-n';
            m.textContent = (start + i) + '.';
            p.insertBefore(m, p.firstChild);
            // Word 的自动编号后面常跟一个「：」，与手工写的前缀重复
            const nx = m.nextSibling;
            if (nx && nx.nodeType === 3) nx.nodeValue = nx.nodeValue.replace(/^[\s\u3000]*[:：]\s*/, '');
            if (isHeading(p)) p.classList.add('fn-h');
          } else {
            p.classList.add('li-c');
          }
        });
        while (li.firstChild) host.insertBefore(li.firstChild, list);
        li.remove();
      });
      list.remove();
    });
    // 「[1]：标题」统一成「1. 标题」
    root.querySelectorAll('p').forEach(p => {
      const f = p.firstChild;
      if (!f || f.nodeType !== 3) return;
      const m = f.nodeValue.match(/^\s*[\[［]\s*(\d{1,2})\s*[\]］]\s*[:：]\s*/);
      if (!m) return;
      f.nodeValue = f.nodeValue.slice(m[0].length);
      const s = document.createElement('span');
      s.className = 'li-n';
      s.textContent = m[1] + '.';
      p.insertBefore(s, f);
      p.classList.add('li-p');
      if (isHeading(p)) p.classList.add('fn-h');
    });
  }

  function inches(img) {
    const m = (img.getAttribute('style') || '').match(/width:\s*([\d.]+)in/);
    return m ? parseFloat(m[1]) : 3;
  }
  function aspect(img) {
    const m = (img.getAttribute('style') || '').match(/height:\s*([\d.]+)in/);
    return m ? parseFloat(m[1]) / inches(img) : 1;
  }
  function captionOf(img) {
    let a = (img.getAttribute('alt') || img.getAttribute('data-cap') || '').trim();
    a = a.replace(/^.*\.(jpe?g|png|gif|bmp)/i, '').trim();
    if (!a || /^截图|^image\d*$|^图片\d*$|^\d+$/i.test(a)) return '';
    if (/^[a-z]+$/i.test(a)) return '';   // romanised file names like "biang"
    // 图片网站的抓取名（查询串 / 长十六进制哈希）没有中文时一律不作图注
    if (!/[\u4e00-\u9fff]/.test(a) && /[=&]|[0-9a-f]{16,}/i.test(a)) return '';
    return a;
  }

  // 图注：编号 + 说明（说明可能为空，编号不能省）
  function caption(fig, n, cap) {
    const fc = document.createElement('figcaption');
    const b = document.createElement('b'); b.textContent = '图 ' + n;
    fc.appendChild(b);
    if (cap) fc.appendChild(document.createTextNode(cap));
    fig.appendChild(fc);
    return fc;
  }

  const COL_IN = 3.32;    // 双栏篇目的单栏宽度（175mm 版心 → 84mm 栏）
  const BLOCK_IN = 6.85;  // 版心宽 175mm

  // 图的身份：重绘的 SVG 带 data-ref（原稿文件名），位图取 src 的文件名。
  // 正文里的 \ref 用它把「图 X」的 X 算出来，不写死
  function figId(el) {
    return (el.dataset && el.dataset.ref) || ((el.getAttribute('src') || '').split('/').pop() || '');
  }

  // 正文里的 [[fig:image3.png]]：排成蓝色的「图 3」。
  // 编号来自本篇实际的出图顺序（figure 生成时登记），增删插图后引用自动跟着变
  function figrefs(text, state) {
    const w = document.createTreeWalker(text, NodeFilter.SHOW_TEXT, {
      acceptNode: n => /\[\[fig:/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0, m;
      const re = /\[\[fig:([^\]]+)\]\]/g;
      while ((m = re.exec(n.nodeValue))) {
        if (m.index > last) frag.appendChild(document.createTextNode(n.nodeValue.slice(last, m.index)));
        const id = m[1].trim();
        const num = state.map[id];
        const s = document.createElement('span');
        s.className = 'figref';
        s.textContent = num ? '图\u2009' + num : '图\u2009?';
        if (!num) report.warnings.push('missing fig: ' + id + ' in ' + (n.parentElement.closest('[data-id]') || {}).dataset?.id);
        frag.appendChild(s);
        last = m.index + m[0].length;
      }
      if (last < n.nodeValue.length) frag.appendChild(document.createTextNode(n.nodeValue.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  function figures(text, state, single) {
    const wrapLimit = 110 / 25.4;   // 超过 110mm 的图更像整幅图表，铺满栏宽而不绕排
    // paragraphs that contain images
    [...text.querySelectorAll('p')].forEach(p => {
      const imgs = [...p.querySelectorAll('img, svg.dfig')];
      if (!imgs.length) return;
      const rest = p.cloneNode(true); rest.querySelectorAll('img, svg.dfig').forEach(i => i.remove());
      const hasText = rest.textContent.trim().length > 0;
      const fig = document.createElement('figure');
      if (imgs.length >= 2) {
        // 一组图：原稿宽度超过栏宽的通栏排、按自然比例出图；小组图（字形表）保持一排缩略
        const wmax = Math.max(...imgs.map(inches));
        const wideRow = wmax > (single ? BLOCK_IN : COL_IN);
        fig.className = 'row' + (wideRow ? ' wide' : '');
        fig.style.setProperty('--n', Math.min(imgs.length, 5));
        imgs.forEach(img => {
          const cell = document.createElement('div'); cell.className = 'cell';
          const cap = captionOf(img);
          img.removeAttribute('style');   // 通栏行由 CSS 定宽，缩略行固定高度
          img.removeAttribute('alt');
          cell.appendChild(img);
          const cn = ++state.fig, cid = figId(img);
          if (cid) state.map[cid] = cn;
          cell.appendChild(caption(cell, cn, cap));
          fig.appendChild(cell);
        });
      } else {
        const img = imgs[0], w = inches(img), cap = captionOf(img);
        const inCell = !!p.closest('td,th');
        // 表格单元格里图注就是同一段里的文字（「图」的说明另起一行会重复），
        // 把它接进 figcaption，段内文字清空
        const cellCap = inCell && hasText ? rest.textContent.trim() : '';
        // 比一栏还宽的图放不进栏里，硬塞会被缩到栏宽而下缘留出空白 → 让它通栏居中
        const wide = w > (single ? BLOCK_IN : COL_IN);
        fig.className = wide ? 'wide' : (w < 1.6 ? 'small' : 'col');
        // 单栏篇目里的小图改为图文绕排，不再居中占掉整行、留下两侧空白。
        // 默认只绕横幅（aspect ≤ 1.02）：竖图绕排会把行宽挤窄，被推到页顶时还会留出空洞；
        // 单张竖幅确实值得绕时，在原稿侧用 data-float 点名（如 2-5 的洛必达肖像）。
        // 表格里的图不参与绕排（百分比宽度在单元格里会缩到几毫米）
        // data-float="0"：在 build.mjs 的 FIG_FLOAT 里点名不绕排的图
        const forceFloat = img.dataset.float === '1';
        if (img.dataset.float !== '0' && !wide && single && !p.closest('td,th')
            && (forceFloat || (w <= wrapLimit && aspect(img) <= 1.02))) {
          fig.classList.add('float');
          if (img.dataset.fw) fig.style.maxWidth = img.dataset.fw + '%';
        }
        // 按原稿标注的宽度出图，不再拉满栏宽：低分辨率截图被放大两三倍后既糊又占版，
        // 还会把整块图挤到下一页、留下半页空白。max-width:100% 兜住超宽的情况。
        // 重绘的 SVG 例外：它的行内 width/height 是按自身 viewBox 比例算好的，
        // 删掉就只剩 CSS 的 auto，尺寸会退化成浏览器的默认视口（图被压成一小块）
        const isSvg = img.classList && img.classList.contains('dfig');
        if (!isSvg) img.removeAttribute('style');
        // 绕排图由 CSS 定宽（按原始比例缩到栏侧），其余按原稿宽度出图
        if (!isSvg && !wide && !fig.classList.contains('float')) img.style.width = (w * 72).toFixed(1) + 'pt';
        if (!isSvg) img.style.height = 'auto';
        img.removeAttribute('alt');
        fig.appendChild(img);
        const n = ++state.fig, id = figId(img);
        if (id) state.map[id] = n;
        caption(fig, n, cellCap || cap);
        if (cellCap) { [...p.childNodes].forEach(n => n.nodeType === 3 && n.remove()); p.querySelectorAll('img, svg.dfig').forEach(i => i.remove()); }
      }
      report.images += imgs.length;
      if (hasText) { p.before(fig); } else { p.replaceWith(fig); }
    });
    // runs of consecutive single small figures -> one row
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const row = document.createElement('figure'); row.className = 'row'; row.style.setProperty('--n', Math.min(run.length, 5));
        run[0].before(row);
        run.forEach(f => { const c = document.createElement('div'); c.className = 'cell'; while (f.firstChild) c.appendChild(f.firstChild); row.appendChild(c); f.remove(); });
      }
      run = [];
    };
    [...text.children].forEach(el => { if (el.matches('figure.small')) run.push(el); else flush(); }); flush();
  }

  function tables(text) {
    text.querySelectorAll('table').forEach(t => {
      t.removeAttribute('style'); t.querySelectorAll('col').forEach(c => c.removeAttribute('style'));
      const cols = t.querySelector('tr') ? t.querySelector('tr').children.length : 0;
      const wrap = document.createElement('div'); wrap.className = 'tbl' + (cols >= 5 ? ' wide' : '');
      t.before(wrap); wrap.appendChild(t); report.tables++;
    });
  }

  const CONNECTOR = /^[∵∴即则故]\s*$/;
  // 「∴式子：」「∵分子：」这类「符号 + 名词 + 冒号」也算标签，否则它会被当成正文，
  // 和旁边 ∵ / 分子： 的蓝标签长得不一样
  const LABELS = /^(?:[∵∴即则故]\s*)?(分子|分母|式子|原式|左边|右边|由|得|所以|因此|于是)\s*[:：]\s*$/;

  // 「∵」「∴」「即」「分子：」独占一段时，并进下一段的公式里，避免公式失去归属
  function joinConnectors(text) {
    [...text.querySelectorAll('p')].forEach(p => {
      if (p.closest('td,th')) return;
      const t = p.textContent.trim();
      if (!(CONNECTOR.test(t) || LABELS.test(t))) return;
      const nx = p.nextElementSibling;
      if (!nx || nx.tagName !== 'P' || !nx.querySelector('.math')) return;
      const lead = document.createElement('span');
      lead.className = 'lead';
      lead.textContent = t.replace(/\s+/g, '');
      nx.insertBefore(lead, nx.firstChild);
      nx.classList.add('led');
      p.remove();
    });
    // 「∵△ABH∽△HBC」这种符号与公式写在同一段里的，也拆成「符号 + 公式行」，
    // 否则符号留在页边、公式另起一段居中，和下面 ∴ / 即 的行对不齐
    [...text.querySelectorAll('p')].forEach(p => {
      if (p.closest('td,th') || p.classList.contains('led')) return;
      const first = p.firstChild;
      if (!first || first.nodeType !== 3) return;
      const m = first.nodeValue.match(/^\s*([∵∴即])\s*/);
      if (!m) return;
      const math = p.querySelector('.math');
      if (!math) return;
      const clone = p.cloneNode(true);
      clone.querySelectorAll('.math').forEach(x => x.remove());
      if (clone.textContent.replace(/^\s*[∵∴即]\s*/, '').trim()) return;   // 符号后还有别的话就不动
      first.nodeValue = first.nodeValue.replace(/^\s*[∵∴即]\s*/, '');
      const lead = document.createElement('span');
      lead.className = 'lead';
      lead.textContent = m[1];
      p.insertBefore(lead, p.firstChild);
      p.classList.add('led');
    });
    // 段首的 ∵ / ∴ 出现在纯文字句子里时（「∴将 p=0 代入极限式，得：」），
    // 也点成同一套蓝色，让整段推理的标记看起来是一个体系
    [...text.querySelectorAll('p')].forEach(p => {
      if (p.closest('td,th,figure') || p.classList.contains('led') || p.querySelector('.lead, .conn')) return;
      const first = p.firstChild;
      if (!first || first.nodeType !== 3) return;
      const m = first.nodeValue.match(/^[\s\u3000]*([∵∴])/);
      if (!m) return;
      if (!p.textContent.replace(/[∵∴]/g, '').trim()) return;   // 整段只有一个符号，留给 joinConnectors
      const s = document.createElement('span');
      s.className = 'conn';
      s.textContent = m[1];
      first.nodeValue = first.nodeValue.slice(m[0].length);
      p.insertBefore(s, first);
    });
  }

  // 源文档常把「当且仅当…」这类说明写进公式里：把中文说明从公式中拆出来，
  // 否则整句会被 KaTeX 按数学排版，字距怪异、又像是浮在版面中间的孤立公式。
  const PROSE_PUNCT = /[\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF1F\uFF01]/;
  const PROSE_CH = /[\u4E00-\u9FFF\u3400-\u4DBF\uFF08\uFF09]/;
  function splitMathProse(text) {
    text.querySelectorAll('span.math').forEach(s => {
      let tex = s.textContent;
      if (!PROSE_PUNCT.test(tex)) return;          // 没中文标点 → 视为纯公式（含 x_{总} 之类）
      const cmd = tex.search(/[\\^_{}]/);
      if (cmd > 0) {                                // 前导说明文字（只取到最后一个中文标点为止）
        const head = tex.slice(0, cmd);
        let cut = 0;
        for (let i = 0; i < head.length; i++) if (/[\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF08\uFF09\u4E00-\u9FFF]/.test(head[i])) cut = i + 1;
        if (cut > 0) { s.before(document.createTextNode(head.slice(0, cut))); tex = tex.slice(cut); }
        // 前面没有中文时（如 H(a,b)\leq…当且仅当…）继续往下走，按后段中文说明拆分
      }
      const m = tex.search(PROSE_CH);
      if (m === 0) { if (!/[\\{}^_]/.test(tex)) s.replaceWith(document.createTextNode(tex.trim())); return; }
      if (m > 0) {
        const head = tex.slice(0, m).trim(), tail = tex.slice(m).trim();
        s.textContent = head;
        if (tail) s.after(document.createTextNode(tail));
      }
    });
  }

  // 破折号：思源黑体的 U+2014 字身只有 0.894 em，两个并排时中间会露出一道白口，
  // 看上去像「两根短横」而不是一条一字线。字体 GSUB 的 ccmp 里有 emdash_emdash
  // 连字，但 Chrome 在含汉字的 run 里不应用它（实测只有整段全是破折号时才吃），
  // 所以在字体就绪后量一次：没吃到连字就把第二个破折号往回压 0.32 em，
  // 两段墨迹叠合成一条实线（叠合部位本来就是一整条黑线，看不出接缝）。
  let dashLig = null;
  function hasDashLigature() {
    const s = document.createElement('span');
    s.textContent = '——';
    s.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre';
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width / parseFloat(getComputedStyle(s).fontSize || 12);
    s.remove();
    return w < 1.85;            // 连字生效约 1.68 em；不生效则是 2 em
  }
  function joinDashes(root) {
    if (dashLig === null) dashLig = hasDashLigature();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('.math, .katex, code, script, style, .spark')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      const v = n.nodeValue;
      const at = v.indexOf('——');
      if (at < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0, i;
      while ((i = v.indexOf('——', last)) >= 0) {
        if (i > last) frag.appendChild(document.createTextNode(v.slice(last, i)));
        const s = document.createElement('span');
        s.className = dashLig ? 'em' : 'em nj';
        s.append('—');
        const t = document.createElement('i');
        t.textContent = '—';
        s.appendChild(t);
        frag.appendChild(s);
        last = i + 2;
      }
      if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  // 段内既有文字又有离心公式时，公式降为行内，整句连读。
  // 例外：公式在段首、后面只跟一句短说明（「当且仅当…时取等，其中…」）时，
  // 保留成「公式行」——整行居中、公式按 displaystyle 排，与 a=b 那条不等式链同一版式。
  function demote(text) {
    text.querySelectorAll('p').forEach(p => {
      if (p.closest('td,th')) return;
      const ms = [...p.querySelectorAll('span.math.display')];
      if (!ms.length) return;
      const probe = p.cloneNode(true);
      probe.querySelectorAll('.math').forEach(m => m.remove());
      const rest = probe.textContent.replace(/\s/g, '');
      if (rest.length < 4) return;                  // 纯公式：保持 display，独立成行
      const lead = [...p.childNodes].find(n => n.nodeType !== 3 || n.nodeValue.trim());
      if (lead === ms[0] && ms.length === 1 && rest.length <= 44) {
        p.classList.add('eq', 'fline');
        ms[0].classList.remove('display');
        ms[0].classList.add('inline', 'ds');
        // 公式行：原稿常在公式后直接跟「当且仅当…」，公式与说明之间要有一个逗号
        let nx = ms[0].nextSibling;
        while (nx && nx.nodeType !== 3) nx = nx.nextSibling;
        if (nx && /^(当|若|且|则|即|故|其中|由此|从而|于是)/.test(nx.nodeValue.trimStart())) {
          nx.nodeValue = '，' + nx.nodeValue.trimStart();
        }
        return;
      }
      ms.forEach(m => { m.classList.remove('display'); m.classList.add('inline'); });
    });
  }

  // 行内（textstyle）分式在 Chrome 打印时分子会被压到横线上：文字版的 a+b/2 里
  // 横线几乎穿过加号。把顶层的 \frac 升级为 \dfrac（分子分母回到整字号、留出空隙），
  // 嵌在括号或上下标里的分式保持原样，免得字号层层放大。
  function inlineFrac(tex) {
    let out = '', depth = 0;
    for (let i = 0; i < tex.length; i++) {
      const c = tex[i];
      if (c === '\\') {
        if (depth === 0 && tex.startsWith('\\frac', i) && !/[A-Za-z]/.test(tex[i + 5] || '')) {
          out += '\\dfrac'; i += 4; continue;
        }
        out += c + (tex[i + 1] || ''); i++; continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      out += c;
    }
    return out;
  }

  // 源稿里手打的「p＝m/(M+m)」这类纯文本公式：转成 TeX 交给 KaTeX，
  // 否则字距、斜体、分式全是错的。只处理不含中文、形态明确的串，避免误伤散文。
  function plainToTex(s, frac = true) {
    let t = s.replace(/＝/g, '=').replace(/′/g, "'").replace(/²/g, '^2').replace(/³/g, '^3');
    // 行文中的「1/x」保留斜杠更紧凑；独立公式才排成上下两层的分式
    if (frac) t = t.replace(/([A-Za-z0-9()^']+)\s*\/\s*(\([^()]*\)(?:\^?\d)?|[A-Za-z0-9^']+)/g, '\\frac{$1}{$2}');
    return t;
  }
  function plainMath(text) {
    const onlyFormula = /^[A-Za-z0-9'′()=＝/().+\-²³\s]+$/;
    [...text.querySelectorAll('p')].forEach(p => {
      if (p.closest('td,th') || p.querySelector('.math, img, .katex')) return;
      const t = p.textContent.trim();
      if (!t || t.length > 42 || /[\u4e00-\u9fff]/.test(t)) return;
      if (!/[=＝]/.test(t) || !/[A-Za-z]/.test(t) || !onlyFormula.test(t)) return;
      const s = document.createElement('span');
      s.className = 'math display';
      s.textContent = plainToTex(t);
      p.textContent = '';
      p.appendChild(s);
      p.classList.add('eq', 'noindent');
    });
    // 正文里夹着的「f(x)＝1/x」：只认「字母(参数)＝…」这种带函数记号的形状
    const inline = /([A-Za-z][A-Za-z0-9'′]*\([A-Za-z0-9,\s]*\)\s*[=＝]\s*[A-Za-z0-9/().+\-²³]+)/g;
    const w = document.createTreeWalker(text, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('.math, .katex, code, td, th') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      const v = n.nodeValue;
      if (!/[=＝]/.test(v) || !/[A-Za-z]/.test(v)) continue;
      let last = 0, m, out = null;
      inline.lastIndex = 0;
      while ((m = inline.exec(v))) {
        out = out || document.createDocumentFragment();
        if (m.index > last) out.appendChild(document.createTextNode(v.slice(last, m.index)));
        const s = document.createElement('span');
        s.className = 'math inline';
        s.dataset.plain = '1';        // 行文中的小分式，保持 textstyle，不要升成 \dfrac
        s.textContent = plainToTex(m[1], false);
        out.appendChild(s);
        last = m.index + m[0].length;
      }
      if (out) {
        if (last < v.length) out.appendChild(document.createTextNode(v.slice(last)));
        n.parentNode.replaceChild(out, n);
      }
    }
  }

  // 单位必须正体：源稿写成 \ m/s、\ m，KaTeX 会按变量排成斜体
  const UNITS = /(\\[ ,;]|\\quad\s*)((?:km|dm|cm|mm|nm|kg|mg|mol|mL|kHz|MHz|kPa|MPa|kJ|kW|Hz|Pa|J|W|N|K|V|A|m|s|h|g|L)(?:\s*\/\s*(?:s|h|min|m|mol|L|kg))?(?:\^[23])?)(?![A-Za-z0-9])/g;
  function uprightUnits(tex) {
    return tex.replace(UNITS, (all, sp, u) => sp + '\\mathrm{' + u.replace(/\s+/g, '') + '}');
  }

  function math(text) {
    plainMath(text);
    joinConnectors(text);
    splitMathProse(text);
    demote(text);
    text.querySelectorAll('span.math').forEach(s => {
      const tex = s.textContent;
      // 表格里的裸数字是数据，不是公式：留作文本，跟表内字体一致。
      // 正文里的则必须交给 KaTeX——否则「−1、1、2」这种会掉回正文字体，
      // 跟前后 p = -1 的字形对不上
      if (s.closest('td,th') && /^[-+]?\d+(?:\.\d+)?$/.test(tex.trim())) { s.replaceWith(document.createTextNode(tex.trim())); return; }
      const inCell = !!s.closest('td,th');
      const display = s.classList.contains('display') && !inCell;
      // ds：公式行里的公式——行内排但按 displaystyle 取大号分式
      const source = display ? tex : (s.classList.contains('ds') ? '\\displaystyle ' + inlineFrac(tex) : (s.dataset.plain ? tex : inlineFrac(tex)));
      try {
        katex.render(uprightUnits(source), s, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
        report.math++;
      } catch (e) { report.mathErrors.push(tex); }
      if (s.querySelector('.katex-error')) report.mathErrors.push(tex);
    });
    text.querySelectorAll('p').forEach(p => {
      const clone = p.cloneNode(true); clone.querySelectorAll('.math').forEach(m => m.remove());
      if (p.querySelector('.math.display') && !p.closest('td,th') && !p.classList.contains('led') && clone.textContent.trim().length < 40) p.classList.add('eq');
    });
    // 紧跟在「∴ / 即」行后面的那条无标签公式（推导的收尾），跟着公式列走，不单独居中；
    // 连续几条公式（一列推导链）也统一左对齐，避免每条各自居中、等号来回跳
    text.querySelectorAll('p.eq').forEach(p => {
      const pv = p.previousElementSibling;
      if (pv && pv.tagName === 'P' && pv.classList.contains('led')) p.classList.add('cont');
      // 「∴式子：」「分子：」这类以冒号收尾的引出句，后面那条公式跟着它缩进
      if (pv && pv.tagName === 'P' && !pv.classList.contains('eq')
          && /[：:]\s*$/.test(pv.textContent.trim()) && pv.textContent.trim().length <= 14) {
        p.classList.add('cont');
      }
      if (pv && pv.tagName === 'P' && (pv.classList.contains('eq') || pv.classList.contains('led'))) p.classList.add('chain');
    });
  }

  // trailing 注释 block → .notes (small type, hanging numbers), never verse styling
  function endnotes(text) {
    const tops = [...text.querySelectorAll(':scope > p')];
    const at = tops.findIndex(p => /^注\s*释?\s*[:：]/.test(p.textContent.trim()));
    if (at < 0) return;
    const head = tops[at];
    const raw = head.textContent.trim();
    const label = /^注\s*释/.test(raw) ? '注释' : '注';
    const mHead = raw.match(/^注\s*释?\s*[:：]\s*/);
    const carried = mHead ? raw.slice(mHead[0].length).trim() : raw.replace(/^注\s*释?\s*[:：]?/, '').trim();

    const box = document.createElement('div'); box.className = 'notes';
    head.before(box);

    const lab = document.createElement('p'); lab.className = 'notes-label'; lab.textContent = label;
    box.appendChild(lab);

    // strip the leading "1－" marker from a paragraph's text nodes and prepend a number span
    const markItem = p => {
      const t = p.textContent.trim();
      const m = t.match(/^(\d{1,2})\s*[－—–\-、.．]\s*/);
      p.classList.add('note-item');
      if (!m) return;
      let remain = m[0].length;
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let nd;
      while (remain > 0 && (nd = w.nextNode())) {
        const s = nd.nodeValue;
        const take = Math.min(remain, s.length);
        nd.nodeValue = s.slice(take);
        remain -= take;
      }
      const n = document.createElement('span'); n.className = 'n'; n.textContent = m[1];
      p.insertBefore(n, p.firstChild);
    };

    if (carried) {
      const p = document.createElement('p'); p.textContent = carried;
      box.appendChild(p); markItem(p);
    }
    head.remove();
    tops.slice(at + 1).forEach(p => { box.appendChild(p); markItem(p); });
    // paragraphs without a number are continuations of the item above
    box.querySelectorAll('p.note-item').forEach(p => { if (!p.querySelector('.n')) p.className = 'note-cont'; });
  }

  function structure(text, form) {
    // headings: demote one level
    text.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      const lvl = +h.tagName[1];
      renameEl(h, lvl <= 1 ? 'h2' : 'h3');
    });
    [...text.querySelectorAll('p')].forEach(p => {
      const t = p.textContent.trim();
      if (!t && !p.querySelector('img,.math')) { p.remove(); return; }
      const inCell = !!p.closest('td,th');
      // section numbers: "1", "1.", "一", "Part 1" — never inside a table cell ("一", "五" are data there)
      if (!inCell && /^(\d{1,2}[\.．、]?|[一二三四五六七八九十]{1,3})$/.test(t)) { const h = renameEl(p, 'h3'); h.classList.add('num'); h.textContent = t.replace(/[\.．、]$/, ''); return; }
      // 「Part 1 怪物与精灵之争」这类分段标题：源稿只是斜体正文，按二级标题排
      const part = t.match(/^(?:PART|Part|part)\s*(\d{1,2})\s*[：:.、]?\s*([^。！？]{2,26})$/);
      if (!inCell && part && t.length <= 30) {
        const h = document.createElement('h2');
        h.className = 'part';
        const pn = document.createElement('span'); pn.className = 'pn'; pn.textContent = 'PART ' + part[1];
        const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = part[2].trim();
        h.append(pn, pt);
        p.replaceWith(h);
        return;
      }
      // 「一、认知：…」「二、真相：…」这类分节句：源稿是正文，按二级标题排
      if (!inCell && /^[一二三四五六七八九十]{1,2}[、．.]/.test(t) && t.length <= 30) {
        renameEl(p, 'h2');
        return;
      }
      // 整段加粗（可带行内公式）且短 -> 标题：含公式的是小节(h3)，纯文字的是节(h2)
      const kids = [...p.children].filter(el => el.tagName !== 'IMG');
      const boldish = kids.length > 0
        && kids.every(el => /^(STRONG|B|SPAN)$/.test(el.tagName))
        && kids.some(el => /^(STRONG|B)$/.test(el.tagName));
      if (!inCell && boldish && t.length <= 34) {
        const isSub = !!p.querySelector('.math');
        p.querySelectorAll('span.math.display').forEach(s => { s.classList.remove('display'); s.classList.add('inline'); });
        const h = renameEl(p, isSub ? 'h3' : 'h2');
        h.querySelectorAll('strong, b').forEach(s => s.replaceWith(...s.childNodes));
        return;
      }
      // ①—⑩ 步骤行：按悬挂缩进的列表排，不再并入注释块。
      // 序号单独包一层，才能上色/加字距（否则圆圈数字和正文粘在一起）
      if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(t)) {
        const f = p.firstChild;
        if (f && f.nodeType === 3 && /^[\s\u3000]*[①②③④⑤⑥⑦⑧⑨⑩]/.test(f.nodeValue)) {
          const m = f.nodeValue.match(/^[\s\u3000]*([①②③④⑤⑥⑦⑧⑨⑩])/);
          const s = document.createElement('span');
          s.className = 'num';
          s.textContent = m[1];
          f.nodeValue = f.nodeValue.slice(m[0].length);
          p.insertBefore(s, f);
        }
        p.classList.add('item');
        return;
      }
    });
    // endnotes block: "注释：1－…" plus following "2－…" items -> set as notes, not as verse
    endnotes(text);
    // end mark on last running paragraph: disabled by request
    if (form === 'poem' || form === 'lyrics') {
      text.querySelectorAll('p').forEach(p => { if (/^[ \t]*$/.test(p.textContent)) p.remove(); });
    }
  }

  function stripHead(raw, lines) {
    const targets = (lines || []).map(norm).filter(Boolean);
    let i = 0;
    for (const el of [...raw.children].slice(0, 6)) {
      if (i >= targets.length) break;
      const t = norm(el.textContent);
      if (t && t === targets[i]) { el.remove(); i++; }
      else if (t && targets[i] && (t.includes(targets[i]) || targets[i].includes(t)) && t.length < 80) { el.remove(); i++; }
    }
    if (i < targets.length) report.warnings.push('strip incomplete: ' + raw.dataset.id + ' ' + i + '/' + targets.length);
  }

  // 独立公式超宽会撑破栏宽，进而让 Chrome 在打印时把整本缩小以"适应页面"。
  // 规则：先缩到 0.8 倍；仍放不下就改为通栏（column-span: all）。
  function fitEq(text) {
    text.querySelectorAll('p.eq, p.led').forEach(p => {
      // 公式卡（2-8）里的对齐块必须留在栏内：一旦转成通栏，卡片会被拆成两瓣
      if (p.closest('figure.trigcard')) return;
      const k = p.querySelector('.katex-display > .katex') || p.querySelector('.katex');
      if (!k) return;
      // 行间公式的 .katex 是块级、宽度恒等于栏宽，矩形量到的永远“刚好放得下”；
      // 真正的内容宽度要看 scrollWidth，否则超宽公式会被页边直接裁掉
      const width = () => Math.max(k.scrollWidth, Math.round(k.getBoundingClientRect().width));
      const cs = getComputedStyle(p);
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      // led 行里标签与公式是一个整体（都居中），宽公式要连标签一起算进去才不会顶出栏外
      const lead = p.querySelector('.lead');
      const gut = p.classList.contains('led') && lead
        ? Math.ceil(lead.getBoundingClientRect().width) + 12 : 0;
      let avail = p.clientWidth - pad - 2 * gut - 1;
      let w = width();
      // 缩进（cont / chain）把可用宽度挤窄了，但整幅放得下：
      // 差得不多（缩 10% 以内）就保留对齐、稍收字号；差太多才退回整幅，别把公式压小
      if (w > avail + 0.5 && (p.classList.contains('cont') || p.classList.contains('chain'))
          && w <= p.clientWidth - 1 && avail / w < 0.9) {
        p.classList.remove('cont', 'chain');
        return;
      }
      if (w <= avail) return;
      const s = Math.max(0.8, avail / w);
      k.style.fontSize = (1.05 * s).toFixed(3) + 'em';
      w = width();
      if (w > avail) {
        p.classList.add('wide');
        avail = p.clientWidth - pad - 2 * gut - 1;
        w = width();
        if (w > avail) k.style.fontSize = (1.05 * avail / w).toFixed(3) + 'em';
        report.warnings.push('wide eq: ' + (p.closest('[data-id]') ? p.closest('[data-id]').dataset.id : ''));
      }
    });
  }

  document.querySelectorAll('section.article').forEach(sec => {
    const tpl = sec.querySelector('template.raw');
    const raw = document.createElement('div'); raw.dataset.id = sec.dataset.id;
    raw.appendChild(tpl.content.cloneNode(true));
    unwrapDivs(raw);
    unwrapLists(raw);
    stripHead(raw, JSON.parse(sec.dataset.strip || '[]'));
    const text = sec.querySelector('.text');
    while (raw.firstChild) text.appendChild(raw.firstChild);
    tpl.remove();
    const state = { fig: 0, map: {} };
    figures(text, state, sec.classList.contains('single'));
    figrefs(text, state);
    structure(text, sec.dataset.form);
    cleanText(text);
    tables(text);
    math(text);
    // endnotes of a poem/lyric must not inherit the verse column: pull them back to the body margin
    if (sec.classList.contains('verse')) {
      const nb = text.querySelector('.notes');
      if (nb) text.after(nb);
    }
  });

  window.__report = report;
  document.fonts.ready.then(() => {
    // 破折号要按真实字体量宽度（连字是否被应用），所以放到字体就绪之后
    joinDashes(document.body);
    document.querySelectorAll('section.article .text').forEach(fitEq);
    report.scrollWidth = document.documentElement.scrollWidth;
    report.clientWidth = document.documentElement.clientWidth;
    window.__ready = true;
  });
})();
