// GitHubClient.fetch() with the real gh login, printing what the menu would hold as counts and
// states only: no titles, names or tokens. `./scripts/dev.sh live`; nothing here ships.

import GLib from 'gi://GLib';

import {GitHubClient, Status} from '../src/lib/github.js';
import {Http} from '../src/lib/http.js';

const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

function tally(values) {
    const counts = {};
    for (const value of values)
        counts[value] = (counts[value] ?? 0) + 1;
    return Object.entries(counts).map(([value, n]) => `${value} ${n}`).join(', ') || 'none';
}

function report(dashboard) {
    print(`${BOLD}status${OFF}         ${dashboard.status}`);
    if (dashboard.status !== Status.OK) {
        print(`  ${dashboard.message}`);
        return;
    }
    print(`poll interval  ${dashboard.pollInterval} s`);
    print(`avatar         ${dashboard.user.avatarUrl ? 'yes' : 'none'}`);
    print(`calendar       ${dashboard.calendar.days.length} days, ${dashboard.calendar.total} contributions, ` +
        `${dashboard.streak}-day streak`);
    for (const name of ['reviews', 'pulls', 'assigned', 'notifications']) {
        const {total, items} = dashboard[name];
        print(`${name.padEnd(14)} ${total} (${items.length} listed)`);
    }
    print(`  pull checks  ${tally(dashboard.pulls.items.map(item => item.checks))}`);
    print(`  pull reviews ${tally(dashboard.pulls.items.map(item => item.review))}`);
    print(`  assigned     ${tally(dashboard.assigned.items.map(item => item.kind))}`);
    print(`  inbox        ${tally(dashboard.notifications.items.map(item => item.kind))}`);
}

// gjs has no top-level await, so the work runs inside a main loop the fetch stops.
const loop = new GLib.MainLoop(null, false);
const http = new Http('gnome-shell-extension-github-bar/dev');
let failure = null;

GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    new GitHubClient(http).fetch(null)
        .then(report, e => (failure = e))
        .finally(() => {
            http.destroy();
            loop.quit();
        });
    return GLib.SOURCE_REMOVE;
});

loop.run();
if (failure)
    throw failure;
