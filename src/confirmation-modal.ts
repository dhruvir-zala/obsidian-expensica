import { App, Modal } from 'obsidian';
import type ExpensicaPlugin from '../main';

export class ConfirmationModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: (confirmed: boolean) => void | Promise<void>;
    private confirmLabel: string;
    private confirmed = false;
    private resolved = false;
    private submitting = false;

    constructor(app: App, title: string, message: string, onConfirm: (confirmed: boolean) => void | Promise<void>, confirmLabel = 'Delete', private readonly plugin?: ExpensicaPlugin) {
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
        this.modalEl.addClass('expensica-confirmation-dialog');
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

        const submit = async () => {
            if (this.submitting) return;
            this.submitting = true;
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            try {
                await this.onConfirm(true);
                this.confirmed = true;
                this.resolved = true;
            } catch (error) {
                // Persistence reports the error; leave this confirmation available for retry.
                console.error('Expensica: Confirmation did not complete', error);
                if (this.plugin) throw error;
            } finally {
                this.submitting = false;
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
            }
            if (this.resolved) this.close();
        };
        confirmBtn.addEventListener('click', () => {
            void (this.plugin
                ? this.plugin.runSaveOperation(this, this.title.replace(/\?$/, ''), submit)
                : submit());
        });
    }

    close() {
        if (!this.submitting) super.close();
    }

    onClose() {
        this.plugin?.releaseSaveOperation(this);
        const { contentEl } = this;
        contentEl.empty();
        if (!this.resolved) {
            this.resolved = true;
            const confirmed = this.confirmed;
            Promise.resolve(this.onConfirm(confirmed)).catch((error: unknown) => {
                console.error('Expensica: Confirmation callback failed', error);
            });
        }
    }
} 
