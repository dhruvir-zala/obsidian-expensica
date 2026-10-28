import { App, FileSystemAdapter, Modal, Platform, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem, TextComponent } from 'obsidian';

import { AccountEditorModal, ExpensicaDashboardView, EXPENSICA_VIEW_TYPE, TransactionModal, DateRangeType, DashboardTab } from './src/dashboard-view';
import { ExpensicaTransactionsView } from './src/transactions-view';
import type { TransactionNavigationFilter } from './src/transactions-view';

import {
    Transaction,
    TransactionType,
    generateId,
    formatDate,
    parseLocalDate,
    Category,
    CategoryEmojiSettings,
    CategoryType,
    COMMON_CURRENCIES,
    DEFAULT_CATEGORIES,
    DEFAULT_CATEGORY_EMOJIS,
    getCurrencyByCode,
    getCategoryColor,
    ColorScheme,
    Budget,
    BudgetData,
    DEFAULT_BUDGET_DATA,
    Account,
    AccountType,
    DEFAULT_ACCOUNT,
    DEFAULT_ACCOUNT_ID,
    TransactionAggregator,
    formatCurrency,
    getBudgetRolloverStartDate,
    sortTransactionsByDateTimeDesc,
    compareAccounts,
    formatAccountReference,
    getAccountColor,
    getAccountEmoji,
    getAccountTypeLabel,
    normalizeAccountName,
    normalizePaletteColor,
    parseAccountReference,
    getCategoryTypeForTransactionType,
    getDefaultTransactionCategory,
    isSelfTransfer,
    INTERNAL_CATEGORY_ID
} from './src/models';

import { ExportModal } from './src/export-modal';
import { ConfirmationModal as ExpensicaConfirmationModal } from './src/confirmation-modal';
import { showExpensicaNotice } from './src/notice';
import { DataRecoveryModal } from './src/data-recovery-modal';
import { formatTransactionCorrections, parseTransactionFile, parseTransactionImport, prepareTransactions, TransactionCorrections, TransactionValidationError, validateTransactions } from './src/transaction-import';
import { preventBackdropDismissal, voidAsync } from './src/modal-utils';
import { renderCreateAccountCard } from './src/account-card';

interface TransactionImportSource {
    name: string;
    text(): Promise<string>;
}

interface NativeFileDialog {
    showOpenDialog(options: {
        defaultPath: string;
        filters: { name: string; extensions: string[] }[];
        properties: string[];
    }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

function isNativeFileDialog(value: unknown): value is NativeFileDialog {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.showOpenDialog === 'function';
}

function getNativeFileDialog(module: unknown): NativeFileDialog | undefined {
    if (typeof module !== 'object' || module === null) return undefined;
    const exported = module as Record<string, unknown>;
    if (isNativeFileDialog(exported.dialog)) return exported.dialog;
    if (typeof exported.remote === 'object' && exported.remote !== null) {
        const remote = exported.remote as Record<string, unknown>;
        if (isNativeFileDialog(remote.dialog)) return remote.dialog;
    }
    return undefined;
}

async function importOptionalModule(moduleName: string): Promise<unknown> {
    const imported: unknown = await import(moduleName);
    return imported;
}

// Import visualizations for bundling
import './src/dashboard-integration';
import './src/visualizations/calendar-view';

// Import jsPDF for global availability
import { jsPDF } from 'jspdf';

function formatTransactionDescriptionForBanking(description: string): string {
    return description.trim().replace(/\s+/g, ' ').toUpperCase();
}

function createChevronIcon(parent: HTMLElement, size: number): void {
    const svg = parent.createSvg('svg', {
        attr: {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }
    });
    svg.createSvg('polyline', { attr: { points: '6 9 12 15 18 9' } });
}

function createWarningIcon(parent: HTMLElement): void {
    const svg = parent.createSvg('svg', {
        attr: {
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }
    });
    svg.createSvg('circle', { attr: { cx: '12', cy: '12', r: '10' } });
    svg.createSvg('path', { attr: { d: 'M12 8v4m0 4h.01' } });
}

// Define the global window interface to include jspdf
declare global {
    interface Window {
        jspdf: {
            jsPDF: typeof jsPDF;
        };
    }
}

// Define the settings interface for our plugin
interface ExpensicaSettings {
    defaultCurrency: string;
    timeFormat: '12' | '24';
    categories: Category[];
    deletedDefaultCategoryIds: string[];
    categoryEmojis: CategoryEmojiSettings;
    categoryColors: Record<string, string>;
    calendarColorScheme: ColorScheme;
    customCalendarColor: string;
    showWeekNumbers: boolean;
    showChartAxes: boolean;
    showChartGrid: boolean;
    showTransactionCategoryLabels: boolean;
    enableAccounts: boolean;
    lastTransactionSelection: Partial<Pick<Transaction, 'type' | 'category'>> & { accountId?: string };
    enableBudgeting: boolean;
    enableDailyFinanceReview: boolean;
    enableDailyFinanceReviewForAnyDate: boolean;
    dailyReviewFolder: string;
    sharedDateRangeState: SharedDateRangeState | null;
}

type LegacyCategory = Category & { emoji?: string };

const LEADING_CATEGORY_EMOJI_PATTERN = /^([\p{Extended_Pictographic}\uFE0F\u200D]+)\s+/u;
const INTERNAL_CATEGORY_NAME = DEFAULT_CATEGORIES.find(category => category.id === INTERNAL_CATEGORY_ID)?.name || 'Internal';
const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map(category => category.id));
const LEGACY_UNKNOWN_CATEGORY_IDS = new Set(['unknown', 'unknown_category', 'unknown category']);

// Define a separate interface for our transactions data
interface TransactionsData {
    transactions: Transaction[];
    accounts: Account[];
    lastUpdated: string; // ISO timestamp
}

interface AccountsData {
    accounts: Account[];
    lastUpdated: string; // ISO timestamp
}

type ProtectedDataset = 'transactions' | 'accounts' | 'budgets';
interface SaveFailure {
    operation: string;
    error: string;
    path: string;
    write: boolean;
    retry: (() => Promise<boolean>) | null;
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Check the structure before normalization can discard or replace any records.
// Missing legacy optional fields are still handled by the existing normalizers.
function validateLoadedData<T extends ProtectedDataset>(data: unknown, dataset: T, repairDuplicateIds = false): asserts data is Record<T, unknown[]> {
    if (!isDataRecord(data) || !Array.isArray(data[dataset])) {
        throw new Error(`Invalid ${dataset} data: expected a ${dataset} array`);
    }
    const optionalString = (value: unknown) => value == null || typeof value === 'string';
    if (!optionalString(data.lastUpdated)) {
        throw new Error(`Invalid ${dataset} timestamp`);
    }
    const entries = data[dataset];
    if (!Array.isArray(entries)) throw new Error(`Invalid ${dataset} data: expected a ${dataset} array`);
    if (dataset === 'transactions') {
        // Historical self-transfers remain readable; mutation/import paths reject new ones.
        validateTransactions(entries, [], undefined, repairDuplicateIds, true);
        return;
    }
    const valid = entries.every(entry => {
        if (!isDataRecord(entry)) return false;
        if (dataset === 'accounts') {
            return typeof entry.name === 'string'
                && ['id', 'type', 'createdAt', 'color'].every(key => optionalString(entry[key]))
                && (entry.creditLimit == null || (typeof entry.creditLimit === 'number' && Number.isFinite(entry.creditLimit)))
                && (entry.isDefault == null || typeof entry.isDefault === 'boolean');
        }
        if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount)) return false;
        return ['id', 'categoryId', 'period'].every(key => typeof entry[key] === 'string')
            && optionalString(entry.lastUpdated)
            && (entry.rollover == null || typeof entry.rollover === 'boolean')
            && (entry.rolloverStartDate == null || (typeof entry.rolloverStartDate === 'string'
                && getBudgetRolloverStartDate(entry as unknown as Budget) !== null));
    });
    if (!valid) throw new Error(`Invalid ${dataset} record`);
}

export interface SharedDateRangeState {
    type: DateRangeType;
    startDate: string;
    endDate: string;
    customStartDate: string | null;
    customEndDate: string | null;
    updatedAt: number;
}

function getSharedDateRangeApplier(view: unknown): ((state: SharedDateRangeState) => Promise<void>) | undefined {
    if (view === null || typeof view !== 'object') return undefined;
    const applier: unknown = Reflect.get(view, 'applySharedDateRangeState');
    if (typeof applier !== 'function') return undefined;
    return (state: SharedDateRangeState) => Promise.resolve(Reflect.apply(applier, view, [state]) as unknown).then(() => undefined);
}

// Define default settings
const DEFAULT_SETTINGS: ExpensicaSettings = {
    defaultCurrency: 'USD',
    timeFormat: '12',
    categories: DEFAULT_CATEGORIES,
    deletedDefaultCategoryIds: [],
    categoryEmojis: {},
    categoryColors: {},
    calendarColorScheme: ColorScheme.BLUE,
    customCalendarColor: '#2196f3',
    showWeekNumbers: false,
    showChartAxes: false,
    showChartGrid: false,
    showTransactionCategoryLabels: true,
    enableAccounts: true,
    lastTransactionSelection: {},
    enableBudgeting: true,
    enableDailyFinanceReview: true,
    enableDailyFinanceReviewForAnyDate: true,
    dailyReviewFolder: '',
    sharedDateRangeState: null
};

// Default transactions data
const DEFAULT_TRANSACTIONS_DATA: TransactionsData = {
    transactions: [],
    accounts: [DEFAULT_ACCOUNT],
    lastUpdated: new Date().toISOString()
};

const DEFAULT_ACCOUNTS_DATA: AccountsData = {
    accounts: [DEFAULT_ACCOUNT],
    lastUpdated: new Date().toISOString()
};

// Define the main plugin class
export default class ExpensicaPlugin extends Plugin {
    settings: ExpensicaSettings;
    transactionsData: TransactionsData = {
        transactions: [], accounts: [{ ...DEFAULT_ACCOUNT }], lastUpdated: new Date().toISOString()
    };
    budgetData: BudgetData = { budgets: [], lastUpdated: new Date().toISOString() };
    dataFolderPath = 'expensica-data';
    transactionsFilePath = 'expensica-data/transactions.json';
    accountsFilePath = 'expensica-data/accounts.json';
    budgetFilePath = 'expensica-data/budgets.json';
    settingTab: ExpensicaSettingTab | null = null;
    private dashboardTransactionsViews = new WeakMap<ExpensicaDashboardView, ExpensicaTransactionsView>();
    private protectedDatasets = new Set<ProtectedDataset>();
    private loadFailureMessages = new Map<ProtectedDataset, string>();
    private missingAccountError: TransactionValidationError | null = null;
    private dataRecoveryModal: DataRecoveryModal | null = null;
    private retryingDataRecovery = false;
    private dataRecoveryRetry: Promise<boolean> | null = null;
    private pendingAccountRollback: string | null = null;
    private saveErrors = new WeakMap<object, { path: string; write: boolean }>();
    private saveFailures = new Map<object, SaveFailure>();
    private savingOwners = new Set<object>();
    private retryingSaveOwners = new Set<object>();
    private closedSaveOwners = new WeakSet<object>();
    private saveRecoveryModal: DataRecoveryModal | null = null;
    private activeSaveOwner: object | null = null;
    private pendingRecoveryDialog = false;
    private pendingTransactionSummaries: { summary: string; corrections: TransactionCorrections }[] = [];
    private unloaded = false;
    private persistenceTail: Promise<void> = Promise.resolve();

    private runAsyncAction(action: () => Promise<unknown>): void {
        void action().catch(() => {
            showExpensicaNotice('Expensica could not complete that action.');
        });
    }

