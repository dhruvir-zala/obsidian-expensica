import { Notice } from 'obsidian';

export function showExpensicaNotice(message: string, timeout?: number): Notice {
    const fragment = document.createDocumentFragment();
    const content = document.createElement('span');
    content.className = 'expensica-notice-content';
    content.textContent = message;
    fragment.appendChild(content);

    return new Notice(fragment, timeout);
}
