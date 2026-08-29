'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {DEFAULT_TRANSFORMATIONS, loadTransformations, saveTransformations} from './transforms.js';
import {lookupKey, storeKey} from './secrets.js';
import {PROVIDERS} from './provider.js';

const PROVIDER_ORDER = Object.keys(PROVIDERS);

/**
 * A password row wired to the login keyring rather than to GSettings. Keys
 * never touch dconf, which is world-readable inside the session.
 *
 * Adw.PasswordEntryRow, Adw.EntryRow and Adw.ExpanderRow are final types, so
 * these are factories rather than subclasses.
 */
function apiKeyRow(provider) {
    const row = new Adw.PasswordEntryRow({
        title: 'API key',
        show_apply_button: true,
    });

    const status = new Gtk.Label({
        css_classes: ['dim-label', 'caption'],
        label: 'Checking the keyring…',
    });
    row.add_suffix(status);

    lookupKey(provider).then(key => {
        if (key) {
            row.text = key;
            status.label = 'Saved';
        } else {
            status.label = `Get one at ${PROVIDERS[provider].keyHost}`;
        }
    }).catch(() => {
        status.label = 'Keyring unavailable';
    });

    row.connect('apply', () => {
        const key = row.text.trim();
        status.label = 'Saving…';
        storeKey(provider, key)
            .then(() => (status.label = key ? 'Saved' : 'Cleared'))
            .catch(e => (status.label = `Failed: ${e.message}`));
    });

    return row;
}

/** An accelerator as text, validated before it reaches GSettings. */
function shortcutRow(settings, key, title) {
    const row = new Adw.EntryRow({title, show_apply_button: true});

    const current = settings.get_strv(key);
    row.text = current.length ? current[0] : '';

    const status = new Gtk.Label({css_classes: ['dim-label', 'caption']});
    row.add_suffix(status);

    row.connect('apply', () => {
        const accelerator = row.text.trim();

        if (!accelerator) {
            settings.set_strv(key, []);
            status.label = 'Disabled';
            return;
        }

        // Gtk 4 returns [ok, keyval, mods]; anything else is a typo.
        const [ok, keyval] = Gtk.accelerator_parse(accelerator);
        if (!ok || !keyval) {
            status.label = 'Not a valid shortcut';
            return;
        }

        settings.set_strv(key, [accelerator]);
        status.label = 'Saved';
    });

    return row;
}

/** One transformation: a name, a prompt, and a way to delete it. */
function transformationRow(transformation, onChanged, onRemove) {
    const row = new Adw.ExpanderRow({
        title: transformation.name,
        subtitle: transformation.prompt,
    });

    const name = new Adw.EntryRow({title: 'Name', text: transformation.name});
    name.connect('changed', () => {
        transformation.name = name.text;
        row.title = name.text || 'Untitled';
        onChanged();
    });
    row.add_row(name);

    const prompt = new Adw.EntryRow({title: 'Prompt', text: transformation.prompt});
    prompt.connect('changed', () => {
        transformation.prompt = prompt.text;
        row.subtitle = prompt.text;
        onChanged();
    });
    row.add_row(prompt);

    const remove = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        css_classes: ['flat'],
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Remove this transformation',
    });
    remove.connect('clicked', () => onRemove(transformation));
    row.add_suffix(remove);

    return row;
}

