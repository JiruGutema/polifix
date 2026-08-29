UUID    = polifix@jirugutema.github.io
EXTDIR  = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SOURCES = extension.js prefs.js panel.js provider.js transforms.js secrets.js \
          metadata.json stylesheet.css

.PHONY: all install link enable disable uninstall pack logs nested test

all: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.polifix.gschema.xml
	glib-compile-schemas schemas/

## Copy the extension into place.
install: all
	mkdir -p $(EXTDIR)/schemas
	cp $(SOURCES) $(EXTDIR)/
	cp schemas/*.xml schemas/gschemas.compiled $(EXTDIR)/schemas/

## Symlink instead, so edits here are live after the next shell restart.
link: all
	rm -rf $(EXTDIR)
	ln -s $(CURDIR) $(EXTDIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

uninstall:
	rm -rf $(EXTDIR)

## A zip in the shape extensions.gnome.org expects.
pack: all
	gnome-extensions pack --force \
	  --extra-source=panel.js \
	  --extra-source=provider.js \
	  --extra-source=transforms.js \
	  --extra-source=secrets.js \
	  --schema=schemas/org.gnome.shell.extensions.polifix.gschema.xml \
	  .

## Real socket, real keyring — no mocks of libsoup or libsecret.
test:
	./tests/run.sh

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

## Try it without logging out: a second shell in a window.
nested:
	dbus-run-session -- env MUTTER_DEBUG_DUMMY_MODE_SPECS=1400x900 \
	  gnome-shell --nested --wayland
