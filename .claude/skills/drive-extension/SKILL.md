---
name: drive-extension
description: See GitHub Bar in a throwaway nested GNOME Shell - its icon in the top bar and its preferences - and take screenshots of it. Use whenever a change to it must be seen or needs a fresh shell start (extension.js, metadata.json, the schema).
---

# Driving GitHub Bar in a nested shell

**Read `gnome-ext:nested-shell` first**: the loop (`start`, `do`, `reload`, `stop`), the
steps and its settings are there. This is what is particular to GitHub Bar.

```bash
./scripts/nested.sh start --headless     # GitHub Bar is ACTIVE when it returns
./scripts/nested.sh do "shot $S/top-bar.png 1100 0 500 32"
./scripts/nested.sh stop
```

- **Where it is**: an icon at the right of the top bar, left of the system menu.
- **Its settings**: `./scripts/nested.sh run gsettings --schemadir src/schemas set org.gnome.shell.extensions.github-bar show-indicator false`
  takes the icon away, in the nested shell's own settings.
- **Screenshots** go through `gnome-ext:screenshots`, under `start --stand-in`.
