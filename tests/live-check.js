// A real request to a real provider, using the key already in your keyring
// (or your environment). Prints the result — never the key.
//
//   gjs -m tests/live-check.js gemini
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Request, PROVIDERS} from '../provider.js';
import {lookupKey} from '../secrets.js';
import {buildSystemPrompt, loadTransformations} from '../transforms.js';

const provider = ARGV[0] ?? 'gemini';
if (!PROVIDERS[provider]) {
    print(`Unknown provider "${provider}". One of: ${Object.keys(PROVIDERS).join(', ')}`);
    imports.system.exit(2);
}

// Resolve the schema next to this script, not next to the caller's cwd.
const here = GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]);
const source = Gio.SettingsSchemaSource.new_from_directory(
    GLib.build_filenamev([here, '..', 'schemas']),
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({
    settings_schema: source.lookup('org.gnome.shell.extensions.polifix', true),
});

const model = settings.get_string(PROVIDERS[provider].modelKey);
const transformation = loadTransformations(settings)[0];
const SAMPLE = 'teh quick brown fox jumpd over teh lazy dog, and then it dont move agan.';

const loop = new GLib.MainLoop(null, false);

lookupKey(provider).then(({key: apiKey, source}) => {
    if (!apiKey) {
        print(`No key for ${provider} (${source}) — not in the keyring, not in the environment.`);
        loop.quit();
        return;
    }

    print(`provider     ${PROVIDERS[provider].label}`);
    print(`model        ${model}`);
    print(`key          ${apiKey.length} chars, from the ${source}`);
    print(`transform    ${transformation.name}`);
    print(`input        ${SAMPLE}`);
    print('');

    let out = '';
    let chunks = 0;
    const started = GLib.get_monotonic_time();

    new Request({
        provider, apiKey, model,
        baseUrl: settings.get_string('openai-base-url'),
        system: buildSystemPrompt(transformation),
        text: SAMPLE,
        maxTokens: settings.get_int('max-output-tokens'),
    }).run({
        onDelta: chunk => { out += chunk; chunks++; },
        onDone: () => {
            const ms = Math.round((GLib.get_monotonic_time() - started) / 1000);
            print(`output       ${out.trim()}`);
            print('');
            print(`${chunks} stream chunks in ${ms} ms`);
            loop.quit();
        },
        onError: message => { print(`ERROR        ${message}`); loop.quit(); },
    });
}).catch(e => { print(`ERROR ${e}`); loop.quit(); });

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 90, () => { print('timed out'); loop.quit(); return false; });
loop.run();
