import type { Transaction } from './models';

export interface TransactionEditorHost {
    getDefaultTransactionDate?(): Date;
    addTransaction(transaction: Transaction): Promise<void>;
    updateTransaction(transaction: Transaction): Promise<void>;
    deleteTransaction(id: string, onDeleted?: () => void, onConfirmDelete?: () => void): Promise<void>;
}
