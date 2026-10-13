import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Status} from './github.js';
import {GitHubBarGraph} from './graph.js';

// Secondary text is dimmed with actor opacity, so it suits light and dark menus.
const DIM_OPACITY = 160;

// Your pull requests that wait on you rather than on others.
function needsYou(pull) {
    return pull.checks === 'failure' || pull.review === 'changes' || pull.conflicts;
}

// Each tab lists one or more groups of the dashboard, and counts what waits on you there.
const TABS = [
    {title: 'Inbox', option: 'showNotifications', empty: 'No unread notifications',
        count: dashboard => dashboard.notifications.total, groups: [
            {key: 'notifications', url: 'https://github.com/notifications'},
        ]},
    {title: 'Pulls', option: 'showPulls', empty: 'No open pull requests',
        count: dashboard => dashboard.reviews.total + dashboard.pulls.items.filter(needsYou).length, groups: [
            {key: 'reviews', title: 'Review Requests', url: 'https://github.com/pulls/review-requested'},
            {key: 'pulls', title: 'Your Pull Requests', url: 'https://github.com/pulls'},
        ]},
    {title: 'Assigned', option: 'showAssigned', empty: 'Nothing assigned to you',
        count: dashboard => dashboard.assigned.total, groups: [
            {key: 'assigned', url: 'https://github.com/issues/assigned'},
        ]},
];

const REVIEW_TAGS = {approved: 'Approved', changes: 'Needs changes'};

