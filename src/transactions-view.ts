import { ItemView, WorkspaceLeaf, Notice, setIcon, debounce } from 'obsidian';
import {
    Transaction,
    TransactionType,
    TransactionAggregator,
    formatCurrency,
    formatDate,
    CategoryType,
    Category,
    getMonthYearString,
    generateId,
    calculateBudgetStatus
} from './models';
import ExpensicaPlugin from '../main';
import { ExpenseModal, IncomeModal, DateRangeType, DateRange, DateRangePickerModal } from './dashboard-view';
import { ConfirmationModal } from './confirmation-modal';

// Extend the plugin interface to include the new method
declare module '../main' {
    interface ExpensicaPlugin {
        openTransactionsView(): Promise<void>;
    }
}

export const EXPENSICA_TRANSACTIONS_VIEW_TYPE = 'expensica-transactions-view';

// Interface to make the view compatible with the transaction modals
export interface TransactionView {
    plugin: ExpensicaPlugin;
    addTransaction(transaction: Transaction): Promise<void>;
    updateTransaction(transaction: Transaction): Promise<void>;
    deleteTransaction(id: string): Promise<void>;
}

export class ExpensicaTransactionsView extends ItemView implements TransactionView {
    plugin: ExpensicaPlugin;
    transactions: Transaction[] = [];
    filteredTransactions: Transaction[] = [];
    searchQuery: string = '';
    inputFocused: boolean = false;
    
    // Pagination
    currentPage: number = 1;
    pageSize: number = 20;
    totalPages: number = 1;

