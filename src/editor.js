// OnTop editor: script, sections, settings. Every change goes to the main
// process, which saves it and forwards it to the overlay.

const $ = (id) => document.getElementById(id);
const scriptEl = $('script');

// macOS: traffic lights on the left, ⌘/⌥ in shortcut labels.
const IS_MAC = window.ontop.platform === 'darwin';
document.body.classList.add(IS_MAC ? 'mac' : 'win');
if (IS_MAC) {
  document.querySelectorAll('kbd').forEach((k) => { k.textContent = { Ctrl: '⌘', Alt: '⌥' }[k.textContent] || k.textContent; });
  document.querySelectorAll('[title]').forEach((el) => { el.title = el.title.replace(/Ctrl\+Alt\+/g, '⌘⌥'); });
  document.querySelector('.doc-meta .hint').textContent = '⌘-click a sentence to jump there';
}

let settings = null;
let playing = false;
let words = 0;
let sections = [];        // [{ title, time, para }]
let currentPara = -1;
let progress = 0;

const FORMAT = {
  wpm: (v) => `${v} wpm`,
  micThreshold: (v) => `${Math.round(((v - 0.003) / 0.077) * 100)}%`,
  micHangMs: (v) => `${(v / 1000).toFixed(1)} s`,
  fontSize: (v) => `${v} pt`,
  lineHeight: (v) => Number(v).toFixed(2),
  paraGap: (v) => Number(v).toFixed(2),
  bgOpacity: (v) => `${Math.round(v * 100)}%`,
  readingLine: (v) => `${Math.round(v * 100)}%`,
};

const send = (channel, data) => window.ontop.send(channel, data);
const setSettings = (patch) => send('state:set', { settings: patch });

function clock(mins) {
  const total = Math.max(0, Math.round(mins * 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// --- sliders --------------------------------------------------------------

function paintRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--p', p + '%');
}

function fill() {
  document.querySelectorAll('[data-key]').forEach((el) => {
    const v = settings[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
    if (el.type === 'range') paintRange(el);
  });
  document.querySelectorAll('output[data-for]').forEach((o) => {
    const k = o.dataset.for;
    o.textContent = FORMAT[k] ? FORMAT[k](settings[k]) : settings[k];
  });
  const seg = $('mode');
  seg.dataset.value = settings.mode;
  seg.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.mode === settings.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  document.body.classList.toggle('voice', settings.mode === 'voice');
  document.body.classList.toggle('track', settings.mode === 'track');
}

document.querySelectorAll('[data-key]').forEach((el) => {
  el.addEventListener('input', () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'range') { v = Number(v); paintRange(el); }
    setSettings({ [el.dataset.key]: v });
  });
});

$('mode').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => setSettings({ mode: b.dataset.mode }));
});

// --- script + sections ----------------------------------------------------

// Same paragraph split as the overlay, so section indexes line up.
function paragraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function parseSections(text) {
  return window.OnTopScript.sections(text);
}

