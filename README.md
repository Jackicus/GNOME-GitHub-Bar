# GitHub Bar

Your GitHub notifications, review requests and pull request CI status in the top bar of
GNOME Shell.

![The open menu under the top bar: the avatar and name of the account "stand-in", 758 contributions and a 9-day streak, then three tabs, Inbox 6, Pulls 3 in red for failed checks and Assigned 2, with Inbox selected: five unread notifications, each tagged with its reason (Review, Mention, Comment, Watching, Team), "1 more…" and Mark All as Read.](docs/screenshots/menu.png)

## What it does

- **A count in the top bar**: unread notifications and review requests, added together,
  or either alone, or none.
- **A compact menu**: your name, then three tabs, one list at a time. It opens on the
  Inbox and refreshes itself, on opening or switching tab, when its figures are over half
  a minute old; a small spinner beside your name says so, and the list stays put.
- **Inbox**: your unread GitHub notifications, each tagged with why it is there (Review,
  Mention, Comment, Watching, CI…); a click opens one and marks it read. It can leave out
  what you only watch.
- **Pulls**: open pull requests that ask for your review, then your own, each with its
  checks (running, passed, failed) and review state. The tab counts what waits on you:
  review requests, and your pull requests with failed checks or changes asked for. The
  count turns red while checks have failed.
- **Assigned**: open issues and pull requests assigned to you.
- **Your contributions**: a click on your name unfolds the last weeks of your calendar, in
  the accent colour, and a link to your profile.
- **Notifications on your desktop** when the checks on one of your pull requests finish,
  and when someone asks for your review.

![The top bar's right end: the pull request glyph and the count 8, beside the system icons.](docs/screenshots/top-bar-cropped.png)

![The same menu with the profile unfolded, the contribution calendar in blue and Open Profile on GitHub under the name, and the Pulls tab selected (its count 3 in red): two review requests and four of your pull requests: one with checks running, one with checks passed and "Approved", one with checks failed and "Needs changes", and one "Draft".](docs/screenshots/menu-profile.png)

![A notification banner: "Checks passed on stand-in/garden#42", with the pull request's title "Water the seedlings on a timer".](docs/screenshots/notification.png)

It follows the light and dark styles:

![The menu in the light style.](docs/screenshots/menu-light.png)

## Requirements

GNOME Shell 50, libsecret's GObject introspection data (installed with GNOME on most
distributions), and the [GitHub CLI](https://cli.github.com/) signed in once:

```bash
gh auth login
```

GitHub Bar uses that login. It never signs anyone in, never stores a token of its own,
and never refreshes one: sign out with `gh auth logout` and it shows that you are signed
out.

## Privacy and network

It talks only to `api.github.com` (and GitHub's avatar server, for your picture), with the
GitHub CLI's token, read fresh from the keyring (or gh's `hosts.yml`) each time and never
kept. It reads your notifications, your open pull requests and issues and your
contribution calendar. The only things it changes are notifications you mark read. It
stores your avatar under `~/.cache/github-bar@jackicus/`. Nothing is sent anywhere else,
and nothing is logged but failures.

It reads up to 100 unread notifications. It asks once every two minutes (you can choose),
every minute while checks run on your pull requests, and never sooner than GitHub's own
poll interval. It skips while the session has been idle for ten minutes. One update costs
a single point of GitHub's GraphQL rate limit, and an unchanged inbox costs none.

## Install

From source:

```bash
git clone https://github.com/Jackicus/GNOME-GitHub-Bar.git
cd GNOME-GitHub-Bar
make install
```

Then log out and back in (on Wayland the shell only finds a new extension at login), and
turn it on:

```bash
gnome-extensions enable github-bar@jackicus
```

To update, `git pull && make install`, then log out and in. To remove it, `make uninstall`.

## Preferences

Open them from the Extensions app, or with `gnome-extensions prefs github-bar@jackicus`.

| | |
|---|---|
| ![The preferences, top: Number Beside the Icon set to Both, then the Menu group with a switch for each tab and the contribution graph, all on, Only What Involves You off, and Items per List at 5.](docs/screenshots/preferences.png) | ![The preferences, bottom: the Notifications group with Checks Finished and Review Requested on, then Updates, which says GitHub Bar uses the GitHub CLI's login, and Seconds Between Updates at 120.](docs/screenshots/preferences-notifications.png) |

- **Number Beside the Icon**: unread notifications, review requests, both added, or none.
- **Menu**: each list on or off, the inbox limited to what involves you (a tab with none on is hidden), the contribution graph,
  and how many items each list shows.
- **Notifications**: when checks finish, when your review is requested.
- **Seconds Between Updates**: 60 to 3600.

## Troubleshooting

"Sign in with gh auth login" while you are signed in: GitHub Bar looks for gh's login in
the keyring (the default) or in `~/.config/gh/hosts.yml`. A locked keyring reads as signed
out until it is unlocked.

The extension's messages are in the shell's journal, and the preferences' in their own
process's:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i 'github bar'
journalctl -f -o cat SYSLOG_IDENTIFIER=org.gnome.Shell.Extensions
```

From a clone, `make status` says whether it is installed and running, and `make logs`
follows its lines. Include them in a bug report.

## Development

`make link` installs it as a link to `src/`, `make reload` loads your edits, `make check`
is what CI runs, and `make shots` retakes the screenshots. See
[CONTRIBUTING.md](CONTRIBUTING.md), and [CLAUDE.md](CLAUDE.md) for the design.

## Licence

GPL-2.0-or-later. See [LICENSE](LICENSE).

## Credits and trademarks

GitHub is a trademark of GitHub, Inc.; this extension is not affiliated with or endorsed by
it, and uses none of its logos. The account, repositories, pull requests and figures in the
screenshots are invented: they come from a stand-in account in a nested shell
(`./scripts/nested.sh shots`), not from anyone's GitHub.
