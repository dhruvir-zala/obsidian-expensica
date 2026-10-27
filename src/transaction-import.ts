import { Account, AccountType, Category, Transaction, TransactionType, formatAccountReference, formatTime, generateId, getCategoryTypeForTransactionType, getDefaultTransactionCategory, getTimeInSeconds, isSelfTransfer, parseAccountReference } from './models';

interface TransactionValidationIssue {
    index: number | null;
    field: string;
    reason: string;
    action?: string;
    accountReference?: string;
}

export interface MissingAccountReference {
    reference: string;
    count: number;
    locations: { index: number; field: string }[];
}

function validationMessage({ index, field, reason }: TransactionValidationIssue): string {
    return `${index === null ? field : `transactions[${index}].${field}`}: ${reason}.`;
}

export class TransactionValidationError extends Error {
    readonly missingAccounts: MissingAccountReference[];
    constructor(readonly index: number | null, readonly field: string, reason: string,
        readonly action = 'Correct the JSON file, then Retry.',
        readonly errors: TransactionValidationIssue[] = [{ index, field, reason }]) {
        super(validationMessage({ index, field, reason }));
        this.name = 'TransactionValidationError';
        const groups = new Map<string, { locations: { index: number; field: string }[]; indices: Set<number> }>();
        for (const issue of errors) {
            if (issue.accountReference === undefined || issue.index === null) continue;
            const group = groups.get(issue.accountReference) || { locations: [], indices: new Set<number>() };
            group.locations.push({ index: issue.index, field: issue.field });
            group.indices.add(issue.index);
            groups.set(issue.accountReference, group);
        }
        this.missingAccounts = Array.from(groups, ([reference, group]) => ({ reference, count: group.indices.size, locations: group.locations }));
    }

    get messages(): string[] {
        return this.errors.map(validationMessage);
    }

    get canReconcileAccounts(): boolean {
        return this.missingAccounts.length > 0 && this.errors.every(issue => issue.accountReference !== undefined);
    }
}

function rejectInvalidTransactions(errors: TransactionValidationIssue[]): never {
    const first = errors[0];
    throw new TransactionValidationError(first.index, first.field, first.reason, first.action, errors);
}

export function parseTransactionFile(content: string, existing: Transaction[] = [], accounts?: Account[], repairDuplicateIds = false): {
    data: Record<string, unknown> & { transactions: unknown[] }; legacyArray: boolean;
} {
    let value: unknown;
    try {
        value = JSON.parse(content.replace(/^\uFEFF/, ''));
    } catch {
        throw new TransactionValidationError(null, 'JSON', 'invalid JSON syntax', 'Fix the JSON syntax, then Retry.');
    }
    if (Array.isArray(value)) return { data: { transactions: value }, legacyArray: true };
    if (value && typeof value === 'object') {
        const envelope = value as Record<string, unknown>;
        if (envelope.lastUpdated != null && typeof envelope.lastUpdated !== 'string') {
            rejectInvalidTransactions([
                { index: null, field: 'lastUpdated', reason: 'expected a string' },
                ...collectTransactionErrors(envelope.transactions, existing, accounts, repairDuplicateIds)
            ]);
        }
        if (Array.isArray(envelope.transactions)) return {
            data: envelope as Record<string, unknown> & { transactions: unknown[] }, legacyArray: false
        };
    }
    throw new TransactionValidationError(null, 'transactions', 'expected a JSON object containing a "transactions" array and optional "lastUpdated" string, or a legacy root-level array of transaction objects',
        'Use { "transactions": [...], "lastUpdated": "..." } or [...], then Retry.');
}

export function parseTransactionImport(content: string, existing: Transaction[] = [], accounts?: Account[], repairDuplicateIds = false): unknown[] {
    return parseTransactionFile(content, existing, accounts, repairDuplicateIds).data.transactions;
}