function renderSections() {
  const list = $('sections');
  list.innerHTML = '';
  sections.forEach((s, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="n"></span><span class="t"></span><span class="act"></span><span class="time"></span>`;
    li.querySelector('.n').textContent = s.num || idx + 1;
    li.querySelector('.t').textContent = s.title;
    li.querySelector('.time').textContent = s.time;
    const actual = sectionActuals[idx];
    if (s.planned !== null && actual !== null && actual !== undefined) {
      li.querySelector('.act').innerHTML = deltaChip(actual - s.planned);
      li.title = `Planned ${s.time}, reached at ${window.OnTopScript.clock(actual)}`;
    }
    li.title = `Jump to ${s.title}`;
    li.addEventListener('click', () => send('cmd', { seek: s.para }));
    list.appendChild(li);
  });
  $('sections-empty').style.display = sections.length ? 'none' : '';
  markCurrentSection();
}

function markCurrentSection() {
  let current = -1;
  sections.forEach((s, i) => { if (s.para <= currentPara) current = i; });
  [...$('sections').children].forEach((li, i) => {
    li.classList.toggle('current', i === current);
    li.classList.toggle('done', i < current);
  });
}

function updateCounts() {
  words = scriptEl.value.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
  $('wordcount').textContent = `${words.toLocaleString('en-GB')} words`;
  $('duration').textContent = settings ? `${clock(words / settings.wpm)} at ${settings.wpm} wpm` : '';
  updateTimeLeft();
}

function updateTimeLeft() {
  if (!settings) return;
  const el = $('time-left');
  // During a run: elapsed time and how far off plan you are; otherwise the time left.
  if (timer.running) {
    const d = timer.delta;
    el.textContent = window.OnTopScript.clock(timer.elapsed) +
      (d === null || d === undefined ? '' : `  ${d > 0 ? '+' : d < 0 ? '−' : '±'}${window.OnTopScript.clock(Math.abs(Math.round(d)))}`);
    el.className = d > 10 ? 'late' : d < -10 ? 'early' : '';
    return;
  }
  el.className = '';
  el.textContent = `${clock((words * (1 - progress)) / settings.wpm)} left`;
}

let typingTimer = null;
scriptEl.addEventListener('input', () => {
  updateCounts();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    send('state:set', { script: scriptEl.value });
    sections = parseSections(scriptEl.value);
    renderSections();
    refreshWords();
  }, 250);
});

// --- toolbar --------------------------------------------------------------

const cmd = (c) => () => send('cmd', c);
$('btn-play').addEventListener('click', cmd('toggle'));
$('btn-reset').addEventListener('click', cmd('reset'));
$('btn-back').addEventListener('click', cmd('back'));
$('btn-forward').addEventListener('click', cmd('forward'));
$('btn-lock').addEventListener('click', cmd('lock'));
$('btn-visible').addEventListener('click', cmd('visibility'));
$('btn-center').addEventListener('click', cmd('center'));
$('btn-calibrate').addEventListener('click', cmd('calibrate'));

// 1 / 2 also work inside this window, except while typing in the script or a field.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || !settings || !settings.numberKeys) return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox')) return;
  const c = { Digit1: 'lineUp', Numpad1: 'lineUp', Digit2: 'lineDown', Numpad2: 'lineDown' }[e.code];
  if (c) { e.preventDefault(); send('cmd', c); }
});

// --- live position in the script --------------------------------------------
// The overlay reports the next word to read; the backdrop behind the textarea
// highlights that sentence and word, and the script scrolls to keep it in view.

const backdrop = $('backdrop');
let liveWord = -1;
let scriptWords = [];

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// [start, end) of the sentence containing character `at`.
function sentenceAround(text, at) {
  let start = 0;
  const before = /[.!?]["')\]]?\s+|\n[^\S\n]*\n\s*|\]\n/g;
  let m;
  while ((m = before.exec(text)) && m.index + m[0].length <= at) start = m.index + m[0].length;
  const tail = text.slice(at).search(/[.!?](\s|$)|\n\s*\n/);
  const end = tail < 0 ? text.length : at + tail + 1;
  return [start, end];
}

function paintHighlight() {
  const text = scriptEl.value;
  const w = scriptWords[liveWord];
  if (!w || !settings) { backdrop.textContent = text + '\n'; return; }
  const [s, e] = sentenceAround(text, w.start);
  backdrop.innerHTML =
    escapeHtml(text.slice(0, s)) +
    '<mark class="sentence">' + escapeHtml(text.slice(s, w.start)) +
    '<mark class="word">' + escapeHtml(text.slice(w.start, w.end)) + '</mark>' +
    escapeHtml(text.slice(w.end, e)) + '</mark>' +
    escapeHtml(text.slice(e)) + '\n';
  backdrop.scrollTop = scriptEl.scrollTop;
  // Keep the current sentence in view, unless you are editing.
  if (document.activeElement !== scriptEl) {
    const mark = backdrop.querySelector('mark.word');
    const top = mark.offsetTop - scriptEl.clientHeight * 0.35;
    if (Math.abs(scriptEl.scrollTop - top) > scriptEl.clientHeight * 0.25) scriptEl.scrollTo({ top, behavior: 'smooth' });
  }
}

function refreshWords() {
  scriptWords = window.OnTopScript.words(scriptEl.value);
  paintHighlight();
}

scriptEl.addEventListener('scroll', () => { backdrop.scrollTop = scriptEl.scrollTop; });

// Ctrl+click anywhere in a sentence: jump the prompter there.
scriptEl.addEventListener('click', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const caret = scriptEl.selectionStart;
  const i = scriptWords.findIndex((w) => w.end >= caret);
  if (i < 0) return;
  const [s] = sentenceAround(scriptEl.value, scriptWords[i].start);
  const first = scriptWords.findIndex((w) => w.start >= s);
  send('cmd', { seekWord: first >= 0 ? first : i });
});

function setIcon(btn, id) {
  btn.querySelector('use').setAttribute('href', '#' + id);
}

// --- script library ---------------------------------------------------------

let library = { scripts: [], activeId: null };
const lib = (msg) => send('library', msg);

function activeScript() {
  return library.scripts.find((s) => s.id === library.activeId);
}

function renderLibrary() {
  const ul = $('scripts');
  ul.innerHTML = '';
  for (const s of library.scripts) {
    const li = document.createElement('li');
    li.className = (s.id === library.activeId ? 'active ' : '') + (s.source ? 'is-linked' : '');
    li.innerHTML = `<svg><use href="#${s.source ? 'i-link' : 'i-doc'}"/></svg><span class="t"></span><button class="del" title="Delete">×</button>`;
    li.querySelector('.t').textContent = s.name;
    li.title = s.source ? `${s.name}\nLinked to ${s.source.path}` : s.name;
    li.addEventListener('click', () => { if (s.id !== library.activeId) lib({ op: 'select', id: s.id }); });
    li.addEventListener('dblclick', () => startRename(li.querySelector('.t'), s.id));
    const del = li.querySelector('.del');
    del.hidden = library.scripts.length <= 1;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${s.name}"?${s.source ? '\n\nThe linked file itself is not touched.' : ''}`)) lib({ op: 'delete', id: s.id });
    });
    ul.appendChild(li);
  }
  const a = activeScript();
  if (!a) return;
  if (document.activeElement !== $('script-name')) $('script-name').textContent = a.name;
  $('linked').hidden = !a.source;
  if (a.source) $('linked-file').textContent = a.source.path.split(/[\\/]/).pop();
  scriptEl.readOnly = !!a.source;
}

