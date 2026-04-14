import { ItemView, WorkspaceLeaf, Notice, setIcon, debounce, ViewStateResult } from 'obsidian';
import {
    Transaction,
    TransactionType,
    TransactionAggregator,
    formatCurrency,
    formatDate,
    parseLocalDate,
    sortTransactionsByDateTimeDesc,
    CategoryType,
    Category,
    getMonthYearString,
    generateId,
    calculateBudgetStatus
} from './models';
import ExpensicaPlugin from '../main';
import type { SharedDateRangeState } from '../main';
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

interface TransactionsViewState {
    dateRangeType?: DateRangeType;
    dateRangeStart?: string;
    dateRangeEnd?: string;
    customStartDate?: string | null;
    customEndDate?: string | null;
    dateRangeUpdatedAt?: number;
    searchQuery?: string;
    currentPage?: number;
    pageSize?: number;
    scrollTop?: number;
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
    private scrollTop: number = 0;
    private hasRenderedView = false;

    // Date range properties
    dateRange: DateRange;
    customStartDate: Date | null = null;
    customEndDate: Date | null = null;
    dateRangeUpdatedAt: number = 0;

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
        const sharedDateRangeState = this.plugin.getSharedDateRangeState();
        if (sharedDateRangeState) {
            this.applySharedDateRangeStateValues(sharedDateRangeState);
        }

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

    getState(): Record<string, unknown> {
        this.rememberScrollPosition();
        return {
            ...super.getState(),
            dateRangeType: this.dateRange.type,
            dateRangeStart: formatDate(this.dateRange.startDate),
            dateRangeEnd: formatDate(this.dateRange.endDate),
            customStartDate: this.customStartDate ? formatDate(this.customStartDate) : null,
            customEndDate: this.customEndDate ? formatDate(this.customEndDate) : null,
            dateRangeUpdatedAt: this.dateRangeUpdatedAt,
            searchQuery: this.searchQuery,
            currentPage: this.currentPage,
            pageSize: this.pageSize,
            scrollTop: this.scrollTop
        };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);

        if (!state || typeof state !== 'object') {
            return;
        }

        const transactionsState = state as TransactionsViewState;

        if (typeof transactionsState.searchQuery === 'string') {
            this.searchQuery = transactionsState.searchQuery;
        }

        if (typeof transactionsState.pageSize === 'number' && [10, 20, 50, 100].includes(transactionsState.pageSize)) {
            this.pageSize = transactionsState.pageSize;
        }

        if (typeof transactionsState.currentPage === 'number' && transactionsState.currentPage > 0) {
            this.currentPage = transactionsState.currentPage;
        }

        if (transactionsState.customStartDate) {
            this.customStartDate = parseLocalDate(transactionsState.customStartDate);
        } else if (Object.prototype.hasOwnProperty.call(transactionsState, 'customStartDate')) {
            this.customStartDate = null;
        }

        if (transactionsState.customEndDate) {
            this.customEndDate = parseLocalDate(transactionsState.customEndDate);
        } else if (Object.prototype.hasOwnProperty.call(transactionsState, 'customEndDate')) {
            this.customEndDate = null;
        }

        if (transactionsState.dateRangeType) {
            const startDate = transactionsState.dateRangeStart ? parseLocalDate(transactionsState.dateRangeStart) : undefined;
            const endDate = transactionsState.dateRangeEnd ? parseLocalDate(transactionsState.dateRangeEnd) : undefined;
            this.dateRange = this.createDateRangeFromState(transactionsState.dateRangeType, startDate, endDate);
            this.dateRangeUpdatedAt = transactionsState.dateRangeUpdatedAt ?? 0;

            if (transactionsState.dateRangeType === DateRangeType.CUSTOM && startDate && endDate) {
                this.customStartDate = startDate;
                this.customEndDate = endDate;
            }
        }

        const sharedDateRangeState = this.plugin.getSharedDateRangeState();
        if (sharedDateRangeState && sharedDateRangeState.updatedAt >= this.dateRangeUpdatedAt) {
            this.applySharedDateRangeStateValues(sharedDateRangeState);
        } else if (transactionsState.dateRangeType) {
            await this.plugin.setSharedDateRangeState(this.createSharedDateRangeState(), this);
        }

        if (typeof transactionsState.scrollTop === 'number') {
            this.scrollTop = transactionsState.scrollTop;
        }

