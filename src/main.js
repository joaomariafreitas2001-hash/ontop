// OnTop: main process.
// Two windows: a normal "editor" window for the script and settings, and a
// frameless transparent "overlay" that sits on top of everything (under the webcam).
// Both use setContentProtection -> SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
// on Windows 10 2004+, so Zoom/Teams/Meet/OBS screen captures don't show them.
// Pages load from a private ontop:// protocol so the speech model (a local
// file) can be fetched by the recognizer's web worker.

const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, nativeTheme, protocol, net, dialog, systemPreferences } = require('electron');

const IS_MAC = process.platform === 'darwin';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const https = require('https');
const { execFile } = require('child_process');
const execFileAsync = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (err) => (err ? rej(err) : res())));
const Markdown = require('./markdown.js');
const Script = require('./script.js');

// In the installed app the code sits in app.asar and the speech model next to it
// in resources/models (it is too large to pack and must be readable as a file).
const ROOT = path.join(__dirname, '..');
const MODELS = app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(ROOT, 'models');
const SMOKE = process.argv.includes('--smoke');
const VOSK_TEST = process.argv.includes('--vosk-test');
const TRACK_TEST = process.argv.includes('--track-test');
const LIBRARY_TEST = process.argv.includes('--library-test');
const SELF_TEST = process.argv.includes('--selftest');
const DEMO_GIF = process.argv.includes('--demo-gif');
const SCREENSHOTS = process.argv.includes('--screenshots');
const SETUP_TEST = process.argv.includes('--setup-test');
// Test and recording modes never write the user's settings file.
const TESTING = () => SMOKE || VOSK_TEST || TRACK_TEST || LIBRARY_TEST || SELF_TEST || !!MODELS_TEST || DEMO_GIF || SCREENSHOTS || SETUP_TEST;
const MODELS_TEST = (process.argv.find((a) => a.startsWith('--models-test=')) || '').split('=')[1] || null;
const ICON = path.join(ROOT, 'build', 'icon.ico');

// ontop://app/<path> -> file on disk. Only these folders are served.
const ROUTES = {
  'vendor/vosk.js': path.join(ROOT, 'node_modules', 'vosk-browser', 'dist', 'vosk.js'),
};
const SERVED_DIRS = app.isPackaged ? ['src'] : ['src', 'test'];

function resolveRoute(rel) {
  if (ROUTES[rel]) return ROUTES[rel];
  const top = rel.split('/')[0];
  const rest = rel.slice(top.length + 1);
  // Speech models: the bundled folder first, then models downloaded by the user.
  if (top === 'models') {
    for (const base of [MODELS, userModelsDir()]) {
      const resolved = path.normalize(path.join(base, rest));
      if (resolved.startsWith(base + path.sep) && fs.existsSync(resolved)) return resolved;
    }
    return null;
  }
  const base = SERVED_DIRS.includes(top) ? path.join(ROOT, top) : null;
  if (!base) return null;
  const resolved = path.normalize(path.join(base, rest));
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

// --- speech models --------------------------------------------------------------

const userModelsDir = () => path.join(app.getPath('userData'), 'models');
const modelInstalled = (lang) => !!resolveRoute('models/' + Script.MODELS[lang].file);
const downloads = {}; // lang -> { received, total } while downloading

function modelsStatus() {
  const out = {};
  for (const [lang, m] of Object.entries(Script.MODELS)) {
    out[lang] = { label: m.label, mb: m.mb, installed: modelInstalled(lang), downloading: downloads[lang] || null };
  }
  return out;
}

function pushModels() {
  send(editor, 'models', modelsStatus());
}

function fetchFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchFile(new URL(res.headers.location, url).toString(), dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = Number(res.headers['content-length']) || 0;
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => { received += chunk.length; onProgress(received, total); });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

// Download a language model from alphacephei.com (the Vosk project) and repack the
// zip as the tar.gz that vosk-browser loads. Uses the system tar (Windows 10+, macOS).
async function downloadModel(lang) {
  const m = Script.MODELS[lang];
  if (!m || downloads[lang] || modelInstalled(lang)) return;
  downloads[lang] = { received: 0, total: m.mb * 1e6 };
  pushModels();
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'ontop-model-'));
  try {
    let last = 0;
    await fetchFile(m.url, path.join(tmp, 'model.zip'), (received, total) => {
      downloads[lang] = { received, total: total || downloads[lang].total };
      if (Date.now() - last > 250) { last = Date.now(); pushModels(); }
    });
    await execFileAsync('tar', ['-xf', path.join(tmp, 'model.zip'), '-C', tmp]);
    if (!fs.existsSync(path.join(tmp, m.dir))) throw new Error('unexpected archive layout');
    fs.mkdirSync(userModelsDir(), { recursive: true });
    const partial = path.join(userModelsDir(), m.file + '.part');
    await execFileAsync('tar', ['-czf', partial, '-C', tmp, m.dir]);
    fs.renameSync(partial, path.join(userModelsDir(), m.file));
  } catch (e) {
    dialog.showErrorBox('Download failed', `${m.label} speech model: ${e.message}`);
  } finally {
    delete downloads[lang];
    fs.rmSync(tmp, { recursive: true, force: true });
    pushModels();
    broadcastState(); // the overlay retries loading the model for the current language
  }
}

