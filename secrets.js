'use strict';

import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

/**
 * One entry per provider in the login keyring. The attribute set is the
 * primary key, so `provider` is the only attribute — storing a second key
 * for the same provider overwrites the first, which is what we want.
 */
const SCHEMA = new Secret.Schema(
    'io.github.jirugutema.polifix.ApiKey',
    Secret.SchemaFlags.NONE,
    {provider: Secret.SchemaAttributeType.STRING}
);

const LABELS = {
    anthropic: 'Polifix — Anthropic API key',
    gemini: 'Polifix — Gemini API key',
    openai: 'Polifix — OpenAI-compatible API key',
};

/**
 * Environment fallback, checked only when the keyring holds nothing. The
 * per-provider variable wins over the generic one. This is the escape hatch
 * for headless setups and for anyone who keeps secrets in a password manager
 * that exports into the session environment.
 */
const ENV_VARS = {
    anthropic: ['POLIFIX_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
    gemini: ['POLIFIX_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    openai: ['POLIFIX_OPENAI_API_KEY', 'OPENAI_API_KEY'],
};

function fromEnvironment(provider) {
    for (const name of [...(ENV_VARS[provider] ?? []), 'POLIFIX_API_KEY']) {
        const value = GLib.getenv(name);
        if (value && value.trim())
            return value.trim();
    }
    return null;
}

export function storeKey(provider, key) {
    return new Promise((resolve, reject) => {
        const done = (_o, res) => {
            try {
                Secret.password_store_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        };

        if (!key) {
            Secret.password_clear(SCHEMA, {provider}, null, (_o, res) => {
                try {
                    Secret.password_clear_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
            return;
        }

        Secret.password_store(
            SCHEMA, {provider}, Secret.COLLECTION_DEFAULT,
            LABELS[provider] ?? 'Polifix API key', key, null, done);
    });
}

/**
 * How long to wait for the keyring before giving up on it. libsecret does not
 * fail fast when no secret service is on the bus — it waits — and a panel
 * stuck on an ellipsis with no explanation is worse than one that says it
 * found no key.
 */
const KEYRING_TIMEOUT_SECONDS = 5;

export function lookupKey(provider) {
    return new Promise(resolve => {
        let settled = false;
        const settle = key => {
            if (settled)
                return;
            settled = true;
            resolve(key || fromEnvironment(provider));
        };

        const timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, KEYRING_TIMEOUT_SECONDS, () => {
                settle(null);
                return GLib.SOURCE_REMOVE;
            });

        Secret.password_lookup(SCHEMA, {provider}, null, (_o, res) => {
            let key = null;
            try {
                key = Secret.password_lookup_finish(res);
            } catch {
                // A locked or absent keyring is not an error here — it just
                // means we fall through to the environment.
            }
            if (!settled)
                GLib.Source.remove(timer);
            settle(key);
        });
    });
}
