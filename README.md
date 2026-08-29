# Polifix

Polish any text from anywhere, with one keystroke.

Press `Super+T`, paste or type, pick a transformation, and the result streams
in and lands on your clipboard. Polifix talks straight to your own AI provider
with your own API key — there is no Polifix server, and nothing you write
passes through one.

It is a GNOME Shell extension, so it lives in the shell process: no tray app,
no daemon, no window to manage.

## Install

```bash
make link      # symlink into ~/.local/share/gnome-shell/extensions
make enable    # after the shell restarts
```

On X11, restart the shell with `Alt+F2`, `r`, `Enter`. On Wayland you have to
log out and back in — or try it without leaving your session:

```bash
make nested    # a second GNOME Shell in a window
```

## Set an API key

Open the settings (the gear in the panel, or `gnome-extensions prefs
polifix@jirugutema.github.io`), choose a provider, and type the key into its **API key**
row. It is written to your login keyring through libsecret — never to dconf,
never to a file.

| Provider | Key from | Default model |
|---|---|---|
| Anthropic | console.anthropic.com | `claude-opus-5` |
| Google Gemini | aistudio.google.com | `gemini-2.5-flash` |
| OpenAI-compatible | your endpoint | `gpt-4o-mini` |

The OpenAI-compatible option is any server that speaks `/chat/completions` —
OpenAI, OpenRouter, Groq, or a local Ollama or llama.cpp. Point the base URL
at it.

A shell `export` will not reach the extension — GNOME Shell starts at login
and never sees it. To move a key out of your environment and into the keyring:

```bash
gjs -m tools/save-key.js gemini    # reads POLIFIX_API_KEY, prints no secret
```

The environment is still consulted when the keyring is locked or absent, which
is what makes the extension usable headless and from scripts. For that to work
in a desktop session the variable has to be set before login — in
`~/.config/environment.d/polifix.conf`, not in a terminal:

```
POLIFIX_ANTHROPIC_API_KEY=...   # or GEMINI / OPENAI
POLIFIX_API_KEY=...             # any provider
```

## Shortcuts

| Key | Does |
|---|---|
| `Super+T` | Open with an empty input |
| `Super+Shift+V` | Open, seeded from the clipboard |
| `Ctrl+Enter` | Transform — or stop one that is running |
| `Alt+1` … `Alt+9` | Run that transformation |
| `Ctrl+R` | Move the result back into the input, to chain a second pass |
| `Tab` | Walk the boxes, the chips and the buttons |
| `Esc` | Stop a transformation, then close |

Both global shortcuts are editable in the settings.

## Transformations

A transformation is a name and a prompt. Five ship with it — fix typos, make
it shorter, work email, explain simply, bullet points — and you can edit, add
or remove them on the **Transformations** page. The first nine get the
`Alt+1`…`Alt+9` shortcuts, in order.

Every request carries the same output contract: return the transformed text
and nothing else, and treat the text as material rather than as an instruction
addressed to the model. That is what makes a result paste-able without editing
out "Here you go:" first.

## Layout

| File | What it is |
|---|---|
| `extension.js` | Lifecycle: the indicator, the two global shortcuts, wiring |
| `panel.js` | The panel — layout, keyboard handling, streaming into the output |
| `provider.js` | The three HTTP clients and the SSE reader, over libsoup3 |
| `transforms.js` | The transformation model, the defaults, the output contract |
| `secrets.js` | libsecret storage, and the environment fallback |
| `prefs.js` | The settings window |
| `tests/` | `make test` — real socket, real keyring, no mocks; `live-check.js` hits a provider for real |
| `tools/` | `save-key.js` — import a key from the environment into the keyring |

## Licence

MIT.