ipcMain.on('models', (_e, msg) => {
  if (msg && msg.op === 'download') downloadModel(msg.lang);
  else pushModels();
});

// Test modes print to stdout; if whoever reads it stops early, don't crash.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

protocol.registerSchemesAsPrivileged([
  { scheme: 'ontop', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const DEFAULT_SCRIPT = `[Welcome · 0:00]
Welcome to OnTop. Press play, then read this out loud. The text follows the words you say, and the line you are on stays next to your camera.

[How it works · 0:15]
Nobody else can see this window. It is hidden from screen sharing and from recordings, so only you can read it.

If you stop talking, the text waits for you. If you go off script, it waits too. Start a sentence again and it goes back.

[Your own script · 0:35]
Paste your own text in the editor, or import a Markdown note. Headings become sections like the ones on the left, and a time after the heading becomes your plan.

[Shortcuts · 0:50]
Control Alt P starts and pauses. Control Alt L locks the window so your clicks go through it. Press one or two to move a line up or down.`;

const DEFAULTS = {
  script: DEFAULT_SCRIPT,
  settings: {
    mode: 'track',          // 'track' = follow your words, 'voice' = scroll while you speak, 'classic' = constant speed
    language: 'en',         // speech model for word tracking: en, pt, es
    wpm: 140,               // reading speed in words per minute
    fontSize: 30,
    lineHeight: 1.35,
    paraGap: 0.2,           // space between paragraphs, in em
    textColor: '#ffffff',
    cueColor: '#ffd60a',
    bgOpacity: 0.55,
    width: 620,
    height: 260,
    readingLine: 0.35,      // where the "current line" marker sits (0 = top, 1 = bottom)
    mirror: false,
    hideFromCapture: true,
    numberKeys: true,       // 1 = up a line, 2 = down a line, from any app
    micThreshold: 0.015,    // RMS level that counts as "speaking"
    micHangMs: 500,         // keep scrolling this long after you stop talking
  },
  bounds: null,
  locked: false,
};

const HOTKEYS = {
  'CommandOrControl+Alt+P': 'toggle',
  'CommandOrControl+Alt+Up': 'faster',
  'CommandOrControl+Alt+Down': 'slower',
  'CommandOrControl+Alt+Left': 'back',
  'CommandOrControl+Alt+Right': 'forward',
  'CommandOrControl+Alt+Home': 'reset',
  'CommandOrControl+Alt+L': 'lock',
  'CommandOrControl+Alt+H': 'visibility',
};

// Bare number keys (and the numpad ones). These block typing 1/2 in other apps,
// so they can be switched off, and they pause while you type in the editor.
const NUMBER_KEYS = { '1': 'lineUp', num1: 'lineUp', '2': 'lineDown', num2: 'lineDown' };

let state;
let editor = null;
let overlay = null;
let hotkeyErrors = [];
let numberKeyErrors = [];
let lastOverlayStatus = {};

// --- persistence ----------------------------------------------------------

const storePath = () => path.join(app.getPath('userData'), 'settings.json');
// Builds from before the rename kept their data in %APPDATA%\prompter\prompter.json.
const legacyStorePath = () => path.join(app.getPath('appData'), 'prompter', 'prompter.json');

const newId = () => crypto.randomUUID();

function load() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch {
    try { s = JSON.parse(fs.readFileSync(legacyStorePath(), 'utf8')); } catch {}
  }
  // Older versions kept a single `script`; it becomes the first library entry.
  let scripts = Array.isArray(s.scripts) ? s.scripts : null;
  if (!scripts || !scripts.length) {
    scripts = [{ id: newId(), name: s.script ? 'My script' : 'Welcome', text: typeof s.script === 'string' ? s.script : DEFAULTS.script, source: null }];
  }
  const activeId = scripts.some((x) => x.id === s.activeId) ? s.activeId : scripts[0].id;
  const st = {
    scripts,
    activeId,
    settings: { ...DEFAULTS.settings, ...(s.settings || {}) },
    bounds: s.bounds || null,
    locked: !!s.locked,
    runs: Array.isArray(s.runs) ? s.runs : [],
  };
  st.script = scripts.find((x) => x.id === activeId).text;
  return st;
}

function active() {
  return state.scripts.find((x) => x.id === state.activeId) || state.scripts[0];
}

// --- script library ---------------------------------------------------------

function readSource(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.(md|markdown|txt)$/i, '');
  if (/\.txt$/i.test(file)) return { name: base, script: raw.replace(/\r\n?/g, '\n').trim() };
  return Markdown.convert(raw, base);
}

// Linked scripts follow their file: edit the note (e.g. in Obsidian), the script updates.
const watched = new Map();
function watchSources() {
  const want = new Set(state.scripts.filter((x) => x.source).map((x) => x.source.path));
  for (const [file, fn] of watched) if (!want.has(file)) { fs.unwatchFile(file, fn); watched.delete(file); }
  for (const file of want) {
    if (watched.has(file)) continue;
    const fn = () => refreshSource(file);
    fs.watchFile(file, { interval: 1000 }, fn);
    watched.set(file, fn);
  }
}

function refreshSource(file) {
  let parsed;
  try { parsed = readSource(file); } catch { return; } // mid-save or moved: try on the next change
  let changed = false;
  for (const s of state.scripts) {
    if (!s.source || s.source.path !== file) continue;
    s.source.missing = false;
    if (s.text !== parsed.script) { s.text = parsed.script; s.updated = Date.now(); changed = true; }
  }
  if (changed) { syncActive(); save(); broadcastState(); }
}

function syncActive() {
  state.script = active().text;
}

function selectScript(id) {
  if (!state.scripts.some((x) => x.id === id)) return;
  if (id !== state.activeId) finishRun();
  state.activeId = id;
  syncActive();
  send(overlay, 'cmd', 'reset');
}

ipcMain.on('library', async (_e, msg) => {
  const { op } = msg || {};
  if (op === 'new') {
    const s = { id: newId(), name: 'Untitled script', text: '', source: null };
    state.scripts.unshift(s);
    selectScript(s.id);
  } else if (op === 'select') {
    selectScript(msg.id);
  } else if (op === 'rename') {
    const s = state.scripts.find((x) => x.id === msg.id);
    if (s && typeof msg.name === 'string' && msg.name.trim()) s.name = msg.name.trim().slice(0, 120);
  } else if (op === 'delete') {
    if (state.scripts.length <= 1) return;
    state.scripts = state.scripts.filter((x) => x.id !== msg.id);
    if (state.activeId === msg.id) selectScript(state.scripts[0].id);
  } else if (op === 'unlink') {
    const s = state.scripts.find((x) => x.id === msg.id);
    if (s) s.source = null;
  } else if (op === 'duplicate') {
    const s = state.scripts.find((x) => x.id === msg.id);
    if (s) { const copy = { id: newId(), name: s.name + ' copy', text: s.text, source: null }; state.scripts.unshift(copy); selectScript(copy.id); }
  } else if (op === 'import') {
    const res = await dialog.showOpenDialog(editor, {
      title: 'Import scripts',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown or text', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (res.canceled) return;
    let last = null;
    for (const file of res.filePaths) {
      const existing = state.scripts.find((x) => x.source && x.source.path === file);
      if (existing) { refreshSource(file); last = existing.id; continue; }
      try {
        const { name, script } = readSource(file);
        const s = { id: newId(), name, text: script, source: { path: file } };
        state.scripts.unshift(s);
        last = s.id;
      } catch (err) {
        dialog.showErrorBox('Could not import', `${path.basename(file)}: ${err.message}`);
      }
    }
    if (last) selectScript(last);
  }
  watchSources();
  syncActive();
  save();
  broadcastState();
});

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (TESTING()) return;
  try { fs.writeFileSync(storePath(), JSON.stringify(state, null, 2)); } catch (e) { console.error('save failed', e); }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

// --- messaging ------------------------------------------------------------

function send(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function broadcastState() {
  send(overlay, 'state', state);
  send(editor, 'state', state);
}

function pushStatus() {
  send(editor, 'status', {
    ...lastOverlayStatus,
    locked: state.locked,
    visible: !!overlay && !overlay.isDestroyed() && overlay.isVisible(),
    hotkeyErrors: [...hotkeyErrors, ...numberKeyErrors],
  });
}

// --- overlay --------------------------------------------------------------

function setLocked(value) {
  state.locked = value;
  save();
  if (overlay && !overlay.isDestroyed()) {
    overlay.setIgnoreMouseEvents(value, { forward: true });
    overlay.setResizable(!value);
    send(overlay, 'locked', value);
  }
  pushStatus();
}

// Default spot: top-centre of the primary display, right under a laptop webcam.
function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const { width, height } = state.settings;
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: workArea.y + 6, width, height };
}

// Saved bounds can point at a monitor that is no longer connected.
function visibleBounds(b) {
  if (!b) return defaultBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const overlapX = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x);
  const overlapY = Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y);
  if (overlapX < Math.min(120, b.width) || overlapY < Math.min(60, b.height)) return defaultBounds();
  return b;
}

