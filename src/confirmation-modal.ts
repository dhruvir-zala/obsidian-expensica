import { App, Modal } from 'obsidian';

export class ConfirmationModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: (confirmed: boolean) => void;

    constructor(app: App, title: string, message: string, onConfirm: (confirmed: boolean) => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('expensica-confirmation-modal');

        // Title
        const titleEl = contentEl.createEl('h2', { text: this.title });
        titleEl.addClass('expensica-modal-title');

        // Message
        const messageEl = contentEl.createEl('p', { text: this.message });
        messageEl.addClass('expensica-modal-message');

        // Buttons
        const buttonContainer = contentEl.createDiv('expensica-modal-buttons');
        
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary'
        });
        
        const confirmBtn = buttonContainer.createEl('button', {
            text: 'Delete',
            cls: 'expensica-btn expensica-btn-danger'
        });

        cancelBtn.addEventListener('click', () => {
            this.onConfirm(false);
            this.close();
        });

        confirmBtn.addEventListener('click', () => {
            this.onConfirm(true);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
} 