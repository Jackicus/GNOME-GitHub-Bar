# GitHub Bar

Shared rules for every extension come from the GNOME-EXTENSIONS kit: `../CLAUDE.md` and `../.claude/rules/` (loaded with this file), and the `gnome-ext:*` skills. `.claude/kit.sh` pulls the kit at session start, or, with no kit beside this repository, fetches it and prints its rules into the session.

A GNOME Shell extension (UUID `github-bar@jackicus`, `version-name` 0.1, shell 50): a
top-bar button counting what waits for you on GitHub, whose menu lists your review
requests, your open pull requests with their checks and review state, what is assigned to
you, unread notifications and your contribution graph. It notifies when checks on your pull
requests finish and when your review is requested.

## The rule the design hangs off

**It never signs anyone in.** It reads the GitHub CLI's login (`auth.js`): gh's
`hosts.yml` (`$GH_CONFIG_DIR`, else the user config dir's `gh/`), its `oauth_token` when
gh stored it there, else the secret service item `{service: 'gh:github.com', username}`
(the user's, then `''`, gh's active-account item), searched without unlocking: a locked
keyring reads as signed out instead of prompting on every poll. With no `hosts.yml` it
never asks the keyring. The token is read fresh on every fetch and never kept (only its
hash, to notice a change of account) or logged. The only writes to GitHub are marking
notifications read.

## Layout

```
src/extension.js        entry point: imports lib/app.js
src/prefs.js            preferences (own process: Gtk and Adw only, imports nothing of ours)
src/stylesheet.css      the menu; the two state colours are the only hues
src/icons/              our own symbolic glyphs (pull request, issue); not GitHub's marks
src/schemas/            org.gnome.shell.extensions.github-bar
src/lib/app.js          GitHubBarApp: polling, notifications, the avatar cache, wiring
src/lib/indicator.js    GitHubBarIndicator: the button, its count and menu; draws the
                        Dashboard it is handed, emits signals for what was clicked
src/lib/graph.js        GitHubBarGraph: the contribution calendar, an St.DrawingArea
src/lib/github.js       GitHubClient: one GraphQL query and /notifications into a
                        Dashboard; pure parsers. No shell imports, so scripts/ load it
src/lib/auth.js         readToken(), hostsFile(): gh's login
src/lib/http.js         one libsoup session; the stand-in replaces this file
src/lib/log.js          warn / error behind the "[GitHub Bar]" prefix
tests/fixtures/         invented GraphQL and notifications responses
docs/publishing.md      the zip, and how it meets the extensions.gnome.org review
```

## How it behaves

* **One fetch** is a GraphQL query (viewer, contribution calendar, three searches: review
  requested, authored, assigned; cost 1 point) and `GET /notifications?per_page=100` (so
  at most 100 are counted) with `If-Modified-Since`, whose 304 costs nothing and reuses
  the cached inbox. Marking read drops the thread from that cache, since GitHub may still
  answer 304. A token change forgets `Last-Modified`. A refresh asked for during a fetch
  runs after it.
* **When**: `poll-seconds` (120), or 60 s while any of your pull requests has checks
  pending, never under GitHub's `X-Poll-Interval`; skipped while the session has been idle
  10 minutes; on opening the menu when the data is over a minute old; 2 s after gh
  rewrites `hosts.yml` (sign in, sign out). The timer is one-shot, re-armed after each
  fetch.
* **Notifications**: the first good fetch after enable only learns what is there. Checks
  notify on pending → success/failure for the same head commit; a review request notifies
  once per pull request seen. A change of account relearns without notifying. A screen
  lock disables, so an unlock forgets and relearns.
* **The menu** is rebuilt on each update. Its sections sit in an `St.ScrollView` that
  replaces the `PopupMenuSection`'s actor, as the shell's `PopupSubMenu` does (with the
  `_delegate` set, or the menu never sees the section and leaks it on disable), so a long
  menu scrolls above a fixed footer; keyboard focus scrolls itself into view. A failed
  fetch keeps the last good sections under its message; signed out clears them. Refresh
  does not emit `activate`, so the menu stays open.
* **Item clicks open github.com in the browser**, a real launch from the nested shell too.
* **The avatar** is fetched once per enable and cached as
  `~/.cache/github-bar@jackicus/avatar-<sha256 of the picture>`: GitHub keeps an avatar's
  URL when the picture changes, and the texture cache keeps a file's first picture.

## Settings

`count` (`both`, `notifications`, `reviews`, `none`), `show-reviews`, `show-pulls`,
`show-assigned`, `show-notifications`, `show-graph`, `max-items` (5), `notify-checks`,
`notify-reviews`, `poll-seconds` (120, 60–3600).

## Private shell API

`actor._delegate` (`indicator.js`): the scroll view that replaces the section's actor
carries the section as its `_delegate`, as `PopupSubMenu` does in `popupMenu.js`, because
`PopupMenuBase._getMenuItems()` finds items through it. If that lookup moves, the menu stops
seeing the section: its items lose keyboard navigation and `menu.destroy()` stops destroying
it (a leak per disable).

## Verifying

* `make check`: ESLint, the schema, then `EXT_CHECKS`: `imports` (prefs.js's graph reaches
  no shell module) and `parsers` (the parsers over `tests/fixtures/`, garbage shapes, the
  client over a fake connection, `readToken` over a throwaway gh config). CI installs
  `libsecret` (`.github/ci-packages`). It ends with `size`.
* `./scripts/dev.sh live` fetches with the real gh login and prints counts and states
  only. It reads the real keyring and goes to the network: ask first.
* The nested shell: `start --stand-in` (`./scripts/nested.d/stand-in.sh`) writes a gh
  login for the account `stand-in` into the stand-in `XDG_CONFIG_HOME` (beside its HOME,
  not under it) and stages `./scripts/stand-in-http.js` over `lib/http.js`. The nested
  session has no keyring, so a plain `start` shows "signed out". `./scripts/nested.sh
  state STATE` puts the stand-in account in `ok`, `empty`, `unauthorized`, `offline`,
  `error`, `checks-pending`, `checks-passed`, `checks-failed`, `signed-out` or
  `signed-in`, and the app re-reads on the `hosts.yml` rewrite. Driving it: the
  `drive-extension` skill.
* `./scripts/nested.sh shots [--light] [--out DIR]` (`make shots`,
  `./scripts/nested.d/shots.sh`) takes the published set into `docs/screenshots/` over
  `start --stand-in --headless` and stops: the top bar, the menu at its top and scrolled
  down, the checks-passed banner and the preferences at both ends (`--light`: the top bar
  and the menu, `*-light.png`). It refuses while a nested shell runs, and ends by stripping
  the PNGs' text chunks with `oxipng` (it warns when that is missing: never commit them
  unstripped).