// Inline rename: Enter saves, Escape cancels.
function startRename(el, id) {
  const original = el.textContent;
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  const finish = (save) => {
    el.contentEditable = 'false';
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    const name = el.textContent.trim();
    if (save && name && name !== original) lib({ op: 'rename', id, name });
    else el.textContent = original;
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
}

$('script-name').addEventListener('dblclick', () => startRename($('script-name'), library.activeId));
$('btn-new').addEventListener('click', () => lib({ op: 'new' }));
$('btn-import').addEventListener('click', () => lib({ op: 'import' }));
$('btn-unlink').addEventListener('click', () => lib({ op: 'unlink', id: library.activeId }));

// --- rehearsals -------------------------------------------------------------

let runs = [];             // saved runs of the active script, newest first
let sectionActuals = [];   // reach time per section: live run, else the last saved run
let timer = { running: false };

function deltaChip(sec) {
  const d = Math.round(sec);
  const cls = d > 10 ? 'behind' : d < -10 ? 'ahead' : 'on-time';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `<span class="chip ${cls}">${sign}${window.OnTopScript.clock(Math.abs(d))}</span>`;
}

// How far off plan a run finished: last section reached vs its planned start.
function runDelta(r) {
  if (r.target) return r.total - r.target; // rehearsal: total vs the target length
  const reached = r.sections.filter((s) => s.planned !== null && s.actual !== null);
  if (!reached.length) return null;
  const last = reached[reached.length - 1];
  return last.actual - last.planned;
}

function renderRuns() {
  const clock = window.OnTopScript.clock;
  const done = runs.filter((r) => r.completed);
  const totals = done.map((r) => r.total);
  $('stat-last').textContent = runs[0] ? clock(runs[0].total) : '–';
  $('stat-best').textContent = totals.length ? clock(Math.min(...totals)) : '–';
  $('stat-avg').textContent = totals.length ? clock(totals.reduce((a, b) => a + b, 0) / totals.length) : '–';
  $('btn-clear-runs').hidden = !runs.length;
  $('runs-foot').hidden = runs.length > 0;
  const ol = $('runs');
  ol.innerHTML = '';
  for (const r of runs.slice(0, 6)) {
    const li = document.createElement('li');
    const when = new Date(r.startedAt);
    const delta = runDelta(r);
    li.innerHTML = `<span class="when"></span><span class="total"></span>${r.completed ? (delta === null ? '<span></span>' : deltaChip(delta)) : '<span class="chip partial">partial</span>'}`;
    li.querySelector('.when').textContent = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    li.querySelector('.total').textContent = clock(r.total);
    ol.appendChild(li);
  }
}

function lastRunActuals() {
  const r = runs[0];
  return r ? r.sections.map((s) => s.actual) : [];
}

$('btn-clear-runs').addEventListener('click', () => {
  if (confirm('Clear all rehearsals of this script?')) send('cmd', 'clearRuns');
});

window.ontop.on('timer', (t) => {
  timer = t;
  sectionActuals = t.running ? t.sections : lastRunActuals();
  renderSections();
  updateTimeLeft();
});

// --- speech language ----------------------------------------------------------

let models = {};

function renderLanguage() {
  if (!settings) return;
  const sel = $('language');
  const lang = settings.language || 'en';
  sel.innerHTML = '';
  for (const [code, m] of Object.entries(models)) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = m.installed ? m.label : `${m.label} (${m.mb} MB)`;
    sel.appendChild(opt);
  }
  sel.value = lang;
  const m = models[lang];
  const dl = m && m.downloading;
  $('btn-download').hidden = !m || m.installed || !!dl;
  $('btn-download').textContent = m ? `Download ${m.mb} MB` : 'Download';
  $('download-row').hidden = !dl;
  if (dl) {
    const pct = dl.total ? Math.min(100, (dl.received / dl.total) * 100) : 0;
    $('dl-progress').style.width = pct + '%';
    $('dl-text').textContent = `Downloading ${m.label} speech model… ${(dl.received / 1e6).toFixed(1)} of ${(dl.total / 1e6).toFixed(0)} MB`;
  }
}