    private enqueuePersistence<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.persistenceTail.then(operation);
        this.persistenceTail = result.then(() => undefined, () => undefined);
        return result;
    }

    async onload() {
        await this.loadSettings();

        // Create data folder if it doesn't exist
        await this.ensureDataFolder();

        // Load account definitions before normalizing transaction references.
        await this.loadAccountsData();
        await this.loadTransactionsData();
        
        // Load budget data
        await this.loadBudgetData();
        
        // Make jsPDF globally available
        try {
            window.jspdf = { jsPDF };
        } catch {
            showExpensicaNotice('Could not initialize PDF export.');
        }

        // Add a ribbon icon for quick access
        const ribbonIconEl = this.addRibbonIcon('dollar-sign', 'Expensica', () => {
            // Open the Expensica dashboard
            this.runAsyncAction(() => this.openDashboard());
        });
        ribbonIconEl.addClass('expensica-ribbon-icon');

        // Add a command for quick expense entry
        this.addCommand({
            id: 'add-expense',
            name: 'Add New Expense',
            callback: () => {
                this.runAsyncAction(() => this.openExpenseModal());
            }
        });

        // Add a command for quick income entry
        this.addCommand({
            id: 'add-income',
            name: 'Add New Income',
            callback: () => {
                this.runAsyncAction(() => this.openIncomeModal());
            }
        });

        // Add a command to open the dashboard
        this.addCommand({
            id: 'open-dashboard',
            name: 'Open Dashboard',
            callback: () => {
                this.runAsyncAction(() => this.openDashboard());
            }
        });

        // Add a command to open the transactions view
        this.addCommand({
            id: 'open-transactions',
            name: 'View All Transactions',
            callback: () => {
                this.runAsyncAction(() => this.openTransactionsView());
            }
        });

        // Add a command to open the budget view
        this.addCommand({
            id: 'open-budget',
            name: 'Open Budget',
            callback: () => {
                this.runAsyncAction(() => this.openBudgetView());
            }
        });

        // Add a command to export transactions
        this.addCommand({
            id: 'export-transactions',
            name: 'Export Transactions',
            callback: () => {
                this.openExportModal();
            }
        });

        // Add a command to create a note with today's transactions
        this.addCommand({
            id: 'create-todays-transactions-note',
            name: 'Create Daily Finance Review (For Today)',
            callback: () => {
                if (!this.settings.enableDailyFinanceReview) {
                    showExpensicaNotice('Daily Finance Review feature is disabled. Please enable it in settings.');
                    return;
                }
                this.runAsyncAction(() => this.createDailyFinanceReview());
            }
        });

        // Add a command to create/update a daily review note for any date
        this.addCommand({
            id: 'create-daily-review-for-date',
            name: 'Create/Update Daily Finance Review for Any Date',
            callback: () => {
                if (!this.settings.enableDailyFinanceReviewForAnyDate) {
                    showExpensicaNotice('Daily Finance Review for Any Date feature is disabled. Please enable it in settings.');
                    return;
                }
                this.runAsyncAction(() => this.createDailyFinanceReviewForDate());
            }
        });

        // Register the view type for our dashboard
        this.registerView(
            EXPENSICA_VIEW_TYPE,
            (leaf) => new ExpensicaDashboardView(leaf, this)
        );

        // Add settings tab
        this.settingTab = new ExpensicaSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);

        const showPendingDialogs = () => this.showPendingDataDialogs();
        this.registerEvent(this.app.workspace.on('active-leaf-change', showPendingDialogs));
        this.registerDomEvent(window, 'focus', showPendingDialogs);
        this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => {
            this.registerDomEvent(win, 'focus', showPendingDialogs);
        }));
        this.app.workspace.onLayoutReady(showPendingDialogs);
    }

    async ensureDataFolder() {
        const folderExists = await this.app.vault.adapter.exists(this.dataFolderPath);
        if (!folderExists) {
            await this.app.vault.createFolder(this.dataFolderPath);
        }
    }

    loadTransactionsData() {
        return this.enqueuePersistence(() => this.readTransactionsData());
    }

    private async readTransactionsData() {
        const previousData = this.transactionsData;
        try {
            const fileExists = await this.app.vault.adapter.exists(this.transactionsFilePath);
            if (!fileExists) {
                this.transactionsData = {
                    ...DEFAULT_TRANSACTIONS_DATA,
                    transactions: [],
                    accounts: this.transactionsData.accounts
                };
                this.clearDatasetProtection('transactions');
                await this.writeTransactionsData();
                return;
            }

            // Read the file content
            const fileContent = await this.app.vault.adapter.read(this.transactionsFilePath);

            // Parse the JSON content
            const { data, legacyArray } = parseTransactionFile(fileContent, [], undefined, !this.protectedDatasets.has('accounts'));
            const parsedData = data as Partial<TransactionsData>;
            validateLoadedData(parsedData, 'transactions', !this.protectedDatasets.has('accounts'));
            if (this.pendingAccountRollback !== null) return;
            const nextData = {
                ...parsedData,
                transactions: parsedData.transactions as Transaction[],
                accounts: previousData.accounts,
                lastUpdated: parsedData.lastUpdated || new Date().toISOString()
            };
            // Keep P0's safe metadata edits available while accounts are protected.
            // Defer all account-dependent migrations until those definitions recover.
            if (this.protectedDatasets.has('accounts')) {
                if (legacyArray) {
                    throw new TransactionValidationError(null, 'transactions', 'legacy array migration is waiting for valid accounts',
                        'Restore the account file, then Retry.');
                }
                const stringAmountIndex = nextData.transactions.findIndex(transaction => typeof transaction.amount === 'string');
                if (stringAmountIndex !== -1) {
                    throw new TransactionValidationError(stringAmountIndex, 'amount', 'amount conversion is waiting for valid accounts',
                        'Restore the account file, then Retry.');
                }
                this.transactionsData = nextData;
                this.clearDatasetProtection('transactions');
                return;
            }
            const prepared = prepareTransactions(nextData.transactions, [], new Date(), nextData.accounts, true, this.settings.categories, true);
            prepared.corrections.legacyArrayFormatConverted = Number(legacyArray);
            this.resolveSaveFailures(this.transactionsFilePath, false);
            this.clearDatasetProtection('transactions');
            if (prepared.changed || legacyArray) {
                await this.writeTransactionsData({ ...nextData, transactions: prepared.transactions }, false);
                if (Object.values(prepared.corrections).some(count => count > 0)) {
                    this.showTransactionSummary('Existing transaction details were preserved. Changes saved.', prepared.corrections);
                }
            } else {
                this.transactionsData = nextData;
            }

        } catch (error) {
            this.transactionsData = previousData;
            this.protectDataset('transactions', error);
        }
    }

    saveTransactionsData(data?: TransactionsData) {
        const snapshot = data?.transactions.map(entry => ({ ...entry }));
        return this.enqueuePersistence(() => this.writeTransactionsData({
            ...this.transactionsData, transactions: snapshot ?? this.transactionsData.transactions
        }));
    }

    private async writeTransactionsData(data: TransactionsData = this.transactionsData, normalize = true, reconciled = false) {
        if (!reconciled && this.isDatasetProtected('transactions')) throw new Error('Transaction data is protected');
        try {
            const snapshot = { ...data, accounts: this.transactionsData.accounts,
                transactions: data.transactions.map(transaction => {
                    if (!('legacyId' in transaction) && (!('notes' in transaction) || transaction.notes?.trim())) return transaction;
                    const normalized: Transaction & { legacyId?: unknown } = { ...transaction };
                    if (!normalized.notes?.trim()) delete normalized.notes;
                    delete normalized.legacyId;
                    return normalized;
                }) };
            const nextData = !normalize || this.protectedDatasets.has('accounts') ? snapshot : this.normalizeTransactionsSnapshot(snapshot);
            nextData.lastUpdated = new Date().toISOString();
            const persistedData = { ...nextData } as Partial<TransactionsData>;
            delete persistedData.accounts; // Account definitions live in their own file.
            await this.app.vault.adapter.write(
                this.transactionsFilePath,
                JSON.stringify(persistedData, null, 2)
            );
            this.transactionsData = nextData;
            this.resolveSaveFailures(this.transactionsFilePath);
        } catch (error) {
            throw this.markSaveError(error, this.transactionsFilePath);
        }
    }

    loadAccountsData() {
        return this.enqueuePersistence(() => this.readAccountsData());
    }

    private async readAccountsData() {
        const previousData = this.transactionsData;
        try {
            const fileExists = await this.app.vault.adapter.exists(this.accountsFilePath);
            if (!fileExists) {
                this.transactionsData = { ...previousData, accounts: DEFAULT_ACCOUNTS_DATA.accounts.map(account => ({ ...account })) };
                this.normalizeTransactionsData(false);
                this.clearDatasetProtection('accounts');
                await this.writeAccountsData();
                return;
            }

            const fileContent = await this.app.vault.adapter.read(this.accountsFilePath);
            const parsedData = JSON.parse(fileContent) as Partial<AccountsData>;
            validateLoadedData(parsedData, 'accounts');
            this.resolveSaveFailures(this.accountsFilePath, false);
            if (this.pendingAccountRollback !== null) return;
            this.transactionsData = this.normalizeTransactionsSnapshot({ ...previousData, accounts: parsedData.accounts }, false);
            this.clearDatasetProtection('accounts');

        } catch (error) {
            this.transactionsData = previousData;
            this.protectDataset('accounts', error);
        }
    }

    saveAccountsData(data?: TransactionsData) {
        const snapshot = data?.accounts.map(entry => ({ ...entry }));
        return this.enqueuePersistence(() => this.writeAccountsData({
            ...this.transactionsData, accounts: snapshot ?? this.transactionsData.accounts
        }));
    }

    private async writeAccountsData(data: TransactionsData = this.transactionsData) {
        if (this.isDatasetProtected('accounts')) throw new Error('Account data is protected');
        try {
            const nextData = this.normalizeTransactionsSnapshot({ ...this.transactionsData, accounts: data.accounts }, false);
            const accountsData: AccountsData = {
                accounts: nextData.accounts,
                lastUpdated: new Date().toISOString()
            };
            await this.app.vault.adapter.write(
                this.accountsFilePath,
                JSON.stringify(accountsData, null, 2)
            );
            this.transactionsData = nextData;
            this.resolveSaveFailures(this.accountsFilePath);
        } catch (error) {
            throw this.markSaveError(error, this.accountsFilePath);
        }
    }

    loadBudgetData() {
        return this.enqueuePersistence(() => this.readBudgetData());
    }

    private async readBudgetData() {
        const previousData = this.budgetData;
        try {
            const fileExists = await this.app.vault.adapter.exists(this.budgetFilePath);
            if (!fileExists) {
                // If file doesn't exist, initialize with default data
                this.budgetData = { ...DEFAULT_BUDGET_DATA, budgets: [] };
                this.clearDatasetProtection('budgets');
                await this.writeBudgetData();
                return;
            }

            // Read the file content
            const fileContent = await this.app.vault.adapter.read(this.budgetFilePath);

            // Parse the JSON content
            const parsedData = JSON.parse(fileContent) as BudgetData;
            validateLoadedData(parsedData, 'budgets');
            this.resolveSaveFailures(this.budgetFilePath, false);
            this.budgetData = parsedData;

            if (!this.budgetData.lastUpdated) {
                this.budgetData.lastUpdated = new Date().toISOString();
            }
            this.clearDatasetProtection('budgets');

        } catch (error) {
            this.budgetData = previousData;
            this.protectDataset('budgets', error);
        }
    }

    saveBudgetData(data?: BudgetData) {
        const snapshot = data ? { ...data, budgets: data.budgets.map(entry => ({ ...entry })) } : undefined;
        return this.enqueuePersistence(() => this.writeBudgetData(snapshot ?? this.budgetData));
    }

    private async writeBudgetData(data: BudgetData = this.budgetData) {
        if (this.isDatasetProtected('budgets')) throw new Error('Budget data is protected');
        try {
            // Update the lastUpdated timestamp
            const nextData = { ...data, lastUpdated: new Date().toISOString() };

            // Convert to JSON
            const jsonData = JSON.stringify(nextData, null, 2);

            // Write to file
            await this.app.vault.adapter.write(this.budgetFilePath, jsonData);
            this.budgetData = nextData;
            this.resolveSaveFailures(this.budgetFilePath);

        } catch (error) {
            throw this.markSaveError(error, this.budgetFilePath);
        }
    }

    private markSaveError(error: unknown, path: string, write = true): Error {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.saveErrors.set(failure, { path, write });
        return failure;
    }

    private recoveryMessage(error: unknown): string {
        if (error instanceof TransactionValidationError) return `${error.message} ${error.action}`;
        const message = error instanceof Error ? error.message : String(error);
        if (/permission|denied|EACCES|EPERM|read.only/i.test(message)) {
            return 'Expensica cannot access the file. Check the vault folder permissions, then retry.';
        }
        if (/ENOSPC|disk.*full|no space/i.test(message)) {
            return 'There is not enough storage space. Free some space, then retry.';
        }
        if (/invalid|json|unexpected token|unexpected end/i.test(message)) {
            return 'The file contents are not valid. Restore a valid copy from a backup, then retry.';
        }
        return 'The file could not be accessed. Check that the vault is available and has free space, then retry.';
    }

    async runSaveOperation(owner: object, operation: string, action: () => Promise<void | boolean>): Promise<boolean> {
        if (this.savingOwners.has(owner)) return false;
        this.closedSaveOwners.delete(owner);
        this.savingOwners.add(owner);
        try {
            const result = await action();
            if (result === false) return false;
            return true;
        } catch (error) {
            if (error instanceof TransactionValidationError) {
                showExpensicaNotice(`${error.message} ${error.action}`);
                return false;
            }
            const failure = error && typeof error === 'object' ? this.saveErrors.get(error) : undefined;
            if (!failure) {
                // Protected datasets already use load recovery. Never retry an error
                // after a committed save (for example a failed view refresh).
                if (this.protectedDatasets.size > 0) return false;
                showExpensicaNotice(`${operation} could not finish. Your input has been kept. Check the saved data before trying again.`);
                return false;
            }
            this.saveFailures.set(owner, {
                operation, ...failure,
                error: this.recoveryMessage(error),
                retry: this.closedSaveOwners.has(owner) ? null : () => this.runSaveOperation(owner, operation, action)
            });
            this.refreshDataRecoveryWarnings();
            if (!this.closedSaveOwners.has(owner)) this.openSaveRecovery(owner);
            return false;
        } finally {
            this.savingOwners.delete(owner);
            this.refreshDataRecoveryWarnings();
        }
    }

    releaseSaveOperation(owner: object): void {
        this.closedSaveOwners.add(owner);
        const failure = this.saveFailures.get(owner);
        if (failure) failure.retry = null;
        if (this.activeSaveOwner === owner) {
            const modal = this.saveRecoveryModal;
            this.saveRecoveryModal = null;
            this.activeSaveOwner = null;
            modal?.close();
        }
        this.refreshDataRecoveryWarnings();
    }

    private resolveSaveFailures(path: string, writeVerified = true): void {
        let resolved = false;
        for (const [owner, failure] of this.saveFailures) {
            if (failure.path !== path || (failure.write && !writeVerified)) continue;
            this.saveFailures.delete(owner);
            resolved = true;
            if (this.activeSaveOwner === owner) {
                const modal = this.saveRecoveryModal;
                this.saveRecoveryModal = null;
                this.activeSaveOwner = null;
                modal?.close();
            }
        }
        if (resolved) this.refreshDataRecoveryWarnings();
    }

    hasSaveFailure(owner: object): boolean {
        return this.saveFailures.has(owner);
    }

    private isExpensicaFocused(): boolean {
        const { workspace } = this.app;
        const view = workspace.getActiveViewOfType?.(ExpensicaDashboardView);
        return !this.unloaded && workspace.layoutReady && !!view && view.getViewType() === EXPENSICA_VIEW_TYPE
            && (view.containerEl.ownerDocument?.hasFocus() ?? true);
    }

    private showPendingDataDialogs(): void {
        if (!this.isExpensicaFocused()) return;
        if (this.pendingRecoveryDialog) {
            this.pendingRecoveryDialog = false;
            if (this.protectedDatasets.size) this.openDataRecovery();
            else {
                const owner = this.saveFailures.keys().next().value;
                if (owner) this.openSaveRecovery(owner);
            }
        }
        if (this.dataRecoveryModal || this.saveRecoveryModal) return;
        for (const report of this.pendingTransactionSummaries.splice(0)) {
            this.showTransactionSummary(report.summary, report.corrections);
        }
    }

    private openSaveRecovery(owner: object): void {
        if (!this.saveFailures.has(owner) || this.dataRecoveryModal) return;
        if (!this.isExpensicaFocused()) {
            this.pendingRecoveryDialog = true;
            return;
        }
        this.pendingRecoveryDialog = false;
        if (this.saveRecoveryModal) {
            if (this.activeSaveOwner === owner) this.saveRecoveryModal.refresh();
            return;
        }
        this.activeSaveOwner = owner;
        this.saveRecoveryModal = new DataRecoveryModal(
            this.app, () => [],
            () => this.retrySaveRecovery(owner),
            () => { this.saveRecoveryModal = null; this.activeSaveOwner = null; this.showPendingDataDialogs(); },
            () => this.saveFailures.get(owner) || { operation: 'Save', path: '', error: '' }
        );
        this.saveRecoveryModal.open();
    }

    private async retrySaveRecovery(owner: object): Promise<boolean> {
        if (this.retryingSaveOwners.has(owner) || this.savingOwners.has(owner)) return false;
        const failure = this.saveFailures.get(owner);
        if (!failure) return true;
        this.retryingSaveOwners.add(owner);
        this.refreshDataRecoveryWarnings();
        try {
            // This confirmed action validates its protected source before writing.
            // Closed reconciliation dialogs must still never replay discarded choices.
            if (owner instanceof AccountReconciliationModal && failure.retry && !this.closedSaveOwners.has(owner)) return await failure.retry();
            await this.retryDataRecovery();
            if (Array.from(this.protectedDatasets).some(dataset => this.datasetPath(dataset) === failure.path)) return false;
            if (failure.retry && !this.closedSaveOwners.has(owner)) {
                const saved = await failure.retry();
                if (!saved || !this.saveFailures.has(owner)) return saved;
            }
            if (!this.saveFailures.has(owner)) return true;
            return await this.enqueuePersistence(async () => {
                if (!this.saveFailures.has(owner)) return true;
                if (Array.from(this.protectedDatasets).some(dataset => this.datasetPath(dataset) === failure.path)) return false;
                // A closed/discarded editor must never be replayed. Verify the file's
                // accessibility using its validated current contents, not the discarded draft.
                const content = await this.app.vault.adapter.read(failure.path);
                const dataset = (['transactions', 'accounts', 'budgets'] as const)
                    .find(name => this.datasetPath(name) === failure.path);
                try {
                    const parsed = dataset === 'transactions' ? parseTransactionFile(content).data : (JSON.parse(content) as unknown);
                    if (dataset) validateLoadedData(parsed, dataset);
                    else prepareTransactions(parseTransactionImport(content, this.transactionsData.transactions, this.transactionsData.accounts), this.transactionsData.transactions, new Date(), this.transactionsData.accounts);
                } catch (error) {
                    if (dataset) this.protectDataset(dataset, error);
                    throw error;
                }
                if (failure.write) await this.app.vault.adapter.write(failure.path, content);
                this.resolveSaveFailures(failure.path, failure.write);
                return true;
            });
        } catch (error) {
            failure.error = this.recoveryMessage(error);
            if (!this.saveFailures.has(owner)) this.saveFailures.set(owner, { ...failure, retry: null });
            return false;
        } finally {
            this.retryingSaveOwners.delete(owner);
            this.refreshDataRecoveryWarnings();
        }
    }

    private datasetPath(dataset: ProtectedDataset): string {
        return dataset === 'transactions' ? this.transactionsFilePath
            : dataset === 'accounts' ? this.accountsFilePath : this.budgetFilePath;
    }

    canEditData(datasets: ProtectedDataset[]): boolean {
        const blocked = datasets.find(dataset => this.protectedDatasets.has(dataset));
        if (!blocked) {
            // The error cards retain protection and recovery access while an unrelated editor is open.
            this.dataRecoveryModal?.close();
            return true;
        }
        this.openDataRecovery();
        return false;
    }

    isAccountDataProtected(): boolean {
        return this.protectedDatasets.has('accounts');
    }

    canSaveTransaction(transaction: Transaction): boolean {
        if (isSelfTransfer(transaction)) {
            throw new TransactionValidationError(null, 'toAccount', 'transfer accounts must differ');
        }
        if (!this.isAccountDataProtected()) return true;
        const previous = this.transactionsData.transactions.find(entry => entry.id === transaction.id);
        if (previous && previous.type === transaction.type
            && previous.account === transaction.account
            && previous.fromAccount === transaction.fromAccount
            && previous.toAccount === transaction.toAccount) {
            const references = previous.type === TransactionType.INTERNAL
                ? [previous.fromAccount, previous.toAccount] : [previous.account];
            if (previous.amount === transaction.amount || references.every(reference =>
                reference && parseAccountReference(reference).type !== AccountType.CREDIT)) return true;
        }
        this.openDataRecovery();
        return false;
    }

    private isDatasetProtected(dataset: ProtectedDataset): boolean {
        if (!this.protectedDatasets.has(dataset)) return false;
        showExpensicaNotice(`Saving ${dataset} is blocked until its data is successfully reloaded.`);
        this.protectDataset(dataset);
        return true;
    }

    private protectDataset(dataset: ProtectedDataset, error?: unknown): void {
        this.protectedDatasets.add(dataset);
        if (dataset === 'transactions' && error !== undefined) {
            this.missingAccountError = error instanceof TransactionValidationError && error.canReconcileAccounts ? error : null;
        }
        if (error !== undefined || !this.loadFailureMessages.has(dataset)) {
            this.loadFailureMessages.set(dataset, this.recoveryMessage(error));
        }
        this.refreshDataRecoveryWarnings();
        this.openDataRecovery();
    }

    private openDataRecovery(): void {
        if (!this.isExpensicaFocused()) {
            this.pendingRecoveryDialog = true;
            return;
        }
        this.pendingRecoveryDialog = false;
        const saveModal = this.saveRecoveryModal;
        this.saveRecoveryModal = null;
        this.activeSaveOwner = null;
        saveModal?.close();
        if (this.dataRecoveryModal) {
            this.dataRecoveryModal.refresh();
        } else if (!this.retryingDataRecovery) {
            this.dataRecoveryModal = new DataRecoveryModal(
                this.app,
                () => Array.from(this.protectedDatasets).map(name => ({
                    name,
                    path: this.datasetPath(name),
                    message: this.pendingAccountRollback !== null && name !== 'budgets'
                        ? 'The previous account data must be restored. Keep Expensica open and retry recovery before saving account or transaction changes.'
                        : this.loadFailureMessages.get(name)
                })),
                () => this.retryDataRecovery(),
                () => { this.dataRecoveryModal = null; this.showPendingDataDialogs(); }, undefined,
                () => this.missingAccountError && !this.isAccountDataProtected() && this.pendingAccountRollback === null
                    ? { missingAccounts: this.missingAccountError.missingAccounts, resolve: () => this.openAccountReconciliation() } : undefined
            );
            this.dataRecoveryModal.open();
        }
    }

    private clearDatasetProtection(dataset: ProtectedDataset): void {
        if (this.pendingAccountRollback !== null && dataset !== 'budgets') return;
        if (this.protectedDatasets.delete(dataset)) {
            this.loadFailureMessages.delete(dataset);
            if (dataset === 'transactions') this.missingAccountError = null;
            this.refreshDataRecoveryWarnings();
        }
    }

    retryDataRecovery(): Promise<boolean> {
        if (this.dataRecoveryRetry) return this.dataRecoveryRetry;
        this.retryingDataRecovery = true;
        this.refreshDataRecoveryWarnings();
        this.dataRecoveryRetry = (async () => {
            try {
                return await this.enqueuePersistence(async () => {
                    const previousData = JSON.stringify([this.transactionsData.transactions, this.transactionsData.accounts, this.budgetData.budgets]);
                    if (this.pendingAccountRollback !== null) {
                        try {
                            await this.app.vault.adapter.write(this.accountsFilePath, this.pendingAccountRollback);
                            this.pendingAccountRollback = null;
                        } catch (error: unknown) {
                            this.protectDataset('accounts', error);
                            this.protectDataset('transactions', error);
                        }
                    }
                    // Always check all files, including those that were healthy at the last attempt.
                    // Accounts come first so transaction migration cannot invent fallback associations.
                    await this.readAccountsData();
                    await this.readTransactionsData();
                    await this.readBudgetData();
                    const recoveredData = JSON.stringify([this.transactionsData.transactions, this.transactionsData.accounts, this.budgetData.budgets]);
                    if (recoveredData !== previousData) await this.refreshExpensicaViews();
                    if (this.protectedDatasets.size === 0) this.dataRecoveryModal?.close();
                    return this.protectedDatasets.size === 0;
                });
            } finally {
                this.retryingDataRecovery = false;
                this.dataRecoveryRetry = null;
                this.refreshDataRecoveryWarnings();
                this.dataRecoveryModal?.refresh();
            }
        })();
        return this.dataRecoveryRetry;
    }

    renderDataRecoveryWarning(container: HTMLElement): void {
        const warning = container.querySelector<HTMLElement>('.expensica-data-recovery-warning')
            || container.createDiv('expensica-data-recovery-warning');
        warning.empty();
        warning.hidden = this.protectedDatasets.size === 0 && this.saveFailures.size === 0;
        if (warning.hidden) return;
        warning.setAttribute('role', 'status');
        for (const dataset of this.protectedDatasets) {
            const missingAccounts = dataset === 'transactions' && this.missingAccountError
                && !this.isAccountDataProtected() && this.pendingAccountRollback === null;
            const actions = this.createRecoveryCard(warning, missingAccounts ? 'warning' : 'load',
                missingAccounts ? 'Missing accounts' : `Saving ${dataset} is blocked`,
                missingAccounts ? " are missing or don't exist." : ' contents are not valid. Restore a valid copy, then retry.',
                this.datasetPath(dataset));
            const retry = actions.createEl('button', { text: missingAccounts ? 'More' : 'Retry', cls: 'expensica-standard-button' });
            retry.disabled = !missingAccounts && this.retryingDataRecovery;
            retry.addEventListener('click', voidAsync(async () => {
                if (missingAccounts) {
                    this.openDataRecovery();
                    return;
                }
                try {
                    await this.retryDataRecovery();
                } catch (error) {
                    if (this.protectedDatasets.has(dataset)) this.loadFailureMessages.set(dataset, this.recoveryMessage(error));
                    this.refreshDataRecoveryWarnings();
                }
                if (this.protectedDatasets.has(dataset)) this.openDataRecovery();
            }));
        }
        const visibleFailures = new Map<string, { owner: object; failure: SaveFailure }>();
        for (const [owner, failure] of this.saveFailures) {
            const current = visibleFailures.get(failure.path);
            if (!current || (!current.failure.retry && failure.retry)
                || (!current.failure.retry && !failure.retry && failure.write)) {
                visibleFailures.set(failure.path, { owner, failure });
            }
        }
        for (const { owner, failure } of visibleFailures.values()) {
            const actions = this.createRecoveryCard(warning, 'save', `${failure.operation} is unsaved`,
                ' could not be accessed. Check file permissions and if the vault has free space.', failure.path);
            const retry = actions.createEl('button', { text: 'Retry', cls: 'expensica-standard-button' });
            retry.disabled = this.savingOwners.has(owner) || this.retryingSaveOwners.has(owner);
            retry.addEventListener('click', voidAsync(async () => {
                if (this.retryingSaveOwners.has(owner) || this.savingOwners.has(owner)) return;
                if (!await this.retrySaveRecovery(owner) && this.saveFailures.has(owner)) {
                    if (Array.from(this.protectedDatasets).some(dataset => this.datasetPath(dataset) === failure.path)) this.openDataRecovery();
                    else this.openSaveRecovery(owner);
                }
            }));
        }
    }

    private createRecoveryCard(container: HTMLElement, kind: 'load' | 'save' | 'warning', title: string, message: string, path: string): HTMLElement {
        const card = container.createDiv(`expensica-recovery-card expensica-recovery-card-${kind}`);
        card.setAttribute('data-recovery-kind', kind);
        const body = card.createDiv('expensica-recovery-card-body');
        const heading = body.createDiv('expensica-recovery-card-heading');
        const icon = heading.createSpan('expensica-recovery-card-icon');
        icon.setAttribute('aria-hidden', 'true');
        createWarningIcon(icon);
        heading.createEl('h3', { text: title });
        const description = body.createEl('p');
        description.createSpan({ text: kind === 'warning' ? 'Several accounts in ' : 'The ' });
        const file = description.createSpan({ text: path.split(/[\\/]/).pop() || path, cls: 'expensica-recovery-card-file' });
        file.setAttribute('title', path);
        description.createSpan({ text: message });
        return card.createDiv('expensica-recovery-card-actions');
    }

    private refreshDataRecoveryWarnings(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE)) {
            const container = leaf.view.containerEl.children[1] as HTMLElement | undefined;
            if (container && typeof container.createDiv === 'function') this.renderDataRecoveryWarning(container);
        }
    }

    async openDashboard() {
        // Activate existing leaf if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        if (leaves.length > 0) {
            await this.app.workspace.revealLeaf(leaves[0]);
        } else {
            // Create a new leaf
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: EXPENSICA_VIEW_TYPE,
                active: true
            });
            await this.app.workspace.revealLeaf(leaf);
        }
    }

    async openTransactionsView(filter?: TransactionNavigationFilter) {
        await this.openDashboard();
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        const dashboardLeaf = leaves.find(leaf => leaf.view instanceof ExpensicaDashboardView);
        if (dashboardLeaf?.view instanceof ExpensicaDashboardView) {
            const dashboard = dashboardLeaf.view;
            await dashboard.loadTransactionsData();
            dashboard.switchDashboardTab(DashboardTab.TRANSACTIONS);
            if (filter) {
                this.dashboardTransactionsViews.get(dashboard)?.applyNavigationFilter(filter);
            }
            dashboard.scrollToTop();
        }
    }

    async openTransactionsViewForCategory(categoryId: string) {
        await this.openTransactionsView({ categoryId });
    }

    renderDashboardTransactionsTab(dashboard: ExpensicaDashboardView, container: HTMLElement) {
        let transactionsView = this.dashboardTransactionsViews.get(dashboard);
        if (!transactionsView) {
            transactionsView = new ExpensicaTransactionsView(this.app, this);
            this.dashboardTransactionsViews.set(dashboard, transactionsView);
            dashboard.register(() => transactionsView?.deactivate());
        }

        transactionsView.renderDashboardTab(container);
    }

    deactivateDashboardTransactionsTab(dashboard: ExpensicaDashboardView) {
        this.dashboardTransactionsViews.get(dashboard)?.deactivate();
    }

    renderDashboardAccountsTab(dashboard: ExpensicaDashboardView, container: HTMLElement) {
        dashboard.renderAccountsTab(container);
    }

    async openExpenseModal() {
        // Find the dashboard view if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        const currentView = leaves[0]?.view;
        if (currentView instanceof ExpensicaDashboardView) {
            const dashboardView = currentView;
            const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.EXPENSE);
            modal.open();
        } else {
            // Open the dashboard first, then open the modal
            await this.openDashboard();
            window.setTimeout(() => {
                const dashboardView = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE)[0]?.view;
                if (dashboardView instanceof ExpensicaDashboardView) {
                    const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.EXPENSE);
                    modal.open();
                }
            }, 300); // Give some time for the view to initialize
        }
    }

    async openIncomeModal() {
        // Find the dashboard view if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        const currentView = leaves[0]?.view;
        if (currentView instanceof ExpensicaDashboardView) {
            const dashboardView = currentView;
            const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.INCOME);
            modal.open();
        } else {
            // Open the dashboard first, then open the modal
            await this.openDashboard();
            window.setTimeout(() => {
                const dashboardView = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE)[0]?.view;
                if (dashboardView instanceof ExpensicaDashboardView) {
                    const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.INCOME);
                    modal.open();
                }
            }, 300); // Give some time for the view to initialize
        }
    }

    // Open the export modal for advanced export options
    openExportModal() {
        // Open the export modal
        const modal = new ExportModal(this.app, this);
        modal.open();
    }

    openImportModal() {
        new ImportModal(this.app, this).open();
    }

    onunload() {
        this.unloaded = true;
        this.pendingRecoveryDialog = false;
        this.pendingTransactionSummaries = [];
        this.dataRecoveryModal?.close();
        this.saveRecoveryModal?.close();
        this.saveFailures.clear();
    }

    async loadSettings() {
        const saved = ((await this.loadData()) ?? {}) as Partial<ExpensicaSettings> & { lastSelectedAccountId?: string };
        const { lastSelectedAccountId, ...loadedData } = saved;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        if (!getCurrencyByCode(this.settings.defaultCurrency)) {
            showExpensicaNotice('The saved currency is invalid. Choose a valid currency in Expensica settings. Amounts have not been converted.', 10000);
        }
        this.settings.lastTransactionSelection = {
            ...(lastSelectedAccountId ? { accountId: lastSelectedAccountId } : {}),
            ...loadedData.lastTransactionSelection
        };
        this.normalizeCategorySettings();
    }

    async saveSettings(refreshViews = true) {
        if (!getCurrencyByCode(this.settings.defaultCurrency)) {
            throw new Error('Choose a valid currency in Expensica settings before saving settings.');
        }
        const snapshot = this.snapshotSettings();
        await this.enqueuePersistence(() => this.saveData(snapshot));

        if (refreshViews) {
            await this.refreshExpensicaViews();
        }
    }

    private snapshotSettings(): ExpensicaSettings {
        this.normalizeCategorySettings();
        const snapshot: unknown = JSON.parse(JSON.stringify({
            ...this.settings,
            categories: this.settings.categories.map(category => ({
                id: category.id,
                name: category.name,
                type: category.type
            })),
            categoryEmojis: this.getCategoryEmojiOverridesForSave(),
            categoryColors: this.settings.categoryColors
        }));
        return snapshot as ExpensicaSettings;
    }

    normalizeCategorySettings() {
        const legacyCategories = this.settings.categories as LegacyCategory[];
        const categoryEmojis = this.settings.categoryEmojis || {};
        const deletedDefaultCategoryIds = new Set(this.settings.deletedDefaultCategoryIds || []);
        this.settings.categoryColors = this.settings.categoryColors || {};
        const migratedEmojis = legacyCategories.reduce<CategoryEmojiSettings>((emojiSettings, category) => {
            if (category.emoji) {
                emojiSettings[category.id] = category.emoji;
            }

            return emojiSettings;
        }, {});

        this.settings.categoryEmojis = this.getCategoryEmojiOverridesForSave({
            ...migratedEmojis,
            ...categoryEmojis
        });

        const normalizedCategories = legacyCategories.map(category => {
            const normalizedName = this.normalizeCategoryName(category.name);
            if (normalizedName.leadingEmoji && !this.settings.categoryEmojis[category.id]) {
                this.settings.categoryEmojis[category.id] = normalizedName.leadingEmoji;
            }

            return {
                id: category.id,
                name: normalizedName.name,
                type: category.type
            };
        });

        const categoriesById = new Map<string, Category>();
        normalizedCategories.forEach(category => {
            if (
                category.id !== INTERNAL_CATEGORY_ID
                && this.normalizeCategoryName(category.name).name.toLowerCase() === INTERNAL_CATEGORY_NAME.toLowerCase()
            ) {
                return;
            }
            categoriesById.set(category.id, category);
        });
        DEFAULT_CATEGORIES.forEach(category => {
            if (category.id !== 'other_expense' && category.id !== 'other_income' && deletedDefaultCategoryIds.has(category.id)) {
                return;
            }
            if (!categoriesById.has(category.id)) {
                categoriesById.set(category.id, category);
            }
        });

        this.settings.categories = Array.from(categoriesById.values());
        this.settings.deletedDefaultCategoryIds = Array.from(deletedDefaultCategoryIds).filter(categoryId => categoryId !== 'other_expense' && categoryId !== 'other_income');

        this.settings.categoryEmojis = this.getCategoryEmojiOverridesForSave();
    }

    normalizeCategoryName(name: string): { name: string; leadingEmoji: string | null } {
        const match = name.match(LEADING_CATEGORY_EMOJI_PATTERN);
        const canonicalize = (value: string) => value
            .trim()
            .replace(/\bGifts\s+and\s+Donations\b/gi, 'Gifts & Donations');
        if (!match) {
            return {
                name: canonicalize(name),
                leadingEmoji: null
            };
        }

        return {
            name: canonicalize(name.slice(match[0].length)),
            leadingEmoji: match[1]
        };
    }

    getCategoryEmojiOverridesForSave(categoryEmojis: CategoryEmojiSettings = this.settings.categoryEmojis): CategoryEmojiSettings {
        return Object.entries(categoryEmojis).reduce<CategoryEmojiSettings>((overrides, [categoryId, emoji]) => {
            if (emoji && !this.isBuiltInCategoryEmoji(categoryId, emoji)) {
                overrides[categoryId] = emoji;
            }

            return overrides;
        }, {});
    }

    isBuiltInCategoryEmoji(categoryId: string, emoji: string): boolean {
        return emoji === DEFAULT_CATEGORY_EMOJIS[categoryId];
    }

    getSharedDateRangeState(): SharedDateRangeState | null {
        return this.settings.sharedDateRangeState;
    }

    async setSharedDateRangeState(state: SharedDateRangeState, sourceView?: unknown) {
        const currentState = this.settings.sharedDateRangeState;
        if (currentState && currentState.updatedAt > state.updatedAt) {
            return;
        }

        this.settings.sharedDateRangeState = { ...state };
        await this.saveSettings(false);
        await this.syncDateRangeViews(sourceView);
    }

    async refreshExpensicaViews(sourceView?: unknown, budgetsOnly = false) {
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);

        for (const leaf of leaves) {
            const view = leaf.view;
            if (view === sourceView) {
                continue;
            }

            if (view instanceof ExpensicaDashboardView) {
                try {
                    await view.refreshData(budgetsOnly);
                } catch {
                    // A committed mutation must not become a retryable save because a view failed.
                    showExpensicaNotice('Changes were saved, but the dashboard could not refresh. Reopen it to update the view.');
                }
            }
        }
    }

    async syncDateRangeViews(sourceView?: unknown) {
        const sharedState = this.getSharedDateRangeState();
        if (!sharedState) {
            return;
        }

        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);

        for (const leaf of leaves) {
            const view: unknown = leaf.view;
            if (view === sourceView) {
                continue;
            }

            const applySharedDateRangeState = getSharedDateRangeApplier(view);
            if (applySharedDateRangeState) await applySharedDateRangeState(sharedState);
        }
    }

    // Get categories filtered by type
    getCategories(type?: CategoryType): Category[] {
        const visibleCategories = this.settings.categories.filter(category => category.id !== INTERNAL_CATEGORY_ID);
        if (!type) {
            return visibleCategories;
        }
        return visibleCategories.filter(c => c.type === type);
    }

    // Get category by ID
    getCategoryById(id: string, type?: CategoryType): Category | undefined {
        const normalizedId = typeof id === 'string' && LEGACY_UNKNOWN_CATEGORY_IDS.has(id.trim().toLowerCase())
            ? type === CategoryType.INCOME ? 'other_income' : 'other_expense'
            : id;
        return this.settings.categories.find(c => c.id === normalizedId && (!type || c.type === type));
    }

    getCategoryEmoji(categoryId: string): string {
        return this.settings.categoryEmojis[categoryId] || DEFAULT_CATEGORY_EMOJIS[categoryId] || '?';
    }

    getCategoryColor(categoryId: string, fallbackName?: string): string {
        return this.settings.categoryColors[categoryId]
            || getCategoryColor(fallbackName || categoryId);
    }

    isReservedCategoryName(categoryId: string, name: string): boolean {
        return categoryId !== INTERNAL_CATEGORY_ID
            && this.normalizeCategoryName(name).name.toLowerCase() === INTERNAL_CATEGORY_NAME.toLowerCase();
    }

    async updateCategoryEmoji(categoryId: string, emoji: string): Promise<void> {
        if (emoji === this.getCategoryEmoji(categoryId)) {
            return;
        }

        this.settings.categoryEmojis = {
            ...this.settings.categoryEmojis,
            [categoryId]: emoji
        };
        await this.saveSettings();
    }

    async updateCategoryColor(categoryId: string, color: string): Promise<void> {
        if (color === this.settings.categoryColors[categoryId]) {
            return;
        }

        this.settings.categoryColors = {
            ...this.settings.categoryColors,
            [categoryId]: color
        };
        await this.saveSettings();
    }

    // Add a new category
    async addCategory(category: Category): Promise<void> {
        const normalizedName = this.normalizeCategoryName(category.name).name;
        if (this.isReservedCategoryName(category.id, normalizedName)) {
            throw new Error(`Category name "${INTERNAL_CATEGORY_NAME}" is reserved`);
        }
        const duplicate = this.settings.categories.find(existing =>
            existing.type === category.type
            && this.normalizeCategoryName(existing.name).name.toLowerCase() === normalizedName.toLowerCase()
        );
        if (duplicate) {
            throw new Error('Category already exists');
        }

        this.settings.categories.push({
            ...category,
            name: normalizedName
        });
        this.settings.deletedDefaultCategoryIds = (this.settings.deletedDefaultCategoryIds || []).filter(categoryId => categoryId !== category.id);
        await this.saveSettings();
    }

    async addExpenseCategory(category: Omit<Category, 'type'>): Promise<void> {
        await this.addCategory({
            ...category,
            type: CategoryType.EXPENSE
        });
    }

    async addIncomeCategory(category: Omit<Category, 'type'>): Promise<void> {
        await this.addCategory({
            ...category,
            type: CategoryType.INCOME
        });
    }

    // Update a category
    async updateCategory(updatedCategory: Category): Promise<void> {
        const index = this.settings.categories.findIndex(c => c.id === updatedCategory.id);
        if (index !== -1) {
            const normalizedName = this.normalizeCategoryName(updatedCategory.name).name;
            if (this.isReservedCategoryName(updatedCategory.id, normalizedName)) {
                throw new Error(`Category name "${INTERNAL_CATEGORY_NAME}" is reserved`);
            }
            const duplicate = this.settings.categories.find(existing =>
                existing.id !== updatedCategory.id
                && existing.type === updatedCategory.type
                && this.normalizeCategoryName(existing.name).name.toLowerCase() === normalizedName.toLowerCase()
            );
            if (duplicate) {
                throw new Error('Category already exists');
            }

            this.settings.categories[index] = {
                ...updatedCategory,
                name: normalizedName
            };
            await this.saveSettings();
        }
    }

    // Check if a category is being used by any transactions
    isCategoryInUse(categoryId: string): boolean {
        return this.transactionsData.transactions.some(transaction =>
            transaction.category === categoryId
        );
    }

    // Update transactions with a default category if their category is deleted
    private async handleDeletedCategory(categoryId: string): Promise<void> {
        let updatedCount = 0;
        const transactions = this.transactionsData.transactions.map(transaction => {
            if (transaction.category === categoryId && transaction.type !== TransactionType.INTERNAL) {
                updatedCount++;
                return { ...transaction, category: getDefaultTransactionCategory(transaction.type, this.settings.categories) };
            }
            return transaction;
        });

        if (updatedCount > 0) {
            await this.writeTransactionsData({ ...this.transactionsData, transactions });
        }
    }

    // Delete a category
    async deleteCategory(id: string): Promise<boolean> {
        // Store the category for reference
        const category = this.getCategoryById(id);
        if (!category) return false;
        if (category.id === 'other_expense' || category.id === 'other_income') return false;

        return await new Promise<boolean>((resolve) => {
            new ExpensicaConfirmationModal(
                this.app,
                'Delete Category?',
                `Are you sure you want to delete the "${category.name}" category? This action cannot be undone.`,
                async (confirmed) => {
                    if (!confirmed) {
                        resolve(false);
                        return;
                    }

                    await this.enqueuePersistence(async () => {
                        if (this.isDatasetProtected('transactions') || this.isDatasetProtected('budgets')) {
                            throw new Error('Transaction or budget data is protected');
                        }
                        await this.handleDeletedCategory(id);
                        const budgets = this.budgetData.budgets.filter(budget => budget.categoryId !== id);
                        if (budgets.length !== this.budgetData.budgets.length) {
                            await this.writeBudgetData({ ...this.budgetData, budgets });
                        }
                        const previousSettings = this.settings;
                        this.settings = {
                            ...this.settings,
                            categories: this.settings.categories.filter(c => c.id !== id),
                            categoryEmojis: { ...this.settings.categoryEmojis },
                            categoryColors: { ...this.settings.categoryColors }
                        };
                        if (DEFAULT_CATEGORY_IDS.has(id)) {
                            this.settings.deletedDefaultCategoryIds = Array.from(new Set([
                                ...(this.settings.deletedDefaultCategoryIds || []),
                                id
                            ]));
                        }
                        delete this.settings.categoryEmojis[id];
                        delete this.settings.categoryColors[id];

                        try {
                            await this.saveData(this.snapshotSettings());
                        } catch (error) {
                            this.settings = previousSettings;
                            throw error;
                        }
                    });

                    await this.refreshExpensicaViews();

                    if (this.settingTab) {
                        this.settingTab.refreshSettings();
                    }

                    resolve(true);
                }, 'Delete', this
            ).open();
        });
    }

    // Methods for transaction management
    private captureTransaction(transaction: Transaction, editing = false): () => Transaction {
        const draft = { ...transaction };
        const previous = editing ? this.transactionsData.transactions.find(entry => entry.id === draft.id) : undefined;
        const fields = ['account', 'fromAccount', 'toAccount'] as const;
        const accounts = fields.map(field => !this.isAccountDataProtected() && draft[field]
            ? this.findAccountByReference(draft[field])?.id : undefined);
        return () => {
            const next = { ...draft };
            const current = editing ? this.transactionsData.transactions.find(entry => entry.id === draft.id) : undefined;
            fields.forEach((field, index) => {
                if (previous && current && draft.type === previous.type && current.type === draft.type && draft[field] === previous[field]) {
                    next[field] = current[field];
                } else if (accounts[index]) {
                    const account = this.transactionsData.accounts.find(entry => entry.id === accounts[index]);
                    if (!account) throw new Error('The selected account is no longer available. Reopen the transaction editor.');
                    next[field] = formatAccountReference(account.type, account.name);
                }
            });
            return next;
        };
    }

    async addTransaction(transaction: Transaction, sourceView?: unknown) {
        const prepare = this.captureTransaction(transaction);
        return this.enqueuePersistence(async () => {
            transaction = prepare();
            if (!this.canSaveTransaction(transaction)) throw new Error('Account data is protected');
            await this.writeTransactionsData({
                ...this.transactionsData,
                transactions: [...this.transactionsData.transactions, this.normalizeTransactionForSave(transaction)]
            });
            await this.refreshExpensicaViews(sourceView);
        });
    }

    async updateTransaction(transaction: Transaction, sourceView?: unknown) {
        const prepare = this.captureTransaction(transaction, true);
        return this.enqueuePersistence(async () => {
            transaction = prepare();
            const index = this.transactionsData.transactions.findIndex(t => t.id === transaction.id);
            if (index !== -1) {
                if (!this.canSaveTransaction(transaction)) throw new Error('Account data is protected');
                await this.writeTransactionsData({
                    ...this.transactionsData,
                    transactions: this.transactionsData.transactions.map((existing, position) =>
                        position === index ? this.normalizeTransactionForSave(transaction) : existing)
                });
                await this.refreshExpensicaViews(sourceView);
            }
        });
    }

    async deleteTransaction(id: string, sourceView?: unknown) {
        return this.deleteTransactions([id], sourceView);
    }

    async updateTransactions(ids: string[], changes: Partial<Transaction>, sourceView?: unknown) {
        const selected = new Set(ids);
        const patch = { ...changes };
        return this.enqueuePersistence(async () => {
            let changed = false;
            const transactions = this.transactionsData.transactions.map(transaction => {
                if (!selected.has(transaction.id)) return transaction;
                const next = { ...transaction, ...patch, id: transaction.id };
                if (!this.canSaveTransaction(next)) throw new Error('Account data is protected');
                changed = true;
                return this.normalizeTransactionForSave(next);
            });
            if (!changed) return;
            await this.writeTransactionsData({ ...this.transactionsData, transactions });
            await this.refreshExpensicaViews(sourceView);
        });
    }

    async deleteTransactions(ids: string[], sourceView?: unknown) {
        const selected = new Set(ids);
        return this.enqueuePersistence(async () => {
            const transactions = this.transactionsData.transactions.filter(transaction => !selected.has(transaction.id));
            if (transactions.length === this.transactionsData.transactions.length) return;
            await this.writeTransactionsData({ ...this.transactionsData, transactions });
            await this.refreshExpensicaViews(sourceView);
        });
    }

    // Get transactions for a specific month
    getTransactionsForMonth(year: number, month: number): Transaction[] {
        return this.transactionsData.transactions.filter(transaction => {
            const date = parseLocalDate(transaction.date);
            return date.getFullYear() === year && date.getMonth() === month;
        });
    }

    // Get all transactions
    getAllTransactions(): Transaction[] {
        return [...this.transactionsData.transactions];
    }

    getAccounts(): Account[] {
        return [...this.transactionsData.accounts].sort(compareAccounts);
    }

    getDefaultAccount(): Account {
        return this.transactionsData.accounts.find(account => account.isDefault)
            || DEFAULT_ACCOUNT;
    }

    findAccountByReference(accountReference?: string | null): Account | null {
        const normalizedReference = accountReference
            ? this.normalizeTransactionAccountReference(accountReference)
            : formatAccountReference(this.getDefaultAccount().type, this.getDefaultAccount().name);
        return this.transactionsData.accounts.find(account =>
            formatAccountReference(account.type, account.name) === normalizedReference
        ) || null;
    }

    getTransactionAccountDisplay(accountReference?: string | null): Account {
        const account = this.findAccountByReference(accountReference) || this.getDefaultAccount();
        if (!this.settings.enableAccounts) {
            return {
                ...account,
                name: 'Running Balance',
                isDefault: true
            };
        }

        return account;
    }

    async addAccount(account: Account, sourceView?: unknown) {
        account = { ...account };
        return this.enqueuePersistence(async () => {
            const normalizedAccount: Account = {
                ...account,
                name: normalizeAccountName(account.name),
                color: normalizePaletteColor(account.color) || undefined
            };

            if (normalizedAccount.type !== AccountType.CREDIT) {
                delete normalizedAccount.creditLimit;
            }

            await this.writeAccountsData({
                ...this.transactionsData,
                accounts: [...this.transactionsData.accounts, normalizedAccount].sort(compareAccounts)
            });
            await this.refreshExpensicaViews(sourceView);
        });
    }

    async updateAccount(previousReference: string, account: Account, sourceView?: unknown) {
        account = { ...account };
        return this.enqueuePersistence(async () => {
            const currentAccount = this.transactionsData.accounts.find(existing => existing.id === account.id);
            if (!currentAccount) throw new Error('Account not found');
            previousReference = formatAccountReference(currentAccount.type, currentAccount.name);
            const nextReference = formatAccountReference(account.type, account.name);
            const duplicateAccount = this.transactionsData.accounts.find(existing =>
                formatAccountReference(existing.type, existing.name) === nextReference
                && formatAccountReference(existing.type, existing.name) !== previousReference
            );
            if (duplicateAccount) {
                throw new Error('Account already exists');
            }

            const index = this.transactionsData.accounts.findIndex(existing =>
                formatAccountReference(existing.type, existing.name) === previousReference
            );
            if (index === -1) {
                throw new Error('Account not found');
            }

            const updatedAccount: Account = {
                ...this.transactionsData.accounts[index],
                ...account,
                name: normalizeAccountName(account.name),
                color: normalizePaletteColor(account.color ?? this.transactionsData.accounts[index].color) || undefined
            };
            if (updatedAccount.isDefault && updatedAccount.type === AccountType.CREDIT) {
                throw new Error('Default account cannot be credit');
            }

            if (updatedAccount.type !== AccountType.CREDIT) {
                delete updatedAccount.creditLimit;
            }

            const previousData = this.transactionsData;
            const nextTransactions = previousData.transactions.map(transaction => {
                const nextTransaction = { ...transaction };

                if (Object.prototype.hasOwnProperty.call(nextTransaction, 'account') && nextTransaction.account === previousReference) {
                    nextTransaction.account = nextReference;
                }

                if (nextTransaction.fromAccount === previousReference) {
                    nextTransaction.fromAccount = nextReference;
                }

                if (nextTransaction.toAccount === previousReference) {
                    nextTransaction.toAccount = nextReference;
                }

                return nextTransaction;
            });

            // Neither dataset may be protected before starting this two-file update.
            if (this.isDatasetProtected('transactions')) throw new Error('Transaction data is protected');
            if (this.isDatasetProtected('accounts')) throw new Error('Account data is protected');
            let previousAccountsFile: string;
            try {
                previousAccountsFile = await this.app.vault.adapter.read(this.accountsFilePath);
            } catch (error) {
                throw this.markSaveError(error, this.accountsFilePath, false);
            }
            await this.writeAccountsData({
                ...previousData,
                accounts: previousData.accounts.map((existing, position) => position === index ? updatedAccount : existing)
            });
            try {
                await this.writeTransactionsData({ ...this.transactionsData, transactions: nextTransactions });
            } catch (error) {
                this.transactionsData = previousData;
                try {
                    await this.app.vault.adapter.write(this.accountsFilePath, previousAccountsFile);
                } catch {
                    this.pendingAccountRollback = previousAccountsFile;
                    this.protectDataset('accounts');
                    this.protectDataset('transactions');
                    showExpensicaNotice('Account recovery is required. Keep Expensica open and choose Retry to restore the previous accounts.', 10000);
                }
                throw error;
            }
            await this.refreshExpensicaViews(sourceView);
        });
    }

    async deleteAccount(accountReference: string, sourceView?: unknown) {
        const accountId = this.transactionsData.accounts.find(account => formatAccountReference(account.type, account.name) === accountReference)?.id;
        return this.enqueuePersistence(async () => {
            const index = this.transactionsData.accounts.findIndex(account =>
                accountId ? account.id === accountId : formatAccountReference(account.type, account.name) === accountReference
            );
            if (index === -1) {
                throw new Error('Account not found');
            }

            await this.writeAccountsData({
                ...this.transactionsData,
                accounts: this.transactionsData.accounts.filter((_, position) => position !== index)
            });
            await this.refreshExpensicaViews(sourceView);
        });
    }

    hasTransactionsForAccount(accountReference: string): boolean {
        return this.transactionsData.transactions.some(transaction =>
            transaction.account === accountReference
            || transaction.fromAccount === accountReference
            || transaction.toAccount === accountReference
        );
    }

    normalizeTransactionAccountReference(accountReference?: string | null): string {
        if (!accountReference) {
            const defaultAccount = this.getDefaultAccount();
            return formatAccountReference(defaultAccount.type, defaultAccount.name);
        }

        const parsedAccount = parseAccountReference(accountReference);
        return formatAccountReference(parsedAccount.type, parsedAccount.name);
    }

    normalizeTransactionForSave(transaction: Transaction): Transaction {
        const description = formatTransactionDescriptionForBanking(transaction.description);
        if (this.isAccountDataProtected()) {
            return {
                ...transaction,
                description,
                category: transaction.type === TransactionType.INTERNAL ? INTERNAL_CATEGORY_ID
                    : this.getCategoryById(transaction.category, getCategoryTypeForTransactionType(transaction.type))?.id
                        || getDefaultTransactionCategory(transaction.type, this.settings.categories)
            };
        }
        if (transaction.type === TransactionType.INTERNAL) {
            return {
                ...transaction,
                description,
                category: INTERNAL_CATEGORY_ID,
                fromAccount: this.normalizeTransactionAccountReference(transaction.fromAccount),
                toAccount: this.normalizeTransactionAccountReference(transaction.toAccount),
                account: undefined
            };
        }

        const normalizedCategory = this.getCategoryById(transaction.category, getCategoryTypeForTransactionType(transaction.type))?.id
            || getDefaultTransactionCategory(transaction.type, this.settings.categories);

        return {
            ...transaction,
            description,
            category: normalizedCategory,
            account: this.normalizeTransactionAccountReference(transaction.account),
            fromAccount: undefined,
            toAccount: undefined
        };
    }

    private normalizeTransactionsSnapshot(data: TransactionsData, normalizeTransactions = true): TransactionsData {
        const previousData = this.transactionsData;
        try {
            this.transactionsData = { ...data };
            this.normalizeTransactionsData(normalizeTransactions);
            return this.transactionsData;
        } finally {
            this.transactionsData = previousData;
        }
    }

    private normalizeTransactionsData(normalizeTransactions = true) {
        const normalizedAccounts = new Map<string, Account>();
        let defaultAccountId: string | null = null;
        let defaultAccountPriority = -1;
        const usedAccountIds = new Set<string>();
        const sourceAccounts = this.transactionsData.accounts && this.transactionsData.accounts.length > 0
            ? this.transactionsData.accounts
            : normalizeTransactions ? [DEFAULT_ACCOUNT] : [];

        sourceAccounts.forEach((account) => {
            const normalizedName = normalizeAccountName(account.name) || DEFAULT_ACCOUNT.name;
            const normalizedType = account.type || AccountType.CHEQUING;
            const reference = formatAccountReference(normalizedType, normalizedName);

            if (normalizedAccounts.has(reference)) {
                return;
            }

            let normalizedId = account.id || generateId();
            if (usedAccountIds.has(normalizedId)) {
                normalizedId = generateId();
            }
            usedAccountIds.add(normalizedId);

            const normalizedAccount: Account = {
                id: normalizedId,
                name: normalizedName,
                type: normalizedType,
                createdAt: account.createdAt || new Date().toISOString(),
                color: normalizePaletteColor(account.color) || getAccountColor({
                    id: normalizedId,
                    name: normalizedName,
                    type: normalizedType,
                    createdAt: account.createdAt || new Date().toISOString()
                }),
                isDefault: !!account.isDefault
            };
            if (normalizedType === AccountType.CREDIT && typeof account.creditLimit === 'number') {
                normalizedAccount.creditLimit = account.creditLimit;
            }

            normalizedAccounts.set(reference, normalizedAccount);

            const defaultPriority = account.isDefault
                ? 2
                : account.id === DEFAULT_ACCOUNT_ID
                    ? 1
                    : 0;

            if (defaultPriority > defaultAccountPriority) {
                defaultAccountId = normalizedAccount.id;
                defaultAccountPriority = defaultPriority;
            }
        });

        if (!defaultAccountId) {
            const firstAccount = [...normalizedAccounts.values()][0];
            if (firstAccount) {
                firstAccount.isDefault = true;
                defaultAccountId = firstAccount.id;
            }
        }

        this.transactionsData.accounts = [...normalizedAccounts.values()]
            .map(account => ({
                ...account,
                isDefault: account.id === defaultAccountId
            }))
            .sort(compareAccounts);
        if (!normalizeTransactions) return;
        this.transactionsData.transactions = (this.transactionsData.transactions || []).map(transaction => {
            const normalizedType = transaction.type === TransactionType.INCOME
                ? TransactionType.INCOME
                : transaction.type === TransactionType.INTERNAL
                    ? TransactionType.INTERNAL
                    : TransactionType.EXPENSE;

            if (normalizedType === TransactionType.INTERNAL) {
                return {
                    ...transaction,
                    type: normalizedType,
                    category: INTERNAL_CATEGORY_ID,
                    fromAccount: transaction.fromAccount ? this.normalizeTransactionAccountReference(transaction.fromAccount) : undefined,
                    toAccount: transaction.toAccount ? this.normalizeTransactionAccountReference(transaction.toAccount) : undefined,
                    account: undefined
                };
            }

            const normalizedCategory = this.getCategoryById(transaction.category, getCategoryTypeForTransactionType(normalizedType))?.id
                || getDefaultTransactionCategory(normalizedType, this.settings.categories);

            return {
                ...transaction,
                type: normalizedType,
                category: normalizedCategory,
                account: Object.prototype.hasOwnProperty.call(transaction, 'account')
                    ? this.normalizeTransactionAccountReference(transaction.account)
                    : undefined,
                fromAccount: undefined,
                toAccount: undefined
            };
        });
    }

    // Export transactions to JSON (legacy method for backward compatibility)
    async exportTransactionsToJSON(filePath: string) {
        return this.enqueuePersistence(async () => {
            try {
                const jsonData = JSON.stringify(this.transactionsData.transactions, null, 2);
                await this.app.vault.adapter.write(filePath, jsonData);
                showExpensicaNotice('Transactions exported successfully');
                return true;
            } catch {
                showExpensicaNotice('Error exporting transactions');
                return false;
            }
        });
    }

    // Import transactions from JSON
    async importTransactionsFromJSON(source: string | TransactionImportSource) {
        return this.enqueuePersistence(async () => {
            if (this.isDatasetProtected('accounts')) throw new Error('Account data is protected');
            if (this.isDatasetProtected('transactions')) throw new Error('Transaction data is protected');
            let fileContent: string;
            try {
                fileContent = typeof source === 'string' ? await this.app.vault.adapter.read(source) : await source.text();
            } catch (error) {
                // Source access errors are distinct from rejected JSON and ledger writes.
                if (typeof source === 'string') throw this.markSaveError(error, source, false);
                throw new TransactionValidationError(null, 'file', 'could not read the selected JSON', 'Check file access or choose the file again.');
            }
            const parsed = parseTransactionFile(fileContent, this.transactionsData.transactions, this.transactionsData.accounts, true);
            const imported = prepareTransactions(parsed.data.transactions, this.transactionsData.transactions, new Date(), this.transactionsData.accounts, true, this.settings.categories);
            imported.corrections.legacyArrayFormatConverted = Number(parsed.legacyArray);
            const transactions = imported.transactions;
            if (typeof source === 'string') this.resolveSaveFailures(source, false);
            if (transactions.length || parsed.legacyArray) {
                await this.writeTransactionsData({
                    ...this.transactionsData,
                    transactions: [...this.transactionsData.transactions, ...transactions]
                }, false);
                // Presentation failures must not turn a committed import into a retryable save.
                try {
                    await this.refreshExpensicaViews();
                    this.showTransactionSummary(`Imported ${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}. Changes saved.`, imported.corrections);
                } catch {
                    showExpensicaNotice('Import completed, but the dashboard could not refresh.');
                }
            }
            return true;
        });
    }

    async openAccountReconciliation(source?: string | TransactionImportSource, onComplete?: () => void) {
        if (!this.isExpensicaFocused()) {
            this.pendingRecoveryDialog = true;
            return;
        }
        const read = async () => {
            try {
                return await (source === undefined ? this.app.vault.adapter.read(this.transactionsFilePath)
                    : typeof source === 'string' ? this.app.vault.adapter.read(source) : source.text());
            } catch (error) {
                if (source === undefined || typeof source === 'string') throw this.markSaveError(error, source || this.transactionsFilePath, false);
                throw new TransactionValidationError(null, 'file', 'could not read the selected JSON', 'Check file access or choose the file again.');
            }
        };
        const context = await this.enqueuePersistence(async () => {
            if (this.isAccountDataProtected() || this.pendingAccountRollback !== null) throw new Error('Account data is protected');
            if (source !== undefined && this.protectedDatasets.has('transactions')) throw new Error('Transaction data is protected');
            const content = await read();
            const parsed = parseTransactionFile(content, [], undefined, true);
            const data = source === undefined ? parsed.data as unknown as TransactionsData : null;
            if (data) validateLoadedData(data, 'transactions', true);
            const rows = parsed.data.transactions;
            try {
                prepareTransactions(rows, data ? [] : this.transactionsData.transactions, new Date(), this.transactionsData.accounts, true, this.settings.categories, !!data);
            } catch (error) {
                if (error instanceof TransactionValidationError && error.canReconcileAccounts) return { content, data, rows, error, legacyArray: parsed.legacyArray };
                throw error;
            }
            return null;
        });
        if (!context) {
            showExpensicaNotice('Account references are already valid. Retry the import or recovery.');
            return;
        }
        this.dataRecoveryModal?.close();
        const modal = new AccountReconciliationModal(this.app, this, context.error, async (choices, drafts) => {
            await this.enqueuePersistence(async () => {
                if (this.isAccountDataProtected() || this.pendingAccountRollback !== null) throw new Error('Account data is protected');
                if (source !== undefined && this.protectedDatasets.has('transactions')) throw new Error('Transaction data is protected');
                let savedAccounts: AccountsData;
                try {
                    savedAccounts = JSON.parse(await this.app.vault.adapter.read(this.accountsFilePath)) as AccountsData;
                    validateLoadedData(savedAccounts, 'accounts');
                }
                catch (error) { this.protectDataset('accounts', error); throw this.markSaveError(error, this.accountsFilePath, false); }
                const savedReferences = new Map(savedAccounts.accounts.map(account => [
                    formatAccountReference(account.type || AccountType.CHEQUING, account.name), account.id
                ]));
                if (savedReferences.size !== this.transactionsData.accounts.length || this.transactionsData.accounts.some(account => {
                    const reference = formatAccountReference(account.type, account.name);
                    return !savedReferences.has(reference) || (savedReferences.get(reference) && savedReferences.get(reference) !== account.id);
                })) {
                    throw new TransactionValidationError(null, 'accounts', 'account references changed while choosing destinations',
                        'Close this dialog and reload accounts before trying again.');
                }
                if (await read() !== context.content) {
                    throw new TransactionValidationError(null, 'file', 'the source changed while choosing accounts', 'Close and retry with the updated file.');
                }
                const accounts = [...this.transactionsData.accounts];
                const selected = new Set(choices.values());
                for (const draft of drafts.filter(account => selected.has(account.id))) {
                    const reference = formatAccountReference(draft.type, draft.name);
                    const persisted = accounts.find(account => account.id === draft.id);
                    if (persisted && formatAccountReference(persisted.type, persisted.name) === reference) continue;
                    if (persisted || accounts.some(account => formatAccountReference(account.type, account.name) === reference)) {
                        throw new TransactionValidationError(null, 'accounts', 'an account with this name and type already exists', 'Link the existing account instead.');
                    }
                    if (!draft.name.trim() || !Object.values(AccountType).includes(draft.type)
                        || (draft.creditLimit != null && (!Number.isFinite(draft.creditLimit) || draft.creditLimit < 0))) {
                        throw new TransactionValidationError(null, 'accounts', 'invalid account properties', 'Correct the account name, type, or credit limit.');
                    }
                    accounts.push(draft);
                }
                const rows = context.rows.map(row => ({ ...row as Transaction }));
                for (const group of context.error.missingAccounts) {
                    const account = accounts.find(account => account.id === choices.get(group.reference));
                    if (!account) throw new TransactionValidationError(null, 'accounts', 'a selected account is unavailable', 'Choose an account for every reference.');
                    const reference = formatAccountReference(account.type, account.name);
                    for (const location of group.locations) (rows[location.index] as unknown as Record<string, unknown>)[location.field] = reference;
                }
                rows.forEach((row, index) => {
                    if (isSelfTransfer(row) && !isSelfTransfer(context.rows[index] as Transaction)) {
                        throw new TransactionValidationError(index, 'toAccount', 'transfer accounts must differ');
                    }
                });
                const prepared = prepareTransactions(rows, context.data ? [] : this.transactionsData.transactions, new Date(), accounts, true, this.settings.categories, !!context.data);
                prepared.corrections.legacyArrayFormatConverted = Number(context.legacyArray);
                prepared.corrections.accountReferencesLinked = context.error.missingAccounts.reduce((count, group) => count + group.locations.length, 0);
                if (accounts.length !== this.transactionsData.accounts.length) {
                    await this.writeAccountsData({ ...this.transactionsData, accounts });
                }
                // New accounts deliberately remain saved if this write fails. Old references remain intact.
                await this.writeTransactionsData({ ...this.transactionsData, ...context.data,
                    accounts: this.transactionsData.accounts,
                    transactions: context.data ? prepared.transactions : [...this.transactionsData.transactions, ...prepared.transactions]
                }, false, source === undefined);
                if (source === undefined) this.clearDatasetProtection('transactions');
                this.showTransactionSummary('Account references updated. Changes saved.', prepared.corrections);
            });
            try { await this.refreshExpensicaViews(); }
            catch { showExpensicaNotice('Account references were updated, but the dashboard could not refresh.'); }
            onComplete?.();
        });
        if (!this.isExpensicaFocused()) {
            this.pendingRecoveryDialog = true;
            return;
        }
        modal.open();
        return modal;
    }

    private showTransactionSummary(summary: string, corrections: TransactionCorrections): void {
        if (!this.isExpensicaFocused() || this.dataRecoveryModal || this.saveRecoveryModal) {
            if (!this.unloaded) this.pendingTransactionSummaries.push({ summary, corrections: { ...corrections } });
            return;
        }
        try {
            const lines = formatTransactionCorrections(corrections);
            showExpensicaNotice(`${summary}${lines.length ? ` ${lines.join('; ')}.` : ''}`);
            new TransactionSummaryModal(this.app, summary, lines).open();
        } catch {
            showExpensicaNotice('Changes were saved, but the migration summary could not be displayed.');
        }
    }

    // Budget methods
    async addBudget(budget: Budget) {
        budget = { ...budget };
        return this.enqueuePersistence(async () => {
            if (budget.rolloverStartDate != null && !getBudgetRolloverStartDate(budget)) {
                throw new Error('Invalid rollover start date. Choose a valid calendar date.');
            }
            if (budget.rollover && !getBudgetRolloverStartDate(budget)) {
                throw new Error('Choose a rollover start period. Opening carry starts at zero.');
            }
            const nextBudget = { ...budget, id: budget.id || generateId(), lastUpdated: new Date().toISOString() };
            if (!nextBudget.rollover) delete nextBudget.rolloverStartDate;
            await this.writeBudgetData({ ...this.budgetData, budgets: [...this.budgetData.budgets, nextBudget] });
            await this.refreshExpensicaViews(undefined, true);
        });
    }

    async updateBudget(budget: Budget) {
        budget = { ...budget };
        return this.enqueuePersistence(async () => {
            const index = this.budgetData.budgets.findIndex(b => b.id === budget.id);
            if (index !== -1) {
                const existing = this.budgetData.budgets[index];
                if (budget.rolloverStartDate != null && !getBudgetRolloverStartDate(budget)) {
                    throw new Error('Invalid rollover start date. Choose a valid calendar date.');
                }
                const termsChanged = budget.amount !== existing.amount || budget.period !== existing.period
                    || budget.categoryId !== existing.categoryId || !existing.rollover;
                if (budget.rollover && (termsChanged || budget.rolloverStartDate !== existing.rolloverStartDate)
                    && !getBudgetRolloverStartDate(budget)) {
                    throw new Error('Choose a rollover start period for the changed budget. Opening carry starts at zero.');
                }
                const nextBudget = { ...budget, lastUpdated: new Date().toISOString() };
                if (!nextBudget.rollover) delete nextBudget.rolloverStartDate;
                await this.writeBudgetData({
                    ...this.budgetData,
                    budgets: this.budgetData.budgets.map((existing, position) => position === index ? nextBudget : existing)
                });
                await this.refreshExpensicaViews(undefined, true);
            }
        });
    }

    async deleteBudget(id: string) {
        return this.enqueuePersistence(async () => {
            const index = this.budgetData.budgets.findIndex(b => b.id === id);
            if (index !== -1) {
                await this.writeBudgetData({
                    ...this.budgetData,
                    budgets: this.budgetData.budgets.filter((_, position) => position !== index)
                });
                await this.refreshExpensicaViews(undefined, true);
            }
        });
    }

    getBudgetForCategory(categoryId: string): Budget | undefined {
        return this.budgetData.budgets.find(b => b.categoryId === categoryId);
    }

    getAllBudgets(): Budget[] {
        return this.budgetData.budgets;
    }

    async openBudgetView() {
        // Activate existing leaf if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        const currentView = leaves[0]?.view;
        if (currentView instanceof ExpensicaDashboardView) {
            const dashboardView = currentView;
            dashboardView.showBudgetTab();
            await this.app.workspace.revealLeaf(leaves[0]);
        } else {
            // Open the dashboard first, then switch to the budget tab
            await this.openDashboard();
            window.setTimeout(() => {
                const dashboardView = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE)[0]?.view;
                if (dashboardView instanceof ExpensicaDashboardView) {
                    dashboardView.showBudgetTab();
                }
            }, 300); // Give some time for the view to initialize
        }
    }

    // Create a comprehensive daily finance review note
    async createDailyFinanceReview() {
        try {
            // Get today's date range
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            
            // Get yesterday's date range
            const yesterdayDate = new Date(now);
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterdayStart = new Date(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate());
            const yesterdayEnd = new Date(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate(), 23, 59, 59, 999);
            
            // Get all transactions
            const allTransactions = this.getAllTransactions();
            
            // Filter for different time periods
            const todaysTransactions = allTransactions.filter(transaction => {
                const transactionDate = parseLocalDate(transaction.date);
                return transactionDate >= todayStart && transactionDate <= todayEnd;
            });
            
            const yesterdayTransactions = allTransactions.filter(transaction => {
                const transactionDate = parseLocalDate(transaction.date);
                return transactionDate >= yesterdayStart && transactionDate <= yesterdayEnd;
            });
            
            // Format today's date for the note title
            const dateStr = formatDate(now);
            const noteTitle = `Daily Finance Review - ${dateStr}`;
            
            // Generate note content
            let noteContent = `> [!info] This note was automatically generated by Expensica on ${now.toLocaleString()}\n\n`;
            
            // Calculate summary metrics
            const todayIncome = TransactionAggregator.getTotalIncome(todaysTransactions);
            const todayExpenses = TransactionAggregator.getTotalExpenses(todaysTransactions);
            const todayBalance = TransactionAggregator.getBalance(todaysTransactions);
            
            const yesterdayExpenses = TransactionAggregator.getTotalExpenses(yesterdayTransactions);
            
            // Daily insights section
            noteContent += `## 📊 Daily Summary\n\n`;
            
            if (todaysTransactions.length === 0) {
                noteContent += `> [!note] No transactions recorded today.\n\n`;
            } else {
                noteContent += `**Today's Snapshot:**\n`;
                noteContent += `- **Income**: ${formatCurrency(todayIncome, this.settings.defaultCurrency)}\n`;
                noteContent += `- **Expenses**: ${formatCurrency(todayExpenses, this.settings.defaultCurrency)}\n`;
                noteContent += `- **Net Balance**: ${formatCurrency(todayBalance, this.settings.defaultCurrency)}\n`;
                noteContent += `- **Number of Transactions**: ${todaysTransactions.length}\n\n`;
                
                // Compare with yesterday
                if (yesterdayTransactions.length > 0) {
                    const expenseDiff = todayExpenses - yesterdayExpenses;
                    const expensePctChange = yesterdayExpenses !== 0 
                        ? (expenseDiff / yesterdayExpenses) * 100 
                        : todayExpenses > 0 ? 100 : 0;
                    
                    const expenseChangeText = expenseDiff > 0 
                        ? `${formatCurrency(expenseDiff, this.settings.defaultCurrency)} more than yesterday (${expensePctChange.toFixed(1)}% increase)` 
                        : expenseDiff < 0 
                            ? `${formatCurrency(Math.abs(expenseDiff), this.settings.defaultCurrency)} less than yesterday (${Math.abs(expensePctChange).toFixed(1)}% decrease)` 
                            : `the same as yesterday`;
                    
                    noteContent += `**Compared to Yesterday:**\n`;
                    noteContent += `- You spent ${expenseChangeText}\n`;
                }
            }
            
            // Today's transactions section
            if (todaysTransactions.length > 0) {
                noteContent += `## 📝 Today's Transactions\n\n`;
                noteContent += `| Description | Category | Amount | Notes |\n`;
                noteContent += `| ----------- | -------- | ------ | ----- |\n`;
                
                // Sort transactions by date and creation time (newest first)
                const sortedTransactions = sortTransactionsByDateTimeDesc(todaysTransactions, allTransactions);
                
                // Add each transaction to the table
                for (const transaction of sortedTransactions) {
                    const category = this.getCategoryById(transaction.category);
                    const categoryName = category ? `${this.getCategoryEmoji(category.id)} ${category.name}` : `${this.getCategoryEmoji('other_expense')} Other Expenses`;
                    const notes = transaction.notes || '';
                    
                    // Format amount with color indicator
                    const amountStr = transaction.type === TransactionType.INCOME 
                        ? `+${formatCurrency(transaction.amount, this.settings.defaultCurrency)}` 
                        : `-${formatCurrency(transaction.amount, this.settings.defaultCurrency)}`;
                    
                    noteContent += `| ${transaction.description} | ${categoryName} | ${amountStr} | ${notes} |\n`;
                }
                
                // Show expense breakdown by category
                const expensesByCategory = TransactionAggregator.getExpensesByCategory(
                    todaysTransactions.filter(t => t.type === TransactionType.EXPENSE),
                    this.settings.categories
                );
                
                if (Object.keys(expensesByCategory).length > 0) {
                    noteContent += `## 📊 Today's Spending Breakdown\n\n`;
                    
                    // Convert to array and sort by amount (highest first)
                    const categoryBreakdown = Object.entries(expensesByCategory)
                        .sort((a, b) => b[1] - a[1]);
                    
                    // Create a simple "text-based graph" with emojis
                    for (const [category, amount] of categoryBreakdown) {
                        const percentage = (amount / todayExpenses) * 100;
                        const barCount = Math.round(percentage / 5); // 20 bars would be 100%
                        const bar = '▓'.repeat(barCount) + '░'.repeat(20 - barCount);
                        
                        noteContent += `- **${category}**: ${formatCurrency(amount, this.settings.defaultCurrency)} (${percentage.toFixed(1)}%)\n`;
                        noteContent += `  ${bar} \n`;
                    }
                    noteContent += `\n`;
                }
            } else {
                noteContent += `## 📝 Today's Transactions\n\n`;
                noteContent += `No transactions recorded today.\n\n`;
            }
            
            // Create or update the note
            const files = this.app.vault.getMarkdownFiles();
            
            // Check if folder exists
            if (this.settings.dailyReviewFolder) {
                const folderExists = await this.app.vault.adapter.exists(this.settings.dailyReviewFolder);
                if (!folderExists) {
                    // Create the folder
                    await this.app.vault.createFolder(this.settings.dailyReviewFolder);
                }
            }
            
            // Determine note path
            const notePath = this.settings.dailyReviewFolder 
                ? `${this.settings.dailyReviewFolder}/${noteTitle}.md`
                : `${noteTitle}.md`;
            
            // Look for existing note
            const existingNote = files.find(file => file.path === notePath);
            
            if (existingNote) {
                await this.app.vault.modify(existingNote, noteContent);
                showExpensicaNotice(`Updated note: ${noteTitle}`);
                await this.app.workspace.getLeaf().openFile(existingNote);
            } else {
                const newNote = await this.app.vault.create(notePath, noteContent);
                showExpensicaNotice(`Created note: ${noteTitle}`);
                await this.app.workspace.getLeaf().openFile(newNote);
            }
        } catch {
            showExpensicaNotice('Failed to create daily finance review');
        }
    }

    // Add a command to create/update a daily review note for any date
    async createDailyFinanceReviewForDate() {
        try {
            // Create a modal to get the date from the user
            const modal = new DatePickerModal(this.app, async (selectedDate: Date) => {
                if (!selectedDate) return;

                // Get the date range for the selected date
                const dateStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
                const dateEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999);
                
                // Get all transactions
                const allTransactions = this.getAllTransactions();
                
                // Filter transactions for the selected date
                const dateTransactions = allTransactions.filter(transaction => {
                    const transactionDate = parseLocalDate(transaction.date);
                    return transactionDate >= dateStart && transactionDate <= dateEnd;
                });
                
                // Format the date for the note title
                const dateStr = formatDate(selectedDate);
                const noteTitle = `Daily Finance Review - ${dateStr}`;
                
                // Generate note content
                let noteContent = `> [!info] This note was automatically generated by Expensica on ${new Date().toLocaleString()}\n\n`;
                
                // Calculate summary metrics
                const dateIncome = TransactionAggregator.getTotalIncome(dateTransactions);
                const dateExpenses = TransactionAggregator.getTotalExpenses(dateTransactions);
                const dateBalance = TransactionAggregator.getBalance(dateTransactions);
                
                // Daily insights section
                noteContent += `## 📊 Daily Summary\n\n`;
                
                if (dateTransactions.length === 0) {
                    noteContent += `> [!note] No transactions recorded for this date.\n\n`;
                } else {
                    noteContent += `**Daily Snapshot:**\n`;
                    noteContent += `- **Income**: ${formatCurrency(dateIncome, this.settings.defaultCurrency)}\n`;
                    noteContent += `- **Expenses**: ${formatCurrency(dateExpenses, this.settings.defaultCurrency)}\n`;
                    noteContent += `- **Net Balance**: ${formatCurrency(dateBalance, this.settings.defaultCurrency)}\n`;
                    noteContent += `- **Number of Transactions**: ${dateTransactions.length}\n\n`;
                }
                
                // Transactions section
                if (dateTransactions.length > 0) {
                    noteContent += `## 📝 Transactions\n\n`;
                    noteContent += `| Description | Category | Amount | Notes |\n`;
                    noteContent += `| ----------- | -------- | ------ | ----- |\n`;
                    
                    // Sort transactions by date and creation time (newest first)
                    const sortedTransactions = sortTransactionsByDateTimeDesc(dateTransactions, allTransactions);
                    
                    // Add each transaction to the table
                    for (const transaction of sortedTransactions) {
                        const category = this.getCategoryById(transaction.category);
                        const categoryName = category ? `${this.getCategoryEmoji(category.id)} ${category.name}` : `${this.getCategoryEmoji('other_expense')} Other Expenses`;
                        const notes = transaction.notes || '';
                        
                        // Format amount with color indicator
                        const amountStr = transaction.type === TransactionType.INCOME 
                            ? `+${formatCurrency(transaction.amount, this.settings.defaultCurrency)}` 
                            : `-${formatCurrency(transaction.amount, this.settings.defaultCurrency)}`;
                        
                        noteContent += `| ${transaction.description} | ${categoryName} | ${amountStr} | ${notes} |\n`;
                    }
                    noteContent += `\n`;
                    
                    // Show expense breakdown by category
                    const expensesByCategory = TransactionAggregator.getExpensesByCategory(
                        dateTransactions.filter(t => t.type === TransactionType.EXPENSE),
                        this.settings.categories
                    );
                    
                    if (Object.keys(expensesByCategory).length > 0) {
                        noteContent += `## 📊 Spending Breakdown\n\n`;
                        
                        // Convert to array and sort by amount (highest first)
                        const categoryBreakdown = Object.entries(expensesByCategory)
                            .sort((a, b) => b[1] - a[1]);
                        
                        // Create a simple "text-based graph" with emojis
                        for (const [category, amount] of categoryBreakdown) {
                            const percentage = (amount / dateExpenses) * 100;
                            const barCount = Math.round(percentage / 5); // 20 bars would be 100%
                            const bar = '▓'.repeat(barCount) + '░'.repeat(20 - barCount);
                            
                            noteContent += `- **${category}**: ${formatCurrency(amount, this.settings.defaultCurrency)} (${percentage.toFixed(1)}%)\n`;
                            noteContent += `  ${bar} \n`;
                        }
                        noteContent += `\n`;
                    }
                } else {
                    noteContent += `## 📝 Transactions\n\n`;
                    noteContent += `No transactions recorded for this date.\n\n`;
                }
                
                // Create or update the note
                const files = this.app.vault.getMarkdownFiles();

                // Check if folder exists
                if (this.settings.dailyReviewFolder) {
                    const folderExists = await this.app.vault.adapter.exists(this.settings.dailyReviewFolder);
                    if (!folderExists) {
                        // Create the folder
                        await this.app.vault.createFolder(this.settings.dailyReviewFolder);
                    }
                }
                
                // Determine note path
                const notePath = this.settings.dailyReviewFolder 
                    ? `${this.settings.dailyReviewFolder}/${noteTitle}.md`
                    : `${noteTitle}.md`;
                
                // Look for existing note
                const existingNote = files.find(file => file.path === notePath);
                
                if (existingNote) {
                    await this.app.vault.modify(existingNote, noteContent);
                    showExpensicaNotice(`Updated note: ${noteTitle}`);
                    await this.app.workspace.getLeaf().openFile(existingNote);
                } else {
                    const newNote = await this.app.vault.create(notePath, noteContent);
                    showExpensicaNotice(`Created note: ${noteTitle}`);
                    await this.app.workspace.getLeaf().openFile(newNote);
                }
            });
            modal.open();
        } catch {
            showExpensicaNotice('Failed to create daily finance review');
        }
    }
}

