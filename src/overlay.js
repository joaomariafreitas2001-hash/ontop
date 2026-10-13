// OnTop overlay: renders the script and scrolls it.
// Three modes:
//   track   - word tracking: offline speech recognition (Vosk) + OnTopTracker,
//             the reading line follows the word you are actually on
//   voice   - scroll at the set wpm while the mic hears you, hold in silence
//   classic - constant speed (words per minute)

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const viewport = $('viewport');
const root = document.documentElement;
const S = window.OnTopScript;

const MODEL_BASE = 'ontop://app/models/';

// Demo stage (overlay.html?demo): used to record the README animation. Adds a
// camera notch above the prompter and a live caption of what the app hears.
const DEMO = new URLSearchParams(location.search).has('demo');
if (DEMO) {
  document.body.classList.add('demo', 'locked');
  document.body.insertAdjacentHTML('afterbegin', '<div id="cam"><i></i></div>');
  document.body.insertAdjacentHTML('beforeend', '<div id="caption"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span id="caption-text">Listening…</span></div>');
}

let settings = null;
let script = '';
let playing = false;
let pos = 0;           // scroll offset in px (0 = first line on the reading marker)
let pendingJump = 0;   // px still to animate from a manual jump
let manualJump = false;
let velocity = 0;      // px/s in voice/classic mode, eased so starts and stops are smooth
let pxPerWord = 1;
let maxPos = 0;
let wordEls = [];      // span per spoken word, index = global word index
let lastFrame = performance.now();

// --- rendering ------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  let w = 0;
  const html = S.paragraphs(script).map((p, i) => {
    const lines = p.split('\n').map((line) => {
      const t = line.trim();
      // A line that is only a [cue] (e.g. a slide heading) becomes a small label.
      if (/^\[[^\]]+\]$/.test(t)) return { label: true, html: '<span class="cue-line">' + escapeHtml(t.slice(1, -1)) + '</span>' };
      const out = line.replace(/\[[^\]]*\]|\S+/g, (tok) => tok[0] === '['
        ? '<span class="cue">' + escapeHtml(tok) + '</span>'
        : '<span class="w" data-w="' + w++ + '">' + escapeHtml(tok) + '</span>');
      return { label: false, html: out };
    });
    const inner = lines.reduce((acc, l, k) => acc + l.html + (k < lines.length - 1 && !l.label ? '<br>' : ''), '');
    return '<p data-i="' + i + '">' + inner + '</p>';
  }).join('');
  textEl.innerHTML = html;
  wordEls = [...textEl.querySelectorAll('.w')];
  readUpTo = -1;
  tracker = new window.OnTopTracker(script, settings.language || 'en');
  measure();
}

function measure() {
  const height = textEl.scrollHeight;
  pxPerWord = height / Math.max(1, wordEls.length);
  maxPos = Math.max(0, height - lineHeightPx());
  pos = Math.min(pos, maxPos);
}

function applySettings() {
  root.style.setProperty('--bg-opacity', settings.bgOpacity);
  root.style.setProperty('--font-size', settings.fontSize + 'px');
  root.style.setProperty('--line-height', settings.lineHeight);
  root.style.setProperty('--text', settings.textColor);
  root.style.setProperty('--cue', settings.cueColor);
  root.style.setProperty('--reading-line', settings.readingLine * 100 + '%');
  root.style.setProperty('--para-gap', settings.paraGap + 'em');
  document.body.classList.toggle('voice', settings.mode !== 'classic');
  document.body.classList.toggle('track', settings.mode === 'track');
}

function lineHeightPx() {
  return settings.fontSize * settings.lineHeight;
}

// Top of the line holding word i, in the same coordinates as `pos`.
function wordTop(i) {
  const el = wordEls[Math.max(0, Math.min(wordEls.length - 1, i))];
  if (!el) return 0;
  return el.offsetTop - (lineHeightPx() - el.offsetHeight) / 2;
}

// First word on or below the reading line at scroll offset p.
function wordAt(p) {
  const half = lineHeightPx() / 2;
  for (let i = 0; i < wordEls.length; i++) if (wordTop(i) >= p - half) return i;
  return wordEls.length;
}

// Dim the words already read (word tracking only).
let readUpTo = -1;
function markRead(upTo) {
  if (upTo === readUpTo) return;
  const [a, b, on] = upTo > readUpTo ? [readUpTo + 1, upTo, true] : [upTo + 1, readUpTo, false];
  for (let i = Math.max(0, a); i <= b && i < wordEls.length; i++) wordEls[i].classList.toggle('r', on);
  readUpTo = upTo;
}

// --- speech recognition (word tracking) -----------------------------------

let tracker = null;
const speech = { model: null, rec: null, recRate: 0, status: 'idle', error: null, heard: '', lastMatch: 0 };

