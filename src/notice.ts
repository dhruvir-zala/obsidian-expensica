import { Notice } from 'obsidian';

export function showExpensicaNotice(message: string, timeout?: number): Notice {
    const fragment = document.createDocumentFragment();
    fragment.createEl('span', { text: message, cls: 'expensica-notice-content' });

    return new Notice(fragment, timeout);
}
