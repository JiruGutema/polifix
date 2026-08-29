'use strict';

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Request, PROVIDERS} from './provider.js';
import {buildSystemPrompt, loadTransformations} from './transforms.js';
import {lookupKey} from './secrets.js';

/**
 * St.ScrollView only accepts a child implementing StScrollable, which
 * St.Entry and St.Label are not — hence the St.BoxLayout wrapper. The two
 * branches are the API change: St.ScrollView grew a `child` property in
 * GNOME 46 and lost `add_actor` in the same cycle.
 */
function setScrollChild(scroll, child) {
    const scrollable = new St.BoxLayout({vertical: true, x_expand: true});
    scrollable.add_child(child);

    if (scroll.set_child)
        scroll.set_child(scrollable);
    else
        scroll.add_actor(scrollable);
}

function multilineEntry(hintText, styleClass) {
    const entry = new St.Entry({
        style_class: styleClass,
        hint_text: hintText,
        can_focus: true,
        x_expand: true,
    });
    const text = entry.clutter_text;
    text.set_single_line_mode(false);
    text.set_activatable(false);
    text.line_wrap = true;
    text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    return entry;
}

export const PolifixPanel = GObject.registerClass(
class PolifixPanel extends St.Widget {
    _init(settings, openPreferences) {
        super._init({
            style_class: 'polifix-overlay',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            reactive: true,
        });

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._grab = null;
        this._request = null;
        this._result = '';
        this._transformations = [];
        this._selected = 0;
        this._chips = [];

        this._buildScrim();
        this._buildCard();
    }

    _buildScrim() {
        const scrim = new St.Widget({
            style_class: 'polifix-scrim',
            x_expand: true,
            y_expand: true,
            reactive: true,
        });
        scrim.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.add_child(scrim);
    }

    _buildCard() {
        this._card = new St.BoxLayout({
            style_class: 'polifix-card',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        // Swallow presses on the card so they do not reach the scrim.
        this._card.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.add_child(this._card);

        this._card.add_child(this._buildHeader());
        this._card.add_child(this._buildInput());
        this._card.add_child(this._buildChipRow());
        this._card.add_child(this._buildOutput());
        this._card.add_child(this._buildFooter());
    }

    _buildHeader() {
        const header = new St.BoxLayout({style_class: 'polifix-header'});

        header.add_child(new St.Label({
            style_class: 'polifix-title',
            text: 'Polifix',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._modelChip = new St.Label({
            style_class: 'polifix-chip-model',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._modelChip);

        const gear = new St.Button({
            style_class: 'polifix-icon-button',
            can_focus: true,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
        });
        gear.connect('clicked', () => {
            this.close();
            this._openPreferences();
        });
        header.add_child(gear);

        return header;
    }

    _buildInput() {
        this._input = multilineEntry('Paste or type the text to polish…', 'polifix-input');

        const scroll = new St.ScrollView({
            style_class: 'polifix-input-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        setScrollChild(scroll, this._input);
        return scroll;
    }

    _buildChipRow() {
        this._chipBox = new St.BoxLayout({style_class: 'polifix-chips'});

        const scroll = new St.ScrollView({
            style_class: 'polifix-chip-scroll',
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        // Already scrollable — no wrapper, or the row would not scroll.
        if (scroll.set_child)
            scroll.set_child(this._chipBox);
        else
            scroll.add_actor(this._chipBox);
        return scroll;
    }

    _buildOutput() {
        this._output = new St.Label({style_class: 'polifix-output', text: ''});
        this._output.clutter_text.line_wrap = true;
        this._output.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._output.clutter_text.selectable = true;

        this._outputScroll = new St.ScrollView({
            style_class: 'polifix-output-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        setScrollChild(this._outputScroll, this._output);
        return this._outputScroll;
    }

    _buildFooter() {
        const footer = new St.BoxLayout({style_class: 'polifix-footer'});

        this._status = new St.Label({
            style_class: 'polifix-status',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footer.add_child(this._status);

        const reuse = new St.Button({
            style_class: 'polifix-button',
            label: 'Use as input',
            can_focus: true,
        });
        reuse.connect('clicked', () => this._useResultAsInput());
        footer.add_child(reuse);

        const copy = new St.Button({
            style_class: 'polifix-button',
            label: 'Copy',
            can_focus: true,
        });
        copy.connect('clicked', () => this._copyResult(true));
        footer.add_child(copy);

        this._runButton = new St.Button({
            style_class: 'polifix-button polifix-button-primary',
            label: 'Transform',
            can_focus: true,
        });
        this._runButton.connect('clicked', () => this._toggleRun());
        footer.add_child(this._runButton);

        return footer;
    }

    // ------------------------------------------------------------------
    // Opening and closing
    // ------------------------------------------------------------------

    get isOpen() {
        return this.visible;
    }

    open(seedText = null) {
        if (this.isOpen) {
            if (seedText !== null)
                this._input.set_text(seedText);
            this._input.grab_key_focus();
            return;
        }

        this._reloadTransformations();
        this._updateModelChip();

        if (seedText !== null) {
            this._input.set_text(seedText);
            this._setStatus(seedText.trim()
                ? 'Seeded from the clipboard.'
                : 'The clipboard held no text.');
        } else {
            this._setStatus('');
        }

        this._setResult('');
        this._fitToMonitor();
        this.show();

        this._grab = Main.pushModal(this, {
            actionMode: Shell.ActionMode.SYSTEM_MODAL,
        });
        if ((this._grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
            Main.popModal(this._grab);
            this._grab = null;
            this.hide();
            Main.notify('Polifix', 'Something else is holding the keyboard.');
            return;
        }

        this._input.grab_key_focus();
        this._input.clutter_text.set_selection(0, -1);
    }

    close() {
        if (!this.isOpen)
            return;

        this._abortRequest();

        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.hide();
    }

    /** The card is centred by BinLayout; the overlay just covers the monitor. */
    _fitToMonitor() {
        const monitor = Main.layoutManager.currentMonitor ??
            Main.layoutManager.primaryMonitor;
        this.set_position(monitor.x, monitor.y);
        this.set_size(monitor.width, monitor.height);
        this._card.style = `max-width: ${Math.round(monitor.width * 0.62)}px;`;
    }

    // ------------------------------------------------------------------
    // Transformations
    // ------------------------------------------------------------------

    _reloadTransformations() {
        this._transformations = loadTransformations(this._settings);
        if (this._selected >= this._transformations.length)
            this._selected = 0;

        this._chipBox.destroy_all_children();
        this._chips = [];

        this._transformations.forEach((transformation, index) => {
            const chip = new St.Button({
                style_class: 'polifix-chip',
                can_focus: true,
                label: index < 9
                    ? `${index + 1}  ${transformation.name}`
                    : transformation.name,
            });
            chip.connect('clicked', () => {
                this._select(index);
                this._start();
            });
            this._chipBox.add_child(chip);
            this._chips.push(chip);
        });

        this._select(this._selected);
    }

    _select(index) {
        if (index < 0 || index >= this._chips.length)
            return;
        this._selected = index;
        this._chips.forEach((chip, i) => {
            if (i === index)
                chip.add_style_class_name('polifix-chip-selected');
            else
                chip.remove_style_class_name('polifix-chip-selected');
        });
    }

    _updateModelChip() {
        const provider = this._settings.get_string('provider');
        this._modelChip.text =
            `${PROVIDERS[provider]?.label ?? provider} · ${this._modelFor(provider)}`;
    }

    _modelFor(provider) {
        const key = PROVIDERS[provider]?.modelKey ?? 'anthropic-model';
        return this._settings.get_string(key);
    }

    get _running() {
        return this._request !== null;
    }

    _toggleRun() {
        if (this._running)
            this._abortRequest('Stopped.');
        else
            this._start();
    }

    _abortRequest(status = null) {
        if (!this._running)
            return;
        this._request.cancel();
        this._request = null;
        this._setRunning(false);
        if (status)
            this._setStatus(status);
    }

    _setRunning(running) {
        this._runButton.label = running ? 'Stop' : 'Transform';
        this._chips.forEach(chip => (chip.reactive = !running));
    }

    async _start() {
        const text = this._input.get_text().trim();
        if (!text) {
            this._setStatus('Nothing to transform yet.');
            this._input.grab_key_focus();
            return;
        }

        const transformation = this._transformations[this._selected];
        if (!transformation)
            return;

        this._abortRequest();
        this._setResult('');
        this._setRunning(true);
        this._setStatus(`${transformation.name}…`);

        const provider = this._settings.get_string('provider');
        const {key: apiKey, source} = await lookupKey(provider);

        // The user may have closed the panel while the keyring answered.
        if (!this.isOpen)
            return;

        if (!apiKey) {
            const label = PROVIDERS[provider]?.label ?? provider;
            this._setRunning(false);
            this._setStatus(source === 'unavailable'
                ? 'The keyring did not answer — no secret service on this ' +
                  'session bus. Set POLIFIX_API_KEY instead.'
                : `No ${label} API key saved — open settings to add one.`);
            return;
        }

        const request = new Request({
            provider,
            apiKey,
            model: this._modelFor(provider),
            baseUrl: this._settings.get_string('openai-base-url'),
            system: buildSystemPrompt(transformation),
            text,
            maxTokens: this._settings.get_int('max-output-tokens'),
        });
        this._request = request;

        request.run({
            onDelta: chunk => {
                if (this._request !== request)
                    return;
                this._setResult(this._result + chunk);
            },
            onDone: () => {
                if (this._request !== request)
                    return;
                this._request = null;
                this._setRunning(false);
                if (this._result.trim()) {
                    this._copyResult(false);
                    this._setStatus('Done — copied to the clipboard.');
                    Main.notify('Polifix', `${transformation.name} — result copied to the clipboard.`);
                } else {
                    this._setStatus('The model returned nothing.');
                }
            },
            onError: message => {
                if (this._request !== request)
                    return;
                this._request = null;
                this._setRunning(false);
                this._setStatus(message);
            },
        });
    }

    // ------------------------------------------------------------------
    // Result handling
    // ------------------------------------------------------------------

    _setResult(text) {
        this._result = text;
        this._output.text = text;

        const adjustment = this._outputScroll.vscroll
            ? this._outputScroll.vscroll.adjustment
            : this._outputScroll.vadjustment;
        if (adjustment)
            adjustment.value = adjustment.upper - adjustment.page_size;
    }

    _copyResult(announce) {
        if (!this._result.trim()) {
            if (announce)
                this._setStatus('There is no result to copy.');
            return;
        }
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._result);
        if (announce)
            this._setStatus('Copied to the clipboard.');
    }

    _useResultAsInput() {
        if (!this._result.trim()) {
            this._setStatus('There is no result to reuse.');
            return;
        }
        this._input.set_text(this._result);
        this._setResult('');
        this._setStatus('Result moved to the input.');
        this._input.grab_key_focus();
    }

    _setStatus(text) {
        this._status.text = text;
    }

    // ------------------------------------------------------------------
    // Keyboard
    // ------------------------------------------------------------------

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;

        if (symbol === Clutter.KEY_Escape) {
            if (this._running)
                this._abortRequest('Stopped.');
            else
                this.close();
            return Clutter.EVENT_STOP;
        }

        if (ctrl && (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter)) {
            this._toggleRun();
            return Clutter.EVENT_STOP;
        }

        if (ctrl && (symbol === Clutter.KEY_r || symbol === Clutter.KEY_R)) {
            this._useResultAsInput();
            return Clutter.EVENT_STOP;
        }

        if (alt && symbol >= Clutter.KEY_1 && symbol <= Clutter.KEY_9) {
            this._select(symbol - Clutter.KEY_1);
            this._start();
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(event);
    }

    destroy() {
        this._abortRequest();
        super.destroy();
    }
});
