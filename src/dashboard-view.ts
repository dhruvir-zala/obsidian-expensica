import { 
    App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, WorkspaceLeaf, ItemView
} from 'obsidian';
import Chart from 'chart.js/auto';
import { 
    Transaction, Category, TransactionType, CategoryType, Currency, ColorScheme,
    formatCurrency, formatDate, getMonthName, getYear, generateId, TransactionAggregator,
    Budget, BudgetPeriod, calculateBudgetStatus, getCurrencyByCode
} from './models';
import ExpensicaPlugin from '../main';
import { PremiumVisualizations } from './dashboard-integration';
import { ConfirmationModal } from './confirmation-modal';

// Extend the plugin interface to include the new method
declare module '../main' {
    interface ExpensicaPlugin {
        openTransactionsView(): Promise<void>;
        openExportModal(): void;
    }
}

export const EXPENSICA_VIEW_TYPE = 'expensica-dashboard-view';

// Date range options
export enum DateRangeType {
    TODAY = 'today',
    THIS_WEEK = 'this_week',
    THIS_MONTH = 'this_month',
    LAST_MONTH = 'last_month',
    THIS_YEAR = 'this_year',
    CUSTOM = 'custom'
}

// Interface for date range
export interface DateRange {
    type: DateRangeType;
    startDate: Date;
    endDate: Date;
    label: string;
}

// Dashboard tab options
export enum DashboardTab {
    OVERVIEW = 'overview',
    BUDGET = 'budget'
}

export class ExpensicaDashboardView extends ItemView {
    plugin: ExpensicaPlugin;
    transactions: Transaction[] = [];
    filteredTransactions: Transaction[] = [];
    currentDate: Date = new Date();
    expensesChart: Chart | null = null;
    incomeExpenseChart: Chart | null = null;
    
    // Track previous month data for trends
    previousMonthTransactions: Transaction[] = [];
    
    // Chart period for expenses (weekly, monthly, yearly)
    expenseChartPeriod: 'category' | 'weekly' | 'monthly' = 'category';
    
    // Premium visualizations
    premiumVisualizations: PremiumVisualizations | null = null;
    
    // New: Date range properties
    dateRange: DateRange;
    customStartDate: Date | null = null;
    customEndDate: Date | null = null;

    // Current tab
    currentTab: DashboardTab = DashboardTab.OVERVIEW;

    constructor(leaf: WorkspaceLeaf, plugin: ExpensicaPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with "This Month" as default date range
        this.dateRange = this.getDateRange(DateRangeType.THIS_MONTH);
    }

    getViewType(): string {
        return EXPENSICA_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Expensica Dashboard';
    }

    getIcon(): string {
        return 'dollar-sign';
    }

    async onOpen() {
        // Load transactions for the current month and previous month
        await this.loadTransactionsData();

        // Render the dashboard
        this.renderDashboard();

        // Add resize event listener
        window.addEventListener('resize', this.handleResize.bind(this));
    }

    async onClose() {
        // Cleanup charts
        if (this.expensesChart) {
            this.expensesChart.destroy();
            this.expensesChart = null;
        }
        if (this.incomeExpenseChart) {
            this.incomeExpenseChart.destroy();
            this.incomeExpenseChart = null;
        }

        // Premium visualizations will be garbage collected
        this.premiumVisualizations = null;

        // Remove resize event listener
        window.removeEventListener('resize', this.handleResize.bind(this));
    }

    // Handler for window resize events
    private handleResize() {
        // Update premium visualizations
        if (this.premiumVisualizations) {
            this.premiumVisualizations.resize();
        }

        // Update other charts if needed
        if (this.expensesChart) {
            this.expensesChart.resize();
        }
        if (this.incomeExpenseChart) {
            this.incomeExpenseChart.resize();
        }
    }

    // Helper method to get a date range based on type
    getDateRange(type: DateRangeType, startDate?: Date, endDate?: Date): DateRange {
        const now = new Date();
        let start: Date;
        let end: Date;
        let label: string;

        switch (type) {
            case DateRangeType.TODAY:
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
                label = 'Today';
                break;
                
            case DateRangeType.THIS_WEEK:
                // Get the first day of the week (Sunday)
                const dayOfWeek = now.getDay();
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek), 23, 59, 59, 999);
                label = 'This Week';
                break;
                
            case DateRangeType.THIS_MONTH:
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                label = 'This Month';
                break;
                
            case DateRangeType.LAST_MONTH:
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                label = 'Last Month';
                break;
                
            case DateRangeType.THIS_YEAR:
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
                label = 'This Year';
                break;
                
