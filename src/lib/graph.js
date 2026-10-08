import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Cell opacity per level; level 0 is a day with no contributions.
const LEVELS = [0.12, 0.4, 0.6, 0.8, 1];

// Sunday is 0, as GitHub's calendar starts its weeks.
function weekday(date) {
    const [year, month, day] = date.split('-').map(Number);
    return GLib.DateTime.new_utc(year, month, day, 0, 0, 0).get_day_of_week() % 7;
}

export const GitHubBarGraph = GObject.registerClass(
class GitHubBarGraph extends St.DrawingArea {
    constructor() {
        super({style_class: 'github-bar-graph', x_expand: true});
        this._days = [];
    }

    // days: [{date: 'YYYY-MM-DD', count}], oldest first.
    setDays(days) {
        this._days = days;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const node = this.get_theme_node();
        const empty = node.get_foreground_color();
        const [, accent] = node.lookup_color('-github-bar-graph-color', false);

        // As many of the latest weeks as fit the width, a column per week from Sunday.
        const step = height / 7;
        const weeks = Math.floor(width / step);
        const last = this._days.at(-1);
        const days = last && weeks > 0 ? this._days.slice(-((weeks - 1) * 7 + weekday(last.date) + 1)) : [];
        const size = step * 0.8;
        const radius = size * 0.2;
        const left = (width - weeks * step + step - size) / 2;
        const max = Math.max(1, ...days.map(day => day.count));

        let column = 0;
        days.forEach((day, i) => {
            const row = weekday(day.date);
            if (i > 0 && row === 0)
                column++;
            const level = day.count && Math.ceil(4 * day.count / max);
            const color = level ? accent : empty;
            cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, LEVELS[level]);

            const x = left + column * step;
            const y = row * step;
            cr.newSubPath();
            cr.arc(x + size - radius, y + radius, radius, -Math.PI / 2, 0);
            cr.arc(x + size - radius, y + size - radius, radius, 0, Math.PI / 2);
            cr.arc(x + radius, y + size - radius, radius, Math.PI / 2, Math.PI);
            cr.arc(x + radius, y + radius, radius, Math.PI, 1.5 * Math.PI);
            cr.closePath();
            cr.fill();
        });
        cr.$dispose();
    }
});
