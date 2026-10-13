// node test/tracker.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/script.js');
const { Tracker } = require('../src/tracker.js');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'fixture-script.txt'), 'utf8');
const words = S.words(SCRIPT).map((w) => w.text);
const bare = (w) => w.replace(/[^\w%,]/g, '').replace(/,$/, '');
const idx = (w, from = 0) => words.findIndex((x, i) => i >= from && bare(x) === w);

// Feed an utterance the way Vosk does: growing partials, then a final result.
function say(t, sentence) {
  const ws = sentence.split(' ');
  let last = null;
  for (let i = 1; i <= ws.length; i++) {
    const r = t.hear({ partial: ws.slice(0, i).join(' ') });
    if (r !== null) last = r;
  }
  const r = t.hear({ final: sentence });
  return r !== null ? r : last;
}

let pass = 0;
function test(name, fn) {
  fn();
  pass++;
  console.log('ok  ' + name);
}

// Exactly what Vosk (small en-us) returned for test/speech.wav, including its mistakes.
const HEARD = [
  'good morning everyone',
  'thank you for joining this quarterly review',
  'today i will walk you through our results the projects we delivered and the plan for next year',
  'revenue grew by twelve percent compared with last year while costs stayed flat',
  'our customer base reached four thousand five hundred companies across europe and asia',
  'next year we will focus on three priorities foster on boarding better support and a new mobile app',
];

test('follows real recogniser output to the last word', () => {
  const t = new Tracker(SCRIPT);
  say(t, HEARD[0]);
  assert.strictEqual(t.word, idx('everyone'));
  say(t, HEARD[1]); say(t, HEARD[2]);
  assert.strictEqual(t.word, idx('year'), 'after opening: ' + words[t.word]);
  say(t, HEARD[3]);
  assert.strictEqual(t.word, idx('flat'));
  say(t, HEARD[4]);
  assert.strictEqual(t.word, idx('Asia'));
  say(t, HEARD[5]);
  assert.strictEqual(t.word, words.length - 1, 'end: ' + words[t.word]);
});

test('numbers: "twelve percent" and "four thousand five hundred"', () => {
  assert.deepStrictEqual(S.spoken('12%'), ['twelve', 'percent']);
  assert.deepStrictEqual(S.spoken('4,500'), ['four', 'thousand', 'five', 'hundred']);
  assert.deepStrictEqual(S.spoken('2026'), ['twenty', 'twenty', 'six']);
});

test('going off-script does not move the text', () => {
  const t = new Tracker(SCRIPT);
  say(t, HEARD[0]);
  const before = t.word;
  say(t, 'sorry let me just share my screen one second can you all see it now');
  assert.strictEqual(t.word, before);
});

test('restarting a sentence jumps back', () => {
  const t = new Tracker(SCRIPT);
  t.setNextWord(idx('Revenue'));
  say(t, HEARD[3]);
  say(t, 'our customer base reached four thousand');
  assert.strictEqual(t.word, idx('reached') + 1);
  say(t, 'sorry revenue grew by twelve percent');
  assert.strictEqual(t.word, idx('12%'));
});

test('skipping a paragraph jumps forward', () => {
  const t = new Tracker(SCRIPT);
  say(t, HEARD[0]);
  say(t, 'next year we will focus on three priorities');
  assert.strictEqual(t.word, idx('priorities'));
});

test('a single common word does not cause a jump', () => {
  const t = new Tracker(SCRIPT);
  t.setNextWord(idx('Revenue'));
  say(t, 'the');
  say(t, 'and the');
  assert.strictEqual(t.word, idx('Revenue') - 1);
});

console.log(`\n${pass} passed`);