// Settings tab
type ToggleSettingKey = 'showWeekNumbers' | 'showChartAxes' | 'showChartGrid' | 'showTransactionCategoryLabels'
    | 'enableAccounts' | 'enableBudgeting' | 'enableDailyFinanceReview' | 'enableDailyFinanceReviewForAnyDate';
const TOGGLE_SETTING_KEYS: ReadonlySet<string> = new Set<ToggleSettingKey>([
    'showWeekNumbers', 'showChartAxes', 'showChartGrid', 'showTransactionCategoryLabels',
    'enableAccounts', 'enableBudgeting', 'enableDailyFinanceReview', 'enableDailyFinanceReviewForAnyDate'
]);
const DASHBOARD_REFRESH_SETTINGS: ReadonlySet<ToggleSettingKey> = new Set<ToggleSettingKey>([
    'showChartAxes', 'showChartGrid', 'showTransactionCategoryLabels', 'enableAccounts', 'enableBudgeting'
]);
function isToggleSettingKey(key: string): key is ToggleSettingKey {
    return TOGGLE_SETTING_KEYS.has(key);
}
class ExpensicaSettingTab extends PluginSettingTab {
    plugin: ExpensicaPlugin;
    updateCustomColorVisibility: () => void;
    private cleanupCallbacks: Array<() => void> = [];

