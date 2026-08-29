import GLib from 'gi://GLib';
import {storeKey, lookupKey} from '../secrets.js';

// A provider name of its own, so the round trip cannot clobber a real key.
const PROVIDER = 'polifix-selftest';
const SECRET = 'polifix-round-trip-test';

const loop = new GLib.MainLoop(null, false);
let failures = 0;
const check = (n, a, e) => { const ok = a === e; if (!ok) failures++; print(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : ` — got ${JSON.stringify(a)}`}`); };

storeKey(PROVIDER, SECRET)
    .then(() => lookupKey(PROVIDER))
    .then(key => {
        check('keyring round trip', key, SECRET);
        return storeKey(PROVIDER, '');
    })
    .then(() => lookupKey(PROVIDER))
    .then(key => {
        check('cleared key is gone', key === null || key !== SECRET, true);
        loop.quit();
    })
    .catch(e => { print(`FAIL keyring: ${e}`); failures++; loop.quit(); });

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => { print('FAIL timeout'); failures++; loop.quit(); return false; });
loop.run();
print(failures ? `\n${failures} failure(s)` : '\nall green');
imports.system.exit(failures ? 1 : 0);
