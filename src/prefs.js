import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The schema's nicks for the count key, in the order the row lists them.
const COUNTS = [
    ['both', 'Both'],
    ['notifications', 'Notifications'],
    ['reviews', 'Review Requests'],
    ['none', 'None'],
];

export default class GitHubBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const bar = new Adw.PreferencesGroup({title: 'Top Bar'});
        const count = new Adw.ComboRow({
            title: 'Number Beside the Icon',
            subtitle: 'Unread notifications, review requests, or both added',
            model: Gtk.StringList.new(COUNTS.map(([, label]) => label)),
        });
        const syncCount = () => {
            count.selected = COUNTS.findIndex(([nick]) => nick === settings.get_string('count'));
        };
        syncCount();
        settings.connect('changed::count', syncCount);
        count.connect('notify::selected', () => settings.set_string('count', COUNTS[count.selected][0]));
        bar.add(count);
        page.add(bar);

        const menu = new Adw.PreferencesGroup({title: 'Menu'});
        this._addSwitch(menu, settings, 'show-reviews', 'Review Requests', 'Pull requests that ask for your review');
        this._addSwitch(menu, settings, 'show-pulls', 'Your Pull Requests', 'With their checks and review state');
        this._addSwitch(menu, settings, 'show-assigned', 'Assigned to You', 'Open issues and pull requests');
        this._addSwitch(menu, settings, 'show-notifications', 'Notifications', 'Unread, from your GitHub inbox');
        this._addSwitch(menu, settings, 'show-graph', 'Contribution Graph', 'The last weeks, with your streak');
        const items = Adw.SpinRow.new_with_range(1, 20, 1);
        items.title = 'Items per Section';
        items.subtitle = 'The rest are a click away on GitHub';
        settings.bind('max-items', items, 'value', Gio.SettingsBindFlags.DEFAULT);
        menu.add(items);
        page.add(menu);

        const notify = new Adw.PreferencesGroup({title: 'Notifications'});
        this._addSwitch(notify, settings, 'notify-checks', 'Checks Finished',
            'When the checks on one of your pull requests pass or fail');
        this._addSwitch(notify, settings, 'notify-reviews', 'Review Requested',
            'When someone asks for your review');
        page.add(notify);

        const updates = new Adw.PreferencesGroup({
            title: 'Updates',
            description: 'GitHub Bar uses the GitHub CLI’s login: run “gh auth login” once in a terminal. ' +
                'It never signs in by itself and never stores a token.',
        });
        const poll = Adw.SpinRow.new_with_range(60, 3600, 60);
        poll.title = 'Seconds Between Updates';
        poll.subtitle = 'Every minute while checks run on your pull requests';
        settings.bind('poll-seconds', poll, 'value', Gio.SettingsBindFlags.DEFAULT);
        updates.add(poll);
        page.add(updates);

        window.add(page);
    }

    _addSwitch(group, settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }
}