            case DateRangeType.CUSTOM:
                if (startDate && endDate) {
                    start = startDate;
                    // Set end date to end of day
                    end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    
                    // Format dates for the label
                    const formatOptions: Intl.DateTimeFormatOptions = { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                    };
                    const startStr = start.toLocaleDateString(undefined, formatOptions);
                    const endStr = end.toLocaleDateString(undefined, formatOptions);
                    label = `${startStr} - ${endStr}`;
                } else {
                    // Fallback to this month if custom dates are not provided
                    start = new Date(now.getFullYear(), now.getMonth(), 1);
                    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                    label = 'Custom Range';
                }
                break;
        }

        return {
            type,
            startDate: start,
            endDate: end,
            label
        };
    }

    async loadTransactionsData() {
        // Load transactions for current date range
        this.loadTransactionsForDateRange();

        // Previous month transactions (for trend analysis)
        const prevDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1);
        this.previousMonthTransactions = this.plugin.getTransactionsForMonth(
            prevDate.getFullYear(),
            prevDate.getMonth()
        );
    }

    loadTransactionsForDateRange() {
        // Get all transactions
        const allTransactions = this.plugin.getAllTransactions();
        
        // Filter transactions based on the date range
        this.transactions = allTransactions.filter(transaction => {
            const transactionDate = new Date(transaction.date);
            return transactionDate >= this.dateRange.startDate && 
                   transactionDate <= this.dateRange.endDate;
        });
        
        this.filteredTransactions = [...this.transactions];
        
        // If this is this month, also update the currentDate for calendar view
        if (this.dateRange.type === DateRangeType.THIS_MONTH) {
            this.currentDate = new Date();
        }
    }

    async addTransaction(transaction: Transaction) {
        await this.plugin.addTransaction(transaction);
        await this.loadTransactionsData();
        this.renderDashboard();
        new Notice('Transaction added successfully');
    }

    async updateTransaction(transaction: Transaction) {
        await this.plugin.updateTransaction(transaction);
        await this.loadTransactionsData();
        this.renderDashboard();
        new Notice('Transaction updated successfully');
    }

    async deleteTransaction(id: string) {
        const transaction = this.transactions.find(t => t.id === id);
        if (!transaction) return;

        new ConfirmationModal(
            this.app,
            'Delete Transaction?',
            `Are you sure you want to delete this ${transaction.type.toLowerCase()} transaction? This action cannot be undone.`,
            async (confirmed) => {
                if (confirmed) {
                    await this.plugin.deleteTransaction(id);
                    await this.loadTransactionsData();
                    this.renderDashboard();
                    new Notice('Transaction deleted successfully');
                }
            }
        ).open();
    }

    renderDashboard() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('expensica-dashboard');

        // If budgeting is disabled and current tab is budget, switch to overview
        if (!this.plugin.settings.enableBudgeting && this.currentTab === DashboardTab.BUDGET) {
            this.currentTab = DashboardTab.OVERVIEW;
        }

        // Header
        this.renderHeader(container);

        // Tab navigation
        this.renderTabNavigation(container);

        // Render the current tab
        switch (this.currentTab) {
            case DashboardTab.OVERVIEW:
                this.renderOverviewTab(container);
                break;
            case DashboardTab.BUDGET:
                this.renderBudgetTab(container);
                break;
        }
    }

    // Render the tab navigation
    renderTabNavigation(container: HTMLElement) {
        const tabsContainer = container.createDiv('expensica-tabs');
        
        // Overview tab
        const overviewTab = tabsContainer.createEl('button', {
            text: 'Overview',
            cls: `expensica-tab ${this.currentTab === DashboardTab.OVERVIEW ? 'active' : ''}`
        });
        
        // Budget tab - only show if budgeting is enabled
        if (this.plugin.settings.enableBudgeting) {
            const budgetTab = tabsContainer.createEl('button', {
                text: 'Budget',
                cls: `expensica-tab ${this.currentTab === DashboardTab.BUDGET ? 'active' : ''}`
            });
            
            // Add event listener
            budgetTab.addEventListener('click', () => {
                this.currentTab = DashboardTab.BUDGET;
                this.renderDashboard();
            });
        }
        
        // Add event listeners
        overviewTab.addEventListener('click', () => {
            this.currentTab = DashboardTab.OVERVIEW;
            this.renderDashboard();
        });
    }

    // Render the overview tab (original dashboard content)
    renderOverviewTab(container: HTMLElement) {
        // Summary cards
        this.renderSummary(container);

        // Premium visualizations section
        this.renderPremiumVisualizations(container);

        // Charts in a grid
        const dashboardGrid = container.createDiv('expensica-dashboard-grid');

        // Expenses by category chart container
        const expensesChartContainer = dashboardGrid.createDiv('expensica-chart-container expensica-animate expensica-animate-delay-1');
        this.renderExpensesChart(expensesChartContainer);

        // Income vs Expenses chart container
        const incomeExpenseChartContainer = dashboardGrid.createDiv('expensica-chart-container expensica-animate expensica-animate-delay-2');
        this.renderIncomeExpenseChart(incomeExpenseChartContainer);

        // Recent transactions
        this.renderTransactions(container);
    }

    // New method to render the budget tab
    renderBudgetTab(container: HTMLElement) {
        const budgetContainer = container.createDiv('expensica-budget-container');
        
        // Budget summary section
        const budgetSummary = budgetContainer.createDiv('expensica-budget-summary');
        this.renderBudgetSummary(budgetSummary);
        
        // Budget list section
        const budgetList = budgetContainer.createDiv('expensica-budget-list');
        this.renderBudgetList(budgetList);
        
        // Add budget button
        const addBudgetContainer = budgetContainer.createDiv('expensica-add-budget-container');
        const addBudgetBtn = addBudgetContainer.createEl('button', {
            cls: 'expensica-btn expensica-btn-primary',
        });
        addBudgetBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Budget';
        
        // Add event listener to open the budget modal
        addBudgetBtn.addEventListener('click', () => {
            const modal = new BudgetModal(this.app, this.plugin, this);
            modal.open();
        });
    }

    // Render budget summary cards
    renderBudgetSummary(container: HTMLElement) {
        const budgets = this.plugin.getAllBudgets();
        
        // If no budgets, show a message
        if (budgets.length === 0) {
            const emptyState = container.createDiv('expensica-empty-state');
            emptyState.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                <h3>No budgets yet</h3>
                <p>Create your first budget to start tracking spending against your targets.</p>
            `;
            return;
        }
        
        // Create summary cards
        const totalBudgeted = budgets.reduce((sum, budget) => sum + budget.amount, 0);
        const totalSpent = budgets.reduce((sum, budget) => {
            const status = calculateBudgetStatus(budget, this.transactions);
            return sum + status.spent;
        }, 0);
        
        const remainingAmount = Math.max(0, totalBudgeted - totalSpent);
        const spentPercentage = totalBudgeted > 0 ? Math.min(100, (totalSpent / totalBudgeted) * 100) : 0;
        
        // Create summary flex container
        const summaryFlex = container.createDiv('expensica-summary-flex');
        
        // Total budgeted card
        const budgetedCard = summaryFlex.createDiv('expensica-summary-card');
        budgetedCard.innerHTML = `
            <div class="expensica-summary-icon expensica-summary-icon-blue">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div class="expensica-summary-content">
                <h3>Total Budgeted</h3>
                <p>${formatCurrency(totalBudgeted, this.plugin.settings.defaultCurrency)}</p>
            </div>
        `;
        
        // Total spent card
        const spentCard = summaryFlex.createDiv('expensica-summary-card');
        spentCard.innerHTML = `
            <div class="expensica-summary-icon expensica-summary-icon-red">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                    <polyline points="17 6 23 6 23 12"></polyline>
                </svg>
            </div>
            <div class="expensica-summary-content">
                <h3>Total Spent</h3>
                <p>${formatCurrency(totalSpent, this.plugin.settings.defaultCurrency)}</p>
            </div>
        `;
        
        // Remaining card
        const remainingCard = summaryFlex.createDiv('expensica-summary-card');
        remainingCard.innerHTML = `
            <div class="expensica-summary-icon expensica-summary-icon-green">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="20" x2="12" y2="10"></line>
                    <line x1="18" y1="20" x2="18" y2="4"></line>
                    <line x1="6" y1="20" x2="6" y2="16"></line>
                </svg>
            </div>
            <div class="expensica-summary-content">
                <h3>Remaining</h3>
                <p>${formatCurrency(remainingAmount, this.plugin.settings.defaultCurrency)}</p>
            </div>
        `;
        
        // Overall budget progress
        const progressContainer = container.createDiv('expensica-budget-progress-container');
        progressContainer.innerHTML = `
            <h3>Overall Budget Progress</h3>
            <div class="expensica-budget-progress">
                <div class="expensica-budget-bar">
                    <div class="expensica-budget-fill" style="width: ${spentPercentage}%;"></div>
                </div>
                <div class="expensica-budget-labels">
                    <span>${formatCurrency(totalSpent, this.plugin.settings.defaultCurrency)}</span>
                    <span>${formatCurrency(totalBudgeted, this.plugin.settings.defaultCurrency)}</span>
                </div>
                <div class="expensica-budget-percentage">${Math.round(spentPercentage)}%</div>
            </div>
        `;
    }

    // Render budget list
    renderBudgetList(container: HTMLElement) {
        const budgets = this.plugin.getAllBudgets();
        
        // If no budgets, return early
        if (budgets.length === 0) {
            return;
        }
        
        // Create the list container
        const listContainer = container.createDiv('expensica-budget-items');
        
        // Create header
        const header = listContainer.createDiv('expensica-budget-header');
        header.innerHTML = `
            <div class="expensica-budget-col-category">Category</div>
            <div class="expensica-budget-col-amount">Budget</div>
            <div class="expensica-budget-col-spent">Spent</div>
            <div class="expensica-budget-col-remaining">Remaining</div>
            <div class="expensica-budget-col-progress">Progress</div>
            <div class="expensica-budget-col-actions">Actions</div>
        `;
        
        // Create a budget item for each budget
        budgets.forEach(budget => {
            const category = this.plugin.getCategoryById(budget.categoryId);
            if (!category) return; // Skip if category doesn't exist
            
            // Calculate budget status
            const status = calculateBudgetStatus(budget, this.transactions);
            
            // Determine the status color
            let statusClass = 'expensica-status-good';
            if (status.percentage >= 90) {
                statusClass = 'expensica-status-danger';
            } else if (status.percentage >= 75) {
                statusClass = 'expensica-status-warning';
            }
            
            // Create the budget item
            const budgetItem = listContainer.createDiv(`expensica-budget-item ${statusClass}`);
            
            // Category info
            const categoryCol = budgetItem.createDiv('expensica-budget-col-category');
            categoryCol.innerHTML = `
                <span class="expensica-category-emoji">${category.emoji}</span>
                <span class="expensica-category-name">${category.name}</span>
                <span class="expensica-budget-period">${budget.period}</span>
            `;
            
            // Budget amount
            const amountCol = budgetItem.createDiv('expensica-budget-col-amount');
            amountCol.textContent = formatCurrency(budget.amount, this.plugin.settings.defaultCurrency);
            
            // Spent amount
            const spentCol = budgetItem.createDiv('expensica-budget-col-spent');
            spentCol.textContent = formatCurrency(status.spent, this.plugin.settings.defaultCurrency);
            
            // Remaining amount
            const remainingCol = budgetItem.createDiv('expensica-budget-col-remaining');
            remainingCol.textContent = formatCurrency(status.remaining, this.plugin.settings.defaultCurrency);
            
            // Progress bar
            const progressCol = budgetItem.createDiv('expensica-budget-col-progress');
            const progressBar = progressCol.createDiv('expensica-budget-progress');
            progressBar.innerHTML = `
                <div class="expensica-budget-bar">
                    <div class="expensica-budget-fill" style="width: ${status.percentage}%;"></div>
                </div>
                <div class="expensica-budget-percentage">${Math.round(status.percentage)}%</div>
            `;
            
            // Actions
            const actionsCol = budgetItem.createDiv('expensica-budget-col-actions');
            
            // Edit button
            const editBtn = actionsCol.createEl('button', {
                cls: 'expensica-budget-action expensica-budget-edit',
            });
            editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
            
            // Delete button
            const deleteBtn = actionsCol.createEl('button', {
                cls: 'expensica-budget-action expensica-budget-delete',
            });
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            
            // Add event listeners
            editBtn.addEventListener('click', () => {
                const modal = new BudgetModal(this.app, this.plugin, this, budget);
                modal.open();
            });
            
            deleteBtn.addEventListener('click', () => {
                const modal = new ConfirmationModal(
                    this.app,
                    'Delete Budget',
                    `Are you sure you want to delete the budget for ${category.name}?`,
                    async (confirmed) => {
                        if (confirmed) {
                            await this.plugin.deleteBudget(budget.id);
                            this.renderDashboard();
                        }
                    }
                );
                modal.open();
            });
        });
    }

    renderHeader(container: HTMLElement) {
        const headerEl = container.createDiv('expensica-header');
        headerEl.createEl('h1', { text: 'Expensica Dashboard', cls: 'expensica-title' });

        const actionsEl = headerEl.createDiv('expensica-actions');

        // Add date range selector
        this.renderDateRangeSelector(actionsEl);

        // Add expense button
        const addExpenseBtn = actionsEl.createEl('button', {
            cls: 'expensica-btn expensica-btn-danger',
        });
        addExpenseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Expense';

        // Add income button
        const addIncomeBtn = actionsEl.createEl('button', {
            cls: 'expensica-btn expensica-btn-success',
        });
        addIncomeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Income';

        // Add export button
        const exportBtn = actionsEl.createEl('button', {
            cls: 'expensica-btn expensica-btn-primary',
        });
        exportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export';

        // Event listeners
        addExpenseBtn.addEventListener('click', () => {
            const modal = new ExpenseModal(this.app, this.plugin, this);
            modal.open();
        });

        addIncomeBtn.addEventListener('click', () => {
            const modal = new IncomeModal(this.app, this.plugin, this);
            modal.open();
        });

        exportBtn.addEventListener('click', () => {
            this.plugin.openExportModal();
        });
    }

    // New method to render the date range selector
    private renderDateRangeSelector(container: HTMLElement) {
        const dateRangeContainer = container.createDiv('expensica-date-range-container');

        // Create the date range selector dropdown
        const dateRangeSelector = dateRangeContainer.createDiv('expensica-date-range-selector');
        
        // Current selection display
        const currentSelection = dateRangeSelector.createDiv('expensica-date-range-current');
        currentSelection.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
        
        const dateRangeText = currentSelection.createSpan({ 
            text: this.dateRange.label,
            cls: 'expensica-date-range-text'
        });
        
        const dropdownIcon = currentSelection.createSpan({ cls: 'expensica-date-range-icon' });
        dropdownIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

        // Dropdown options container
        const optionsContainer = dateRangeSelector.createDiv('expensica-date-range-options');
        optionsContainer.addClass('expensica-date-range-hidden');

        // Add dropdown options
        const options: { type: DateRangeType, label: string }[] = [
            { type: DateRangeType.TODAY, label: 'Today' },
            { type: DateRangeType.THIS_WEEK, label: 'This Week' },
            { type: DateRangeType.THIS_MONTH, label: 'This Month' },
            { type: DateRangeType.LAST_MONTH, label: 'Last Month' },
            { type: DateRangeType.THIS_YEAR, label: 'This Year' },
            { type: DateRangeType.CUSTOM, label: 'Custom Range' }
        ];

        options.forEach(option => {
            const optionItem = optionsContainer.createDiv('expensica-date-range-option');
            optionItem.textContent = option.label;
            
            // Highlight the active option
            if (this.dateRange.type === option.type) {
                optionItem.addClass('expensica-date-range-option-active');
            }
            
            // Handle option selection
            optionItem.addEventListener('click', async () => {
                if (option.type === DateRangeType.CUSTOM) {
                    // Show custom date picker modal
                    const modal = new DateRangePickerModal(this.app, this.customStartDate || new Date(), this.customEndDate || new Date(), async (startDate, endDate) => {
                        if (startDate && endDate) {
                            this.customStartDate = startDate;
                            this.customEndDate = endDate;
                            this.dateRange = this.getDateRange(DateRangeType.CUSTOM, startDate, endDate);
                            
                            // Update dateRangeText
                            dateRangeText.textContent = this.dateRange.label;
                            
                            // Reset the calendar view date if needed
                            if (this.dateRange.type === DateRangeType.THIS_MONTH) {
                                this.currentDate = new Date(this.dateRange.startDate);
                            }
                            
                            // Reload transactions and update dashboard
                            await this.loadTransactionsData();
                            this.renderDashboard();
                        }
                    });
                    modal.open();
                } else {
                    // Set the new date range
                    this.dateRange = this.getDateRange(option.type);
                    
                    // Update dateRangeText
                    dateRangeText.textContent = this.dateRange.label;
                    
                    // Reset the calendar view date if needed
                    if (option.type === DateRangeType.THIS_MONTH) {
                        this.currentDate = new Date(this.dateRange.startDate);
                    }
                    
                    // Reload transactions and update dashboard
                    await this.loadTransactionsData();
                    this.renderDashboard();
                }
                
                // Hide the dropdown
                optionsContainer.addClass('expensica-date-range-hidden');
            });
        });

// Toggle dropdown on click
currentSelection.addEventListener('click', () => {
    const isHidden = optionsContainer.hasClass('expensica-date-range-hidden');
    optionsContainer.toggleClass('expensica-date-range-hidden', !isHidden);
});

        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (!dateRangeSelector.contains(target)) {
                optionsContainer.addClass('expensica-date-range-hidden');
            }
        });
    }

    renderSummary(container: HTMLElement) {
        const summaryEl = container.createDiv('expensica-summary');

        // Get data for current and previous month
        const totalIncome = TransactionAggregator.getTotalIncome(this.transactions);
        const totalExpenses = TransactionAggregator.getTotalExpenses(this.transactions);
        const balance = totalIncome - totalExpenses;

        const prevTotalIncome = TransactionAggregator.getTotalIncome(this.previousMonthTransactions);
        const prevTotalExpenses = TransactionAggregator.getTotalExpenses(this.previousMonthTransactions);
        const prevBalance = prevTotalIncome - prevTotalExpenses;

        // Calculate trends (percentage change from previous month)
        const incomeTrend = prevTotalIncome === 0 ? 100 : ((totalIncome - prevTotalIncome) / prevTotalIncome) * 100;
        const expenseTrend = prevTotalExpenses === 0 ? 100 : ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100;
        const balanceTrend = prevBalance === 0 ? 100 : ((balance - prevBalance) / Math.abs(prevBalance)) * 100;

        // Income card
        const incomeCard = summaryEl.createDiv('expensica-card expensica-animate');
        const incomeCardTitle = incomeCard.createEl('h3', { cls: 'expensica-card-title' });
        incomeCardTitle.innerHTML = '<span class="emoji">💰</span> Income';
        incomeCard.createEl('p', {
            text: formatCurrency(totalIncome, this.plugin.settings.defaultCurrency),
            cls: 'expensica-card-value expensica-income'
        });

        if (prevTotalIncome > 0 && this.dateRange.type === DateRangeType.THIS_MONTH) {
            const trendCls = incomeTrend >= 0 ? 'expensica-trend-up' : 'expensica-trend-down';
            const trendEl = incomeCard.createEl('div', { cls: `expensica-card-trend ${trendCls}` });
            if (incomeTrend >= 0) {
                trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg> ${Math.abs(incomeTrend).toFixed(1)}% from last month`;
            } else {
                trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg> ${Math.abs(incomeTrend).toFixed(1)}% from last month`;
            }
        }

        incomeCard.createEl('div', { text: '💰', cls: 'expensica-card-bg-icon' });

        // Expenses card
        const expensesCard = summaryEl.createDiv('expensica-card expensica-animate expensica-animate-delay-1');
        const expensesCardTitle = expensesCard.createEl('h3', { cls: 'expensica-card-title' });
        expensesCardTitle.innerHTML = '<span class="emoji">💸</span> Expenses';
        expensesCard.createEl('p', {
            text: formatCurrency(totalExpenses, this.plugin.settings.defaultCurrency),
            cls: 'expensica-card-value expensica-expense'
        });

        if (prevTotalExpenses > 0 && this.dateRange.type === DateRangeType.THIS_MONTH) {
            // For expenses, trend up (more expenses) is bad, trend down is good
            const trendCls = expenseTrend >= 0 ? 'expensica-trend-down' : 'expensica-trend-up';
            const trendEl = expensesCard.createEl('div', { cls: `expensica-card-trend ${trendCls}` });
            if (expenseTrend >= 0) {
                trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg> ${Math.abs(expenseTrend).toFixed(1)}% from last month`;
            } else {
                trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg> ${Math.abs(expenseTrend).toFixed(1)}% from last month`;
            }
        }

        expensesCard.createEl('div', { text: '💸', cls: 'expensica-card-bg-icon' });

        // Balance card
        const balanceCard = summaryEl.createDiv('expensica-card expensica-animate expensica-animate-delay-2');
        const balanceCardTitle = balanceCard.createEl('h3', { cls: 'expensica-card-title' });
        balanceCardTitle.innerHTML = '<span class="emoji">💵</span> Balance';
        balanceCard.createEl('p', {
            text: formatCurrency(balance, this.plugin.settings.defaultCurrency),
            cls: 'expensica-card-value expensica-balance'
        });

        if (prevBalance !== 0 && this.dateRange.type === DateRangeType.THIS_MONTH) {
            const trendCls = balanceTrend >= 0 ? 'expensica-trend-up' : 'expensica-trend-down';
            const trendEl = balanceCard.createEl('div', { cls: `expensica-card-trend ${trendCls}` });
            if (balanceTrend >= 0) {
                trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg> ${Math.abs(balanceTrend).toFixed(1)}% from last month`;
            } else {
                trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg> ${Math.abs(balanceTrend).toFixed(1)}% from last month`;
            }
        }

        balanceCard.createEl('div', { text: '💵', cls: 'expensica-card-bg-icon' });
    }

    renderExpensesChart(container: HTMLElement) {
        // Header with title and view options
        const chartHeader = container.createDiv('expensica-chart-header');
        const chartTitle = chartHeader.createEl('h3', { cls: 'expensica-chart-title' });
        chartTitle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="expensica-chart-icon"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg> Expenses by Category';

        // View options
        const chartOptions = chartHeader.createDiv('expensica-chart-options');
        const categoryBtn = chartOptions.createEl('button', {
            text: 'By Category',
            cls: `expensica-chart-option ${this.expenseChartPeriod === 'category' ? 'active' : ''}`
        });
        const weeklyBtn = chartOptions.createEl('button', {
            text: 'Weekly',
            cls: `expensica-chart-option ${this.expenseChartPeriod === 'weekly' ? 'active' : ''}`
        });
        const monthlyBtn = chartOptions.createEl('button', {
            text: 'Monthly',
            cls: `expensica-chart-option ${this.expenseChartPeriod === 'monthly' ? 'active' : ''}`
        });

        // Attach events to buttons
        categoryBtn.addEventListener('click', () => {
            this.expenseChartPeriod = 'category';
            this.renderDashboard();
        });
        weeklyBtn.addEventListener('click', () => {
            this.expenseChartPeriod = 'weekly';
            this.renderDashboard();
        });
        monthlyBtn.addEventListener('click', () => {
            this.expenseChartPeriod = 'monthly';
            this.renderDashboard();
        });

        // Canvas container
        const canvasContainer = container.createDiv('expensica-canvas-container');

        // If there are no expenses, show an empty state
        if (this.transactions.filter(t => t.type === TransactionType.EXPENSE).length === 0) {
            canvasContainer.empty();
            const emptyState = canvasContainer.createDiv('expensica-empty-charts');
            emptyState.createEl('div', { text: '📊', cls: 'expensica-empty-icon' });
            emptyState.createEl('p', {
                text: 'No expenses found for this period. Add some expenses to see your spending patterns.',
                cls: 'expensica-empty-state-message'
            });
            return;
        }

        const canvas = canvasContainer.createEl('canvas', { attr: { id: 'expenses-chart' }});

        // Create chart based on selected period
        setTimeout(() => {
            if (this.expenseChartPeriod === 'category') {
                this.createCategoryExpensesChart(canvas);
            } else if (this.expenseChartPeriod === 'weekly') {
                this.createWeeklyExpensesChart(canvas);
            } else {
                this.createMonthlyExpensesChart(canvas);
            }
        }, 50);
    }

    createCategoryExpensesChart(canvas: HTMLCanvasElement) {
        // Cleanup previous chart
        if (this.expensesChart) {
            this.expensesChart.destroy();
        }

        // Get expenses by category
        const expensesByCategory = TransactionAggregator.getExpensesByCategory(this.transactions, this.plugin.settings.categories);

        // Prepare data for chart
        const categories = Object.keys(expensesByCategory);
        const amounts = categories.map(category => expensesByCategory[category]);

        // If there are no expenses, return
        if (categories.length === 0) {
            return;
        }

        // Generate colors for each category
        const colors = this.generateColors(categories.length);

        // Create the chart
        this.expensesChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: categories,
                datasets: [{
                    data: amounts,
                    backgroundColor: colors,
                    borderColor: colors.map(color => this.adjustColor(color, -20)),
                    borderWidth: 1,
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: this.getTextColor(),
                            font: {
                                size: 12
                            },
                            padding: 15,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.raw as number;
                                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0) as number;
                                const percentage = Math.round((value / total) * 100);
                                return `${label}: ${formatCurrency(value, this.plugin.settings.defaultCurrency)} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    createWeeklyExpensesChart(canvas: HTMLCanvasElement) {
        // Cleanup previous chart
        if (this.expensesChart) {
            this.expensesChart.destroy();
        }

        // Group expenses by week
        const expensesByWeek: { [weekLabel: string]: number } = {};
        
        // Get start and end dates of the date range
        const startDate = new Date(this.dateRange.startDate);
        const endDate = new Date(this.dateRange.endDate);
        
        // Calculate week labels using the ISO week numbering
        const weekLabels: string[] = [];
        const currentDay = new Date(startDate);
        
        // Function to get the week number
        const getWeekNumber = (date: Date): number => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 4 - (d.getDay() || 7));
            const yearStart = new Date(d.getFullYear(), 0, 1);
            return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
        };
        
        // Create week labels and initialize the data structure
        while (currentDay <= endDate) {
            const year = currentDay.getFullYear();
            const weekNumber = getWeekNumber(currentDay);
            const weekLabel = `Week ${weekNumber}`;
            
            if (!weekLabels.includes(weekLabel)) {
                weekLabels.push(weekLabel);
                expensesByWeek[weekLabel] = 0;
            }
            
            // Move to the next day
            currentDay.setDate(currentDay.getDate() + 1);
        }

        // Assign transactions to weeks
        this.transactions
            .filter(t => t.type === TransactionType.EXPENSE)
            .forEach(transaction => {
                const date = new Date(transaction.date);
                const weekNumber = getWeekNumber(date);
                const weekLabel = `Week ${weekNumber}`;
                
                if (expensesByWeek[weekLabel] !== undefined) {
                    expensesByWeek[weekLabel] += transaction.amount;
                }
            });

        // Prepare data for chart
        const weeks = Object.keys(expensesByWeek).sort((a, b) => {
            // Sort by week number
            const weekA = parseInt(a.replace('Week ', ''));
            const weekB = parseInt(b.replace('Week ', ''));
            return weekA - weekB;
        });
        
        const amounts = weeks.map(week => expensesByWeek[week]);

        // Create the chart
        this.expensesChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: weeks,
                datasets: [{
                    label: 'Expenses',
                    data: amounts,
                    backgroundColor: 'rgba(244, 67, 54, 0.7)',
                    borderColor: 'rgba(244, 67, 54, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                    hoverBackgroundColor: 'rgba(244, 67, 54, 0.9)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: this.getTextColor(),
                            callback: (value) => {
                                return formatCurrency(value as number, this.plugin.settings.defaultCurrency);
                            }
                        },
                        grid: {
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        ticks: {
                            color: this.getTextColor()
                        },
                        grid: {
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.raw as number;
                                return `Expenses: ${formatCurrency(value, this.plugin.settings.defaultCurrency)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    createMonthlyExpensesChart(canvas: HTMLCanvasElement) {
        // Cleanup previous chart
        if (this.expensesChart) {
            this.expensesChart.destroy();
        }

        // Get the expenses for the current and previous 5 months
        const monthsData: { label: string, expenses: number }[] = [];

        // Current month
        const currentMonth = this.currentDate.getMonth();
        const currentYear = this.currentDate.getFullYear();

        // Add data for previous 5 months and current month
        for (let i = 5; i >= 0; i--) {
            const monthOffset = i;
            const targetDate = new Date(currentYear, currentMonth - monthOffset, 1);
            const monthTransactions = this.plugin.getTransactionsForMonth(
                targetDate.getFullYear(),
                targetDate.getMonth()
            );

            const totalExpenses = TransactionAggregator.getTotalExpenses(monthTransactions);
            const monthName = targetDate.toLocaleString('default', { month: 'short' });

            monthsData.push({
                label: monthName,
                expenses: totalExpenses
            });
        }

        // Prepare data for chart
        const months = monthsData.map(m => m.label);
        const expenses = monthsData.map(m => m.expenses);

        // Create the chart
        this.expensesChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Monthly Expenses',
                    data: expenses,
                    borderColor: 'rgba(244, 67, 54, 1)',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: 'rgba(244, 67, 54, 1)',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: this.getTextColor(),
                            callback: (value) => {
                                return formatCurrency(value as number, this.plugin.settings.defaultCurrency);
                            }
                        },
                        grid: {
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        ticks: {
                            color: this.getTextColor()
                        },
                        grid: {
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.raw as number;
                                return `Expenses: ${formatCurrency(value, this.plugin.settings.defaultCurrency)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderIncomeExpenseChart(container: HTMLElement) {
        // Header with title
        const chartHeader = container.createDiv('expensica-chart-header');
        const chartTitle = chartHeader.createEl('h3', { cls: 'expensica-chart-title' });
        chartTitle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="expensica-chart-icon"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg> Income vs Expenses';

        // Canvas container
        const canvasContainer = container.createDiv('expensica-canvas-container');

        // If there are no transactions, show an empty state
        if (this.transactions.length === 0) {
            canvasContainer.empty();
            const emptyState = canvasContainer.createDiv('expensica-empty-charts');
            emptyState.createEl('div', { text: '📈', cls: 'expensica-empty-icon' });
            emptyState.createEl('p', {
                text: 'No transactions found for this period. Add income and expenses to see your financial flow.',
                cls: 'expensica-empty-state-message'
            });
            return;
        }

        const canvas = canvasContainer.createEl('canvas', { attr: { id: 'income-expense-chart' }});

        // Create chart
        setTimeout(() => {
            this.createIncomeExpenseChart(canvas);
        }, 50);
    }

    createIncomeExpenseChart(canvas: HTMLCanvasElement) {
        // Cleanup previous chart
        if (this.incomeExpenseChart) {
            this.incomeExpenseChart.destroy();
        }

        // Get transactions by date
        const transactionsByDate = TransactionAggregator.getTransactionsByDate(this.transactions);

        // Sort dates
        const dates = Object.keys(transactionsByDate).sort();

        // If there are no transactions, return
        if (dates.length === 0) {
            return;
        }

        // Prepare data for chart
        const incomeData = dates.map(date => {
            return transactionsByDate[date]
                .filter(t => t.type === TransactionType.INCOME)
                .reduce((sum, t) => sum + t.amount, 0);
        });

        const expenseData = dates.map(date => {
            return transactionsByDate[date]
                .filter(t => t.type === TransactionType.EXPENSE)
                .reduce((sum, t) => sum + t.amount, 0);
        });

        // Format dates for display
        const formattedDates = dates.map(date => {
            const parts = date.split('-');
            return `${parts[2]}/${parts[1]}`; // DD/MM format
        });

        // Create the chart
        this.incomeExpenseChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: formattedDates,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#4caf50',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Expenses',
                        data: expenseData,
                        borderColor: '#f44336',
                        backgroundColor: 'rgba(244, 67, 54, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#f44336',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: this.getTextColor(),
                            callback: (value) => {
                                return formatCurrency(value as number, this.plugin.settings.defaultCurrency);
                            }
                        },
                        grid: {
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        ticks: {
                            color: this.getTextColor()
                        },
                        grid: {
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: this.getTextColor(),
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.dataset.label || '';
                                const value = context.raw as number;
                                return `${label}: ${formatCurrency(value, this.plugin.settings.defaultCurrency)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderTransactions(container: HTMLElement) {
        const transactionsSection = container.createDiv('expensica-section expensica-animate expensica-animate-delay-3');

        // Section header
        const sectionHeader = transactionsSection.createDiv('expensica-section-header');
        const sectionTitle = sectionHeader.createEl('h2', { cls: 'expensica-section-title expensica-transactions-title' });
        sectionTitle.textContent = 'Recent Transactions';
        
        // Add "View All" button
        const viewAllBtn = sectionHeader.createEl('button', { 
            cls: 'expensica-view-all-btn',
            attr: { 'aria-label': 'View all transactions' }
        });
        viewAllBtn.innerHTML = 'View All <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        viewAllBtn.addEventListener('click', () => {
            this.plugin.openTransactionsView();
        });

        // Transactions container
        const transactionsContainer = transactionsSection.createDiv('expensica-transactions');

        // Sort transactions by date (most recent first)
        const sortedTransactions = [...this.transactions].sort((a, b) => {
            return new Date(b.date).getTime() - new Date(a.date).getTime();
        });

        // Limit to 10 most recent transactions
        const recentTransactions = sortedTransactions.slice(0, 10);

        if (recentTransactions.length === 0) {
            const emptyState = transactionsContainer.createDiv('expensica-empty-state');
            emptyState.createEl('div', { text: '📝', cls: 'expensica-empty-state-icon' });
            emptyState.createEl('p', {
                text: `No transactions found for ${this.dateRange.label.toLowerCase()}. Add your first transaction using the buttons above!`,
                cls: 'expensica-empty-state-message'
            });
        } else {
            // Render each transaction
            recentTransactions.forEach(transaction => {
                const transactionEl = transactionsContainer.createDiv('expensica-transaction');

                // Get category details
                const category = this.plugin.getCategoryById(transaction.category);

                // Handle unknown category (e.g., if category was deleted)
                const categoryDisplay = category ?
                    { id: category.id, name: category.name, emoji: category.emoji, type: category.type } :
                    {
                        id: 'unknown',
                        name: 'Unknown Category',
                        emoji: transaction.type === TransactionType.INCOME ? '❓' : '❓',
                        type: transaction.type === TransactionType.INCOME ? CategoryType.INCOME : CategoryType.EXPENSE
                    };

                // Icon based on transaction type
                const iconEl = transactionEl.createDiv('expensica-transaction-icon');
                iconEl.innerText = categoryDisplay.emoji;
                if (transaction.type === TransactionType.INCOME) {
                    iconEl.addClass('expensica-income-icon');
                } else {
                    iconEl.addClass('expensica-expense-icon');
                }

                // Transaction details
                const detailsEl = transactionEl.createDiv('expensica-transaction-details');
                detailsEl.createEl('div', { text: transaction.description, cls: 'expensica-transaction-title' });
                const metaEl = detailsEl.createDiv('expensica-transaction-meta');

                // Format date for display
                const date = new Date(transaction.date);
                const formattedDate = date.toLocaleDateString('en-US', {
                    day: 'numeric',
                    month: 'short'
                });

                const dateEl = metaEl.createEl('span', { cls: 'expensica-transaction-date' });
                dateEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${formattedDate}`;

                const categorySpan = metaEl.createEl('span', {
                    text: categoryDisplay.name,
                    cls: `expensica-transaction-category ${!category ? 'category-unknown' : ''}`
                });

                // Add warning if category doesn't exist
                if (!category) {
                    categorySpan.setAttribute('title', 'This category was deleted. Edit the transaction to select a new category.');
                }

                // Transaction amount
                const amountEl = transactionEl.createDiv('expensica-transaction-amount');
                const formattedAmount = formatCurrency(transaction.amount, this.plugin.settings.defaultCurrency);
                if (transaction.type === TransactionType.INCOME) {
                    amountEl.createEl('span', {
                        text: `+${formattedAmount}`,
                        cls: 'expensica-income'
                    });
                } else {
                    amountEl.createEl('span', {
                        text: `-${formattedAmount}`,
                        cls: 'expensica-expense'
                    });
                }

                // Add edit and delete options
                const actionsEl = transactionEl.createDiv('expensica-transaction-actions');
                const editBtn = actionsEl.createEl('button', {
                    cls: 'expensica-action-btn expensica-edit-btn',
                    attr: { 'aria-label': 'Edit transaction' }
                });
                editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';

                const deleteBtn = actionsEl.createEl('button', {
                    cls: 'expensica-action-btn expensica-delete-btn',
                    attr: { 'aria-label': 'Delete transaction' }
                });
                deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

                // Add event listeners
                editBtn.addEventListener('click', () => {
                    if (transaction.type === TransactionType.EXPENSE) {
                        const modal = new ExpenseModal(this.app, this.plugin, this, transaction);
                        modal.open();
                    } else {
                        const modal = new IncomeModal(this.app, this.plugin, this, transaction);
                        modal.open();
                    }
                });

                deleteBtn.addEventListener('click', () => {
                    this.deleteTransaction(transaction.id);
                });
            });
        }
    }

    getTextColor(): string {
        // Get text color based on theme
        const isDarkMode = document.body.classList.contains('theme-dark');
        return isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';
    }

    getGridColor(): string {
        // Get grid color based on theme
        const isDarkMode = document.body.classList.contains('theme-dark');
        return isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    }

    generateColors(count: number): string[] {
        // Generate an array of colors for charts
        const colors = [];
        const hueStep = 360 / count;
        for (let i = 0; i < count; i++) {
            const hue = i * hueStep;
            colors.push(`hsl(${hue}, 70%, 60%)`);
        }
        return colors;
    }

    adjustColor(color: string, amount: number): string {
        // Helper to adjust color lightness
        const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
            const h = parseInt(match[1]);
            const s = parseInt(match[2]);
            const l = Math.max(0, Math.min(100, parseInt(match[3]) + amount));
            return `hsl(${h}, ${s}%, ${l}%)`;
        }
        return color;
    }

    // New method to render premium visualizations
    private renderPremiumVisualizations(container: HTMLElement) {
        // Add section title
        const premiumSection = container.createDiv('expensica-section expensica-animate');
        const sectionHeader = premiumSection.createDiv('expensica-section-header');
        const sectionTitle = sectionHeader.createEl('h2', { cls: 'expensica-section-title expensica-calendar-title' });
        sectionTitle.textContent = 'Spending Heatmap Calendar';

        // Container for premium visualizations
        const vizContainer = premiumSection.createDiv('expensica-premium-visualizations');

        // Initialize or update premium visualizations
        if (!this.premiumVisualizations) {
            this.premiumVisualizations = new PremiumVisualizations(vizContainer, this.plugin, this.currentDate);
            this.premiumVisualizations.render();
        } else {
            this.premiumVisualizations.updateDate(this.currentDate);
            vizContainer.empty();
            this.premiumVisualizations = new PremiumVisualizations(vizContainer, this.plugin, this.currentDate);
            this.premiumVisualizations.render();
        }
    }

    // Show budget tab
    showBudgetTab() {
        // Only switch to budget tab if budgeting is enabled
        if (this.plugin.settings.enableBudgeting) {
            this.currentTab = DashboardTab.BUDGET;
            this.renderDashboard();
        } else {
            // If budgeting is disabled, stay on overview tab
            this.currentTab = DashboardTab.OVERVIEW;
            this.renderDashboard();
            
            // Show a notice that budgeting is disabled
            new Notice('Budgeting is disabled. Enable it in settings to use budget features.');
        }
    }
}

// Date Range Picker Modal
export class DateRangePickerModal extends Modal {
    startDate: Date;
    endDate: Date;
    onConfirm: (startDate: Date, endDate: Date) => void;

    constructor(app: App, startDate: Date, endDate: Date, onConfirm: (startDate: Date, endDate: Date) => void) {
        super(app);
        this.startDate = startDate;
        this.endDate = endDate;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const {contentEl} = this;
        
        contentEl.empty();
        contentEl.addClass('expensica-modal');
        
        // Modal title
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = '<span class="expensica-modal-title-icon">📅</span> Custom Date Range';
        
        // Create form container
        const form = contentEl.createDiv('expensica-form');
        
        // Start date
        const startDateGroup = form.createDiv('expensica-form-group');
        startDateGroup.createEl('label', {
            text: 'Start Date',
            cls: 'expensica-form-label',
            attr: { for: 'start-date' }
        });
        
        const startDateInput = startDateGroup.createEl('input', {
            cls: 'expensica-form-input',
            attr: {
                type: 'date',
                id: 'start-date',
                name: 'start-date',
                required: 'required',
                value: formatDate(this.startDate) // Format date as YYYY-MM-DD
            }
        });
        
        // End date
        const endDateGroup = form.createDiv('expensica-form-group');
        endDateGroup.createEl('label', {
            text: 'End Date',
            cls: 'expensica-form-label',
            attr: { for: 'end-date' }
        });
        
        const endDateInput = endDateGroup.createEl('input', {
            cls: 'expensica-form-input',
            attr: {
                type: 'date',
                id: 'end-date',
                name: 'end-date',
                required: 'required',
                value: formatDate(this.endDate) // Format date as YYYY-MM-DD
            }
        });
        
        // Button container
        const buttonContainer = form.createDiv('expensica-form-footer');
        
        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        
        // Apply button
        const applyButton = buttonContainer.createEl('button', {
            text: 'Apply',
            cls: 'expensica-btn expensica-btn-primary',
            attr: { type: 'button' }
        });
        
        // Event listeners
        cancelButton.addEventListener('click', () => {
            this.close();
        });
        
        applyButton.addEventListener('click', () => {
            const startDateValue = startDateInput.value;
            const endDateValue = endDateInput.value;
            
            if (startDateValue && endDateValue) {
                const start = new Date(startDateValue);
                const end = new Date(endDateValue);
                
                // Validate dates
                if (start > end) {
                    new Notice('Start date cannot be after end date');
                    return;
                }
                
                this.onConfirm(start, end);
                this.close();
            } else {
                new Notice('Please select both start and end dates');
            }
        });
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

// Transaction modal base class
class TransactionModal extends Modal {
    plugin: ExpensicaPlugin;
    dashboardView: ExpensicaDashboardView;
    transaction: Transaction | null;

    constructor(app: App, plugin: ExpensicaPlugin, dashboardView: ExpensicaDashboardView, transaction: Transaction | null = null) {
        super(app);
        this.plugin = plugin;
        this.dashboardView = dashboardView;
        this.transaction = transaction;
    }

    getTitle(): string {
        return 'Transaction';
    }

    getTransactionType(): TransactionType {
        return TransactionType.EXPENSE;
    }

    getCategoryType(): CategoryType {
        return this.getTransactionType() === TransactionType.EXPENSE ?
            CategoryType.EXPENSE : CategoryType.INCOME;
    }

    getModalIcon(): string {
        return this.getTransactionType() === TransactionType.EXPENSE ?
            '💸' : '💰';
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        contentEl.addClass('expensica-modal');

        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.innerHTML = `<span class="expensica-modal-title-icon">${this.getModalIcon()}</span> ${this.getTitle()}`;

        const form = contentEl.createEl('form', { cls: 'expensica-form' });

        // Description
        const descGroup = form.createDiv('expensica-form-group');
        descGroup.createEl('label', {
            text: 'Description',
            cls: 'expensica-form-label',
            attr: { for: 'description' }
        });
        const descInput = descGroup.createEl('input', {
            cls: 'expensica-form-input',
            attr: {
                type: 'text',
                id: 'description',
                name: 'description',
                placeholder: 'Enter a description',
                required: 'required'
            }
        });

        // Amount
        const amountGroup = form.createDiv('expensica-form-group');
        amountGroup.createEl('label', {
            text: 'Amount',
            cls: 'expensica-form-label',
            attr: { for: 'amount' }
        });
        const amountInput = amountGroup.createEl('input', {
            cls: 'expensica-form-input',
            attr: {
                type: 'number',
                id: 'amount',
                name: 'amount',
                placeholder: 'Enter amount',
                step: '0.01',
                min: '0.01',
                required: 'required'
            }
        });

        // Date
        const dateGroup = form.createDiv('expensica-form-group');
        dateGroup.createEl('label', {
            text: 'Date',
            cls: 'expensica-form-label',
            attr: { for: 'date' }
        });
        const dateInput = dateGroup.createEl('input', {
            cls: 'expensica-form-input',
            attr: {
                type: 'date',
                id: 'date',
                name: 'date',
                required: 'required'
            }
        });

        // Category - Custom implementation for better visibility
        const categoryGroup = form.createDiv('expensica-form-group');
        categoryGroup.createEl('label', {
            text: 'Category',
            cls: 'expensica-form-label',
            attr: { for: 'category' }
        });

        // Create a custom select container
        const categorySelectContainer = categoryGroup.createDiv('expensica-custom-select-container');

        // Hidden actual select element for form submission
        const hiddenCategorySelect = categorySelectContainer.createEl('select', {
            cls: 'expensica-form-select hidden-select',
            attr: {
                id: 'category',
                name: 'category',
                required: 'required'
            }
        });

        // Custom select display element
        const categoryDisplay = categorySelectContainer.createDiv('expensica-select-display');
        const categoryDisplayText = categoryDisplay.createSpan('expensica-select-display-text');
        const dropdownIcon = categoryDisplay.createSpan('expensica-select-arrow');
        dropdownIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

        // Category options dropdown
        const categoryOptions = categorySelectContainer.createDiv('expensica-select-options');
        categoryOptions.addClass('expensica-select-hidden');

        // Add categories as options, filtered by type
        const categoryType = this.getCategoryType();
        const categories = this.plugin.getCategories(categoryType);

        // Check if we need to show a warning about deleted category
        let categoryWarning = null;
        if (this.transaction && !this.plugin.getCategoryById(this.transaction.category)) {
            categoryWarning = categoryGroup.createDiv('category-warning');
            categoryWarning.createEl('p', {
                text: 'The original category for this transaction has been deleted. Please select a new category.',
                cls: 'warning-text'
            });
        }

        // Set default selected category
        let selectedCategoryId = '';
        let selectedCategoryLabel = '';
        let selectedCategoryEmoji = '';

        // Determine the initial selected category
        if (this.transaction) {
            // Handle editing an existing transaction
            if (this.plugin.getCategoryById(this.transaction.category)) {
                selectedCategoryId = this.transaction.category;
                const category = this.plugin.getCategoryById(this.transaction.category);
                if (category) {
                    selectedCategoryLabel = category.name;
                    selectedCategoryEmoji = category.emoji;
                }
            } else if (categories.length > 0) {
                // Select the first available category if original one is gone
                selectedCategoryId = categories[0].id;
                selectedCategoryLabel = categories[0].name;
                selectedCategoryEmoji = categories[0].emoji;
            }
        } else if (categories.length > 0) {
            // Default for new transaction
            selectedCategoryId = categories[0].id;
            selectedCategoryLabel = categories[0].name;
            selectedCategoryEmoji = categories[0].emoji;
        }

        // Add options to both the hidden select and custom dropdown
        categories.forEach(category => {
            // Add to the hidden select for form submission
            hiddenCategorySelect.createEl('option', {
                text: category.name,
                attr: { value: category.id }
            });

            // Create custom option item
            const optionItem = categoryOptions.createDiv('expensica-select-option');
            optionItem.setAttribute('data-value', category.id);
            optionItem.innerHTML = `<span class="expensica-category-emoji">${category.emoji}</span> ${category.name}`;

            // Mark as selected if this is the current category
            if (category.id === selectedCategoryId) {
                optionItem.addClass('expensica-option-selected');
            }

            // Handle option selection
            optionItem.addEventListener('click', () => {
                // Update the hidden select value
                hiddenCategorySelect.value = category.id;

                // Update display
                categoryDisplayText.innerHTML = `<span class="expensica-category-emoji">${category.emoji}</span> ${category.name}`;

                // Update selected class
                const allOptions = categoryOptions.querySelectorAll('.expensica-select-option');
                allOptions.forEach(opt => {
                    opt.removeClass('expensica-option-selected');
                });
                optionItem.addClass('expensica-option-selected');

                // Hide the dropdown
                categoryOptions.addClass('expensica-select-hidden');
            });
        });

        // Set initial display value
        if (selectedCategoryEmoji && selectedCategoryLabel) {
            categoryDisplayText.innerHTML = `<span class="expensica-category-emoji">${selectedCategoryEmoji}</span> ${selectedCategoryLabel}`;
            hiddenCategorySelect.value = selectedCategoryId;
        } else {
            categoryDisplayText.textContent = 'Select a category';
        }

        // Toggle dropdown on click
        categoryDisplay.addEventListener('click', () => {
            const isHidden = categoryOptions.hasClass('expensica-select-hidden');
            categoryOptions.toggleClass('expensica-select-hidden', !isHidden);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const target = event.target as Node;
            if (!categorySelectContainer.contains(target)) {
                categoryOptions.addClass('expensica-select-hidden');
            }
        });

        // Notes
        const notesGroup = form.createDiv('expensica-form-group');
        notesGroup.createEl('label', {
            text: 'Notes (optional)',
            cls: 'expensica-form-label',
            attr: { for: 'notes' }
        });
        const notesInput = notesGroup.createEl('textarea', {
            cls: 'expensica-form-textarea',
            attr: {
                id: 'notes',
                name: 'notes',
                placeholder: 'Additional notes'
            }
        });

        // Buttons
        const formFooter = form.createDiv('expensica-form-footer');
        const cancelBtn = formFooter.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        const saveBtn = formFooter.createEl('button', {
            text: this.transaction ? 'Update' : 'Save',
            cls: `expensica-btn ${this.getTransactionType() === TransactionType.EXPENSE ? 'expensica-btn-danger' : 'expensica-btn-success'}`,
            attr: { type: 'submit' }
        });

        // Fill form with transaction data if editing
        if (this.transaction) {
            descInput.value = this.transaction.description;
            amountInput.value = this.transaction.amount.toString();
            dateInput.value = this.transaction.date.substring(0, 10); // YYYY-MM-DD
            notesInput.value = this.transaction.notes || '';
        } else {
            // Set default date to today
            dateInput.value = formatDate(new Date());
        }

        // Event listeners
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target as HTMLFormElement);
            const transaction: Transaction = {
                id: this.transaction ? this.transaction.id : generateId(),
                date: formData.get('date') as string,
                type: this.getTransactionType(),
                amount: parseFloat(formData.get('amount') as string),
                description: formData.get('description') as string,
                category: formData.get('category') as string,
                notes: formData.get('notes') as string || undefined
            };

            if (this.transaction) {
                await this.dashboardView.updateTransaction(transaction);
            } else {
                await this.dashboardView.addTransaction(transaction);
            }

            this.close();
        });
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

// Expense modal
export class ExpenseModal extends TransactionModal {
    getTitle(): string {
        return this.transaction ? 'Edit Expense' : 'Add Expense';
    }

    getTransactionType(): TransactionType {
        return TransactionType.EXPENSE;
    }

    getModalIcon(): string {
        return '💸';
    }
}

// Income modal
export class IncomeModal extends TransactionModal {
    getTitle(): string {
        return this.transaction ? 'Edit Income' : 'Add Income';
    }

    getTransactionType(): TransactionType {
        return TransactionType.INCOME;
    }

    getModalIcon(): string {
        return '💰';
    }
}

// Budget Modal for adding/editing budgets
class BudgetModal extends Modal {
    plugin: ExpensicaPlugin;
    dashboard: ExpensicaDashboardView;
    budget: Budget | null;
    categorySelect: HTMLSelectElement | null = null;
    amountInput: HTMLInputElement | null = null;
    periodSelect: HTMLSelectElement | null = null;
    rolloverToggle: HTMLElement | null = null;
    isRollover: boolean = false;

    constructor(app: App, plugin: ExpensicaPlugin, dashboard: ExpensicaDashboardView, budget: Budget | null = null) {
        super(app);
        this.plugin = plugin;
        this.dashboard = dashboard;
        this.budget = budget;
        
        // If editing an existing budget, set the initial values
        if (budget) {
            this.isRollover = budget.rollover;
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('expensica-modal');

        // Add title
        contentEl.createEl('h2', { text: this.budget ? 'Edit Budget' : 'Add Budget' });

        // Create form
        const form = contentEl.createEl('form');
        form.addClass('expensica-form');

        // Category selection
        this.renderCategorySelect(form);

        // Amount input
        this.renderAmountInput(form);

        // Period selection
        this.renderPeriodSelect(form);

        // Rollover toggle
        this.renderRolloverToggle(form);

        // Buttons
        const buttonContainer = form.createDiv('expensica-form-buttons');
        
        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-btn expensica-btn-secondary',
            type: 'button'
        });
        
        // Save button
        const saveButton = buttonContainer.createEl('button', {
            text: 'Save Budget',
            cls: 'expensica-btn expensica-btn-primary',
            type: 'submit'
        });

        // Events
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveBudget();
            this.close();
        });
    }

    // Render category dropdown
    private renderCategorySelect(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        formGroup.createEl('label', { text: 'Category', attr: { for: 'budget-category' } });
        
        // Create select element
        this.categorySelect = formGroup.createEl('select', { 
            cls: 'expensica-select',
            attr: { id: 'budget-category', name: 'category', required: 'true' }
        });
        
        // Add placeholder option
        const placeholderOption = this.categorySelect?.createEl('option', {
            text: 'Select a category',
            value: ''
        });
        
        if (placeholderOption) {
            placeholderOption.disabled = true;
            placeholderOption.selected = !this.budget;
        }
        
        // Get expense categories
        const categories = this.plugin.getCategories(CategoryType.EXPENSE);
        
        // Create an option for each category
        categories.forEach(category => {
            if (!this.categorySelect) return;
            
            const option = this.categorySelect.createEl('option', {
                text: `${category.emoji} ${category.name}`,
                value: category.id
            });
            
            // If editing a budget, select the correct category
            if (this.budget && this.budget.categoryId === category.id) {
                option.selected = true;
            }
            
            // If category already has a budget, disable it unless it's the current budget
            const existingBudget = this.plugin.getBudgetForCategory(category.id);
            if (existingBudget && (!this.budget || existingBudget.id !== this.budget.id)) {
                option.disabled = true;
                option.textContent += ' (already budgeted)';
            }
        });
    }

    // Render amount input
    private renderAmountInput(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        formGroup.createEl('label', { text: 'Budget Amount', attr: { for: 'budget-amount' } });
        
        // Currency symbol wrapper
        const inputWrapper = formGroup.createDiv('expensica-currency-input');
        
        // Currency symbol
        const currency = this.plugin.settings.defaultCurrency;
        const symbol = getCurrencyByCode(currency)?.symbol || '$';
        
        inputWrapper.createSpan({
            text: symbol,
            cls: 'expensica-currency-symbol'
        });
        
        // Amount input
        this.amountInput = inputWrapper.createEl('input', {
            type: 'number',
            cls: 'expensica-input',
            attr: {
                id: 'budget-amount',
                name: 'amount',
                placeholder: '0.00',
                step: '0.01',
                min: '0',
                required: 'true',
                value: this.budget ? this.budget.amount.toString() : ''
            }
        });
    }

    // Render period select
    private renderPeriodSelect(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        formGroup.createEl('label', { text: 'Budget Period', attr: { for: 'budget-period' } });
        
        // Create select element
        this.periodSelect = formGroup.createEl('select', { 
            cls: 'expensica-select',
            attr: { id: 'budget-period', name: 'period', required: 'true' }
        });
        
        // Period options
        const periods = [
            { value: BudgetPeriod.MONTHLY, text: 'Monthly' },
            { value: BudgetPeriod.QUARTERLY, text: 'Quarterly' },
            { value: BudgetPeriod.YEARLY, text: 'Yearly' }
        ];
        
        // Create options
        periods.forEach(period => {
            if (!this.periodSelect) return;
            
            const option = this.periodSelect.createEl('option', {
                text: period.text,
                value: period.value
            });
            
            // If editing a budget, select the correct period
            if (this.budget && this.budget.period === period.value) {
                option.selected = true;
            }
        });
    }

    // Render rollover toggle
    private renderRolloverToggle(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        
        // Create toggle container
        const toggleContainer = formGroup.createDiv('expensica-toggle-container');
        
        // Toggle switch
        this.rolloverToggle = toggleContainer.createDiv('expensica-toggle');
        if (this.isRollover && this.rolloverToggle) {
            this.rolloverToggle.addClass('active');
        }
        
        // Toggle slider
        if (this.rolloverToggle) {
            const toggleSlider = this.rolloverToggle.createDiv('expensica-toggle-slider');
        }
        
        // Toggle label
        const toggleLabel = toggleContainer.createEl('label', { 
            text: 'Roll over unspent budget to next period',
            cls: 'expensica-toggle-label'
        });
        
        // Add event listener
        if (this.rolloverToggle) {
            this.rolloverToggle.addEventListener('click', () => {
                this.isRollover = !this.isRollover;
                if (this.isRollover && this.rolloverToggle) {
                    this.rolloverToggle.addClass('active');
                } else if (this.rolloverToggle) {
                    this.rolloverToggle.removeClass('active');
                }
            });
        }
    }

    // Save the budget
    private async saveBudget() {
        if (!this.categorySelect || !this.amountInput || !this.periodSelect) {
            return;
        }
        
        // Get form values
        const categoryId = this.categorySelect.value;
        const amount = parseFloat(this.amountInput.value);
        const period = this.periodSelect.value as BudgetPeriod;
        
        // Create or update budget
        if (this.budget) {
            // Update existing budget
            const updatedBudget: Budget = {
                ...this.budget,
                categoryId,
                amount,
                period,
                rollover: this.isRollover,
                lastUpdated: new Date().toISOString()
            };
            
            await this.plugin.updateBudget(updatedBudget);
        } else {
            // Create new budget
            const newBudget: Budget = {
                id: generateId(),
                categoryId,
                amount,
                period,
                rollover: this.isRollover,
                lastUpdated: new Date().toISOString()
            };
            
            await this.plugin.addBudget(newBudget);
        }
        
        // Refresh the dashboard
        this.dashboard.renderDashboard();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}