/*
 * TrueRef core logic.
 * Runs entirely in the browser (or Node for testing). Never sends or stores anything.
 * The essay text is only ever READ. Nothing in this file changes the essay.
 */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const YEAR = '(?:1[5-9]\\d{2}|20\\d{2})[a-z]?';
  const YEAR_OR_ND = '(?:' + YEAR + '|n\\.\\s?d\\.?|no date|forthcoming|in press)';

  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function norm(s) {
    return stripDiacritics(String(s || ''))
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function normYear(y) {
    if (!y) return '';
    y = String(y).toLowerCase().replace(/\s/g, '');
    if (/^n\.?d\.?$|^nodate$/.test(y)) return 'n.d.';
    return y;
  }
  function baseYear(y) {
    return normYear(y).replace(/[a-z]$/, '');
  }
  function cleanText(t) {
    return String(t || '')
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')
      .replace(/[‐‑‒]/g, '-')
      .replace(/\t/g, ' ');
  }
  function snippet(text, start, end, pad) {
    pad = pad || 60;
    let s = Math.max(0, start - pad);
    let e = Math.min(text.length, end + pad);
    if (s > 0) { const sp = text.indexOf(' ', s); if (sp > -1 && sp < start) s = sp + 1; }
    if (e < text.length) { const sp = text.lastIndexOf(' ', e); if (sp > end) e = sp; }
    return {
      before: (s > 0 ? '…' : '') + text.slice(s, start).replace(/\s+/g, ' ').trimStart(),
      match: text.slice(start, end).replace(/\s+/g, ' '),
      after: text.slice(end, e).replace(/\s+/g, ' ').trimEnd() + (e < text.length ? '…' : '')
    };
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // ---------- splitting a whole document ----------
  const HEADING_RE = /^[ \t]*(?:\d+\.?\s*)?(references?|reference list|list of references|bibliography|works cited|sources|cited works)[ \t]*:?[ \t]*$/gim;

  function splitDocument(text) {
    text = cleanText(text);
    let m, last = null;
    HEADING_RE.lastIndex = 0;
    while ((m = HEADING_RE.exec(text))) last = { index: m.index, end: m.index + m[0].length, heading: m[1] };
    if (!last) return { essay: text, references: '', found: false };
    let refs = text.slice(last.end);
    // Stop at appendices if present
    const app = refs.search(/^[ \t]*(appendix|appendices)\b.*$/im);
    if (app > -1) refs = refs.slice(0, app);
    return { essay: text.slice(0, last.index), references: refs.trim(), found: true, heading: last.heading };
  }

  // ---------- splitting a reference list into entries ----------
  function looksLikeEntryStart(line) {
    const l = line.trim();
    if (!l) return false;
    if (/^(\[\d+\]|\d+[.)])\s+/.test(l)) return true; // numbered
    if (!/^[A-ZÀ-ɏ'’"“‘]/.test(l)) return false;
    const head = l.slice(0, 220);
    // Needs a year/n.d. near the start, or the classic "Surname, I." opening
    if (new RegExp('\\(\\s*' + YEAR_OR_ND + '\\s*[),]', 'i').test(head)) return true;
    if (new RegExp('\\.\\s' + YEAR_OR_ND + '\\.', 'i').test(head)) return true;
    if (/^[A-Z][\p{L}'’-]+(?:\s[\p{L}'’-]+)?,\s(?:[A-Z]\.\s?)+/u.test(l)) return true;
    return false;
  }

  function splitReferenceList(text) {
    text = cleanText(text).trim();
    if (!text) return [];
    let lines = text.split('\n').map(l => l.replace(/\s+$/, ''));
    // If the list is separated by blank lines and each block looks like a reference, use blocks
    const blocks = text.split(/\n\s*\n/).map(b => b.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    const blockStarts = blocks.filter(looksLikeEntryStart).length;
    let entries;
    if (blocks.length > 1 && blockStarts >= blocks.length * 0.8 && !blocks.some(b => countYears(b) > 3)) {
      entries = blocks;
    } else {
      entries = [];
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const prev = entries[entries.length - 1];
        const strayAfterComplete = prev && /[.)]$/.test(prev) && /^[a-z]/.test(line) && !/^(?:doi|https?:|www\.|available|accessed|retrieved|viewed|in:?\s|pp?\.|vol\.|no\.|edn|ed\.)/i.test(line) && new RegExp(YEAR_OR_ND, 'i').test(prev) && prev.length > 60;
        if (!entries.length || looksLikeEntryStart(line) || strayAfterComplete) entries.push(line);
        else entries[entries.length - 1] += (/-$/.test(entries[entries.length - 1]) ? '' : ' ') + line;
      }
    }
    return entries
      .map(e => e.replace(/^(\[\d+\]|\d+[.)])\s+/, '').replace(/^[•\-–]\s+/, '').trim())
      .filter(e => e.length > 3 && !/^page \d+$/i.test(e));
  }
  function countYears(s) {
    return (s.match(new RegExp('\\(' + YEAR + '\\)', 'g')) || []).length;
  }

  // ---------- parsing author strings ----------
  const PARTICLES = ['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'dos', 'das', 'bin', 'al', 'el', 'ter', 'ten'];
  function isInitials(t) {
    t = t.trim();
    return /^(?:[A-Z][a-z]?\.?[\s-]?){1,4}$/.test(t) && /^(?:[A-Z]\.?[\s-]?){1,4}$|^(?:[A-Z][a-z]?\.[\s-]?){1,4}$/.test(t);
  }
  function splitGivenFamily(full) {
    const words = full.trim().split(/\s+/);
    if (words.length === 1) return { family: words[0] };
    let i = words.length - 1;
    while (i - 1 > 0 && PARTICLES.includes(words[i - 1].toLowerCase())) i--;
    return { given: words.slice(0, i).join(' '), family: words.slice(i).join(' ') };
  }

  function parseAuthors(str) {
    let s = String(str || '')
      .replace(/\((?:eds?|editors?|ed|comp)\.?\)/gi, '')
      .replace(/,?\s*(?:eds?|editors?)\.(?=\s|$)/gi, '')
      .trim()
      .replace(/^[\s,.;]+|[\s,;]+$/g, '')
      .replace(/\.$/, m => m); // keep final period for initials
    if (!s) return [];
    let etal = false;
    if (/\bet\.?\s*al\.?/i.test(s)) {
      etal = true;
      s = s.replace(/,?\s*\bet\.?\s*al\.?/i, '').trim();
    }
    // Organisation acronym in brackets e.g. World Health Organization (WHO)
    const vanc = /^([\p{Lu}][\p{L}'’ -]*?)\s+((?:[A-Z]){1,3})$/u;
    if (!/,/.test(s) && !/\s(?:and|&)\s/.test(s)) {
      const v = s.match(vanc);
      if (v && v[1].split(' ').length <= 3) return withEtal([{ family: v[1], given: v[2] }], etal);
      return withEtal([{ literal: s.replace(/\.$/, '') }], etal);
    }
    // Vancouver list "Smith J, Jones K, Brown L"
    const commaParts = s.split(/\s*,\s*/);
    if (commaParts.length > 1 && commaParts.every(p => vanc.test(p.replace(/^(?:and|&)\s+/, '')))) {
      return withEtal(commaParts.map(p => { const v = p.replace(/^(?:and|&)\s+/, '').match(vanc); return { family: v[1], given: v[2] }; }), etal);
    }
    const noCommaNoInitials = !/,/.test(s);
    if (noCommaNoInitials) {
      // "Smith and Jones" style (rare in lists) or an organisation containing "and"
      const parts = s.split(/\s+(?:and|&)\s+/);
      if (parts.every(p => /^[\p{Lu}][\p{L}'’-]+$/u.test(p))) return withEtal(parts.map(p => ({ family: p })), etal);
      return withEtal([{ literal: s.replace(/\.$/, '') }], etal);
    }
    const tokens = [];
    s.split(/\s*(?:;|,?\s+and\s+|,?\s*&\s*)\s*/).forEach(p => p.split(/\s*,\s*/).forEach(t => { t = t.trim(); if (t) tokens.push(t); }));
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];
      if (next && isInitials(next)) {
        out.push({ family: t, given: next.trim() });
        i++;
      } else if (vanc.test(t) && !/\s/.test(t.replace(vanc, '$1'))) {
        const v = t.match(vanc);
        out.push({ family: v[1], given: v[2] });
      } else if (i === 0 && next && !/\s/.test(t) && /^[\p{Lu}][\p{Ll}]+(?:\s(?:[\p{Lu}][\p{Ll}]+|[\p{Lu}]\.))*\.?$/u.test(next)) {
        // Chicago / MLA first author "Smith, John"
        out.push({ family: t, given: /\b[A-Z]\.$/.test(next) ? next : next.replace(/\.$/, '') });
        i++;
      } else if (/\s/.test(t)) {
        out.push(splitGivenFamily(t.replace(/\.$/, '')));
      } else {
        out.push({ family: t.replace(/\.$/, '') });
      }
    }
    return withEtal(out, etal);
  }
  function fixGiven(g) {
    if (!g) return g;
    g = g.trim();
    if (/^[A-Z]{1,4}$/.test(g)) return g.split('').join('. ') + '.';
    if (/^(?:[A-Z]\.\s?-?)*[A-Z]$/.test(g)) return g + '.';
    return g;
  }
  function withEtal(arr, etal) {
    arr.forEach(a => { if (a.given) a.given = fixGiven(a.given); });
    if (etal) arr.etal = true;
    return arr;
  }
  function authorKey(a) {
    if (!a) return '';
    return norm((a.literal || a.family || '').replace(/\s*\([^)]*\)\s*/g, ' '));
  }
  function acronymOf(a) {
    if (!a || !a.literal) return '';
    const br = a.literal.match(/\(([A-Z]{2,})\)/);
    if (br) return br[1].toLowerCase();
    const words = a.literal.replace(/\([^)]*\)/g, '').split(/\s+/).filter(w => /^[A-Z]/.test(w));
    return words.length >= 2 ? words.map(w => w[0]).join('').toLowerCase() : '';
  }

  // ---------- parsing a single reference entry ----------
  function parseEntry(raw) {
    const s = cleanText(raw).replace(/\s+/g, ' ').trim();
    const item = { raw: s, type: 'document', notes: [] };
    let conf = 0;

    const doiM = s.match(/\b(10\.\d{4,9}\/[^\s"<>]+?)(?=[.,;]?(?:\s|$))/i);
    if (doiM) item.DOI = doiM[1];
    const urlM = s.match(/https?:\/\/[^\s<>]+?(?=[.,;)]?(?:\s|$))/i);
    if (urlM && !/doi\.org/i.test(urlM[0])) item.URL = urlM[0];
    const accM = s.match(/\(?\s*(?:Accessed|Retrieved|viewed)[:\s]+(?:on\s+)?(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\s*\)?/i);
    if (accM) item._accessedText = accM[1];

    // Numbered styles (Vancouver, IEEE) have their own shapes
    const special = parseVancouver(s, item) || parseIEEE(s, item);
    if (special) {
      if (item.year && item.year !== 'n.d.') item.issued = { 'date-parts': [[parseInt(item.year, 10)]] };
      if (item.DOI && item.type === 'document') item.type = 'article-journal';
      item.confidence = item.title && item.author && item.author.length && item.year ? (item.type !== 'document' ? 'high' : 'medium') : 'low';
      return item;
    }

    // Year and author section
    let yearIdx = -1, yearEnd = -1, year = '';
    let m = s.slice(0, 400).match(new RegExp('\\(\\s*(' + YEAR_OR_ND + ')\\s*(?:,[^)]*)?\\)', 'i'));
    if (m) { yearIdx = m.index; yearEnd = m.index + m[0].length; year = m[1]; }
    if (yearIdx < 0) {
      m = s.slice(0, 400).match(new RegExp('\\.\\s(' + YEAR_OR_ND + ')\\.\\s', 'i'));
      if (m) { yearIdx = m.index + 1; yearEnd = m.index + m[0].length; year = m[1]; }
    }
    let authorPart = '', rest = s;
    if (yearIdx >= 0) {
      authorPart = s.slice(0, yearIdx);
      rest = s.slice(yearEnd);
      conf += 1;
    } else {
      // No year in the usual place: take everything up to the first sentence break as authors
      const b = s.match(/^(.+?[a-z\])])\.\s/);
      if (b) { authorPart = b[1]; rest = s.slice(b[0].length); }
      const anyYear = s.match(new RegExp('\\b(' + YEAR + ')\\b'));
      if (anyYear) year = anyYear[1];
      item.notes.push('No year found in the usual place');
    }
    item.year = normYear(year);
    if (item.year && item.year !== 'n.d.') item.issued = { 'date-parts': [[parseInt(item.year, 10)]] };
    if (item.year === 'n.d.') item.issued = { literal: 'n.d.' };

    const authors = parseAuthors(authorPart.replace(/[\s.,]+$/, m2 => (/\.$/.test(m2) && /[A-Z]\.?\s*$/.test(authorPart) ? '.' : '')));
    if (authors.length) { item.author = authors.filter(a => !a.etal); conf += 1; }
    if (authors.etal) item.notes.push('List uses "et al." — full author list is usually needed in a reference list');

    // Title
    rest = rest.replace(/^[\s.,:;)]+/, '');
    let title = '', after = rest;
    const q = rest.match(/^[‘'“"](.+?)[’'”"](?=[\s.,:;]|$)[\s.,:;]*/);
    if (q) {
      title = q[1].replace(/[.,]$/, '');
      after = rest.slice(q[0].length);
      item._quotedTitle = true;
    } else {
      const t = rest.match(/^(.+?[^\s.])([.?!])\s+(?=[A-Z0-9(\[]|In[: ]|Available|Retrieved|https?:)/);
      if (t) { title = t[1] + (t[2] === '.' ? '' : t[2]); after = rest.slice(t[0].length); }
      else { title = rest.replace(/\.\s*$/, ''); after = ''; }
    }
    const edT = title.match(/\s*\((\d+)(?:st|nd|rd|th)\s*(?:ed|edn|edition)\.?\)/i);
    if (edT) { item.edition = edT[1]; title = title.replace(edT[0], ''); }
    if (title) { item.title = title.trim(); conf += 1; }

    // Strip URL / access text from 'after'
    let tail = after
      .replace(/\(?\s*(?:Accessed|Retrieved|viewed)[^)]*\)?\.?/i, '')
      .replace(/(?:Available (?:at|from)|Retrieved from)\s*:?\s*/i, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\bdoi:?\s*10\.\S+/gi, '')
      .replace(/10\.\d{4,9}\/\S+/g, '')
      .replace(/\[(?:online|Online|Internet)\]\.?/g, '')
      .trim();

    const ed = tail.match(/(\d+)(?:st|nd|rd|th)\s*(?:edn|ed|edition)\.?/i);
    if (ed) { item.edition = ed[1]; tail = tail.replace(ed[0], '').trim(); }

    let typed = false;
    // Chapter in edited book
    const ch = tail.match(/^In:?\s+(.+?)\s*\((?:eds?|editors?)\.?\)\s*,?\s*(.+?)[.,]\s*(.*)$/i);
    if (ch) {
      item.type = 'chapter';
      item.editor = parseAuthors(ch[1]);
      const rest2 = ch[2] + '. ' + ch[3];
      const bt = rest2.match(/^(.+?)\.\s+(.*)$/);
      item['container-title'] = (bt ? bt[1] : ch[2]).trim();
      const after2 = bt ? bt[2] : ch[3];
      pubPlace(after2, item);
      const pp = after2.match(/pp?\.?\s*(\d+\s*[-–]\s*\d+)/);
      if (pp) item.page = pp[1].replace(/\s/g, '');
      typed = true; conf += 1;
    }
    // Journal article
    if (!typed) {
      const jr =
        tail.match(/^(?:In:?\s+)?([^,]+?(?:,\s*[^,\d\s(][^,(\d]*?)?),\s*(?:vol(?:ume)?\.?\s*)?(\d+)\s*(?:\(\s*([^)]+?)\s*\))?\s*(?:,\s*(?:no\.?|issue)\s*(\d+))?\s*(?:,\s*(?:pp?\.?\s*)?([eE]?\d+(?:\s*[-–]\s*\d+)?))?/) ||
        tail.match(/^(.+?)\s+(\d+)\s*(?:\(\s*(\d+[^)]*)\s*\))?\s*:\s*()(\d+\s*[-–]\s*\d+|\d+)/) ||
        tail.match(/^(.+?)\s*\.\s*(\d+)\s*\((\d+)\)()\s*,?\s*(?:pp?\.?\s*)?(\d+\s*[-–]\s*\d+)?/);
      if (jr && jr[2] && !/^[A-Z][a-z]+:\s/.test(tail)) {
        item.type = 'article-journal';
        item['container-title'] = jr[1].replace(/^In:?\s+/, '').trim();
        item.volume = jr[2];
        if (jr[3]) item.issue = jr[3];
        else if (jr[4]) item.issue = jr[4];
        if (jr[5]) item.page = jr[5].replace(/\s/g, '').replace('–', '-');
        const ppM = tail.match(/\bpp?\.\s*([eE]?\d+(?:\s*[-–]\s*\d+)?)/);
        if (ppM) item.page = ppM[1].replace(/\s/g, '').replace('–', '-');
        else if (item.page && new RegExp('^' + YEAR + '$').test(item.page)) { if (!item.year) item.year = item.page; delete item.page; }
        typed = true; conf += 1;
      }
    }
    // Book with place: publisher
    if (!typed && pubPlace(tail, item)) {
      item.type = 'book';
      typed = true; conf += 1;
    }
    // Website
    if (!typed && (item.URL || /available at|retrieved from/i.test(after))) {
      item.type = 'webpage';
      const site = tail.replace(/[.\s]+$/, '');
      if (site && site.length < 120) item['container-title'] = site;
      typed = true;
      if (item.URL) conf += 1;
    }
    // Publisher only (APA style books)
    if (!typed && tail && /^[A-Z][^.]{2,80}\.?$/.test(tail) && !/\d/.test(tail)) {
      item.type = 'book';
      item.publisher = tail.replace(/\.$/, '');
      typed = true;
    }
    if (!typed && item.DOI) { item.type = 'article-journal'; }
    if (item.DOI && item.type === 'document') item.type = 'article-journal';
    if (!typed && tail) item.notes.push('Could not work out the source type; extra text: "' + tail.slice(0, 80) + '"');

    if (item._accessedText) {
      const d = parseLooseDate(item._accessedText);
      if (d) item.accessed = { 'date-parts': [d] };
    }
    item.confidence = !item.title || !item.author || !item.year ? 'low' : conf >= 4 ? 'high' : 'medium';
    return item;
  }
  function parseVancouver(s, item) {
    const m = s.match(/^(.+?)\.\s+(.+?[^A-Z])[.?!]\s+(.+)$/);
    if (!m) return false;
    const parts = m[1].split(/\s*,\s*/);
    const nameRe = /^[\p{Lu}][\p{L}'’ -]*\s[A-Z]{1,3}$/u;
    if (!parts.every(p => nameRe.test(p) || /^et al\.?$/i.test(p))) return false;
    item.author = parts.filter(p => nameRe.test(p)).map(p => { const x = p.match(/^(.+)\s([A-Z]{1,3})$/); return { family: x[1], given: fixGiven(x[2]) }; });
    if (parts.some(p => /et al/i.test(p))) item.notes.push('List uses "et al." — full author list is usually needed in a reference list');
    item.title = m[2].trim();
    const rest = m[3];
    const j = rest.match(/^(.+?)\.?\s+(\d{4})(?:\s+[A-Za-z]{3}[^;]*)?;\s*(\d+)?\s*(?:\(([^)]+)\))?\s*(?::\s*([eE]?\d+(?:\s*[-–]\s*\d+)?))?/);
    const bk = rest.match(/^(?:(\d+)(?:st|nd|rd|th)\s+ed\.\s*)?([^:;.]+):\s*([^;]+);\s*(\d{4})/);
    if (j) {
      item.type = 'article-journal';
      item['container-title'] = j[1].trim();
      item.year = j[2];
      if (j[3]) item.volume = j[3];
      if (j[4]) item.issue = j[4];
      if (j[5]) item.page = j[5].replace(/\s/g, '').replace('–', '-');
    } else if (bk) {
      item.type = 'book';
      if (bk[1]) item.edition = bk[1];
      item['publisher-place'] = bk[2].trim();
      item.publisher = bk[3].trim();
      item.year = bk[4];
    } else {
      const y = rest.match(new RegExp('\\b(' + YEAR + ')\\b'));
      if (y) item.year = y[1];
      if (item.URL) item.type = 'webpage';
      else if (y && /^[A-Z][^.;:]+\.?\s+\d{4}\b/.test(rest)) { item.type = 'article-journal'; item['container-title'] = rest.slice(0, y.index).replace(/[.\s]+$/, ''); }
    }
    return true;
  }
  function parseIEEE(s, item) {
    const m = s.match(/^(.+?),\s*[“"](.+?)[,.]?[”"]\s*,?\s*(.*)$/);
    if (!m) return false;
    const names = m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
    const nameRe = /^(?:[A-Z]\.(?:\s?-?[A-Z]\.)*)\s*[\p{Lu}][\p{L}'’ -]+$/u;
    if (!names.every(n => nameRe.test(n) || /^et al\.?$/i.test(n))) return false;
    item.author = names.filter(n => nameRe.test(n)).map(n => { const x = n.match(/^((?:[A-Z]\.\s?-?)+)\s*(.+)$/); return { family: x[2].trim(), given: x[1].trim() }; });
    item.title = m[2].trim();
    const rest = m[3];
    const j = rest.match(/^(?:in\s+)?(.+?),\s*vol\.\s*(\d+)(?:,\s*no\.\s*(\d+))?(?:,\s*pp?\.\s*([\d]+(?:\s*[-–]\s*\d+)?))?/i);
    if (j) {
      item.type = 'article-journal';
      item['container-title'] = j[1].trim();
      item.volume = j[2];
      if (j[3]) item.issue = j[3];
      if (j[4]) item.page = j[4].replace(/\s/g, '').replace('–', '-');
    } else if (/^in\s/i.test(rest)) {
      item.type = 'paper-conference';
      item['container-title'] = rest.replace(/^in\s+/i, '').split(/,\s*(?:\d{4}|pp\.)/)[0].trim();
    } else if (item.URL) item.type = 'webpage';
    const years = rest.match(new RegExp('\\b(' + YEAR + ')\\b', 'g'));
    if (years) item.year = years[years.length - 1];
    return true;
  }
  function pubPlace(text, item) {
    const p = (text || '').match(/(?:^|[.]\s*)([A-Z][\p{L} .'’-]{1,40}?(?:,\s*[A-Z]{2,})?)\s*:\s*([^.:]{2,80}?)\s*(?:\.|$)/u);
    if (p && !/^(In|Available|Accessed|Retrieved)$/.test(p[1].trim())) {
      item['publisher-place'] = p[1].trim();
      item.publisher = p[2].trim();
      return true;
    }
    return false;
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseLooseDate(t) {
    t = t.trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return [+m[1], +m[2], +m[3]];
    m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mo > -1) return [+m[3], mo + 1, +m[1]]; }
    m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mo > -1) return [+m[3], mo + 1, +m[2]]; }
    return null;
  }

  // ---------- finding in-text citations (read-only) ----------
  const LEAD_RE = /^(?:e\.g\.,?|i\.e\.,?|see also|see|cf\.|for example,?|for instance,?|as cited in|cited in|quoted in|adapted from|based on|from)\s+/i;
  const CONNECT = new Set(['and', '&', 'et', 'al', 'al.', 'of', 'the', 'for', 'de', 'van', 'von', 'der', 'den', 'du', 'la', 'le', 'del', 'di', 'da', 'on', 'in']);

  function extractCitations(essay) {
    const text = cleanText(essay);
    const cites = [];
    const parenRe = /\(([^()]{1,400})\)/g;
    let m;
    while ((m = parenRe.exec(text))) {
      const content = m[1];
      if (!new RegExp(YEAR_OR_ND, 'i').test(content)) continue;
      const start = m.index, end = m.index + m[0].length;
      const narrativeStart = new RegExp('^\\s*(' + YEAR_OR_ND + ')\\b', 'i');
      if (narrativeStart.test(content)) {
        // Narrative: Name (2019) / Name (2019, p. 4)
        const before = text.slice(Math.max(0, start - 140), start);
        const name = lookBackName(before);
        if (!name) continue;
        const nameStart = name.idx > -1 ? start - before.length + name.idx : start - name.raw.length - name.gap;
        const yrs = [];
        const yrRe = new RegExp('(' + YEAR_OR_ND + ')', 'gi');
        let y; const yearSection = content.split(/[,:;]\s*(?=p{1,2}\.|para|ch\.|\d+\s*$|\d+\s*[-–]\s*\d+\s*$)/)[0];
        while ((y = yrRe.exec(yearSection))) yrs.push(y[1]);
        const page = hasLocator(content.replace(new RegExp('^\\s*' + YEAR_OR_ND + '\\s*', 'i'), ''));
        yrs.forEach(yr => cites.push(makeCite(name.text, yr, page, 'narrative', nameStart, end, content, text)));
        continue;
      }
      // Parenthetical, possibly several separated by ';'
      const parts = content.split(/\s*;\s*/);
      let offset = 0;
      for (let part of parts) {
        const partIdx = content.indexOf(part, offset);
        offset = partIdx + part.length;
        // secondary referencing "Smith, 1990, cited in Jones, 2019"
        const sec = part.split(/,?\s+(?:as\s+)?(?:cited|quoted)\s+in\s+/i);
        sec.forEach((p, si) => {
          p = p.replace(LEAD_RE, '').replace(LEAD_RE, '').trim();
          const ym = p.match(new RegExp('^(.*?)[,\\s]+(' + YEAR_OR_ND + ')', 'i'));
          if (!ym) return;
          const name = ym[1].replace(/[,\s]+$/, '').trim();
          if (!name || !/[\p{Lu}]/u.test(name) || name.split(/\s+/).length > 12) return;
          if (/^(in|by|since|from|until|to|between|around|about|circa|c\.|n|p|N)$/i.test(name)) return;
          if (/\d/.test(name)) return;
          // Multiple years for the same author: "Smith, 2019, 2021" or "2019a, b"
          const yearsPart = p.slice(ym.index + ym[0].length - ym[2].length);
          const locIdx = yearsPart.search(/,\s*(?:p{1,2}\.|para|ch\.|section|slide|\d+\s*$|\d+\s*[-–])/i);
          const yearsOnly = locIdx > -1 ? yearsPart.slice(0, locIdx) : yearsPart;
          const yrs = [];
          let lastNum = '';
          yearsOnly.split(/\s*,\s*/).forEach(tok => {
            tok = tok.trim();
            const full = tok.match(new RegExp('^(' + YEAR_OR_ND + ')$', 'i'));
            if (full) { yrs.push(full[1]); lastNum = baseYear(full[1]); }
            else if (/^[a-z]$/.test(tok) && lastNum) yrs.push(lastNum + tok);
          });
          if (!yrs.length) yrs.push(ym[2]);
          const page = hasLocator(yearsPart.replace(new RegExp('^' + YEAR_OR_ND, 'i'), '').replace(new RegExp('^(?:\\s*,\\s*(?:[a-z](?=\\s*(?:,|$))|' + YEAR_OR_ND + '\\b))+', 'i'), ''));
          yrs.forEach(yr => {
            const c = makeCite(name, yr, page, 'parenthetical', start, end, content, text);
            if (si === 0 && sec.length > 1) c.secondary = true;
            cites.push(c);
          });
        });
      }
    }
    return cites;
  }
  function hasLocator(s) {
    return /\bp{1,2}\.\s*\d|\bpara(?:graph)?\.?\s*\d|\bch(?:apter)?\.\s*\d|\bslide\s*\d|\bsection\s*\d|:\s*\d+|,\s*\d+(?:\s*[-–]\s*\d+)?\s*$|\bloc\.?\s*\d|\btimestamp|\d{1,2}:\d{2}/i.test(s);
  }
  function lookBackName(before) {
    let trimmed = before.replace(/(?:['’]s)?\s*$/, '');
    const gap = before.length - trimmed.length;
    const colleagues = trimmed.match(/\s+and\s+(?:colleagues|co-?workers|associates)$/i);
    if (colleagues) trimmed = trimmed.slice(0, colleagues.index);
    const words = trimmed.replace(/\s+$/, '').split(/(\s+)/);
    // walk back collecting name words
    const collected = [];
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i];
      if (/^\s+$/.test(w) || w === '') { collected.unshift(w); continue; }
      const bare = w.replace(/[.,;:]$/, '');
      const trailingPunct = w !== bare && !/^al\.$/.test(w) && !/^[A-Z]\.$/.test(w);
      if (collected.some(x => x.trim()) && trailingPunct && !/,$/.test(w)) break; // sentence end before name
      if (/^[\p{Lu}][\p{L}'’.-]*$/u.test(bare) || CONNECT.has(bare.toLowerCase()) || (/^[\p{Lu}]{2,}$/u.test(bare))) {
        if (/,$/.test(w) && collected.some(x => x.trim())) {
          // comma inside a list of authors "Smith, Jones and Brown"
          const nextWord = collected.find(x => x.trim());
          if (!/^[\p{Lu}]/u.test(nextWord) && !CONNECT.has(nextWord.toLowerCase())) break;
        }
        collected.unshift(w);
        if (collected.filter(x => x.trim()).length > 10) break;
      } else break;
    }
    let raw = collected.join('').trim();
    // Drop sentence openers like "However," or "Finally,"
    raw = raw.replace(/^(?:[\p{Lu}][\p{Ll}]+ly|However|Moreover|Furthermore|Similarly|Likewise|Thus|Therefore|Hence|Indeed|Also|Nevertheless|Nonetheless|Meanwhile|Instead|Again|First|Second|Third|Lastly|Overall|Conversely|Notably|Yet|Still|Here|Similarly|Next|Then|Today|Recently|Previously|Historically|Earlier|Later)\s*,\s*/u, '');
    // Drop leading connector / lowercase words
    raw = raw.replace(/^(?:(?:and|&|of|the|for|on|in|et|al\.?)\s+)+/i, '');
    raw = raw.replace(/^(?:As|In|While|Although|Whereas|Since|Like|Unlike|Following|But|And|So|For|Per|Both|Whilst|When|If|Because)\s+(?=[\p{Lu}])/u, '');
    if (!raw || !/[\p{Lu}]/u.test(raw[0])) return null;
    const last = raw.split(/\s+/).pop();
    if (CONNECT.has(last.toLowerCase()) && !/al\.?$/.test(last)) return null;
    const idx = before.lastIndexOf(raw);
    return { text: raw.replace(/,$/, '') + (colleagues ? ' et al.' : ''), raw, gap, idx };
  }
  function makeCite(name, year, page, kind, start, end, content, text) {
    const etal = /\bet\.?\s*al\.?/i.test(name);
    const etalMissingDot = /\bet al(?!\.)\b/i.test(name);
    const nameClean = name.replace(/,?\s*\bet\.?\s*al\.?/i, '').trim();
    const names = nameClean.split(/\s*,\s*|\s+and\s+|\s*&\s*/).map(x => x.trim()).filter(Boolean);
    return {
      name: name.trim(),
      names,
      first: names[0] || nameClean,
      etal,
      etalMissingDot,
      usesAmpersand: /&/.test(name),
      usesAnd: /\sand\s/.test(name),
      year: normYear(year),
      page,
      kind,
      start,
      end,
      content,
      context: snippet(text, start, end)
    };
  }

  // ---------- direct quotations ----------
  function findQuotes(essay) {
    const text = cleanText(essay);
    const out = [];
    const re = /[“"]([^“”"]{12,600}?)[”"]|(?:^|[\s(])‘([^‘’]{12,600}?)’(?=[\s.,;:)]|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const body = m[1] || m[2];
      if (body.split(/\s+/).length < 4) continue;
      const qEnd = m.index + m[0].length;
      out.push({ start: m.index, end: qEnd, body });
    }
    return out;
  }

  // ---------- the checker ----------
  const STYLE_RULES = {
    harvard: { label: 'Harvard (Cite Them Right)', etalFrom: 4, conjunction: 'and', commaBeforeYear: true },
    apa: { label: 'APA 7th', etalFrom: 3, conjunction: '&', commaBeforeYear: true },
    chicago: { label: 'Chicago (author-date)', etalFrom: 4, conjunction: 'and', commaBeforeYear: false }
  };

  function nameMatches(citeName, ref) {
    const words = norm(citeName.replace(/\bet\.?\s*al\.?/i, '')).split(' ').filter(Boolean);
    if (!words.length) return false;
    const key = ref.key.split(' ').filter(Boolean);
    if (!key.length) return false;
    // Suffix match: "The World Health Organization" vs "world health organization"; "In Chen" vs "chen"
    const tryMatch = (ws) => ws.length >= key.length && key.every((k, i) => ws[ws.length - key.length + i] === k);
    if (tryMatch(words)) return true;
    // prefix match for first-author part when cite has more words ("Smith and Jones" -> "smith")
    if (words.length >= key.length && key.every((k, i) => words[i] === k)) return true;
    if (ref.acronym && words.length === 1 && words[0] === ref.acronym) return true;
    return false;
  }

  function analyseReferences(refText) {
    return splitReferenceList(refText).map((raw, i) => {
      const p = parseEntry(raw);
      const first = (p.author && p.author[0]) || null;
      return {
        index: i,
        raw,
        parsed: p,
        key: authorKey(first) || norm((p.title || raw).split(/\s+/).slice(0, 3).join(' ')),
        acronym: acronymOf(first),
        year: p.year,
        authorCount: p.author ? p.author.length : 0,
        authors: p.author || [],
        hasEtal: (p.notes || []).some(n => /et al/.test(n)),
        used: false
      };
    });
  }

  function check(essayText, refText, styleId) {
    const rules = STYLE_RULES[styleId] || STYLE_RULES.harvard;
    const issues = [];
    const add = (type, severity, title, detail, extra) => issues.push(Object.assign({ type, severity, title, detail }, extra || {}));

    const refs = analyseReferences(refText);
    const citations = extractCitations(essayText);
    const quotes = findQuotes(essayText);

    if (!refs.length) add('setup', 'high', 'No reference list found', 'Paste your reference list in the second box, or make sure it starts with a heading like "References".');

    // Match citations
    const seenMissing = new Map();
    citations.forEach(c => {
      const nameHits = refs.filter(r => nameMatches(c.first, r) || nameMatches(c.name, r));
      const exact = nameHits.filter(r => normYear(r.year) === c.year);
      const sameBase = nameHits.filter(r => baseYear(r.year) === baseYear(c.year));
      c.matches = exact;
      if (exact.length) {
        exact.forEach(r => (r.used = true));
        c.ref = exact[0];
        return;
      }
      if (c.secondary) return; // original source in secondary referencing need not be listed
      const key = norm(c.first) + '|' + c.year;
      if (sameBase.length) {
        sameBase.forEach(r => (r.used = true));
        c.ref = sameBase[0];
        if (!seenMissing.has(key)) {
          seenMissing.set(key, true);
          if (sameBase.length > 1 && !/[a-z]$/.test(c.year)) {
            add('ambiguous', 'medium', 'Which ' + c.first + ' ' + c.year + '?', 'Your list has more than one ' + c.first + ' source from ' + baseYear(c.year) + '. Add a, b, c to the years in the list and in the text so readers can tell them apart.', { context: c.context });
          } else {
            add('year-letter', 'low', 'Year letter does not match', 'In the text: ' + c.year + '. In your list: ' + sameBase.map(r => r.year).join(', ') + '.', { context: c.context });
          }
        }
        return;
      }
      if (nameHits.length) {
        nameHits.forEach(r => (r.usedName = true));
        if (!seenMissing.has(key)) {
          seenMissing.set(key, true);
          add('year-mismatch', 'high', 'Year mismatch: ' + c.name + ' (' + c.year + ')', 'Your reference list has ' + c.first + ' with ' + nameHits.map(r => r.year || 'no year').join(', ') + ', but the text says ' + c.year + '.', { context: c.context, refRaw: nameHits[0].raw });
        }
        return;
      }
      // spelling near-miss
      const firstNorm = norm(c.first);
      const close = refs.filter(r => normYear(r.year) === c.year && r.key && levenshtein(firstNorm, r.key) <= Math.max(1, Math.floor(r.key.length / 5)));
      if (!seenMissing.has(key)) {
        seenMissing.set(key, true);
        if (close.length) {
          close.forEach(r => (r.usedName = true));
          add('spelling', 'medium', 'Possible spelling difference: ' + c.first, 'The text says "' + c.first + '" but your list has "' + (close[0].authors[0] ? (close[0].authors[0].family || close[0].authors[0].literal) : close[0].key) + '" (' + close[0].year + ').', { context: c.context, refRaw: close[0].raw });
        } else {
          add('missing', 'high', 'Not in your reference list: ' + c.name + ' (' + c.year + ')', 'This citation does not seem to match anything in your reference list.', { context: c.context });
        }
      }
    });

    // Unused references
    refs.forEach(r => {
      if (!r.used && !r.usedName) add('unused', 'medium', 'Listed but not cited', 'This source is in your reference list, but no matching citation was found in the text.', { refRaw: r.raw });
    });

    // et al. rules and formatting of citations
    const etalSeen = new Set();
    citations.forEach(c => {
      if (c.etalMissingDot) add('etal', 'low', '"et al" needs a full stop', 'Write "et al." with a full stop after "al".', { context: c.context });
      if (c.kind === 'narrative' && c.usesAmpersand) add('format', 'low', 'Use "and" in your sentence', 'When authors are named in your sentence, write "and" rather than "&".', { context: c.context });
      if (c.kind === 'parenthetical' && c.names.length > 1) {
        if (rules.conjunction === '&' && c.usesAnd) add('format', 'low', 'Use "&" inside brackets', rules.label + ' uses "&" between author names inside brackets.', { context: c.context });
        if (rules.conjunction === 'and' && c.usesAmpersand) add('format', 'low', 'Use "and" instead of "&"', rules.label + ' uses "and" between author names.', { context: c.context });
      }
      if (!c.ref) return;
      const n = c.ref.authorCount;
      const id = c.ref.index + '|' + c.etal;
      if (c.etal && n > 0 && n < rules.etalFrom && !etalSeen.has(id)) {
        etalSeen.add(id);
        add('etal', 'low', '"et al." used for ' + n + ' author' + (n > 1 ? 's' : ''), 'In ' + rules.label + ', "et al." is used when a source has ' + rules.etalFrom + ' or more authors. This source has ' + n + ', so name ' + (n === 1 ? 'the author' : 'all of them') + '.', { context: c.context });
      }
      if (!c.etal && n >= rules.etalFrom && c.names.length > 1 && !etalSeen.has(id)) {
        etalSeen.add(id);
        add('etal', 'low', 'Could be shortened to "et al."', 'This source has ' + n + ' authors. In ' + rules.label + ' you can write "' + c.first + ' et al." in the text.', { context: c.context });
      }
      if (!c.etal && n >= 2 && c.names.length === 1 && !etalSeen.has(id + 'one')) {
        etalSeen.add(id + 'one');
        add('authors', 'low', 'Only one author named', 'Your reference list shows ' + n + ' authors for this source, but the text names only ' + c.first + '.' + (n >= rules.etalFrom ? ' Use "' + c.first + ' et al."' : ' Name all ' + n + ' authors.'), { context: c.context });
      }
    });

    // Direct quotes without page numbers
    quotes.forEach(q => {
      const full = cleanText(essayText);
      const gapOk = (a, b) => !/[.!?]\s+[\p{Lu}]/u.test(full.slice(a, b));
      const after = citations.filter(c => c.start >= q.end - 2 && c.start - q.end <= 160 && gapOk(q.end - 1, c.start));
      const before = citations.filter(c => c.end <= q.start && q.start - c.end <= 200 && c.kind === 'narrative' && gapOk(c.end, q.start));
      const near = after.length ? after : before;
      if (!near.length) {
        add('quote', 'medium', 'Quotation with no citation nearby', 'Direct quotes need a citation with a page number straight after them.', { context: snippet(cleanText(essayText), q.start, q.end, 40) });
      } else if (!near.some(c => c.page)) {
        add('quote', 'medium', 'Quotation without a page number', 'Direct quotes usually need a page number, e.g. (' + near[0].name + (rules.commaBeforeYear ? ', ' : ' ') + near[0].year + (rules.commaBeforeYear ? ', p. 12' : ', 12') + ').', { context: snippet(cleanText(essayText), q.start, q.end, 40) });
      }
    });

    // Reference list order
    const sortable = refs.map(r => ({ r, k: sortKey(r) }));
    const outOfOrder = [];
    for (let i = 1; i < sortable.length; i++) {
      if (sortable[i].k < sortable[i - 1].k) outOfOrder.push(sortable[i].r);
    }
    if (outOfOrder.length) add('order', 'medium', 'Reference list is not in alphabetical order', outOfOrder.length + ' entr' + (outOfOrder.length > 1 ? 'ies are' : 'y is') + ' out of place. Use "Fix my reference list" to reorder it automatically.', { refRaws: outOfOrder.slice(0, 5).map(r => r.raw) });

    // Duplicates
    const dupMap = new Map();
    refs.forEach(r => {
      const k = norm(r.raw).replace(/\s/g, '').slice(0, 120);
      if (dupMap.has(k)) add('duplicate', 'medium', 'Duplicate reference', 'This source appears more than once in your list.', { refRaw: r.raw });
      else dupMap.set(k, r);
    });
    // Same author + same year without a/b
    const ay = new Map();
    refs.forEach(r => {
      if (!r.key || !r.year || r.year === 'n.d.') return;
      const k = r.key + '|' + r.year;
      if (ay.has(k) && norm(ay.get(k).raw) !== norm(r.raw)) add('ambiguous', 'medium', 'Same author and year twice', 'Two sources by ' + (r.authors[0] ? (r.authors[0].family || r.authors[0].literal) : 'the same author') + ' from ' + r.year + '. Add a and b after the year (e.g. ' + r.year + 'a, ' + r.year + 'b) in the list and the text.', { refRaw: r.raw });
      ay.set(k, r);
    });
    // Entries with problems
    refs.forEach(r => {
      if (!r.year) add('ref-year', 'medium', 'No year found', 'This reference does not seem to include a year. If there is no date, use "n.d.".', { refRaw: r.raw });
      if (r.hasEtal) add('ref-etal', 'low', '"et al." in the reference list', 'Most styles want every author listed in the reference list (APA lists up to 20). Check your style guide.', { refRaw: r.raw });
      if (r.parsed.type === 'webpage' && !r.parsed._accessedText && styleId === 'harvard') add('ref-access', 'low', 'Website without an access date', 'Harvard (Cite Them Right) asks for the date you accessed online sources, e.g. (Accessed: 12 October 2026).', { refRaw: r.raw });
    });

    const order = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);
    const used = refs.filter(r => r.used).length;
    return {
      style: rules.label,
      issues,
      stats: {
        citations: citations.length,
        uniqueCitations: new Set(citations.map(c => norm(c.first) + c.year)).size,
        references: refs.length,
        matchedReferences: used,
        quotes: quotes.length
      },
      citations,
      references: refs
    };
  }
  function sortKey(r) {
    const a = r.authors[0];
    const k = a ? norm((a.family || a.literal || '').replace(/^the\s+/i, '')) : norm(r.parsed.title || r.raw);
    const multi = r.authors.length > 1 ? '1' : '0';
    const second = r.authors[1] ? norm(r.authors[1].family || r.authors[1].literal || '') : '';
    const y = r.year === 'n.d.' ? '0000' : (r.year || '9999');
    return k + '\u0001' + multi + '\u0001' + second + '\u0001' + y;
  }

  const api = {
    splitDocument,
    splitReferenceList,
    parseEntry,
    parseAuthors,
    extractCitations,
    findQuotes,
    check,
    analyseReferences,
    norm,
    STYLE_RULES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrueRefCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
