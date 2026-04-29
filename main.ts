import { App, Editor, MarkdownView, Modal, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile } from 'obsidian';

import { ExpensicaDashboardView, EXPENSICA_VIEW_TYPE, TransactionModal, DateRangeType, DashboardTab } from './src/dashboard-view';
import { ExpensicaTransactionsView } from './src/transactions-view';

import {
    Transaction,
    TransactionType,
    generateId,
    formatDate,
    parseLocalDate,
    Category,
    CategoryEmojiSettings,
    CategoryType,
    Currency,
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
    BudgetPeriod,
    TransactionAggregator,
    formatCurrency,
    calculateBudgetStatus,
    sortTransactionsByDateTimeDesc,
    compareAccounts,
    formatAccountReference,
    getAccountColor,
    normalizeAccountName,
    normalizePaletteColor,
    parseAccountReference,
    INTERNAL_CATEGORY_ID
} from './src/models';

import { ExportModal } from './src/export-modal';
import { ConfirmationModal as ExpensicaConfirmationModal } from './src/confirmation-modal';
import { showExpensicaNotice } from './src/notice';

// Import visualizations for bundling
import './src/dashboard-integration';
import './src/visualizations/calendar-view';

// Import jsPDF for global availability
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

function formatTransactionDescriptionForBanking(description: string): string {
    return description.trim().replace(/\s+/g, ' ').toUpperCase();
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
    categories: Category[];
    deletedDefaultCategoryIds: string[];
    categoryEmojis: CategoryEmojiSettings;
    categoryColors: Record<string, string>;
    calendarColorScheme: ColorScheme;
    customCalendarColor: string;
    showWeekNumbers: boolean;
    showTransactionCategoryLabels: boolean;
    enableAccounts: boolean;
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

export interface SharedDateRangeState {
    type: DateRangeType;
    startDate: string;
    endDate: string;
    customStartDate: string | null;
    customEndDate: string | null;
    updatedAt: number;
}

// Define default settings
const DEFAULT_SETTINGS: ExpensicaSettings = {
    defaultCurrency: 'USD',
    categories: DEFAULT_CATEGORIES,
    deletedDefaultCategoryIds: [],
    categoryEmojis: {},
    categoryColors: {},
    calendarColorScheme: ColorScheme.BLUE,
    customCalendarColor: '#2196f3',
    showWeekNumbers: false,
    showTransactionCategoryLabels: true,
    enableAccounts: true,
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
    transactionsData: TransactionsData;
    budgetData: BudgetData;
    dataFolderPath: string = 'expensica-data';
    transactionsFilePath: string = 'expensica-data/transactions.json';
    accountsFilePath: string = 'expensica-data/accounts.json';
    budgetFilePath: string = 'expensica-data/budgets.json';
    settingTab: ExpensicaSettingTab | null = null;
    private dashboardTransactionsViews = new WeakMap<ExpensicaDashboardView, ExpensicaTransactionsView>();

    async onload() {
        await this.loadSettings();

        // Create data folder if it doesn't exist
        await this.ensureDataFolder();

        // Load transactions data
        await this.loadTransactionsData();
        await this.loadAccountsData();
        
        // Load budget data
        await this.loadBudgetData();
        
        // Make jsPDF globally available
        try {
            window.jspdf = { jsPDF };
            console.log('Expensica: jsPDF initialized successfully');
        } catch (error) {
            console.error('Expensica: Error initializing jsPDF', error);
        }

        // Add a ribbon icon for quick access
        const ribbonIconEl = this.addRibbonIcon('dollar-sign', 'Expensica', (evt: MouseEvent) => {
            // Open the Expensica dashboard
            this.openDashboard();
        });
        ribbonIconEl.addClass('expensica-ribbon-icon');

        // Add a command for quick expense entry
        this.addCommand({
            id: 'add-expense',
            name: 'Add New Expense',
            callback: () => {
                this.openExpenseModal();
            }
        });

        // Add a command for quick income entry
        this.addCommand({
            id: 'add-income',
            name: 'Add New Income',
            callback: () => {
                this.openIncomeModal();
            }
        });

        // Add a command to open the dashboard
        this.addCommand({
            id: 'open-dashboard',
            name: 'Open Dashboard',
            callback: () => {
                this.openDashboard();
            }
        });

        // Add a command to open the transactions view
        this.addCommand({
            id: 'open-transactions',
            name: 'View All Transactions',
            callback: () => {
                this.openTransactionsView();
            }
        });

        // Add a command to open the budget view
        this.addCommand({
            id: 'open-budget',
            name: 'Open Budget',
            callback: () => {
                this.openBudgetView();
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
                this.createDailyFinanceReview();
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
                this.createDailyFinanceReviewForDate();
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
    }

    async ensureDataFolder() {
        const folderExists = await this.app.vault.adapter.exists(this.dataFolderPath);
        if (!folderExists) {
            await this.app.vault.createFolder(this.dataFolderPath);
        }
    }

    async loadTransactionsData() {
        try {
            const fileExists = await this.app.vault.adapter.exists(this.transactionsFilePath);
            if (!fileExists) {
                this.transactionsData = DEFAULT_TRANSACTIONS_DATA;
                await this.saveTransactionsData();
                return;
            }

            // Read the file content
            const fileContent = await this.app.vault.adapter.read(this.transactionsFilePath);

            // Parse the JSON content
            const parsedData = JSON.parse(fileContent) as Partial<TransactionsData>;
            this.transactionsData = {
                transactions: Array.isArray(parsedData.transactions) ? parsedData.transactions : [],
                accounts: [...DEFAULT_ACCOUNTS_DATA.accounts],
                lastUpdated: parsedData.lastUpdated || new Date().toISOString()
            };

            const normalizedSnapshotBeforeLoad = JSON.stringify({
                transactions: this.transactionsData.transactions
            });
            this.normalizeTransactionsData();
            const normalizedSnapshotAfterLoad = JSON.stringify({
                transactions: this.transactionsData.transactions
            });

            if (normalizedSnapshotBeforeLoad !== normalizedSnapshotAfterLoad) {
                await this.saveTransactionsData();
            }

            console.log('Expensica: Transactions loaded successfully', this.transactionsData.transactions.length, 'transactions found');
        } catch (error) {
            console.error('Expensica: Error loading transactions data', error);
            showExpensicaNotice('Error loading transactions data. Using default data.');
            this.transactionsData = DEFAULT_TRANSACTIONS_DATA;
            await this.saveTransactionsData();
        }
    }

    async saveTransactionsData() {
        try {
            this.normalizeTransactionsData();
            this.transactionsData.lastUpdated = new Date().toISOString();
            const persistedData = {
                transactions: this.transactionsData.transactions,
                lastUpdated: this.transactionsData.lastUpdated
            };
            await this.app.vault.adapter.write(
                this.transactionsFilePath,
                JSON.stringify(persistedData, null, 2)
            );
        } catch (error) {
            console.error('Failed to save transactions data:', error);
            showExpensicaNotice('Failed to save transactions data');
        }
    }

    async loadAccountsData() {
        try {
            const fileExists = await this.app.vault.adapter.exists(this.accountsFilePath);
            if (!fileExists) {
                this.transactionsData.accounts = [...DEFAULT_ACCOUNTS_DATA.accounts];
                this.normalizeTransactionsData();
                await this.saveAccountsData();
                return;
            }

            const fileContent = await this.app.vault.adapter.read(this.accountsFilePath);
            const parsedData = JSON.parse(fileContent) as Partial<AccountsData>;
            this.transactionsData.accounts = Array.isArray(parsedData.accounts) && parsedData.accounts.length > 0
                ? parsedData.accounts
                : [...DEFAULT_ACCOUNTS_DATA.accounts];

            this.normalizeTransactionsData();

            console.log('Expensica: Accounts loaded successfully', this.transactionsData.accounts.length, 'accounts found');
        } catch (error) {
            console.error('Expensica: Error loading accounts data', error);
            showExpensicaNotice('Error loading accounts data. Using default data.');
            this.transactionsData.accounts = [...DEFAULT_ACCOUNTS_DATA.accounts];
            this.normalizeTransactionsData();
            await this.saveAccountsData();
        }
    }

    async saveAccountsData() {
        try {
            this.normalizeTransactionsData();
            const accountsData: AccountsData = {
                accounts: this.transactionsData.accounts,
                lastUpdated: new Date().toISOString()
            };
            await this.app.vault.adapter.write(
                this.accountsFilePath,
                JSON.stringify(accountsData, null, 2)
            );
        } catch (error) {
            console.error('Failed to save accounts data:', error);
            showExpensicaNotice('Failed to save accounts data');
        }
    }

    async loadBudgetData() {
        try {
            const fileExists = await this.app.vault.adapter.exists(this.budgetFilePath);
            if (!fileExists) {
                // If file doesn't exist, initialize with default data
                this.budgetData = DEFAULT_BUDGET_DATA;
                await this.saveBudgetData();
                return;
            }

            // Read the file content
            const fileContent = await this.app.vault.adapter.read(this.budgetFilePath);

            // Parse the JSON content
            this.budgetData = JSON.parse(fileContent);

            // Validate the data structure
            if (!this.budgetData.budgets) {
                this.budgetData.budgets = [];
            }

            if (!this.budgetData.lastUpdated) {
                this.budgetData.lastUpdated = new Date().toISOString();
            }

            // Log success
            console.log('Expensica: Budgets loaded successfully', this.budgetData.budgets.length, 'budgets found');
        } catch (error) {
            // If there's an error, initialize with default data
            console.error('Expensica: Error loading budget data', error);
            showExpensicaNotice('Error loading budget data. Using default data.');
            this.budgetData = DEFAULT_BUDGET_DATA;
            await this.saveBudgetData();
        }
    }

    async saveBudgetData() {
        try {
            // Update the lastUpdated timestamp
            this.budgetData.lastUpdated = new Date().toISOString();

            // Convert to JSON
            const jsonData = JSON.stringify(this.budgetData, null, 2);

            // Write to file
            await this.app.vault.adapter.write(this.budgetFilePath, jsonData);

            console.log('Expensica: Budgets saved successfully');
        } catch (error) {
            console.error('Expensica: Error saving budget data', error);
            showExpensicaNotice('Error saving budget data. See console for details.');
        }
    }

    async openDashboard() {
        // Activate existing leaf if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(leaves[0]);
        } else {
            // Create a new leaf
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: EXPENSICA_VIEW_TYPE,
                active: true
            });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    async openTransactionsView() {
        await this.openDashboard();
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        const dashboard = leaves.find(leaf => leaf.view instanceof ExpensicaDashboardView)?.view as ExpensicaDashboardView | undefined;
        if (dashboard) {
            await dashboard.loadTransactionsData();
            dashboard.switchDashboardTab(DashboardTab.TRANSACTIONS);
            dashboard.scrollToTop();
        }
    }

    async openTransactionsViewForCategory(categoryId: string) {
        await this.openDashboard();
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        const dashboard = leaves.find(leaf => leaf.view instanceof ExpensicaDashboardView)?.view as ExpensicaDashboardView | undefined;
        if (!dashboard) {
            return;
        }

        await dashboard.loadTransactionsData();
        dashboard.switchDashboardTab(DashboardTab.TRANSACTIONS);
        const transactionsView = this.dashboardTransactionsViews.get(dashboard);
        transactionsView?.applyCategoryFilter(categoryId);
        dashboard.scrollToTop();
    }

    renderDashboardTransactionsTab(dashboard: ExpensicaDashboardView, container: HTMLElement) {
        let transactionsView = this.dashboardTransactionsViews.get(dashboard);
        if (!transactionsView) {
            transactionsView = new ExpensicaTransactionsView(this.app, this);
            this.dashboardTransactionsViews.set(dashboard, transactionsView);
        }

        transactionsView.renderDashboardTab(container);
    }

    renderDashboardAccountsTab(dashboard: ExpensicaDashboardView, container: HTMLElement) {
        dashboard.renderAccountsTab(container);
    }

    async openExpenseModal() {
        // Find the dashboard view if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        if (leaves.length > 0 && leaves[0].view instanceof ExpensicaDashboardView) {
            const dashboardView = leaves[0].view as ExpensicaDashboardView;
            const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.EXPENSE);
            modal.open();
        } else {
            // Open the dashboard first, then open the modal
            await this.openDashboard();
            setTimeout(() => {
                const newLeaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
                if (newLeaves.length > 0 && newLeaves[0].view instanceof ExpensicaDashboardView) {
                    const dashboardView = newLeaves[0].view as ExpensicaDashboardView;
                    const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.EXPENSE);
                    modal.open();
                }
            }, 300); // Give some time for the view to initialize
        }
    }

    async openIncomeModal() {
        // Find the dashboard view if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        if (leaves.length > 0 && leaves[0].view instanceof ExpensicaDashboardView) {
            const dashboardView = leaves[0].view as ExpensicaDashboardView;
            const modal = new TransactionModal(this.app, this, dashboardView, null, TransactionType.INCOME);
            modal.open();
        } else {
            // Open the dashboard first, then open the modal
            await this.openDashboard();
            setTimeout(() => {
                const newLeaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
                if (newLeaves.length > 0 && newLeaves[0].view instanceof ExpensicaDashboardView) {
                    const dashboardView = newLeaves[0].view as ExpensicaDashboardView;
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

    onunload() {
        // Clean up when the plugin is disabled
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        this.normalizeCategorySettings();
    }

    async saveSettings(refreshViews = true) {
        this.normalizeCategorySettings();
        await this.saveData({
            ...this.settings,
            categories: this.settings.categories.map(category => ({
                id: category.id,
                name: category.name,
                type: category.type
            })),
            categoryEmojis: this.getCategoryEmojiOverridesForSave(),
            categoryColors: this.settings.categoryColors
        });

        if (refreshViews) {
            await this.refreshExpensicaViews();
        }
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
            if (category.id !== INTERNAL_CATEGORY_ID && deletedDefaultCategoryIds.has(category.id)) {
                return;
            }
            if (!categoriesById.has(category.id)) {
                categoriesById.set(category.id, category);
            }
        });

        this.settings.categories = Array.from(categoriesById.values());
        this.settings.deletedDefaultCategoryIds = Array.from(deletedDefaultCategoryIds).filter(categoryId => categoryId !== INTERNAL_CATEGORY_ID);

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

    async refreshExpensicaViews(sourceView?: unknown) {
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);

        for (const leaf of leaves) {
            const view = leaf.view;
            if (view === sourceView) {
                continue;
            }

            if (view instanceof ExpensicaDashboardView) {
                await view.loadTransactionsData();
                view.renderDashboard();
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
            const view = leaf.view as unknown;
            if (view === sourceView) {
                continue;
            }

            if (
                view
                && typeof view === 'object'
                && 'applySharedDateRangeState' in view
                && typeof (view as { applySharedDateRangeState: (state: SharedDateRangeState) => Promise<void> }).applySharedDateRangeState === 'function'
            ) {
                await (view as { applySharedDateRangeState: (state: SharedDateRangeState) => Promise<void> }).applySharedDateRangeState(sharedState);
            }
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
    getCategoryById(id: string): Category | undefined {
        const normalizedId = typeof id === 'string' && LEGACY_UNKNOWN_CATEGORY_IDS.has(id.trim().toLowerCase())
            ? 'other_expense'
            : id;
        return this.settings.categories.find(c => c.id === normalizedId);
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
    handleDeletedCategory(categoryId: string, fallbackCategoryId: string): void {
        if (categoryId === fallbackCategoryId) return;

        // Update all transactions using this category
        let updatedCount = 0;
        this.transactionsData.transactions.forEach(transaction => {
            if (transaction.category === categoryId) {
                transaction.category = fallbackCategoryId;
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            this.saveTransactionsData();
            console.log(`Updated ${updatedCount} transactions to use fallback category ${fallbackCategoryId}`);
        }
    }

    // Delete a category
    async deleteCategory(id: string): Promise<boolean> {
        // Store the category for reference
        const category = this.getCategoryById(id);
        if (!category) return false;
        if (category.id === 'other_expense' || category.id === INTERNAL_CATEGORY_ID) return false;

        const fallbackCategoryId = category.type === CategoryType.EXPENSE ? 'other_expense' : this.getCategories(category.type)[0]?.id;
        if (!fallbackCategoryId) return false;

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

                    const isInUse = this.isCategoryInUse(id);
                    if (isInUse) {
                        this.handleDeletedCategory(id, fallbackCategoryId);
                    }

                    this.settings.categories = this.settings.categories.filter(c => c.id !== id);
                    if (DEFAULT_CATEGORY_IDS.has(id)) {
                        this.settings.deletedDefaultCategoryIds = Array.from(new Set([
                            ...(this.settings.deletedDefaultCategoryIds || []),
                            id
                        ]));
                    }
                    delete this.settings.categoryEmojis[id];
                    delete this.settings.categoryColors[id];

                    await this.saveSettings();

                    if (this.settingTab) {
                        this.settingTab.display();
                    }

                    resolve(true);
                }
            ).open();
        });
    }

    // Methods for transaction management
    async addTransaction(transaction: Transaction, sourceView?: unknown) {
        this.transactionsData.transactions.push(this.normalizeTransactionForSave(transaction));
        await this.saveTransactionsData();
        await this.refreshExpensicaViews(sourceView);
    }

    async updateTransaction(transaction: Transaction, sourceView?: unknown) {
        const index = this.transactionsData.transactions.findIndex(t => t.id === transaction.id);
        if (index !== -1) {
            this.transactionsData.transactions[index] = this.normalizeTransactionForSave(transaction);
            await this.saveTransactionsData();
            await this.refreshExpensicaViews(sourceView);
        }
    }

    async deleteTransaction(id: string, sourceView?: unknown) {
        const index = this.transactionsData.transactions.findIndex(t => t.id === id);
        if (index !== -1) {
            this.transactionsData.transactions.splice(index, 1);
            await this.saveTransactionsData();
            await this.refreshExpensicaViews(sourceView);
        }
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
        const normalizedAccount: Account = {
            ...account,
            name: normalizeAccountName(account.name),
            color: normalizePaletteColor(account.color) || undefined
        };

        if (normalizedAccount.type !== AccountType.CREDIT) {
            delete normalizedAccount.creditLimit;
        }

        this.transactionsData.accounts.push(normalizedAccount);
        this.transactionsData.accounts.sort(compareAccounts);
        await this.saveAccountsData();
        await this.refreshExpensicaViews(sourceView);
    }

    async updateAccount(previousReference: string, account: Account, sourceView?: unknown) {
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

        this.transactionsData.accounts[index] = updatedAccount;

        this.transactionsData.transactions = this.transactionsData.transactions.map(transaction => {
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

        await this.saveAccountsData();
        await this.saveTransactionsData();
        await this.refreshExpensicaViews(sourceView);
    }

    async deleteAccount(accountReference: string, sourceView?: unknown) {
        const index = this.transactionsData.accounts.findIndex(account =>
            formatAccountReference(account.type, account.name) === accountReference
        );
        if (index === -1) {
            throw new Error('Account not found');
        }

        this.transactionsData.accounts.splice(index, 1);
        await this.saveAccountsData();
        await this.refreshExpensicaViews(sourceView);
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

        const normalizedCategory = this.getCategoryById(transaction.category)?.id || 'other_expense';

        return {
            ...transaction,
            description,
            category: normalizedCategory,
            account: this.normalizeTransactionAccountReference(transaction.account),
            fromAccount: undefined,
            toAccount: undefined
        };
    }

    private normalizeTransactionsData() {
        const normalizedAccounts = new Map<string, Account>();
        let defaultAccountId: string | null = null;
        let defaultAccountPriority = -1;
        const usedAccountIds = new Set<string>();
        const sourceAccounts = this.transactionsData.accounts && this.transactionsData.accounts.length > 0
            ? this.transactionsData.accounts
            : [DEFAULT_ACCOUNT];

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

            const defaultPriority = account.id === DEFAULT_ACCOUNT_ID
                ? 2
                : account.isDefault
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

            const normalizedCategory = this.getCategoryById(transaction.category)?.id || 'other_expense';

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
        try {
            const jsonData = JSON.stringify(this.transactionsData.transactions, null, 2);
            await this.app.vault.adapter.write(filePath, jsonData);
            showExpensicaNotice('Transactions exported successfully');
            return true;
        } catch (error) {
            console.error('Error exporting transactions:', error);
            showExpensicaNotice('Error exporting transactions');
            return false;
        }
    }

    // Import transactions from JSON
    async importTransactionsFromJSON(filePath: string) {
        try {
            const fileContent = await this.app.vault.adapter.read(filePath);
            const importedTransactions = JSON.parse(fileContent);
            if (Array.isArray(importedTransactions)) {
                // Validate each transaction
                const validTransactions = importedTransactions.filter(t =>
                    t.id && t.date && t.type && t.amount && t.description && t.category
                );

                // Add the valid transactions
                this.transactionsData.transactions = [
                    ...this.transactionsData.transactions,
                    ...validTransactions
                ];
                await this.saveTransactionsData();
                showExpensicaNotice(`Imported ${validTransactions.length} transactions successfully`);
                return true;
            } else {
                showExpensicaNotice('Invalid file format for import');
                return false;
            }
        } catch (error) {
            console.error('Error importing transactions:', error);
            showExpensicaNotice('Error importing transactions');
            return false;
        }
    }

    // Budget methods
    async addBudget(budget: Budget) {
        if (!budget.id) {
            budget.id = generateId();
        }
        budget.lastUpdated = new Date().toISOString();
        this.budgetData.budgets.push(budget);
        await this.saveBudgetData();
    }

    async updateBudget(budget: Budget) {
        const index = this.budgetData.budgets.findIndex(b => b.id === budget.id);
        if (index !== -1) {
            budget.lastUpdated = new Date().toISOString();
            this.budgetData.budgets[index] = budget;
            await this.saveBudgetData();
        }
    }

    async deleteBudget(id: string) {
        const index = this.budgetData.budgets.findIndex(b => b.id === id);
        if (index !== -1) {
            this.budgetData.budgets.splice(index, 1);
            await this.saveBudgetData();
        }
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
        if (leaves.length > 0 && leaves[0].view instanceof ExpensicaDashboardView) {
            const dashboardView = leaves[0].view as ExpensicaDashboardView;
            dashboardView.showBudgetTab();
            this.app.workspace.revealLeaf(leaves[0]);
        } else {
            // Open the dashboard first, then switch to the budget tab
            await this.openDashboard();
            setTimeout(() => {
                const newLeaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
                if (newLeaves.length > 0 && newLeaves[0].view instanceof ExpensicaDashboardView) {
                    const dashboardView = newLeaves[0].view as ExpensicaDashboardView;
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
            
            const yesterdayIncome = TransactionAggregator.getTotalIncome(yesterdayTransactions);
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
                const sortedTransactions = sortTransactionsByDateTimeDesc(todaysTransactions);
                
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
                this.app.workspace.getLeaf().openFile(existingNote);
            } else {
                const newNote = await this.app.vault.create(notePath, noteContent);
                showExpensicaNotice(`Created note: ${noteTitle}`);
                this.app.workspace.getLeaf().openFile(newNote);
            }
        } catch (error) {
            console.error('Failed to create daily finance review:', error);
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
                    const sortedTransactions = sortTransactionsByDateTimeDesc(dateTransactions);
                    
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
                    this.app.workspace.getLeaf().openFile(existingNote);
                } else {
                    const newNote = await this.app.vault.create(notePath, noteContent);
                    showExpensicaNotice(`Created note: ${noteTitle}`);
                    this.app.workspace.getLeaf().openFile(newNote);
                }
            });
            modal.open();
        } catch (error) {
            console.error('Failed to create daily finance review:', error);
            showExpensicaNotice('Failed to create daily finance review');
        }
    }
}

// Settings tab
class ExpensicaSettingTab extends PluginSettingTab {
    plugin: ExpensicaPlugin;
    updateCustomColorVisibility: () => void;

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

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.addClass('expensica-settings-container');

        // Add links card at the top
        const linksCard = containerEl.createDiv('expensica-links-card');
        linksCard.createEl('h2', { text: 'Support & Resources' });

        // Buy Me a Coffee section
        const coffeeSection = linksCard.createDiv('expensica-links-section');
        coffeeSection.createEl('h3', { text: 'Support the Developer' });
        const coffeeLink = coffeeSection.createEl('a', {
            href: 'https://ko-fi.com/X8X71DLZHF',
            attr: { target: '_blank' }
        });
        coffeeLink.innerHTML = '<img class="coffee-link-img" src="https://storage.ko-fi.com/cdn/kofi6.png?v=6" border="0" alt="Buy Me a Coffee at ko-fi.com" />';

        // Website and Social Links
        const socialSection = linksCard.createDiv('expensica-links-section');
        socialSection.createEl('h3', { text: 'Connect with Expensica' });
        
        const websiteLink = socialSection.createEl('a', {
            href: 'https://expensica.com/',
            text: '🌐 Visit Expensica Website',
            attr: { target: '_blank' },
            cls: 'external-link-display-block'
        });
        
        const linkedinLink = socialSection.createDiv('external-link-display-block');
        linkedinLink.innerHTML = '<a href="https://www.linkedin.com/company/expensica/" target="_blank">💼 Follow on LinkedIn</a>';

        // GitHub Issues
        const githubSection = linksCard.createDiv('expensica-links-section');
        githubSection.createEl('h3', { text: 'Report Issues & Request Features' });
        const githubLink = githubSection.createEl('a', {
            href: 'https://github.com/dhruvir-zala/obsidian-expensica/issues',
            text: '🐛 GitHub Issues & Feature Requests',
            attr: { target: '_blank' },
            cls: 'external-link-display-block'
        });

        // Add a separator
        containerEl.createEl('hr', { cls: 'expensica-settings-separator' });

        // General settings
        containerEl.createEl('h2', { text: 'General Settings' });

        // Currency setting
        new Setting(containerEl)
            .setName('Default Currency')
            .setDesc('Select the currency to use for all transactions.')
            .then((setting) => {
                const container = setting.controlEl.createDiv('currency-dropdown-container');
                this.renderCurrencyDropdown(
                    container,
                    this.plugin.settings.defaultCurrency,
                    async (value) => {
                        this.plugin.settings.defaultCurrency = value;
                        await this.plugin.saveSettings();
                    }
                );
            });

        // Calendar color scheme
        new Setting(containerEl)
            .setName('Calendar Color Scheme')
            .setDesc('Select the color scheme for the calendar visualization.')
            .then((setting) => {
                const container = setting.controlEl.createDiv('color-dropdown-container');
                
                // Create the select display
                const selectDisplay = container.createDiv('expensica-select-display');
                const previewColor = this.getColorPreview(this.plugin.settings.calendarColorScheme);
                const colorPreview = selectDisplay.createDiv('color-preview color-preview-bg');
                colorPreview.setAttribute('style', `--color-preview: ${previewColor}`);

                const selectText = selectDisplay.createSpan({ cls: 'expensica-select-display-text' });
                selectText.textContent = this.plugin.settings.calendarColorScheme.charAt(0).toUpperCase() + this.plugin.settings.calendarColorScheme.slice(1);
                
                const selectArrow = selectDisplay.createSpan({ cls: 'expensica-select-arrow' });
                selectArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
                
                const optionsContainer = container.createDiv('expensica-select-options options-container-hidden');
                
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
                    const optionEl = optionsContainer.createDiv('expensica-select-option');
                    const optionColorPreview = optionEl.createDiv('color-preview');
                    optionColorPreview.setAttribute('style', `background-color: ${this.getColorPreview(option.value)}`);
                    optionEl.createSpan({ text: option.text });
                    
                    if (this.plugin.settings.calendarColorScheme === option.value) {
                        optionEl.addClass('expensica-option-selected');
                    }
                    
                    optionEl.addEventListener('click', async () => {
                        this.plugin.settings.calendarColorScheme = option.value;
                        await this.plugin.saveSettings();
                        
                        // Update the display
                        colorPreview.setAttribute('style', `--color-preview: ${this.getColorPreview(option.value)}`);
                        selectText.textContent = option.text;
                        
                        // Hide the options
                        optionsContainer.classList.remove('options-container-hidden');
                        selectArrow.classList.remove('expensica-select-arrow-open');
                        
                        // Show/hide custom color input
                        this.updateCustomColorVisibility();
                    });
                });
                
                // Toggle options on click
                selectDisplay.addEventListener('click', () => {
                    const isHidden = optionsContainer.classList.contains('options-container-hidden');
                    optionsContainer.classList.toggle('options-container-hidden', !isHidden);
                    selectArrow.classList.toggle('expensica-select-arrow-open', !isHidden);
                    if (!isHidden) {
                        const input = selectDisplay.querySelector('input');
                        if (input) input.focus();
                    }
                });
                
                // Close options when clicking outside
                document.addEventListener('click', (e) => {
                    const target = e.target as Node;
                    if (!container.contains(target)) {
                        optionsContainer.classList.add('options-container-hidden');
                        selectArrow.classList.remove('expensica-select-arrow-open');
                    }
                });
            });
            
        // Custom color container (visible only when Custom is selected)
        const customColorContainer = containerEl.createDiv('custom-color-container');
        
        if (this.plugin.settings.calendarColorScheme === ColorScheme.CUSTOM) {
            customColorContainer.classList.add('custom-color-container-flex');
        } else {
            customColorContainer.classList.add('custom-color-container-hidden');
        }
        
        const colorInput = customColorContainer.createEl('input', {
            type: 'color',
            value: this.plugin.settings.customCalendarColor
        });
        
        colorInput.addEventListener('change', async () => {
            this.plugin.settings.customCalendarColor = colorInput.value;
            await this.plugin.saveSettings();
        });
        
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

        // Show week numbers in calendar
        new Setting(containerEl)
            .setName('Show Week Numbers')
            .setDesc('Display week numbers in the calendar visualization.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showWeekNumbers)
                .onChange(async (value) => {
                    this.plugin.settings.showWeekNumbers = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Transaction Category Labels')
            .setDesc('Display colored category labels on transaction cards.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTransactionCategoryLabels)
                .onChange(async (value) => {
                    this.plugin.settings.showTransactionCategoryLabels = value;
                    await this.plugin.saveSettings();

                    this.plugin.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE).forEach((leaf) => {
                        if (leaf.view instanceof ExpensicaDashboardView) {
                            leaf.view.renderDashboard();
                        }
                    });

                }));

        new Setting(containerEl)
            .setName('Enable Accounts')
            .setDesc('Enable or disable account features.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAccounts)
                .onChange(async (value) => {
                    this.plugin.settings.enableAccounts = value;
                    await this.plugin.saveSettings();

                    this.plugin.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE).forEach((leaf) => {
                        if (leaf.view instanceof ExpensicaDashboardView) {
                            leaf.view.renderDashboard();
                        }
                    });
                }));

        // Enable budgeting feature
        new Setting(containerEl)
            .setName('Enable Budgeting')
            .setDesc('Enable or disable the budgeting features.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableBudgeting)
                .onChange(async (value) => {
                    this.plugin.settings.enableBudgeting = value;
                    await this.plugin.saveSettings();
                    
                    // Refresh dashboard if it's open
                    const leaves = this.plugin.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
                    if (leaves.length > 0 && leaves[0].view instanceof ExpensicaDashboardView) {
                        const dashboardView = leaves[0].view as ExpensicaDashboardView;
                        dashboardView.renderDashboard();
                    }
                }));

        // Enable daily finance review feature
        new Setting(containerEl)
            .setName('Enable Daily Finance Review (For Today)')
            .setDesc('Enable or disable the ability to create daily finance reviews for today.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDailyFinanceReview)
                .onChange(async (value) => {
                    this.plugin.settings.enableDailyFinanceReview = value;
                    await this.plugin.saveSettings();
                }));

        // Enable daily finance review for any date feature
        new Setting(containerEl)
            .setName('Enable Daily Finance Review for Any Date')
            .setDesc('Enable or disable the ability to create/update daily finance reviews for any date.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDailyFinanceReviewForAnyDate)
                .onChange(async (value) => {
                    this.plugin.settings.enableDailyFinanceReviewForAnyDate = value;
                    await this.plugin.saveSettings();
                }));

        // Daily review folder setting
        new Setting(containerEl)
            .setName('Daily Finance Review Folder')
            .setDesc('Select a folder where all daily finance review notes will be stored.')
            .addText(text => text
                .setPlaceholder('Example: Daily Finance Reviews')
                .setValue(this.plugin.settings.dailyReviewFolder)
                .onChange(async (value) => {
                    this.plugin.settings.dailyReviewFolder = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Browse')
                .onClick(async () => {
                    new FolderSuggestionModal(this.app, this.plugin, async (folder) => {
                        this.plugin.settings.dailyReviewFolder = folder;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh the settings display
                    }).open();
                }));

        // Data management section
        const dataSectionEl = containerEl.createDiv('expensica-settings-section');
        dataSectionEl.createEl('h3', {text: 'Data Management'});

        // Export data with advanced options
        new Setting(dataSectionEl)
            .setName('Export data')
            .setDesc('Export your transactions with advanced filtering options')
            .addButton(button => button
                .setButtonText('Export Transactions')
                .onClick(() => {
                    this.plugin.openExportModal();
                }));

        // Import data
        new Setting(dataSectionEl)
            .setName('Import data')
            .setDesc('Import transactions from a JSON file')
            .addButton(button => button
                .setButtonText('Import')
                .onClick(() => {
                    // This would be better with a file picker, but we'll use a simple approach
                    new ImportModal(this.app, this.plugin).open();
                }));
    }

    renderCurrencyDropdown(
        container: HTMLElement,
        selectedCode: string,
        onChange: (currencyCode: string) => void
    ): void {
        // Create the main container
        const currencySelectContainer = container.createDiv('currency-select-container');
        
        // Create the display element
        const currencyDisplay = currencySelectContainer.createDiv('expensica-select-display');
        
        // Get the selected currency
        const selectedCurrency = getCurrencyByCode(selectedCode) || COMMON_CURRENCIES[0];
        
        // Create the display text
        const currencyDisplayText = currencyDisplay.createDiv('expensica-select-text');
        currencyDisplayText.innerHTML = `<span class="currency-symbol">${selectedCurrency.symbol}</span> ${selectedCurrency.code} - ${selectedCurrency.name}`;
        
        // Create the arrow icon
        const arrowIcon = currencyDisplay.createDiv('expensica-select-arrow');
        arrowIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        
        // Create the options container
        const currencyOptions = currencySelectContainer.createDiv('expensica-select-options expensica-select-hidden');
        
        // Add search input
        const searchContainer = currencyOptions.createDiv('currency-search-container');
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search currencies...',
            cls: 'currency-search-input'
        });
        
        // Create options
        const optionsContainer = currencyOptions.createDiv('currency-options-container');
        
        // Function to filter and render options
        const renderFilteredOptions = (searchTerm: string = '') => {
            optionsContainer.empty();
            const filteredCurrencies = COMMON_CURRENCIES.filter(currency => {
                const searchLower = searchTerm.toLowerCase();
                return currency.code.toLowerCase().includes(searchLower) ||
                       currency.name.toLowerCase().includes(searchLower) ||
                       currency.symbol.toLowerCase().includes(searchLower);
            });
            
            filteredCurrencies.forEach(currency => {
                const optionItem = optionsContainer.createDiv('expensica-select-option');
                optionItem.innerHTML = `<span class="currency-symbol">${currency.symbol}</span> ${currency.code} - ${currency.name}`;
                
                if (currency.code === selectedCode) {
                    optionItem.addClass('expensica-option-selected');
                }
                
                optionItem.addEventListener('click', () => {
                    onChange(currency.code);
                    currencyDisplayText.innerHTML = `<span class="currency-symbol">${currency.symbol}</span> ${currency.code} - ${currency.name}`;
                    currencyOptions.addClass('expensica-select-hidden');
                    arrowIcon.removeClass('expensica-select-arrow-open');
                });
            });
        };
        
        // Initial render
        renderFilteredOptions();
        
        // Handle search input
        searchInput.addEventListener('input', (e) => {
            const searchTerm = (e.target as HTMLInputElement).value;
            renderFilteredOptions(searchTerm);
        });
        
        // Toggle dropdown
        currencyDisplay.addEventListener('click', () => {
            const isHidden = currencyOptions.hasClass('expensica-select-hidden');
            currencyOptions.toggleClass('expensica-select-hidden', !isHidden);
            arrowIcon.toggleClass('expensica-select-arrow-open', !isHidden);
            if (!isHidden) {
                searchInput.focus();
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const target = event.target as Node;
            if (!currencySelectContainer.contains(target)) {
                currencyOptions.addClass('expensica-select-hidden');
                arrowIcon.removeClass('expensica-select-arrow-open');
            }
        });
    }

}

// Import Modal with improved UI
class ImportModal extends Modal {
    plugin: ExpensicaPlugin;
    
    constructor(app: App, plugin: ExpensicaPlugin) {
        super(app);
        this.plugin = plugin;
    }
    
    onOpen() {
        const {contentEl} = this;
        
        contentEl.addClass('expensica-modal');
        
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = '<span class="expensica-modal-title-icon">📥</span> Import Transactions';
        
        contentEl.createEl('p', {text: 'Enter the path to the JSON file to import:'});
        
        const input = contentEl.createEl('input', {
            attr: {
                type: 'text',
                placeholder: 'expensica-data/file-to-import.json'
            },
            cls: 'expensica-import-input'
        });
        
        const buttonContainer = contentEl.createDiv('expensica-import-buttons');
        
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary'
        });
        
        const importButton = buttonContainer.createEl('button', {
            text: 'Import',
            cls: 'expensica-btn expensica-btn-primary'
        });
        
        cancelButton.addEventListener('click', () => {
            this.close();
        });
        
        importButton.addEventListener('click', async () => {
            const filePath = input.value.trim();
            if (filePath) {
                const fileExists = await this.plugin.app.vault.adapter.exists(filePath);
                if (fileExists) {
                    await this.plugin.importTransactionsFromJSON(filePath);
                    this.close();
                } else {
                    showExpensicaNotice(`File not found: ${filePath}`);
                }
            } else {
                showExpensicaNotice('Please enter a file path');
            }
        });
    }
    
    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

// Folder suggestion modal for selecting folder
class FolderSuggestionModal extends Modal {
    plugin: ExpensicaPlugin;
    onSelect: (folder: string) => void;
    
    constructor(app: App, plugin: ExpensicaPlugin, onSelect: (folder: string) => void) {
        super(app);
        this.plugin = plugin;
        this.onSelect = onSelect;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('expensica-modal');
        
        // Create title
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = '<span class="expensica-modal-title-icon">📁</span> Select Folder for Daily Reviews';
        
        contentEl.createEl('p', {text: 'Choose where to store your daily finance review notes:'});
        
        // Get all folders in the vault
        const folders = this.getFolders();
        
        const folderContainer = contentEl.createDiv('folder-container');
        
        // Add option for root folder
        const rootOption = folderContainer.createDiv('folder-option');
        rootOption.setText('Root folder');
        rootOption.addEventListener('click', () => {
            this.onSelect('');
            this.close();
        });
        
        // Add all folders
        folders.forEach(folder => {
            const folderOption = folderContainer.createDiv('folder-option');
            folderOption.setText(folder);
            folderOption.addEventListener('click', () => {
                this.onSelect(folder);
                this.close();
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
            
            createButton.addEventListener('click', async () => {
                const folderName = input.value.trim();
                if (folderName) {
                    try {
                        // Create the folder
                        await this.plugin.app.vault.createFolder(folderName);
                        showExpensicaNotice(`Created folder: ${folderName}`);
                        this.onSelect(folderName);
                        this.close();
                    } catch (error) {
                        showExpensicaNotice(`Error creating folder: ${error.message}`);
                    }
                } else {
                    showExpensicaNotice('Please enter a folder name');
                }
            });
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
    onSelect: (date: Date) => void;
    
    constructor(app: App, onSelect: (date: Date) => void) {
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
            this.onSelect(selectedDate);
            this.close();
        });
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
