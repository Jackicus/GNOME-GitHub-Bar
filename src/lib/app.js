// GitHub Bar: Your GitHub notifications, review requests and pull request CI status in the top bar
//
// Everything the extension puts into the shell is made in enable() and taken
// down in disable(); nothing is created at import.

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// No GTypeName: GJS names the class after this module's path, which differs per
// development stage, so a reload after an edit registers it afresh.
const GitHubBarIndicator = GObject.registerClass(
class GitHubBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, extension.metadata.name);
        this.add_child(new St.Icon({
            icon_name: 'application-x-addon-symbolic',
            style_class: 'system-status-icon',
        }));
    }
});

export class GitHubBarApp {
    constructor(extension) {
        this._extension = extension;
    }

    enable() {
        this._settings = this._extension.getSettings();
        this._settings.connectObject('changed::show-indicator', () => this._sync(), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._settings = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    // The indicator is there exactly while show-indicator is on.
    _sync() {
        const show = this._settings.get_boolean('show-indicator');
        if (show && !this._indicator) {
            this._indicator = new GitHubBarIndicator(this._extension);
            Main.panel.addToStatusArea(this._extension.uuid, this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
