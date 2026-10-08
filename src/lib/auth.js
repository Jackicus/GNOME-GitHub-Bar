// The GitHub CLI's login, read where `gh auth login` left it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Secret.Service, 'get');
Gio._promisify(Secret.Service.prototype, 'search');

const HOST = 'github.com';

function cancelled(e) {
    return e instanceof Gio.IOErrorEnum && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export function hostsFile() {
    const dir = GLib.getenv('GH_CONFIG_DIR') || GLib.build_filenamev([GLib.get_user_config_dir(), 'gh']);
    return Gio.File.new_for_path(GLib.build_filenamev([dir, 'hosts.yml']));
}

// The `key: value` lines directly under `github.com:`. The nested `users:` block is
// indented further and skipped.
async function readHost(cancellable) {
    let text;
    try {
        const [bytes] = await hostsFile().load_contents_async(cancellable);
        text = new TextDecoder().decode(bytes);
    } catch (e) {
        // No hosts.yml is no login.
        if (cancelled(e))
            throw e;
        return {};
    }

    const values = {};
    let inHost = false;
    let indent = null;
    for (const line of text.split('\n')) {
        const match = line.match(/^(\s*)([^\s:#][^:]*):\s*(.*)$/);
        if (!match)
            continue;
        const [, spaces, key, value] = match;
        if (!spaces) {
            inHost = key === HOST;
            indent = null;
        } else if (inHost) {
            indent ??= spaces.length;
            if (spaces.length === indent)
                values[key] = value.trim();
        }
    }
    return values;
}

// A search without UNLOCK: a locked keyring reads as signed out, rather than raising
// an unlock prompt on every poll.
async function lookupSecret(username, cancellable) {
    const schema = new Secret.Schema('org.freedesktop.Secret.Generic', Secret.SchemaFlags.DONT_MATCH_NAME, {
        service: Secret.SchemaAttributeType.STRING,
        username: Secret.SchemaAttributeType.STRING,
    });
    try {
        const service = await Secret.Service.get(Secret.ServiceFlags.NONE, cancellable);
        const [item] = await service.search(schema, {service: `gh:${HOST}`, username},
            Secret.SearchFlags.LOAD_SECRETS, cancellable);
        return item?.get_secret()?.get_text() ?? null;
    } catch (e) {
        // No secret service on the bus.
        if (cancelled(e))
            throw e;
        return null;
    }
}

// go-keyring may store the secret base64-encoded behind a prefix.
function decodeSecret(secret) {
    const prefix = 'go-keyring-base64:';
    if (!secret.startsWith(prefix))
        return secret;
    return new TextDecoder().decode(GLib.base64_decode(secret.slice(prefix.length)));
}

// Read afresh every time: gh may have signed in, out or switched accounts since.
export async function readToken(cancellable) {
    const host = await readHost(cancellable);
    if (host.oauth_token)
        return host.oauth_token;
    if (!host.user)
        return null;

    // gh keeps a copy under the active account with an empty username.
    const secret = await lookupSecret(host.user, cancellable) ?? await lookupSecret('', cancellable);
    return secret ? decodeSecret(secret) : null;
}
