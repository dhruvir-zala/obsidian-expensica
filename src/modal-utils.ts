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
