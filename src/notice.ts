import { Notice } from 'obsidian';

export function showExpensicaNotice(message: string, timeout?: number): Notice {
    const fragment = createFragment();
    fragment.createSpan({ text: message, cls: 'expensica-notice-content' });

    return new Notice(fragment, timeout);
}