// One model at a time, for the current language. Loads once per language; every
// caller waits on the same promise. A failed load (e.g. not downloaded yet) can be retried.
let modelPromise = null;
let modelLang = null;
function loadModel() {
  const lang = (settings && settings.language) || 'en';
  if (modelLang !== lang) {
    if (speech.rec) { speech.rec.remove(); speech.rec = null; }
    if (speech.model) speech.model.terminate();
    speech.model = null;
    modelPromise = null;
    modelLang = lang;
  }
  if (!modelPromise) {
    speech.status = 'loading';
    const url = MODEL_BASE + S.MODELS[lang].file;
    modelPromise = window.Vosk.createModel(url, -1).then((model) => {
      if (modelLang !== lang) { model.terminate(); return; } // language changed meanwhile
      speech.model = model;
      speech.status = 'ready';
      speech.error = null;
      ensureRecognizer();
    }).catch((e) => {
      if (modelLang !== lang) return;
      speech.status = 'error';
      speech.error = e.message || String(e);
      modelPromise = null;
    });
  }
  return modelPromise;
}

function ensureRecognizer() {
  if (!speech.model || !mic.ctx) return;
  if (speech.rec && speech.recRate === mic.ctx.sampleRate) return;
  if (speech.rec) speech.rec.remove();
  const rec = new speech.model.KaldiRecognizer(mic.ctx.sampleRate);
  rec.on('partialresult', (m) => onHeard({ partial: m.result.partial }));
  rec.on('result', (m) => onHeard({ final: m.result.text }));
  speech.rec = rec;
  speech.recRate = mic.ctx.sampleRate;
}

function onHeard(msg) {
  const text = msg.final != null ? msg.final : msg.partial;
  if (text) speech.heard = text.split(' ').slice(-8).join(' ');
  if (!playing || settings.mode !== 'track' || manualJump) return;
  const w = tracker.hear(msg);
  if (w !== null) speech.lastMatch = performance.now();
}

// --- microphone -----------------------------------------------------------

const mic = { stream: null, ctx: null, analyser: null, processor: null, buf: null, level: 0, lastVoice: 0, error: null, starting: false, retry: null };

async function startMic() {
  if (mic.stream || mic.starting) return;
  mic.starting = true;
  clearTimeout(mic.retry);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    // Raw audio for the recogniser.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (playing && settings.mode === 'track' && speech.rec) speech.rec.acceptWaveform(e.inputBuffer);
    };
    src.connect(processor);
    processor.connect(ctx.destination);
    // Unplugged headset, device switched off: start again on the new default device.
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', restartMic));
    Object.assign(mic, { stream, ctx, analyser, processor, buf: new Float32Array(analyser.fftSize), error: null });
    ensureRecognizer();
  } catch (e) {
    mic.error = e.message || String(e);
    // Try again shortly; the device may be busy or just plugged in.
    mic.retry = setTimeout(() => { if (needsMic()) startMic(); }, 3000);
  } finally {
    mic.starting = false;
  }
}

function stopMic() {
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  if (mic.ctx) mic.ctx.close().catch(() => {});
  Object.assign(mic, { stream: null, ctx: null, analyser: null, processor: null, level: 0 });
}

function restartMic() {
  stopMic();
  if (needsMic()) startMic();
}

function needsMic() {
  return (playing && settings.mode !== 'classic') || calibration.active;
}

navigator.mediaDevices.addEventListener('devicechange', () => { if (mic.stream) restartMic(); });

function readLevel() {
  if (!mic.analyser) return 0;
  mic.analyser.getFloatTimeDomainData(mic.buf);
  let sum = 0;
  for (let i = 0; i < mic.buf.length; i++) sum += mic.buf[i] * mic.buf[i];
  mic.level = mic.level * 0.7 + Math.sqrt(sum / mic.buf.length) * 0.3;
  return mic.level;
}

function hearingVoice(now) {
  if (readLevel() > settings.micThreshold) mic.lastVoice = now;
  return now - mic.lastVoice < settings.micHangMs;
}

// Calibration: two seconds of room noise, threshold a safe margin above it.
const calibration = { active: false, samples: [] };
async function calibrate() {
  calibration.active = true;
  calibration.samples = [];
  await startMic();
  setTimeout(() => {
    calibration.active = false;
    const s = calibration.samples.sort((a, b) => a - b);
    if (!s.length) return;
    const p90 = s[Math.floor(s.length * 0.9)];
    const threshold = Math.min(0.08, Math.max(0.004, p90 * 2.5));
    window.ontop.send('state:set', { settings: { micThreshold: Number(threshold.toFixed(4)) } });
    if (!needsMic()) stopMic();
  }, 2000);
}

