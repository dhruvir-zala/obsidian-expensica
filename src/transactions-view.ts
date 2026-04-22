import { App } from 'obsidian';
import {
    CategoryType,
    Transaction,
    TransactionType,
    formatCurrency,
    formatDate,
    parseLocalDate,
    sortTransactionsByDateTimeDesc,
    getRunningBalanceByTransactionId,
    getCurrencyByCode
} from './models';
import ExpensicaPlugin from '../main';
import type { SharedDateRangeState } from '../main';
import { ExpenseModal, IncomeModal, DateRangeType, DateRange } from './dashboard-view';
import { ConfirmationModal } from './confirmation-modal';
import { showExpensicaNotice } from './notice';
import { renderTransactionCard, showTransactionBulkCategoryMenu } from './transaction-card';
import { renderCategoryChip } from './category-chip';

export interface TransactionView {
    plugin: ExpensicaPlugin;
    addTransaction(transaction: Transaction): Promise<void>;
    updateTransaction(transaction: Transaction): Promise<void>;
    deleteTransaction(id: string): Promise<void>;
}

export class ExpensicaTransactionsView implements TransactionView {
    app: App;
    plugin: ExpensicaPlugin;
    transactions: Transaction[] = [];
    filteredTransactions: Transaction[] = [];
    searchQuery: string = '';
    selectedCategoryIds: string[] = [];
    inputFocused: boolean = false;
    
    // Pagination
    currentPage: number = 1;
    pageSize: number = 20;
    totalPages: number = 1;
    private scrollTop: number = 0;
    private hasRenderedView = false;
    private embeddedContentEl: HTMLElement | null = null;
    private selectedTransactionIds = new Set<string>();

    // Date range properties
    dateRange: DateRange;
    customStartDate: Date | null = null;
    customEndDate: Date | null = null;
    dateRangeUpdatedAt: number = 0;

    constructor(app: App, plugin: ExpensicaPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.dateRange = this.getDateRange(DateRangeType.THIS_MONTH);
    }

    renderDashboardTab(container: HTMLElement, preserveFocus = false) {
        const sharedDateRangeState = this.plugin.getSharedDateRangeState();
        if (sharedDateRangeState) {
            this.applySharedDateRangeStateValues(sharedDateRangeState);
        }

        this.embeddedContentEl = container;
        this.transactions = sortTransactionsByDateTimeDesc(this.plugin.getAllTransactions());
        this.applyFilters(false);
        container.addClass('expensica-dashboard-transactions-tab');
        this.renderTransactionStatsHeader(container);
        this.renderTransactionsBody(container, preserveFocus);
    }

    private getActiveContentEl(): HTMLElement {
        if (!this.embeddedContentEl) {
            throw new Error('Transactions renderer has no active container.');
        }

        return this.embeddedContentEl;
    }

    private renderTransactionsBody(container: HTMLElement, preserveFocus = false) {
        // Search bar section
        const searchSection = container.createDiv('expensica-search-section');
        const searchControls = searchSection.createDiv('expensica-search-controls');
        const searchContainer = searchControls.createDiv('expensica-search-container expensica-custom-search');
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

        this.renderCategoryFilter(searchContainer);
        this.renderSelectedFilterChips(searchSection);
        
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

    renderCategoryFilter(container: HTMLElement) {
        const filterContainer = container.createDiv('expensica-category-filter-container');
        const filterButton = filterContainer.createEl('button', {
            cls: 'expensica-category-filter-button',
            attr: {
                type: 'button',
                'aria-label': 'Filter transactions',
                title: 'Filter transactions'
            }
        });
        filterButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>';

        const filterMenu = filterContainer.createDiv('expensica-filter-menu');
        filterMenu.addClass('is-hidden');

        filterMenu.createDiv({
            text: 'Filter by',
            cls: 'expensica-filter-menu-title'
        });

        const categoryMenuItem = filterMenu.createDiv('expensica-filter-menu-item expensica-filter-menu-parent');
        categoryMenuItem.setAttribute('tabindex', '0');
        categoryMenuItem.createSpan({ text: 'Categories', cls: 'expensica-filter-menu-value' });
        const categoryMenuArrow = categoryMenuItem.createSpan('expensica-filter-menu-arrow');
        categoryMenuArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';

        const categorySubmenu = categoryMenuItem.createDiv('expensica-filter-submenu');
        this.renderCategoryFilterOptions(categorySubmenu);

        categoryMenuItem.addEventListener('click', (event) => {
            event.stopPropagation();
            categoryMenuItem.toggleClass('is-open', !categoryMenuItem.hasClass('is-open'));
        });

        const closeMenu = () => {
            filterContainer.removeClass('is-open');
            filterMenu.addClass('is-hidden');
        };

        filterButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const isHidden = filterMenu.hasClass('is-hidden');
            filterContainer.toggleClass('is-open', isHidden);
            filterMenu.toggleClass('is-hidden', !isHidden);

            if (isHidden) {
                setTimeout(() => {
                    document.addEventListener('click', closeMenu, { once: true });
                }, 0);
            }
        });

