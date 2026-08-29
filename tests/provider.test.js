import GLib from 'gi://GLib';
import {Request, extractDelta} from '../provider.js';

let failures = 0;
function check(name, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}

// --- delta extraction, one shape per provider ------------------------
check('anthropic text_delta', extractDelta('anthropic',
    {type: 'content_block_delta', delta: {type: 'text_delta', text: 'hi'}}), 'hi');
check('anthropic thinking ignored', extractDelta('anthropic',
    {type: 'content_block_delta', delta: {type: 'thinking_delta', thinking: 'x'}}), '');
check('anthropic ping ignored', extractDelta('anthropic', {type: 'ping'}), '');
check('gemini candidate', extractDelta('gemini',
    {candidates: [{content: {parts: [{text: 'a'}, {text: 'b'}]}}]}), 'ab');
check('gemini empty', extractDelta('gemini', {usageMetadata: {}}), '');
check('openai delta', extractDelta('openai',
    {choices: [{delta: {content: 'yo'}}]}), 'yo');
check('openai role-only chunk', extractDelta('openai',
    {choices: [{delta: {role: 'assistant'}}]}), '');

// --- a real stream over a real socket ---------------------------------
const port = Number(GLib.getenv('FAKE_PORT'));
const loop = new GLib.MainLoop(null, false);
let streamed = '';

const request = new Request({
    provider: 'openai',
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    system: 'system',
    text: 'text',
    maxTokens: 256,
});

request.run({
    onDelta: chunk => (streamed += chunk),
    onDone: () => {
        check('streamed body', streamed, 'Hello, world');

        // Now the failure path.
        const bad = new Request({
            provider: 'openai', apiKey: 'nope', model: 'boom',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            system: 's', text: 't', maxTokens: 256,
        });
        bad.run({
            onDelta: () => {},
            onDone: () => { check('401 should not succeed', 'done', 'error'); loop.quit(); },
            onError: message => {
                check('401 surfaces the provider message',
                    message.includes('invalid api key') && message.includes('Check the API key'), true);
                loop.quit();
            },
        });
    },
    onError: message => { check('stream error', message, '(no error)'); loop.quit(); },
});

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => { print('FAIL timeout'); failures++; loop.quit(); return false; });
loop.run();
print(failures ? `\n${failures} failure(s)` : '\nall green');
imports.system.exit(failures ? 1 : 0);