// --- main loop ------------------------------------------------------------

function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  let active = false;

  if (settings) {
    let speaking = null;
    if (calibration.active) calibration.samples.push(readLevel());

    if (manualJump || pendingJump) {
      const step = pendingJump * Math.min(1, dt * 10);
      pos += step;
      pendingJump -= step;
      if (Math.abs(pendingJump) < 0.5) {
        pendingJump = 0;
        if (manualJump) {
          manualJump = false;
          // Word tracking resumes from wherever you moved the text to.
          if (tracker) tracker.setNextWord(wordAt(pos));
        }
      }
      active = true;
    } else if (settings.mode === 'track') {
      readLevel();
      if (tracker && tracker.word >= 0) {
        const target = Math.min(maxPos, wordTop(tracker.word + 1 < wordEls.length ? tracker.word + 1 : tracker.word));
        const delta = target - pos;
        if (Math.abs(delta) > 0.5) { pos += delta * Math.min(1, dt * 4); active = true; }
      }
      markRead(tracker ? tracker.word : -1);
      speaking = playing && now - speech.lastMatch < 2500;
      // Last word said: finish the run shortly after, like the other modes do at the end.
      if (playing && tracker && wordEls.length && tracker.word >= wordEls.length - 1 && now - speech.lastMatch > 1500) playing = false;
    } else {
      speaking = settings.mode === 'voice' ? hearingVoice(now) : true;
      const moving = playing && speaking && pos < maxPos;
      const target = moving ? (settings.wpm / 60) * pxPerWord : 0;
      velocity += (target - velocity) * Math.min(1, dt * 6);
      if (Math.abs(velocity) > 0.3) { pos += velocity * dt; active = true; }
      if (playing && pos >= maxPos && velocity < 1) playing = false;
    }
    pos = Math.max(0, Math.min(maxPos, pos));

    const y = viewport.clientHeight * settings.readingLine - lineHeightPx() / 2 - pos;
    textEl.style.transform = `translateY(${y}px)` + (settings.mirror ? ' scaleX(-1)' : '');

    updateHud(speaking, now);
    active = active || playing || calibration.active;
  }
  // Full frame rate only while something moves; otherwise tick slowly to save battery.
  if (active) requestAnimationFrame(frame);
  else idleTimer = setTimeout(() => { idleTimer = null; frame(); }, 200);
}

let lastStatus = 0;
function updateHud(speaking, now) {
  const dot = $('state-dot');
  const mode = settings.mode;
  let label;
  if (!playing) label = 'Paused';
  else if (mode === 'track' && speech.status === 'loading') label = 'Loading voice';
  else if (mode === 'track' && speech.status === 'error') label = 'Voice model failed';
  else if (mode !== 'classic' && mic.error) label = 'Mic unavailable';
  else if (mode === 'track') label = speaking ? 'Following' : 'Listening';
  else if (mode === 'voice') label = speaking ? `${settings.wpm} wpm` : 'Listening';
  else label = `${settings.wpm} wpm`;
  const waiting = playing && speaking === false;
  dot.className = playing ? (waiting ? 'waiting' : 'playing') : '';
  $('hud-text').textContent = label;
  if (DEMO && speech.heard) $('caption-text').textContent = speech.heard;
  drawBars();
  const progress = mode === 'track' && tracker && wordEls.length
    ? Math.max(0, tracker.word + 1) / wordEls.length
    : (maxPos ? pos / maxPos : 0);
  $('progress').firstElementChild.style.width = progress * 100 + '%';

  if (now - lastStatus > 125) {
    lastStatus = now;
    window.ontop.send('overlay:status', {
      playing,
      speaking: mode !== 'classic' ? speaking : null,
      level: mic.level,
      micError: mic.error,
      model: speech.status,
      modelError: speech.error,
      heard: mode === 'track' ? speech.heard : '',
      calibrating: calibration.active,
      progress,
      para: currentParagraph(),
      word: mode === 'track' && tracker && tracker.word >= 0 ? tracker.word + 1 : wordAt(pos),
      testAudioDone,
    });
  }
}

// Five bars that bounce with your voice; the middle ones react most.
const BAR_SHAPE = [0.55, 0.8, 1, 0.8, 0.55];
function drawBars() {
  const bars = $('bars').children;
  const loud = Math.min(1, mic.level / (settings.micThreshold * 2.5));
  const t = performance.now() / 120;
  for (let i = 0; i < bars.length; i++) {
    const wobble = 0.75 + 0.25 * Math.sin(t + i * 1.7);
    bars[i].style.height = 3 + 9 * loud * BAR_SHAPE[i] * wobble + 'px';
  }
}

