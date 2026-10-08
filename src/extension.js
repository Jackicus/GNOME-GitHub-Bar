import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {GitHubBarApp} from './lib/app.js';

export default class GitHubBarExtension extends Extension {
    enable() {
        this._app = new GitHubBarApp(this);
        this._app.enable();
    }

    disable() {
        this._app.disable();
        this._app = null;
    }
}
