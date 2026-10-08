// Staged over lib/http.js under `start --stand-in`: answers GitHub's GraphQL and notification
// requests with an invented account, dated relative to now, and sends nothing. The state
// './scripts/nested.sh state' writes to $HOME/stand-in-state.json picks the answer, and
// threads marked read are remembered there. Nothing here ships.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const STATE_FILE = GLib.build_filenamev([GLib.get_home_dir(), 'stand-in-state.json']);
const STARTED = GLib.DateTime.new_now_utc().format_iso8601();

const FAILURES = {
    unauthorized: [401, 'HTTP 401 Unauthorized'],
    offline: [0, 'Could not connect to api.github.com'],
    error: [502, 'HTTP 502 Bad Gateway'],
};

const CHECKS = {
    'checks-pending': 'PENDING',
    'checks-passed': 'SUCCESS',
    'checks-failed': 'FAILURE',
};

function readState() {
    try {
        const [, bytes] = GLib.file_get_contents(STATE_FILE);
        return {state: 'ok', read: [], ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch {
        return {state: 'ok', read: []};
    }
}

function writeState(state) {
    GLib.file_set_contents(STATE_FILE, JSON.stringify(state));
}

// Last-Modified is the state file's change time, so a mark-read or a new state ends a run of 304s.
function lastModified() {
    try {
        const info = Gio.File.new_for_path(STATE_FILE).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_modification_date_time().format_iso8601();
    } catch {
        return STARTED;
    }
}

function ago(minutes) {
    return GLib.DateTime.new_now_utc().add_minutes(-minutes).format_iso8601();
}

// The same invented count for a date on every poll: a busy weekday, a quiet weekend.
function countFor(date, weekday) {
    let hash = 0;
    for (const c of date)
        hash = (hash * 31 + c.charCodeAt(0)) % 1000;
    if (weekday > 5)
        return hash % 5 === 0 ? hash % 3 : 0;
    return hash % 4 === 0 ? 0 : hash % 9;
}

// From the Sunday a year back to today, a week per column, as GitHub draws it; the last
// nine days all have contributions, the day before them none.
function calendar(empty) {
    const today = GLib.DateTime.new_now_local();
    let day = today.add_days(-364);
    day = day.add_days(-(day.get_day_of_week() % 7));
    const weeks = [];
    let total = 0;
    while (day.compare(today) <= 0) {
        if (day.get_day_of_week() === 7)
            weeks.push({contributionDays: []});
        const date = day.format('%Y-%m-%d');
        const back = Math.round(today.difference(day) / GLib.TIME_SPAN_DAY);
        let count = countFor(date, day.get_day_of_week());
        if (back < 9)
            count = Math.max(count, 1 + back % 4);
        else if (back === 9)
            count = 0;
        if (empty)
            count = 0;
        total += count;
        weeks.at(-1).contributionDays.push({date, contributionCount: count});
        day = day.add_days(1);
    }
    return {totalContributions: total, weeks};
}

function pull(repo, number, title, minutes, extra = {}) {
    return {
        __typename: 'PullRequest', number, title, url: `https://github.com/${repo}/pull/${number}`,
        updatedAt: ago(minutes), isDraft: false, repository: {nameWithOwner: repo}, ...extra,
    };
}

function issue(repo, number, title, minutes) {
    return {
        __typename: 'Issue', number, title, url: `https://github.com/${repo}/issues/${number}`,
        updatedAt: ago(minutes), repository: {nameWithOwner: repo},
    };
}

function head(oid, state) {
    return {commits: {nodes: [{commit: {oid, statusCheckRollup: state ? {state} : null}}]}};
}

function search(nodes) {
    return {issueCount: nodes.length, nodes};
}

function dashboard(state) {
    const empty = state === 'empty';
    const contributions = calendar(empty);
    const viewer = {
        login: 'stand-in',
        name: 'Stand-in',
        avatarUrl: 'https://avatars.githubusercontent.com/u/0?s=64&v=4',
        contributionsCollection: {contributionCalendar: contributions},
    };
    if (empty) {
        return {data: {viewer, reviews: search([]), pulls: search([]), assigned: search([])}};
    }

    return {
        data: {
            viewer,
            reviews: search([
                pull('stand-in/lantern', 17, 'Batch the redraws in the timeline', 25,
                    {author: {login: 'marigold-dev'}}),
                pull('fernworks/trellis', 112, 'Retry uploads after a dropped connection', 190,
                    {author: {login: 'tern'}}),
            ]),
            pulls: search([
                pull('stand-in/garden', 42, 'Water the seedlings on a timer', 8, {
                    reviewDecision: 'REVIEW_REQUIRED',
                    ...head('4b1d0c6e2f9a7d3b8e5c1a0f6d2b9e7c3a8f5d14', CHECKS[state] ?? 'PENDING'),
                }),
                pull('stand-in/lantern', 23, 'Dim the wick when the battery is low', 95, {
                    reviewDecision: 'APPROVED',
                    ...head('9e3a7c1f5b2d8e6a0c4f7b1d3e9a5c2f8b6d0e13', 'SUCCESS'),
                }),
                pull('stand-in/garden', 39, 'Sort the beds by hours of sunlight', 300, {
                    reviewDecision: 'CHANGES_REQUESTED',
                    ...head('2c8f6a0e4d1b7c9f3a5e8d2b6c0f4a7e1d9b3c58', 'FAILURE'),
                }),
                pull('stand-in/kettle', 7, 'Whistle at a lower pitch', 2880, {
                    isDraft: true,
                    reviewDecision: null,
                    ...head('7f0b4e8c2a6d1f9b5e3c7a0d4f8b2e6c9a1d5f30', null),
                }),
            ]),
            assigned: search([
                issue('stand-in/garden', 58, 'Frost warning arrives a day late', 60),
                pull('fernworks/trellis', 64, 'Move the settings page to the new layout', 1500),
            ]),
        },
    };
}

function thread(id, repo, type, path, title, reason, minutes) {
    return {
        id, unread: true, reason, updated_at: ago(minutes), last_read_at: null,
        subject: {
            title, type, latest_comment_url: null,
            url: path === null ? null : `https://api.github.com/repos/${repo}/${path}`,
        },
        repository: {full_name: repo, html_url: `https://github.com/${repo}`},
        url: `https://api.github.com/notifications/threads/${id}`,
    };
}

function threads(read) {
    return [
        thread('9001', 'stand-in/lantern', 'PullRequest', 'pulls/17', 'Batch the redraws in the timeline',
            'review_requested', 25),
        thread('9002', 'stand-in/garden', 'Issue', 'issues/58', 'Frost warning arrives a day late',
            'mention', 60),
        thread('9003', 'stand-in/garden', 'PullRequest', 'pulls/42', 'Water the seedlings on a timer',
            'comment', 70),
        thread('9004', 'stand-in/lantern', 'Release', 'releases/310', 'v2.4.0', 'subscribed', 240),
        thread('9005', 'fernworks/trellis', 'Discussion', null, 'Plans for the next release',
            'team_mention', 600),
        thread('9006', 'stand-in/garden', 'CheckSuite', null, 'CI workflow run failed for main branch',
            'ci_activity', 1440),
    ].filter(t => !read.includes(t.id));
}

function answer(method, url, ifModifiedSince) {
    const state = readState();
    if (FAILURES[state.state])
        throw new HttpError(...FAILURES[state.state]);

    const headers = {'last-modified': lastModified(), 'x-poll-interval': '60'};
    const path = url.replace('https://api.github.com', '');
    const markRead = path.match(/^\/notifications\/threads\/(\d+)$/);

    if (method === 'POST' && path === '/graphql')
        return {status: 200, body: dashboard(state.state), headers};

    if (method === 'GET' && path.startsWith('/notifications')) {
        if (ifModifiedSince === headers['last-modified'])
            return {status: 304, body: null, headers};
        return {status: 200, body: state.state === 'empty' ? [] : threads(state.read), headers};
    }

    if (method === 'PATCH' && markRead) {
        writeState({...state, read: [...new Set([...state.read, markRead[1]])]});
        return {status: 205, body: null, headers: {}};
    }

    if (method === 'PUT' && path === '/notifications') {
        writeState({...state, read: [...new Set([...state.read, ...threads([]).map(t => t.id)])]});
        return {status: 202, body: null, headers: {}};
    }

    throw new HttpError(404, `No stand-in answer for ${method} ${url}`);
}

export class Http {
    request(method, url, {ifModifiedSince = null} = {}) {
        try {
            return Promise.resolve(answer(method, url, ifModifiedSince));
        } catch (e) {
            return Promise.reject(e);
        }
    }

    // The avatar nested.sh's stand-in hook puts in the scratch home, an SVG.
    getBytes() {
        try {
            const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([GLib.get_home_dir(), 'stand-in-avatar.svg']));
            return Promise.resolve(new GLib.Bytes(bytes));
        } catch (e) {
            return Promise.reject(new HttpError(404, e.message));
        }
    }

    destroy() {
    }
}
