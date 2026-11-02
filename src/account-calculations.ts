import { AccountType, TransactionType, sortTransactionsByDateTimeDesc } from './models';
import type { Account, Transaction } from './models';

interface AccountCalculationSource {
    findAccountByReference(reference: string): Account | null;
    normalizeTransactionAccountReference(reference?: string | null): string;
    getAllTransactions(): Transaction[];
}

export function getAccountTransactionAmount(plugin: AccountCalculationSource, transaction: Transaction, accountReference: string,
    isCredit = plugin.findAccountByReference(accountReference)?.type === AccountType.CREDIT,
    defaultAccountReference?: string): number {
    if (transaction.type === TransactionType.INTERNAL) {
        const fromAccount = transaction.fromAccount ? plugin.normalizeTransactionAccountReference(transaction.fromAccount) : '';
        const toAccount = transaction.toAccount ? plugin.normalizeTransactionAccountReference(transaction.toAccount) : '';
        if (fromAccount === toAccount) return 0;
        if (fromAccount === accountReference) {
            return isCredit ? transaction.amount : -transaction.amount;
        }
        if (toAccount === accountReference) {
            return isCredit ? -transaction.amount : transaction.amount;
        }
        return 0;
    }

    const transactionAccount = defaultAccountReference !== undefined && !transaction.account
        ? defaultAccountReference
        : Object.prototype.hasOwnProperty.call(transaction, 'account')
            ? plugin.normalizeTransactionAccountReference(transaction.account)
            : defaultAccountReference ?? plugin.normalizeTransactionAccountReference(undefined);

    if (transactionAccount !== accountReference) {
        return 0;
    }

    if (transaction.type === TransactionType.INCOME) {
        return isCredit ? -transaction.amount : transaction.amount;
    }

    return transaction.type === TransactionType.EXPENSE
        ? (isCredit ? transaction.amount : -transaction.amount)
        : 0;
}

export function getAccountRunningBalance(plugin: AccountCalculationSource, accountReference: string, transactions: Transaction[]): number {
    return transactions.reduce(
        (balance, transaction) => balance + getAccountTransactionAmount(plugin, transaction, accountReference),
        0
    );
}

export function getRunningBalanceByTransactionIdForAccount(
    plugin: AccountCalculationSource,
    accountReference: string,
    transactions: Transaction[],
    chronologicalTransactions: readonly Transaction[] = sortTransactionsByDateTimeDesc(transactions, plugin.getAllTransactions()).reverse()
): Record<string, number> {
    let runningBalance = 0;
    const isCredit = plugin.findAccountByReference(accountReference)?.type === AccountType.CREDIT;

    return chronologicalTransactions
        .reduce<Record<string, number>>((balances, transaction) => {
            runningBalance += getAccountTransactionAmount(plugin, transaction, accountReference, isCredit);
            balances[transaction.id] = runningBalance;
            return balances;
        }, {});
}

