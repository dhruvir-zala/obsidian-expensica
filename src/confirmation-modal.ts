import { App, Modal } from 'obsidian';

export class ConfirmationModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: (confirmed: boolean) => void;
    private confirmLabel: string;
    private confirmed = false;
    private resolved = false;

    constructor(app: App, title: string, message: string, onConfirm: (confirmed: boolean) => void, confirmLabel = 'Delete') {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmLabel = confirmLabel;
    }

    onOpen() {
        this.confirmed = false;
        this.resolved = false;
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
        
        const confirmBtn = buttonContainer.createEl('button', {
            text: this.confirmLabel,
            cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid'
        });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary'
        });

        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        confirmBtn.addEventListener('click', () => {
            this.confirmed = true;
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (!this.resolved) {
            this.resolved = true;
            this.onConfirm(this.confirmed);
        }
    }
} 
