import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Status} from './github.js';
import {GitHubBarGraph} from './graph.js';

// Secondary text is dimmed with actor opacity, so it suits light and dark menus.
const DIM_OPACITY = 160;

const SECTIONS = [
    {key: 'reviews', option: 'showReviews', title: 'Review Requests', url: 'https://github.com/pulls/review-requested'},
    {key: 'pulls', option: 'showPulls', title: 'Your Pull Requests', url: 'https://github.com/pulls'},
    {key: 'assigned', option: 'showAssigned', title: 'Assigned to You', url: 'https://github.com/issues/assigned'},
    {key: 'notifications', option: 'showNotifications', title: 'Notifications', url: 'https://github.com/notifications'},
];

const REVIEW_TAGS = {approved: 'Approved', changes: 'Changes requested'};

function ago(iso) {
    const then = iso && GLib.DateTime.new_from_iso8601(iso, null);
    if (!then)
        return null;
    const minutes = Math.floor(GLib.DateTime.new_now_utc().difference(then) / GLib.TIME_SPAN_MINUTE);
    if (minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${minutes}m ago`;
    if (minutes < 24 * 60)
        return `${Math.floor(minutes / 60)}h ago`;
    if (minutes < 30 * 24 * 60)
        return `${Math.floor(minutes / (24 * 60))}d ago`;
    return then.to_local().format('%-d %b %Y');
}

function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

function dimLabel(text, styleClass = null) {
    const label = new St.Label({text, style_class: styleClass, opacity: DIM_OPACITY, y_align: Clutter.ActorAlign.CENTER});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

function inertItem(styleClass) {
    return new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: styleClass});
}

function captionItem(text) {
    const item = inertItem('github-bar-caption-row');
    const label = new St.Label({text, x_expand: true});
    label.clutter_text.line_wrap = true;
    item.add_child(label);
    return item;
}

function headingItem(text) {
    const item = inertItem('github-bar-heading-row');
    item.add_child(dimLabel(text, 'github-bar-heading'));
    return item;
}

// An icon, the title on one line, and a dimmed line of details with an optional tag.
function linkItem(icon, title, details, tag) {
    const item = new PopupMenu.PopupBaseMenuItem();
    item.add_child(icon);

    const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
    const label = new St.Label({text: title});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    column.add_child(label);

    const line = new St.BoxLayout({style_class: 'github-bar-details'});
    // The tag gives way first: the repository, number and age matter more.
    const detailsLabel = dimLabel(details.filter(Boolean).join(' · '));
    detailsLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    line.add_child(detailsLabel);
    if (tag) {
        const tagLabel = dimLabel(tag);
        tagLabel.x_expand = true;
        tagLabel.x_align = Clutter.ActorAlign.END;
        line.add_child(tagLabel);
    }
    column.add_child(line);

    item.add_child(column);
    item.label_actor = label;
    return item;
}

export const GitHubBarIndicator = GObject.registerClass({
    Signals: {
        'open-url': {param_types: [GObject.TYPE_STRING]},
        'mark-read': {param_types: [GObject.TYPE_STRING]},
        'mark-all-read': {},
        'refresh': {},
        'open-preferences': {},
    },
}, class GitHubBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, extension.metadata.name, false);

        const icon = name => new Gio.FileIcon({
            file: Gio.File.new_for_path(`${extension.path}/icons/${name}.svg`),
        });
        this._icons = {pull: icon('github-bar-symbolic'), issue: icon('github-bar-issue-symbolic')};

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({gicon: this._icons.pull, style_class: 'system-status-icon'}));
        this._count = new St.Label({style_class: 'github-bar-count', y_align: Clutter.ActorAlign.CENTER, visible: false});
        box.add_child(this._count);
        this.add_child(box);

        this.menu.box.add_style_class_name('github-bar-menu');
        // Scrolls as the shell's submenus do: a menu taller than the screen is cut off.
        this._content = new PopupMenu.PopupMenuSection();
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            child: this._content.box,
        });
        this._content.actor = this._scroll;
        this._scroll._delegate = this._content;
        this.menu.addMenuItem(this._content);
        // Keyboard focus moved below the fold scrolls to it.
        this._content.box.connect('child-added', (_box, item) =>
            item.connect('key-focus-in', () => ensureActorVisibleInScrollView(this._scroll, item)));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        // Not emitting activate keeps the menu open, so the refresh is seen.
        this._refreshItem.activate = () => this.emit('refresh');
        this.menu.addMenuItem(this._refreshItem);
        this.menu.addAction('Open GitHub', () => this.emit('open-url', 'https://github.com'));
        this.menu.addAction('Settings', () => this.emit('open-preferences'));

        this._shown = null;
    }

    update(dashboard, options) {
        if (dashboard?.status === Status.OK)
            this._shown = dashboard;
        else if (dashboard?.status === Status.SIGNED_OUT)
            this._shown = null;

        this._updateCount(options.count);
        this._content.removeAll();

        if (!dashboard)
            this._content.addMenuItem(captionItem('Loading…'));
        else if (dashboard.status === Status.SIGNED_OUT)
            this._content.addMenuItem(captionItem('Sign in with gh auth login in a terminal.'));
        else if (dashboard.status !== Status.OK)
            this._content.addMenuItem(captionItem(dashboard.message));

        if (this._shown)
            this._addDashboard(this._shown, options);
    }

    setBusy(busy) {
        this._refreshItem.setSensitive(!busy);
        this._refreshItem.label.text = busy ? 'Refreshing…' : 'Refresh';
    }

    _updateCount(count) {
        let total = 0;
        if (this._shown && (count === 'notifications' || count === 'both'))
            total += this._shown.notifications.total;
        if (this._shown && (count === 'reviews' || count === 'both'))
            total += this._shown.reviews.total;
        this._count.text = String(total);
        this._count.visible = total > 0;
    }

    _addDashboard(dashboard, options) {
        this._content.addMenuItem(this._userItem(dashboard, options.avatar));

        if (options.showGraph && dashboard.calendar.days.length) {
            const graph = new GitHubBarGraph();
            graph.setDays(dashboard.calendar.days);
            const item = inertItem(null);
            item.add_child(graph);
            this._content.addMenuItem(item);
        }

        for (const section of SECTIONS) {
            const {total, items} = dashboard[section.key];
            if (!options[section.option] || !items.length)
                continue;

            this._content.addMenuItem(headingItem(section.title));
            const shown = items.slice(0, options.maxItems);
            for (const entry of shown) {
                this._content.addMenuItem(section.key === 'notifications'
                    ? this._notificationItem(entry) : this._entryItem(entry));
            }
            if (total > shown.length)
                this._content.addAction(`${total - shown.length} more…`, () => this.emit('open-url', section.url));
            if (section.key === 'notifications')
                this._content.addAction('Mark All as Read', () => this.emit('mark-all-read'));
        }
    }

    _userItem({user, calendar, streak}, avatarFile) {
        const item = inertItem('github-bar-user');

        let avatar;
        if (avatarFile) {
            avatar = new St.Bin({style_class: 'github-bar-avatar'});
            avatar.set_style(`background-image: url("${avatarFile.get_uri()}"); border-radius: 999px;`);
        } else {
            avatar = new St.Icon({icon_name: 'avatar-default-symbolic', style_class: 'github-bar-avatar'});
        }
        item.add_child(avatar);

        const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const names = new St.BoxLayout({style_class: 'github-bar-names'});
        const name = new St.Label({text: user.name || user.login, style_class: 'github-bar-name'});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        names.add_child(name);
        if (user.name)
            names.add_child(dimLabel(user.login));
        column.add_child(names);

        const stats = [plural(calendar.total, 'contribution', 'contributions')];
        if (streak)
            stats.push(`${streak}-day streak`);
        column.add_child(dimLabel(stats.join(' · '), 'github-bar-details'));

        item.add_child(column);
        return item;
    }

    _entryItem(entry) {
        const icon = new St.Icon({gicon: this._icons[entry.kind], style_class: 'popup-menu-icon'});
        if (entry.checks === 'pending')
            icon.opacity = DIM_OPACITY;
        else if (entry.checks)
            icon.add_style_class_name(`github-bar-${entry.checks}`);

        const tag = entry.draft ? 'Draft' : REVIEW_TAGS[entry.review];
        const item = linkItem(icon, entry.title, [`${entry.repo} #${entry.number}`, ago(entry.updated)], tag);
        item.connect('activate', () => this.emit('open-url', entry.url));
        return item;
    }

    _notificationItem(notification) {
        const icon = new St.Icon({style_class: 'popup-menu-icon'});
        if (this._icons[notification.kind])
            icon.gicon = this._icons[notification.kind];
        else
            icon.icon_name = 'mail-unread-symbolic';
        const item = linkItem(icon, notification.title, [notification.repo, ago(notification.updated)]);
        item.connect('activate', () => {
            this.emit('mark-read', notification.id);
            this.emit('open-url', notification.url);
        });
        return item;
    }
});
