// node test/voice.test.js
// Voice setup: picking the words to practise, and using what was learned.
const assert = require('assert');
const S = require('../src/script.js');
const { Tracker } = require('../src/tracker.js');

let pass = 0;
function test(name, fn) { fn(); pass++; console.log('ok  ' + name); }

const TALK = `[Intro · 0:00]
Good morning. Today I present our work with Northwind Bank in Lisbon. The EU rules under MiFID and EMIR shape every trade.

[Results · 0:20]
Northwind grew 12% in 2026. I think the results speak for themselves.`;

test('tricky words: acronyms first, then names, no sentence starts or numbers', () => {
  const words = S.trickyWords(TALK);
  assert.deepStrictEqual(words, ['EU', 'MiFID', 'EMIR', 'Northwind', 'Bank', 'Lisbon']);
});

test('a learned pronunciation replaces the expected words', () => {
  const units = S.units('Hello Northwind team', 'en', { northwind: ['north', 'wind'] }).map((u) => u.u);
  assert.deepStrictEqual(units, ['hello', 'north', 'wind', 'team']);
});

const say = (t, sentence) => {
  const ws = sentence.split(' ');
  for (let i = 1; i <= ws.length; i++) t.hear({ partial: ws.slice(0, i).join(' ') });
  t.hear({ final: sentence });
};

test('with a learned alias, a badly heard name keeps tracking on track', () => {
  const words = S.words(TALK).map((w) => w.text);
  const heard = 'today i present our work with no fun bank in lisbon';
  // Without learning: "no fun" doesn't look like Northwind.
  const plain = new Tracker(TALK, 'en');
  plain.setNextWord(words.indexOf('Today'));
  say(plain, 'today i present our work with no fun');
  // With learning: Voice setup heard "Northwind" as "no fun".
  const learned = new Tracker(TALK, 'en', { northwind: ['no', 'fun'] });
  learned.setNextWord(words.indexOf('Today'));
  say(learned, 'today i present our work with no fun');
  assert.strictEqual(words[learned.word], 'Northwind');
  assert.notStrictEqual(words[plain.word], 'Northwind');
  say(learned, heard);
  assert.strictEqual(words[learned.word], 'Lisbon.');
});

console.log(`\n${pass} passed`);
