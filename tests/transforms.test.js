import {loadTransformations, DEFAULT_TRANSFORMATIONS, buildSystemPrompt} from '../transforms.js';

let failures = 0;
const check = (n, a, e) => { const ok = a === e; if (!ok) failures++; print(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : ` — got ${JSON.stringify(a)}`}`); };

// loadTransformations must never throw, whatever is in the settings string.
const stored = v => ({get_string: () => v});
check('defaults when empty', loadTransformations(stored('[]')).length, DEFAULT_TRANSFORMATIONS.length);
check('defaults when corrupt', loadTransformations(stored('not json')).length, DEFAULT_TRANSFORMATIONS.length);
check('defaults when wrong shape', loadTransformations(stored('{"a":1}')).length, DEFAULT_TRANSFORMATIONS.length);
check('drops incomplete entries',
    loadTransformations(stored('[{"name":"a","prompt":"b"},{"name":"c"}]')).length, 1);

const system = buildSystemPrompt({name: 'x', prompt: 'PROMPT'});
check('prompt reaches the system message', system.includes('PROMPT'), true);
check('output contract rides along', system.includes('nothing else'), true);

print(failures ? `\n${failures} failure(s)` : '\nall green');
imports.system.exit(failures ? 1 : 0);