function createOverlay() {
  const b = visibleBounds(state.bounds);
  overlay = new BrowserWindow({
    ...b,
    minWidth: 240,
    minHeight: 90,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: !state.locked,
    fullscreenable: false,
    title: 'OnTop overlay',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setContentProtection(!!state.settings.hideFromCapture);
  overlay.setIgnoreMouseEvents(state.locked, { forward: true });
  overlay.loadURL('ontop://app/src/overlay.html');
  overlay.webContents.on('did-finish-load', () => {
    send(overlay, 'state', state);
    send(overlay, 'locked', state.locked);
  });

  const remember = () => {
    if (!overlay || overlay.isDestroyed()) return;
    state.bounds = overlay.getBounds();
    save();
  };
  overlay.on('moved', remember);
  overlay.on('resized', remember);
  overlay.on('show', pushStatus);
  overlay.on('hide', pushStatus);
  overlay.on('closed', () => { overlay = null; });
}

// --- editor ---------------------------------------------------------------

// Match the native caption buttons (min/max/close) to the toolbar in light and dark mode.
function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    window: dark ? '#1c1c1e' : '#f5f5f7',
    overlay: { color: dark ? '#242426' : '#f6f6f8', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 52 },
  };
}

nativeTheme.on('updated', () => {
  if (editor && !editor.isDestroyed() && !IS_MAC) {
    editor.setTitleBarOverlay(themeColors().overlay);
    editor.setBackgroundColor(themeColors().window);
  }
});

