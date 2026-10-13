// node test/acronyms.test.js
const assert = require('assert');
const S = require('../src/script.js');
const { Tracker } = require('../src/tracker.js');

let pass = 0;
function test(name, fn) { fn(); pass++; console.log('ok  ' + name); }

test('which acronyms are spelled out', () => {
  for (const w of ['ICP', 'CSA', 'EU', 'ECB', 'HSBC', 'BNPP', 'ICP.', 'CSAs']) assert.ok(S.isSpelledAcronym(w), w);
  for (const w of ['EMIR', 'DORA', 'NATO', 'MiFID', 'Bank', 'I', 'A']) assert.ok(!S.isSpelledAcronym(w), w);
});

test('spelled acronyms become letters', () => {
  assert.deepStrictEqual(S.spoken('ICP'), ['i', 'c', 'p']);
  assert.deepStrictEqual(S.spoken('CSAs,'), ['c', 's', 'a']);
  assert.deepStrictEqual(S.spoken('EMIR'), ['emir']);
});

const TALK = 'Today I present my ICP on corporate derivatives, and the CSA extraction pilot.';
const words = S.words(TALK).map((w) => w.text);
const say = (t, s) => { const ws = s.split(' '); for (let i = 1; i <= ws.length; i++) t.hear({ partial: ws.slice(0, i).join(' ') }); t.hear({ final: s }); };

test('"i see pee" is heard as ICP', () => {
  const t = new Tracker(TALK);
  say(t, 'today i present my i see pee');
  assert.strictEqual(words[t.word], 'ICP');
  say(t, 'on corporate derivatives and the see ess ay extraction');
  assert.strictEqual(words[t.word], 'extraction');
});

test('bare letters work too', () => {
  const t = new Tracker(TALK);
  say(t, 'today i present my i c p on corporate');
  assert.strictEqual(words[t.word], 'corporate');
});

console.log(`\n${pass} passed`);