// Imports may contain date-only values or ISO timestamps. Keep the original string.
function validDate(value: string): boolean {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/);
    if (!match || Number(match[1]) === 0) return false;
    const date = new Date(0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getUTCFullYear() === Number(match[1])
        && date.getUTCMonth() === Number(match[2]) - 1
        && date.getUTCDate() === Number(match[3])
        && (!match[4] || getTimeInSeconds(`${match[4]}:${match[5]}:${match[6] || '00'}`) !== null);
}

function resolveAccountReference(value: unknown, references: Set<string>, defaultReference?: string): string | undefined {
    if (value == null || value === '') return defaultReference;
    if (typeof value !== 'string' || !Object.values(AccountType).includes(value.split('-')[0].toLowerCase() as AccountType)) return undefined;
    const reference = parseAccountReference(value).reference;
    return references.has(reference) ? reference : undefined;
}

// JSON object key order does not distinguish records. Array order and all field
// values (including custom metadata) do, and are compared before migration.
// Undefined object properties are absent from the serialized JSON record.
function sameTransactionData(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
        || Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
    const keys = Object.keys(left).filter(key => (left as Record<string, unknown>)[key] !== undefined);
    const rightKeys = Object.keys(right).filter(key => (right as Record<string, unknown>)[key] !== undefined);
    return keys.length === rightKeys.length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key)
        && sameTransactionData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function collectTransactionErrors(value: unknown, existing: Transaction[], accounts?: Account[], repairDuplicateIds = false, allowSelfTransfers = false): TransactionValidationIssue[] {
    if (!Array.isArray(value)) return [{ index: null, field: 'transactions', reason: 'expected an array' }];
    const errors: TransactionValidationIssue[] = [];
    const existingIds = new Set(existing.map(transaction => transaction.id));
    const ids = new Set(existingIds);
    const recordsById = new Map<string, { record: unknown; location: string }[]>();
    existing.forEach((record, index) => {
        const records = recordsById.get(record.id) || [];
        records.push({ record: { ...record, legacyId: undefined, notes: record.notes?.trim() ? record.notes : undefined }, location: `existing transactions[${index}]` });
        recordsById.set(record.id, records);
    });
    const references = new Set(accounts?.map(account => formatAccountReference(account.type, account.name)));
    const defaultAccount = accounts?.find(account => account.isDefault) || accounts?.[0];
    const defaultReference = defaultAccount && formatAccountReference(defaultAccount.type, defaultAccount.name);
    value.forEach((entry: unknown, index: number) => {
        const invalid = (field: string, reason: string, action?: string): void => { errors.push({ index, field, reason, action }); };
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            invalid('record', 'expected a transaction object');
            return;
        }
        const row = entry as Record<string, unknown>;
        for (const field of ['id', 'date', 'type', 'description']) {
            if (typeof row[field] !== 'string' || !(row[field] as string).trim()) invalid(field, 'expected a non-empty string');
        }
        let comparableAmount = row.amount;
        if (typeof row.amount === 'string') {
            if (row.amount !== row.amount.trim() || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row.amount)) {
                invalid('amount', 'expected a nonnegative decimal string without leading zeros, signs, spaces, separators, or exponents');
            } else {
                const amount = Number(row.amount);
                if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER) {
                    invalid('amount', `decimal amount is outside the supported range (0 to ${Number.MAX_SAFE_INTEGER})`);
                } else {
                    // Compare decimal representations without rounding to currency units.
                    // Small numbers use exponent notation in Number.toString().
                    let decimal = amount.toString();
                    if (decimal.includes('e-')) {
                        const [digits, exponent] = decimal.split('e-');
                        decimal = `0.${'0'.repeat(Number(exponent) - 1)}${digits.replace('.', '')}`;
                    }
                    const original = row.amount.includes('.') ? row.amount.replace(/0+$/, '').replace(/\.$/, '') : row.amount;
                    if (original !== decimal) invalid('amount', 'decimal amount would lose precision when converted to a number');
                    else comparableAmount = amount;
                }
            }
        } else if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0) {
            invalid('amount', 'amount must be a finite nonnegative number or a plain decimal string');
        }
        const validType = [TransactionType.EXPENSE, TransactionType.INCOME, TransactionType.INTERNAL].includes(row.type as TransactionType);
        if (typeof row.type === 'string' && row.type.trim() && !validType) invalid('type', 'unsupported transaction type; use expense, income, or internal');
        if (typeof row.date === 'string' && row.date.trim() && !validDate(row.date)) invalid('date', 'invalid calendar date or timestamp');
        for (const field of ['category', 'time', 'notes', 'account', 'fromAccount', 'toAccount']) {
            if (row[field] != null && typeof row[field] !== 'string') invalid(field, 'expected a string');
        }
        if (typeof row.time === 'string' && row.time && getTimeInSeconds(row.time) === null) invalid('time', 'time must be HH:mm:ss, from 00:00:00 to 23:59:59');
        if (row.type === TransactionType.INTERNAL) {
            for (const field of ['fromAccount', 'toAccount']) {
                if (row[field] == null || (typeof row[field] === 'string' && !(row[field] as string).trim())) invalid(field, 'transfer accounts are required');
            }
            if (!allowSelfTransfers && isSelfTransfer(row as unknown as Transaction)) invalid('toAccount', 'transfer accounts must differ');
        }
        if (typeof row.id === 'string' && row.id.trim()) {
            const records = recordsById.get(row.id) || [];
            const comparable = { ...row, amount: comparableAmount, legacyId: undefined,
                notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes : undefined };
            const identical = records.find(({ record }) => sameTransactionData(record, comparable));
            if (identical) {
                invalid('id', `duplicate transaction ID "${row.id}" with identical data in ${identical.location} and transactions[${index}]`,
                    'Review both records; remove an unintended copy or correct its data, then Retry.');
            } else if (ids.has(row.id) && (!repairDuplicateIds || existingIds.has(row.id) || !records.length)) {
                invalid('id', `duplicate transaction ID "${row.id}"`);
            }
            ids.add(row.id);
            records.push({ record: comparable, location: `transactions[${index}]` });
            recordsById.set(row.id, records);
        }
        if (accounts && validType) {
            const fields = row.type === TransactionType.INTERNAL ? ['fromAccount', 'toAccount'] : ['account'];
            for (const field of fields) {
                const reference = row[field];
                // Already reported field types and missing transfer endpoints need no second error.
                if (reference != null && typeof reference !== 'string') continue;
                if (row.type === TransactionType.INTERNAL && !(reference as string | undefined)?.trim()) continue;
                const account = resolveAccountReference(reference, references, field === 'account' ? defaultReference : undefined);
                if (!account) {
                    const raw = typeof reference === 'string' ? reference : '';
                    const key = Object.values(AccountType).includes(raw.split('-')[0].toLowerCase() as AccountType)
                        ? parseAccountReference(raw).reference : raw;
                    errors.push({ index, field, reason: `unresolved ${field} "${reference || '(missing)'}"`,
                        action: 'Restore the account or correct its reference, then Retry.', accountReference: key });
                }
            }
        }
    });
    return errors;
}

