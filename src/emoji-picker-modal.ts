import { App, Modal } from 'obsidian';
import { Category, CategoryType } from './models';

export class EmojiPickerModal extends Modal {
    category: Category;
    currentEmoji: string;
    onConfirm: (emoji: string) => void;

    constructor(app: App, category: Category, currentEmoji: string, onConfirm: (emoji: string) => void) {
        super(app);
        this.category = category;
        this.currentEmoji = currentEmoji;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.addClass('expensica-modal');

        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = `<span class="expensica-modal-title-icon">${this.currentEmoji}</span> Choose Emoji for "${this.category.name}"`;

        const form = contentEl.createDiv('emoji-picker-form');

        const emojiInput = form.createEl('input', {
            attr: {
                type: 'text',
                value: this.currentEmoji,
                placeholder: 'Enter an emoji'
            },
            cls: 'emoji-input'
        });

        const commonEmojis = form.createDiv('common-emojis');
        commonEmojis.createEl('p', { text: 'Common emojis:' });

        const emojis = this.category.type === CategoryType.EXPENSE
            ? [
                '\u{1F4BC}', '\u{1F37D}\u{FE0F}', '\u{1F6D2}', '\u{1F697}', '\u{1F3E0}',
                '\u{1F4A1}', '\u{1F4F1}', '\u{1F3AC}', '\u{1F6CD}\u{FE0F}', '\u{1F3E5}',
                '\u{1F4DA}', '\u{2708}\u{FE0F}', '\u{1F3CB}\u{FE0F}', '\u{1F43E}', '\u{1F381}',
                '\u{1F487}', '\u{1F476}', '\u{1F4FA}', '\u{1F512}', '\u{1F4DD}'
            ]
            : [
                '\u{1F4B0}', '\u{1F4B5}', '\u{1F4B3}', '\u{1F4BB}', '\u{1F4B8}',
                '\u{1F4C8}', '\u{1F3D8}\u{FE0F}', '\u{1F380}', '\u{1F4CB}', '\u{1F3E2}'
            ];

        const emojiGrid = commonEmojis.createDiv('emoji-grid');

        emojis.forEach(emoji => {
            const emojiButton = emojiGrid.createEl('button', {
                text: emoji,
                cls: 'emoji-button'
            });

            emojiButton.addEventListener('click', () => {
                emojiInput.value = emoji;
            });
        });

        const buttonContainer = form.createDiv('button-container');

        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary'
        });

        const saveButton = buttonContainer.createEl('button', {
            text: 'Save',
            cls: 'expensica-btn expensica-btn-primary'
        });

        cancelButton.addEventListener('click', () => {
            this.close();
        });

        saveButton.addEventListener('click', () => {
            const nextEmoji = emojiInput.value || this.currentEmoji;
            if (nextEmoji !== this.currentEmoji) {
                this.onConfirm(nextEmoji);
            }
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
