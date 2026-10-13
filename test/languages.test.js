// node test/languages.test.js
// Portuguese and Spanish: number spelling and following a short talk. The "heard"
// lines are written the way Vosk outputs text (lower case, no punctuation, accents kept).
const assert = require('assert');
const S = require('../src/script.js');
const { Tracker } = require('../src/tracker.js');

let pass = 0;
function test(name, fn) { fn(); pass++; console.log('ok  ' + name); }

function say(t, sentence) {
  const ws = sentence.split(' ');
  for (let i = 1; i <= ws.length; i++) t.hear({ partial: ws.slice(0, i).join(' ') });
  t.hear({ final: sentence });
}

test('Portuguese numbers', () => {
  assert.deepStrictEqual(S.numberWords(21, 'pt'), ['vinte', 'e', 'um']);
  assert.deepStrictEqual(S.numberWords(100, 'pt'), ['cem']);
  assert.deepStrictEqual(S.numberWords(135, 'pt'), ['cento', 'e', 'trinta', 'e', 'cinco']);
  assert.deepStrictEqual(S.numberWords(2026, 'pt'), ['dois', 'mil', 'e', 'vinte', 'e', 'seis']);
  assert.deepStrictEqual(S.spoken('12%', 'pt'), ['doze', 'por', 'cento']);
});

test('Spanish numbers', () => {
  assert.deepStrictEqual(S.numberWords(21, 'es'), ['veintiuno']);
  assert.deepStrictEqual(S.numberWords(45, 'es'), ['cuarenta', 'y', 'cinco']);
  assert.deepStrictEqual(S.numberWords(2026, 'es'), ['dos', 'mil', 'veintiseis']);
  assert.deepStrictEqual(S.spoken('4.500', 'es'), ['cuatro', 'mil', 'quinientos']);
  assert.deepStrictEqual(S.spoken('12%', 'es'), ['doce', 'por', 'ciento']);
});

const PT = `[Abertura · 0:00]
Bom dia a todos. Obrigado por estarem aqui nesta revisão trimestral.

[Resultados · 0:15]
As receitas cresceram 12% face ao ano passado, e os custos ficaram estáveis.`;

test('Portuguese talk is followed, asides are ignored', () => {
  const t = new Tracker(PT, 'pt');
  const w = S.words(PT).map((x) => x.text);
  say(t, 'bom dia a todos obrigado por estarem aqui nesta revisão trimestral');
  assert.strictEqual(w[t.word], 'trimestral.');
  const before = t.word;
  say(t, 'desculpem só um segundo vou partilhar o ecrã');
  assert.strictEqual(t.word, before);
  say(t, 'as receitas cresceram doze por cento face ao ano passado');
  assert.strictEqual(w[t.word], 'passado,');
});

const ES = `[Apertura · 0:00]
Buenos días a todos. Gracias por acompañarnos en esta revisión trimestral.

[Resultados · 0:15]
Los ingresos crecieron un 12% respecto al año pasado, y los costes se mantuvieron estables.`;

test('Spanish talk is followed, asides are ignored', () => {
  const t = new Tracker(ES, 'es');
  const w = S.words(ES).map((x) => x.text);
  say(t, 'buenos días a todos gracias por acompañarnos en esta revisión trimestral');
  assert.strictEqual(w[t.word], 'trimestral.');
  const before = t.word;
  say(t, 'perdón un momento que comparto la pantalla');
  assert.strictEqual(t.word, before);
  say(t, 'los ingresos crecieron un doce por ciento respecto al año pasado');
  assert.strictEqual(w[t.word], 'pasado,');
});

console.log(`\n${pass} passed`);