function createEditor() {
  editor = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    title: 'OnTop',
    icon: ICON,
    backgroundColor: themeColors().window,
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: themeColors().overlay }),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  editor.setContentProtection(!!state.settings.hideFromCapture);
  editor.loadURL('ontop://app/src/editor.html');
  editor.webContents.on('did-finish-load', () => {
    send(editor, 'state', state);
    pushStatus();
    pushModels();
  });
  editor.on('focus', () => updateNumberKeys());
  editor.on('blur', () => updateNumberKeys());
  // Closing the editor quits the app (the overlay has no close button of its own).
  editor.on('closed', () => { editor = null; app.quit(); });
}

// Hide both windows from screen share: the editor holds the full script too.
function applyCaptureProtection() {
  for (const win of [overlay, editor]) {
    if (win && !win.isDestroyed()) win.setContentProtection(!!state.settings.hideFromCapture);
  }
}

// --- commands -------------------------------------------------------------

function command(cmd) {
  if (cmd === 'lock') return setLocked(!state.locked);
  if (cmd === 'visibility') {
    if (!overlay) return;
    overlay.isVisible() ? overlay.hide() : overlay.showInactive();
    return pushStatus();
  }
  if (cmd === 'faster' || cmd === 'slower') {
    const step = cmd === 'faster' ? 5 : -5;
    state.settings.wpm = Math.max(40, Math.min(400, state.settings.wpm + step));
    save();
    broadcastState();
    return;
  }
  if (cmd === 'center') {
    if (!overlay) return;
    // Centre on the display the overlay is on, not always the primary one.
    const { workArea } = screen.getDisplayMatching(overlay.getBounds());
    const [w, h] = overlay.getSize();
    overlay.setBounds({ x: Math.round(workArea.x + (workArea.width - w) / 2), y: workArea.y + 6, width: w, height: h });
    return;
  }
  if (cmd === 'reset') finishRun();
  if (cmd === 'clearRuns') {
    state.runs = state.runs.filter((r) => r.scriptId !== state.activeId);
    save();
    return broadcastState();
  }
  send(overlay, 'cmd', cmd);
}

function registerHotkeys() {
  hotkeyErrors = [];
  for (const [accel, cmd] of Object.entries(HOTKEYS)) {
    const ok = globalShortcut.register(accel, () => command(cmd));
    if (!ok) hotkeyErrors.push(accel);
  }
  updateNumberKeys();
}

function updateNumberKeys() {
  if (!state) return;
  const want = !!state.settings.numberKeys && !(editor && !editor.isDestroyed() && editor.isFocused());
  numberKeyErrors = [];
  for (const [accel, cmd] of Object.entries(NUMBER_KEYS)) {
    const has = globalShortcut.isRegistered(accel);
    if (want && !has && !globalShortcut.register(accel, () => command(cmd))) numberKeyErrors.push(accel);
    if (!want && has) globalShortcut.unregister(accel);
  }
}

ipcMain.on('state:set', (_e, patch) => {
  if (typeof patch.script === 'string' && !active().source) {
    active().text = patch.script;
    active().updated = Date.now();
    syncActive();
  }
  if (patch.settings) {
    const prevCapture = state.settings.hideFromCapture;
    state.settings = { ...state.settings, ...patch.settings };
    if (prevCapture !== state.settings.hideFromCapture) applyCaptureProtection();
    updateNumberKeys();
  }
  save();
  broadcastState();
});

ipcMain.on('cmd', (_e, cmd) => command(cmd));

// Voice setup: the overlay listens, the editor shows the steps.
ipcMain.on('setup:event', (_e, ev) => send(editor, 'setup', ev));

ipcMain.on('overlay:status', (_e, status) => {
  lastOverlayStatus = status;
  tickRun(status);
  pushStatus();
});