// Why a notification is in the inbox, by GitHub's reason.
const REASON_TAGS = {
    approval_requested: 'Approval',
    assign: 'Assigned',
    author: 'Author',
    ci_activity: 'CI',
    comment: 'Comment',
    invitation: 'Invitation',
    manual: 'Subscribed',
    mention: 'Mention',
    review_requested: 'Review',
    security_alert: 'Security',
    state_change: 'State',
    subscribed: 'Watching',
    team_mention: 'Team',
};

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
        'tab-changed': {},
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
        this._status = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._status);
        this._addUserItem();
        this._addTabs();

        // Scrolls as the shell's submenus do: a list taller than the screen is cut off.
        this._list = new PopupMenu.PopupMenuSection();
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            child: this._list.box,
        });
        this._list.actor = this._scroll;
        this._scroll._delegate = this._list;
        this.menu.addMenuItem(this._list);
        // Keyboard focus moved below the fold scrolls to it.
        this._list.box.connect('child-added', (_box, item) =>
            item.connect('key-focus-in', () => ensureActorVisibleInScrollView(this._scroll, item)));

        // Each opening starts folded, on the first tab.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                return;
            this._user.menu.close(false);
            this._select(this._firstTab());
        });

        this._shown = null;
        this._options = null;
        this._tab = 0;
    }

    _addUserItem() {
        this._user = new PopupMenu.PopupSubMenuMenuItem('', false);
        this._user.add_style_class_name('github-bar-user');
        this._user.label.destroy();

        this._avatar = new St.Bin({style_class: 'github-bar-avatar', y_align: Clutter.ActorAlign.CENTER});
        this._user.insert_child_at_index(this._avatar, 0);

        const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const names = new St.BoxLayout({style_class: 'github-bar-names'});
        this._name = new St.Label({style_class: 'github-bar-name'});
        this._name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        names.add_child(this._name);
        this._login = dimLabel('');
        names.add_child(this._login);
        column.add_child(names);
        this._stats = dimLabel('', 'github-bar-details');
        column.add_child(this._stats);
        this._user.insert_child_at_index(column, 1);
        this._user.label_actor = this._name;

        // Before the arrow: a refresh shows here and leaves the rest of the menu as it is.
        this._spinner = new Animation.Spinner(16, {animate: true, hideOnStop: true});
        this._user.insert_child_at_index(this._spinner, this._user.get_n_children() - 1);
        this.menu.addMenuItem(this._user);
    }

    _addTabs() {
        this._tabsItem = inertItem('github-bar-tabs-row');
        const strip = new St.BoxLayout({style_class: 'github-bar-tabs', x_expand: true});
        strip.layout_manager.homogeneous = true;
        this._buttons = TABS.map((tab, index) => {
            const content = new St.BoxLayout({style_class: 'github-bar-tab-content', x_align: Clutter.ActorAlign.CENTER});
            content.add_child(new St.Label({text: tab.title}));
            const count = dimLabel('');
            content.add_child(count);
            const button = new St.Button({
                style_class: 'button flat github-bar-tab',
                child: content,
                can_focus: true,
                x_expand: true,
                accessible_name: tab.title,
            });
            button.count = count;
            button.connect('clicked', () => {
                this._select(index);
                this.emit('tab-changed');
            });
            strip.add_child(button);
            return button;
        });
        this._tabsItem.add_child(strip);
        this.menu.addMenuItem(this._tabsItem);
    }

    update(dashboard, options) {
        if (dashboard?.status === Status.OK)
            this._shown = dashboard;
        else if (dashboard?.status === Status.SIGNED_OUT)
            this._shown = null;
        this._options = options;

        this._updateCount(options.count);
        this._status.removeAll();
        if (!dashboard)
            this._status.addMenuItem(captionItem('Loading…'));
        else if (dashboard.status === Status.SIGNED_OUT)
            this._status.addMenuItem(captionItem('Sign in with gh auth login in a terminal.'));
        else if (dashboard.status !== Status.OK)
            this._status.addMenuItem(captionItem(dashboard.message));

        this._user.visible = this._shown !== null;
        if (this._shown)
            this._updateUser(this._shown, options);

        TABS.forEach((tab, index) => {
            const button = this._buttons[index];
            button.visible = this._tabShown(tab);
            const total = this._shown ? tab.count(this._shown) : 0;
            button.count.text = total ? String(total) : '';
            // Failed checks colour the Pulls count, so they are seen from any tab.
            const failed = this._shown !== null &&
                tab.groups.some(group => this._shown[group.key].items.some(item => item.checks === 'failure'));
            button.count.opacity = failed ? 255 : DIM_OPACITY;
            if (failed)
                button.count.add_style_class_name('github-bar-failure');
            else
                button.count.remove_style_class_name('github-bar-failure');
        });
        this._tabsItem.visible = this._shown !== null && this._buttons.some(button => button.visible);
        this._select(this._tabShown(TABS[this._tab]) ? this._tab : this._firstTab());
    }

    setBusy(busy) {
        if (busy)
            this._spinner.play();
        else
            this._spinner.stop();
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

    _tabShown(tab) {
        return this._options?.[tab.option] ?? false;
    }

    _firstTab() {
        return Math.max(TABS.findIndex(tab => this._tabShown(tab)), 0);
    }

    _select(index) {
        this._tab = index;
        this._buttons.forEach((button, i) => {
            button.checked = i === index;
            if (i === index)
                button.remove_style_class_name('flat');
            else
                button.add_style_class_name('flat');
        });
        // A rebuild under keyboard focus keeps it at the same place in the list.
        const focused = this._list.box.get_children().findIndex(child => child.has_key_focus());
        this._list.removeAll();
        if (this._shown && this._tabsItem.visible)
            this._addList(TABS[index], this._shown, this._options);
        const children = this._list.box.get_children();
        if (focused >= 0 && children.length)
            children[Math.min(focused, children.length - 1)].grab_key_focus();
    }

    _addList(tab, dashboard, options) {
        const groups = tab.groups.filter(group => dashboard[group.key].items.length);
        if (!groups.length)
            this._list.addMenuItem(captionItem(tab.empty));

        for (const group of groups) {
            const {total, items} = dashboard[group.key];
            if (group.title)
                this._list.addMenuItem(headingItem(group.title));
            const shown = items.slice(0, options.maxItems);
            for (const entry of shown) {
                this._list.addMenuItem(group.key === 'notifications'
                    ? this._notificationItem(entry) : this._entryItem(entry));
            }
            if (total > shown.length)
                this._list.addAction(`${total - shown.length} more…`, () => this.emit('open-url', group.url));
            if (group.key === 'notifications')
                this._list.addAction('Mark All as Read', () => this.emit('mark-all-read'));
        }
    }

    _updateUser({user, calendar, streak}, options) {
        if (options.avatar) {
            this._avatar.child = null;
            this._avatar.set_style(`background-image: url("${options.avatar.get_uri()}"); border-radius: 999px;`);
        } else {
            this._avatar.child = new St.Icon({icon_name: 'avatar-default-symbolic', style_class: 'github-bar-avatar'});
            this._avatar.set_style(null);
        }
        this._name.text = user.name || user.login;
        this._login.text = user.name ? user.login : '';
        this._login.visible = Boolean(user.name);

        const stats = [plural(calendar.total, 'contribution', 'contributions')];
        if (streak)
            stats.push(`${streak}-day streak`);
        this._stats.text = stats.join(' · ');

        this._user.menu.removeAll();
        if (options.showGraph && calendar.days.length) {
            const graph = new GitHubBarGraph();
            graph.setDays(calendar.days);
            const item = inertItem(null);
            item.add_child(graph);
            this._user.menu.addMenuItem(item);
        }
        this._user.menu.addAction('Open Profile on GitHub', () => this.emit('open-url', `https://github.com/${user.login}`));
    }

    _entryItem(entry) {
        const icon = new St.Icon({gicon: this._icons[entry.kind], style_class: 'popup-menu-icon'});
        if (entry.checks === 'pending')
            icon.opacity = DIM_OPACITY;
        else if (entry.checks)
            icon.add_style_class_name(`github-bar-${entry.checks}`);

        let tag = REVIEW_TAGS[entry.review];
        if (entry.draft)
            tag = 'Draft';
        else if (entry.conflicts)
            tag = 'Conflicts';
        else if (entry.ready)
            tag = 'Ready to merge';
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
        const item = linkItem(icon, notification.title, [notification.repo, ago(notification.updated)],
            REASON_TAGS[notification.reason]);
        item.connect('activate', () => {
            this.emit('mark-read', notification.id);
            this.emit('open-url', notification.url);
        });

        // Shown while the row is hovered or focused; Delete does the same from the keyboard.
        const markRead = new St.Button({
            style_class: 'icon-button flat github-bar-mark-read',
            child: new St.Icon({icon_name: 'object-select-symbolic'}),
            accessible_name: 'Mark as Read',
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        markRead.connect('clicked', () => this._markRead(item, notification));
        item.add_child(markRead);
        item.connect('notify::active', () => (markRead.opacity = item.active ? 255 : 0));
        item.connect('key-press-event', (_item, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Delete)
                return Clutter.EVENT_PROPAGATE;
            this._markRead(item, notification);
            return Clutter.EVENT_STOP;
        });
        return item;
    }

    // The row goes at once; the inbox and its counts follow with the refresh after the write.
    _markRead(item, notification) {
        if (item.has_key_focus())
            this._list.box.navigate_focus(item, St.DirectionType.DOWN, false);
        item.destroy();
        this.emit('mark-read', notification.id);
    }
});
