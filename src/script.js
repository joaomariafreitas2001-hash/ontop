// Shared script model, used by the overlay, the editor and the tests.
// A script is plain text: blank line = new paragraph, [brackets] = cue (not spoken).
// Every spoken word gets a global index; the editor and the overlay agree on it
// because both tokenize the same text with the same regex.

(function (root) {
  const TOKEN = /\[[^\]]*\]|\S+/g;

  function paragraphs(text) {
    return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  }

  // Words with their character offsets in `text` (cues are skipped).
  function words(text) {
    const out = [];
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (m[0][0] === '[') continue;
      out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // --- normalisation for speech matching ------------------------------------

  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  function numberWords(n) {
    if (n < 20) return [ONES[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
    if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? numberWords(n % 100) : [])];
    if (n < 1e6) return [...numberWords(Math.floor(n / 1000)), 'thousand', ...(n % 1000 ? numberWords(n % 1000) : [])];
    return [...numberWords(Math.floor(n / 1e6)), 'million', ...(n % 1e6 ? numberWords(n % 1e6) : [])];
  }

  function clean(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // One written word -> the words a recogniser would hear ("38%" -> thirty eight percent,
  // "In-Company" -> in company, "João" -> joao).
  function spoken(word) {
    const percent = /%/.test(word);
    // "4,500" and "4.500" are one number, not two.
    const parts = clean(word.replace(/(\d)[,.](?=\d{3}\b)/g, '$1')).split(' ').filter(Boolean);
    const out = [];
    for (const p of parts) {
      if (/^\d+$/.test(p) && p.length <= 7) {
        const n = Number(p);
        // Years are usually read as "twenty twenty six"
        if (n >= 1900 && n <= 2099 && p.length === 4 && n % 100 !== 0) out.push(...numberWords(Math.floor(n / 100)), ...numberWords(n % 100));
        else out.push(...numberWords(n));
      } else if (/^\d/.test(p)) {
        out.push(...p.split(/(\d+)/).filter(Boolean).flatMap((x) => (/^\d+$/.test(x) ? numberWords(Number(x)) : [x])));
      } else {
        out.push(p);
      }
    }
    if (percent) out.push('percent');
    return out;
  }

  // Speech units for the whole script: [{ u: 'company', w: wordIndex }]
  function units(text) {
    const out = [];
    words(text).forEach((w, i) => spoken(w.text).forEach((u) => out.push({ u, w: i })));
    return out;
  }

  function heardWords(text) {
    return clean(text).split(' ').filter(Boolean);
  }

  // Sections: paragraphs that start with a label line like [Slide 3 · Why now · 0:30].
  // `planned` is the planned start in seconds when the label ends with a m:ss time.
  function sections(text) {
    const out = [];
    paragraphs(text).forEach((p, i) => {
      const m = p.split('\n')[0].trim().match(/^\[([^\]]+)\]$/);
      if (!m) return;
      const parts = m[1].split('·').map((s) => s.trim());
      const t = parts[parts.length - 1].match(/^(\d+):(\d{2})$/);
      if (t) parts.pop();
      out.push({
        title: parts.length > 1 ? parts.slice(1).join(' · ') : parts[0],
        num: (parts[0].match(/\d+/) || [''])[0],
        time: t ? t[0] : '',
        planned: t ? Number(t[1]) * 60 + Number(t[2]) : null,
        para: i,
      });
    });
    return out;
  }

  // 75 -> "1:15", -8 -> "-0:08"
  function clock(sec) {
    const s = Math.round(Math.abs(sec));
    return (sec < 0 ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  const api = { paragraphs, words, units, spoken, heardWords, clean, sections, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OnTopScript = api;
})(typeof window !== 'undefined' ? window : globalThis);
