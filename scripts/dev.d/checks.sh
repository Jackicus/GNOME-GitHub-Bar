#   ./scripts/dev.sh imports    check that nothing in prefs.js's import graph reaches St,
#                               Clutter, Meta, Shell, Soup or resource:// paths
#   ./scripts/dev.sh parsers    run the parsers over saved responses and the client over a
#                               fake connection and a throwaway gh login
#   ./scripts/dev.sh live       fetch the dashboard with the real gh login and print its
#                               counts and states, no titles. Reads the real login and goes
#                               to the network: the user's to run
#

cmd_imports() {
    require gjs
    gjs -m "$REPO_DIR/scripts/imports.js"
}

cmd_parsers() {
    require gjs
    gjs -m "$REPO_DIR/scripts/parsers.js"
}

cmd_live() {
    require gjs
    gjs -m "$REPO_DIR/scripts/live.js"
}
