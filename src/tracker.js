// Word tracker: works out which script word you just said.
// Same idea as autocue/Textream: take the last few recognised words and find where
// they best fit in a window of the script around the current position, using a
// small local alignment (Smith-Waterman) with fuzzy word similarity. That tolerates
// misheard words ("foster on boarding" for "faster onboarding"), skipped words and ad-libs. A jump
// backwards (restarting a sentence) or far forwards needs stronger evidence.

(function (root) {
  const S = typeof module !== 'undefined' && module.exports ? require('./script.js') : root.OnTopScript;

  const TAIL = 8;          // recognised words considered per update
  const BACK = 25;         // how far back (units) a restart can be found
  const AHEAD = 70;        // how far ahead to search
  const GAP = 0.6;         // cost of skipping a word on either side
  const MIN_SCORE = 4;     // two solid matches (e.g. "good morning")
  const JUMP_SCORE = 8;    // backwards or > 30 units forward

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // Match score between a heard word and a script word.
  function sim(h, s) {
    if (h === s) return s.length <= 2 ? 1 : 2;
    if (h.length <= 2 || s.length <= 2) return -1;
    const r = 1 - lev(h, s) / Math.max(h.length, s.length);
    if (r >= 0.75) return 1.5;
    if (r >= 0.6) return 0.5;
    return -1;
  }

  class Tracker {
    constructor(text) {
      this.units = S.units(text);
      this.cursor = -1;      // index of the last matched unit
      this.final = [];       // recent finalised words
      this.partial = [];     // words of the utterance in progress
      this.lastKey = '';
    }

    get word() {
      return this.cursor >= 0 ? this.units[this.cursor].w : -1;
    }

    // Re-anchor after a manual jump: `w` is the next word to be read.
    setNextWord(w) {
      let i = this.units.findIndex((u) => u.w >= w);
      if (i < 0) i = this.units.length;
      this.cursor = i - 1;
      this.final = [];
      this.partial = [];
      this.lastKey = '';
    }

    // Feed recogniser output. Returns the matched word index when it moves, else null.
    hear({ partial, final }) {
      if (final != null) {
        this.final.push(...S.heardWords(final));
        this.final = this.final.slice(-TAIL * 2);
        this.partial = [];
      } else if (partial != null) {
        this.partial = S.heardWords(partial);
      }
      const tail = [...this.final, ...this.partial].slice(-TAIL);
      const key = tail.join(' ');
      if (tail.length < 2 || key === this.lastKey) return null;
      this.lastKey = key;
      return this.match(tail);
    }

    match(tail) {
      const n = this.units.length;
      const lo = Math.max(0, this.cursor - BACK);
      const hi = Math.min(n - 1, this.cursor + AHEAD);
      let best = null;
      for (let j = lo; j <= hi; j++) {
        const score = this.scoreAt(tail, j);
        if (score === null) continue;
        const dist = j - this.cursor;
        const needed = dist < -1 || dist > 30 ? JUMP_SCORE : MIN_SCORE;
        if (score < needed) continue;
        const ranked = score - 0.03 * Math.abs(dist - 1);
        if (!best || ranked > best.ranked) best = { j, ranked };
      }
      if (!best || best.j === this.cursor) return null;
      this.cursor = best.j;
      return this.word;
    }

    // Best local alignment of `tail` against the script ending exactly at unit j,
    // with unit j matched. Unexplained recent words cost a little.
    scoreAt(tail, j) {
      const len = Math.min(j + 1, tail.length + 6);
      const seg = this.units.slice(j - len + 1, j + 1).map((u) => u.u);
      const k = tail.length;
      let prev = new Array(len + 1).fill(0);
      let best = null;
      for (let a = 1; a <= k; a++) {
        const cur = new Array(len + 1).fill(0);
        for (let b = 1; b <= len; b++) {
          const s = sim(tail[a - 1], seg[b - 1]);
          const diag = prev[b - 1] + s;
          cur[b] = Math.max(0, diag, prev[b] - GAP, cur[b - 1] - GAP);
          if (b === len && s > 0 && diag > 0) {
            const v = diag - 0.5 * (k - a);
            if (best === null || v > best) best = v;
          }
        }
        prev = cur;
      }
      return best;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { Tracker, sim };
  else root.OnTopTracker = Tracker;
})(typeof window !== 'undefined' ? window : globalThis);
