// The parsers over saved responses (tests/fixtures/, invented data), and the client over a fake
// Http and a throwaway gh login. Nothing goes to the network or the keyring.
// `./scripts/dev.sh parsers`; nothing here ships.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {readToken} from '../src/lib/auth.js';
import {GitHubClient, Status, parseDashboard, parseNotifications, streak} from '../src/lib/github.js';

const RED = '\x1b[1;31m';
const GREEN = '\x1b[1;32m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

let failures = 0;

function check(what, got, want) {
    const ok = String(got) === String(want);
    if (!ok)
        failures++;
    const mark = ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
    const detail = ok ? `${DIM}${got}${OFF}` : `${RED}got ${got}, wanted ${want}${OFF}`;
    print(`  ${mark} ${what.padEnd(42)} ${detail}`);
}

function fixture(name) {
    const dir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    const path = GLib.build_filenamev([dir, '..', 'tests', 'fixtures', name]);
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
}

print('\x1b[1mThe dashboard\x1b[0m — tests/fixtures/graphql.json');
{
    const dashboard = parseDashboard(fixture('graphql.json'));
    const {reviews, pulls, assigned} = dashboard;

    check('login', dashboard.user.login, 'stand-in');
    check('days flattened across weeks', dashboard.calendar.days.length, 19);
    check('oldest first', dashboard.calendar.days[0].date, '2026-09-20');
    check('total contributions', dashboard.calendar.total, 34);
    check('streak skips an empty today', dashboard.streak, 3);
    check('review total is the search count', reviews.total, 7);
    check('a node outside the fragment is dropped', reviews.items.length, 2);
    check('review request author', reviews.items[0].author, 'fern');
    check('a deleted author is null', reviews.items[1].author, null);
    check('draft', reviews.items[1].draft, true);
    check('kind of a search PR', reviews.items[0].kind, 'pull');
    check('checks PENDING', pulls.items[0].checks, 'pending');
    check('checks SUCCESS', pulls.items[1].checks, 'success');
    check('checks ERROR counts as failure', pulls.items[2].checks, 'failure');
    check('no commits, no checks', pulls.items[3].checks, null);
    check('review REVIEW_REQUIRED', pulls.items[0].review, 'required');
    check('review APPROVED', pulls.items[1].review, 'approved');
    check('review CHANGES_REQUESTED', pulls.items[2].review, 'changes');
    check('no review decision', pulls.items[3].review, null);
    check('head commit', pulls.items[0].headOid, 'a1b2c3d');
    check('repo', pulls.items[0].repo, 'stand-in/garden');
    check('assigned issue kind', assigned.items[0].kind, 'issue');
    check('assigned pull kind', assigned.items[1].kind, 'pull');
}

print('\n\x1b[1mNotifications\x1b[0m — tests/fixtures/notifications.json');
{
    const {total, items} = parseNotifications(fixture('notifications.json'));

    check('total', total, 6);
    check('id', items[0].id, '1001');
    check('pull request url', items[0].url, 'https://github.com/stand-in/garden/pull/41');
    check('issue url', items[1].url, 'https://github.com/stand-in/garden/issues/18');
    check('release url', items[2].url, 'https://github.com/stand-in/lantern/releases');
    check('discussion url', items[3].url, 'https://github.com/stand-in/lantern/discussions');
    check('commit url', items[4].url, 'https://github.com/stand-in/kettle/commit/0a1b2c3');
    check('no subject url opens the repository', items[5].url, 'https://github.com/stand-in/kettle');
    check('kinds', items.map(item => item.kind).join(' '), 'pull issue other other other other');
    check('reason', items[0].reason, 'review_requested');
}

print('\n\x1b[1mThe streak\x1b[0m');
{
    const days = counts => counts.map((count, i) => ({date: `2026-10-0${i + 1}`, count}));
    check('no days', streak([]), 0);
    check('nothing at all', streak(days([0, 0, 0])), 0);
    check('today counts', streak(days([0, 1, 2, 3])), 3);
    check('a gap before yesterday ends it', streak(days([2, 0, 1, 0])), 1);
}

