import { Notice } from 'obsidian';

export function showExpensicaNotice(message: string, timeout?: number): Notice {
    const fragment = createFragment();
    fragment.createSpan({ text: message, cls: 'expensica-notice-content' });

    const notice = new Notice(fragment, timeout);
    notice.messageEl.addClass('expensica-notice');
    return notice;
}