    // Date range properties
    dateRange: DateRange;
    customStartDate: Date | null = null;
    customEndDate: Date | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ExpensicaPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with "This Month" as default date range
        this.dateRange = this.getDateRange(DateRangeType.THIS_MONTH);
    }

    getViewType(): string {
        return EXPENSICA_TRANSACTIONS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Expensica Transactions';
    }

    getIcon(): string {
        return 'list';
    }

    async onOpen() {
        // Load transactions data
        await this.loadTransactionsData();
        
        // Render the view
        this.renderView();
        
        // Register keyboard handlers
        this.registerDomEvent(document, 'keydown', (event) => {
            // If the search input is focused, don't let Obsidian's keyboard shortcuts interfere
            const searchInput = document.getElementById('expensica-search-input');
            if (searchInput === document.activeElement) {
                // Don't let Obsidian handle these keyboard events
                event.stopPropagation();
            }
        }, true);
    }

    async onClose() {
        // Cleanup
    }

    renderView(preserveFocus = false) {
        const container = this.contentEl;
        container.empty();
        container.addClass('expensica-container');
        container.addClass('transactions-container');

        // Header section (always visible at the top)
        this.renderHeader(container);
        
        // Search bar section
        const searchSection = container.createDiv('expensica-search-section');
        const searchContainer = searchSection.createDiv('expensica-search-container expensica-custom-search');
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search transactions...',
            cls: 'expensica-search-input expensica-custom-input',
            attr: {
                id: 'expensica-search-input'
            }
        });
        searchInput.value = this.searchQuery;
        
        // Add search icon
        const searchIcon = searchContainer.createDiv('expensica-search-icon');
        searchIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
        
        // Prevent default behavior that might cause focus loss
        searchInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });
        
        searchInput.addEventListener('input', (e) => {
            e.stopPropagation();
            const target = e.target as HTMLInputElement;
            this.searchQuery = target.value;
            this.inputFocused = true;
            this.updateSearchResults();
        });
        
        searchInput.addEventListener('focus', () => {
            this.inputFocused = true;
        });

        searchInput.addEventListener('blur', () => {
            this.inputFocused = false;
        });
        
        // Restore focus if needed
        if (preserveFocus && this.inputFocused) {
            setTimeout(() => {
                searchInput.focus();
            }, 0);
        }
        
        // Transactions list (takes available space)
        this.renderTransactionsList(container);
        
        // Pagination (at the bottom)
        this.renderPagination(container);
    }

    renderHeader(container: HTMLElement) {
        const header = container.createDiv('expensica-header');
        
        // Title section with count 
        const titleSection = header.createDiv('expensica-title-section');
        const titleContainer = titleSection.createDiv('expensica-transactions-header');
        
        // Main title
        const titleEl = titleContainer.createEl('h1', { 
            cls: 'expensica-title' 
        });
        titleEl.textContent = 'Transactions';
        
        // Transaction count
        const countEl = titleContainer.createEl('span', { 
            text: `${this.filteredTransactions.length} transactions`, 
            cls: 'expensica-transaction-count'
        });
        
        // Actions
        const actionsSection = header.createDiv('expensica-actions-section');
        
        // Add date range selector
        this.renderDateRangeSelector(actionsSection);
        
        // Add expense button
        const addExpenseBtn = actionsSection.createEl('button', { 
            cls: 'expensica-btn expensica-btn-danger' 
        });
        addExpenseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg> Add Expense';
        addExpenseBtn.addEventListener('click', () => {
            const modal = new ExpenseModal(this.app, this.plugin, this as any);
            modal.open();
        });
        
        // Add income button
        const addIncomeBtn = actionsSection.createEl('button', { 
            cls: 'expensica-btn expensica-btn-success' 
        });
        addIncomeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg> Add Income';
        addIncomeBtn.addEventListener('click', () => {
            const modal = new IncomeModal(this.app, this.plugin, this as any);
            modal.open();
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
                            
                            // Reload transactions and update view
                            await this.loadTransactionsData();
                            this.renderView();
                        }
                    });
                    modal.open();
                } else {
                    // Set the new date range
                    this.dateRange = this.getDateRange(option.type);
                    
                    // Update dateRangeText
                    dateRangeText.textContent = this.dateRange.label;
                    
                    // Reload transactions and update view
                    await this.loadTransactionsData();
                    this.renderView();
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

    async loadTransactionsData() {
        // Load all transactions
        this.transactions = this.plugin.getAllTransactions();
        
        // Sort transactions by date (latest first)
        this.transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        // Filter transactions based on the date range
        this.filteredTransactions = this.transactions.filter(transaction => {
            const transactionDate = new Date(transaction.date);
            return transactionDate >= this.dateRange.startDate && 
                   transactionDate <= this.dateRange.endDate;
        });
        
        // Apply search filter if there's a search query
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            this.filteredTransactions = this.filteredTransactions.filter(transaction => 
                transaction.description.toLowerCase().includes(query) ||
                transaction.category.toLowerCase().includes(query)
            );
        }
        
        // Update pagination
        this.totalPages = Math.ceil(this.filteredTransactions.length / this.pageSize);
        this.currentPage = 1; // Reset to first page when changing date range
    }

    renderTransactionsList(container: HTMLElement) {
        const transactionsSection = container.createDiv('expensica-transactions-section');
        
        if (this.filteredTransactions.length === 0) {
            // No transactions found
            const emptyState = transactionsSection.createDiv('expensica-empty-state');
            emptyState.createEl('div', { text: '📋', cls: 'expensica-empty-state-icon' });
            emptyState.createEl('p', {
                text: 'No transactions found matching your filters.',
                cls: 'expensica-empty-state-message'
            });
            return;
        }
        
        // Transactions container
        const transactionsContainer = transactionsSection.createDiv('expensica-transactions');
        
        // Calculate pagination
        const startIdx = (this.currentPage - 1) * this.pageSize;
        const endIdx = Math.min(startIdx + this.pageSize, this.filteredTransactions.length);
        
        // Get current page transactions
        const pageTransactions = this.filteredTransactions.slice(startIdx, endIdx);
        
        // Render each transaction
        pageTransactions.forEach(transaction => {
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
            iconEl.setText(categoryDisplay.emoji);
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
                month: 'short',
                year: 'numeric'
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
                    const modal = new ExpenseModal(this.app, this.plugin, this as any, transaction);
                    modal.open();
                } else {
                    const modal = new IncomeModal(this.app, this.plugin, this as any, transaction);
                    modal.open();
                }
            });

            deleteBtn.addEventListener('click', () => {
                this.deleteTransaction(transaction.id);
            });
        });
    }

    renderPagination(container: HTMLElement) {
        if (this.filteredTransactions.length === 0) return;

        // Check for existing pagination and remove it
        const existingPagination = container.querySelector('.expensica-pagination');
        if (existingPagination) {
            existingPagination.remove();
        }

        const paginationSection = container.createDiv('expensica-pagination');
        
        // Navigation buttons container
        const navigationContainer = paginationSection.createDiv('expensica-pagination-nav');
        
        // First page button
        const firstBtn = navigationContainer.createEl('button', {
            cls: `expensica-pagination-btn ${this.currentPage === 1 ? 'disabled' : ''}`,
            text: 'First'
        });
        firstBtn.addEventListener('click', () => {
            if (this.currentPage !== 1) {
                this.currentPage = 1;
                this.renderView();
            }
        });

        // Previous page button
        const prevBtn = navigationContainer.createEl('button', {
            cls: `expensica-pagination-btn ${this.currentPage === 1 ? 'disabled' : ''}`,
            text: 'Previous'
        });
        prevBtn.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderView();
            }
        });

        // Page indicator
        const pageIndicator = navigationContainer.createEl('span', {
            cls: 'expensica-pagination-info',
            text: `Page ${this.currentPage} of ${this.totalPages}`
        });

        // Next page button
        const nextBtn = navigationContainer.createEl('button', {
            cls: `expensica-pagination-btn ${this.currentPage === this.totalPages ? 'disabled' : ''}`,
            text: 'Next'
        });
        nextBtn.addEventListener('click', () => {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.renderView();
            }
        });

        // Last page button
        const lastBtn = navigationContainer.createEl('button', {
            cls: `expensica-pagination-btn ${this.currentPage === this.totalPages ? 'disabled' : ''}`,
            text: 'Last'
        });
        lastBtn.addEventListener('click', () => {
            if (this.currentPage !== this.totalPages) {
                this.currentPage = this.totalPages;
                this.renderView();
            }
        });

        // Items per page selector container
        const itemsPerPageContainer = paginationSection.createDiv('expensica-items-per-page');
        itemsPerPageContainer.createEl('span', { text: 'Items per page:' });
        
        const pageSizeSelect = itemsPerPageContainer.createEl('select', {
            cls: 'expensica-page-size-select'
        });
        
        [10, 20, 50, 100].forEach(size => {
            const option = pageSizeSelect.createEl('option', {
                text: String(size),
                value: String(size)
            });
            
            if (size === this.pageSize) {
                option.selected = true;
            }
        });
        
        pageSizeSelect.addEventListener('change', () => {
            this.pageSize = parseInt(pageSizeSelect.value);
            this.totalPages = Math.ceil(this.filteredTransactions.length / this.pageSize);
            this.currentPage = 1; // Reset to first page when changing page size
            this.renderView();
        });
    }

    applyFilters() {
        // No filtering needed anymore
        this.filteredTransactions = [...this.transactions];
        
        // Update pagination
        this.totalPages = Math.ceil(this.filteredTransactions.length / this.pageSize);
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
    }

    async addTransaction(transaction: Transaction) {
        await this.plugin.addTransaction(transaction);
        
        // Refresh transactions
        this.transactions = this.plugin.getAllTransactions();
        this.applyFilters();
        this.renderView();
    }

    async updateTransaction(transaction: Transaction) {
        await this.plugin.updateTransaction(transaction);
        
        // Refresh transactions
        this.transactions = this.plugin.getAllTransactions();
        this.applyFilters();
        this.renderView();
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
                    // Refresh transactions
                    this.transactions = this.plugin.getAllTransactions();
                    this.applyFilters();
                    this.renderView();
                    new Notice('Transaction deleted successfully');
                }
            }
        ).open();
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

    // New method to update search results without re-rendering the entire view
    updateSearchResults() {
        // Store current focus state
        const wasFocused = this.inputFocused;
        
        // Use a more efficient debounce approach
        if (this._debounceTimeout) {
            clearTimeout(this._debounceTimeout);
        }
        
        this._debounceTimeout = setTimeout(() => {
            this.loadTransactionsData();
            
            // Update only transaction count without full re-render
            const countEl = this.contentEl.querySelector('.expensica-transaction-count');
            if (countEl) {
                countEl.textContent = `${this.filteredTransactions.length} transactions`;
            }
            
            // Update transactions list
            const transactionsSection = this.contentEl.querySelector('.expensica-transactions-section');
            if (transactionsSection) {
                // Clear the transactions section
                transactionsSection.innerHTML = '';
                
                // Re-render transactions
                if (this.filteredTransactions.length === 0) {
                    // No transactions found
                    const emptyState = createDiv({ cls: 'expensica-empty-state', parent: transactionsSection });
                    createDiv({ text: '📋', cls: 'expensica-empty-state-icon', parent: emptyState });
                    createEl('p', {
                        text: 'No transactions found matching your filters.',
                        cls: 'expensica-empty-state-message',
                        parent: emptyState
                    });
                } else {
                    // Transactions container
                    const transactionsContainer = createDiv({ 
                        cls: 'expensica-transactions', 
                        parent: transactionsSection 
                    });
                    
                    // Calculate pagination
                    const startIdx = (this.currentPage - 1) * this.pageSize;
                    const endIdx = Math.min(startIdx + this.pageSize, this.filteredTransactions.length);
                    
                    // Get current page transactions
                    const pageTransactions = this.filteredTransactions.slice(startIdx, endIdx);
                    
                    // Render each transaction
                    this.renderTransactionsToContainer(transactionsContainer, pageTransactions);
                }
            }
            
            // Remove all existing pagination sections first
            const existingPaginationSections = this.contentEl.querySelectorAll('.expensica-pagination');
            existingPaginationSections.forEach(section => section.remove());
            
            // Now render a single pagination section at the bottom
            if (this.filteredTransactions.length > 0) {
                this.renderPagination(this.contentEl);
            }
            
            // Restore focus to search input if it was previously focused
            if (wasFocused) {
                const searchInput = this.contentEl.querySelector('#expensica-search-input') as HTMLInputElement;
                if (searchInput) {
                    searchInput.focus();
                }
            }
            
            this._debounceTimeout = null;
        }, 300);
    }
    
    // Helper method to render transactions to a container
    renderTransactionsToContainer(container: HTMLElement, transactions: Transaction[]) {
        transactions.forEach(transaction => {
            const transactionEl = container.createDiv('expensica-transaction');

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
            iconEl.setText(categoryDisplay.emoji);
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
                month: 'short',
                year: 'numeric'
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
                    const modal = new ExpenseModal(this.app, this.plugin, this as any, transaction);
                    modal.open();
                } else {
                    const modal = new IncomeModal(this.app, this.plugin, this as any, transaction);
                    modal.open();
                }
            });

            deleteBtn.addEventListener('click', () => {
                this.deleteTransaction(transaction.id);
            });
        });
    }
    
    private _debounceTimeout: NodeJS.Timeout | null = null;
} 