        filterMenu.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }

    renderCategoryFilterOptions(container: HTMLElement) {
        const categories = this.plugin.getCategories();

        if (categories.length === 0) {
            container.createDiv({
                text: 'No categories',
                cls: 'expensica-filter-menu-empty'
            });
            return;
        }

        categories.forEach(category => {
            const isSelected = this.selectedCategoryIds.includes(category.id);
            const categoryButton = container.createEl('button', {
                cls: `expensica-filter-category-option ${isSelected ? 'is-selected' : ''}`.trim(),
                attr: {
                    type: 'button',
                    'aria-pressed': String(isSelected),
                    'data-category-id': category.id
                }
            });

            categoryButton.createSpan({
                text: this.plugin.getCategoryEmoji(category.id),
                cls: 'expensica-filter-category-emoji'
            });
            categoryButton.createSpan({
                text: category.name,
                cls: 'expensica-filter-category-name'
            });

            categoryButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.toggleSelectedCategory(category.id);
                categoryButton.toggleClass('is-selected', this.selectedCategoryIds.includes(category.id));
                categoryButton.setAttribute('aria-pressed', String(this.selectedCategoryIds.includes(category.id)));
            });
        });
    }

    renderSelectedFilterChips(container: HTMLElement) {
        const selectedFiltersContainer = container.createDiv('expensica-selected-filters');
        selectedFiltersContainer.toggleClass('is-hidden', this.selectedCategoryIds.length === 0);

        this.selectedCategoryIds.forEach(categoryId => {
            const category = this.plugin.getCategoryById(categoryId);
            if (!category) {
                return;
            }

            const chip = renderCategoryChip(selectedFiltersContainer, {
                emoji: this.plugin.getCategoryEmoji(category.id),
                text: category.name,
                colorName: category.name,
                interactive: true
            });
            chip.addClass('expensica-selected-filter-chip');
            chip.setAttribute('aria-label', `Remove ${category.name} filter`);

            const removeIcon = chip.createSpan('expensica-selected-filter-remove');
            removeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

            chip.addEventListener('click', () => {
                this.removeSelectedCategory(category.id);
            });
        });
    }

    refreshSelectedFilterChips() {
        const searchSection = this.getActiveContentEl().querySelector('.expensica-search-section') as HTMLElement | null;
        if (!searchSection) {
            return;
        }

        searchSection.querySelector('.expensica-selected-filters')?.remove();
        this.renderSelectedFilterChips(searchSection);
    }

    refreshCategoryFilterOptions() {
        this.getActiveContentEl().querySelectorAll('.expensica-filter-category-option').forEach(option => {
            const categoryId = option.getAttribute('data-category-id');
            const isSelected = !!categoryId && this.selectedCategoryIds.includes(categoryId);

            option.toggleClass('is-selected', isSelected);
            option.setAttribute('aria-pressed', String(isSelected));
        });
    }

    toggleSelectedCategory(categoryId: string) {
        if (this.selectedCategoryIds.includes(categoryId)) {
            this.selectedCategoryIds = this.selectedCategoryIds.filter(id => id !== categoryId);
        } else {
            this.selectedCategoryIds = [...this.selectedCategoryIds, categoryId];
        }

        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }

    removeSelectedCategory(categoryId: string) {
        this.selectedCategoryIds = this.selectedCategoryIds.filter(id => id !== categoryId);
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }

    private formatTransactionStatCurrency(amount: number): string {
        const currencyCode = this.plugin.settings.defaultCurrency;
        const configuredSymbol = getCurrencyByCode(currencyCode)?.symbol || '$';
        const displaySymbol = configuredSymbol.includes('$') ? '$' : configuredSymbol;

        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode,
                currencyDisplay: 'symbol'
            }).formatToParts(amount)
                .map(part => part.type === 'currency' ? displaySymbol : part.value)
                .join('');
        } catch (error) {
            return formatCurrency(amount, currencyCode).replace(/[A-Z]{1,3}(?=\$)/g, '');
        }
    }

    private renderTransactionStatsHeader(container: HTMLElement) {
        const totals = this.getFilteredTransactionTotals();
        const statChipsContainer = container.createDiv('expensica-transaction-total-chips expensica-transactions-tab-chips');
        statChipsContainer.createEl('span', {
            text: this.filteredTransactions.length > 0 ? `${this.filteredTransactions.length} total` : '',
            cls: `expensica-transaction-count expensica-transaction-count-chip ${this.filteredTransactions.length === 0 ? 'is-hidden' : ''}`.trim()
        });
        this.renderTransactionTotalChip(statChipsContainer, 'spent', totals.expenses);
        this.renderTransactionTotalChip(statChipsContainer, 'income', totals.income);
    }

    private renderTransactionTotalChip(container: HTMLElement, type: 'spent' | 'income', amount: number) {
        if (amount === 0) {
            return null;
        }

        const label = type === 'spent' ? 'Spent' : 'Income';
        const className = type === 'spent'
            ? 'expensica-transaction-total-spent'
            : 'expensica-transaction-total-income';

        return container.createEl('span', {
            text: `${label} ${this.formatTransactionStatCurrency(amount)}`,
            cls: `expensica-transaction-count expensica-transaction-total-chip ${className}`
        });
    }

    private syncTransactionTotalChip(container: HTMLElement, type: 'spent' | 'income', amount: number) {
        const className = type === 'spent'
            ? 'expensica-transaction-total-spent'
            : 'expensica-transaction-total-income';
        const existingChip = container.querySelector(`.${className}`);

        existingChip?.remove();
        this.renderTransactionTotalChip(container, type, amount);
    }

    rememberScrollPosition() {
        this.scrollTop = this.getActiveContentEl().scrollTop;
    }

    restoreScrollPosition() {
        requestAnimationFrame(() => {
            this.getActiveContentEl().scrollTop = this.scrollTop;
        });
    }

    persistTransactionsState() {
        this.rememberScrollPosition();
        this.app.workspace.requestSaveLayout();
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

        if (this.embeddedContentEl) {
            this.refreshTransactionsListOnly();
        }
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
        const validTransactionIds = new Set(this.transactions.map(transaction => transaction.id));
        this.selectedTransactionIds.forEach(id => {
            if (!validTransactionIds.has(id)) {
                this.selectedTransactionIds.delete(id);
            }
        });

        this.selectedCategoryIds = this.selectedCategoryIds.filter(categoryId =>
            !!this.plugin.getCategoryById(categoryId)
        );

        // Filter transactions based on the date range
        this.filteredTransactions = this.transactions.filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
            return transactionDate >= this.dateRange.startDate && 
                   transactionDate <= this.dateRange.endDate;
        });
        
        // Apply search filter if there's a search query
        if (this.selectedCategoryIds.length > 0) {
            this.filteredTransactions = this.filteredTransactions.filter(transaction =>
                this.selectedCategoryIds.includes(transaction.category)
            );
        }

        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            this.filteredTransactions = this.filteredTransactions.filter(transaction => {
                const category = this.plugin.getCategoryById(transaction.category);
                const searchableValues = [
                    transaction.description,
                    transaction.category,
                    category?.name ?? '',
                    category ? this.plugin.getCategoryEmoji(category.id) : '',
                    transaction.notes ?? ''
                ];

                return searchableValues.some(value => value.toLowerCase().includes(query));
            });
        }
        
        // Update pagination
        this.totalPages = Math.max(1, Math.ceil(this.filteredTransactions.length / this.pageSize));
        if (resetPage) {
            this.currentPage = 1;
        } else if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
    }

    getFilteredTransactionTotals() {
        return this.filteredTransactions.reduce(
            (totals, transaction) => {
                if (transaction.type === TransactionType.INCOME) {
                    totals.income += transaction.amount;
                } else {
                    totals.expenses += transaction.amount;
                }

                return totals;
            },
            { income: 0, expenses: 0 }
        );
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
        const runningBalances = getRunningBalanceByTransactionId(this.transactions);
        
        this.renderTransactionsToContainer(transactionsContainer, pageTransactions, runningBalances);
        this.renderBulkSelectionFooter(transactionsSection);
    }

    private renderTransactionGroupTitle(container: HTMLElement, text: string, level: 'month' | 'day') {
        const headingLevel = level === 'month' ? 'h2' : 'h3';
        const titleEl = container.createEl(headingLevel, {
            cls: `expensica-transaction-group-title expensica-transaction-group-title-${level}`
        });

        if (level === 'day') {
            const iconEl = titleEl.createSpan('expensica-transaction-group-title-icon');
            iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
        }

        titleEl.createSpan({
            text,
            cls: 'expensica-transaction-group-title-text'
        });
    }

    private getTransactionMonthKey(transaction: Transaction): string {
        const date = parseLocalDate(transaction.date);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    private getTransactionDayKey(transaction: Transaction): string {
        const date = parseLocalDate(transaction.date);
        return formatDate(date);
    }

    private getTransactionMonthLabel(transaction: Transaction): string {
        return parseLocalDate(transaction.date).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });
    }

    private getTransactionDayLabel(transaction: Transaction): string {
        return parseLocalDate(transaction.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }

    private renderTransactionCardWithEditHandler(
        container: HTMLElement,
        transaction: Transaction,
        runningBalance: number
    ) {
        renderTransactionCard(container, {
            plugin: this.plugin,
            transaction,
            runningBalance,
            onEdit: (transaction) => {
                if (transaction.type === TransactionType.EXPENSE) {
                    const modal = new ExpenseModal(this.app, this.plugin, this as any, transaction);
                    modal.open();
                } else {
                    const modal = new IncomeModal(this.app, this.plugin, this as any, transaction);
                    modal.open();
                }
            },
            onCategoryChange: async (transaction, categoryId) => {
                await this.updateTransaction({
                    ...transaction,
                    category: categoryId
                });
            },
            selectable: true,
            selected: this.selectedTransactionIds.has(transaction.id),
            onSelectionToggle: (transaction, selected) => {
                if (selected) {
                    this.selectedTransactionIds.add(transaction.id);
                } else {
                    this.selectedTransactionIds.delete(transaction.id);
                }
                this.maybeShowMixedTransactionTypeSelectionNotice();
                this.syncBulkSelectionFooter();
            }
        });
    }

    private renderBulkSelectionFooter(container: HTMLElement) {
        container.querySelector('.expensica-transaction-bulk-footer')?.remove();
        const selectedTransactions = this.getSelectedTransactions();
        if (selectedTransactions.length === 0) {
            return;
        }

        const footer = container.createDiv('expensica-transaction-bulk-footer');
        footer.createSpan({
            text: `${selectedTransactions.length} selected`,
            cls: 'expensica-transaction-bulk-count'
        });

        const hasMixedTypes = new Set(selectedTransactions.map(transaction => transaction.type)).size > 1;
        const categoryButton = footer.createEl('button', {
            text: 'Category',
            cls: 'expensica-standard-button expensica-transaction-bulk-category-btn',
            attr: {
                type: 'button',
                'aria-label': hasMixedTypes ? 'Category unavailable for mixed transaction types' : 'Change category for selected transactions'
            }
        });

        if (hasMixedTypes) {
            categoryButton.disabled = true;
            categoryButton.title = 'Select only income or only expense transactions to bulk change category.';
        } else {
            categoryButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const categoryType = selectedTransactions[0].type === TransactionType.INCOME
                    ? CategoryType.INCOME
                    : CategoryType.EXPENSE;
                showTransactionBulkCategoryMenu(categoryButton, this.plugin, categoryType, async (categoryId) => {
                    await this.bulkUpdateSelectedTransactionsCategory(categoryId);
                });
            });
        }

        const clearButton = footer.createEl('button', {
            cls: 'expensica-transaction-bulk-clear',
            attr: {
                type: 'button',
                'aria-label': 'Clear selected transactions',
                title: 'Clear selected transactions'
            }
        });
        clearButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        clearButton.addEventListener('click', () => {
            this.clearSelectedTransactions();
        });
    }

    private getSelectedTransactions(): Transaction[] {
        return this.transactions.filter(transaction => this.selectedTransactionIds.has(transaction.id));
    }

    private clearSelectedTransactions() {
        this.selectedTransactionIds.clear();
        this.syncVisibleTransactionSelectionState();
        this.syncBulkSelectionFooter();
    }

    private maybeShowMixedTransactionTypeSelectionNotice() {
        const selectedTransactions = this.getSelectedTransactions();
        const hasMixedTypes = new Set(selectedTransactions.map(transaction => transaction.type)).size > 1;
        if (hasMixedTypes) {
            showExpensicaNotice('You can only change one transaction type at a time: Income or Expenses.');
        }
    }

    private async bulkUpdateSelectedTransactionsCategory(categoryId: string) {
        const selectedTransactions = this.getSelectedTransactions();
        if (selectedTransactions.length === 0) {
            return;
        }

        await Promise.all(selectedTransactions.map(transaction =>
            this.plugin.updateTransaction({
                ...transaction,
                category: categoryId
            }, this)
        ));

        await this.loadTransactionsData(false);
        this.selectedTransactionIds.clear();
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        showExpensicaNotice('Transactions updated successfully');
    }

    private syncBulkSelectionFooter() {
        const container = this.getActiveContentEl().querySelector('.expensica-transactions-section') as HTMLElement | null;
        if (!container) {
            return;
        }

        this.renderBulkSelectionFooter(container);
    }

    private syncVisibleTransactionSelectionState() {
        const container = this.getActiveContentEl();
        container.querySelectorAll<HTMLElement>('.expensica-transaction[data-transaction-id]').forEach(card => {
            const transactionId = card.getAttribute('data-transaction-id');
            const isSelected = !!transactionId && this.selectedTransactionIds.has(transactionId);
            card.toggleClass('is-selected', isSelected);

            const selector = card.querySelector<HTMLElement>('.expensica-transaction-selector');
            selector?.toggleClass('is-selected', isSelected);
            selector?.setAttribute('aria-pressed', String(isSelected));
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
            cls: `expensica-standard-button expensica-pagination-btn ${extraClass} ${isDisabled ? 'disabled' : ''}`.trim(),
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
            '1',
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
            String(this.totalPages),
            'Last page',
            this.currentPage === this.totalPages,
            () => this.setCurrentPage(this.totalPages)
        );

        // Items per page selector container
        const itemsPerPageContainer = paginationSection.createDiv('expensica-items-per-page');
        itemsPerPageContainer.createEl('span', { text: 'Per Page:' });
        this.renderPageSizeSelector(itemsPerPageContainer);
    }

    refreshTransactionsListOnly() {
        const container = this.getActiveContentEl();
        this.rememberScrollPosition();
        container.addClass('expensica-suppress-motion');

        const countEl = container.querySelector('.expensica-transaction-count-chip');
        if (countEl) {
            countEl.textContent = this.filteredTransactions.length > 0 ? `${this.filteredTransactions.length} total` : '';
            countEl.classList.toggle('is-hidden', this.filteredTransactions.length === 0);
        }

        const totals = this.getFilteredTransactionTotals();
        const titleContainer = container.querySelector('.expensica-transaction-total-chips') as HTMLElement | null;
        if (titleContainer) {
            this.syncTransactionTotalChip(titleContainer, 'spent', totals.expenses);
            this.syncTransactionTotalChip(titleContainer, 'income', totals.income);
        }

        container.querySelector('.expensica-transactions-section')?.remove();
        container.querySelectorAll('.expensica-pagination').forEach(section => section.remove());

        this.renderPagination(container, 'top');
        this.renderTransactionsList(container);
        this.renderPagination(container, 'bottom');
        this.restoreScrollPosition();
    }

    async addTransaction(transaction: Transaction) {
        await this.plugin.addTransaction(transaction, this);
        
        // Refresh transactions without resetting the user's current filter/page context.
        await this.loadTransactionsData(false);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
    }

    async updateTransaction(transaction: Transaction) {
        await this.plugin.updateTransaction(transaction, this);
        
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
                    await this.plugin.deleteTransaction(id, this);
                    // Refresh transactions without resetting the user's current filter/page context.
                    await this.loadTransactionsData(false);
                    this.persistTransactionsState();
                    this.refreshTransactionsListOnly();
                    showExpensicaNotice('Transaction deleted successfully');
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

            case DateRangeType.LAST_WEEK:
                // Get the previous week (Sunday through Saturday)
                const currentDayOfWeek = now.getDay();
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayOfWeek - 7);
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayOfWeek - 1, 23, 59, 59, 999);
                label = 'Last Week';
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

            case DateRangeType.LAST_YEAR:
                start = new Date(now.getFullYear() - 1, 0, 1);
                end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
                label = 'Last Year';
                break;

            case DateRangeType.ALL_TIME:
                ({ start, end } = this.getAllTimeDateRangeBounds());
                label = 'All Time';
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

    getAllTimeDateRangeBounds(): { start: Date; end: Date } {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

        return this.plugin.getAllTransactions().reduce(
            (bounds, transaction) => {
                const transactionDate = parseLocalDate(transaction.date);
                const transactionStart = new Date(transactionDate);
                transactionStart.setHours(0, 0, 0, 0);
                const transactionEnd = new Date(transactionDate);
                transactionEnd.setHours(23, 59, 59, 999);

                if (transactionStart < bounds.start) {
                    bounds.start = transactionStart;
                }

                if (transactionEnd > bounds.end) {
                    bounds.end = transactionEnd;
                }

                return bounds;
            },
            { start: todayStart, end: todayEnd }
        );
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
                const searchInput = this.getActiveContentEl().querySelector('#expensica-search-input') as HTMLInputElement;
                if (searchInput) {
                    searchInput.focus();
                }
            }

            this._debounceTimeout = null;
        }, 300);
    }
    
    renderTransactionsToContainer(
        container: HTMLElement,
        transactions: Transaction[],
        runningBalances: Record<string, number> = getRunningBalanceByTransactionId(this.transactions)
    ) {
        let currentMonthKey = '';
        let currentDayKey = '';

        transactions.forEach(transaction => {
            const monthKey = this.getTransactionMonthKey(transaction);
            const dayKey = this.getTransactionDayKey(transaction);

            if (monthKey !== currentMonthKey) {
                currentMonthKey = monthKey;
                currentDayKey = '';
                this.renderTransactionGroupTitle(container, this.getTransactionMonthLabel(transaction), 'month');
            }

            if (dayKey !== currentDayKey) {
                currentDayKey = dayKey;
                this.renderTransactionGroupTitle(container, this.getTransactionDayLabel(transaction), 'day');
            }

            this.renderTransactionCardWithEditHandler(
                container,
                transaction,
                runningBalances[transaction.id] ?? 0
            );
        });
    }
    
    private _debounceTimeout: NodeJS.Timeout | null = null;
} 
