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
    getCurrencyByCode
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
}

// Define a separate interface for our transactions data
interface TransactionsData {
    transactions: Transaction[];
    lastUpdated: string; // ISO timestamp
}

// Define default settings
const DEFAULT_SETTINGS: ExpensicaSettings = {
    defaultCurrency: 'USD',
    categories: DEFAULT_CATEGORIES
}

// Default transactions data
const DEFAULT_TRANSACTIONS_DATA: TransactionsData = {
    transactions: [],
    lastUpdated: new Date().toISOString()
}

// Define the main plugin class
export default class ExpensicaPlugin extends Plugin {
    settings: ExpensicaSettings;
    transactionsData: TransactionsData;
    dataFolderPath: string = 'expensica-data';
    transactionsFilePath: string = 'expensica-data/transactions.json';
    settingTab: ExpensicaSettingTab | null = null;

    async onload() {
        await this.loadSettings();

        // Create data folder if it doesn't exist
        await this.ensureDataFolder();

        // Load transactions data
        await this.loadTransactionsData();
        
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

        // Add a command to export transactions
        this.addCommand({
            id: 'export-transactions',
            name: 'Export Transactions',
            callback: () => {
                this.openExportModal();
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
            // Update the lastUpdated timestamp
            this.transactionsData.lastUpdated = new Date().toISOString();

            // Convert to JSON
            const jsonData = JSON.stringify(this.transactionsData, null, 2);

            // Write to file
            await this.app.vault.adapter.write(this.transactionsFilePath, jsonData);

            console.log('Expensica: Transactions saved successfully');
        } catch (error) {
            console.error('Expensica: Error saving transactions data', error);
            new Notice('Error saving transactions data. See console for details.');
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
}

// Settings tab
class ExpensicaSettingTab extends PluginSettingTab {
    plugin: ExpensicaPlugin;

    constructor(app: App, plugin: ExpensicaPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: 'Expensica Settings'});

        // Add support and social links section at the top
        const supportSection = containerEl.createDiv('expensica-support-section');
        
        // Support text
        supportSection.createEl('p', {
            text: 'Thank you for using Expensica! If you find it helpful, consider supporting the development.',
            cls: 'expensica-support-text'
        });
        
        // Links container
        const linksContainer = supportSection.createDiv('expensica-links-container');
        
        // Buy Me A Coffee button
        const coffeeLink = linksContainer.createEl('a', {
            href: 'https://buymeacoffee.com/dhruvir',
            cls: 'expensica-coffee-btn',
            attr: { target: '_blank', rel: 'noopener' }
        });
        coffeeLink.innerHTML = `<svg width="20" height="20" viewBox="0 0 884 1279" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M791.109 297.518L790.231 297.002L788.201 296.383C789.018 297.072 790.04 297.472 791.109 297.518Z" fill="#0D0C22"></path>
        <path d="M803.896 388.891L802.916 389.166L803.896 388.891Z" fill="#0D0C22"></path>
        <path d="M791.484 297.377C791.359 297.361 791.237 297.332 791.118 297.29C791.111 297.371 791.111 297.453 791.118 297.534C791.252 297.516 791.379 297.462 791.484 297.377Z" fill="#0D0C22"></path>
        <path d="M791.113 297.529H791.244V297.447L791.113 297.529Z" fill="#0D0C22"></path>
        <path d="M803.111 388.726L804.591 387.883L805.142 387.573L805.641 387.04C804.702 387.444 803.846 388.016 803.111 388.726Z" fill="#0D0C22"></path>
        <path d="M793.669 299.515L792.223 298.138L791.243 297.605C791.77 298.535 792.641 299.221 793.669 299.515Z" fill="#0D0C22"></path>
        <path d="M430.019 1186.18C428.864 1186.68 427.852 1187.46 427.076 1188.45L427.988 1187.87C428.608 1187.3 429.485 1186.63 430.019 1186.18Z" fill="#0D0C22"></path>
        <path d="M641.187 1144.63C641.187 1143.33 640.551 1143.57 640.705 1148.21C640.705 1147.84 640.86 1147.46 640.929 1147.1C641.015 1146.27 641.084 1145.46 641.187 1144.63Z" fill="#0D0C22"></path>
        <path d="M619.284 1186.18C618.129 1186.68 617.118 1187.46 616.342 1188.45L617.254 1187.87C617.873 1187.3 618.751 1186.63 619.284 1186.18Z" fill="#0D0C22"></path>
        <path d="M281.304 1196.06C280.427 1195.3 279.354 1194.8 278.207 1194.61C279.136 1195.06 280.065 1195.51 280.684 1195.85L281.304 1196.06Z" fill="#0D0C22"></path>
        <path d="M247.841 1164.01C247.704 1162.66 247.288 1161.35 246.619 1160.16C247.093 1161.39 247.489 1162.66 247.806 1163.94L247.841 1164.01Z" fill="#0D0C22"></path>
        <path d="M472.623 590.836C426.682 583.939 377.504 620.755 371.518 671.123C366.045 718.028 389.162 760.777 424.356 765.91C426.784 766.296 429.249 766.498 431.721 766.517C474.479 766.517 511.307 720.842 516.384 674.478C521.666 626.858 518.539 597.779 472.623 590.836Z" fill="#FFDD00"></path>
        <path d="M847.812 1177.31C847.192 1173.76 846.299 1170.27 845.139 1166.89C841.493 1156.26 836.106 1146.36 829.218 1137.5C828.19 1135.81 826.902 1134.31 825.414 1133.04C823.926 1131.78 822.262 1130.77 820.483 1130.05C818.296 1129.25 815.947 1129.05 813.668 1129.46C811.388 1129.88 809.26 1130.89 807.524 1132.39C804.692 1134.95 803.809 1139.16 804.429 1142.94C807.881 1154.12 813.181 1164.68 820.135 1174.26C821.877 1177.08 824.03 1179.64 826.717 1181.17C829.119 1182.51 831.704 1183.45 834.35 1183.93C840.163 1185.11 845.437 1183.3 847.634 1177.58C847.722 1177.49 847.765 1177.39 847.812 1177.31Z" fill="#FFDD00"></path>
        <path d="M453.661 523.247L434.873 540.551C394.23 514.514 351.084 494.199 306.218 480.397L286.51 450.437C286.51 450.437 315.886 411.013 382.889 443.696C434.249 467.423 453.661 523.247 453.661 523.247Z" fill="#FFDD00"></path>
        <path d="M763.562 1044.03C763.562 1069.23 763.562 1094.43 763.562 1119.63C763.562 1120.4 763.562 1121.21 763.485 1121.97C762.962 1128.42 759.869 1134.37 754.886 1138.36C749.903 1142.35 743.418 1143.89 737.12 1142.59C734.419 1142.07 731.835 1141.04 729.506 1139.55C725.875 1137.38 723.032 1134.13 721.315 1130.25C719.598 1126.36 719.089 1122.03 719.852 1117.88C721.794 1109.17 723.737 1100.46 725.646 1091.75C735.07 1052.82 744.432 1013.89 753.732 974.951C754.236 972.695 754.669 970.428 755.086 968.152C756.387 959.78 757.601 951.4 758.989 943.063C761.911 925.498 774.101 911.405 791.497 907.963C797.785 906.758 804.317 907.074 810.448 908.884C816.579 910.694 822.093 913.92 826.446 918.27C834.704 926.338 838.593 937.496 838.28 948.982C837.913 963.503 835.494 977.961 833.548 992.329C829.067 1024.59 824.355 1056.8 819.678 1089.01C818.452 1097.45 817.227 1105.95 816.088 1114.41C815.666 1117.59 815.552 1120.82 815.748 1124.03C816.112 1130.85 823.546 1133.65 828.639 1129.15C830.403 1127.61 831.765 1125.66 832.612 1123.46C834.271 1120 834.881 1116.16 835.423 1112.34C835.737 1109.26 836.051 1106.18 836.32 1103.1C838.42 1080.78 840.588 1058.38 842.722 1036.06C843.845 1024.22 844.933 1012.36 846.021 1000.51C847.216 987.497 848.373 974.484 849.401 961.472C850.535 947.144 851.45 932.806 852.348 918.458C852.899 910.171 853.243 901.875 853.38 893.572C853.38 891.846 853.38 890.121 853.38 888.395C853.732 877.33 850.531 866.477 844.194 857.312C837.857 848.146 828.714 841.119 818.14 837.34C807.567 833.561 796.066 833.222 785.28 836.378C774.493 839.534 765.001 845.999 758.258 854.788C751.67 863.623 748.462 874.485 748.832 885.522C749.004 894.022 749.59 902.504 750.589 910.934C751.089 914.827 751.593 918.729 752.109 922.623C756.83 951.52 761.551 980.417 766.272 1009.31C768.599 1022.34 770.934 1035.36 773.388 1048.37C773.912 1051.06 774.45 1053.76 774.799 1056.47C775.417 1061.09 775.572 1066.02 774.034 1070.48C772.56 1074.75 768.424 1077.03 765.162 1073.73C763.988 1072.47 763.085 1070.96 762.519 1069.31C761.954 1067.65 761.739 1065.9 761.889 1064.16C762.123 1062.2 762.399 1060.25 762.664 1058.29C765.088 1039.41 767.528 1020.52 769.937 1001.63C770.952 993.599 771.967 985.55 772.966 977.518C773.263 974.988 773.541 972.441 773.819 969.911C774.051 967.846 773.551 966.782 771.27 966.449C769.641 966.237 767.983 966.36 766.41 966.812C764.838 967.264 763.39 968.032 762.166 969.064C760.62 970.294 759.306 971.77 758.283 973.426C757.259 975.082 756.542 976.891 756.164 978.782C753.664 987.746 751.516 996.818 749.25 1005.87C744.306 1026.94 739.361 1048.02 734.417 1069.09C733.088 1075.16 731.759 1081.24 730.396 1087.29C729.587 1090.89 728.688 1094.47 727.861 1098.06C725.56 1107.67 723.291 1117.27 721.073 1126.87C720.405 1129.79 719.823 1132.73 719.326 1135.68C717.561 1146.59 725.681 1156.49 736.516 1156.43C742.317 1156.4 747.898 1154.2 752.243 1150.25C752.243 1173.6 752.243 1196.95 752.243 1220.3C752.312 1221.44 752.312 1222.58 752.243 1223.72C751.934 1226.52 750.919 1229.19 749.294 1231.49C747.669 1233.78 745.487 1235.63 742.959 1236.88C739.93 1238.23 736.631 1238.85 733.331 1238.72C731.276 1238.67 729.241 1238.28 727.31 1237.57C724.196 1236.37 721.445 1234.39 719.299 1231.79C717.154 1229.19 715.679 1226.06 715.004 1222.7C714.799 1221.74 714.661 1220.77 714.591 1219.79C714.591 1193.95 714.591 1168.1 714.591 1142.26C714.591 1141.23 714.591 1140.2 714.591 1139.17C714.556 1136.85 714.001 1134.57 712.974 1132.51C711.947 1130.46 710.479 1128.69 708.7 1127.34C706.809 1125.81 704.59 1124.72 702.225 1124.11C699.86 1123.51 697.401 1123.41 694.994 1123.82C688.266 1124.65 684.13 1129.61 684.148 1136.38C684.148 1164.39 684.148 1192.41 684.148 1220.43C684.078 1221.92 684.25 1223.41 684.658 1224.84C685.065 1226.27 685.703 1227.61 686.541 1228.82C687.38 1230.02 688.404 1231.05 689.566 1231.86C690.728 1232.68 692.009 1233.25 693.351 1233.57C695.239 1234.01 697.197 1234.09 699.114 1233.8C701.032 1233.52 702.866 1232.87 704.5 1231.88C706.135 1230.9 707.533 1229.6 708.61 1228.07C709.686 1226.53 710.417 1224.77 710.753 1222.94C710.856 1222.2 710.892 1221.44 710.862 1221.69C710.862 1217.37 710.862 1213.04 710.862 1208.72C710.862 1173.92 710.862 1139.13 710.862 1104.34C710.862 1098.25 710.862 1092.16 710.862 1086.07C710.862 1085.94 710.862 1085.81 710.862 1085.68C710.9 1083.83 711.22 1082.01 711.805 1080.29C712.39 1078.56 713.231 1076.97 714.287 1075.59C716.382 1072.9 719.383 1071.12 722.676 1070.57C728.483 1069.57 733.017 1072.76 733.897 1078.66C734.256 1081.05 734.447 1083.46 734.47 1085.88C734.47 1086.88 734.47 1087.88 734.47 1088.88C734.47 1122.05 734.47 1155.22 734.47 1188.4C734.47 1199.22 734.47 1210.05 734.47 1220.88C734.44 1222.74 734.763 1224.59 735.418 1226.33C736.073 1228.07 737.05 1229.66 738.291 1231.01C739.531 1232.36 741.009 1233.45 742.647 1234.22C744.285 1234.99 746.053 1235.42 747.853 1235.49C753.695 1235.78 757.799 1232.84 759.56 1227.25C760.15 1225.35 760.46 1223.37 760.474 1221.37C760.474 1162.26 760.474 1103.15 760.474 1044.04C760.561 1044.03 763.562 1044.03 763.562 1044.03Z" fill="#0D0C22"></path>
        <path d="M530.754 675.307C533.458 680.089 536.713 684.532 540.458 688.527C544.175 692.657 548.513 696.136 549.289 701.876C550.065 706.651 550.065 711.515 549.289 716.29C548.718 719.717 547.558 723.024 545.852 726.057C544.497 728.508 542.752 730.714 540.685 732.579C539.051 734.135 537.196 735.433 535.176 736.432C532.779 737.617 530.213 738.404 527.578 738.764C524.944 739.124 522.273 739.051 519.665 738.548C516.775 738.007 513.991 736.993 511.393 735.542C508.615 733.965 506.117 731.964 503.996 729.61C502.179 727.651 500.561 725.52 499.171 723.25C497.766 720.936 496.677 718.457 495.933 715.878C495.176 713.212 494.786 710.453 494.775 707.68C494.775 706.024 495.061 704.369 495.146 702.713C495.271 699.767 495.835 696.854 496.822 694.063C498.188 690.019 500.244 686.234 502.912 682.859C503.737 681.784 504.562 680.701 505.4 679.635C506.432 678.362 507.483 677.107 508.55 675.852C510.53 673.557 512.679 671.409 514.974 669.429C516.016 668.482 517.005 667.475 517.935 666.416C519.232 664.909 520.319 663.237 521.166 661.44C522.011 659.682 522.598 657.811 522.91 655.881C523.142 654.391 523.125 652.87 522.859 651.388C522.484 649.409 521.688 647.539 520.527 645.913C519.366 644.287 517.869 642.942 516.137 641.974C514.243 640.964 512.105 640.512 509.966 640.665C507.826 640.818 505.787 641.57 504.1 642.83C503.124 643.56 502.243 644.41 501.473 645.361C500.714 646.298 500.149 647.36 499.306 648.273C496.916 650.859 493.917 652.825 490.557 654.011C486.892 655.213 482.921 655.124 479.319 653.754C475.716 652.385 472.696 649.81 470.712 646.477C469.464 644.333 468.788 641.919 468.743 639.457C468.697 637.023 469.175 634.605 470.145 632.38C471.115 630.155 472.553 628.175 474.37 626.565C476.126 624.974 478.089 623.629 480.209 622.565C483.018 621.112 485.941 619.851 488.951 618.791C491.825 617.774 494.778 616.992 497.786 616.455C500.662 615.907 503.582 615.634 506.506 615.639C509.48 615.639 512.454 615.969 515.38 616.336C518.377 616.695 521.337 617.347 524.223 618.285C527.097 619.246 529.855 620.538 532.447 622.137C537.52 625.29 541.787 629.553 544.945 634.622C548.085 639.771 549.974 645.57 550.466 651.579C550.708 654.52 550.43 657.479 549.646 660.323C548.879 663.008 547.67 665.545 546.067 667.831C544.397 670.304 542.395 672.541 540.117 674.481C537.075 676.89 534.032 679.3 530.754 681.709L530.754 675.307Z" fill="#0D0C22"></path>
        <path d="M631.764 702.776C631.718 699.522 631.149 696.297 630.077 693.247C628.775 689.603 626.597 686.332 623.73 683.733C622.238 682.411 620.54 681.338 618.702 680.559C616.865 679.78 614.913 679.304 612.929 679.148C610.945 678.992 608.948 679.158 607.028 679.64C605.108 680.121 603.291 680.91 601.654 681.969C599.968 683.062 598.489 684.436 597.279 686.033C595.97 687.678 594.921 689.518 594.166 691.48C593.431 693.307 592.926 695.216 592.659 697.163C592.352 699.264 592.258 701.393 592.381 703.515C592.455 705.7 592.753 707.872 593.271 709.994C593.871 712.428 594.824 714.761 596.099 716.918C597.453 719.207 599.231 721.214 601.337 722.84C602.724 723.927 604.27 724.799 605.919 725.426C607.516 726.049 609.202 726.41 610.912 726.499C612.622 726.587 614.337 726.401 615.99 725.949C617.642 725.496 619.206 724.785 620.618 723.841C622.09 722.849 623.395 721.637 624.487 720.246C625.685 718.791 626.666 717.175 627.402 715.451C628.199 713.591 628.763 711.644 629.083 709.651C629.427 707.613 629.6 705.55 629.6 703.481C629.6 703.231 629.497 702.972 629.497 702.739C630.186 702.73 630.874 702.78 631.551 702.886L631.764 702.776ZM687.335 702.534C688.027 702.534 688.72 702.534 689.412 702.534H689.608C689.608 704.75 689.608 706.965 689.608 709.181C689.559 714.008 688.849 718.809 687.493 723.451C686.165 728.006 684.031 732.288 681.177 736.075C678.328 739.867 674.802 743.099 670.765 745.592C666.755 748.064 662.308 749.737 657.663 750.53C652.964 751.32 648.173 751.223 643.508 750.245C638.863 749.289 634.408 747.484 630.349 744.916C626.288 742.396 622.694 739.177 619.737 735.398C616.876 731.711 614.657 727.52 613.19 723.023C611.686 718.329 610.941 713.419 610.982 708.484C611.02 703.656 611.738 698.857 613.114 694.223C614.529 689.504 616.813 685.094 619.849 681.201C622.888 677.306 626.623 673.991 630.863 671.426C635.086 668.87 639.741 667.082 644.604 666.15C649.407 665.241 654.335 665.212 659.148 666.064C663.961 666.917 668.573 668.638 672.726 671.14C676.893 673.643 680.526 676.911 683.434 680.762C686.373 684.594 688.554 688.949 689.859 693.602C691.172 698.289 691.797 703.168 691.712 708.062C691.712 709.378 691.712 710.69 691.712 712.005H690.327C688.927 712.005 687.543 712.005 686.143 712.005H631.568C631.408 712.326 631.305 712.666 631.262 713.018C631.179 713.8 631.249 714.59 631.466 715.341C631.683 716.092 632.044 716.79 632.527 717.393C633.035 718.016 633.651 718.539 634.341 718.935C635.098 719.363 635.925 719.66 636.785 719.815C637.835 720.008 638.906 720.054 639.968 719.953C640.845 719.866 641.703 719.623 642.498 719.235C643.211 718.89 643.858 718.424 644.412 717.857C644.901 717.365 645.307 716.8 645.618 716.183C645.866 715.665 646.077 715.132 646.248 714.585C646.275 714.546 646.295 714.504 646.307 714.459C646.32 714.413 646.324 714.366 646.32 714.319C646.32 714.233 646.421 714.268 646.574 714.268C647.319 714.268 648.063 714.268 648.808 714.268H687.021C686.839 715.688 686.572 717.096 686.221 718.484C685.452 721.455 684.328 724.314 682.87 726.991C680.754 730.905 677.928 734.39 674.536 737.265C671.088 740.16 667.073 742.346 662.745 743.707C658.39 745.042 653.823 745.566 649.286 745.255C644.75 744.944 640.318 743.802 636.24 741.889C632.179 739.979 628.527 737.345 625.46 734.103C622.43 730.902 620.035 727.145 618.393 723.046C616.762 718.958 615.927 714.593 615.927 710.182C615.927 705.771 616.762 701.405 618.393 697.318C619.996 693.18 622.356 689.388 625.346 686.147C628.394 682.855 632.042 680.181 636.106 678.238C640.171 676.296 644.577 675.124 649.088 674.782C652.889 674.486 656.711 674.87 660.374 675.914C664.037 676.959 667.475 678.65 670.531 680.916C673.518 683.096 676.104 685.791 678.164 688.868C680.255 691.995 681.786 695.458 682.693 699.113C683.006 700.264 683.244 701.434 683.407 702.619L687.335 702.534Z" fill="#0D0C22"></path>
        <path d="M306.938 702.534H348.994C349.234 702.534.349.416 702.721C349.478 702.925 349.536 703.13 349.581 703.344C349.581 706.762 349.581 710.18 349.581 713.598C349.581 715.893 349.581 718.188 349.581 720.483C349.533 721.548 349.391 722.608 349.156 723.65C348.662 725.772 347.764 727.782 346.511 729.56C345.258 731.339 343.673 732.855 341.846 734.027C339.898 735.258 337.706 736.065 335.41 736.398C333.114 736.732 330.776 736.584 328.547 735.965C326.226 735.339 324.049 734.258 322.152 732.789C320.312 731.38 318.771 729.626 317.616 727.626C316.488 725.683 315.709 723.555 315.309 721.341C314.908 719.117 314.908 716.839 315.309 714.615C315.707 712.4 316.486 710.272 317.616 708.327C318.773 706.328 320.313 704.574 322.152 703.164C324.076 701.614 326.3 700.471 328.684 699.802C331.077 699.131 333.582 698.951 336.044 699.274C338.506 699.597 340.873 700.416 342.996 701.687C345.118 702.957 346.949 704.65 348.382 706.67C348.399 706.698 348.417 706.723 348.436 706.748L348.471 706.704C348.573 706.585 348.667 706.476 348.78 706.38C349.077 706.142 349.411 705.954 349.769 705.823C350.126 705.691 350.503 705.619 350.883 705.61C351.264 705.6 351.645 705.654 352.008 705.768C352.371 705.882 352.714 706.055 353.022 706.28C353.35 706.522 353.631 706.821 353.851 707.164C354.07 707.506 354.226 707.886 354.308 708.283C354.389 708.681 354.396 709.089 354.326 709.489C354.256 709.889 354.112 710.274 353.901 710.625C353.671 710.999 353.387 711.339 353.058 711.633C352.709 711.933 352.337 712.203 351.946 712.442C351.438 712.744 350.954 713.081 350.498 713.452C347.777 715.726 346.321 718.852 346.161 722.172C346.001 725.493 347.149 728.735 349.395 731.208C350.489 732.363 351.815 733.285 353.286 733.923C354.757 734.561 356.343 734.9 357.944 734.919C361.148 734.957 364.225 733.704 366.475 731.42C366.844 731.048 367.182 730.649 367.487 730.226C367.688 729.934 367.883 729.635 368.075 729.337C368.267 729.039 368.35 728.75 368.533 728.46C368.75 724.998 368.75 721.535 368.75 718.073C368.75 717.2 368.75 716.318 368.75 715.444C368.75 712.995 368.75 710.546 368.75 708.097C368.75 706.225 368.75 704.36 368.75 702.492C368.75 702.466 368.768 702.431 368.785 702.405H378.091C379.091 702.405 380.091 702.405 381.099 702.405C381.099 702.525 381.099 702.655 381.099 702.784C381.099 711.974 381.099 721.164 381.099 730.355C381.099 731.441 381.099 732.528 381.099 733.623C381.099 740.761 373.526 745.989 366.806 746.148C363.953 746.219 361.122 745.651 358.522 744.482C355.922 743.312 353.617 741.569 351.773 739.38C349.929 737.241 348.61 734.691 347.922 731.933C347.233 729.176 347.193 726.293 347.805 723.518C348.403 720.803 349.62 718.258 351.366 716.093C353.143 713.921 355.427 712.176 358.026 710.984C360.626 709.792 363.469 709.182 366.34 709.198C368.507 709.218 370.654 709.633 372.67 710.421C373.56 710.777 374.41 711.221 375.205 711.744C375.205 709.677 375.205 707.62 375.205 705.553C375.205 704.677 375.205 703.795 375.205 702.918C375.205 702.892 375.187 702.857 375.178 702.831C374.099 701.905 372.876 701.161 371.557 700.631C370.238 700.101 368.841 699.792 367.425 699.717C365.997 699.616 364.561 699.739 363.175 700.081C361.789 700.423 360.477 700.978 359.295 701.724C358.113 702.477 357.08 703.41 356.235 704.484C355.391 705.557 354.748 706.756 354.335 708.027C353.957 709.199 353.759 710.417 353.747 711.643H306.946L306.938 702.534Z" fill="#0D0C22"></path>
        <path d="M880.421 714.599C877.028 716.073 873.456 717.116 869.798 717.705C866.055 718.28 862.271 718.553 858.481 718.522C857.15 718.522 855.845 718.522 854.532 718.522C853.219 718.522 851.906 718.522 850.62 718.522C849.334 718.522 848.074 718.522 846.805 718.522C844.317 718.522 841.838 718.522 839.35 718.522C839.111 718.438 838.888 718.314 838.688 718.156C838.489 717.999 838.316 717.811 838.178 717.599C838.04 717.387 837.937 717.156 837.876 716.913C837.815 716.671 837.796 716.421 837.82 716.173C837.82 712.625 837.82 709.068 837.82 705.511C837.82 704.876 837.82 704.233 837.82 703.598C837.885 691.698 837.882 679.807 837.811 667.917C837.794 662.652 837.777 657.388 837.759 652.123C837.742 646.858 837.751 641.755 837.751 636.49C837.751 635.178 837.751 633.865 837.751 632.552C837.751 633.214 837.751 633.875 837.751 634.537C837.752 646.099 837.825 657.662 837.971 669.223C838.047 675.522 838.117 681.82 838.182 688.119C838.247 694.419 838.308 700.718 838.378 707.017C838.385 707.638 838.482 708.253 838.668 708.845C838.774 709.17 838.953 709.466 839.192 709.709C839.431 709.952 839.723 710.135 840.046 710.244C840.57 710.43 841.124 710.522 841.681 710.515C844.339 710.515 847.005 710.515 849.663 710.515H853.645H857.627C857.849 710.515 858.071 710.515 858.294 710.515C860.678 710.546 863.059 710.303 865.39 709.792C867.622 709.306 869.775 708.482 871.778 707.345C873.835 706.187 875.616 704.63 877.008 702.769C878.4 700.908 879.374 698.784 879.865 696.532C880.367 694.214 880.44 691.828 880.081 689.483C879.721 687.138 878.935 684.876 877.763 682.823C876.456 680.59 874.674 678.696 872.539 677.254C870.404 675.813 867.967 674.86 865.39 674.45C862.927 674.062 860.428 673.958 857.942 674.137C855.503 674.308 853.067 674.387 850.629 674.372H841.681L841.05 674.372L840.428 674.372C840.114 674.26 839.831 674.074 839.602 673.83C839.372 673.585 839.203 673.289 839.107 672.966C838.928 672.363 838.835 671.738 838.83 671.108C838.83 670.472 838.83 669.838 838.83 669.214C838.845 668.573 838.945 667.938 839.127 667.327C839.22 667.003 839.388 666.706 839.617 666.461C839.846 666.217 840.129 666.032 840.444 665.922C840.946 665.721 841.484 665.62 842.025 665.623C844.7 665.623 847.366 665.623 850.032 665.623C851.932 665.623 853.832 665.623 855.732 665.623C857.631 665.623 859.532 665.623 861.432 665.623C862.902 665.607 864.371 665.531 865.835 665.395C867.241 665.273 868.629 665.013 869.981 664.62C871.233 664.278 872.437 663.775 873.56 663.126C874.618 662.507 875.569 661.723 876.375 660.805C877.169 659.91 877.807 658.876 878.25 657.746C878.695 656.621 878.928 655.424 878.935 654.215C878.964 652.948 878.744 651.686 878.284 650.5C877.825 649.314 877.136 648.226 876.255 647.295C875.28 646.252 874.143 645.373 872.887 644.692C871.654 644.009 870.344 643.468 868.979 643.075C867.567 642.674 866.122 642.381 864.656 642.198C862.917 641.989 861.166 641.88 859.412 641.874H854.789H850.166C847.688 641.874 845.209 641.874 842.73 641.874H841.59C842.212 641.874 841.59 641.874 841.214 641.874C840.821 641.874 840.29 641.874 839.912 641.548C839.55 641.226 839.224 640.865 838.941 640.47C838.77 640.225 838.644 639.95 838.567 639.659C838.491 639.368 838.465 639.066 838.491 638.766C838.491 638.027 838.491 637.288 838.491 636.549C838.506 635.889 838.606 635.234 838.788 634.605C838.884 634.289 839.052 634 839.279 633.762C839.505 633.523 839.782 633.341 840.09 633.23C840.558 633.044 841.055 632.953 841.555 632.961C843.754 632.961 845.953 632.961 848.151 632.961C850.35 632.961 852.548 632.961 854.746 632.961C856.944 632.961 859.142 632.961 861.341 632.961C862.742 632.977 864.141 633.053 865.532 633.191C866.845 633.318 868.14 633.578 869.397 633.963C870.578 634.317 871.711 634.815 872.773 635.446C873.739 636.018 874.628 636.708 875.421 637.5C876.138 638.228 876.735 639.069 877.189 639.993C877.635 640.882 877.922 641.849 878.037 642.848C878.152 643.846 878.094 644.858 877.865 645.838C877.585 646.931 877.088 647.96 876.4 648.863C875.694 649.788 874.834 650.594 873.858 651.247C872.905 651.882 871.881 652.403 870.806 652.801C869.699 653.212 868.566 653.566 867.416 653.864C866.176 654.194 864.91 654.452 863.631 654.635C862.196 654.853 860.747 654.988 859.293 655.039C855.944 655.144 852.586 655.144 849.236 655.039H842.321H840.864C840.525 654.916 840.218 654.71 839.97 654.438C839.722 654.166 839.54 653.837 839.441 653.477C839.228 652.883 839.122 652.258 839.129 651.628C839.129 648.132 839.129 644.636 839.129 641.131C839.129 634.987 839.129 628.843 839.129 622.699C839.161 621.978 839.386 621.278 839.782 620.672C839.981 620.375 840.247 620.127 840.557 619.948C840.867 619.77 841.213 619.665 841.573 619.641H841.759C842.091 619.641 842.321 619.641 842.654 619.641C844.7 619.641 846.747 619.641 848.793 619.641C851.672 619.641 854.55 619.641 857.429 619.641C860.307 619.641 863.186 619.641 866.064 619.641C867.798 619.673 869.529 619.828 871.242 620.106C872.858 620.367 874.436 620.833 875.934 621.492C877.345 622.119 878.661 622.944 879.846 623.944C880.981 624.901 881.975 626.003 882.8 627.22C883.633 628.471 884.28 629.841 884.716 631.283C885.207 632.91 885.447 634.602 885.429 636.302C885.433 637.962 885.174 639.614 884.663 641.191C884.198 642.642 883.484 644.001 882.552 645.214C881.649 646.388 880.582 647.433 879.385 648.321C878.2 649.204 876.937 649.971 875.61 650.615C874.231 651.287 872.809 651.87 871.354 652.358C873.006 652.852 874.596 653.539 876.093 654.404C877.591 655.268 878.959 656.341 880.155 657.582C881.35 658.823 882.344 660.252 883.091 661.81C883.838 663.369 884.327 665.035 884.537 666.748C884.748 668.461 884.679 670.194 884.331 671.881C883.983 673.569 883.361 675.189 882.492 676.675C881.624 678.16 880.519 679.486 879.227 680.6C877.95 681.714 876.496 682.609 874.925 683.26C873.354 683.91 871.689 684.308 870 684.44C868.284 684.573 866.568 684.565 864.852 684.44C867.428 684.6 870.002 684.919 872.545 685.394C874.962 685.84 877.27 686.771 879.324 688.128C881.394 689.431 883.151 691.172 884.472 693.228C885.794 695.284 886.649 697.604 886.979 700.024C887.313 702.444 887.117 704.907 886.41 707.252C885.703 709.597 884.5 711.768 882.886 713.616C882.121 714.653 881.214 715.581 880.193 716.371C880.268 715.774 880.352 715.186 880.421 714.599Z" fill="#0D0C22"></path>
        <path d="M443.929 675.307C446.633 680.089 449.888 684.532 453.633 688.527C457.35 692.657 461.688 696.136 462.464 701.876C463.24 706.651 463.24 711.515 462.464 716.29C461.893 719.717 460.733 723.024 459.027 726.057C457.672 728.508 455.927 730.714 453.86 732.579C452.226 734.135 450.371 735.433 448.351 736.432C445.954 737.617 443.388 738.404 440.753 738.764C438.119 739.124 435.448 739.051 432.84 738.548C429.95 738.007 427.166 736.993 424.568 735.542C421.79 733.965 419.292 731.964 417.171 729.61C415.354 727.651 413.736 725.52 412.346 723.25C410.941 720.936 409.852 718.457 409.108 715.878C408.351 713.212 407.961 710.453 407.95 707.68C407.95 706.024 408.236 704.369 408.321 702.713C408.446 699.767 409.01 696.854 409.997 694.063C411.363 690.019 413.419 686.234 416.087 682.859C416.912 681.784 417.737 680.701 418.575 679.635C419.607 678.362 420.658 677.107 421.725 675.852C423.704 673.557 425.854 671.409 428.149 669.429C429.191 668.482 430.18 667.475 431.11 666.416C432.407 664.909 433.494 663.237 434.341 661.44C435.186 659.682 435.773 657.811 436.085 655.881C436.317 654.391 436.3 652.87 436.034 651.388C435.659 649.409 434.863 647.539 433.702 645.913C432.541 644.287 431.044 642.942 429.312 641.974C427.418 640.964 425.28 640.512 423.141 640.665C421.001 640.818 418.962 641.57 417.275 642.83C416.299 643.56 415.418 644.41 414.648 645.361C413.889 646.298 413.324 647.36 412.481 648.273C410.091 650.859 407.092 652.825 403.732 654.011C400.067 655.213 396.096 655.124 392.494 653.754C388.891 652.385 385.872 649.81 383.887 646.477C382.639 644.333 381.963 641.919 381.918 639.457C381.872 637.023 382.35 634.605 383.32 632.38C384.29 630.155 385.728 628.175 387.545 626.565C389.301 624.974 391.264 623.629 393.384 622.565C396.193 621.112 399.116 619.851 402.126 618.791C405 617.774 407.953 616.992 410.961 616.455C413.837 615.907 416.757 615.634 419.681 615.639C422.655 615.639 425.629 615.969 428.555 616.336C431.552 616.695 434.512 617.347 437.398 618.285C440.272 619.246 443.03 620.538 445.622 622.137C450.695 625.29 454.962 629.553 458.12 634.622C461.26 639.771 463.149 645.57 463.641 651.579C463.883 654.52 463.605 657.479 462.821 660.323C462.054 663.008 460.844 665.545 459.242 667.831C457.572 670.304 455.57 672.541 453.292 674.481C450.25 676.89 447.207 679.3 443.929 681.709V675.307Z" fill="#0D0C22"></path>
        </svg> Buy Me A Coffee`;
        
        // Website link
        const websiteLink = linksContainer.createEl('a', {
            href: 'https://expensica.com/',
            cls: 'expensica-link',
            attr: { target: '_blank', rel: 'noopener' }
        });
        websiteLink.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> Website`;
        
        // LinkedIn link
        const linkedinLink = linksContainer.createEl('a', {
            href: 'https://www.linkedin.com/in/dhruvir-zala/',
            cls: 'expensica-link',
            attr: { target: '_blank', rel: 'noopener' }
        });
        linkedinLink.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg> LinkedIn`;

        // Currency section
        containerEl.createEl('h3', {text: 'Currency Settings'});

        const currencySetting = new Setting(containerEl)
            .setName('Default currency')
            .setDesc('Set the default currency for all transactions');

        // Create a container for our custom currency dropdown
        const currencyContainer = currencySetting.controlEl.createDiv('currency-dropdown-container');

        // Create the custom dropdown UI
        this.renderCurrencyDropdown(
            currencyContainer,
            this.plugin.settings.defaultCurrency,
            async (currencyCode) => {
                this.plugin.settings.defaultCurrency = currencyCode;
                await this.plugin.saveSettings();
            }
        );

        // Add note about currency changes
        const currencyNote = containerEl.createDiv('setting-item-description');
        currencyNote.innerHTML = '<span class="expensica-note">💡 After changing the currency, close and reopen the Expensica dashboard to reflect the changes.</span>';

        // Expense Categories section
        containerEl.createEl('h3', {text: 'Expense Categories'});

        // Display existing expense categories
        const expenseCategoriesContainer = containerEl.createDiv('categories-container expense-categories');

        this.renderCategoriesList(expenseCategoriesContainer, CategoryType.EXPENSE);

        // Add new expense category with button
        const newExpenseCategorySetting = new Setting(containerEl)
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
        containerEl.createEl('h3', {text: 'Income Categories'});

        // Display existing income categories
        const incomeCategoriesContainer = containerEl.createDiv('categories-container income-categories');

        this.renderCategoriesList(incomeCategoriesContainer, CategoryType.INCOME);

        // Add new income category with button
        const newIncomeCategorySetting = new Setting(containerEl)
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
        containerEl.createEl('h3', {text: 'Data Management'});

        // Export data with advanced options
        new Setting(containerEl)
            .setName('Export data')
            .setDesc('Export your transactions with advanced filtering options')
            .addButton(button => button
                .setButtonText('Export Transactions')
                .onClick(() => {
                    this.plugin.openExportModal();
                }));

        // Import data
        new Setting(containerEl)
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
        
        for (const category of categories) {
            const categoryDiv = container.createDiv('category-item');
            categoryDiv.createSpan({text: `${category.emoji} ${category.name}`});
            
            const actionsDiv = categoryDiv.createDiv('category-actions');
            
            // Add edit emoji button
            const editEmojiButton = actionsDiv.createEl('button', {
                text: 'Edit Emoji',
                cls: 'category-edit-btn'
            });
            
            const deleteButton = actionsDiv.createEl('button', {
                text: 'Delete',
                cls: 'category-delete-btn'
            });
            
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
            : ['💰', '💵', '💳', '💻', '🏢', '📈', '🏘️', '🎀', '📋', '💸'];
        
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