// --- rehearsal timer ----------------------------------------------------------
// A run starts on play, counts time only while playing, records when each section
// is reached and compares it with the planned start ([... · 1:55]). It ends on
// reset, when you switch script, or at the end of the script, and is saved.

let run = null;

function startRun() {
  const sections = Script.sections(state.script);
  run = {
    id: newId(),
    scriptId: state.activeId,
    scriptName: active().name,
    startedAt: new Date().toISOString(),
    elapsed: 0,
    lastTick: null,
    current: -1,
    sections: sections.map((s) => ({ title: s.title, num: s.num, planned: s.planned, actual: null, para: s.para })),
  };
}

function tickRun(st) {
  const now = Date.now();
  if (st.playing && !run) startRun();
  if (!run) return;
  if (st.playing) {
    if (run.lastTick !== null) run.elapsed += (now - run.lastTick) / 1000;
    run.lastTick = now;
    // Entering a section (or skipping several at once).
    let idx = -1;
    run.sections.forEach((s, i) => { if (s.para <= st.para) idx = i; });
    for (let i = run.current + 1; i <= idx; i++) if (run.sections[i].actual === null) run.sections[i].actual = run.elapsed;
    if (idx > run.current) run.current = idx;
  } else {
    run.lastTick = null;
  }
  if (st.progress >= 0.995 && !st.playing) finishRun(true);
  pushTimer();
}

// Seconds ahead (-) or behind (+) plan right now, or null without planned times.
function runDelta() {
  if (!run || run.current < 0) return null;
  const cur = run.sections[run.current];
  if (cur.planned === null || cur.actual === null) return null;
  let delta = cur.actual - cur.planned;
  // Still in this section after the next one should have started: you're behind.
  const next = run.sections.slice(run.current + 1).find((s) => s.planned !== null);
  if (next && run.elapsed > next.planned) delta = Math.max(delta, run.elapsed - next.planned);
  return delta;
}

function timerPayload() {
  if (!run) return { running: false };
  const cur = run.sections[run.current];
  return { running: true, elapsed: run.elapsed, delta: runDelta(), section: cur ? cur.title : null, sections: run.sections.map((s) => s.actual) };
}

let lastTimerSent = 0;
function pushTimer(force) {
  const now = Date.now();
  if (!force && now - lastTimerSent < 250) return;
  lastTimerSent = now;
  const t = timerPayload();
  send(editor, 'timer', t);
  send(overlay, 'timer', t);
}

function finishRun(completed = false) {
  if (!run) return;
  if (run.elapsed >= 20) {
    state.runs.unshift({
      id: run.id,
      scriptId: run.scriptId,
      scriptName: run.scriptName,
      startedAt: run.startedAt,
      total: Math.round(run.elapsed),
      completed,
      sections: run.sections.map(({ title, num, planned, actual }) => ({ title, num, planned, actual: actual === null ? null : Math.round(actual) })),
    });
    state.runs = state.runs.slice(0, 100);
    save();
    broadcastState();
  }
  run = null;
  pushTimer(true);
}

// --- tests ----------------------------------------------------------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Smoke test: render both windows, save screenshots next to the project, quit.
async function smoke() {
  const out = path.join(ROOT, 'smoke');
  fs.mkdirSync(out, { recursive: true });
  await wait(2500);
  // Constant-speed mode for the test (not saved), so we can check that the text moves.
  send(overlay, 'state', { ...state, settings: { ...state.settings, mode: 'classic' } });
  send(overlay, 'cmd', 'play');
  await wait(3000);
  for (const [name, win] of [['overlay.png', overlay], ['editor.png', editor]]) {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name), img.toPNG());
  }
  // Number keys: registered once the editor loses focus, and each press moves one line.
  send(overlay, 'cmd', 'pause');
  overlay.focus();
  await wait(600);
  const numberKeys = Object.keys(NUMBER_KEYS).map((k) => `${k}:${globalShortcut.isRegistered(k)}`);
  const before = lastOverlayStatus.progress;
  command('lineDown'); command('lineDown');
  await wait(800);
  const afterDown = lastOverlayStatus.progress;
  command('lineUp');
  await wait(800);
  const afterUp = lastOverlayStatus.progress;
  fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify({ lastOverlayStatus, hotkeyErrors, numberKeys, before, afterDown, afterUp, locked: state.locked }, null, 2));
  app.quit();
}

// Speech test page: prints recogniser output to stdout, then quits.
function voskTest() {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log(message);
    if (message === 'DONE') app.quit();
  });
  // Pass --model=, --chunk=, --grammar= through as query parameters.
  const query = process.argv.filter((a) => /^--(model|chunk|grammar)=/.test(a)).map((a) => a.slice(2)).join('&');
  win.loadURL('ontop://app/test/vosk-test.html' + (query ? '?' + query : ''));
  setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 120000);
}

