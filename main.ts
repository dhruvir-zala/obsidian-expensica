import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile } from 'obsidian';

import { ExpensicaDashboardView, EXPENSICA_VIEW_TYPE, ExpenseModal, IncomeModal } from './src/dashboard-view';
import { ExpensicaTransactionsView, EXPENSICA_TRANSACTIONS_VIEW_TYPE } from './src/transactions-view';

import {
    Transaction,
    TransactionType,
    generateId,
    formatDate,
    Category,
    CategoryType,
    Currency,
    COMMON_CURRENCIES,
    DEFAULT_CATEGORIES,
    DEFAULT_EXPENSE_CATEGORIES,
    DEFAULT_INCOME_CATEGORIES,
    getCurrencyByCode,
    ColorScheme,
    Budget,
    BudgetData,
    DEFAULT_BUDGET_DATA,
    BudgetPeriod,
    TransactionAggregator,
    formatCurrency,
    calculateBudgetStatus
} from './src/models';

import { ExportModal } from './src/export-modal';
import { ConfirmationModal as ExpensicaConfirmationModal } from './src/confirmation-modal';

// Import visualizations for bundling
import './src/dashboard-integration';
import './src/visualizations/calendar-view';

// Import jsPDF for global availability
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

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
    calendarColorScheme: ColorScheme;
    customCalendarColor: string;
    showWeekNumbers: boolean;
    enableBudgeting: boolean;
}

// Define a separate interface for our transactions data
interface TransactionsData {
    transactions: Transaction[];
    lastUpdated: string; // ISO timestamp
}

// Define default settings
const DEFAULT_SETTINGS: ExpensicaSettings = {
    defaultCurrency: 'USD',
    categories: DEFAULT_CATEGORIES,
    calendarColorScheme: ColorScheme.BLUE,
    customCalendarColor: '#2196f3',
    showWeekNumbers: false,
    enableBudgeting: true
};

// Default transactions data
const DEFAULT_TRANSACTIONS_DATA: TransactionsData = {
    transactions: [],
    lastUpdated: new Date().toISOString()
};

// Define the main plugin class
export default class ExpensicaPlugin extends Plugin {
    settings: ExpensicaSettings;
    transactionsData: TransactionsData;
    budgetData: BudgetData;
    dataFolderPath: string = 'expensica-data';
    transactionsFilePath: string = 'expensica-data/transactions.json';
    budgetFilePath: string = 'expensica-data/budgets.json';
    settingTab: ExpensicaSettingTab | null = null;