    constructor(app: App, plugin: ExpensicaPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    
    // Helper method to get preview color for color schemes
    private getColorPreview(scheme: ColorScheme): string {
        switch (scheme) {
            case ColorScheme.RED:
                return "#FF5252";
            case ColorScheme.BLUE:
                return "#0066CC";
            case ColorScheme.GREEN:
                return "#38A169";
            case ColorScheme.PURPLE:
                return "#805AD5";
            case ColorScheme.ORANGE:
                return "#ED8936";
            case ColorScheme.TEAL:
                return "#38B2AC";
            case ColorScheme.COLORBLIND_FRIENDLY:
                return "#FFBF00";
            case ColorScheme.CUSTOM:
                return this.plugin.settings.customCalendarColor;
            default:
                return "#FF5252"; // Default to red
        }
    }

    private registerCleanup(callback: () => void) {
        this.cleanupCallbacks.push(callback);
    }

    private clearCleanupCallbacks() {
        this.cleanupCallbacks.forEach((callback) => callback());
        this.cleanupCallbacks = [];
    }

    private async saveSettings(): Promise<void> {
        try {
            await this.plugin.saveSettings();
        } catch {
            showExpensicaNotice('Could not save settings.');
        }
    }

    private registerOutsideClick(
        owner: HTMLElement,
        onOutsideClick: () => void
    ) {
        const documentClickHandler = (event: MouseEvent) => {
            if (event.target instanceof Node && !owner.contains(event.target)) {
                onOutsideClick();
            }
        };

        document.addEventListener('click', documentClickHandler);
        this.registerCleanup(() => {
            document.removeEventListener('click', documentClickHandler);
        });
    }

    display(): void {
        this.renderSettings();
    }

    refreshSettings(): void {
        this.renderSettings();
    }

    private renderSettings(): void {
        const { containerEl } = this;
        this.clearCleanupCallbacks();

        containerEl.empty();
        containerEl.addClass('expensica-settings-container');

        // Obsidian 1.13+ renders getSettingDefinitions() itself; this keeps older versions working.
        const renderItems = (items: SettingDefinitionItem[], parent: HTMLElement): void => {
            for (const item of items) {
                if ('items' in item && item.items && (item.type === 'group' || item.type === 'list')) {
                    const groupEl = parent.createDiv('expensica-settings-section');
                    if (item.heading) new Setting(groupEl).setName(item.heading).setHeading();
                    renderItems(item.items, groupEl);
                } else if ('render' in item && typeof item.render === 'function') {
                    const setting = new Setting(parent).setName(item.name);
                    if (typeof item.desc === 'string') setting.setDesc(item.desc);
                    item.render(setting, undefined as never);
                } else if ('control' in item && item.control?.type === 'toggle') {
                    const { key } = item.control;
                    const setting = new Setting(parent).setName(item.name);
                    if (typeof item.desc === 'string') setting.setDesc(item.desc);
                    setting.addToggle(toggle => toggle
                        .setValue(this.getControlValue(key) === true)
                        .onChange(voidAsync(async (value: boolean) => {
                            await this.setControlValue(key, value);
                        })));
                }
            }
        };
        renderItems(this.getSettingDefinitions(), containerEl);
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const toggle = (key: ToggleSettingKey, name: string, desc: string): SettingDefinitionItem => ({
            name,
            desc,
            control: { type: 'toggle', key }
        });
        return [
            {
                name: 'Default Currency',
                desc: 'Select the currency to use for all transactions.',
                render: (setting: Setting) => this.renderCurrencySetting(setting)
            },
            {
                name: 'Time Format',
                desc: 'Choose 12-hour or 24-hour time for transactions and chart hour labels.',
                render: (setting: Setting) => this.renderTimeFormatSetting(setting)
            },
            {
                name: 'Calendar Color Scheme',
                desc: 'Select the color scheme for the calendar visualization.',
                render: (setting: Setting) => this.renderCalendarColorSetting(setting)
            },
            toggle('showWeekNumbers', 'Show Week Numbers', 'Display week numbers in the calendar visualization.'),
            toggle('showChartAxes', 'Show Chart Axes', 'Display chart axis lines and values in dashboard charts.'),
            toggle('showChartGrid', 'Show Chart Grid', 'Display chart grid lines in dashboard charts.'),
            toggle('showTransactionCategoryLabels', 'Show Transaction Category Labels', 'Display colored category labels on transaction cards.'),
            toggle('enableAccounts', 'Enable Accounts', 'Enable or disable account features.'),
            toggle('enableBudgeting', 'Enable Budgeting', 'Enable or disable the budgeting features.'),
            toggle('enableDailyFinanceReview', 'Enable Daily Finance Review (For Today)', 'Enable or disable the ability to create daily finance reviews for today.'),
            toggle('enableDailyFinanceReviewForAnyDate', 'Enable Daily Finance Review for Any Date', 'Enable or disable the ability to create/update daily finance reviews for any date.'),
            {
                name: 'Daily Finance Review Folder',
                desc: 'Select a folder where all daily finance review notes will be stored.',
                render: (setting: Setting) => this.renderReviewFolderSetting(setting)
            },
            {
                type: 'group',
                heading: 'Data Management',
                items: [
                    {
                        name: 'Export data',
                        desc: 'Export your transactions with advanced filtering options',
                        render: (setting: Setting) => this.renderExportSetting(setting)
                    },
                    {
                        name: 'Import data',
                        desc: 'Import transactions from a JSON file',
                        render: (setting: Setting) => this.renderImportSetting(setting)
                    }
                ]
            }
        ];
    }

    getControlValue(key: string): unknown {
        return (this.plugin.settings as unknown as Record<string, unknown>)[key];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        if (!isToggleSettingKey(key) || typeof value !== 'boolean') return;
        this.plugin.settings[key] = value;
        await this.saveSettings();
        if (DASHBOARD_REFRESH_SETTINGS.has(key)) {
            this.plugin.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE).forEach((leaf) => {
                if (leaf.view instanceof ExpensicaDashboardView) {
                    leaf.view.renderDashboard();
                }
            });
        }
    }

