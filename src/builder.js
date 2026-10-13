// Slide builder: the script as a list of slide cards (label, title, duration, what to
// say). It reads and writes the same plain-text script as the Text view:
//   [Slide 3 · Why now · 0:45]      <- label · title · planned start
//   What you say on this slide.
// Durations are shown per slide; the planned start times in the script are derived
// from them. Shares the editor's globals: $, send, settings, scriptEl, library.

(function () {
  const S = window.OnTopScript;
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = el('slides');
  let slides = [];        // [{ label, title, duration (s|null), text }]
  let view = 'text';
  let saveTimer = null;
  let dragFrom = null;

  const wpm = () => (settings && settings.wpm) || 140;
  const wordCount = (t) => t.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
  const estimate = (t) => Math.round((wordCount(t) / wpm()) * 60);
  const readOnly = () => { const a = library.scripts.find((s) => s.id === library.activeId); return !!(a && a.source); };

  function parseTime(text) {
    const t = String(text).trim();
    if (!t) return null;
    const m = t.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
    if (m) return m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]); // "45" = 45 s
    return null;
  }

  // Script text -> cards.
  function parse(text) {
    const paras = S.paragraphs(text);
    const secs = S.sections(text);
    const out = [];
    if (!secs.length || secs[0].para > 0) {
      const intro = paras.slice(0, secs.length ? secs[0].para : paras.length).join('\n\n');
      if (intro || !secs.length) out.push({ label: '', title: secs.length ? 'Intro' : '', duration: null, text: intro, start: null });
    }
    secs.forEach((s, i) => {
      const end = i + 1 < secs.length ? secs[i + 1].para : paras.length;
      const body = [paras[s.para].split('\n').slice(1).join('\n'), ...paras.slice(s.para + 1, end)].filter((p) => p.trim()).join('\n\n');
      out.push({ label: s.label || '', title: s.title, duration: null, text: body, start: s.planned });
    });
    // Durations from consecutive planned starts; the last one from the script's target.
    const a = library.scripts.find((x) => x.id === library.activeId);
    out.forEach((c, i) => {
      const next = out[i + 1];
      if (c.start !== null && next && next.start !== null) c.duration = Math.max(0, next.start - c.start);
      else if (c.start !== null && !next && a && a.target) c.duration = Math.max(0, a.target - c.start);
    });
    return out;
  }

  // Cards -> script text. Start times are written only when at least one slide has a
  // duration; slides without one count with their estimated speaking time.
  function serialize() {
    const timed = slides.some((c) => c.duration !== null);
    let at = 0;
    return slides.map((c, i) => {
      // An empty label is saved as "Slide N", so the overlay can show "SLIDE N · Title".
      const label = c.label.trim() || (c.title.trim() ? `Slide ${i + 1}` : '');
      const parts = [label, c.title].map((x) => x.trim()).filter(Boolean);
      if (timed) parts.push(S.clock(at));
      at += c.duration !== null ? c.duration : estimate(c.text);
      const head = parts.length ? `[${parts.join(' · ').replace(/[[\]]/g, '')}]` : '';
      return [head, c.text.trim()].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n');
  }

  function commit() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const text = serialize();
      scriptEl.value = text;
      scriptEl.dispatchEvent(new Event('input')); // same path as typing in the Text view
    }, 250);
    renderTotals();
  }

  function nextLabel(i) {
    const prev = slides[i];
    const m = prev && prev.label.match(/^(.*?)(\d+)$/);
    return m ? m[1] + (Number(m[2]) + 1) : `Slide ${i + 2}`;
  }

  function renderTotals() {
    const total = slides.reduce((sum, c) => sum + (c.duration !== null ? c.duration : estimate(c.text)), 0);
    const spoken = slides.reduce((sum, c) => sum + estimate(c.text), 0);
    el('slides-total').innerHTML = `<b>${slides.length}</b> slide${slides.length === 1 ? '' : 's'} · planned <b>${S.clock(total)}</b> · reading time <b>${S.clock(spoken)}</b> at ${wpm()} wpm`;
    slides.forEach((c, i) => {
      const meta = list.querySelector(`[data-i="${i}"] .card-meta`);
      if (!meta) return;
      const est = estimate(c.text);
      const warn = c.duration !== null && est > c.duration * 1.15;
      const dur = list.querySelector(`[data-i="${i}"] .c-dur input`);
      if (dur) dur.placeholder = S.clock(est);
      meta.innerHTML = `${wordCount(c.text)} words · ~${S.clock(est)} to say${warn ? ` · <span class="warn">longer than the ${S.clock(c.duration)} planned</span>` : ''}`;
    });
  }

  function autosize(t) {
    t.style.height = 'auto';
    t.style.height = Math.max(72, t.scrollHeight) + 'px';
  }

  function render() {
    const ro = readOnly();
    list.classList.toggle('readonly', ro);
    list.innerHTML = slides.map((c, i) => `
      <div class="slide-card" data-i="${i}" draggable="${!ro}">
        <div class="card-head">
          <span class="grip" title="Drag to reorder">⋮⋮</span>
          <input class="c-label" value="${esc(c.label)}" placeholder="Slide ${i + 1}" ${ro ? 'disabled' : ''} aria-label="Label" />
          <input class="c-title" value="${esc(c.title)}" placeholder="Title" ${ro ? 'disabled' : ''} aria-label="Title" />
          <label class="c-dur" title="How long this slide should take (m:ss)"><svg><use href="#i-timer"/></svg><input value="${c.duration !== null ? S.clock(c.duration) : ''}" placeholder="${S.clock(estimate(c.text))}" ${ro ? 'disabled' : ''} aria-label="Duration" /></label>
          ${ro ? '' : '<button class="c-del" title="Delete slide">×</button>'}
        </div>
        <textarea class="c-text" placeholder="What you say on this slide…" ${ro ? 'readonly' : ''}>${esc(c.text)}</textarea>
        <div class="card-meta"></div>
      </div>
      ${ro ? '' : `<button class="add-between" data-after="${i}" title="Add a slide here"><span>+</span></button>`}`).join('');
    list.querySelectorAll('.c-text').forEach(autosize);
    renderTotals();
  }

  // --- editing ------------------------------------------------------------------

  list.addEventListener('input', (e) => {
    const card = e.target.closest('.slide-card');
    if (!card) return;
    const c = slides[Number(card.dataset.i)];
    if (e.target.classList.contains('c-label')) c.label = e.target.value;
    else if (e.target.classList.contains('c-title')) c.title = e.target.value;
    else if (e.target.classList.contains('c-text')) { c.text = e.target.value; autosize(e.target); }
    else if (e.target.closest('.c-dur')) c.duration = parseTime(e.target.value);
    commit();
  });

  list.addEventListener('click', (e) => {
    const add = e.target.closest('.add-between');
    if (add) return insertAfter(Number(add.dataset.after));
    const del = e.target.closest('.c-del');
    if (del) {
      const i = Number(del.closest('.slide-card').dataset.i);
      const c = slides[i];
      if ((c.text.trim() || c.title.trim()) && !confirm(`Delete "${c.title || c.label || 'this slide'}"?`)) return;
      slides.splice(i, 1);
      render();
      commit();
    }
  });

  function insertAfter(i) {
    slides.splice(i + 1, 0, { label: nextLabel(i), title: '', duration: null, text: '' });
    render();
    commit();
    const input = list.querySelector(`[data-i="${i + 1}"] .c-title`);
    if (input) input.focus();
  }

  el('btn-add-slide').addEventListener('click', () => insertAfter(slides.length - 1));
  el('btn-renumber').addEventListener('click', () => {
    let n = 0;
    slides.forEach((c) => { if (!c.label || /^slide\s*\d+$/i.test(c.label)) c.label = `Slide ${++n}`; });
    render();
    commit();
  });

  // Drag to reorder.
  list.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.slide-card');
    if (!card || e.target.matches('input, textarea')) return e.preventDefault();
    dragFrom = Number(card.dataset.i);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const card = e.target.closest('.slide-card');
    list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    if (card) {
      const r = card.getBoundingClientRect();
      card.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const card = e.target.closest('.slide-card');
    if (dragFrom === null || !card) return;
    const r = card.getBoundingClientRect();
    let to = Number(card.dataset.i) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    const [moved] = slides.splice(dragFrom, 1);
    if (to > dragFrom) to--;
    slides.splice(to, 0, moved);
    dragFrom = null;
    render();
    commit();
  });
  list.addEventListener('dragend', () => { dragFrom = null; render(); });

  // --- Text / Slides switch -------------------------------------------------------

  function setView(v) {
    view = v;
    document.body.classList.toggle('slides-view', v === 'slides');
    const seg = el('view-switch');
    seg.dataset.value = v === 'text' ? 'track' : 'voice';
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'slides') { slides = parse(scriptEl.value); if (!slides.length) slides = [{ label: 'Slide 1', title: '', duration: null, text: '' }]; render(); }
    try { localStorage.setItem('ontop.view', v); } catch {}
  }
  el('view-switch').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // When the script changes from elsewhere (another script selected, a linked file
  // updated), rebuild the cards, unless the change came from these cards.
  window.OnTopBuilderSync = function () {
    if (view !== 'slides') return;
    if (serialize() === scriptEl.value) return;
    if (list.contains(document.activeElement)) return;
    slides = parse(scriptEl.value);
    render();
  };

  let saved = 'text';
  try { saved = localStorage.getItem('ontop.view') || 'text'; } catch {}
  setView(saved === 'slides' ? 'slides' : 'text');
})();
