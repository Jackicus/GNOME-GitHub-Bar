export function warn(message) {
    console.warn(`[GitHub Bar] ${message}`);
}

export function error(message, e) {
    console.error(`[GitHub Bar] ${message}:`, e);
}
