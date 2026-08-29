// Prints one stored key on stdout, for tools/nested.sh to put into the
// nested session's environment. Nothing else should call this — the point of
// the keyring is that keys do not travel as plain text.
import GLib from 'gi://GLib';
import {lookupKey} from '../secrets.js';

const provider = ARGV[0] ?? 'gemini';
const loop = new GLib.MainLoop(null, false);
let code = 1;

lookupKey(provider).then(({key}) => {
    if (key) {
        print(key);
        code = 0;
    }
    loop.quit();
}).catch(() => loop.quit());

loop.run();
imports.system.exit(code);