    async onload() {
        await this.loadSettings();

        // Create data folder if it doesn't exist
        await this.ensureDataFolder();

        // Load transactions data
        await this.loadTransactionsData();
        
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
            name: 'Open Expensica Dashboard',
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
            name: 'Open Expensica Budget',
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
            name: 'Create Daily Finance Review',
            callback: () => {
                this.createDailyFinanceReview();
            }
        });

        // Register the view type for our dashboard
        this.registerView(
            EXPENSICA_VIEW_TYPE,
            (leaf) => new ExpensicaDashboardView(leaf, this)
        );

        // Register the view type for our transactions view
        this.registerView(
            EXPENSICA_TRANSACTIONS_VIEW_TYPE,
            (leaf) => new ExpensicaTransactionsView(leaf, this)
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
                // If file doesn't exist, initialize with default data
                this.transactionsData = DEFAULT_TRANSACTIONS_DATA;
                await this.saveTransactionsData();
                return;
            }

            // Read the file content
            const fileContent = await this.app.vault.adapter.read(this.transactionsFilePath);

            // Parse the JSON content
            this.transactionsData = JSON.parse(fileContent);

            // Validate the data structure
            if (!this.transactionsData.transactions) {
                this.transactionsData.transactions = [];
            }

            if (!this.transactionsData.lastUpdated) {
                this.transactionsData.lastUpdated = new Date().toISOString();
            }

            // Log success
            console.log('Expensica: Transactions loaded successfully', this.transactionsData.transactions.length, 'transactions found');
        } catch (error) {
            // If there's an error, initialize with default data
            console.error('Expensica: Error loading transactions data', error);
            new Notice('Error loading transactions data. Using default data.');
            this.transactionsData = DEFAULT_TRANSACTIONS_DATA;
            await this.saveTransactionsData();
        }
    }

    async saveTransactionsData() {
        try {
            // Update timestamp
            this.transactionsData.lastUpdated = new Date().toISOString();
            await this.app.vault.adapter.write(
                this.transactionsFilePath,
                JSON.stringify(this.transactionsData, null, 2)
            );
        } catch (error) {
            console.error('Failed to save transactions data:', error);
            new Notice('Failed to save transactions data');
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
            new Notice('Error loading budget data. Using default data.');
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
            new Notice('Error saving budget data. See console for details.');
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
        // Activate existing leaf if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_TRANSACTIONS_VIEW_TYPE);
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(leaves[0]);
        } else {
            // Create a new leaf
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: EXPENSICA_TRANSACTIONS_VIEW_TYPE,
                active: true
            });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    async openExpenseModal() {
        // Find the dashboard view if it exists
        const leaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
        if (leaves.length > 0 && leaves[0].view instanceof ExpensicaDashboardView) {
            const dashboardView = leaves[0].view as ExpensicaDashboardView;
            const modal = new ExpenseModal(this.app, this, dashboardView);
            modal.open();
        } else {
            // Open the dashboard first, then open the modal
            await this.openDashboard();
            setTimeout(() => {
                const newLeaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
                if (newLeaves.length > 0 && newLeaves[0].view instanceof ExpensicaDashboardView) {
                    const dashboardView = newLeaves[0].view as ExpensicaDashboardView;
                    const modal = new ExpenseModal(this.app, this, dashboardView);
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
            const modal = new IncomeModal(this.app, this, dashboardView);
            modal.open();
        } else {
            // Open the dashboard first, then open the modal
            await this.openDashboard();
            setTimeout(() => {
                const newLeaves = this.app.workspace.getLeavesOfType(EXPENSICA_VIEW_TYPE);
                if (newLeaves.length > 0 && newLeaves[0].view instanceof ExpensicaDashboardView) {
                    const dashboardView = newLeaves[0].view as ExpensicaDashboardView;
                    const modal = new IncomeModal(this.app, this, dashboardView);
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
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Ensure categories have the required structure
        // This handles migration from old format
        if (!this.settings.categories[0]?.emoji) {
            this.settings.categories = DEFAULT_CATEGORIES;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Get categories filtered by type
    getCategories(type?: CategoryType): Category[] {
        if (!type) {
            return this.settings.categories;
        }
        return this.settings.categories.filter(c => c.type === type);
    }

    // Get category by ID
    getCategoryById(id: string): Category | undefined {
        return this.settings.categories.find(c => c.id === id);
    }

    // Add a new category
    async addCategory(category: Category): Promise<void> {
        this.settings.categories.push(category);
        await this.saveSettings();
    }

    // Update a category
    async updateCategory(updatedCategory: Category): Promise<void> {
        const index = this.settings.categories.findIndex(c => c.id === updatedCategory.id);
        if (index !== -1) {
            this.settings.categories[index] = updatedCategory;
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
    handleDeletedCategory(categoryId: string): void {
        // Get the category type
        const category = this.getCategoryById(categoryId);
        if (!category) return;

        // Find a default replacement category of the same type
        const defaultCategory = this.getCategories(category.type)[0];
        if (!defaultCategory) return;

        // Update all transactions using this category
        let updatedCount = 0;
        this.transactionsData.transactions.forEach(transaction => {
            if (transaction.category === categoryId) {
                transaction.category = defaultCategory.id;
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            this.saveTransactionsData();
            console.log(`Updated ${updatedCount} transactions to use the default category`);
        }
    }

    // Delete a category
    async deleteCategory(id: string): Promise<void> {
        // Store the category for reference
        const category = this.getCategoryById(id);
        if (!category) return;

        new ExpensicaConfirmationModal(
            this.app,
            'Delete Category?',
            `Are you sure you want to delete the "${category.name}" category? This action cannot be undone.`,
            async (confirmed) => {
                if (confirmed) {
                    // Remove from categories list
                    this.settings.categories = this.settings.categories.filter(c => c.id !== id);

                    // Save settings
                    await this.saveSettings();

                    // Check if any transactions use this category and update them
                    const isInUse = this.isCategoryInUse(id);
                    if (isInUse) {
                        this.handleDeletedCategory(id);
                    }

                    // Refresh the settings tab UI
                    if (this.settingTab) {
                        this.settingTab.display();
                    }
                }
            }
        ).open();
    }

    // Methods for transaction management
    async addTransaction(transaction: Transaction) {
        this.transactionsData.transactions.push(transaction);
        await this.saveTransactionsData();
    }

    async updateTransaction(transaction: Transaction) {
        const index = this.transactionsData.transactions.findIndex(t => t.id === transaction.id);
        if (index !== -1) {
            this.transactionsData.transactions[index] = transaction;
            await this.saveTransactionsData();
        }
    }

    async deleteTransaction(id: string) {
        const index = this.transactionsData.transactions.findIndex(t => t.id === id);
        if (index !== -1) {
            this.transactionsData.transactions.splice(index, 1);
            await this.saveTransactionsData();
        }
    }

    // Get transactions for a specific month
    getTransactionsForMonth(year: number, month: number): Transaction[] {
        return this.transactionsData.transactions.filter(transaction => {
            const date = new Date(transaction.date);
            return date.getFullYear() === year && date.getMonth() === month;
        });
    }

    // Get all transactions
    getAllTransactions(): Transaction[] {
        return [...this.transactionsData.transactions];
    }

    // Export transactions to JSON (legacy method for backward compatibility)
    async exportTransactionsToJSON(filePath: string) {
        try {
            const jsonData = JSON.stringify(this.transactionsData.transactions, null, 2);
            await this.app.vault.adapter.write(filePath, jsonData);
            new Notice('Transactions exported successfully');
            return true;
        } catch (error) {
            console.error('Error exporting transactions:', error);
            new Notice('Error exporting transactions');
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
                new Notice(`Imported ${validTransactions.length} transactions successfully`);
                return true;
            } else {
                new Notice('Invalid file format for import');
                return false;
            }
        } catch (error) {
            console.error('Error importing transactions:', error);
            new Notice('Error importing transactions');
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
            
            // Get the past 7 days date range
            const last7DaysStart = new Date(now);
            last7DaysStart.setDate(last7DaysStart.getDate() - 7);
            last7DaysStart.setHours(0, 0, 0, 0);
            
            // Get all transactions
            const allTransactions = this.getAllTransactions();
            
            // Filter for different time periods
            const todaysTransactions = allTransactions.filter(transaction => {
                const transactionDate = new Date(transaction.date);
                return transactionDate >= todayStart && transactionDate <= todayEnd;
            });
            
            const yesterdayTransactions = allTransactions.filter(transaction => {
                const transactionDate = new Date(transaction.date);
                return transactionDate >= yesterdayStart && transactionDate <= yesterdayEnd;
            });
            
            const last7DaysTransactions = allTransactions.filter(transaction => {
                const transactionDate = new Date(transaction.date);
                return transactionDate >= last7DaysStart && transactionDate <= todayEnd;
            });
            
            // Get current month's transactions for month-to-date analysis
            const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthToDateTransactions = allTransactions.filter(transaction => {
                const transactionDate = new Date(transaction.date);
                return transactionDate >= monthStartDate && transactionDate <= todayEnd;
            });
            
            // Format today's date for the note title
            const dateStr = formatDate(now);
            const noteTitle = `Daily Finance Review - ${dateStr}`;
            
            // Generate note content
            let noteContent = `# ${noteTitle}\n\n`;
            noteContent += `> [!info] This note was automatically generated by Expensica on ${now.toLocaleString()}\n\n`;
            
            // Calculate summary metrics
            const todayIncome = TransactionAggregator.getTotalIncome(todaysTransactions);
            const todayExpenses = TransactionAggregator.getTotalExpenses(todaysTransactions);
            const todayBalance = TransactionAggregator.getBalance(todaysTransactions);
            
            const yesterdayIncome = TransactionAggregator.getTotalIncome(yesterdayTransactions);
            const yesterdayExpenses = TransactionAggregator.getTotalExpenses(yesterdayTransactions);
            
            const last7DaysIncome = TransactionAggregator.getTotalIncome(last7DaysTransactions);
            const last7DaysExpenses = TransactionAggregator.getTotalExpenses(last7DaysTransactions);
            const last7DaysAvgExpenses = last7DaysTransactions.length > 0 ? last7DaysExpenses / 7 : 0;
            
            const mtdIncome = TransactionAggregator.getTotalIncome(monthToDateTransactions);
            const mtdExpenses = TransactionAggregator.getTotalExpenses(monthToDateTransactions);
            
            // Get number of days passed in the month
            const daysPassed = now.getDate();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const mtdDailyAvgExpense = daysPassed > 0 ? mtdExpenses / daysPassed : 0;
            
            // Project month-end totals based on daily average
            const projectedMonthExpenses = mtdDailyAvgExpense * daysInMonth;
            
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
                
                // Compare with 7-day average
                if (last7DaysTransactions.length > 0) {
                    const vsAvgDiff = todayExpenses - last7DaysAvgExpenses;
                    const vsAvgPctChange = last7DaysAvgExpenses !== 0 
                        ? (vsAvgDiff / last7DaysAvgExpenses) * 100 
                        : todayExpenses > 0 ? 100 : 0;
                    
                    const avgCompareText = vsAvgDiff > 0 
                        ? `${formatCurrency(vsAvgDiff, this.settings.defaultCurrency)} more than your daily average (${vsAvgPctChange.toFixed(1)}% higher)` 
                        : vsAvgDiff < 0 
                            ? `${formatCurrency(Math.abs(vsAvgDiff), this.settings.defaultCurrency)} less than your daily average (${Math.abs(vsAvgPctChange).toFixed(1)}% lower)` 
                            : `exactly your daily average`;
                    
                    noteContent += `**Compared to 7-Day Average:**\n`;
                    noteContent += `- You spent ${avgCompareText}\n`;
                    noteContent += `- Your 7-day average daily expense is ${formatCurrency(last7DaysAvgExpenses, this.settings.defaultCurrency)}\n\n`;
                }
            }
            
            // Month-to-date section
            noteContent += `## 📅 Month-to-Date Progress\n\n`;
            noteContent += `**Current Month Overview:**\n`;
            noteContent += `- **Total Income**: ${formatCurrency(mtdIncome, this.settings.defaultCurrency)}\n`;
            noteContent += `- **Total Expenses**: ${formatCurrency(mtdExpenses, this.settings.defaultCurrency)}\n`;
            noteContent += `- **Net Balance**: ${formatCurrency(mtdIncome - mtdExpenses, this.settings.defaultCurrency)}\n`;
            noteContent += `- **Average Daily Expense**: ${formatCurrency(mtdDailyAvgExpense, this.settings.defaultCurrency)}\n`;
            noteContent += `- **Projected Month-End Expenses**: ${formatCurrency(projectedMonthExpenses, this.settings.defaultCurrency)}\n`;
            noteContent += `- **Days Remaining in Month**: ${daysInMonth - daysPassed}\n\n`;
            
            // Budget status section (if budgeting is enabled)
            if (this.settings.enableBudgeting && this.budgetData.budgets.length > 0) {
                noteContent += `## 💰 Budget Status\n\n`;
                
                // Get all expense categories with budgets
                const budgetStatuses = [];
                
                for (const budget of this.budgetData.budgets) {
                    const category = this.getCategoryById(budget.categoryId);
                    if (!category) continue;
                    
                    const status = calculateBudgetStatus(budget, monthToDateTransactions, now);
                    const remainingPercent = 100 - status.percentage;
                    
                    let statusEmoji = "✅"; // Default: on track
                    if (status.remaining < 0) {
                        statusEmoji = "🚨"; // Over budget
                    } else if (status.percentage > 90) {
                        statusEmoji = "⚠️"; // Near limit
                    } else if (status.percentage < 10) {
                        statusEmoji = "🎉"; // Barely spent
                    }
                    
                    // Check if any transactions today were in this category
                    const todayForCategory = todaysTransactions.filter(t => 
                        t.category === budget.categoryId && t.type === TransactionType.EXPENSE
                    );
                    
                    const todayAmount = todayForCategory.reduce((sum, t) => sum + t.amount, 0);
                    
                    budgetStatuses.push({
                        category,
                        budget,
                        status,
                        todayAmount,
                        statusEmoji
                    });
                }
                
                if (budgetStatuses.length > 0) {
                    noteContent += `| Category | Today's Spending | Budget | Spent | Remaining | Status |\n`;
                    noteContent += `| ------- | --------------- | ------ | ----- | --------- | ------ |\n`;
                    
                    for (const item of budgetStatuses) {
                        const { category, budget, status, todayAmount, statusEmoji } = item;
                        
                        const today = todayAmount > 0 
                            ? formatCurrency(todayAmount, this.settings.defaultCurrency) 
                            : "-";
                            
                        const statusText = status.remaining < 0 
                            ? `${statusEmoji} Over budget by ${formatCurrency(Math.abs(status.remaining), this.settings.defaultCurrency)}` 
                            : `${statusEmoji} ${(100 - status.percentage).toFixed(1)}% left`;
                        
                        noteContent += `| ${category.emoji} ${category.name} | ${today} | ${formatCurrency(budget.amount, this.settings.defaultCurrency)} | ${formatCurrency(status.spent, this.settings.defaultCurrency)} | ${formatCurrency(status.remaining, this.settings.defaultCurrency)} | ${statusText} |\n`;
                    }
                    noteContent += `\n`;
                } else {
                    noteContent += `No budgets have been set up. Consider setting up budgets to track your spending limits.\n\n`;
                }
            }
            
            // Today's transactions section
            if (todaysTransactions.length > 0) {
                noteContent += `## 📝 Today's Transactions\n\n`;
                noteContent += `| Time | Description | Category | Amount | Notes |\n`;
                noteContent += `| ---- | ----------- | -------- | ------ | ----- |\n`;
                
                // Sort transactions by time (newest first)
                const sortedTransactions = [...todaysTransactions].sort((a, b) => 
                    new Date(b.date).getTime() - new Date(a.date).getTime()
                );
                
                // Add each transaction to the table
                for (const transaction of sortedTransactions) {
                    const category = this.getCategoryById(transaction.category);
                    const categoryName = category ? `${category.emoji} ${category.name}` : '❓ Unknown';
                    const notes = transaction.notes || '';
                    
                    // Format time (just the time portion)
                    const txDate = new Date(transaction.date);
                    const timeStr = txDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    
                    // Format amount with color indicator
                    const amountStr = transaction.type === TransactionType.INCOME 
                        ? `+${formatCurrency(transaction.amount, this.settings.defaultCurrency)}` 
                        : `-${formatCurrency(transaction.amount, this.settings.defaultCurrency)}`;
                    
                    noteContent += `| ${timeStr} | ${transaction.description} | ${categoryName} | ${amountStr} | ${notes} |\n`;
                }
                noteContent += `\n`;
                
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
            
            // Personal finance insights
            noteContent += `## 💡 Finance Insights\n\n`;
            
            // Generate insights based on the data
            const insights = [];
            
            // 1. Spending pattern vs. 7-day average
            if (todayExpenses > 0 && last7DaysAvgExpenses > 0) {
                const diffPct = ((todayExpenses - last7DaysAvgExpenses) / last7DaysAvgExpenses) * 100;
                
                if (diffPct > 50) {
                    insights.push(`- Today's spending was significantly higher (${diffPct.toFixed(1)}%) than your 7-day average. Consider reviewing your expenses to see if there were any unusual purchases.`);
                } else if (diffPct < -30) {
                    insights.push(`- Great job! Today's spending was much lower (${Math.abs(diffPct).toFixed(1)}%) than your 7-day average.`);
                }
            }
            
            // 2. Month-to-date budget pace
            const dayRatio = daysPassed / daysInMonth;
            const monthProgress = dayRatio * 100;
            
            if (this.budgetData.budgets.length > 0) {
                // Count budgets where spending is faster than month progress
                let fastPaceBudgets = 0;
                let overBudgets = 0;
                let underspentBudgets = 0;
                
                for (const budget of this.budgetData.budgets) {
                    const status = calculateBudgetStatus(budget, monthToDateTransactions, now);
                    
                    if (status.remaining < 0) {
                        overBudgets++;
                    } else if (status.percentage > monthProgress + 10) {
                        fastPaceBudgets++;
                    } else if (status.percentage < monthProgress - 20 && status.percentage > 0) {
                        underspentBudgets++;
                    }
                }
                
                if (overBudgets > 0) {
                    insights.push(`- You have ${overBudgets} ${overBudgets === 1 ? 'category' : 'categories'} that have exceeded their budget for this month.`);
                }
                
                if (fastPaceBudgets > 0) {
                    insights.push(`- You're spending faster than the month's pace in ${fastPaceBudgets} ${fastPaceBudgets === 1 ? 'category' : 'categories'}. We're ${monthProgress.toFixed(1)}% through the month, but these categories have used more of their budgets.`);
                }
                
                if (underspentBudgets > 0) {
                    insights.push(`- You're significantly under-budget in ${underspentBudgets} ${underspentBudgets === 1 ? 'category' : 'categories'}, which is great for your savings!`);
                }
            }
            
            // 3. Spending streak insights
            if (todayExpenses === 0 && yesterdayTransactions.length > 0) {
                insights.push(`- No expenses today! This is a good opportunity to maintain your no-spending streak tomorrow.`);
            }
            
            // 4. Monthly projection insights
            if (projectedMonthExpenses > 0) {
                const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lastMonthEndDate = new Date(now.getFullYear(), now.getMonth(), 0);
                
                const lastMonthTransactions = allTransactions.filter(transaction => {
                    const txDate = new Date(transaction.date);
                    return txDate >= lastMonthDate && txDate <= lastMonthEndDate;
                });
                
                const lastMonthExpenses = TransactionAggregator.getTotalExpenses(lastMonthTransactions);
                
                if (lastMonthExpenses > 0) {
                    const projectionVsLastMonth = ((projectedMonthExpenses - lastMonthExpenses) / lastMonthExpenses) * 100;
                    
                    if (projectionVsLastMonth > 15) {
                        insights.push(`- Based on your current spending rate, you're projected to spend ${projectionVsLastMonth.toFixed(1)}% more this month compared to last month.`);
                    } else if (projectionVsLastMonth < -15) {
                        insights.push(`- Great news! Your current spending rate suggests you'll spend ${Math.abs(projectionVsLastMonth).toFixed(1)}% less this month compared to last month.`);
                    }
                }
            }
            
            // 5. Categorical spending insights
            if (todaysTransactions.length > 0) {
                // Identify the top spending category today
                const expensesByCategory = TransactionAggregator.getExpensesByCategory(
                    todaysTransactions.filter(t => t.type === TransactionType.EXPENSE),
                    this.settings.categories
                );
                
                if (Object.keys(expensesByCategory).length > 0) {
                    const sortedCategories = Object.entries(expensesByCategory)
                        .sort((a, b) => b[1] - a[1]);
                    
                    if (sortedCategories.length > 0) {
                        const [topCategory, topAmount] = sortedCategories[0];
                        const topCategoryPct = (topAmount / todayExpenses) * 100;
                        
                        if (topCategoryPct > 50 && todayExpenses > 0) {
                            insights.push(`- Most of today's spending (${topCategoryPct.toFixed(1)}%) went to ${topCategory}.`);
                        }
                    }
                }
            }
            
            // Add insights to note
            if (insights.length > 0) {
                noteContent += insights.join('\n\n');
            } else {
                noteContent += `No specific insights available for today. Continue tracking your expenses to unlock more personalized insights.\n\n`;
            }
            
            // Add a quote or tip about finance at the end
            const financeTips = [
                "Remember, it's not how much you make, but how much you save that builds wealth.",
                "The best time to start saving was yesterday. The second best time is today.",
                "Budget tip: Try the 50/30/20 rule - 50% on needs, 30% on wants, and 20% on savings.",
                "Track every expense, no matter how small. Small leaks sink big ships.",
                "Financial freedom isn't about being rich, but having options.",
                "Automate your savings to pay yourself first.",
                "The key to financial success is spending less than you earn.",
                "Your budget tells your money where to go instead of wondering where it went.",
                "Investing in your knowledge pays the best interest.",
                "Don't save what's left after spending; spend what's left after saving."
            ];
            
            const randomTip = financeTips[Math.floor(Math.random() * financeTips.length)];
            
            noteContent += `\n> [!quote] Finance Tip of the Day\n> ${randomTip}\n`;
            
            // Create or update the note
            const files = this.app.vault.getMarkdownFiles();
            const existingNote = files.find(file => file.basename === noteTitle);
            
            if (existingNote) {
                await this.app.vault.modify(existingNote, noteContent);
                new Notice(`Updated note: ${noteTitle}`);
                this.app.workspace.getLeaf().openFile(existingNote);
            } else {
                const newNote = await this.app.vault.create(`${noteTitle}.md`, noteContent);
                new Notice(`Created note: ${noteTitle}`);
                this.app.workspace.getLeaf().openFile(newNote);
            }
        } catch (error) {
            console.error('Failed to create daily finance review:', error);
            new Notice('Failed to create daily finance review');
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
                const colorPreview = selectDisplay.createDiv('color-preview');
                colorPreview.style.backgroundColor = previewColor;

                const selectText = selectDisplay.createSpan({ cls: 'expensica-select-display-text' });
                selectText.textContent = this.plugin.settings.calendarColorScheme.charAt(0).toUpperCase() + this.plugin.settings.calendarColorScheme.slice(1);
                
                const selectArrow = selectDisplay.createSpan({ cls: 'expensica-select-arrow' });
                selectArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
                
                const optionsContainer = container.createDiv('expensica-select-options');
                optionsContainer.style.display = 'none';
                
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
                    optionColorPreview.style.backgroundColor = this.getColorPreview(option.value);
                    optionEl.createSpan({ text: option.text });
                    
                    if (this.plugin.settings.calendarColorScheme === option.value) {
                        optionEl.addClass('expensica-option-selected');
                    }
                    
                    optionEl.addEventListener('click', async () => {
                        this.plugin.settings.calendarColorScheme = option.value;
                        await this.plugin.saveSettings();
                        
                        // Update the display
                        colorPreview.style.backgroundColor = this.getColorPreview(option.value);
                        selectText.textContent = option.text;
                        
                        // Hide the options
                        optionsContainer.style.display = 'none';
                        selectArrow.removeClass('expensica-select-arrow-open');
                        
                        // Show/hide custom color input
                        this.updateCustomColorVisibility();
                    });
                });
                
                // Toggle options on click
                selectDisplay.addEventListener('click', () => {
                    if (optionsContainer.style.display === 'none') {
                        optionsContainer.style.display = 'block';
                        selectArrow.addClass('expensica-select-arrow-open');
                    } else {
                        optionsContainer.style.display = 'none';
                        selectArrow.removeClass('expensica-select-arrow-open');
                    }
                });
                
                // Close options when clicking outside
                document.addEventListener('click', (e) => {
                    if (!container.contains(e.target as Node)) {
                        optionsContainer.style.display = 'none';
                        selectArrow.removeClass('expensica-select-arrow-open');
                    }
                });
            });
            
        // Custom color container (visible only when Custom is selected)
        const customColorContainer = containerEl.createDiv('custom-color-container');
        
        if (this.plugin.settings.calendarColorScheme === ColorScheme.CUSTOM) {
            customColorContainer.style.display = 'flex';
        } else {
            customColorContainer.style.display = 'none';
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
                customColorContainer.style.display = 'flex';
            } else {
                customColorContainer.style.display = 'none';
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
                
        // Categories settings
        containerEl.createEl('h2', { text: 'Categories' });
        
        // Expense Categories section
        const expenseCategoriesSectionEl = containerEl.createDiv('expensica-settings-section');
        expenseCategoriesSectionEl.createEl('h3', {text: 'Expense Categories'});

        // Display existing expense categories
        const expenseCategoriesContainer = expenseCategoriesSectionEl.createDiv('categories-container expense-categories');

        this.renderCategoriesList(expenseCategoriesContainer, CategoryType.EXPENSE);

        // Add new expense category with button
        const newExpenseCategorySetting = new Setting(expenseCategoriesSectionEl)
            .setName('Add new expense category')
            .addText(text => text
                .setPlaceholder('Category name'))
            .addButton(button => button
                .setButtonText('Add')
                .onClick(async () => {
                    const inputEl = newExpenseCategorySetting.controlEl.querySelector('input');
                    if (inputEl) {
                        const value = inputEl.value.trim();
                        if (value && !this.plugin.settings.categories.some(c => c.name === value && c.type === CategoryType.EXPENSE)) {
                            const newCategory: Category = {
                                id: generateId(),
                                name: value,
                                emoji: '💼', // Default emoji
                                type: CategoryType.EXPENSE
                            };
                            this.plugin.settings.categories.push(newCategory);
                            await this.plugin.saveSettings();
                            this.renderCategoriesList(expenseCategoriesContainer, CategoryType.EXPENSE);
                            inputEl.value = '';
                        }
                    }
                }));

        // Allow pressing Enter to add the category
        const expenseInputEl = newExpenseCategorySetting.controlEl.querySelector('input');
        if (expenseInputEl) {
            expenseInputEl.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = expenseInputEl.value.trim();
                    if (value && !this.plugin.settings.categories.some(c => c.name === value && c.type === CategoryType.EXPENSE)) {
                        const newCategory: Category = {
                            id: generateId(),
                            name: value,
                            emoji: '💼', // Default emoji
                            type: CategoryType.EXPENSE
                        };
                        this.plugin.settings.categories.push(newCategory);
                        await this.plugin.saveSettings();
                        this.renderCategoriesList(expenseCategoriesContainer, CategoryType.EXPENSE);
                        expenseInputEl.value = '';
                    }
                }
            });
        }

        // Income Categories section
        const incomeCategoriesSectionEl = containerEl.createDiv('expensica-settings-section');
        incomeCategoriesSectionEl.createEl('h3', {text: 'Income Categories'});

        // Display existing income categories
        const incomeCategoriesContainer = incomeCategoriesSectionEl.createDiv('categories-container income-categories');

        this.renderCategoriesList(incomeCategoriesContainer, CategoryType.INCOME);

        // Add new income category with button
        const newIncomeCategorySetting = new Setting(incomeCategoriesSectionEl)
            .setName('Add new income category')
            .addText(text => text
                .setPlaceholder('Category name'))
            .addButton(button => button
                .setButtonText('Add')
                .onClick(async () => {
                    const inputEl = newIncomeCategorySetting.controlEl.querySelector('input');
                    if (inputEl) {
                        const value = inputEl.value.trim();
                        if (value && !this.plugin.settings.categories.some(c => c.name === value && c.type === CategoryType.INCOME)) {
                            const newCategory: Category = {
                                id: generateId(),
                                name: value,
                                emoji: '💰', // Default emoji
                                type: CategoryType.INCOME
                            };
                            this.plugin.settings.categories.push(newCategory);
                            await this.plugin.saveSettings();
                            this.renderCategoriesList(incomeCategoriesContainer, CategoryType.INCOME);
                            inputEl.value = '';
                        }
                    }
                }));

        // Allow pressing Enter to add the category
        const incomeInputEl = newIncomeCategorySetting.controlEl.querySelector('input');
        if (incomeInputEl) {
            incomeInputEl.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = incomeInputEl.value.trim();
                    if (value && !this.plugin.settings.categories.some(c => c.name === value && c.type === CategoryType.INCOME)) {
                        const newCategory: Category = {
                            id: generateId(),
                            name: value,
                            emoji: '💰', // Default emoji
                            type: CategoryType.INCOME
                        };
                        this.plugin.settings.categories.push(newCategory);
                        await this.plugin.saveSettings();
                        this.renderCategoriesList(incomeCategoriesContainer, CategoryType.INCOME);
                        incomeInputEl.value = '';
                    }
                }
            });
        }

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

    renderCategoriesList(container: HTMLElement, type: CategoryType): void {
        container.empty();
        
        const categories = this.plugin.getCategories(type);
        
        if (categories.length === 0) {
            const emptyDiv = container.createDiv('expensica-empty-categories');
            emptyDiv.setText(`No ${type.toLowerCase()} categories found.`);
            return;
        }
        
        for (const category of categories) {
            const categoryDiv = container.createDiv('category-item');
            
            // Create category name with emoji
            const nameSpan = categoryDiv.createSpan('category-name');
            nameSpan.innerHTML = `<span class="category-emoji">${category.emoji}</span> ${category.name}`;
            
            const actionsDiv = categoryDiv.createDiv('category-actions');
            
            // Add edit emoji button with icon only (no text)
            const editEmojiButton = actionsDiv.createEl('button', {
                cls: 'category-edit-btn',
                attr: { 'aria-label': 'Edit Emoji', 'title': 'Edit Emoji' }
            });
            editEmojiButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
            
            // Add delete button with icon only (no text)
            const deleteButton = actionsDiv.createEl('button', {
                cls: 'category-delete-btn',
                attr: { 'aria-label': 'Delete', 'title': 'Delete' }
            });
            deleteButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            
            // Event listeners
            editEmojiButton.addEventListener('click', () => {
                new EmojiPickerModal(this.app, category, async (updatedCategory) => {
                    await this.plugin.updateCategory(updatedCategory);
                    this.renderCategoriesList(container, type);
                }).open();
            });
            
            deleteButton.addEventListener('click', async () => {
                // Don't delete if this was the last category of this type
                const typeCategories = this.plugin.getCategories(type);
                if (typeCategories.length <= 1) {
                    new Notice(`You must have at least one ${type} category`);
                    return;
                }
                
                // Check if category is in use
                const isInUse = this.plugin.isCategoryInUse(category.id);
                if (isInUse) {
                    // Show confirmation dialog
                    new ExpensicaConfirmationModal(
                        this.app,
                        `Delete "${category.name}" Category?`,
                        `This category is currently used by existing transactions. If you delete it, those transactions will show "Unknown Category" instead.`,
                        async (confirmed) => {
                            if (confirmed) {
                                await this.plugin.deleteCategory(category.id);
                                this.renderCategoriesList(container, type);
                                new Notice(`Category "${category.name}" has been deleted.`);
                            }
                        }
                    ).open();
                } else {
                    // Delete immediately if not in use
                    await this.plugin.deleteCategory(category.id);
                    this.renderCategoriesList(container, type);
                }
            });
        }
    }
}

// ConfirmationModal with improved UI
class ConfirmationModal extends Modal {
    title: string;
    message: string;
    onConfirm: (confirmed: boolean) => void;
    
    constructor(app: App, title: string, message: string, onConfirm: (confirmed: boolean) => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }
    
    onOpen() {
        const {contentEl} = this;
        
        contentEl.addClass('expensica-modal');
        
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = `<span class="expensica-modal-title-icon">⚠️</span> ${this.title}`;
        
        contentEl.createEl('p', {text: this.message});
        
        const buttonContainer = contentEl.createDiv('button-container');
        
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary'
        });
        
        const confirmButton = buttonContainer.createEl('button', {
            text: 'Delete',
            cls: 'expensica-btn expensica-btn-danger'
        });
        
        cancelButton.addEventListener('click', () => {
            this.onConfirm(false);
            this.close();
        });
        
        confirmButton.addEventListener('click', () => {
            this.onConfirm(true);
            this.close();
        });
    }
    
    onClose() {
        const {contentEl} = this;
        contentEl.empty();
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
                    new Notice(`File not found: ${filePath}`);
                }
            } else {
                new Notice('Please enter a file path');
            }
        });
    }
    
    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

