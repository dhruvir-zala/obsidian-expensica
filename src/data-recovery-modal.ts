import { App, Modal } from 'obsidian';
import { preventBackdropDismissal } from './modal-utils';
import type { MissingAccountReference } from './transaction-import';

export class DataRecoveryModal extends Modal {
    private retrying = false;
    private dismissed = false;
    private retryError: string | null = null;

    constructor(
        app: App,
        private readonly getFailures: () => { name: string; path: string; message?: string }[],
        private readonly retry: () => Promise<boolean>,
        private readonly onDismiss: () => void,
        private readonly getSaveFailure?: () => { operation: string; error: string; path: string },
        private readonly getReconcileAccounts?: () => {
            missingAccounts: MissingAccountReference[];
            resolve: () => Promise<unknown>;
        } | undefined
    ) {
        super(app);
        preventBackdropDismissal(this);
    }

    onOpen() {
        this.dismissed = false;
        this.refresh();
    }

    refresh() {
        if (this.dismissed) return;
        const { contentEl } = this;
        contentEl.empty();
        const reconciliation = this.getReconcileAccounts?.();
        const failures = this.getFailures();
        const missingAccountsOnly = !this.getSaveFailure && reconciliation
            && failures.every(failure => failure.name === 'transactions');
        const importFailure = this.getSaveFailure?.().operation === 'Import transactions';
        if (this.getSaveFailure) {
            const failure = this.getSaveFailure();
            if (importFailure) {
                contentEl.createEl('h2', { text: 'Import could not be saved', cls: 'expensica-recovery-modal-title' });
                contentEl.createEl('p', { text: failure.path.split(/[\\/]/).pop() || failure.path, cls: 'expensica-recovery-modal-file' });
                contentEl.createEl('p', { text: failure.error });
            } else {
                contentEl.createEl('h2', { text: `${failure.operation} could not be saved`, cls: 'expensica-recovery-modal-title' });
                const details = contentEl.createEl('p');
                details.createSpan({ text: `Operation: ${failure.operation}. File: ` });
                details.createSpan({ text: failure.path, cls: 'expensica-recovery-modal-file' });
                contentEl.createEl('p', { text: failure.error });
                contentEl.createEl('p', {
                    text: 'This operation has not completed. Your unsaved input is still in the editor. Retry attempts the operation again; previously completed changes remain saved. Back to Editor lets you correct the input or cancel the operation. Closing this dialog keeps the error card visible.'
                });
            }
        } else if (!missingAccountsOnly) {
            contentEl.createEl('h2', {
                text: 'Expensica data could not be loaded',
                cls: 'expensica-recovery-modal-title'
            });
            contentEl.createEl('p', {
                text: 'Some files content are not valid and could not be loaded. Expensica will block saving the affected data to the following files until they are restored:'
            });
            const files = contentEl.createEl('ul');
            for (const failure of failures) {
                if (reconciliation && failure.name === 'transactions') continue;
                files.createEl('li', {
                    text: `${failure.name}: ${failure.path}${failure.message ? ` — ${failure.message}` : ''}`,
                    cls: 'expensica-recovery-modal-file'
                });
            }
            contentEl.createEl('p', {
                text: 'Restore valid copies of the files, then retry. Retry reloads the affected datasets from disk. Any edited data in the current session can only be saved after a successful recovery.'
            });
        }
        if (reconciliation) {
            const { missingAccounts } = reconciliation;
            const affectedCount = new Set(missingAccounts.flatMap((account: MissingAccountReference): number[] => account.locations.map((location: { index: number }): number => location.index))).size;
            contentEl.createEl('h2', {
                text: 'Missing accounts',
                cls: 'expensica-recovery-modal-warning'
            });
            contentEl.createEl('p', {
                text: `${affectedCount} transaction${affectedCount === 1 ? ' references' : 's reference'} an account that Expensica cannot find:`
            });
            const accounts = contentEl.createEl('ul');
            for (const account of missingAccounts.slice(0, 7)) {
                accounts.createEl('li', {
                    text: `${account.reference || 'Unassigned account'}: ${account.count} affected transaction${account.count === 1 ? '' : 's'}`,
                    cls: 'expensica-recovery-modal-file'
                });
            }
            if (missingAccounts.length > 7) {
                accounts.createEl('li', { text: '...' });
                accounts.createEl('li', { text: `and ${missingAccounts.length - 7} more` });
            }
            contentEl.createEl('p', { text: 'Resolve accounts by editing transactions.json, linking to an existing account, or creating a new one.' });
            contentEl.createEl('p', { text: 'Transaction saving is paused to protect your data.' });
        }
        if (this.retryError) {
            contentEl.createEl('p', { text: `Recovery failed: ${this.retryError}` });
        }
        const buttons = contentEl.createDiv('modal-button-container');
        if (reconciliation) buttons.createEl('button', { text: 'Resolve accounts', cls: 'mod-cta' })
            .addEventListener('click', () => {
                void (async () => {
                    try { await reconciliation.resolve(); }
                    catch (error) {
                        console.error('Expensica: Account resolution could not complete', error);
                        this.retryError = 'Accounts could not be resolved. Check the files, then Retry.';
                        this.refresh();
                    }
                })();
            });
        const retryButton = buttons.createEl('button', { text: 'Retry', cls: reconciliation ? '' : 'mod-cta' });
        retryButton.disabled = this.retrying;
        retryButton.addEventListener('click', () => this.handleRetry(retryButton, backButton));
        const backButton = buttons.createEl('button', { text: reconciliation ? 'Not now' : this.getSaveFailure && !importFailure ? 'Back to Editor' : 'Close' });
        backButton.disabled = !!this.getSaveFailure && this.retrying;
        backButton.addEventListener('click', () => this.close());
    }

    private async handleRetry(retryButton: HTMLButtonElement, backButton: HTMLButtonElement): Promise<void> {
        if (this.retrying) return;
        this.retrying = true;
        this.retryError = null;
        retryButton.disabled = true;
        backButton.disabled = !!this.getSaveFailure;
        try {
            if (await this.retry() && !this.dismissed) {
                this.retrying = false;
                this.close();
            }
        } catch (error) {
            console.error('Expensica: Data recovery could not complete', error);
            this.retryError = 'The file is still unavailable. Check file access and available storage, then retry. Your unsaved input has been kept.';
        } finally {
            this.retrying = false;
            this.refresh();
        }
    }

    onClose() {
        this.dismissed = true;
        this.contentEl.empty();
        this.onDismiss();
    }
}