// Word-tracking test: play test/speech.wav (the fixture script read by the Windows
// voice, see test/make-speech.ps1) into the overlay, log where the tracker is each
// second, screenshot at the end. Nothing is saved to the user's library.
async function trackTest() {
  const out = path.join(ROOT, 'smoke');
  fs.mkdirSync(out, { recursive: true });
  overlay.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[overlay] ' + message); });
  await wait(2500);
  const fixture = fs.readFileSync(path.join(ROOT, 'test', 'fixture-script.txt'), 'utf8').trim();
  state.script = fixture;
  send(overlay, 'state', { ...state, settings: { ...state.settings, mode: 'track' } });
  send(editor, 'state', state);
  send(overlay, 'cmd', 'reset');
  await wait(300);
  const wav = (process.argv.find((a) => a.startsWith('--wav=')) || '--wav=speech.wav').slice(6);
  send(overlay, 'cmd', { testAudio: 'ontop://app/test/' + wav });
  const log = [];
  editor.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[editor] ' + message); });
  for (let s = 0; s < 40; s++) {
    await wait(1000);
    const st = lastOverlayStatus;
    log.push(`${s + 1}s word=${st.word} para=${st.para} speaking=${st.speaking} heard="${st.heard || ''}"`);
  }
  fs.writeFileSync(path.join(out, 'track.log'), log.join('\n'));
  const timerAtEnd = timerPayload();
  fs.writeFileSync(path.join(out, 'track-editor-live.png'), (await editor.webContents.capturePage()).toPNG());
  const runsBefore = state.runs.slice();
  command('reset');
  await wait(800);
  fs.writeFileSync(path.join(out, 'track-run.json'), JSON.stringify({ timerAtEnd, saved: state.runs[0] }, null, 2));
  state.runs = runsBefore;
  syncActive();
  saveNow();
  fs.writeFileSync(path.join(out, 'track.png'), (await overlay.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(out, 'track-editor.png'), (await editor.webContents.capturePage()).toPNG());
  app.quit();
}

// Library test: link a temporary Markdown note, edit it on disk, check the script
// follows; then restore the user's library untouched.
async function libraryTest() {
  const out = path.join(ROOT, 'smoke');
  fs.mkdirSync(out, { recursive: true });
  const saved = structuredClone({ scripts: state.scripts, activeId: state.activeId });
  const file = path.join(out, 'linked-note.md');
  fs.writeFileSync(file, '# Test talk\n\n## Slide 1, Hello (0:00)\nFirst version of the text.\n');
  await wait(2000);
  const { name, script } = readSource(file);
  const s = { id: newId(), name, text: script, source: { path: file } };
  state.scripts.unshift(s);
  selectScript(s.id);
  watchSources();
  broadcastState();
  await wait(1500);
  const before = active().text;
  fs.writeFileSync(file, '# Test talk\n\n## Slide 1, Hello (0:00)\nSecond version, edited in Obsidian.\n');
  await wait(3000);
  const after = active().text;
  fs.writeFileSync(path.join(out, 'library-editor.png'), (await editor.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(out, 'library.json'), JSON.stringify({ name, before, after, updated: before !== after }, null, 2));
  Object.assign(state, saved);
  syncActive();
  saveNow();
  app.quit();
}

// Language test: download a model through the app (as the Download button does),
// then switch the overlay to it and check it loads. Usage: --models-test=pt
async function modelsTest(lang) {
  if (overlay.webContents.isLoading()) await new Promise((r) => overlay.webContents.once('did-finish-load', r));
  const before = modelInstalled(lang);
  const t0 = Date.now();
  await downloadModel(lang);
  const downloadSeconds = Math.round((Date.now() - t0) / 1000);
  send(overlay, 'state', { ...state, settings: { ...state.settings, mode: 'track', language: lang } });
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    await wait(500);
    if (lastOverlayStatus.model === 'ready' || lastOverlayStatus.model === 'error') break;
  }
  const result = { lang, installedBefore: before, installedAfter: modelInstalled(lang), downloadSeconds, model: lastOverlayStatus.model, modelError: lastOverlayStatus.modelError || null, file: resolveRoute('models/' + Script.MODELS[lang].file) };
  fs.writeFileSync(path.join(ROOT, 'smoke', 'models-test.json'), JSON.stringify(result, null, 2));
  app.quit();
}

// README animation: render the overlay's demo stage off-screen, play the fixture
// speech into it and encode what it shows as docs/demo.gif. Usage: npm run demo
async function demoGif() {
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');
  const W = 720, H = 330, FPS = 8, SPEED = 1.35, COLORS = 96;
  overlay = new BrowserWindow({
    width: W, height: H, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: true, backgroundThrottling: false },
  });
  overlay.webContents.setFrameRate(30);
  let latest = null;
  overlay.webContents.on('paint', (_e, _dirty, image) => { latest = image; });
  await overlay.loadURL('ontop://app/src/overlay.html?demo');
  const script = fs.readFileSync(path.join(ROOT, 'test', 'fixture-script.txt'), 'utf8').trim();
  state.script = script;
  send(overlay, 'state', {
    ...state,
    script,
    settings: { ...DEFAULTS.settings, mode: 'track', language: 'en', fontSize: 25, lineHeight: 1.32, paraGap: 0.25, readingLine: 0.4, bgOpacity: 0.6 },
  });
  const t0 = Date.now();
  while (lastOverlayStatus.model !== 'ready' && Date.now() - t0 < 60000) await wait(250);
  send(overlay, 'cmd', 'reset');
  await wait(1200); // a still opening frame
  send(overlay, 'cmd', { testAudio: 'ontop://app/test/speech.wav', speed: SPEED });

  const gif = GIFEncoder();
  let frames = 0, prev = null, holdMs = 0;
  const flush = (img) => {
    const { width, height } = img.getSize();
    const bgra = img.toBitmap();
    const rgba = new Uint8ClampedArray(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255; }
    const palette = quantize(rgba, COLORS);
    gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: holdMs });
    frames++;
  };
  const started = Date.now();
  let doneAt = null;
  while (Date.now() - started < 60000) {
    await wait(1000 / FPS);
    if (!latest) continue;
    const img = latest.getSize().width === W ? latest : latest.resize({ width: W, height: H });
    if (lastOverlayStatus.testAudioDone && !doneAt) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt > 2500) break;
    if (frames === 60) fs.writeFileSync(path.join(ROOT, 'smoke', 'demo-frame.png'), img.toPNG());
    // Identical frames are merged into one longer frame to keep the file small.
    if (prev && img.toBitmap().equals(prev.toBitmap())) { holdMs += 1000 / FPS; continue; }
    if (prev) flush(prev);
    prev = img;
    holdMs = 1000 / FPS;
  }
  holdMs += 2000; // linger on the last frame before looping
  if (prev) flush(prev);
  gif.finish();
  const out = path.join(ROOT, 'docs', 'demo.gif');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gif.bytes());
  console.log(JSON.stringify({ frames, seconds: Math.round((Date.now() - started) / 1000), kb: Math.round(fs.statSync(out).size / 1024) }));
  app.quit();
}

