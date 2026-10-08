# GitHub Bar

Shared rules for every extension come from the GNOME-EXTENSIONS kit: `../CLAUDE.md` and `../.claude/rules/` (loaded with this file), and the `gnome-ext:*` skills. `.claude/kit.sh` pulls the kit at session start, or, with no kit beside this repository, fetches it and prints its rules into the session.

A GNOME Shell extension (UUID `github-bar@jackicus`, `version-name` 0.1, shell 50): Your GitHub notifications, review requests and pull request CI status in the top bar

## Layout

```
src/extension.js        entry point: imports lib/app.js
src/prefs.js            preferences (own process: Gtk and Adw only)
src/schemas/            org.gnome.shell.extensions.github-bar
src/lib/app.js          GitHubBarApp: everything enable() puts into the shell
scripts/ext.conf        what the kit's scripts need to know about this extension
```

## Settings

`show-indicator` (true): the icon in the top bar.

## Verifying

`make check` (ESLint, the schema, and `size`; CI runs it). Anything visible is seen in the
nested shell (`gnome-ext:nested-shell`, then this repository's `drive-extension`
skill).

## Gotchas

None of its own yet. A trap true of every extension goes in the kit, not here.