    private renderCurrencySetting(setting: Setting): void {
        setting
            .then((setting) => {
                const container = setting.controlEl.createDiv('currency-dropdown-container');
                this.renderCurrencyDropdown(
                    container,
                    this.plugin.settings.defaultCurrency,
                    async (value) => {
                        this.plugin.settings.defaultCurrency = value;
                        await this.saveSettings();
                    }
                );
            });

    }

    private renderTimeFormatSetting(setting: Setting): void {
        setting
            .then((setting) => {
                const container = setting.controlEl.createDiv('currency-dropdown-container');
                this.renderTimeFormatDropdown(
                    container,
                    this.plugin.settings.timeFormat,
                    async (value) => {
                        this.plugin.settings.timeFormat = value;
                        await this.saveSettings();

                        this.plugin.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE).forEach((leaf) => {
                            if (leaf.view instanceof ExpensicaDashboardView) {
                                leaf.view.renderDashboard();
                            }
                        });
                    }
                );
            });

    }

    private renderCalendarColorSetting(setting: Setting): void {
        setting
            .then((setting) => {
                const container = setting.controlEl.createDiv('color-dropdown-container');
                
                // Create the select display
                const selectDisplay = container.createEl('button', {
                    cls: 'expensica-select-display expensica-standard-button expensica-settings-select-button',
                    attr: { type: 'button', 'aria-label': 'Select calendar color scheme' }
                });
                const previewColor = this.getColorPreview(this.plugin.settings.calendarColorScheme);
                const colorPreview = selectDisplay.createDiv('color-preview color-preview-bg');
                colorPreview.setCssProps({ '--color-preview': previewColor });

                const selectText = selectDisplay.createSpan({ cls: 'expensica-select-display-text' });
                selectText.textContent = this.plugin.settings.calendarColorScheme.charAt(0).toUpperCase() + this.plugin.settings.calendarColorScheme.slice(1);
                
                const selectArrow = selectDisplay.createSpan({ cls: 'expensica-select-arrow' });
                createChevronIcon(selectArrow, 14);
                
                const optionsContainer = container.createDiv('expensica-select-options expensica-select-hidden expensica-settings-select-options');
                
                // Color options
                const colorOptions = [
                    { value: ColorScheme.RED, text: 'Red' },
                    { value: ColorScheme.BLUE, text: 'Blue' },
                    { value: ColorScheme.GREEN, text: 'Green' },
                    { value: ColorScheme.PURPLE, text: 'Purple' },
                    { value: ColorScheme.ORANGE, text: 'Orange' },
                    { value: ColorScheme.TEAL, text: 'Teal' },
                    { value: ColorScheme.COLORBLIND_FRIENDLY, text: 'Colorblind Friendly' },
                    { value: ColorScheme.CUSTOM, text: 'Custom' }
                ];
                
                colorOptions.forEach(option => {
                    const optionEl = optionsContainer.createEl('button', {
                        cls: 'expensica-select-option expensica-standard-button expensica-settings-select-option',
                        attr: { type: 'button' }
                    });
                    const optionColorPreview = optionEl.createDiv('color-preview');
                    optionColorPreview.setCssStyles({ backgroundColor: this.getColorPreview(option.value) });
                    optionEl.createSpan({ text: option.text });
                    
                    if (this.plugin.settings.calendarColorScheme === option.value) {
                        optionEl.addClass('expensica-option-selected');
                    }
                    
                    optionEl.addEventListener('click', voidAsync(async () => {
                        this.plugin.settings.calendarColorScheme = option.value;
                        await this.saveSettings();
                        
                        // Update the display
                        colorPreview.setCssProps({ '--color-preview': this.getColorPreview(option.value) });
                        selectText.textContent = option.text;
                        
                        // Hide the options
                        optionsContainer.classList.add('expensica-select-hidden');
                        selectArrow.classList.remove('expensica-select-arrow-open');
                        
                        // Show/hide custom color input
                        this.updateCustomColorVisibility();
                    }));
                });
                
                // Toggle options on click
                selectDisplay.addEventListener('click', () => {
                    const isHidden = optionsContainer.classList.contains('expensica-select-hidden');
                    optionsContainer.classList.toggle('expensica-select-hidden', !isHidden);
                    selectArrow.classList.toggle('expensica-select-arrow-open', !isHidden);
                    if (!isHidden) {
                        const input = selectDisplay.querySelector('input');
                        if (input) input.focus();
                    }
                });

                this.registerOutsideClick(container, () => {
                    optionsContainer.classList.add('expensica-select-hidden');
                    selectArrow.classList.remove('expensica-select-arrow-open');
                });
            });
            
        // Custom color container (visible only when Custom is selected)
        const customColorContainer = setting.controlEl.createDiv('custom-color-container');
        
        if (this.plugin.settings.calendarColorScheme === ColorScheme.CUSTOM) {
            customColorContainer.classList.add('custom-color-container-flex');
        } else {
            customColorContainer.classList.add('custom-color-container-hidden');
        }
        
        const colorInput = customColorContainer.createEl('input', {
            type: 'color',
            value: this.plugin.settings.customCalendarColor
        });
        
        colorInput.addEventListener('change', voidAsync(async () => {
            this.plugin.settings.customCalendarColor = colorInput.value;
            await this.saveSettings();
        }));
        
        // Method to update custom color visibility
        this.updateCustomColorVisibility = () => {
            if (this.plugin.settings.calendarColorScheme === ColorScheme.CUSTOM) {
                customColorContainer.classList.remove('custom-color-container-hidden');
                customColorContainer.classList.add('custom-color-container-flex');
            } else {
                customColorContainer.classList.remove('custom-color-container-flex');
                customColorContainer.classList.add('custom-color-container-hidden');
            }
        };

    }

    private renderReviewFolderSetting(setting: Setting): void {
        let folderText: TextComponent | null = null;
        setting
            .addText(text => {
                folderText = text;
                text
                    .setPlaceholder('Example: Daily Finance Reviews')
                    .setValue(this.plugin.settings.dailyReviewFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.dailyReviewFolder = value;
                        await this.saveSettings();
                    });
            })
            .addButton(button => button
                .setButtonText('Browse')
                .onClick(async () => {
                    new FolderSuggestionModal(this.app, this.plugin, async (folder) => {
                        this.plugin.settings.dailyReviewFolder = folder;
                        await this.saveSettings();
                        folderText?.setValue(folder);
                    }).open();
                }));
    }

    private renderExportSetting(setting: Setting): void {
        setting
            .addButton(button => button
                .setButtonText('Export Transactions')
                .onClick(() => {
                    this.plugin.openExportModal();
                }));
    }

    private renderImportSetting(setting: Setting): void {
        setting
            .addButton(button => button
                .setButtonText('Import')
                .onClick(() => {
                    this.plugin.openImportModal();
                }));
    }

    hide(): void {
        this.clearCleanupCallbacks();
        super.hide();
    }

    renderCurrencyDropdown(
        container: HTMLElement,
        selectedCode: string,
        onChange: (currencyCode: string) => void | Promise<void>
    ): void {
        // Create the main container
        const currencySelectContainer = container.createDiv('currency-select-container');
        
        // Create the display element
        const currencyDisplay = currencySelectContainer.createDiv('expensica-select-display');
        
        // Get the selected currency
        const selectedCurrency = getCurrencyByCode(selectedCode);
        
        // Create the display text
        const currencyDisplayText = currencyDisplay.createDiv('expensica-select-text');
        currencyDisplayText.textContent = selectedCurrency
            ? `${selectedCurrency.code} ${selectedCurrency.symbol} - ${selectedCurrency.name}`
            : 'Choose a valid currency';
        
        // Create the arrow icon
        const arrowIcon = currencyDisplay.createDiv('expensica-select-arrow');
        createChevronIcon(arrowIcon, 12);
        
        // Create the options container
        const currencyOptions = currencySelectContainer.createDiv('expensica-select-options expensica-select-hidden');
        
        // Add search input
        const searchContainer = currencyOptions.createDiv('currency-search-container');
        // Create options
        const optionsContainer = currencyOptions.createDiv('currency-options-container');
        
        // Function to filter and render options
        const renderFilteredOptions = (searchTerm = '') => {
            optionsContainer.empty();
            const filteredCurrencies = COMMON_CURRENCIES.filter(currency => {
                const searchLower = searchTerm.toLowerCase();
                return currency.code.toLowerCase().includes(searchLower) ||
                       currency.name.toLowerCase().includes(searchLower) ||
                       currency.symbol.toLowerCase().includes(searchLower);
            });
            
            filteredCurrencies.forEach(currency => {
                const optionItem = optionsContainer.createDiv('expensica-select-option');
                optionItem.textContent = `${currency.code} ${currency.symbol} - ${currency.name}`;
                
                if (currency.code === selectedCode) {
                    optionItem.addClass('expensica-option-selected');
                }
                
                optionItem.addEventListener('click', () => {
                    void Promise.resolve(onChange(currency.code)).catch(() => {
                        showExpensicaNotice('Could not save the selected currency.');
                    });
                    currencyDisplayText.textContent = `${currency.code} ${currency.symbol} - ${currency.name}`;
                    currencyOptions.addClass('expensica-select-hidden');
                    arrowIcon.removeClass('expensica-select-arrow-open');
                });
            });
        };
        
        // Initial render
        renderFilteredOptions();
        
        let searchInput: HTMLInputElement | null = null;
        new Setting(searchContainer)
            .setClass('currency-search-setting')
            .addSearch(search => {
                search.setPlaceholder('Search currencies...')
                    .onChange(searchTerm => renderFilteredOptions(searchTerm));
                search.inputEl.addClass('currency-search-input');
                searchInput = search.inputEl;
            });
        
        // Toggle dropdown
        currencyDisplay.addEventListener('click', () => {
            const isHidden = currencyOptions.hasClass('expensica-select-hidden');
            currencyOptions.toggleClass('expensica-select-hidden', !isHidden);
            arrowIcon.toggleClass('expensica-select-arrow-open', !isHidden);
            if (!isHidden) {
                searchInput?.focus();
            }
        });

        this.registerOutsideClick(currencySelectContainer, () => {
            currencyOptions.addClass('expensica-select-hidden');
            arrowIcon.removeClass('expensica-select-arrow-open');
        });
    }

    renderTimeFormatDropdown(
        container: HTMLElement,
        selectedFormat: '12' | '24',
        onChange: (timeFormat: '12' | '24') => void | Promise<void>
    ): void {
        const selectContainer = container.createDiv('currency-select-container');
        const selectDisplay = selectContainer.createDiv('expensica-select-display');
        const selectText = selectDisplay.createDiv('expensica-select-text');
        const arrowIcon = selectDisplay.createDiv('expensica-select-arrow');
        const optionsContainer = selectContainer.createDiv('expensica-select-options expensica-select-hidden');
        const options = [
            { value: '12' as const, label: '12 hours' },
            { value: '24' as const, label: '24 hours' }
        ];

        const updateSelectedText = (value: '12' | '24') => {
            const selectedOption = options.find(option => option.value === value) ?? options[0];
            selectText.textContent = selectedOption.label;
        };

        updateSelectedText(selectedFormat);
        createChevronIcon(arrowIcon, 12);

        options.forEach((option) => {
            const optionItem = optionsContainer.createDiv('expensica-select-option');
            optionItem.textContent = option.label;

            if (option.value === selectedFormat) {
                optionItem.addClass('expensica-option-selected');
            }

            optionItem.addEventListener('click', () => {
                void Promise.resolve(onChange(option.value)).catch(() => {
                    showExpensicaNotice('Could not save the selected time format.');
                });
                updateSelectedText(option.value);
                optionsContainer.addClass('expensica-select-hidden');
                arrowIcon.removeClass('expensica-select-arrow-open');

                Array.from(optionsContainer.children).forEach((child, index) => {
                    child.toggleClass?.('expensica-option-selected', options[index].value === option.value);
                });
            });
        });

        selectDisplay.addEventListener('click', () => {
            const isHidden = optionsContainer.hasClass('expensica-select-hidden');
            optionsContainer.toggleClass('expensica-select-hidden', !isHidden);
            arrowIcon.toggleClass('expensica-select-arrow-open', !isHidden);
        });

        this.registerOutsideClick(selectContainer, () => {
            optionsContainer.addClass('expensica-select-hidden');
            arrowIcon.removeClass('expensica-select-arrow-open');
        });
    }

}

