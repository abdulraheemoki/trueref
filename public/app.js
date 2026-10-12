/* TrueRef app: everything runs in this browser tab. Nothing is saved or sent,
   except an optional, clearly labelled lookup of reference details on Crossref. */
(function () {
  'use strict';
  const C = window.TrueRefCore;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ---------- styles ----------
  const STYLES = [
    { id: 'harvard-cite-them-right', label: 'Harvard (Cite Them Right)', locale: 'en-GB', numbered: false },
    { id: 'apa', label: 'APA 7th', locale: 'en-US', numbered: false },
    { id: 'chicago-author-date', label: 'Chicago (author-date)', locale: 'en-US', numbered: false },
    { id: 'modern-language-association', label: 'MLA 9th', locale: 'en-US', numbered: false },
    { id: 'ieee', label: 'IEEE', locale: 'en-US', numbered: true },
    { id: 'vancouver', label: 'Vancouver', locale: 'en-US', numbered: true }
  ];
  const styleXml = {};
  const locales = {};
  const ready = Promise.all([
    ...STYLES.map(s => fetch('csl/' + s.id + '.csl').then(r => r.text()).then(t => (styleXml[s.id] = t))),
    ...['en-GB', 'en-US'].map(l => fetch('csl/locales-' + l + '.xml').then(r => r.text()).then(t => (locales[l] = t)))
  ]).catch(() => toast('Could not load referencing styles. Please refresh the page.'));

  $$('.styleSelect').forEach(sel => {
    STYLES.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.label;
      sel.appendChild(o);
    });
  });

  // Preload the PDF reader so it still works offline later
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./vendor/pdf.min.mjs').then(m => {
        m.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
        return m;
      });
    }
    return pdfjsPromise;
  }
  (window.requestIdleCallback || setTimeout)(() => { loadPdfJs().catch(() => {}); fetch('vendor/pdf.worker.min.mjs').catch(() => {}); });

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    kids.flat().forEach(k => k != null && e.append(k.nodeType ? k : document.createTextNode(k)));
    return e;
  }
  function showNotice(node, msg, kind) {
    node.className = 'notice ' + (kind || 'info');
    node.textContent = msg;
    node.hidden = !msg;
  }
  async function copyRich(html, text) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast('Copied. Paste it into your document.');
    } catch (e) {
      const ta = el('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied.'); } catch (e2) { toast('Could not copy. Select the text and copy it yourself.'); }
      ta.remove();
    }
  }
  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent.replace(/\s+\n/g, '\n').trim();
  }

  // ---------- light / dark mode ----------
  const themeBtn = $('#themeBtn');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : sysDark.matches;
  }
  function syncThemeBtn() {
    const dark = isDark();
    document.documentElement.classList.toggle('dark-on', dark);
    themeBtn.setAttribute('aria-pressed', String(dark));
    $('#themeLabel').textContent = dark ? 'Light mode' : 'Dark mode';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('trueref-theme', next); } catch (e) {}
    syncThemeBtn();
  });
  sysDark.addEventListener('change', syncThemeBtn);
  syncThemeBtn();

  // ---------- tabs ----------
  const tabs = $$('nav.tools [role=tab]');
  function selectTab(tab) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (j !== null) { e.preventDefault(); tabs[j].focus(); selectTab(tabs[j]); }
    });
  });

  // ---------- reading files (in the browser only) ----------
  async function readFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.docx')) {
      const buf = await file.arrayBuffer();
      const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return { text: res.value.replace(/\n{3,}/g, '\n\n'), kind: 'Word' };
    }
    if (name.endsWith('.pdf')) {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      let out = '';
      let chars = 0;
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        let lastY = null, line = '', lines = [];
        tc.items.forEach(it => {
          const y = Math.round(it.transform[5]);
          if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
          line += it.str;
          if (it.hasEOL) { lines.push(line); line = ''; lastY = null; return; }
          lastY = y;
        });
        if (line) lines.push(line);
        lines = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l && !/^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(l));
        chars += lines.join('').length;
        out += lines.join('\n') + '\n\n';
      }
      if (chars < 40 * doc.numPages) {
        return { text: out, kind: 'PDF', warning: 'This PDF seems to be a scan (a picture of pages), so there is little text to read. Upload the Word version or paste your text instead.' };
      }
      return { text: out, kind: 'PDF', warning: 'PDFs can come out a little jumbled. Glance over the boxes below and fix anything that looks broken before checking.' };
    }
    return { text: await file.text(), kind: 'text' };
  }
  function setupDrop(zone, input, onFile) {
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
  }

  // =========================================================
  // CHECK MY WORK
  // =========================================================
  const checkNotice = $('#checkNotice');
  setupDrop($('.dropzone[data-target=check]'), $('#fileCheck'), async file => {
    showNotice(checkNotice, 'Reading ' + file.name + '…');
    try {
      const r = await readFile(file);
      const parts = C.splitDocument(r.text);
      $('#essay').value = parts.essay.trim();
      $('#refs').value = parts.references;
      let msg = parts.found
        ? 'Read ' + file.name + '. Your reference list was found under "' + parts.heading + '". Check both boxes look right, then press "Check my references".'
        : 'Read ' + file.name + ', but we could not find a heading like "References". Move your reference list into the second box.';
      if (r.warning) msg += ' ' + r.warning;
      showNotice(checkNotice, msg, parts.found && !/scan/.test(r.warning || '') ? 'info' : 'warn');
    } catch (e) {
      showNotice(checkNotice, 'Could not read that file. Try a .docx or .pdf, or paste your text instead.', 'error');
    }
  });

  $('#essay').addEventListener('paste', () => setTimeout(() => {
    // If someone pastes a whole assignment into the essay box, offer to split it
    const v = $('#essay').value;
    if ($('#refs').value.trim()) return;
    const parts = C.splitDocument(v);
    if (parts.found && parts.references.length > 40) {
      $('#essay').value = parts.essay.trim();
      $('#refs').value = parts.references;
      showNotice(checkNotice, 'We moved your reference list into its own box. Check both boxes look right.');
    }
  }, 0));

  const SEV_LABEL = { high: 'Check this', medium: 'Worth a look', low: 'Style tip' };
  let lastIssues = [];
  let activeFilter = 'all';

  $('#runCheck').addEventListener('click', runCheck);
  function runCheck() {
    const essay = $('#essay').value;
    const refs = $('#refs').value;
    if (!essay.trim() && !refs.trim()) {
      showNotice(checkNotice, 'Paste your essay and reference list, or upload your file first.', 'warn');
      return;
    }
    if (!essay.trim()) { showNotice(checkNotice, 'Paste your essay into the first box.', 'warn'); return; }
    showNotice(checkNotice, '');
    const res = C.check(essay, refs, $('#checkStyle').value);
    lastIssues = res.issues;
    activeFilter = 'all';
    renderCheck(res);
  }

  function renderCheck(res) {
    const box = $('#checkResults');
    box.hidden = false;
    const n = res.issues.length;
    const s = res.stats;
    $('#sumLine').textContent = n === 0
      ? 'Everything lines up.'
      : n + (n === 1 ? ' thing' : ' things') + ' to check in ' + res.style + '.';
    const counts = $('#sumCounts');
    counts.replaceChildren(
      el('span', { text: s.citations + ' citation' + (s.citations === 1 ? '' : 's') + ' found in your text' }),
      el('span', { text: s.references + ' reference' + (s.references === 1 ? '' : 's') + ' in your list' }),
      el('span', { text: s.matchedReferences + ' of ' + s.references + ' references cited' }),
      s.quotes ? el('span', { text: s.quotes + ' direct quotation' + (s.quotes === 1 ? '' : 's') }) : null
    );

    const groups = [
      ['all', 'All'],
      ['high', SEV_LABEL.high],
      ['medium', SEV_LABEL.medium],
      ['low', SEV_LABEL.low]
    ];
    const filters = $('#filters');
    filters.replaceChildren();
    if (n > 3) {
      groups.forEach(([k, lab]) => {
        const count = k === 'all' ? n : res.issues.filter(i => i.severity === k).length;
        if (!count) return;
        const chip = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === activeFilter) }, lab + ' (' + count + ')');
        chip.addEventListener('click', () => { activeFilter = k; renderIssues(); $$('.chip', filters).forEach(c => c.setAttribute('aria-pressed', String(c === chip))); });
        filters.append(chip);
      });
    }
    renderIssues();
    if (n === 0) {
      $('#issueList').replaceChildren(el('li', { class: 'allgood' },
        svgTick(),
        el('div', null, s.citations
          ? 'Every citation we found matches your reference list, and every reference is cited. Nice work.'
          : 'We could not find any citations like (Smith, 2020) or Smith (2020) in your text. Check the essay box contains your writing.')));
    }
    const sum = $('#sumLine');
    sum.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function svgTick() {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('width', '24'); s.setAttribute('height', '24'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M3 8.5l3 3 7-7'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
    s.append(p);
    return s;
  }
  function renderIssues() {
    const list = $('#issueList');
    list.replaceChildren();
    lastIssues.filter(i => activeFilter === 'all' || i.severity === activeFilter).forEach(i => {
      const body = el('div', null,
        el('h3', null, el('span', { class: 'sev', text: SEV_LABEL[i.severity] }), i.title),
        el('p', { text: i.detail })
      );
      if (i.context) {
        body.append(el('div', { class: 'excerpt' },
          el('span', { class: 'src', text: 'In your essay' }),
          i.context.before, el('mark', { text: i.context.match }), i.context.after));
      }
      if (i.refRaw) {
        body.append(el('div', { class: 'excerpt' }, el('span', { class: 'src', text: 'In your reference list' }), i.refRaw));
      }
      if (i.refRaws) {
        i.refRaws.forEach(r => body.append(el('div', { class: 'excerpt' }, el('span', { class: 'src', text: 'Out of place' }), r)));
        body.append(el('p', { style: 'margin-top:8px' }, el('button', { class: 'linkbtn', type: 'button', onclick: sendToFix }, 'Fix the order in "Fix my reference list"')));
      }
      list.append(el('li', { class: 'issue ' + i.severity }, el('span', { class: 'bar', 'aria-hidden': 'true' }), body));
    });
  }
  function sendToFix() {
    $('#fixInput').value = $('#refs').value;
    const map = { harvard: 'harvard-cite-them-right', apa: 'apa', chicago: 'chicago-author-date' };
    $('#fixStyle').value = map[$('#checkStyle').value] || 'harvard-cite-them-right';
    selectTab($('#tab-fix'));
    $('#tab-fix').focus();
    runFix();
  }

  $('#tryExample').addEventListener('click', () => {
    $('#checkStyle').value = 'harvard';
    $('#essay').value = 'Transformational leadership has been linked to higher engagement (Bass and Riggio, 2006). According to Saks (2006), engagement is distinct from commitment. Later research found that "engaged employees are more productive and less likely to leave" (Bakker et al., 2008). However, Schaufeli & Bakker (2004) argue that burnout and engagement are opposites. Other studies support this (Smith, 2019; Jones and Brown, 2020, p. 45). Rich et al. (2010) tested this empirically.';
    $('#refs').value = [
      "Bakker, A.B., Schaufeli, W.B., Leiter, M.P. and Taris, T.W. (2008) 'Work engagement: an emerging concept in occupational health psychology', Work & Stress, 22(3), pp. 187-200. doi:10.1080/02678370802393649.",
      'Bass, B.M. and Riggio, R.E. (2006) Transformational leadership. 2nd edn. Mahwah, NJ: Lawrence Erlbaum Associates.',
      "Saks, A.M. (2006) 'Antecedents and consequences of employee engagement', Journal of Managerial Psychology, 21(7), pp. 600-619.",
      "Schaufeli, W.B. and Bakker, A.B. (2004) 'Job demands, job resources, and their relationship with burnout and engagement', Journal of Organizational Behavior, 25(3), pp. 293-315.",
      "Rich, B.L., LePine, J.A. and Crawford, E.R. (2010) 'Job engagement: antecedents and effects on job performance', Academy of Management Journal, 53(3), pp. 617-635.",
      'Jones, P. and Brown, S. (2021) Hybrid working. London: Kogan Page.',
      'Taylor, F.W. (1911) The principles of scientific management. New York: Harper & Brothers.'
    ].join('\n');
    showNotice(checkNotice, 'This example has a few deliberate mistakes. Press "Check my references" to see what TrueRef finds.');
  });

  // =========================================================
  // CSL rendering
  // =========================================================
  const CSL_KEYS = ['type', 'author', 'editor', 'title', 'container-title', 'collection-title', 'volume', 'issue', 'page', 'publisher', 'publisher-place', 'DOI', 'URL', 'edition', 'issued', 'accessed', 'genre', 'number'];
  function toCSL(item, id) {
    const o = { id };
    CSL_KEYS.forEach(k => {
      let v = item[k];
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v) && (k === 'title' || k === 'container-title' || k === 'collection-title')) v = v[0];
      if (Array.isArray(v) && !v.length) return;
      o[k] = v;
    });
    if (!o.type) o.type = 'document';
    return o;
  }
  function render(styleId, items, order) {
    const st = STYLES.find(s => s.id === styleId);
    const map = {};
    items.forEach(it => (map[it.id] = it));
    const engine = new window.CSL.Engine({
      retrieveLocale: l => locales[l] || locales['en-US'],
      retrieveItem: id => map[id]
    }, styleXml[styleId], st.locale, true);
    engine.setOutputFormat('html');
    engine.updateItems(order || items.map(i => i.id));
    const bib = engine.makeBibliography();
    const out = { html: bib ? bib[1].join('') : '', entries: bib ? bib[1] : [], numbered: st.numbered };
    out.cite = id => engine.makeCitationCluster([{ id }]);
    return out;
  }
  function entriesToClipboard(entries) {
    const html = entries.map(e => '<p>' + e.replace(/<\/?div[^>]*>/g, '').trim() + '</p>').join('');
    const text = entries.map(e => htmlToText(e)).join('\n');
    return { html, text };
  }

  // =========================================================
  // FIX MY REFERENCE LIST
  // =========================================================
  const fixNotice = $('#fixNotice');
  setupDrop($('.dropzone[data-target=fix]'), $('#fileFix'), async file => {
    showNotice(fixNotice, 'Reading ' + file.name + '…');
    try {
      const r = await readFile(file);
      const parts = C.splitDocument(r.text);
      $('#fixInput').value = parts.found ? parts.references : r.text.trim();
      let msg = parts.found ? 'Took the reference list from ' + file.name + '. Your essay was left alone.' : 'Read ' + file.name + '. If it includes more than your references, delete the extra text.';
      if (r.warning) msg += ' ' + r.warning;
      showNotice(fixNotice, msg, r.warning ? 'warn' : 'info');
    } catch (e) {
      showNotice(fixNotice, 'Could not read that file. Try a .docx or .pdf, or paste your list instead.', 'error');
    }
  });

  let fixItems = [];
  $('#runFix').addEventListener('click', runFix);
  $('#fixStyle').addEventListener('change', () => fixItems.length && renderFixOutput());

  async function runFix() {
    await ready;
    const text = $('#fixInput').value;
    const parts = C.splitDocument(text);
    const listText = parts.found ? parts.references : text;
    const entries = C.splitReferenceList(listText);
    if (!entries.length) {
      showNotice(fixNotice, 'Paste your reference list first, one reference per line.', 'warn');
      return;
    }
    showNotice(fixNotice, '');
    fixItems = entries.map((raw, i) => {
      const p = C.parseEntry(raw);
      p.id = 'ref' + i;
      p.order = i;
      return p;
    });
    $('#fixResults').hidden = false;
    renderEntries();
    renderFixOutput();
    if ($('#fixOnline').checked) await lookupAll();
    $('#fixResults').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  const TYPE_LABELS = { 'article-journal': 'Journal article', book: 'Book', chapter: 'Book chapter', webpage: 'Web page', report: 'Report', document: 'Other' };
  function namesToText(arr) {
    return (arr || []).map(a => a.literal ? a.literal : (a.family || '') + (a.given ? ', ' + a.given : '')).join('\n');
  }
  function textToNames(t) {
    return t.split(/\n|;/).map(s => s.trim()).filter(Boolean).map(s => {
      const i = s.indexOf(',');
      if (i > 0) return { family: s.slice(0, i).trim(), given: s.slice(i + 1).trim() };
      return { literal: s };
    });
  }
  function dateToText(d) {
    if (!d) return '';
    if (d.literal) return d.literal;
    const p = d['date-parts'] && d['date-parts'][0];
    if (!p) return '';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (p.length === 3) return p[2] + ' ' + months[p[1] - 1] + ' ' + p[0];
    if (p.length === 2) return months[p[1] - 1] + ' ' + p[0];
    return String(p[0]);
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function textToDate(t) {
    t = (t || '').trim();
    if (!t) return undefined;
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { 'date-parts': [[+m[1], +m[2], +m[3]]] };
    m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m && MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) > -1) return { 'date-parts': [[+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]]] };
    m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m && MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) > -1) return { 'date-parts': [[+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]]] };
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return { 'date-parts': [[+m[3], +m[2], +m[1]]] };
    m = t.match(/^(\d{4})([a-z])?$/);
    if (m) return { 'date-parts': [[+m[1]]] };
    if (/^n\.?\s?d\.?$|^no date$/i.test(t)) return { literal: 'n.d.' };
    return { literal: t };
  }
  function yearText(item) {
    const d = item.issued;
    if (!d) return '';
    if (d.literal) return d.literal;
    return d['date-parts'] && d['date-parts'][0] ? String(d['date-parts'][0][0]) : '';
  }

  function needsLook(p) {
    return p.confidence !== 'high' && !p._online;
  }

  function renderEntries() {
    const list = $('#entryList');
    list.replaceChildren();
    fixItems.forEach(item => list.append(entryNode(item)));
    const need = fixItems.filter(needsLook).length;
    $('#fixCounts').textContent = fixItems.length + ' references' + (need ? ' · ' + need + ' to check' : ' · all read clearly');
  }

  function entryNode(item) {
    const li = el('li', { class: 'entry' + (needsLook(item) ? ' needs' : '') });
    const conf = item._online ? ['online', 'Details found online'] : item.confidence === 'high' ? ['high', 'Read clearly'] : item.confidence === 'medium' ? ['medium', 'Check the details'] : ['low', 'Needs your help'];
    const editor = buildEditor(item, li);
    const toggle = el('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false' }, 'Edit details');
    toggle.addEventListener('click', () => {
      editor.hidden = !editor.hidden;
      toggle.setAttribute('aria-expanded', String(!editor.hidden));
      if (!editor.hidden) $('input,select,textarea', editor).focus();
    });
    const notes = (item.notes || []).filter(n => !/^Could not work out/.test(n) || item.confidence !== 'high');
    li.append(
      el('div', { class: 'orig', text: item.raw }),
      el('div', { class: 'meta' },
        el('span', { class: 'badge ' + conf[0], text: conf[1] }),
        el('span', { text: TYPE_LABELS[item.type] || 'Other' }),
        notes.length ? el('span', { text: notes.join(' · ') }) : null,
        toggle),
      editor
    );
    if (needsLook(item) && item.confidence === 'low') { editor.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
    return li;
  }

  function buildEditor(item, li) {
    const ed = el('div', { class: 'editor', hidden: true });
    const id = item.id;
    const field = (key, label, cls, value, kind) => {
      const fid = id + '-' + key;
      let input;
      if (kind === 'type') {
        input = el('select', { id: fid });
        Object.keys(TYPE_LABELS).forEach(t => input.append(el('option', { value: t, selected: t === item.type }, TYPE_LABELS[t])));
      } else if (kind === 'names') {
        input = el('textarea', { id: fid, spellcheck: 'false' });
        input.value = value || '';
      } else {
        input = el('input', { type: 'text', id: fid, spellcheck: 'false' });
        input.value = value || '';
      }
      input.addEventListener('input', () => { applyEdit(item, key, input.value); scheduleFixRender(); });
      input.addEventListener('change', () => { applyEdit(item, key, input.value); renderFixOutput(); });
      return el('div', { class: 'f ' + (cls || '') }, el('label', { for: fid, text: label }), input);
    };
    ed.append(
      field('type', 'Type', 'half', item.type, 'type'),
      field('year', 'Year', 'half', yearText(item)),
      field('author', 'Authors (one per line: Surname, First names)', 'wide', namesToText(item.author), 'names'),
      field('title', 'Title', 'wide', item.title),
      field('container-title', 'Journal, book or website name', 'wide', Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title']),
      field('editor', 'Editors (for a chapter)', 'wide', namesToText(item.editor), 'names'),
      field('volume', 'Volume', 'sixth', item.volume),
      field('issue', 'Issue', 'sixth', item.issue),
      field('page', 'Pages', 'third', item.page),
      field('edition', 'Edition', 'third', item.edition),
      field('publisher-place', 'Place', 'third', item['publisher-place']),
      field('publisher', 'Publisher', 'third', item.publisher),
      field('DOI', 'DOI', 'third', item.DOI),
      field('URL', 'Web address', 'half', item.URL),
      field('accessed', 'Date accessed', 'half', dateToText(item.accessed))
    );
    return ed;
  }
  function applyEdit(item, key, v) {
    if (key === 'author' || key === 'editor') item[key] = textToNames(v);
    else if (key === 'year') item.issued = textToDate(v);
    else if (key === 'accessed') item.accessed = textToDate(v);
    else item[key] = v.trim();
    item._edited = true;
  }
  let fixTimer;
  function scheduleFixRender() { clearTimeout(fixTimer); fixTimer = setTimeout(renderFixOutput, 250); }

  function renderFixOutput() {
    if (!styleXml[$('#fixStyle').value]) return;
    const styleId = $('#fixStyle').value;
    const st = STYLES.find(s => s.id === styleId);
    const items = fixItems.map(it => toCSL(it, it.id));
    let out;
    try {
      out = render(styleId, items, st.numbered ? fixItems.slice().sort((a, b) => a.order - b.order).map(i => i.id) : null);
    } catch (e) {
      $('#fixOutput').textContent = 'Something in one of the references stopped the list being formatted. Check the details of the highlighted references.';
      return;
    }
    const o = $('#fixOutput');
    o.className = 'output' + (st.numbered ? ' numbered' : '');
    o.innerHTML = out.html; // produced by citeproc, which escapes all field text
    $('#fixOutTitle').textContent = 'Your reference list in ' + st.label;
    $('#fixOrderNote').textContent = st.numbered
      ? 'Numbered styles list sources in the order you first cite them, so we kept your original order. Make sure it matches your essay.'
      : 'Sorted alphabetically by author, as ' + st.label + ' requires.';
    $('#copyFix').onclick = () => { const c = entriesToClipboard(out.entries); copyRich(c.html, c.text); };
  }

  // ---------- optional online lookup (Crossref) ----------
  const CROSSREF = 'https://api.crossref.org';
  async function crossrefByDoi(doi) {
    const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
    const r = await fetch(CROSSREF + '/works/' + encodeURIComponent(clean) + '/transform/application/vnd.citationstyles.csl+json', { referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!r.ok) throw new Error('not found');
    return r.json();
  }
  function words(s) { return C.norm(s).split(' ').filter(w => w.length > 2); }
  function similarity(a, b) {
    const A = new Set(words(a)), B = new Set(words(b));
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach(w => B.has(w) && n++);
    return n / Math.max(A.size, B.size);
  }
  async function crossrefSearch(item) {
    const q = item.raw.replace(/https?:\/\/\S+/g, '').slice(0, 300);
    const r = await fetch(CROSSREF + '/works?rows=1&select=DOI,title&query.bibliographic=' + encodeURIComponent(q), { referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!r.ok) return null;
    const j = await r.json();
    const hit = j.message && j.message.items && j.message.items[0];
    if (!hit || !hit.title || !item.title) return null;
    if (similarity(hit.title[0], item.title) < 0.8) return null;
    return hit.DOI;
  }
  function mergeOnline(item, csl) {
    ['type', 'author', 'editor', 'title', 'container-title', 'volume', 'issue', 'page', 'publisher', 'publisher-place', 'DOI', 'issued'].forEach(k => {
      let v = csl[k];
      if (Array.isArray(v) && (k === 'title' || k === 'container-title')) v = v[0];
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) item[k] = v;
    });
    if (csl.type === 'journal-article') item.type = 'article-journal';
    if (item.issued && item.issued['date-parts']) item.issued = { 'date-parts': [[item.issued['date-parts'][0][0]]] };
    if (item.author) item.author = item.author.map(a => (a.literal ? { literal: a.literal } : { family: a.family, given: a.given }));
    item._online = true;
  }
  async function lookupAll() {
    const todo = fixItems.filter(i => !i._online && !i._edited && (i.DOI || i.type !== 'webpage') && i.title);
    if (!todo.length) return;
    showNotice(fixNotice, 'Looking up ' + todo.length + ' reference' + (todo.length === 1 ? '' : 's') + ' on Crossref…');
    let found = 0, failed = false;
    for (const item of todo) {
      try {
        let doi = item.DOI;
        if (!doi) doi = await crossrefSearch(item);
        if (doi) {
          const csl = await crossrefByDoi(doi);
          mergeOnline(item, csl);
          found++;
        }
      } catch (e) {
        if (e instanceof TypeError) { failed = true; break; }
      }
    }
    renderEntries();
    renderFixOutput();
    showNotice(fixNotice, failed
      ? 'Could not reach Crossref, so we used what was in your list. Check your connection to try again.'
      : 'Found details online for ' + found + ' of ' + todo.length + '. Websites and reports are not on Crossref, so check those yourself.', failed ? 'warn' : 'info');
  }
  $('#fixOnline').addEventListener('change', e => { if (e.target.checked && fixItems.length) lookupAll(); });

  // =========================================================
  // CREATE A REFERENCE
  // =========================================================
  const cFields = ['cType', 'cStyle', 'cAuthors', 'cYear', 'cTitle', 'cContainer', 'cEditors', 'cVolume', 'cIssue', 'cPages', 'cEdition', 'cPlace', 'cPublisher', 'cUrl', 'cAccessed'];
  const CONTAINER_LABEL = { 'article-journal': 'Journal name', chapter: 'Title of the book', webpage: 'Website name', book: '', report: '' };
  const TITLE_LABEL = { 'article-journal': 'Title of the article', book: 'Title of the book', chapter: 'Title of the chapter', webpage: 'Title of the page', report: 'Title of the report' };
  function syncCreateForm() {
    const t = $('#cType').value;
    $$('#createForm [data-for]').forEach(f => (f.hidden = !f.dataset.for.split(' ').includes(t)));
    $('#cTitleLabel').textContent = TITLE_LABEL[t];
    $('#cContainerLabel').textContent = CONTAINER_LABEL[t] || 'Published in';
    $('#cUrlHint').textContent = t === 'webpage' ? '' : '(if you read it online)';
  }
  function createItem() {
    const t = $('#cType').value;
    const item = {
      id: 'new',
      type: t,
      author: textToNames($('#cAuthors').value),
      issued: textToDate($('#cYear').value),
      title: $('#cTitle').value.trim()
    };
    const vis = id => !$('#' + id).closest('.f').hidden;
    const put = (id, key) => { const v = $('#' + id).value.trim(); if (v && vis(id)) item[key] = v; };
    put('cContainer', 'container-title');
    put('cVolume', 'volume');
    put('cIssue', 'issue');
    put('cPages', 'page');
    put('cEdition', 'edition');
    put('cPlace', 'publisher-place');
    put('cPublisher', 'publisher');
    put('cUrl', 'URL');
    const doi = $('#cDoi').value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    if (doi) item.DOI = doi;
    if (vis('cEditors')) item.editor = textToNames($('#cEditors').value);
    if (vis('cAccessed') && $('#cAccessed').value.trim()) item.accessed = textToDate($('#cAccessed').value);
    return item;
  }
  let cCurrent = null;
  async function renderCreate() {
    syncCreateForm();
    await ready;
    const item = createItem();
    const out = $('#cOutput');
    if (!item.title && !item.author.length) {
      out.replaceChildren(el('p', { class: 'hint', text: 'Start filling in the form and your reference appears here.' }));
      $('#cInText').textContent = '';
      cCurrent = null;
      return;
    }
    try {
      const r = render($('#cStyle').value, [toCSL(item, 'new')]);
      out.innerHTML = r.html;
      cCurrent = { item, entries: r.entries };
      const cite = r.cite('new');
      $('#cInText').replaceChildren('In your text: ', el('code', { text: htmlToText(cite) }));
    } catch (e) {
      out.replaceChildren(el('p', { class: 'hint', text: 'Keep filling in the form.' }));
    }
  }
  cFields.forEach(id => $('#' + id).addEventListener('input', renderCreate));
  ['cType', 'cStyle'].forEach(id => $('#' + id).addEventListener('change', () => { renderCreate(); renderCreateList(); }));
  syncCreateForm();

  $('#cDoiFill').addEventListener('click', async () => {
    const notice = $('#cDoiNotice');
    const doi = $('#cDoi').value.trim();
    if (!/10\.\d{4,9}\//.test(doi)) { showNotice(notice, 'That does not look like a DOI. A DOI starts with 10. followed by numbers and a slash.', 'warn'); return; }
    showNotice(notice, 'Looking up the DOI…');
    try {
      const csl = await crossrefByDoi(doi.match(/10\.\d{4,9}\/\S+/)[0]);
      const type = csl.type === 'journal-article' || csl.type === 'article-journal' ? 'article-journal' : csl.type === 'book-chapter' || csl.type === 'chapter' ? 'chapter' : csl.type === 'book' || csl.type === 'monograph' ? 'book' : csl.type === 'report' ? 'report' : 'article-journal';
      $('#cType').value = type;
      $('#cAuthors').value = namesToText((csl.author || []).map(a => (a.literal ? { literal: a.literal } : { family: a.family, given: a.given })));
      $('#cEditors').value = namesToText(csl.editor || []);
      const yr = csl.issued && csl.issued['date-parts'] && csl.issued['date-parts'][0] ? csl.issued['date-parts'][0][0] : '';
      $('#cYear').value = yr || '';
      const first = v => (Array.isArray(v) ? v[0] : v) || '';
      $('#cTitle').value = first(csl.title);
      $('#cContainer').value = first(csl['container-title']);
      $('#cVolume').value = csl.volume || '';
      $('#cIssue').value = csl.issue || '';
      $('#cPages').value = csl.page || '';
      $('#cPublisher').value = csl.publisher || '';
      $('#cPlace').value = csl['publisher-place'] || '';
      $('#cDoi').value = csl.DOI || doi;
      showNotice(notice, 'Filled in from Crossref. Check the details look right.');
      renderCreate();
    } catch (e) {
      showNotice(notice, e instanceof TypeError ? 'Could not reach Crossref. Check your internet connection, or fill in the form yourself.' : 'We could not find that DOI. Check it is typed correctly, or fill in the form yourself.', 'warn');
    }
  });

  $('#cCopy').addEventListener('click', () => {
    if (!cCurrent) { toast('Fill in the form first.'); return; }
    const c = entriesToClipboard(cCurrent.entries);
    copyRich(c.html, c.text);
  });

  let myList = [];
  $('#cAdd').addEventListener('click', () => {
    if (!cCurrent) { toast('Fill in the form first.'); return; }
    const item = Object.assign({}, cCurrent.item, { id: 'm' + Date.now() });
    myList.push(item);
    renderCreateList();
    toast('Added to your list.');
    ['cAuthors', 'cYear', 'cTitle', 'cContainer', 'cEditors', 'cVolume', 'cIssue', 'cPages', 'cEdition', 'cPlace', 'cPublisher', 'cUrl', 'cAccessed', 'cDoi'].forEach(id => ($('#' + id).value = ''));
    showNotice($('#cDoiNotice'), '');
    renderCreate();
  });
  let listEntries = [];
  async function renderCreateList() {
    await ready;
    const sheet = $('#cListSheet');
    sheet.hidden = !myList.length;
    if (!myList.length) return;
    const styleId = $('#cStyle').value;
    const st = STYLES.find(s => s.id === styleId);
    const r = render(styleId, myList.map(i => toCSL(i, i.id)), st.numbered ? myList.map(i => i.id) : null);
    const box = $('#cList');
    box.className = 'output' + (st.numbered ? ' numbered' : '');
    box.innerHTML = r.html;
    listEntries = r.entries;
    $('#cListCount').textContent = '(' + myList.length + ')';
  }
  $('#cCopyAll').addEventListener('click', () => { const c = entriesToClipboard(listEntries); copyRich(c.html, c.text); });
  $('#cClear').addEventListener('click', () => { myList = []; renderCreateList(); toast('List cleared.'); });
})();
