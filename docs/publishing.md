# Publishing to extensions.gnome.org

## The zip

A release is a pushed `v*` tag: the `Release` workflow runs `make check`, packs
`dist/github-bar@jackicus.shell-extension.zip` with `./scripts/dev.sh pack` and attaches it
to the GitHub release. That zip is what is uploaded: `LICENSE`, `metadata.json`,
`extension.js`, `prefs.js`, `stylesheet.css`, the schema XML, `lib/` and `icons/`. `make pack`
refuses anything else and drops a compiled schema (the shell compiles it on install).

## metadata.json

`uuid` is fixed once uploaded; `shell-version` is `["50"]`, the only version it has run on;
`url` is the repository; `settings-schema` is read with `getSettings()` and no argument.
`version` is absent (extensions.gnome.org assigns it), `version-name` is letters, digits and
dots, and `session-modes` is absent: a screen lock disables the extension. The description
says where the token is read from, that it is never stored, the two hosts it talks to, the
avatar cache and the one write to GitHub (marking notifications read).

## The review guidelines, checked against this code

Checked on 2026-10-08 against the
[Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and
[Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html), on the
zip `make pack` builds. No blockers.

- **Lifecycle.** `extension.js` builds `GitHubBarApp` in `enable()`; module scope holds
  constants, the class registrations and `Gio._promisify` calls. `disable()` cancels the
  fetch in flight, cancels the `hosts.yml` monitor, removes the poll timer and the debounce
  source, disconnects the settings, destroys the button (its menu and items with it) and the
  notification source, and aborts the HTTP session.
- **Imports.** No `ByteArray`, `Lang` or `Mainloop`; no `Gdk`, `Gtk` or `Adw` in the shell
  process; `prefs.js` imports nothing of the extension's, and `./scripts/dev.sh imports`
  (in `make check`) fails when it reaches St, Clutter, Meta, Shell, Soup or a shell module.
- **Readable code.** Plain ES modules, unminified, ESLint clean; `make check` ends with
  `./scripts/dev.sh size` (1100 lines, 3% comments, 9 `try` blocks on this date). No `try`
  around `destroy()`, `disconnect()` or `GLib.Source.remove()`, no `_destroyed` flags, no
  line over 200 characters, `enable()` and `disable()` side by side. Optional chaining is
  only on GitHub's responses and on fields that are null until the first fetch.
- **Logging.** Failures only: a fetch that throws, the avatar, a link that cannot open.
  Offline, signed out and a refused login are shown in the menu, not logged.
- **Subprocesses.** None. No `run_dispose()`, privileged process or clipboard use.
- **Other extensions.** None touched.
- **Network and the token.** The token is the GitHub CLI's own: `oauth_token` from gh's
  `hosts.yml` when gh stored it there, else the secret service item gh wrote
  (`service gh:github.com`), searched through libsecret, asynchronously and without
  unlocking, so a locked keyring reads as signed out and never prompts. It is read on each
  fetch, sent only to `api.github.com` in the `Authorization` header, and never kept (a
  SHA-256 of it tells a change of account), logged or refreshed. Nothing of gh's is written.
  The avatar is fetched from the URL GitHub gives, without the token, and cached under
  `~/.cache/github-bar@jackicus/`. The only writes to GitHub mark notifications read, on a
  click. Items open github.com in the default browser. No telemetry.
- **Schemas.** `org.gnome.shell.extensions.github-bar` at
  `/org/gnome/shell/extensions/github-bar/`, one XML file; `glib-compile-schemas --strict`
  passes.
- **Legal.** GPL-2.0-or-later, `LICENSE` in the zip, no code from other extensions. The two
  icons are drawn for this extension (a pull request and an open issue, as plain symbolic
  glyphs); none of GitHub's logos ships. The README's "Credits and trademarks" says GitHub is
  GitHub, Inc.'s trademark and the extension is not affiliated with or endorsed by it.
- **Icons.** `St.Icon` in the shell, no emoji; the preferences use none. The contribution
  graph is an `St.DrawingArea` in the accent colour.
- **Private API.** `_delegate` on the menu's scroll view, as `PopupSubMenu` sets it; listed
  in `CLAUDE.md` with what breaks if it moves.

## For the upload notes

The name uses "GitHub" only to say what the extension works with, as the README's disclaimer
states; no GitHub logo or artwork ships. The extension never signs in by itself: it reuses the
login the user made with `gh auth login`, read-only.

## Uploading

https://extensions.gnome.org/upload/, signed in as the extension's owner, with the zip from
the GitHub release. extensions.gnome.org assigns `version`; the review can take days and its
comments arrive on the extension's page.
