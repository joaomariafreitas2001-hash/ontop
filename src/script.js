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

  // Numbers as a recogniser writes them, per language. Accents are dropped
  // because matching compares cleaned words ("três" -> "tres").

  const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  function enNumber(n) {
    if (n < 20) return [EN_ONES[n]];
    if (n < 100) return [EN_TENS[Math.floor(n / 10)], ...(n % 10 ? [EN_ONES[n % 10]] : [])];
    if (n < 1000) return [EN_ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? enNumber(n % 100) : [])];
    if (n < 1e6) return [...enNumber(Math.floor(n / 1000)), 'thousand', ...(n % 1000 ? enNumber(n % 1000) : [])];
    return [...enNumber(Math.floor(n / 1e6)), 'million', ...(n % 1e6 ? enNumber(n % 1e6) : [])];
  }

  // Brazilian forms (the Vosk Portuguese model is pt-BR); European spellings like
  // "dezasseis" still match through the fuzzy comparison.
  const PT_ONES = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
    'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const PT_TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const PT_HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function ptNumber(n) {
    if (n < 20) return [PT_ONES[n]];
    if (n < 100) return [PT_TENS[Math.floor(n / 10)], ...(n % 10 ? ['e', PT_ONES[n % 10]] : [])];
    if (n === 100) return ['cem'];
    if (n < 1000) return [PT_HUNDREDS[Math.floor(n / 100)], ...(n % 100 ? ['e', ...ptNumber(n % 100)] : [])];
    if (n < 1e6) {
      const k = Math.floor(n / 1000), r = n % 1000;
      return [...(k === 1 ? [] : ptNumber(k)), 'mil', ...(r ? (r < 100 || r % 100 === 0 ? ['e'] : []).concat(ptNumber(r)) : [])];
    }
    const m = Math.floor(n / 1e6);
    return [...ptNumber(m), m === 1 ? 'milhao' : 'milhoes', ...(n % 1e6 ? ptNumber(n % 1e6) : [])];
  }

  const ES_ONES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
    'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const ES_TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const ES_HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  function esNumber(n) {
    if (n < 30) return [ES_ONES[n]];
    if (n < 100) return [ES_TENS[Math.floor(n / 10)], ...(n % 10 ? ['y', ES_ONES[n % 10]] : [])];
    if (n === 100) return ['cien'];
    if (n < 1000) return [ES_HUNDREDS[Math.floor(n / 100)], ...(n % 100 ? esNumber(n % 100) : [])];
    if (n < 1e6) {
      const k = Math.floor(n / 1000), r = n % 1000;
      return [...(k === 1 ? [] : esNumber(k)), 'mil', ...(r ? esNumber(r) : [])];
    }
    const m = Math.floor(n / 1e6);
    return [...(m === 1 ? ['un'] : esNumber(m)), m === 1 ? 'millon' : 'millones', ...(n % 1e6 ? esNumber(n % 1e6) : [])];
  }

  const LANGS = {
    en: { number: enNumber, percent: ['percent'], splitYears: true },
    pt: { number: ptNumber, percent: ['por', 'cento'], splitYears: false },
    es: { number: esNumber, percent: ['por', 'ciento'], splitYears: false },
  };

  function numberWords(n, lang = 'en') {
    return (LANGS[lang] || LANGS.en).number(n);
  }

  function clean(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // One written word -> the words a recogniser would hear ("38%" -> thirty eight percent,
  // "In-Company" -> in company, "João" -> joao).
  function spoken(word, lang = 'en') {
    const L = LANGS[lang] || LANGS.en;
    const percent = /%/.test(word);
    // "4,500" and "4.500" are one number, not two.
    const parts = clean(word.replace(/(\d)[,.](?=\d{3}\b)/g, '$1')).split(' ').filter(Boolean);
    const out = [];
    for (const p of parts) {
      if (/^\d+$/.test(p) && p.length <= 7) {
        const n = Number(p);
        // English years are usually read as "twenty twenty six"
        if (L.splitYears && n >= 1900 && n <= 2099 && p.length === 4 && n % 100 !== 0) out.push(...L.number(Math.floor(n / 100)), ...L.number(n % 100));
        else out.push(...L.number(n));
      } else if (/^\d/.test(p)) {
        out.push(...p.split(/(\d+)/).filter(Boolean).flatMap((x) => (/^\d+$/.test(x) ? L.number(Number(x)) : [x])));
      } else {
        out.push(p);
      }
    }
    if (percent) out.push(...L.percent);
    return out;
  }

  // Speech units for the whole script: [{ u: 'company', w: wordIndex }]
  // `aliases` comes from Voice setup: { haitong: ['hey', 'tongs'] } means "the recogniser
  // hears this word as 'hey tongs' when you say it", so those are the units to expect.
  function units(text, lang = 'en', aliases = {}) {
    const out = [];
    words(text).forEach((w, i) => {
      const alias = aliases[clean(w.text).replace(/ /g, '')];
      (alias && alias.length ? alias : spoken(w.text, lang)).forEach((u) => out.push({ u, w: i }));
    });
    return out;
  }

  // Words in a script the recogniser is likely to get wrong: acronyms and names
  // (capitalised words that don't start a sentence). Used by Voice setup.
  function trickyWords(text, max = 10) {
    const seen = new Set();
    const acronyms = [];
    const names = [];
    let sentenceStart = true;
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(text))) {
      const tok = m[0];
      if (tok[0] === '[') { sentenceStart = true; continue; }
      const bare = tok.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
      const key = clean(bare).replace(/ /g, '');
      const isAcronym = /^\p{Lu}[\p{Lu}\d]+$/u.test(bare) || /^\p{Lu}\p{Ll}*\p{Lu}/u.test(bare);
      const isName = !sentenceStart && /^\p{Lu}\p{Ll}/u.test(bare) && bare !== 'I';
      if (key.length >= 2 && !/^\d+$/.test(key) && !seen.has(key) && (isAcronym || isName)) {
        seen.add(key);
        (isAcronym ? acronyms : names).push(bare);
      }
      sentenceStart = /[.!?:]["')\]]?$/.test(tok);
    }
    return [...acronyms, ...names].slice(0, max);
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

  // Speech models per language (Vosk small models, Apache-2.0). English ships with
  // the app; the others download on first use into the user's data folder.
  const MODELS = {
    en: { label: 'English', file: 'en-us.tar.gz', dir: 'vosk-model-small-en-us-0.15', mb: 40, url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' },
    pt: { label: 'Português', file: 'pt.tar.gz', dir: 'vosk-model-small-pt-0.3', mb: 31, url: 'https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip' },
    es: { label: 'Español', file: 'es.tar.gz', dir: 'vosk-model-small-es-0.42', mb: 38, url: 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip' },
  };

  const api = { paragraphs, words, units, spoken, heardWords, clean, sections, clock, numberWords, trickyWords, MODELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OnTopScript = api;
})(typeof window !== 'undefined' ? window : globalThis);