print('\n\x1b[1mWhat GitHub leaves out\x1b[0m');
{
    const node = {number: 1, title: 't', url: 'u', updatedAt: null, isDraft: false, repository: {nameWithOwner: 'o/r'}};
    const {reviews, pulls} = parseDashboard({data: {
        viewer: {login: 'stand-in', name: null, avatarUrl: 'a', contributionsCollection:
            {contributionCalendar: {totalContributions: 0, weeks: []}}},
        reviews: {issueCount: 1, nodes: [{}]},
        pulls: {issueCount: 2, nodes: [
            {...node, author: null, reviewDecision: null, commits: {nodes: [{commit: {oid: 'x', statusCheckRollup: null}}]}},
            {...node, commits: {nodes: []}},
        ]},
        assigned: {issueCount: 0, nodes: []},
    }});
    check('a search node out of reach is skipped', reviews.items.length, 0);
    check('no checks', pulls.items[0].checks, null);
    check('no commits', pulls.items[1].headOid, null);
    check('a ghost author', pulls.items[0].author, null);
    const [thread] = parseNotifications([{id: '7', reason: 'subscribed', updated_at: null,
        repository: {full_name: 'o/r'}, subject: {title: 't', type: 'CheckSuite', url: null}}]).items;
    check('a subject without an address opens the repository', thread.url, 'https://github.com/o/r');
}

// gh's hosts.yml, with a per-user block the reader must not take the token from.
const config = GLib.dir_make_tmp('github-bar-gh-XXXXXX');
GLib.setenv('GH_CONFIG_DIR', config, true);
const hosts = Gio.File.new_for_path(GLib.build_filenamev([config, 'hosts.yml']));
hosts.replace_contents(new TextEncoder().encode([
    'ghe.example.invalid:',
    '    user: someone-else',
    '    oauth_token: wrong-host',
    'github.com:',
    '    users:',
    '        stand-in:',
    '            oauth_token: nested',
    '    git_protocol: https',
    '    user: stand-in',
    '    oauth_token: top-level',
    '',
].join('\n')), null, false, Gio.FileCreateFlags.NONE, null);

print('\n\x1b[1mThe gh login\x1b[0m — a throwaway GH_CONFIG_DIR');
{
    check('the github.com section\'s own token', await readToken(null), 'top-level');
}

print('\n\x1b[1mThe client\x1b[0m — over a fake Http');
{
    const graphql = fixture('graphql.json');
    const inbox = fixture('notifications.json');
    const sent = [];
    let answer = null;

    const http = {
        request(method, url, options) {
            sent.push({method, url, ...options});
            if (answer)
                return Promise.reject(answer);
            if (url.endsWith('/graphql'))
                return Promise.resolve({status: 200, body: graphql, headers: {}});
            if (method !== 'GET')
                return Promise.resolve({status: 205, body: null, headers: {}});
            const modified = options.ifModifiedSince !== null;
            return Promise.resolve({
                status: modified ? 304 : 200,
                body: modified ? null : inbox,
                headers: {'last-modified': 'Thu, 08 Oct 2026 09:00:00 GMT', 'x-poll-interval': '90'},
            });
        },
    };
    const client = new GitHubClient(http);

    let dashboard = await client.fetch(null);
    check('status', dashboard.status, Status.OK);
    check('the poll interval is GitHub\'s', dashboard.pollInterval, 90);
    check('notifications', dashboard.notifications.total, 6);
    check('the token is sent', sent[0].token, 'top-level');

    dashboard = await client.fetch(null);
    check('the second asks If-Modified-Since', sent.at(-1).ifModifiedSince, 'Thu, 08 Oct 2026 09:00:00 GMT');
    check('and a 304 keeps the inbox', dashboard.notifications.total, 6);

    await client.markRead('1001', null);
    check('mark read patches the thread', `${sent.at(-1).method} ${sent.at(-1).url}`,
        'PATCH https://api.github.com/notifications/threads/1001');
    check('and drops it from the inbox', (await client.fetch(null)).notifications.total, 5);

    await client.markAllRead(null);
    check('mark all read sends last_read_at', typeof sent.at(-1).body.last_read_at, 'string');
    check('and empties the inbox', (await client.fetch(null)).notifications.total, 0);

    answer = Object.assign(new Error('HTTP 401 Unauthorized'), {status: 401});
    check('401', (await client.fetch(null)).status, Status.UNAUTHORIZED);
    answer = Object.assign(new Error('Could not connect'), {status: 0});
    check('no connection', (await client.fetch(null)).status, Status.OFFLINE);
    answer = null;

    graphql.data = null;
    graphql.errors = [{message: 'Something went wrong'}];
    dashboard = await client.fetch(null);
    check('GraphQL errors without data', dashboard.status, Status.ERROR);
    check('carry the first message', dashboard.message, 'Something went wrong');

    hosts.delete(null);
    check('no hosts.yml is signed out', (await client.fetch(null)).status, Status.SIGNED_OUT);
}

GLib.rmdir(config);

print('');
if (failures) {
    print(`${RED}${failures} parser check(s) failed.${OFF}`);
    throw new Error(`${failures} parser check(s) failed`);
}
print(`${GREEN}All parser checks passed.${OFF}`);