// Import Modal with improved UI
class TransactionSummaryModal extends Modal {
    constructor(app: App, private readonly summary: string, private readonly corrections: string[]) {
        super(app);
        preventBackdropDismissal(this);
    }

    onOpen() {
        this.contentEl.addClass('expensica-modal');
        this.contentEl.createEl('h2', { text: 'Transaction data update' });
        if (this.corrections.length) {
            const list = this.contentEl.createEl('ul');
            this.corrections.forEach(correction => list.createEl('li', { text: correction }));
        }
        this.contentEl.createEl('p', { text: this.summary });
        const buttons = this.contentEl.createDiv('modal-button-container');
        buttons.createEl('button', { text: 'OK', cls: 'mod-cta' })
            .addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

class AccountReconciliationModal extends Modal {
    readonly choices = new Map<string, string>();
    readonly drafts = new Map<string, Account>();
    child: AccountResolutionStepModal | null = null;
    bulkSelection: string | undefined;
    saving = false;
    closed = false;
    private errorEl: HTMLElement;

    constructor(app: App, readonly plugin: ExpensicaPlugin, readonly validation: TransactionValidationError,
        private readonly commit: (choices: Map<string, string>, drafts: Account[]) => Promise<void>) {
        super(app);
        preventBackdropDismissal(this);
    }

    onOpen() {
        this.closed = false;
        this.contentEl.empty();
        this.contentEl.addClass('expensica-modal');
        this.contentEl.createEl('h2', { text: 'Resolve missing accounts' });
        this.contentEl.createEl('p', { text: 'Link to an existing account or create a new one. Nothing is saved until confirmed.' });
        const actions = this.contentEl.createDiv('expensica-reconcile-actions');
        for (const [mode, text] of [['each', 'For each reference'], ['all', 'For all unknown accounts']] as const) {
            actions.createEl('button', { text, cls: 'expensica-standard-button' }).addEventListener('click', () => this.start(mode));
        }
        this.errorEl = this.contentEl.createEl('p', { cls: 'expensica-reconcile-error' });
        this.contentEl.createDiv('modal-button-container').createEl('button', { text: 'Cancel' })
            .addEventListener('click', () => this.close());
    }

    start(mode: 'each' | 'all') {
        if (this.saving || this.closed || this.child) return;
        this.child = new AccountResolutionStepModal(this.app, this, mode);
        this.child.open();
    }

    availableAccounts(): Map<string, Account> {
        const accounts = new Map(this.plugin.getAccounts().map(account => [account.id, account]));
        for (const draft of this.drafts.values()) if (!accounts.has(draft.id)) accounts.set(draft.id, draft);
        return accounts;
    }

    isDraft(id: string): boolean {
        return this.drafts.has(id) && !this.plugin.getAccounts().some(account => account.id === id);
    }

    stageDraft(account: Account, previous?: Account) {
        if (this.closed) return;
        const draft = { ...account, id: previous?.id || account.id };
        const accounts = this.availableAccounts();
        if ((!previous && accounts.has(draft.id)) || (previous && !this.isDraft(previous.id))) {
            throw new TransactionValidationError(null, 'accounts', 'this account is already saved or its ID is in use', 'Link the existing account instead.');
        }
        const reference = formatAccountReference(draft.type, draft.name);
        if (Array.from(accounts.values()).some(existing => existing.id !== draft.id
            && formatAccountReference(existing.type, existing.name) === reference)) {
            throw new TransactionValidationError(null, 'accounts', 'an account with this name and type already exists', 'Link the existing account instead.');
        }
        this.drafts.set(draft.id, draft);
        return draft;
    }

    removeDraft(id: string) {
        if (this.saving || !this.isDraft(id)) return;
        this.plugin.releaseSaveOperation(this);
        this.drafts.delete(id);
        for (const [reference, selected] of this.choices) if (selected === id) this.choices.delete(reference);
        if (this.bulkSelection === id) this.bulkSelection = undefined;
        this.child?.render();
    }

    confirm(): Promise<boolean> {
        if (this.saving || this.closed || this.validation.missingAccounts.some(group => !this.choices.get(group.reference))) {
            return Promise.resolve(false);
        }
        const choices = new Map(this.choices);
        const drafts = Array.from(this.drafts.values(), draft => ({ ...draft }));
        return this.plugin.runSaveOperation(this, 'Reconcile accounts', async () => {
            if (this.saving) return false;
            this.saving = true;
            this.child?.setSaving(true);
            try {
                await this.commit(choices, drafts);
                this.saving = false;
                this.close();
                return true;
            } catch (error) {
                if (!(error instanceof TransactionValidationError)) throw error;
                const message = error.message + ' ' + error.action;
                this.errorEl.textContent = message;
                this.child?.showError(message);
                return false;
            } finally {
                this.saving = false;
                this.child?.setSaving(false);
            }
        });
    }

    close() {
        if (!this.saving) super.close();
    }

    onClose() {
        this.closed = true;
        this.child?.close();
        this.child = null;
        this.choices.clear();
        this.drafts.clear();
        this.bulkSelection = undefined;
        this.plugin.releaseSaveOperation(this);
        this.contentEl.empty();
    }
}

class AccountResolutionStepModal extends Modal {
    private index = 0;
    private summary = false;
    private selectedId: string | undefined;
    private pickerOpen = false;
    private editor: AccountEditorModal | null = null;
    private errorEl: HTMLElement;

    constructor(app: App, private readonly owner: AccountReconciliationModal, private readonly mode: 'each' | 'all') {
        super(app);
        preventBackdropDismissal(this);
        this.selectedId = mode === 'all' ? owner.bulkSelection : owner.choices.get(owner.validation.missingAccounts[0].reference);
    }

    onOpen() { this.render(); }

    private fullAccountName(account: Account): string {
        const name = account.name.charAt(0).toUpperCase() + account.name.slice(1);
        const type = account.type === AccountType.SAVING ? 'Saving' : getAccountTypeLabel(account.type);
        return name + ' - ' + type;
    }

    private accountLabel(account: Account): string {
        return getAccountEmoji(account.type) + ' ' + this.fullAccountName(account)
            + (this.owner.isDraft(account.id) ? ' (will be created)' : '');
    }

    render() {
        const { contentEl } = this;
        const accounts = this.owner.availableAccounts();
        if (!accounts.has(this.selectedId || '')) this.selectedId = undefined;
        contentEl.empty();
        contentEl.addClass('expensica-modal');
        contentEl.createEl('h2', { text: this.summary ? 'Confirm account changes'
            : this.mode === 'all' ? 'Resolve all unknown accounts' : 'Resolve missing account' });
        if (this.summary) {
            const selected = Array.from(new Set(this.owner.choices.values()))
                .map(id => accounts.get(id)).filter((account): account is Account => !!account);
            for (const [draft, label] of [[true, 'New accounts to create'], [false, 'Existing accounts to link']] as const) {
                const list = selected.filter(account => this.owner.isDraft(account.id) === draft);
                contentEl.createEl('p', { text: label + ': ' + list.length });
                const items = contentEl.createEl('ul');
                for (const account of list) items.createEl('li', {
                    text: getAccountEmoji(account.type) + ' ' + this.fullAccountName(account)
                }).setCssStyles({ color: getAccountColor(account) });
            }
        } else {
            const groups = this.owner.validation.missingAccounts;
            if (this.mode === 'each') {
                const group = groups[this.index];
                contentEl.createEl('p', { text: (group.reference || '(missing account)') + ': ' + group.count
                    + (group.count === 1 ? ' transaction' : ' transactions'), cls: 'expensica-recovery-modal-file' });
                contentEl.createEl('p', { text: 'Reference ' + (this.index + 1) + ' of ' + groups.length });
            } else {
                contentEl.createEl('p', { text: 'Choose one destination for all ' + groups.length + ' unknown account references.' });
            }
            const actions = contentEl.createDiv('expensica-reconcile-actions');
            const accountActions = actions.createDiv('expensica-reconcile-account-actions');
            renderCreateAccountCard(accountActions, { label: 'Create new account', description: 'Define a new account.',
                onClick: () => { if (!this.owner.saving) this.editDraft(); } });
            renderCreateAccountCard(accountActions, { label: 'Link existing account', description: 'Choose a saved or drafted account.', icon: '\u2197',
                onClick: () => { if (!this.owner.saving) { this.pickerOpen = !this.pickerOpen; this.render(); } } });
            if (this.pickerOpen) {
                const menu = actions.createDiv({ cls: 'expensica-select-options expensica-reconcile-account-list', attr: { role: 'menu' } });
                for (const account of accounts.values()) {
                    const row = menu.createDiv('expensica-reconcile-account-option');
                    const option = row.createEl('button', { text: this.accountLabel(account), cls: 'expensica-select-option',
                        attr: { type: 'button', role: 'menuitemradio', 'data-account-id': account.id,
                            'aria-checked': String(this.selectedId === account.id) } });
                    option.setCssStyles({ color: getAccountColor(account) });
                    option.addEventListener('click', () => {
                        if (this.owner.saving) return;
                        this.selectedId = account.id;
                        this.pickerOpen = false;
                        this.render();
                    });
                    if (this.owner.isDraft(account.id)) {
                        row.createEl('button', { text: 'Edit', cls: 'expensica-standard-button' })
                            .addEventListener('click', () => { if (!this.owner.saving) this.editDraft(account); });
                        row.createEl('button', { text: 'Remove', cls: 'expensica-standard-button' })
                            .addEventListener('click', () => this.owner.removeDraft(account.id));
                    }
                }
                if (!accounts.size) menu.createEl('p', { text: 'No accounts available. Create a new account.' });
                menu.addEventListener('keydown', event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        this.pickerOpen = false;
                        this.render();
                        this.contentEl.querySelectorAll<HTMLElement>('.expensica-account-card')[1]?.focus();
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
                        const current = options.findIndex(option => option === event.target);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                            : event.key === 'ArrowDown' ? (current + 1) % options.length
                            : current <= 0 ? options.length - 1 : current - 1;
                        options[next]?.focus();
                    }
                });
            }
            const selected = accounts.get(this.selectedId || '');
            if (selected) contentEl.createEl('p', { text: 'Selected: ' + this.accountLabel(selected) })
                .setCssStyles({ color: getAccountColor(selected) });
        }
        this.errorEl = contentEl.createEl('p', { cls: 'expensica-reconcile-error' });
        const buttons = contentEl.createDiv('modal-button-container');
        buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.back());
        const confirm = buttons.createEl('button', { text: this.summary || this.mode === 'all' ? 'Confirm' : 'Next', cls: 'mod-cta' });
        confirm.disabled = this.summary
            ? this.owner.validation.missingAccounts.some(group => !accounts.has(this.owner.choices.get(group.reference) || ''))
            : !this.selectedId;
        confirm.addEventListener('click', voidAsync(async () => {
            if (this.owner.saving || confirm.disabled) return;
            if (this.summary) { await this.owner.confirm(); return; }
            const selectedId = this.selectedId;
            if (!selectedId) return;
            if (this.mode === 'all') {
                this.owner.bulkSelection = this.selectedId;
                for (const group of this.owner.validation.missingAccounts) this.owner.choices.set(group.reference, selectedId);
                await this.owner.confirm();
                return;
            }
            this.owner.choices.set(this.owner.validation.missingAccounts[this.index].reference, selectedId);
            if (this.index + 1 === this.owner.validation.missingAccounts.length) this.summary = true;
            else {
                this.index++;
                this.selectedId = this.owner.choices.get(this.owner.validation.missingAccounts[this.index].reference);
            }
            this.pickerOpen = false;
            this.render();
        }));
    }

    private editDraft(previous?: Account) {
        this.editor = new AccountEditorModal(this.app, this.owner.plugin, null, previous || null, account => {
            if (this.owner.closed) return;
            const draft = this.owner.stageDraft(account, previous);
            this.selectedId = draft?.id;
            this.editor = null;
            this.render();
        });
        this.editor.open();
    }

    private back() {
        if (this.owner.saving) return;
        if (this.pickerOpen) {
            this.pickerOpen = false;
            this.render();
            return;
        }
        this.owner.plugin.releaseSaveOperation(this.owner);
        if (!this.summary && this.mode === 'each' && this.selectedId) {
            this.owner.choices.set(this.owner.validation.missingAccounts[this.index].reference, this.selectedId);
        }
        if (this.summary) this.summary = false;
        else if (this.mode === 'all' || this.index === 0) {
            if (this.mode === 'all') this.owner.bulkSelection = this.selectedId;
            this.close();
            return;
        } else {
            this.index--;
        }
        this.selectedId = this.owner.choices.get(this.owner.validation.missingAccounts[this.index].reference);
        this.pickerOpen = false;
        this.render();
    }

    showError(message: string) { this.errorEl.textContent = message; }

    setSaving(saving: boolean) {
        this.contentEl.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = saving; });
        this.contentEl.querySelectorAll('[role="button"]').forEach(card => card.setAttribute('aria-disabled', String(saving)));
    }

    close() { if (!this.owner.saving) super.close(); }

    onClose() {
        this.editor?.close();
        this.owner.child = null;
        this.contentEl.empty();
    }
}

