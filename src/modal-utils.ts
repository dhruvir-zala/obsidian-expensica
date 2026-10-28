import type { Modal } from 'obsidian';

// Capture backdrop events before the host's dismissal handlers receive them.
// Listeners belong to the modal's own container and leave with that container.
export function preventBackdropDismissal(modal: Modal): void {
    const stopOutside = (event: Event): void => {
        if (event.target && !modal.modalEl.contains(event.target as Node)) event.stopImmediatePropagation();
    };
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
        modal.containerEl.addEventListener(type, stopOutside, true);
    }
}

// Adapts an async handler for APIs that expect a void callback; the handler owns its error handling.
export function voidAsync<A extends unknown[]>(handler: (...args: A) => Promise<unknown>): (...args: A) => void {
    // The promise is still returned at runtime so callers invoking the listener directly can await it.
    return (...args: A): void => handler(...args) as unknown as void;
}
