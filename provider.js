'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Models that accept `output_config.effort`. Polifix asks for `low` on them:
 * a transformation is not a reasoning problem, and the default (`high`)
 * spends thinking tokens and seconds on "fix my typos". The list is a prefix
 * match because the model id is a free-text setting — an unrecognised id
 * simply gets no effort field rather than a 400.
 */
const EFFORT_CAPABLE = [
    'claude-fable-5', 'claude-mythos-5',
    'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-sonnet-5', 'claude-sonnet-4-6',
];

/**
 * Everything that varies per provider and is needed outside this file: the
 * name to show, where the user gets a key, and which setting holds the model
 * id. Kept here so the panel, the preferences and the live check cannot drift
 * apart about it.
 */
export const PROVIDERS = {
    anthropic: {
        label: 'Anthropic',
        keyHost: 'console.anthropic.com',
        modelKey: 'anthropic-model',
    },
    gemini: {
        label: 'Google Gemini',
        keyHost: 'aistudio.google.com',
        modelKey: 'gemini-model',
    },
    openai: {
        label: 'OpenAI-compatible',
        keyHost: 'platform.openai.com',
        modelKey: 'openai-model',
    },
};

function anthropicRequest({model, apiKey, system, text, maxTokens}) {
    const body = {
        model,
        max_tokens: maxTokens,
        stream: true,
        system,
        messages: [{role: 'user', content: text}],
    };

    if (EFFORT_CAPABLE.some(m => model.startsWith(m)))
        body.output_config = {effort: 'low'};

    return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
    };
}