class ImportModal extends Modal {
    private source: string | TransactionImportSource | null = null;
    private fileInput: HTMLInputElement;
    private messageEl: HTMLElement;
    private actionEl: HTMLElement;
    private errorsEl: HTMLElement;
    private importButton: HTMLButtonElement;
    private chooseButton: HTMLButtonElement;
    private choosing = false;
    private dismissed = false;
    private retryWithPicker = false;

    constructor(app: App, private readonly plugin: ExpensicaPlugin) {
        super(app);
        preventBackdropDismissal(this);
    }

    open() {
        if (this.plugin.canEditData(["transactions","accounts"])) super.open();
    }

    onOpen() {
        this.dismissed = false;
        const { contentEl } = this;
        contentEl.addClass('expensica-modal');
        contentEl.addClass('expensica-import-modal');
        contentEl.createEl('h2', { text: 'Import transactions', cls: 'expensica-modal-title' });
        this.messageEl = contentEl.createEl('p', { text: 'Choose a JSON file.' });
        this.messageEl.setAttribute('aria-live', 'polite');
        this.errorsEl = contentEl.createDiv();
        this.errorsEl.hidden = true;
        this.errorsEl.setCssStyles({ color: 'var(--text-error)' });
        this.actionEl = contentEl.createEl('p');
        this.actionEl.hidden = true;
        this.fileInput = contentEl.createEl('input', {
            attr: { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose JSON file' }
        });
        this.fileInput.hidden = true;
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            if (file && !this.dismissed) this.selectSource(file, true);
        });
        const buttonContainer = contentEl.createDiv('expensica-import-buttons');
        const closeButton = buttonContainer.createEl('button', {
            text: 'Close',
            cls: 'expensica-btn expensica-btn-secondary'
        });
        this.chooseButton = buttonContainer.createEl('button', {
            text: 'Choose JSON', cls: 'expensica-btn expensica-btn-secondary'
        });
        this.importButton = buttonContainer.createEl('button', {
            text: 'Import',
            cls: 'expensica-btn expensica-btn-primary'
        });
        this.importButton.disabled = true;
        closeButton.addEventListener('click', () => this.close());
        this.chooseButton.addEventListener('click', voidAsync(() => this.browse()));
        this.importButton.addEventListener('click', voidAsync(async () => {
            if (this.retryWithPicker && this.importButton.textContent === 'Retry') {
                await this.browse();
                return;
            }
            await this.plugin.runSaveOperation(this, 'Import transactions', async () => {
                if (!this.source || this.importButton.disabled) return false;
                const source = this.source;
                this.importButton.disabled = true;
                this.chooseButton.disabled = true;
                try {
                    const imported = await this.plugin.importTransactionsFromJSON(source);
                    if (imported && !this.dismissed) this.close();
                    return imported;
                } catch (error) {
                    if (error instanceof TransactionValidationError) {
                        this.messageEl.textContent = 'Import errors';
                        this.messageEl.setCssStyles({ color: 'var(--text-error)' });
                        this.errorsEl.empty();
                        this.errorsEl.hidden = false;
                        const list = this.errorsEl.createEl('ul');
                        for (const message of error.messages.slice(0, 7)) list.createEl('li', { text: message });
                        const remaining = error.errors.length - 7;
                        if (remaining > 0) {
                            this.errorsEl.createEl('p', { text: '...' });
                            this.errorsEl.createEl('p', { text: `${remaining} more ${remaining === 1 ? 'error' : 'errors'}.` });
                        }
                        this.actionEl.textContent = this.retryWithPicker && error.field !== 'file'
                            ? 'Correct the JSON file, then Retry to select it again.' : error.action;
                        this.actionEl.hidden = false;
                        if (error.canReconcileAccounts) {
                            this.actionEl.createEl('button', { text: 'Resolve accounts', cls: 'mod-cta' })
                                .addEventListener('click', voidAsync(async () => {
                                    try { await this.plugin.openAccountReconciliation(source, () => { if (!this.dismissed) this.close(); }); }
                                    catch { this.messageEl.textContent = 'Could not open account reconciliation. Check the file, then Retry.'; }
                                }));
                        }
                        this.chooseButton.hidden = true;
                        this.importButton.textContent = 'Retry';
                        return false;
                    }
                    throw error;
                } finally {
                    this.importButton.disabled = false;
                    this.chooseButton.disabled = false;
                }
            });
        }));
        this.browse();
    }

    private selectSource(source: string | TransactionImportSource, retryWithPicker = false) {
        this.source = source;
        this.retryWithPicker = retryWithPicker;
        this.messageEl.textContent = typeof source === 'string' ? source.split(/[\\/]/).pop() || '' : source.name;
        this.messageEl.setCssStyles({ color: '' });
        this.actionEl.hidden = true;
        this.errorsEl.empty();
        this.errorsEl.hidden = true;
        this.chooseButton.hidden = false;
        this.importButton.textContent = 'Import';
        this.importButton.disabled = false;
    }

    private async browse(): Promise<void> {
        if (this.choosing || this.dismissed) return;
        this.choosing = true;
        this.chooseButton.disabled = true;
        try {
            this.fileInput.value = '';
            if (Platform.isDesktopApp && this.app.vault.adapter instanceof FileSystemAdapter) {
                let dialog: NativeFileDialog | undefined;
                try {
                    dialog = getNativeFileDialog(await importOptionalModule('@electron/remote'));
                } catch {
                    try {
                        dialog = getNativeFileDialog(await importOptionalModule('electron'));
                    } catch {
                        dialog = undefined;
                    }
                }

                if (dialog) {
                    const path = await import('path');
                    const result = await dialog.showOpenDialog({
                        defaultPath: path.join(this.app.vault.adapter.getBasePath(), this.plugin.dataFolderPath),
                        filters: [{ name: 'JSON files', extensions: ['json'] }],
                        properties: ['openFile']
                    });
                    if (this.dismissed || result.canceled || !result.filePaths[0]) return;
                    const filePath = result.filePaths[0];
                    this.selectSource({
                        name: path.basename(filePath),
                        text: async () => {
                            if (!Platform.isDesktopApp) throw new Error('Native file access is only available on desktop.');
                            const fs = await import('fs');
                            return fs.promises.readFile(filePath, 'utf8');
                        }
                    });
                    return;
                }
            }

            this.fileInput.click();
        } catch {
            if (!this.dismissed) this.messageEl.textContent = 'Could not open the file picker. Choose JSON to try again.';
        } finally {
            this.choosing = false;
            this.chooseButton.disabled = false;
        }
    }
    
    onClose() {
        this.dismissed = true;
        this.source = null;
        this.plugin.releaseSaveOperation(this);
        const {contentEl} = this;
        contentEl.empty();
    }
}