export function validateTransactions(value: unknown, existing: Transaction[], accounts?: Account[], repairDuplicateIds = false, allowSelfTransfers = false): asserts value is (Omit<Transaction, 'amount'> & { amount: number | string })[] {
    const errors = collectTransactionErrors(value, existing, accounts, repairDuplicateIds, allowSelfTransfers);
    if (errors.length) rejectInvalidTransactions(errors);
}

function normalizeTransactionAccounts(transactions: Transaction[], accounts: Account[]): Transaction[] {
    const references = new Set(accounts.map(account => formatAccountReference(account.type, account.name)));
    const defaultAccount = accounts.find(account => account.isDefault) || accounts[0];
    const defaultReference = defaultAccount && formatAccountReference(defaultAccount.type, defaultAccount.name);
    // Reference validation completed for the entire batch before normalization begins.
    return transactions.map(transaction => {
        if (transaction.type !== TransactionType.INTERNAL) {
            return { ...transaction, account: resolveAccountReference(transaction.account, references, defaultReference) };
        }
        const fromAccount = resolveAccountReference(transaction.fromAccount, references);
        const toAccount = resolveAccountReference(transaction.toAccount, references);
        return { ...transaction, fromAccount, toAccount };
    });
}

export interface TransactionCorrections {
    legacyArrayFormatConverted: number;
    legacyIdsRegenerated: number;
    alienIdsRegenerated: number;
    duplicateIdsRegenerated: number;
    timestampsRecovered: number;
    timestampsGenerated: number;
    accountsAssigned: number;
    accountReferencesLinked: number;
    accountReferencesFormatted: number;
    categoriesAssigned: number;
    fieldOrderCorrected: number;
    amountsConvertedFromStrings: number;
}