// Index of the paragraph currently on the reading line.
function currentParagraph() {
  const half = lineHeightPx() / 2;
  let idx = 0;
  for (const p of textEl.children) {
    if (p.offsetTop <= pos + half) idx = Number(p.dataset.i);
    else break;
  }
  return idx;
}

// --- commands -------------------------------------------------------------

function jumpTo(target) {
  pendingJump = Math.max(0, Math.min(maxPos, target)) - pos;
  manualJump = true;
  kick();
}

function jumpBy(px) {
  jumpTo(pos + pendingJump + px);
}

// Put the first spoken word of paragraph i on the reading line.
function seek(i) {
  const p = textEl.querySelector(`p[data-i="${i}"]`);
  const first = p && p.querySelector('.w');
  if (first) jumpTo(wordTop(Number(first.dataset.w)));
}

const commands = {
  play() {
    playing = true;
    if (settings.mode !== 'classic') startMic();
    if (settings.mode === 'track') loadModel();
    kick();
  },
  pause() { playing = false; if (!calibration.active) stopMic(); },
  toggle() { playing ? commands.pause() : commands.play(); },
  reset() {
    playing = false;
    stopMic();
    pos = 0; pendingJump = 0; velocity = 0; manualJump = false;
    if (tracker) tracker.setNextWord(0);
    markRead(-1);
    kick();
  },
  back() { jumpBy(-lineHeightPx() * 2); },
  forward() { jumpBy(lineHeightPx() * 2); },
  lineUp() { jumpBy(-lineHeightPx()); },
  lineDown() { jumpBy(lineHeightPx()); },
  calibrate() { calibrate(); kick(); },
};

window.ontop.on('cmd', (cmd) => {
  if (cmd && typeof cmd === 'object') {
    if (Number.isInteger(cmd.seek)) return seek(cmd.seek);
    if (Number.isInteger(cmd.seekWord)) return jumpTo(wordTop(cmd.seekWord));
    if (typeof cmd.testAudio === 'string') return testAudio(cmd.testAudio, cmd.speed || 1);
    return;
  }
  if (commands[cmd]) commands[cmd]();
});

window.ontop.on('locked', (locked) => document.body.classList.toggle('locked', locked));

// Rehearsal clock from the main process: elapsed time and ahead/behind plan.
window.ontop.on('timer', (t) => {
  const clockEl = $('clock');
  const deltaEl = $('delta');
  clockEl.hidden = !t.running;
  deltaEl.hidden = !t.running || t.delta === null || t.delta === undefined;
  if (!t.running) return;
  clockEl.textContent = S.clock(t.elapsed);
  if (t.delta !== null && t.delta !== undefined) {
    const d = Math.round(t.delta);
    deltaEl.textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + S.clock(Math.abs(d));
    deltaEl.className = d > 10 ? 'behind' : d < -10 ? 'ahead' : 'on-time';
  }
});

window.ontop.on('state', (s) => {
  const scriptChanged = s.script !== script;
  const prevMode = settings && settings.mode;
  const prevLang = settings ? settings.language : undefined;
  settings = s.settings;
  script = s.script;
  applySettings();
  const langChanged = prevLang !== undefined && prevLang !== settings.language;
  if (scriptChanged || langChanged) render();
  else measure();
  if (settings.mode === 'track') loadModel();
  if (prevMode && prevMode !== settings.mode) {
    markRead(-1);
    if (settings.mode === 'track' && tracker) tracker.setNextWord(wordAt(pos));
    if (playing && settings.mode !== 'classic') startMic();
    if (settings.mode === 'classic' && !calibration.active) stopMic();
  }
  kick();
});

// Mouse wheel nudges the text when the overlay is unlocked.
window.addEventListener('wheel', (e) => { jumpBy(e.deltaY * 0.6); }, { passive: true });
window.addEventListener('resize', () => settings && measure());

// Wake the loop immediately instead of waiting for the next slow tick.
let idleTimer = null;
function kick() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

// Test hook: play a WAV file into the recogniser instead of the mic.
let testAudioDone = false;
async function testAudio(url, speed) {
  await loadModel();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const audio = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const rec = new speech.model.KaldiRecognizer(16000);
  rec.on('partialresult', (m) => onHeard({ partial: m.result.partial }));
  rec.on('result', (m) => onHeard({ final: m.result.text }));
  playing = true;
  const data = audio.getChannelData(0);
  const chunk = 1600;
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk);
    rec.acceptWaveformFloat(part, 16000);
    let sum = 0;
    for (let k = 0; k < part.length; k++) sum += part[k] * part[k];
    mic.level = mic.level * 0.5 + Math.sqrt(sum / part.length) * 0.5;
    await new Promise((r) => setTimeout(r, 100 / speed));
  }
  rec.retrieveFinalResult();
  mic.level = 0;
  testAudioDone = true;
}

frame();
