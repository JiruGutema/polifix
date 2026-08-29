#!/usr/bin/env bash
# A second GNOME Shell in a window, for trying the extension without logging
# out.
#
# The nested shell runs under dbus-run-session, so it gets its own session
# bus — and there is no secret service on it. The keyring is therefore
# unreachable from inside the nested shell: it cannot read a key, and the
# preferences window cannot save one. Hand the key in through the environment
# instead, which is the fallback secrets.js already provides for headless use.
set -u
cd "$(dirname "$0")/.."

provider=$(gsettings --schemadir schemas get \
    org.gnome.shell.extensions.polifix provider | tr -d "'")

if key=$(gjs -m tools/print-key.js "$provider" 2>/dev/null); then
    export POLIFIX_API_KEY="$key"
    unset key
    echo "Handed the $provider key to the nested session."
else
    echo "No $provider key in the keyring — the nested panel will say so."
fi

echo "Close the nested window to come back."
exec dbus-run-session -- \
    env MUTTER_DEBUG_DUMMY_MODE_SPECS=1400x900 \
    gnome-shell --nested --wayland
