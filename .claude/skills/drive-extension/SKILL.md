---
name: drive-extension
description: See GitHub Bar in a throwaway nested GNOME Shell - its button and count in the top bar, its menu, its notifications and its preferences, over the stand-in account - and take screenshots of it. Use whenever a change to it must be seen or needs a fresh shell start (extension.js, metadata.json, the schema).
---

# Driving GitHub Bar in a nested shell

**Read `gnome-ext:nested-shell` first**: the loop (`start`, `do`, `reload`, `stop`), the
steps and its settings are there. This is what is particular to GitHub Bar.

```bash
./scripts/nested.sh start --stand-in --headless   # ACTIVE when it returns; data a second later
./scripts/nested.sh click 1367 16                 # open the menu (1600x900, one monitor)
./scripts/nested.sh shot $S/menu.png 1000 0 600 900
./scripts/nested.sh stop
```

- **Always `--stand-in`.** The nested session has no keyring, so a plain `start` is signed
  out; the stand-in is the account `stand-in` with invented data and no network.
- **Where it is**: the pull-request glyph and its count, left of the other status icons,
  at about (1367, 16) on the default monitor. The menu opens below it, about 360 px wide;
  its sections scroll (`scroll X Y down N` over them) above a fixed Refresh, Open GitHub
  and Settings.
- **Never click an item, "N more…" or Open GitHub**: each opens github.com in the user's
  real browser. Mark All as Read, Refresh and Settings are safe.
- **States**: `./scripts/nested.sh state STATE` (`ok`, `empty`, `unauthorized`, `offline`,
  `error`, `signed-out`, `signed-in`, `checks-pending`, `checks-passed`, `checks-failed`);
  the app re-reads about 2 s later. `checks-pending` then `checks-passed` shows the "Checks
  passed on stand-in/garden#42" banner at the top centre. Marked-read threads stay read
  until the next `start`.
- **Its settings**: `./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas set
  org.gnome.shell.extensions.github-bar count none` (after `glib-compile-schemas
  src/schemas`). The preferences: `./scripts/nested.sh run gnome-extensions prefs
  github-bar@jackicus`, then `do "window FILE"`. The Extensions app keeps `prefs.js`
  loaded: an edit to it is seen after `stop` + `start`.
- **Screenshots** go through `gnome-ext:screenshots`, under `start --stand-in`.