// Emoji Picker Modal with improved UI
class EmojiPickerModal extends Modal {
    category: Category;
    onConfirm: (updatedCategory: Category) => void;
    
    constructor(app: App, category: Category, onConfirm: (updatedCategory: Category) => void) {
        super(app);
        this.category = category;
        this.onConfirm = onConfirm;
    }
    
    onOpen() {
        const {contentEl} = this;
        
        contentEl.addClass('expensica-modal');
        
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = `<span class="expensica-modal-title-icon">${this.category.emoji}</span> Choose Emoji for "${this.category.name}"`;
        
        const form = contentEl.createDiv('emoji-picker-form');
        
        const emojiInput = form.createEl('input', {
            attr: {
                type: 'text',
                value: this.category.emoji,
                placeholder: 'Enter an emoji'
            },
            cls: 'emoji-input'
        });
        
        const commonEmojis = form.createDiv('common-emojis');
        commonEmojis.createEl('p', {text: 'Common emojis:'});
        
        // Define emojis based on category type
        const emojis = this.category.type === CategoryType.EXPENSE
            ? ['💼', '🍽️', '🛒', '🚗', '🏠', '💡', '📱', '🎬', '🛍️', '🏥', '📚', '✈️', '🏋️', '🐾', '🎁', '💇', '👶', '📺', '🔒', '📝']
            : ['💰', '💵', '💳', '💻', '💸', '📈', '🏘️', '🎀', '📋', '💸'];
        
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
            const updatedCategory = {
                ...this.category,
                emoji: emojiInput.value || this.category.emoji
            };
            
            this.onConfirm(updatedCategory);
            this.close();
        });
    }
    
    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}