// Folder suggestion modal for selecting folder
class FolderSuggestionModal extends Modal {
    plugin: ExpensicaPlugin;
    onSelect: (folder: string) => void | Promise<void>;
    
    constructor(app: App, plugin: ExpensicaPlugin, onSelect: (folder: string) => void | Promise<void>) {
        super(app);
        this.plugin = plugin;
        this.onSelect = onSelect;
    }

    private async selectFolder(folder: string): Promise<void> {
        try {
            await this.onSelect(folder);
            this.close();
        } catch {
            showExpensicaNotice('Could not save the daily review folder setting.');
        }
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('expensica-modal');
        
        // Create title
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.createSpan({ cls: 'expensica-modal-title-icon', text: '📁' });
        modalTitle.append(document.createTextNode(' Select Folder for Daily Reviews'));
        
        contentEl.createEl('p', {text: 'Choose where to store your daily finance review notes:'});
        
        // Get all folders in the vault
        const folders = this.getFolders();
        
        const folderContainer = contentEl.createDiv('folder-container');
        
        // Add option for root folder
        const rootOption = folderContainer.createDiv('folder-option');
        rootOption.setText('Root folder');
        rootOption.addEventListener('click', () => {
            void this.selectFolder('');
        });
        
        // Add all folders
        folders.forEach(folder => {
            const folderOption = folderContainer.createDiv('folder-option');
            folderOption.setText(folder);
            folderOption.addEventListener('click', () => {
                void this.selectFolder(folder);
            });
        });
        
        // Add option to create new folder
        const newFolderOption = folderContainer.createDiv('folder-option new-folder-option');
        newFolderOption.setText('+ Create new folder');
        newFolderOption.addEventListener('click', () => {
            // Hide folder list and show input for new folder
            folderContainer.classList.add('folder-container-hidden');
            folderContainer.classList.remove('folder-container-visible');
            
            const newFolderContainer = contentEl.createDiv('new-folder-container');
            const input = newFolderContainer.createEl('input', {
                attr: {
                    type: 'text',
                    placeholder: 'Enter folder name'
                },
                cls: 'new-folder-input'
            });
            
            const buttonContainer = newFolderContainer.createDiv('button-container');
            
            const cancelButton = buttonContainer.createEl('button', {
                text: 'Cancel',
                cls: 'expensica-btn expensica-btn-secondary'
            });
            
            const createButton = buttonContainer.createEl('button', {
                text: 'Create',
                cls: 'expensica-btn expensica-btn-primary'
            });
            
            cancelButton.addEventListener('click', () => {
                // Show folder list again
                folderContainer.classList.remove('folder-container-hidden');
                folderContainer.classList.add('folder-container-visible');
                newFolderContainer.remove();
            });
            
            createButton.addEventListener('click', voidAsync(async () => {
                const folderName = input.value.trim();
                if (folderName) {
                    try {
                        // Create the folder
                        await this.plugin.app.vault.createFolder(folderName);
                        showExpensicaNotice(`Created folder: ${folderName}`);
                        await this.selectFolder(folderName);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        showExpensicaNotice(`Error creating folder: ${message}`);
                    }
                } else {
                    showExpensicaNotice('Please enter a folder name');
                }
            }));
        });
    }
    
    // Get all folders in the vault
    getFolders(): string[] {
        const folders: string[] = [];
        
        // Recursive function to get all folders
        const processFolder = (folder: string) => {
            folders.push(folder);
            
            // Get all subfolders
            const files = this.plugin.app.vault.getFiles();
            const subfolders = new Set<string>();
            
            files.forEach(file => {
                if (file.path.startsWith(folder) && file.path !== folder) {
                    const parentPath = file.parent?.path;
                    if (parentPath && parentPath.startsWith(folder) && parentPath !== folder) {
                        subfolders.add(parentPath);
                    }
                }
            });
            
            // Process subfolders
            subfolders.forEach(subfolder => {
                processFolder(subfolder);
            });
        };
        
        // Get top-level folders
        const files = this.plugin.app.vault.getFiles();
        const topFolders = new Set<string>();
        
        files.forEach(file => {
            const parentPath = file.parent?.path;
            if (parentPath && parentPath !== '/') {
                const topFolder = parentPath.split('/')[0];
                topFolders.add(topFolder);
            }
        });
        
        // Process each top-level folder
        topFolders.forEach(folder => {
            processFolder(folder);
        });
        
        return folders;
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Date picker modal class
class DatePickerModal extends Modal {
    onSelect: (date: Date) => void | Promise<void>;
    
    constructor(app: App, onSelect: (date: Date) => void | Promise<void>) {
        super(app);
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Create title
        contentEl.createEl('h2', { text: 'Select Date for Daily Review' });
        
        // Create date input
        const dateInput = contentEl.createEl('input', {
            type: 'date',
            cls: 'expensica-date-input'
        });
        
        // Set default value to today
        const today = new Date();
        dateInput.value = formatDate(today);
        
        // Create submit button
        const submitButton = contentEl.createEl('button', {
            text: 'Create Review',
            cls: 'expensica-submit-button'
        });
        
        // Handle submit
        submitButton.addEventListener('click', () => {
            const selectedDate = parseLocalDate(dateInput.value);
            this.close();
            void Promise.resolve(this.onSelect(selectedDate)).catch(() => {
                showExpensicaNotice('Failed to create daily finance review');
            });
        });
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
