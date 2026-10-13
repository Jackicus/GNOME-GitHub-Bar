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
  at about (1367, 16) on the default monitor. The menu opens below it, about 360 px wide:
  the user row at about (1300, 70) folds the graph and Open Profile on GitHub out under it;
  the tabs Inbox, Pulls, Assigned sit at y 125 (folded), x about 1240, 1343, 1440. The
  list under them scrolls when it is long.
- **Never click an item, "N more…" or Open Profile on GitHub**: each opens github.com in
  the user's real browser. Mark All as Read, an inbox row's check button (at its right end, shown on hover), the tabs
  and the user row are safe. The driver has no Delete key; BackSpace stands in only if the
  code is changed for the test.
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
- **Screenshots** go through `gnome-ext:screenshots`: `./scripts/nested.sh shots`
  (`make shots`), then `shots --light`; `--out DIR` writes to the scratchpad to compare
  first. The README links `menu.png` (the hero), `top-bar-cropped.png`,
  `menu-profile.png`, `notification.png`, `menu-light.png` and both preferences shots.
  The click points (`SHOTS_*` in `./scripts/nested.d/shots.sh`) are measured with the
  driver's recording indicator in the bar, which moves the button left of where a picture
  without it shows it (about 1433).
  A menu opened with an extra indicator in the bar stays where it opened, and is cut off
  on the left once the indicator goes.
- **A microphone indicator in the nested bar** is an application recording on the
  desktop: the nested session shares its PipeWire. `shots` warns about it; wait until
  the recording ends.
