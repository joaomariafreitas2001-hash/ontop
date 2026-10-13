// node test/markdown.test.js
const assert = require('assert');
const { convert, heading } = require('../src/markdown.js');

let pass = 0;
function test(name, fn) { fn(); pass++; console.log('ok  ' + name); }

test('slide headings become labels with time', () => {
  assert.strictEqual(heading('Slide 3, Why this matters now (0:30)'), '[Slide 3 · Why this matters now · 0:30]');
  assert.strictEqual(heading('Slide 2, Agenda (0:20 to 0:30)'), '[Slide 2 · Agenda · 0:20]');
  assert.strictEqual(heading('Introduction'), '[Introduction]');
});

test('a full note converts cleanly', () => {
  const md = [
    '---', 'tags: [talk]', '---', '',
    '# My Talk', '',
    '> **Note to self:** breathe.', '',
    '### Slide 1, Title (0:00)',
    'Good morning. I am presenting **my project**, see [[Project Notes|the notes]] and [the site](https://example.com).', '',
    '---', '',
    '## Slide 2: Agenda (0:20)',
    '- First the *context*',
    '- Then the `results`', '',
    '*(End at about 9:15.)*',
    '```', 'code is ignored', '```',
  ].join('\n');
  const { name, script } = convert(md, 'fallback');
  assert.strictEqual(name, 'My Talk');
  assert.strictEqual(script, [
    '[Slide 1 · Title · 0:00]',
    'Good morning. I am presenting my project, see the notes and the site.',
    '',
    '[Slide 2 · Agenda · 0:20]',
    'First the context',
    'Then the results',
  ].join('\n'));
});

test('cues in square brackets survive', () => {
  assert.strictEqual(convert('Hello [smile] there.').script, 'Hello [smile] there.');
});

test('name falls back to the file name', () => {
  assert.strictEqual(convert('Just text.', 'talk').name, 'talk');
});

console.log(`\n${pass} passed`);