// README screenshot of the editor, with a generic sample library held in memory
// (never the user's scripts). Usage: npm run screenshots
function sampleState() {
  const quarterly = fs.readFileSync(path.join(ROOT, 'test', 'fixture-script.txt'), 'utf8').trim();
  const conference = '[Hook · 0:00]\nEvery week, your team spends hours preparing updates nobody reads.\n\n[The idea · 0:20]\nWhat if the update wrote itself from the work you already do?';
  const scripts = [
    { id: newId(), name: 'Quarterly review', text: quarterly, source: null },
    { id: newId(), name: 'Conference talk', text: conference, source: { path: 'C:\\Talks\\conference-talk.md' } },
    { id: newId(), name: 'Welcome to OnTop', text: DEFAULT_SCRIPT, source: null },
  ];
  const run = (daysAgo, total, actuals) => ({
    id: newId(), scriptId: scripts[0].id, scriptName: scripts[0].name, completed: true, total,
    startedAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
    sections: [['Opening', 0], ['Results', 15], ['Next steps', 30]].map(([title, planned], i) => ({ title, num: '', planned, actual: actuals[i] })),
  });
  const st = {
    scripts,
    activeId: scripts[0].id,
    settings: { ...DEFAULTS.settings },
    bounds: null,
    locked: true,
    runs: [run(1, 41, [0, 17, 33]), run(2, 44, [0, 18, 36]), run(3, 47, [0, 19, 38])],
  };
  st.script = quarterly;
  return st;
}

