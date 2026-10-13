// Voice setup: a one-minute walkthrough that learns how this person sounds.
//   1. three seconds of silence     -> room noise level
//   2. three sentences read aloud   -> voice level, speaking pace, how well it is understood
//   3. the script's tricky words    -> how the recogniser hears each name/acronym; words it
//                                      gets wrong are saved as learned pronunciations
// The overlay does the listening (it owns the mic and the model); this file runs the steps.
// Shares the editor's globals: $, send, settings, scriptEl.

(function () {
  const S = window.OnTopScript;

  const SENTENCES = {
    en: [
      'The quick brown fox jumps over the lazy dog near the river bank.',
      'Please call Stella and ask her to bring these things with her from the store.',
      'Our results this quarter were stronger than we expected in every region.',
    ],
    pt: [
      'O rápido cão castanho salta sobre a cerca perto do rio.',
      'Por favor liga à Maria e pede para trazer os documentos da reunião.',
      'Os resultados deste trimestre foram melhores do que esperávamos.',
    ],
    es: [
      'El rápido zorro marrón salta sobre el perro perezoso junto al río.',
      'Por favor llama a María y pídele que traiga los documentos de la reunión.',
      'Los resultados de este trimestre fueron mejores de lo que esperábamos.',
    ],
  };

  const el = (id) => document.getElementById(id);
  const sheet = el('setup');
  const body = el('setup-body');
  const title = el('setup-title');
  const next = el('setup-next');
  const alt = el('setup-alt');
  let flow = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const key = (word) => S.clean(word).replace(/ /g, '');

  // Share of the expected words that were heard, in order (longest common subsequence).
  function accuracy(expected, heard) {
    const dp = Array.from({ length: expected.length + 1 }, () => new Array(heard.length + 1).fill(0));
    for (let i = 1; i <= expected.length; i++) {
      for (let j = 1; j <= heard.length; j++) {
        dp[i][j] = expected[i - 1] === heard[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return expected.length ? dp[expected.length][heard.length] / expected.length : 0;
  }

  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

  function open() {
    const lang = (settings && settings.language) || 'en';
    flow = {
      lang,
      step: 'intro',
      sentences: SENTENCES[lang] || SENTENCES.en,
      si: 0,
      tricky: S.trickyWords(scriptEl.value),
      ti: 0,
      noise: 0,
      levels: [],
      paces: [],
      acc: [],
      aliases: {},
      wordState: {},
      heardText: '',
      result: null,
    };
    sheet.hidden = false;
    render();
  }

  function close() {
    send('cmd', { setup: 'end' });
    sheet.hidden = true;
    flow = null;
  }

  function stepDots() {
    const order = ['intro', 'quiet', 'sentence', 'words', 'done'].filter((s) => s !== 'words' || flow.tricky.length);
    const at = order.indexOf(flow.step === 'starting' ? 'intro' : flow.step);
    el('setup-steps').innerHTML = order.map((_, i) => `<i class="${i < at ? 'done' : i === at ? 'now' : ''}"></i>`).join('');
  }

  function buttons(nextLabel, nextEnabled, altLabel) {
    next.textContent = nextLabel;
    next.disabled = !nextEnabled;
    alt.hidden = !altLabel;
    if (altLabel) alt.textContent = altLabel;
  }

  function listen(id) {
    flow.heardText = '';
    flow.result = null;
    send('cmd', { setup: 'listen', id });
  }

  function render() {
    stepDots();
    const f = flow;
    if (f.step === 'intro') {
      title.textContent = 'Voice setup';
      body.innerHTML = `<p>OnTop learns three things about how you speak:</p>
        <p>• how loud your voice is compared with the room,<br>• how fast you talk,<br>• how it hears the names and acronyms in your script${f.tricky.length ? ` (${f.tricky.length} found)` : ''}.</p>
        <p>It takes about a minute. Use the microphone and room you will present in.</p>`;
      buttons('Start', true);
    } else if (f.step === 'starting') {
      body.innerHTML = '<p>Getting the microphone ready…</p>';
      buttons('Start', false);
    } else if (f.step === 'quiet') {
      title.textContent = 'Stay quiet';
      body.innerHTML = `<svg class="ring" viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="26"/><circle class="bar" cx="32" cy="32" r="26" stroke-dasharray="163.4" stroke-dashoffset="163.4" id="quiet-bar"/></svg>
        <p style="text-align:center">Measuring the room for 3 seconds.</p>`;
      requestAnimationFrame(() => { const b = el('quiet-bar'); if (b) b.style.strokeDashoffset = '0'; });
      buttons('Continue', false);
    } else if (f.step === 'sentence') {
      title.textContent = `Read this aloud (${f.si + 1} of ${f.sentences.length})`;
      const r = f.result;
      let status = `<span class="hear">${f.heardText ? 'I hear: <b>' + esc(f.heardText) + '</b>' : 'Listening…'}</span>`;
      if (r) status = r.acc >= 0.5
        ? `<span class="ok">Got it</span> · ${Math.round(r.acc * 100)}% of words recognised`
        : `<span class="warn">I only caught ${Math.round(r.acc * 100)}% of that.</span> Try again, a little closer to the microphone.`;
      body.innerHTML = `<div class="say">${esc(f.sentences[f.si])}</div><p>${status}</p>`;
      buttons('Continue', !!r && r.acc >= 0.5, r ? 'Try again' : null);
    } else if (f.step === 'words') {
      const word = f.tricky[f.ti];
      title.textContent = 'Say each word from your script';
      const chips = f.tricky.map((w, i) => {
        const st = f.wordState[w];
        const cls = i === f.ti ? 'now' : st === 'ok' ? 'ok' : st === 'learned' ? 'learned' : '';
        return `<span class="${cls}">${esc(w)}</span>`;
      }).join('');
      const r = f.result;
      let status = `<span class="hear">${f.heardText ? 'I hear: <b>' + esc(f.heardText) + '</b>' : 'Say it the way you will in your talk.'}</span>`;
      if (r) status = r.kind === 'ok' ? '<span class="ok">Understood</span>'
        : r.kind === 'learned' ? `<span class="learned">Learned</span> · it hears this as “${esc(r.heard)}”, and will now count that as ${esc(word)}`
        : '<span class="warn">Didn’t hear it.</span> Try again, or skip.';
      body.innerHTML = `<div class="say word">${esc(word)}</div><p>${status}</p><div class="chips">${chips}</div>`;
      buttons(f.ti === f.tricky.length - 1 ? 'Finish' : 'Next word', !!r && r.kind !== 'none', r ? 'Try again' : 'Skip');
    } else if (f.step === 'done') {
      title.textContent = 'All set';
      const level = median(f.levels);
      const pace = median(f.paces);
      const acc = f.acc.length ? f.acc.reduce((a, b) => a + b, 0) / f.acc.length : null;
      const learned = Object.keys(f.aliases).length;
      body.innerHTML = `<p>Here is what OnTop learned. Save to use it from now on.</p>
        <div class="results">
          <div><b>${level && f.noise ? Math.round(20 * Math.log10(level / Math.max(f.noise, 1e-4))) + ' dB' : '–'}</b><span>voice above room noise</span></div>
          <div><b>${pace ? Math.round(pace) + ' wpm' : '–'}</b><span>your speaking pace</span></div>
          <div><b>${acc !== null ? Math.round(acc * 100) + '%' : '–'}</b><span>of words recognised</span></div>
          <div><b>${learned}</b><span>pronunciation${learned === 1 ? '' : 's'} learned</span></div>
        </div>`;
      buttons('Save', true);
    } else if (f.step === 'error') {
      title.textContent = 'Voice setup';
      body.innerHTML = `<p class="warn">${esc(f.error)}</p><p>Check that a microphone is connected and allowed for OnTop, then try again.</p>`;
      buttons('Close', true);
    }
  }

  function advance() {
    const f = flow;
    if (f.step === 'intro') { f.step = 'starting'; render(); send('cmd', { setup: 'begin' }); return; }
    if (f.step === 'sentence') {
      f.si++;
      // Start listening (which clears the last result) before showing the next item,
      // so the old result never appears against the new one.
      if (f.si < f.sentences.length) { listen('s' + f.si); render(); return; }
      f.step = f.tricky.length ? 'words' : 'done';
      if (f.step === 'words') listen('w0');
      render();
      return;
    }
    if (f.step === 'words') {
      f.ti++;
      if (f.ti < f.tricky.length) { listen('w' + f.ti); render(); return; }
      f.step = 'done';
      render();
      return;
    }
    if (f.step === 'done') { save(); close(); return; }
    if (f.step === 'error') close();
  }

  function save() {
    const f = flow;
    const level = median(f.levels);
    const pace = median(f.paces);
    const patch = {};
    // Trigger halfway (geometrically) between room noise and your voice.
    if (level && level > f.noise) patch.micThreshold = Number(Math.min(0.08, Math.max(0.004, Math.sqrt(Math.max(f.noise, 0.002) * level))).toFixed(4));
    if (pace) patch.wpm = Math.max(80, Math.min(260, Math.round(pace / 5) * 5));
    const prev = (settings && settings.voice) || {};
    const aliases = { ...(prev.aliases || {}) };
    aliases[f.lang] = { ...(aliases[f.lang] || {}), ...f.aliases };
    patch.voice = {
      updated: Date.now(),
      noise: f.noise,
      level,
      wpm: pace ? Math.round(pace) : prev.wpm || null,
      accuracy: f.acc.length ? f.acc.reduce((a, b) => a + b, 0) / f.acc.length : null,
      aliases,
    };
    setSettings(patch);
  }

  // Events from the overlay.
  window.ontop.on('setup', (ev) => {
    if (!flow) return;
    const f = flow;
    if (ev.type === 'error') { f.step = 'error'; f.error = ev.message; render(); return; }
    if (ev.type === 'ready') { f.step = 'quiet'; render(); send('cmd', { setup: 'noise' }); return; }
    if (ev.type === 'noise') { f.noise = ev.noise; f.step = 'sentence'; f.si = 0; listen('s0'); render(); return; }
    if (ev.type === 'partial') { f.heardText = ev.text; f.result = null; render(); return; }
    if (ev.type !== 'heard') return;
    const heard = S.heardWords(ev.text || '');
    if (f.step === 'sentence' && ev.id === 's' + f.si) {
      const expected = S.units(f.sentences[f.si], f.lang).map((u) => u.u);
      const acc = accuracy(expected, heard);
      f.result = { acc };
      f.heardText = ev.text;
      if (acc >= 0.5) {
        f.acc.push(acc);
        if (ev.level) f.levels.push(ev.level);
        const w = ev.words || [];
        if (w.length >= 4) f.paces.push((w.length / Math.max(0.5, w[w.length - 1].end - w[0].start)) * 60);
      }
      render();
      return;
    }
    if (f.step === 'words' && ev.id === 'w' + f.ti) {
      const word = f.tricky[f.ti];
      const expected = S.spoken(word, f.lang);
      // Letters count when said by name too: "i see pee" is ICP understood.
      const names = S.letterNames(f.lang);
      const same = heard.length === expected.length && heard.every((h, i) => h === expected[i] || (expected[i].length === 1 && (names[expected[i]] || []).includes(h)));
      if (!heard.length) f.result = { kind: 'none' };
      else if (same) { f.result = { kind: 'ok' }; f.wordState[word] = 'ok'; }
      else {
        f.aliases[key(word)] = heard.slice(0, 4);
        f.wordState[word] = 'learned';
        f.result = { kind: 'learned', heard: heard.slice(0, 4).join(' ') };
      }
      f.heardText = ev.text;
      render();
    }
  });

  next.addEventListener('click', () => flow && advance());
  alt.addEventListener('click', () => {
    if (!flow) return;
    if (flow.step === 'sentence') { listen('s' + flow.si); render(); }
    else if (flow.step === 'words') {
      if (flow.result) { listen('w' + flow.ti); render(); } // try again
      else advance(); // skip
    }
  });
  el('setup-cancel').addEventListener('click', close);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  el('btn-voice-setup').addEventListener('click', open);

  // Summary in the Playback panel.
  window.OnTopVoiceSummary = function () {
    const v = settings && settings.voice;
    const lang = (settings && settings.language) || 'en';
    const n = v && v.aliases && v.aliases[lang] ? Object.keys(v.aliases[lang]).length : 0;
    el('voice-summary').textContent = v && v.updated
      ? `Set up ${new Date(v.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${n ? ` · ${n} word${n === 1 ? '' : 's'} learned` : ''}`
      : 'Not set up';
    el('btn-voice-setup').textContent = v && v.updated ? 'Redo' : 'Set up';
  };
})();