        if (this.contentEl.childElementCount > 0) {
            await this.loadTransactionsData(false);
            this.renderView();
        }
    }

    renderView(preserveFocus = false) {
        const container = this.contentEl;
        const isRoutineRender = this.hasRenderedView;
        this.rememberScrollPosition();
        container.empty();
        container.addClass('expensica-container');
        container.addClass('transactions-container');
        container.toggleClass('expensica-suppress-motion', isRoutineRender);

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
            this.currentPage = 1;
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

        // Pagination (near the filters for mobile reachability)
        this.renderPagination(container, 'top');
        
        // Transactions list (takes available space)
        this.renderTransactionsList(container);
        
        // Pagination (at the bottom)
        this.renderPagination(container, 'bottom');

        this.restoreScrollPosition();
        this.hasRenderedView = true;
    }

    renderHeader(container: HTMLElement) {
        const header = container.createDiv('expensica-header expensica-transactions-view-header');
        
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
        const actionsSection = header.createDiv('shadcn-actions');
        
        // Add date range selector
        this.renderDateRangeSelector(actionsSection);
        
        // Add expense button
        const addExpenseBtn = actionsSection.createEl('button', { 
            cls: 'shadcn-btn shadcn-btn-danger'
        });
        addExpenseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Expense';
        addExpenseBtn.addEventListener('click', () => {
            const modal = new ExpenseModal(this.app, this.plugin, this as any);
            modal.open();
        });
        
        // Add income button
        const addIncomeBtn = actionsSection.createEl('button', { 
            cls: 'shadcn-btn shadcn-btn-success'
        });
        addIncomeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Income';
        addIncomeBtn.addEventListener('click', () => {
            const modal = new IncomeModal(this.app, this.plugin, this as any);
            modal.open();
        });
    }

    // New method to render the date range selector
    private renderDateRangeSelector(container: HTMLElement) {
        const dateRangeContainer = container.createDiv('shadcn-date-range-container');

        // Create the date range selector dropdown
        const dateRangeSelector = dateRangeContainer.createDiv('shadcn-date-range-selector');
        
        // Current selection display
        const currentSelection = dateRangeSelector.createDiv('shadcn-date-range-current');
        currentSelection.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
        
        const dateRangeText = currentSelection.createSpan({ 
            text: this.dateRange.label,
            cls: 'shadcn-date-range-text'
        });
        
        const dropdownIcon = currentSelection.createSpan({ cls: 'shadcn-date-range-icon' });
        dropdownIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

        // Dropdown options container
        const optionsContainer = dateRangeSelector.createDiv('shadcn-date-range-options');
        optionsContainer.addClass('shadcn-date-range-hidden');

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
            const optionItem = optionsContainer.createDiv('shadcn-date-range-option');
            optionItem.textContent = option.label;
            
            // Highlight the active option
            if (this.dateRange.type === option.type) {
                optionItem.addClass('shadcn-date-range-option-active');
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
                            await this.updateSharedDateRange();
                            
                            // Update dateRangeText
                            dateRangeText.textContent = this.dateRange.label;
                            
                            // Reload transactions and update view
                            await this.loadTransactionsData(true);
                            this.persistTransactionsState();
                            this.renderView();
                        }
                    });
                    modal.open();
                } else {
                    // Set the new date range
                    this.dateRange = this.getDateRange(option.type);
                    await this.updateSharedDateRange();
                    
                    // Update dateRangeText
                    dateRangeText.textContent = this.dateRange.label;
                    
                    // Reload transactions and update view
                    await this.loadTransactionsData(true);
                    this.persistTransactionsState();
                    this.renderView();
                }
                
                // Hide the dropdown
                optionsContainer.addClass('shadcn-date-range-hidden');
                dropdownIcon.removeClass('dropdown-icon-open');
            });
        });

        // Toggle dropdown on click
        currentSelection.addEventListener('click', () => {
            const isHidden = optionsContainer.hasClass('shadcn-date-range-hidden');
            optionsContainer.toggleClass('shadcn-date-range-hidden', !isHidden);
            dropdownIcon.toggleClass('dropdown-icon-open', isHidden);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (!dateRangeSelector.contains(target)) {
                optionsContainer.addClass('shadcn-date-range-hidden');
                dropdownIcon.removeClass('dropdown-icon-open');
            }
        });
    }

    rememberScrollPosition() {
        this.scrollTop = this.contentEl.scrollTop;
    }

    restoreScrollPosition() {
        requestAnimationFrame(() => {
            this.contentEl.scrollTop = this.scrollTop;
        });
    }

    persistTransactionsState() {
        this.rememberScrollPosition();
        this.app.workspace.requestSaveLayout();
    }

    createSharedDateRangeState(): SharedDateRangeState {
        return {
            type: this.dateRange.type,
            startDate: formatDate(this.dateRange.startDate),
            endDate: formatDate(this.dateRange.endDate),
            customStartDate: this.customStartDate ? formatDate(this.customStartDate) : null,
            customEndDate: this.customEndDate ? formatDate(this.customEndDate) : null,
            updatedAt: this.dateRangeUpdatedAt
        };
    }

    applySharedDateRangeStateValues(state: SharedDateRangeState) {
        const startDate = parseLocalDate(state.startDate);
        const endDate = parseLocalDate(state.endDate);
        this.dateRange = this.createDateRangeFromState(state.type, startDate, endDate);
        this.customStartDate = state.customStartDate ? parseLocalDate(state.customStartDate) : null;
        this.customEndDate = state.customEndDate ? parseLocalDate(state.customEndDate) : null;
        this.dateRangeUpdatedAt = state.updatedAt;
    }

    async applySharedDateRangeState(state: SharedDateRangeState) {
        if (state.updatedAt < this.dateRangeUpdatedAt) {
            return;
        }

        this.applySharedDateRangeStateValues(state);
        await this.loadTransactionsData(true);
        this.persistTransactionsState();
        this.renderView();
    }

    async updateSharedDateRange() {
        this.dateRangeUpdatedAt = Date.now();
        await this.plugin.setSharedDateRangeState(this.createSharedDateRangeState(), this);
    }

    createDateRangeFromState(type: DateRangeType, startDate?: Date, endDate?: Date): DateRange {
        if (type === DateRangeType.CUSTOM && startDate && endDate) {
            return this.getDateRange(DateRangeType.CUSTOM, startDate, endDate);
        }

        return this.getDateRange(type);
    }

    async loadTransactionsData(resetPage = false) {
        // Load all transactions
        this.transactions = this.plugin.getAllTransactions();
        
        // Sort transactions by date and time (latest first)
        this.transactions = sortTransactionsByDateTimeDesc(this.transactions);
        
        this.applyFilters(resetPage);
    }

    applyFilters(resetPage = false) {
        // Filter transactions based on the date range
        this.filteredTransactions = this.transactions.filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
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
        this.totalPages = Math.max(1, Math.ceil(this.filteredTransactions.length / this.pageSize));
        if (resetPage) {
            this.currentPage = 1;
        } else if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
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
            const date = parseLocalDate(transaction.date);
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

    getPaginationWindow(): number[] {
        const visiblePageCount = Math.min(3, this.totalPages);
        const maxStartPage = this.totalPages - visiblePageCount + 1;
        const startPage = Math.max(1, Math.min(this.currentPage - 1, maxStartPage));

        return Array.from({ length: visiblePageCount }, (_, index) => startPage + index);
    }

    setCurrentPage(page: number) {
        const nextPage = Math.max(1, Math.min(page, this.totalPages));

        if (nextPage === this.currentPage) return;

        this.currentPage = nextPage;
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
    }

    renderPaginationButton(
        container: HTMLElement,
        label: string,
        ariaLabel: string,
        isDisabled: boolean,
        onClick: () => void,
        extraClass = ''
    ) {
        const button = container.createEl('button', {
            cls: `expensica-pagination-btn ${extraClass} ${isDisabled ? 'disabled' : ''}`.trim(),
            text: label,
            attr: {
                'aria-label': ariaLabel,
                title: ariaLabel
            }
        });

        button.addEventListener('click', () => {
            if (!isDisabled) {
                onClick();
            }
        });

        return button;
    }

    renderPageSizeSelector(container: HTMLElement) {
        const selector = container.createDiv('expensica-page-size-selector expensica-date-range-selector');
        const currentSelection = selector.createDiv('expensica-page-size-current expensica-date-range-current');
        currentSelection.createSpan({
            text: String(this.pageSize),
            cls: 'expensica-date-range-text'
        });

        const dropdownIcon = currentSelection.createSpan({ cls: 'expensica-date-range-icon' });
        dropdownIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

        const optionsContainer = selector.createDiv('expensica-date-range-options expensica-date-range-hidden');

        [10, 20, 50, 100].forEach(size => {
            const optionItem = optionsContainer.createDiv('expensica-date-range-option');
            optionItem.textContent = String(size);

            if (size === this.pageSize) {
                optionItem.addClass('expensica-date-range-option-active');
            }

            optionItem.addEventListener('click', (event) => {
                event.stopPropagation();
                this.pageSize = size;
                this.applyFilters(true);
                this.persistTransactionsState();
                this.refreshTransactionsListOnly();
            });
        });

        currentSelection.addEventListener('click', (event) => {
            event.stopPropagation();
            const isHidden = optionsContainer.hasClass('expensica-date-range-hidden');
            optionsContainer.toggleClass('expensica-date-range-hidden', !isHidden);

            if (isHidden) {
                setTimeout(() => {
                    document.addEventListener('click', () => {
                        optionsContainer.addClass('expensica-date-range-hidden');
                    }, { once: true });
                }, 0);
            }
        });
    }

    renderPagination(container: HTMLElement, placement: 'top' | 'bottom') {
        if (this.filteredTransactions.length === 0) return;

        // Check for existing pagination in this placement and remove it
        const existingPagination = container.querySelector(`.expensica-pagination-${placement}`);
        if (existingPagination) {
            existingPagination.remove();
        }

        const paginationSection = container.createDiv(`expensica-pagination expensica-pagination-${placement}`);
        
        // Navigation buttons container
        const navigationContainer = paginationSection.createDiv('expensica-pagination-nav');
        
        // First page button
        this.renderPaginationButton(
            navigationContainer,
            '<<',
            'First page',
            this.currentPage === 1,
            () => this.setCurrentPage(1)
        );

        // Previous page button
        this.renderPaginationButton(
            navigationContainer,
            '<',
            'Previous page',
            this.currentPage === 1,
            () => this.setCurrentPage(this.currentPage - 1)
        );

        // Sliding page buttons
        this.getPaginationWindow().forEach(page => {
            this.renderPaginationButton(
                navigationContainer,
                String(page),
                `Page ${page} of ${this.totalPages}`,
                false,
                () => this.setCurrentPage(page),
                page === this.currentPage ? 'active' : ''
            );
        });

        // Next page button
        this.renderPaginationButton(
            navigationContainer,
            '>',
            'Next page',
            this.currentPage === this.totalPages,
            () => this.setCurrentPage(this.currentPage + 1)
        );

        // Last page button
        this.renderPaginationButton(
            navigationContainer,
            '>>',
            'Last page',
            this.currentPage === this.totalPages,
            () => this.setCurrentPage(this.totalPages)
        );

        // Items per page selector container
        const itemsPerPageContainer = paginationSection.createDiv('expensica-items-per-page');
        itemsPerPageContainer.createEl('span', { text: 'Items Per Page:' });
        this.renderPageSizeSelector(itemsPerPageContainer);
    }

    refreshTransactionsListOnly() {
        this.contentEl.addClass('expensica-suppress-motion');

        const countEl = this.contentEl.querySelector('.expensica-transaction-count');
        if (countEl) {
            countEl.textContent = `${this.filteredTransactions.length} transactions`;
        }

        this.contentEl.querySelector('.expensica-transactions-section')?.remove();
        this.contentEl.querySelectorAll('.expensica-pagination').forEach(section => section.remove());

        this.renderPagination(this.contentEl, 'top');
        this.renderTransactionsList(this.contentEl);
        this.renderPagination(this.contentEl, 'bottom');
        this.restoreScrollPosition();
    }

    async addTransaction(transaction: Transaction) {
        await this.plugin.addTransaction(transaction);
        
        // Refresh transactions without resetting the user's current filter/page context.
        await this.loadTransactionsData(false);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
    }

    async updateTransaction(transaction: Transaction) {
        await this.plugin.updateTransaction(transaction);
        
        // Refresh transactions without resetting the user's current filter/page context.
        await this.loadTransactionsData(false);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
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
                    // Refresh transactions without resetting the user's current filter/page context.
                    await this.loadTransactionsData(false);
                    this.persistTransactionsState();
                    this.refreshTransactionsListOnly();
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
            this.loadTransactionsData(true);
            this.persistTransactionsState();
            this.refreshTransactionsListOnly();

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
            const date = parseLocalDate(transaction.date);
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
