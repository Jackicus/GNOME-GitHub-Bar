import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {hostsFile} from './auth.js';
import {GitHubClient, Status} from './github.js';
import {Http} from './http.js';
import {GitHubBarIndicator} from './indicator.js';
import * as Log from './log.js';

const IDLE_SKIP_MS = 10 * 60 * 1000;
// While checks run on one of your pull requests, so their notification comes soon after.
const PENDING_POLL_SECONDS = 60;
// Opening the menu re-reads only figures older than this.
const STALE_SECONDS = 60;

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

export class GitHubBarApp {
    constructor(extension) {
        this._extension = extension;
    }

    enable() {
        this._settings = this._extension.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._http = new Http(`${this._extension.uuid} (${this._extension.metadata.url})`);
        this._client = new GitHubClient(this._http);
        this._dashboard = null;
        this._avatar = null;
        this._known = null;
        this._source = null;
        this._fetching = false;
        this._again = false;
        this._timerId = 0;
        this._debounceId = 0;

        this._indicator = new GitHubBarIndicator(this._extension);
        this._indicator.connectObject(
            'open-url', (_indicator, url) => this._open(url),
            'mark-read', (_indicator, id) => this._markRead(id),
            'mark-all-read', () => this._markAllRead(),
            'refresh', () => this._refresh(),
            'open-preferences', () => this._extension.openPreferences(),
            this);
        this._indicator.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open && this._isStale())
                this._refresh();
        }, this);
        Main.panel.addToStatusArea(this._extension.uuid, this._indicator);

        this._settings.connectObject('changed', (_settings, key) => {
            if (key === 'poll-seconds')
                this._schedule();
            else
                this._redraw();
        }, this);

        // gh rewrites it on every sign in and out.
        this._monitor = hostsFile().monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connectObject('changed', () => this._refreshSoon(), this);

        this._redraw();
        this._refresh();
    }

    disable() {
        this._cancellable.cancel();
        this._cancellable = null;
        this._monitor.disconnectObject(this);
        this._monitor.cancel();
        this._monitor = null;
        if (this._timerId)
            GLib.Source.remove(this._timerId);
        this._timerId = 0;
        if (this._debounceId)
            GLib.Source.remove(this._debounceId);
        this._debounceId = 0;
        this._settings.disconnectObject(this);
        this._settings = null;
        this._indicator.destroy();
        this._indicator = null;
        this._source?.destroy();
        this._source = null;
        this._client = null;
        this._http.destroy();
        this._http = null;
        this._dashboard = null;
        this._known = null;
    }

    // A refresh asked for during a fetch (a sign-out, a notification marked read) runs
    // after it, since the fetch in flight may predate the change.
    async _refresh() {
        if (this._fetching) {
            this._again = true;
            return;
        }
        this._fetching = true;
        this._again = false;
        this._indicator.setBusy(true);

        const cancellable = this._cancellable;
        try {
            this._dashboard = await this._fetch(cancellable);
        } catch (e) {
            if (!cancellable.is_cancelled()) {
                Log.error('Could not update', e);
                this._dashboard = {status: Status.ERROR, message: e.message};
            }
        }
        if (cancellable.is_cancelled())
            return;

        this._fetching = false;
        this._indicator.setBusy(false);
        this._redraw();
        if (this._again)
            this._refresh();
        else
            this._schedule();
    }

    async _fetch(cancellable) {
        const dashboard = await this._client.fetch(cancellable);
        if (dashboard.status === Status.OK) {
            if (this._known?.login !== dashboard.user.login)
                this._avatar = null;
            this._notifyChanges(dashboard);
            this._avatar ??= await this._fetchAvatar(dashboard.user.avatarUrl, cancellable);
        }
        return dashboard;
    }

    // A burst of file changes (gh writes hosts.yml in steps) is one refresh.
    _refreshSoon() {
        if (this._debounceId)
            GLib.Source.remove(this._debounceId);
        this._debounceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._debounceId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _schedule() {
        if (this._timerId)
            GLib.Source.remove(this._timerId);
        const pending = this._dashboard?.status === Status.OK &&
            this._dashboard.pulls.items.some(pull => pull.checks === 'pending');
        const seconds = Math.max(this._dashboard?.pollInterval ?? 0,
            pending ? PENDING_POLL_SECONDS : this._settings.get_uint('poll-seconds'));
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timerId = 0;
            if (global.backend.get_core_idle_monitor().get_idletime() <= IDLE_SKIP_MS)
                this._refresh();
            else
                this._schedule();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isStale() {
        const updated = this._dashboard?.updated;
        return !updated || GLib.DateTime.new_now_utc().difference(updated) > STALE_SECONDS * GLib.TIME_SPAN_SECOND;
    }

    _redraw() {
        this._indicator.update(this._dashboard, {
            count: this._settings.get_string('count'),
            showReviews: this._settings.get_boolean('show-reviews'),
            showPulls: this._settings.get_boolean('show-pulls'),
            showAssigned: this._settings.get_boolean('show-assigned'),
            showNotifications: this._settings.get_boolean('show-notifications'),
            showGraph: this._settings.get_boolean('show-graph'),
            maxItems: this._settings.get_int('max-items'),
            avatar: this._avatar,
        });
    }

    // Fetched once per enable and named for its content: GitHub keeps an avatar's address
    // when the picture changes, and the texture cache keeps a file's first picture.
    async _fetchAvatar(url, cancellable) {
        try {
            const bytes = await this._client.avatar(url, cancellable);
            const name = `avatar-${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes)}`;
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([GLib.get_user_cache_dir(), this._extension.uuid, name]));
            GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
            await file.replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
            return file;
        } catch (e) {
            if (!cancellable.is_cancelled())
                Log.warn(`Could not fetch the avatar: ${e.message}`);
            return null;
        }
    }

    // The first fetch after enable, or after a change of account, only learns what is there.
    _notifyChanges(dashboard) {
        const reviews = dashboard.reviews.items;
        const pulls = dashboard.pulls.items;
        if (this._known?.login === dashboard.user.login) {
            if (this._settings.get_boolean('notify-reviews')) {
                for (const item of reviews.filter(review => !this._known.reviews.has(review.url)))
                    this._notify(`Review requested on ${item.repo}#${item.number}`, item.title, item.url);
            }
            if (this._settings.get_boolean('notify-checks')) {
                for (const pull of pulls) {
                    const before = this._known.checks.get(pull.url);
                    if (before?.oid !== pull.headOid || before.checks !== 'pending')
                        continue;
                    if (pull.checks === 'success')
                        this._notify(`Checks passed on ${pull.repo}#${pull.number}`, pull.title, pull.url);
                    else if (pull.checks === 'failure')
                        this._notify(`Checks failed on ${pull.repo}#${pull.number}`, pull.title, pull.url);
                }
            }
        }
        this._known = {
            login: dashboard.user.login,
            reviews: new Set(reviews.map(review => review.url)),
            checks: new Map(pulls.map(pull => [pull.url, {oid: pull.headOid, checks: pull.checks}])),
        };
    }

    _notify(title, body, url) {
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: this._extension.metadata.name,
                icon: new Gio.FileIcon({
                    file: Gio.File.new_for_path(`${this._extension.path}/icons/github-bar-symbolic.svg`),
                }),
            });
            this._source.connect('destroy', () => (this._source = null));
            Main.messageTray.add(this._source);
        }
        const notification = new MessageTray.Notification({source: this._source, title, body});
        notification.connect('activated', () => this._open(url));
        this._source.addNotification(notification);
    }

    _open(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch (e) {
            Log.error(`Could not open ${url}`, e);
        }
    }

    async _markRead(id) {
        await this._write(() => this._client.markRead(id, this._cancellable));
    }

    async _markAllRead() {
        await this._write(() => this._client.markAllRead(this._cancellable));
    }

    async _write(request) {
        const cancellable = this._cancellable;
        try {
            await request();
        } catch (e) {
            if (cancellable.is_cancelled())
                return;
            Log.error('Could not mark notifications read', e);
        }
        this._refresh();
    }
}
