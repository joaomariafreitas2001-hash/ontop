// Rehearse: start a timed run against a target length, then show how it went.
// The main process times the run (see startRehearsal/finishRun in main.js); this file
// runs the start sheet, the results sheet, the toolbar button and the trend chart.
// Shares the editor's globals: $, send, settings, scriptEl, library, runs.

(function () {
  const S = window.OnTopScript;
  const el = (id) => document.getElementById(id);
  const clock = (s) => S.clock(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let live = false;

  // "10", "10:30", "9.5" -> seconds
  function parseTime(text) {
    const t = String(text).trim();
    const m = t.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
    if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
  }

  function activeScript() {
    return library.scripts.find((s) => s.id === library.activeId);
  }

  // A sensible default: the target used last time, else the script's own plan, else
  // its length at your speaking pace, rounded to half a minute.
  function defaultTarget() {
    const a = activeScript();
    if (a && a.target) return a.target;
    const text = scriptEl.value;
    const words = text.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
    const byPace = (words / ((settings && settings.wpm) || 140)) * 60;
    return Math.max(30, Math.round(byPace / 30) * 30);
  }

  function openStart() {
    const words = scriptEl.value.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
    el('rh-target').value = clock(defaultTarget());
    el('rh-estimate').textContent = words ? `script is ~${clock((words / ((settings && settings.wpm) || 140)) * 60)} at ${(settings && settings.wpm) || 140} wpm` : '';
    el('rehearse').hidden = false;
    el('rh-target').focus();
    el('rh-target').select();
  }

  function start() {
    const target = parseTime(el('rh-target').value);
    if (!target) { el('rh-target').focus(); return; }
    el('rehearse').hidden = true;
    send('cmd', { rehearse: 'start', target });
  }

  el('btn-rehearse').addEventListener('click', () => (live ? send('cmd', { rehearse: 'finish' }) : openStart()));
  el('rh-cancel').addEventListener('click', () => { el('rehearse').hidden = true; });
  el('rh-start').addEventListener('click', start);
  el('rh-target').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); if (e.key === 'Escape') el('rehearse').hidden = true; });

  // Toolbar button: "Rehearse", or "Finish" while a rehearsal runs.
  window.ontop.on('timer', (t) => {
    live = !!(t.running && t.rehearsal);
    const btn = el('btn-rehearse');
    btn.classList.toggle('live', live);
    btn.querySelector('span').textContent = live ? 'Finish' : 'Rehearse';
    btn.title = live ? 'Finish this rehearsal and see the results' : 'Rehearse against a target time';
  });

  // --- results ----------------------------------------------------------------

  function verdict(total, target) {
    if (!target) return '';
    const d = total - target;
    const tolerance = Math.max(10, target * 0.03);
    if (Math.abs(d) <= tolerance) return `<span class="good"><b>On target.</b></span> ${d === 0 ? 'Exactly on time.' : `${clock(Math.abs(d))} ${d > 0 ? 'over' : 'under'}.`}`;
    return d > 0 ? `<span class="over"><b>${clock(d)} over</b></span> your target.` : `<span class="under"><b>${clock(-d)} under</b></span> your target.`;
  }

  function showResult(r) {
    let html = `<div class="res-head"><span class="res-total">${clock(r.total)}</span>${r.target ? `<span class="res-target">target ${clock(r.target)}</span>` : ''}</div>`;
    const lines = [verdict(r.total, r.target)];
    if (!r.completed) lines.push('Stopped before the last slide, so it is saved as a partial run.');
    else if (r.previous !== null) {
      const d = r.total - r.previous;
      lines.push(d === 0 ? 'Same time as last rehearsal.' : `${clock(Math.abs(d))} ${d < 0 ? 'faster' : 'slower'} than last time.`);
    }
    if (r.completed && r.count > 1 && r.best === r.total) lines.push('Your fastest complete run so far.');
    html += `<p class="res-verdict">${lines.filter(Boolean).join(' ')}</p>`;

    const rows = r.sections.filter((s) => s.took !== null || s.planned !== null);
    if (rows.length) {
      const scale = Math.max(1, ...rows.map((s) => Math.max(s.took || 0, s.planned || 0))) * 1.1;
      html += '<div class="res-table"><span class="h">Slide</span><span class="h">Time vs plan</span><span class="h n">Took</span><span class="h n">vs plan</span>';
      for (const s of rows) {
        const d = s.took !== null && s.planned !== null ? s.took - s.planned : null;
        const cls = d === null ? '' : d > Math.max(5, s.planned * 0.15) ? 'over' : d < -Math.max(5, s.planned * 0.15) ? 'under' : '';
        html += `<span class="t">${s.label ? `<small>${esc(s.label)}</small>` : ''}${esc(s.title)}</span>`;
        html += `<span class="bar ${cls}">${s.took !== null ? `<i style="width:${(s.took / scale) * 100}%"></i>` : ''}${s.planned !== null ? `<b style="left:${(s.planned / scale) * 100}%"></b>` : ''}</span>`;
        html += `<span class="n">${s.took !== null ? clock(s.took) : '–'}</span>`;
        html += `<span class="n">${d === null ? '' : `<span class="chip ${d > 10 ? 'behind' : d < -10 ? 'ahead' : 'on-time'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${clock(Math.abs(d))}</span>`}</span>`;
      }
      html += '</div>';
    }
    el('results-body').innerHTML = html;
    el('results').hidden = false;
  }

  window.ontop.on('rehearsal:result', showResult);
  el('res-close').addEventListener('click', () => { el('results').hidden = true; });
  el('res-again').addEventListener('click', () => { el('results').hidden = true; openStart(); });
  for (const id of ['rehearse', 'results']) {
    el(id).addEventListener('keydown', (e) => { if (e.key === 'Escape') el(id).hidden = true; });
  }

  // --- trend chart ----------------------------------------------------------------
  // Last ten complete rehearsals of this script, oldest to newest, with the target.

  window.OnTopTrend = function () {
    const box = el('trend');
    const list = (typeof runs !== 'undefined' ? runs : []).filter((r) => r.rehearsal && r.completed).slice(0, 10).reverse();
    box.hidden = list.length < 2;
    if (list.length < 2) return;
    const target = list[list.length - 1].target;
    const values = list.map((r) => r.total);
    const lo = Math.min(...values, target || Infinity) * 0.95;
    const hi = Math.max(...values, target || 0) * 1.05;
    const W = 260, H = 64, pad = 6;
    const x = (i) => pad + (i / (list.length - 1)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const goal = target ? `<line class="goal" x1="${pad}" x2="${W - pad}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>` : '';
    const first = values[0], last = values[values.length - 1];
    const change = last - first;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${goal}<polyline class="line" points="${pts}"/>${values.map((v, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6"/>`).join('')}</svg>
      <div class="cap"><span>Last ${list.length} rehearsals${target ? ` · target ${clock(target)}` : ''}</span><span>${change === 0 ? 'no change' : `${clock(Math.abs(change))} ${change < 0 ? 'faster' : 'slower'}`}</span></div>`;
  };
})();
