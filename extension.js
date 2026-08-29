'use strict';

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {PolifixPanel} from './panel.js';

/**
 * Primary click opens the panel — the whole point of the extension is to be
 * one gesture away. The menu is on secondary click, where it stays out of
 * the way.
 */
const PolifixIndicator = GObject.registerClass(
class PolifixIndicator extends PanelMenu.Button {
    _init(callbacks) {
        super._init(0.5, 'Polifix');
        this._callbacks = callbacks;

        this.add_child(new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'format-text-italic-symbolic',
        }));

        this.menu.addAction('Open Polifix', () => callbacks.open());
        this.menu.addAction('Transform the clipboard', () => callbacks.openWithClipboard());
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => callbacks.openPreferences());
    }

    vfunc_event(event) {
        const type = event.type();
        const opening = type === Clutter.EventType.TOUCH_BEGIN ||
            (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === 1);

        if (opening) {
            this.menu.close();
            this._callbacks.open();
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === 3) {
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }
});

export default class PolifixExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._panel = new PolifixPanel(this._settings, () => this.openPreferences());
        Main.layoutManager.modalDialogGroup.add_child(this._panel);

        this._indicator = null;
        this._settings.connectObject(
            'changed::show-indicator', () => this._syncIndicator(), this);
        this._syncIndicator();

        this._addKeybinding('toggle-panel', () => this._toggle());
        this._addKeybinding('transform-clipboard', () => this._openWithClipboard());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-panel');
        Main.wm.removeKeybinding('transform-clipboard');

        this._settings.disconnectObject(this);

        this._indicator?.destroy();
        this._indicator = null;

        this._panel?.destroy();
        this._panel = null;

        this._settings = null;
    }

    /**
     * SYSTEM_MODAL is in the mode mask so that the same shortcut that opens
     * the panel also closes it — the panel's own grab runs in that mode.
     */
    _addKeybinding(name, handler) {
        Main.wm.addKeybinding(
            name, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL |
            Shell.ActionMode.OVERVIEW |
            Shell.ActionMode.SYSTEM_MODAL,
            handler);
    }

    _syncIndicator() {
        const wanted = this._settings.get_boolean('show-indicator');
        if (wanted && !this._indicator) {
            this._indicator = new PolifixIndicator({
                open: () => this._panel.open(),
                openWithClipboard: () => this._openWithClipboard(),
                openPreferences: () => this.openPreferences(),
            });
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!wanted && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _toggle() {
        if (this._panel.isOpen)
            this._panel.close();
        else
            this._panel.open();
    }

    _openWithClipboard() {
        St.Clipboard.get_default().get_text(
            St.ClipboardType.CLIPBOARD,
            (_clipboard, text) => this._panel.open(text ?? ''));
    }
}
