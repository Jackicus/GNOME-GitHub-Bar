import GLib from 'gi://GLib';

import {readToken} from './auth.js';

const API = 'https://api.github.com';

// One request for everything but the notifications, which GraphQL does not expose.
const QUERY = `query {
  viewer { login name avatarUrl(size: 64)
    contributionsCollection { contributionCalendar { totalContributions
      weeks { contributionDays { date contributionCount } } } } }
  reviews: search(type: ISSUE, query: "is:open is:pr review-requested:@me archived:false", first: 20) {
    issueCount nodes { ... on PullRequest { number title url updatedAt isDraft
      repository { nameWithOwner } author { login } } } }
  pulls: search(type: ISSUE, query: "is:open is:pr author:@me archived:false", first: 20) {
    issueCount nodes { ... on PullRequest { number title url updatedAt isDraft reviewDecision
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } } } }
  assigned: search(type: ISSUE, query: "is:open assignee:@me archived:false", first: 20) {
    issueCount nodes { __typename
      ... on Issue { number title url updatedAt repository { nameWithOwner } }
      ... on PullRequest { number title url updatedAt repository { nameWithOwner } } } }
}`;

export const Status = {
    OK: 'ok',
    SIGNED_OUT: 'signed-out',
    UNAUTHORIZED: 'unauthorized',
    OFFLINE: 'offline',
    ERROR: 'error',
};

const CHECKS = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    ERROR: 'failure',
    PENDING: 'pending',
    EXPECTED: 'pending',
};

const REVIEWS = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes',
    REVIEW_REQUIRED: 'required',
};

const KINDS = {PullRequest: 'pull', Issue: 'issue'};

const PATHS = {pulls: 'pull', issues: 'issues', commits: 'commit'};

function parseItem(node) {
    const commit = node.commits?.nodes[0]?.commit;
    return {
        kind: node.__typename === 'Issue' ? 'issue' : 'pull',
        repo: node.repository.nameWithOwner,
        number: node.number,
        title: node.title,
        url: node.url,
        updated: node.updatedAt,
        draft: node.isDraft === true,
        author: node.author?.login ?? null,
        checks: CHECKS[commit?.statusCheckRollup?.state] ?? null,
        review: REVIEWS[node.reviewDecision] ?? null,
        headOid: commit?.oid ?? null,
    };
}

// A search node outside the fragment's type comes back as {}.
function parseSearch(search) {
    const items = search.nodes.filter(node => node.number).map(parseItem);
    return {total: search.issueCount, items};
}

export function parseDashboard({data}) {
    const viewer = data.viewer;
    const calendar = viewer.contributionsCollection.contributionCalendar;
    const days = calendar.weeks
        .flatMap(week => week.contributionDays)
        .map(day => ({date: day.date, count: day.contributionCount}));

    return {
        user: {login: viewer.login, name: viewer.name, avatarUrl: viewer.avatarUrl},
        calendar: {total: calendar.totalContributions, days},
        streak: streak(days),
        reviews: parseSearch(data.reviews),
        pulls: parseSearch(data.pulls),
        assigned: parseSearch(data.assigned),
    };
}

// The subject's API URL, turned into the page a browser opens.
function htmlUrl(subject, repo) {
    const home = `https://github.com/${repo}`;
    const match = subject.url?.match(/\/repos\/[^/]+\/[^/]+\/(pulls|issues|commits)\/([^/]+)$/);
    if (match)
        return `${home}/${PATHS[match[1]]}/${match[2]}`;
    if (subject.type === 'Release')
        return `${home}/releases`;
    if (subject.type === 'Discussion')
        return `${home}/discussions`;
    return home;
}

export function parseNotifications(body) {
    const items = body.map(thread => {
        const repo = thread.repository.full_name;
        return {
            id: thread.id,
            repo,
            title: thread.subject.title,
            kind: KINDS[thread.subject.type] ?? 'other',
            reason: thread.reason,
            updated: thread.updated_at,
            url: htmlUrl(thread.subject, repo),
        };
    });
    return {total: items.length, items};
}

// The calendar ends today, which does not break a streak until it is over.
export function streak(days) {
    let i = days.length - 1;
    if (i >= 0 && days[i].count === 0)
        i--;
    let count = 0;
    for (; i >= 0 && days[i].count > 0; i--)
        count++;
    return count;
}

function failure(e) {
    if (e.status === 401)
        return {status: Status.UNAUTHORIZED, message: 'GitHub refused the login. Run gh auth login again.'};
    if (e.status === 0)
        return {status: Status.OFFLINE, message: e.message};
    return {status: Status.ERROR, message: e.message};
}

export class GitHubClient {
    constructor(http) {
        this._http = http;
        this._account = null;
        this._lastModified = null;
        this._notifications = {total: 0, items: []};
    }

    async fetch(cancellable) {
        const token = await readToken(cancellable);
        if (!token)
            return {status: Status.SIGNED_OUT, message: 'Sign in with gh auth login'};

        // Another account's Last-Modified would answer a 304 with the wrong inbox.
        // A hash tells accounts apart without keeping the token.
        const account = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, token, -1);
        if (account !== this._account) {
            this._account = account;
            this._lastModified = null;
        }

        let graphql, notifications;
        try {
            [graphql, notifications] = await Promise.all([
                this._http.request('POST', `${API}/graphql`, {token, body: {query: QUERY}}, cancellable),
                this._http.request('GET', `${API}/notifications?per_page=100`,
                    {token, ifModifiedSince: this._lastModified}, cancellable),
            ]);
        } catch (e) {
            if (e instanceof GLib.Error)
                throw e;
            return failure(e);
        }

        if (!graphql.body?.data?.viewer)
            return {status: Status.ERROR, message: graphql.body?.errors?.[0]?.message ?? 'GitHub sent no data.'};

        if (notifications.status === 200) {
            this._notifications = parseNotifications(notifications.body);
            this._lastModified = notifications.headers['last-modified'];
        }

        return {
            status: Status.OK,
            updated: GLib.DateTime.new_now_local(),
            pollInterval: parseInt(notifications.headers['x-poll-interval']) || 60,
            ...parseDashboard(graphql.body),
            notifications: this._notifications,
        };
    }

    async markRead(threadId, cancellable) {
        await this._write('PATCH', `/notifications/threads/${threadId}`, null, cancellable);
        const items = this._notifications.items.filter(item => item.id !== threadId);
        this._notifications = {total: items.length, items};
    }

    async markAllRead(cancellable) {
        await this._write('PUT', '/notifications', {last_read_at: new Date().toISOString()}, cancellable);
        this._notifications = {total: 0, items: []};
    }

    avatar(url, cancellable) {
        return this._http.getBytes(url, cancellable);
    }

    async _write(method, path, body, cancellable) {
        const token = await readToken(cancellable);
        if (!token)
            throw new Error('Not signed in to the GitHub CLI');
        await this._http.request(method, `${API}${path}`, {token, body}, cancellable);
    }
}