function geminiRequest({model, apiKey, system, text, maxTokens}) {
    const path = encodeURIComponent(model);
    return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${path}:streamGenerateContent?alt=sse`,
        headers: {'x-goog-api-key': apiKey},
        body: {
            systemInstruction: {parts: [{text: system}]},
            contents: [{role: 'user', parts: [{text}]}],
            generationConfig: {maxOutputTokens: maxTokens, temperature: 0.3},
        },
    };
}

function openaiRequest({model, apiKey, baseUrl, system, text, maxTokens}) {
    return {
        url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        headers: {Authorization: `Bearer ${apiKey}`},
        body: {
            model,
            stream: true,
            max_tokens: maxTokens,
            messages: [
                {role: 'system', content: system},
                {role: 'user', content: text},
            ],
        },
    };
}

const BUILDERS = {
    anthropic: anthropicRequest,
    gemini: geminiRequest,
    openai: openaiRequest,
};

/**
 * Pull the text out of one decoded SSE payload. Returns '' for the many
 * events that carry no text — ping, message_start, usage, thinking deltas.
 */
export function extractDelta(provider, obj) {
    switch (provider) {
    case 'anthropic':
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta')
            return obj.delta.text ?? '';
        return '';
    case 'gemini':
        return (obj.candidates?.[0]?.content?.parts ?? [])
            .map(p => p.text ?? '').join('');
    case 'openai':
        return obj.choices?.[0]?.delta?.content ?? '';
    default:
        return '';
    }
}

/** Providers disagree about where an error lives; look in all the usual places. */
function extractError(obj) {
    if (typeof obj?.error === 'string')
        return obj.error;
    return obj?.error?.message ??
        obj?.error?.[0]?.message ??
        obj?.message ??
        null;
}

/**
 * One streaming request. Construct it, `run` it once, and `cancel` it if the
 * user gives up. The callbacks fire on the main loop; `onDone` and `onError`
 * are mutually exclusive and fire exactly once between them, except after a
 * cancel, when neither fires.
 */
export class Request {
    constructor(params) {
        this._params = params;
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 180});
        this._settled = false;
        this._buffer = [];
    }

    cancel() {
        this._settled = true;
        this._cancellable.cancel();
        this._session.abort();
    }

    get cancelled() {
        return this._cancellable.is_cancelled();
    }

    run({onDelta, onDone, onError}) {
        this._onDelta = onDelta;
        this._onDone = onDone;
        this._onError = onError;

        const {provider} = this._params;
        const builder = BUILDERS[provider];
        if (!builder) {
            this._fail(`Unknown provider "${provider}".`);
            return;
        }

        const {url, headers, body} = builder(this._params);
        const message = Soup.Message.new('POST', url);
        if (!message) {
            this._fail(`"${url}" is not a valid URL.`);
            return;
        }

        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);
        message.request_headers.append('accept', 'text/event-stream');

        const payload = new TextEncoder().encode(JSON.stringify(body));
        message.set_request_body_from_bytes(
            'application/json', new GLib.Bytes(payload));

        this._session.send_async(
            message, GLib.PRIORITY_DEFAULT, this._cancellable,
            (session, result) => {
                let stream;
                try {
                    stream = session.send_finish(result);
                } catch (e) {
                    if (!this.cancelled)
                        this._fail(`Could not reach ${url.split('/')[2]}: ${e.message}`);
                    return;
                }

                const status = message.get_status();
                const reader = new Gio.DataInputStream({base_stream: stream});

                if (status !== Soup.Status.OK) {
                    this._drainError(reader, status, message.get_reason_phrase());
                    return;
                }

                this._readLine(reader);
            });
    }

    /** A non-200 body is small and not SSE — read it whole, then explain it. */
    _drainError(reader, status, reason) {
        const chunks = [];
        const step = () => {
            reader.read_line_async(
                GLib.PRIORITY_DEFAULT, this._cancellable, (r, res) => {
                    let line = null;
                    try {
                        [line] = r.read_line_finish_utf8(res);
                    } catch {
                        line = null;
                    }

                    if (line !== null) {
                        chunks.push(line.replace(/\r$/, ''));
                        step();
                        return;
                    }

                    const raw = chunks.join('\n');
                    let detail = null;
                    try {
                        detail = extractError(JSON.parse(raw));
                    } catch {
                        detail = raw.trim() || null;
                    }

                    const hint = status === 401 || status === 403
                        ? ' Check the API key in Polifix settings.'
                        : '';
                    this._fail(`HTTP ${status} ${reason ?? ''}`.trim() +
                        (detail ? `: ${detail}` : '') + hint);
                });
        };
        step();
    }

    _readLine(reader) {
        reader.read_line_async(
            GLib.PRIORITY_DEFAULT, this._cancellable, (r, res) => {
                let line;
                try {
                    [line] = r.read_line_finish_utf8(res);
                } catch (e) {
                    if (!this.cancelled)
                        this._fail(`The stream broke: ${e.message}`);
                    return;
                }

                if (line === null) {
                    // End of body. Flush whatever the last event held — a
                    // gateway that closes without a trailing blank line
                    // would otherwise drop its final delta.
                    this._flushEvent();
                    this._succeed();
                    return;
                }

                // SSE terminates lines with CRLF, and read_line only strips
                // the LF. Without this the blank line between events reads as
                // "\r", no event ever flushes, and the whole stream arrives
                // as one unparseable blob at EOF. Gemini does this; the
                // others may at any time.
                const field = line.replace(/\r$/, '');

                if (field === '') {
                    if (!this._flushEvent())
                        return;
                } else if (field.startsWith('data:')) {
                    this._buffer.push(field.slice(5).trimStart());
                }
                // `event:`, `id:`, `retry:` and comments carry nothing we need.

                this._readLine(r);
            });
    }

    /**
     * Decode one complete event. Returns false once the stream has settled,
     * so the read loop knows to stop.
     */
    _flushEvent() {
        if (!this._buffer.length)
            return true;

        const raw = this._buffer.join('\n');
        this._buffer = [];

        if (raw === '[DONE]') {
            this._succeed();
            return false;
        }

        let obj;
        try {
            obj = JSON.parse(raw);
        } catch {
            return true;   // A partial or non-JSON event is not fatal.
        }

        const error = extractError(obj);
        if (error) {
            this._fail(error);
            return false;
        }

        const text = extractDelta(this._params.provider, obj);
        if (text)
            this._onDelta(text);

        return true;
    }

    _succeed() {
        if (this._settled)
            return;
        this._settled = true;
        this._onDone();
    }

    _fail(message) {
        if (this._settled)
            return;
        this._settled = true;
        this._onError(message);
    }
}