export default class PolifixPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 780);
        window.add(this._providerPage(settings));
        window.add(this._transformationsPage(settings));
        window.add(this._behaviourPage(settings));
    }

    _providerPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Provider',
            icon_name: 'network-transmit-receive-symbolic',
        });

        const choice = new Adw.PreferencesGroup({
            title: 'Where text goes',
            description: 'Polifix talks straight to the provider you choose. ' +
                'There is no Polifix server, and no text passes through one.',
        });

        const provider = new Adw.ComboRow({
            title: 'Provider',
            model: Gtk.StringList.new(PROVIDER_ORDER.map(id => PROVIDERS[id].label)),
            selected: Math.max(0, PROVIDER_ORDER.indexOf(settings.get_string('provider'))),
        });
        provider.connect('notify::selected', () =>
            settings.set_string('provider', PROVIDER_ORDER[provider.selected]));
        choice.add(provider);

        const maxTokens = new Adw.SpinRow({
            title: 'Result length ceiling',
            subtitle: 'Maximum tokens in a single result',
            adjustment: new Gtk.Adjustment({
                lower: 256, upper: 32000, step_increment: 256, page_increment: 1024,
            }),
        });
        settings.bind('max-output-tokens', maxTokens, 'value', 0);
        choice.add(maxTokens);
        page.add(choice);

        page.add(this._providerGroup(settings, 'anthropic'));
        page.add(this._providerGroup(settings, 'gemini'));

        const baseUrl = new Adw.EntryRow({title: 'Base URL'});
        settings.bind('openai-base-url', baseUrl, 'text', 0);
        page.add(this._providerGroup(settings, 'openai', {
            description: 'Anything that speaks /chat/completions — OpenAI, ' +
                'OpenRouter, Groq, or a local Ollama or llama.cpp server.',
            leadingRows: [baseUrl],
        }));

        return page;
    }

    /** Model, key, and whatever else that particular provider needs. */
    _providerGroup(settings, id, {description = null, leadingRows = []} = {}) {
        const {label, modelKey} = PROVIDERS[id];
        const group = new Adw.PreferencesGroup(
            description ? {title: label, description} : {title: label});

        for (const row of leadingRows)
            group.add(row);

        const model = new Adw.EntryRow({title: 'Model'});
        settings.bind(modelKey, model, 'text', 0);
        group.add(model);

        group.add(apiKeyRow(id));
        return group;
    }

    _transformationsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Transformations',
            icon_name: 'format-text-italic-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Transformations',
            description: 'The first nine are reachable with Alt+1 to Alt+9 ' +
                'while the panel is open.',
        });
        page.add(group);

        let transformations = loadTransformations(settings);
        const rows = [];

        const persist = () => saveTransformations(
            settings,
            transformations.filter(t => t.name.trim() && t.prompt.trim()));

        const rebuild = () => {
            rows.forEach(row => group.remove(row));
            rows.length = 0;

            transformations.forEach(transformation => {
                const row = transformationRow(
                    transformation,
                    persist,
                    target => {
                        transformations = transformations.filter(t => t !== target);
                        persist();
                        rebuild();
                    });
                group.add(row);
                rows.push(row);
            });
        };

        const add = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Add a transformation',
        });
        add.connect('clicked', () => {
            transformations.push({name: 'New transformation', prompt: ''});
            rebuild();
        });
        group.set_header_suffix(add);

        const reset = new Adw.PreferencesGroup();
        const resetButton = new Gtk.Button({
            label: 'Restore the built-in transformations',
            halign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetButton.connect('clicked', () => {
            transformations = DEFAULT_TRANSFORMATIONS.map(t => ({...t}));
            settings.set_string('transformations', '[]');
            rebuild();
        });
        reset.add(resetButton);
        page.add(reset);

        rebuild();
        return page;
    }

    _behaviourPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Shortcuts',
            icon_name: 'preferences-desktop-keyboard-symbolic',
        });

        const shortcuts = new Adw.PreferencesGroup({
            title: 'Shortcuts',
            // Escaped: a group description is parsed as Pango markup.
            description: 'Written the way GTK writes them, for example ' +
                '&lt;Super&gt;t or &lt;Control&gt;&lt;Alt&gt;space. ' +
                'Leave a row empty to disable that shortcut.',
        });
        shortcuts.add(shortcutRow(settings, 'toggle-panel', 'Open Polifix'));
        shortcuts.add(shortcutRow(settings, 'transform-clipboard', 'Open, seeded from the clipboard'));
        page.add(shortcuts);

        const inPanel = new Adw.PreferencesGroup({title: 'Inside the panel'});
        for (const [keys, what] of [
            ['Ctrl+Enter', 'Transform, or stop a running transformation'],
            ['Alt+1 … Alt+9', 'Run that transformation'],
            ['Ctrl+R', 'Move the result back into the input'],
            ['Tab', 'Walk the boxes, the chips and the buttons'],
            ['Esc', 'Stop a transformation, then close'],
        ])
            inPanel.add(new Adw.ActionRow({title: what, subtitle: keys}));
        page.add(inPanel);

        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        const indicator = new Adw.SwitchRow({
            title: 'Show the panel indicator',
            subtitle: 'Click it to open Polifix; right-click for the menu',
        });
        settings.bind('show-indicator', indicator, 'active', 0);
        appearance.add(indicator);
        page.add(appearance);

        return page;
    }
}