async function screenshots() {
  await new Promise((r) => (editor.webContents.isLoading() ? editor.webContents.once('did-finish-load', r) : r()));
  const t0 = Date.now();
  while (lastOverlayStatus.model !== 'ready' && Date.now() - t0 < 60000) await wait(250);
  send(overlay, 'cmd', 'reset');
  send(overlay, 'cmd', { testAudio: 'ontop://app/test/speech.wav', speed: 1 });
  await wait(17000); // into the "Results" section
  const img = await editor.webContents.capturePage();
  const out = path.join(ROOT, 'docs', 'editor.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: 1600 }).toPNG());
  console.log(JSON.stringify({ saved: out, kb: Math.round(fs.statSync(out).size / 1024) }));
  app.quit();
}

// Voice setup test: generic script, recordings instead of the mic, the editor's
// buttons clicked like a user would. Nothing is saved (TESTING). Usage: npm run test:setup
async function setupTest() {
  const out = path.join(ROOT, 'smoke');
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => (editor.webContents.isLoading() ? editor.webContents.once('did-finish-load', r) : r()));
  await wait(1500);
  const t = (f) => 'ontop://app/test/' + f;
  send(overlay, 'cmd', { setupTest: {
    s0: t('setup-s0.wav'), s1: t('setup-s1.wav'), s2: t('setup-s2.wav'),
    w0: t('setup-w-EMIR.wav'), w1: t('setup-w-Northwind.wav'), w2: t('setup-w-Bank.wav'), w3: t('setup-w-Lisbon.wav'),
  } });
  const js = (code) => editor.webContents.executeJavaScript(code);
  await js("document.getElementById('btn-voice-setup').click(); document.getElementById('setup-next').click();");
  const shots = { sentence: false, words: false, done: false };
  const log = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await wait(400);
    const ui = await js("({ open: !document.getElementById('setup').hidden, title: document.getElementById('setup-title').textContent, body: document.getElementById('setup-body').innerText.replace(/\\s+/g, ' ').slice(0, 160), ready: !document.getElementById('setup-next').disabled, next: document.getElementById('setup-next').textContent })");
    if (!ui.open) break;
    const step = /Read this/.test(ui.title) ? 'sentence' : /Say each/.test(ui.title) ? 'words' : /All set/.test(ui.title) ? 'done' : null;
    if (ui.ready) {
      log.push(`${ui.title} | ${ui.body}`);
      if (step && !shots[step]) {
        shots[step] = true;
        fs.writeFileSync(path.join(out, `setup-${step}.png`), (await editor.webContents.capturePage()).toPNG());
      }
      await js("document.getElementById('setup-next').click()");
    }
  }
  const v = state.settings.voice || null;
  fs.writeFileSync(path.join(out, 'setup.json'), JSON.stringify({
    steps: log,
    micThreshold: state.settings.micThreshold,
    wpm: state.settings.wpm,
    voice: v && { ...v, aliases: v.aliases },
  }, null, 2));
  app.quit();
}

// Self-test for the installed app: does the speech model load, do the hotkeys
// register? Prints one JSON line and quits. Usage: OnTop.exe --selftest
async function selfTest() {
  if (overlay.webContents.isLoading()) await new Promise((r) => overlay.webContents.once('did-finish-load', r));
  await wait(300);
  send(overlay, 'state', { ...state, settings: { ...state.settings, mode: 'track' } });
  const started = Date.now();
  while (Date.now() - started < 60000) {
    await wait(500);
    if (lastOverlayStatus.model === 'ready' || lastOverlayStatus.model === 'error') break;
  }
  const modelLoadSeconds = Math.round((Date.now() - started) / 100) / 10;
  const model = lastOverlayStatus.model;
  const modelError = lastOverlayStatus.modelError || null;
  // Open the microphone briefly (16 kHz capture for the recogniser), then stop.
  send(overlay, 'cmd', 'play');
  await wait(2500);
  const mic = { error: lastOverlayStatus.micError || null, sampleRate: lastOverlayStatus.micRate || null };
  send(overlay, 'cmd', 'reset');
  const result = {
    version: app.getVersion(),
    packaged: app.isPackaged,
    model,
    modelError,
    modelLoadSeconds,
    mic,
    hotkeyErrors,
    numberKeyErrors,
    userData: app.getPath('userData'),
  };
  console.log(JSON.stringify(result));
  fs.writeFileSync(path.join(app.getPath('temp'), 'ontop-selftest.json'), JSON.stringify(result, null, 2));
  app.quit();
}

// --- app lifecycle --------------------------------------------------------

// One OnTop at a time: a second launch just brings the first to the front.
const gotLock = SMOKE || VOSK_TEST || TRACK_TEST || LIBRARY_TEST || SELF_TEST || MODELS_TEST || DEMO_GIF || SCREENSHOTS || SETUP_TEST || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!editor) return;
    if (editor.isMinimized()) editor.restore();
    editor.show();
    editor.focus();
  });

  app.whenReady().then(() => {
    protocol.handle('ontop', (request) => {
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
      const file = resolveRoute(rel);
      if (!file) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });

    // Allow the overlay to use the microphone for voice-activated scrolling.
    if (IS_MAC && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') systemPreferences.askForMediaAccess('microphone');
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

    if (VOSK_TEST) return voskTest();

    state = SCREENSHOTS || SETUP_TEST ? sampleState() : load();
    if (SETUP_TEST) {
      const text = fs.readFileSync(path.join(ROOT, 'test', 'setup-script.txt'), 'utf8');
      state.scripts[0].text = text;
      state.script = text;
    }
    if (DEMO_GIF) return demoGif();
    // First launch (or first after the rename): write the settings file right away.
    if (!fs.existsSync(storePath()) && !SMOKE && !TRACK_TEST && !LIBRARY_TEST && !SELF_TEST && !MODELS_TEST) saveNow();
    watchSources();
    createEditor();
    createOverlay();
    registerHotkeys();
    if (SMOKE) smoke();
    if (TRACK_TEST) trackTest();
    if (LIBRARY_TEST) libraryTest();
    if (SELF_TEST) selfTest();
    if (MODELS_TEST) modelsTest(MODELS_TEST);
    if (SCREENSHOTS) screenshots();
    if (SETUP_TEST) setupTest();
  });

  app.on('before-quit', () => { if (state && saveTimer) saveNow(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
