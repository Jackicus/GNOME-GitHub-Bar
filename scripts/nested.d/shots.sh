#   ./scripts/nested.sh shots [--light] [--out DIR]
#                                     start a stand-in nested shell (headless), open the
#                                     menu, raise a notification and open the preferences,
#                                     write the pictures to docs/screenshots/ (or DIR), and
#                                     stop it; --light does the top bar and the menu again
#                                     in a light shell, as *-light.png
#

# The first fetch lands about a second after ACTIVE, but the recording indicator of the start's own
# driver run can stay in the bar for several seconds more.
SHOTS_SETTLE=10

# Click points on a 1600x900 monitor, measured while the driver's recording indicator is in the bar
# (it shifts the button left; the pictures are taken by a later run, without it). Re-measure with
# 'start --stand-in --headless' and 'do "click 1367 16" "shot FILE 0 0 1600 900"'.
SHOTS_BUTTON="1367 16"
# Over the menu's sections, and a point off the menu and every window to leave the pointer at,
# so no row is photographed hovered.
SHOTS_SECTIONS="1370 500"
SHOTS_AWAY="1400 880"
# The preferences window opens centred.
SHOTS_PREFS="800 500"

cmd_shots() {
    local light=0 out="$REPO_DIR/docs/screenshots" status=0
    while (( $# )); do
        case "$1" in
            --light) light=1 ;;
            --out)   out="${2:-}"; [[ -n "$out" ]] || die "--out takes a directory."; shift ;;
            *)       die "Unknown shots option '$1'. Usage: shots [--light] [--out DIR]" ;;
        esac
        shift
    done
    is_running && die "A nested shell is running: './scripts/nested.sh stop' it first. Shots start one of their own, over stand-in data."
    command -v python3 >/dev/null || die "'python3' not found in PATH; the driver needs it."
    python3 -c 'import gi' 2>/dev/null || die "python3 has no 'gi' (install python-gobject); the driver needs it."
    mkdir -p "$out"
    out="$(cd "$out" && pwd)"

    # The nested session shares the desktop's PipeWire, so an application recording anywhere puts
    # the microphone indicator in its bar and moves the button. A module's own stream (a loopback,
    # no client) does not.
    if command -v pactl >/dev/null && [[ -n "$(pactl list short source-outputs 2>/dev/null | awk '$3 != "-"')" ]]; then
        warn "Something is recording sound: the shots will carry the microphone indicator and miss the button."
    fi
    cmd_start --stand-in --headless || return 1
    shots_take "$light" "$out" || status=1
    shots_errors
    stop_session "" || status=1
    (( status == 0 )) || return 1
    shots_report "$out"
}

# One run of the driver per call: the recording indicator leaves the bar only when the process that
# asked for it exits, so a click and the photograph of what it opened are separate calls.
shots_do() {
    cmd_do "$@" >/dev/null || { warn "The driver could not run: $*"; return 1; }
}

shots_take() {
    local light="$1" out="$2" suffix=""
    (( light )) && suffix="-light"

    if (( light )); then
        cmd_run timeout 5 gsettings set org.gnome.desktop.interface color-scheme prefer-light || return 1
    fi

    info "Letting the stand-in account load (${SHOTS_SETTLE}s)..."
    sleep "$SHOTS_SETTLE"

    info "Photographing the top bar..."
    # Nothing is clicked first, so there is no recording indicator in this picture.
    shots_do "shot $out/top-bar$suffix.png 1100 0 500 36" || return 1
    if (( ! light )); then
        shots_do "shot $out/top-bar-cropped.png 1380 0 220 28" || return 1
    fi

    info "Opening the menu..."
    shots_do "click $SHOTS_BUTTON" "move $SHOTS_AWAY" "wait 1.5" || return 1
    # The recording indicator outlives its process by a few seconds: usually gone by 6, at times still there at 7.
    shots_do "wait 10" "shot $out/menu$suffix.png 1180 0 420 885" || return 1
    shots_do "scroll $SHOTS_SECTIONS down 10" "move $SHOTS_AWAY" "wait 1" || return 1
    shots_do "wait 10" "shot $out/menu-scrolled$suffix.png 1180 0 420 885" || return 1
    shots_do "key Escape" || return 1

    # The notification and the preferences are shot once; the preferences are a GTK window
    # with its own colour setting.
    (( light )) && return 0

    info "Raising the checks-passed notification..."
    # The app notifies only on pending to passed for the same head commit, so it must see pending first.
    cmd_state checks-pending >/dev/null || return 1
    sleep 5
    cmd_state checks-passed >/dev/null || return 1
    sleep 3.5
    shots_do "shot $out/notification.png 530 28 540 120" || return 1

    info "Opening the preferences..."
    # The Extensions app is D-Bus activated on the nested bus; 'stop' closes it.
    cmd_run gnome-extensions prefs "$EXT_UUID" >>"$LOG_FILE" 2>&1 &
    sleep 5
    shots_do "move $SHOTS_AWAY" "wait 1" || return 1
    shots_do "window $out/preferences.png" || return 1
    shots_do "scroll $SHOTS_PREFS down 10" "move $SHOTS_AWAY" "wait 1" || return 1
    shots_do "wait 1" "window $out/preferences-notifications.png" || return 1
}

# The extension logs failures only; the staging line is the kit's dev-extension.js saying where it loaded from.
shots_errors() {
    local errors
    errors="$(grep -E 'JS ERROR|Extension .* error|\[GitHub Bar\]' "$LOG_FILE" 2>/dev/null | grep -v 'Enabled from' | head -5 || true)"
    [[ -z "$errors" ]] && return 0
    echo
    printf '\033[1;31m%s\033[0m\n' "Errors"
    sed 's/^/  /' <<< "$errors"
}

# The shell writes a creation time and a timezone into each PNG; a public picture carries pixels only.
shots_report() {
    local out="$1" shot
    if command -v oxipng >/dev/null 2>&1; then
        oxipng --quiet --opt 4 --strip safe "$out"/*.png
    else
        warn "oxipng is not installed: the shots still carry their text chunks. Strip them before committing."
    fi
    echo
    printf '\033[1m%s\033[0m\n' "Screenshots"
    for shot in "$out"/*.png; do
        [[ -e "$shot" ]] && printf '  %s\n' "${shot#"$REPO_DIR"/}"
    done
    return 0
}
