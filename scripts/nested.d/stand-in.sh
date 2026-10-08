#   ./scripts/nested.sh state STATE   under --stand-in, put the stand-in account in a state
#                                     the menu can show: ok, empty, unauthorized (401),
#                                     offline, error (502), checks-pending, checks-passed,
#                                     checks-failed (stand-in/garden #42's checks),
#                                     signed-out, signed-in. It re-reads at once
#

# The stand-in world for 'start --stand-in' (and so 'shots'), since the pictures go into a public
# repository. On top of the kit's scratch HOME: a gh login for the account "stand-in", whose token
# is the word "stand-in", and scripts/stand-in-http.js staged over lib/http.js, which answers from
# $HOME/stand-in-state.json. Notifications marked read stay read until the next start.

# nested_stand_in_stage STAGE: every time the extension is staged, reload included.
nested_stand_in_stage() {
    cp "$REPO_DIR/scripts/stand-in-http.js" "$1/lib/http.js"
}

# nested_stand_in HOME STAGE: once per start.
nested_stand_in() {
    rm -f "$1/stand-in-state.json"
    cp "$REPO_DIR/scripts/stand-in-avatar.svg" "$1/"
    stand_in_login
}

# gh's hosts.yml in the stand-in session's XDG_CONFIG_HOME, which is beside its HOME.
stand_in_hosts() {
    echo "$STAND_IN_DIR/config/gh/hosts.yml"
}

stand_in_login() {
    mkdir -p "$(dirname "$(stand_in_hosts)")"
    cat > "$(stand_in_hosts)" <<'YAML'
github.com:
    user: stand-in
    oauth_token: stand-in
    git_protocol: https
YAML
}

# The app watches hosts.yml, so a state change writes it again (when signed in) to have the
# app read again: a write, not a touch, which a monitor reports only as an attribute change.
cmd_state() {
    local state="${1:-}" hosts
    [[ "$state" =~ ^(ok|empty|unauthorized|offline|error|checks-pending|checks-passed|checks-failed|signed-out|signed-in)$ ]] \
        || die "Usage: state ok|empty|unauthorized|offline|error|checks-pending|checks-passed|checks-failed|signed-out|signed-in"
    is_running && stand_in || die "This needs a nested shell started with --stand-in."
    hosts="$(stand_in_hosts)"

    case "$state" in
        signed-out)
            rm -f "$hosts" ;;
        signed-in)
            stand_in_login ;;
        *)
            # The threads already marked read are kept.
            python3 - "$STAND_IN_HOME/stand-in-state.json" "$state" <<'PY'
import json, sys
path, state = sys.argv[1:]
try:
    read = json.load(open(path)).get('read', [])
except (OSError, ValueError):
    read = []
json.dump({'state': state, 'read': read}, open(path, 'w'))
PY
            if [[ -e "$hosts" ]]; then stand_in_login; fi ;;
    esac
    ok "$state. The app reads again on the hosts.yml change (or click Refresh)."
}