export function formatTransactionCorrections(corrections: TransactionCorrections): string[] {
    return [
        ['Legacy array format converted', corrections.legacyArrayFormatConverted],
        ['Base36 legacy IDs regenerated', corrections.legacyIdsRegenerated],
        ['Alien IDs regenerated', corrections.alienIdsRegenerated],
        ['Duplicate IDs regenerated', corrections.duplicateIdsRegenerated],
        ['Time stamps recovered from IDs', corrections.timestampsRecovered],
        ['Time stamps generated', corrections.timestampsGenerated],
        ['Amounts converted from strings', corrections.amountsConvertedFromStrings],
        ['Accounts assigned', corrections.accountsAssigned],
        ['Account references linked', corrections.accountReferencesLinked],
        ['Account references formatted', corrections.accountReferencesFormatted],
        ['Categories assigned', corrections.categoriesAssigned],
        ['Field order corrected', corrections.fieldOrderCorrected]
    ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label}: ${count}`);
}

// Only existing-ledger loading/reconciliation opts in to retaining historical self-transfers.
export function prepareTransactions(value: unknown, existing: Transaction[], now = new Date(), accounts?: Account[], repairDuplicateIds = false, categories?: Category[], allowSelfTransfers = false): {
    transactions: Transaction[]; changed: number; corrections: TransactionCorrections;
} {
    validateTransactions(value, existing, accounts, repairDuplicateIds, allowSelfTransfers);
    let amountsConverted = 0;
    // All rows passed validation before copying or converting any amount.
    const numericTransactions = value.map(transaction => {
        if (typeof transaction.amount === 'string') amountsConverted++;
        return { ...transaction, amount: typeof transaction.amount === 'string' ? Number(transaction.amount) : transaction.amount };
    });
    const normalized = accounts ? normalizeTransactionAccounts(numericTransactions, accounts) : numericTransactions;
    // Reserve all source IDs before allocating replacements, including later rows.
    const ids = new Set([...existing, ...value].map(transaction => transaction.id));
    const uniqueId = (date: Date): string => {
        let id = generateId(date);
        // Increment the suffix on collisions; even a repeated RNG result must terminate.
        const prefix = id.slice(0, -8);
        let suffix = parseInt(id.slice(-8), 36);
        while (ids.has(id)) {
            suffix = (suffix + 1) % Math.pow(36, 8);
            id = prefix + suffix.toString(36).padStart(8, '0');
        }
        ids.add(id);
        return id;
    };
    const seenIds = new Set<string>();
    const fallbackTime = formatTime(now);
    const corrections: TransactionCorrections = {
        legacyArrayFormatConverted: 0,
        legacyIdsRegenerated: 0, alienIdsRegenerated: 0, duplicateIdsRegenerated: 0, timestampsRecovered: 0, timestampsGenerated: 0,
        accountsAssigned: 0, accountReferencesLinked: 0, accountReferencesFormatted: 0, categoriesAssigned: 0, fieldOrderCorrected: 0,
        amountsConvertedFromStrings: amountsConverted
    };
    const transactions = normalized.map((transaction, index) => {
        const row: Transaction & { legacyId?: unknown } = { ...transaction, description: transaction.description.toUpperCase(),
            category: transaction.category?.trim() ? transaction.category : transaction.type === TransactionType.INCOME ? 'other_income'
                : transaction.type === TransactionType.INTERNAL ? 'internal' : 'other_expense' };
        if (categories && transaction.type !== TransactionType.INTERNAL
            && !categories.some(category => category.id === row.category && category.type === getCategoryTypeForTransactionType(transaction.type))) {
            row.category = getDefaultTransactionCategory(transaction.type, categories);
        }
        if (!row.notes?.trim()) delete row.notes;
        delete row.legacyId;
        if (row.category !== value[index].category) corrections.categoriesAssigned++;
        for (const field of ['account', 'fromAccount', 'toAccount'] as const) {
            if (row[field] !== value[index][field]) {
                if (!value[index][field]) corrections.accountsAssigned++;
                else corrections.accountReferencesFormatted++;
            }
        }
        const duplicate = seenIds.has(row.id);
        seenIds.add(row.id);
        const missingTime = !row.time;
        const current = row.id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[a-z0-9]{8}$/);
        const currentTime = current ? `${current[4]}:${current[5]}:${current[6]}` : null;
        const validCurrent = current !== null && currentTime !== null && validDate(`${current[1]}-${current[2]}-${current[3]}`)
            && getTimeInSeconds(currentTime) !== null;
        // Historical IDs used an eight-character base36 epoch and up to five random
        // characters. The epoch width was eight throughout this generator's history.
        const legacy = row.id.match(/^([1-9a-z][a-z0-9]{7})[a-z0-9]{1,5}$/);
        const epoch = legacy ? parseInt(legacy[1], 36) : NaN;
        const legacyDate = legacy && Number.isSafeInteger(epoch) && epoch <= now.getTime()
            && epoch.toString(36) === legacy[1] ? new Date(epoch) : null;
        if (missingTime) {
            row.time = validCurrent ? currentTime : legacyDate ? formatTime(legacyDate) : fallbackTime;
            if (validCurrent || legacyDate) corrections.timestampsRecovered++;
            else corrections.timestampsGenerated++;
        }
        // Every non-current ID needs upgrading; recognizing a historical epoch
        // determines time recovery, not whether the record should be migrated.
        const upgradeId = !validCurrent;
        if (upgradeId || duplicate) {
            row.id = uniqueId(legacyDate || now);
            // ID categories are disjoint: a repeated legacy/alien ID is counted
            // once as a duplicate, rather than counted as two regenerated IDs.
            if (duplicate) corrections.duplicateIdsRegenerated++;
            else if (legacyDate) corrections.legacyIdsRegenerated++;
            else corrections.alienIdsRegenerated++;
        }
        const fields = Object.keys(row);
        if (!missingTime && fields.indexOf('time') === fields.indexOf('date') + 1) return row;
        if (!missingTime) corrections.fieldOrderCorrected++;
        // Preserve all field values and their relative order, placing time after date.
        const ordered: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const [field, value] of Object.entries(row)) {
            if (field === 'time') continue;
            ordered[field] = value;
            if (field === 'date') ordered.time = row.time;
        }
        return ordered as unknown as Transaction;
    });
    validateTransactions(transactions, existing, accounts, false, allowSelfTransfers);
    return {
        transactions,
        corrections,
        changed: transactions.filter((transaction, index) => JSON.stringify(transaction) !== JSON.stringify(value[index])).length
    };
}
