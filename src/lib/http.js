import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

// Under the shortest poll interval the schema allows (60 s).
const TIMEOUT_SECONDS = 20;

const SUCCESS = [200, 201, 202, 204, 205, 304];

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;   // the HTTP status, or 0 when the request never landed
    }
}

export class Http {
    constructor(userAgent) {
        this._session = new Soup.Session({
            user_agent: userAgent,
            timeout: TIMEOUT_SECONDS,
            idle_timeout: TIMEOUT_SECONDS,
        });
    }

    // Resolves {status, body, headers}; body is null when the response has none (a 304).
    async request(method, url, {token, body = null, ifModifiedSince = null}, cancellable) {
        const message = Soup.Message.new(method, url);
        const headers = message.get_request_headers();
        headers.append('Authorization', `Bearer ${token}`);
        headers.append('Accept', 'application/vnd.github+json');
        headers.append('X-GitHub-Api-Version', '2022-11-28');
        if (ifModifiedSince)
            headers.append('If-Modified-Since', ifModifiedSince);
        if (body !== null) {
            message.set_request_body_from_bytes('application/json',
                new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        }

        const bytes = await this._send(message, cancellable);
        const status = message.get_status();
        if (!SUCCESS.includes(status))
            throw new HttpError(status, `HTTP ${status} ${message.get_reason_phrase() ?? ''}`.trim());

        const response = message.get_response_headers();
        const result = {
            status,
            body: null,
            headers: {
                'last-modified': response.get_one('Last-Modified'),
                'x-poll-interval': response.get_one('X-Poll-Interval'),
            },
        };
        const data = bytes.get_data();
        if (data?.length) {
            try {
                result.body = JSON.parse(new TextDecoder().decode(data));
            } catch (e) {
                throw new HttpError(status, `The response was not JSON: ${e.message}`);
            }
        }
        return result;
    }

    async getBytes(url, cancellable) {
        const message = Soup.Message.new('GET', url);
        const bytes = await this._send(message, cancellable);
        const status = message.get_status();
        if (status !== Soup.Status.OK)
            throw new HttpError(status, `HTTP ${status}`);
        return bytes;
    }

    async _send(message, cancellable) {
        try {
            return await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            if (e instanceof Gio.IOErrorEnum && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            throw new HttpError(0, e.message);
        }
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
}
