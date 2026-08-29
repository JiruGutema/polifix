// Moves POLIFIX_API_KEY out of your shell environment and into the login
// keyring, where the extension can actually reach it. Prints no secret.
import GLib from 'gi://GLib';
import {storeKey} from '../secrets.js';

const provider = ARGV[0] ?? 'gemini';
const key = (GLib.getenv('POLIFIX_API_KEY') ?? '').trim();

if (!key) {
    print('POLIFIX_API_KEY is not set in this shell.');
    imports.system.exit(1);
}

const loop = new GLib.MainLoop(null, false);
storeKey(provider, key)
    .then(() => { print(`Stored a ${key.length}-character key for "${provider}" in the login keyring.`); loop.quit(); })
    .catch(e => { print(`Failed: ${e.message}`); loop.quit(); });
loop.run();
