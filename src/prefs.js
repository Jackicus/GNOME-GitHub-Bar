import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GitHubBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Top Bar'});
        const row = new Adw.SwitchRow({
            title: 'Show the Indicator',
            subtitle: 'An icon in the top bar',
        });
        settings.bind('show-indicator', row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
        page.add(group);
        window.add(page);
    }
}