$('language').addEventListener('change', (e) => setSettings({ language: e.target.value }));
$('btn-download').addEventListener('click', () => send('models', { op: 'download', lang: settings.language }));
window.ontop.on('models', (m) => { models = m; renderLanguage(); });

// --- from main ------------------------------------------------------------

window.ontop.on('state', (s) => {
  settings = s.settings;
  const switched = library.activeId !== s.activeId;
  library = { scripts: s.scripts || [], activeId: s.activeId };
  renderLibrary();
  runs = (s.runs || []).filter((r) => r.scriptId === s.activeId);
  renderRuns();
  if (window.OnTopTrend) window.OnTopTrend();
  if (!timer.running) { sectionActuals = lastRunActuals(); renderSections(); }
  if (switched) { liveWord = -1; currentPara = -1; }
  if ((switched || scriptEl.readOnly || document.activeElement !== scriptEl) && scriptEl.value !== s.script) {
    scriptEl.value = s.script;
    sections = parseSections(s.script);
    renderSections();
    refreshWords();
  }
  fill();
  updateCounts();
  renderLanguage();
  if (window.OnTopVoiceSummary) window.OnTopVoiceSummary();
  if (window.OnTopBuilderSync) window.OnTopBuilderSync();
});

window.ontop.on('status', (st) => {
  playing = !!st.playing;
  progress = st.progress || 0;
  const voice = settings && settings.mode === 'voice';
  const listening = playing && voice && st.speaking === false;

  const play = $('btn-play');
  play.classList.toggle('playing', playing);
  setIcon(play, playing ? 'i-pause' : 'i-play');

  const pill = $('status-pill');
  pill.classList.toggle('playing', playing && !listening);
  pill.classList.toggle('listening', listening);
  $('status-text').textContent = !playing ? 'Paused' : listening ? 'Listening' : settings && settings.mode === 'classic' ? 'Scrolling' : 'Following you';
  updateTimeLeft();

  const lock = $('btn-lock');
  lock.classList.toggle('on', !!st.locked);
  setIcon(lock, st.locked ? 'i-lock' : 'i-unlock');
  lock.title = st.locked ? 'Locked: clicks pass through (Ctrl+Alt+L)' : 'Unlocked: drag and resize the overlay (Ctrl+Alt+L)';

  const vis = $('btn-visible');
  setIcon(vis, st.visible ? 'i-eye' : 'i-eye-off');
  vis.classList.toggle('on', !st.visible);

  $('progress').style.width = progress * 100 + '%';

  if (typeof st.level === 'number') {
    $('mic-level').style.width = Math.min(100, ((st.level - 0.003) / 0.077) * 100) + '%';
  }
  const mode = settings ? settings.mode : 'track';
  const micState = $('mic-state');
  if (st.micError && mode !== 'classic') {
    micState.textContent = `Microphone unavailable (${st.micError}). It retries every few seconds; check Settings › Privacy › Microphone.`;
    micState.classList.add('warn');
  } else {
    micState.classList.remove('warn');
    micState.textContent = {
      track: 'Follows the words you actually say, fully offline. Go off-script and it waits; restart a sentence and it goes back. 1 and 2 still nudge it.',
      voice: 'Scrolls at your speed while you talk and holds when you stop. The green level should pass the knob when you speak.',
      classic: 'Scrolls at a constant speed. Ctrl+Alt+↑ / ↓ change it by 5 wpm.',
    }[mode];
  }

  const modelState = $('model-state');
  const model = st.model || 'idle';
  const langInfo = models[(settings && settings.language) || 'en'];
  const langLabel = langInfo ? langInfo.label : 'English';
  const missing = langInfo && !langInfo.installed;
  modelState.textContent = missing ? 'Not downloaded' : { idle: 'Loads on play', loading: 'Loading voice…', ready: `Offline · ${langLabel}`, error: 'Voice model failed' }[model];
  modelState.className = 'model-state' + (missing ? '' : model === 'ready' ? ' ok' : model === 'error' ? ' bad' : '');
  if (st.heard) $('heard-text').textContent = '“' + st.heard + '”';

  const cal = $('btn-calibrate');
  cal.disabled = !!st.calibrating;
  cal.textContent = st.calibrating ? 'Stay quiet…' : 'Calibrate';

  if (typeof st.word === 'number' && st.word !== liveWord && document.activeElement !== scriptEl) {
    liveWord = st.word;
    paintHighlight();
  }

  if (typeof st.para === 'number' && st.para !== currentPara) {
    currentPara = st.para;
    markCurrentSection();
  }

  $('hotkey-errors').textContent = st.hotkeyErrors && st.hotkeyErrors.length
    ? `Taken by another app: ${st.hotkeyErrors.join(', ')}`
    : '';
});
