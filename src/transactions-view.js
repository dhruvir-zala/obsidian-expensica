import { __awaiter } from "tslib";
import { AccountType, CategoryType, TransactionType, formatCurrency, formatDate, formatAccountReference, getAccountEmoji, parseLocalDate, sortTransactionsByDateTimeDesc, getCurrencyByCode } from './models';
import { TransactionModal, DateRangeType } from './dashboard-view';
import { ConfirmationModal } from './confirmation-modal';
import { showExpensicaNotice } from './notice';
import { renderTransactionCard, showTransactionBulkCategoryMenu } from './transaction-card';
import { renderCategoryChip } from './category-chip';
function getAccountTransactionAmount(plugin, transaction, accountReference) {
    const account = plugin.findAccountByReference(accountReference);
    const isCredit = (account === null || account === void 0 ? void 0 : account.type) === AccountType.CREDIT;
    if (transaction.type === TransactionType.INTERNAL) {
        const fromAccount = transaction.fromAccount ? plugin.normalizeTransactionAccountReference(transaction.fromAccount) : '';
        const toAccount = transaction.toAccount ? plugin.normalizeTransactionAccountReference(transaction.toAccount) : '';
        if (fromAccount === accountReference) {
            return isCredit ? transaction.amount : -transaction.amount;
        }
        if (toAccount === accountReference) {
            return isCredit ? -transaction.amount : transaction.amount;
        }
        return 0;
    }
    const transactionAccount = Object.prototype.hasOwnProperty.call(transaction, 'account')
        ? plugin.normalizeTransactionAccountReference(transaction.account)
        : plugin.normalizeTransactionAccountReference(undefined);
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
function getRunningBalanceByTransactionIdForAccount(plugin, accountReference, transactions) {
    let runningBalance = 0;
    const normalizeBalanceValue = (value) => Math.abs(value) < 0.000001 ? 0 : value;
    return sortTransactionsByDateTimeDesc(transactions)
        .reverse()
        .reduce((balances, transaction) => {
        runningBalance = normalizeBalanceValue(runningBalance + getAccountTransactionAmount(plugin, transaction, accountReference));
        balances[transaction.id] = runningBalance;
        return balances;
    }, {});
}
function formatRunningBalanceLabel(plugin, balance, accountReference) {
    var _a;
    const currency = getCurrencyByCode(plugin.settings.defaultCurrency) || getCurrencyByCode('USD');
    const code = (currency === null || currency === void 0 ? void 0 : currency.code) || 'USD';
    const fallbackSymbol = (currency === null || currency === void 0 ? void 0 : currency.symbol) || '$';
    let symbol = fallbackSymbol;
    try {
        symbol = ((_a = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol'
        }).formatToParts(0).find(part => part.type === 'currency')) === null || _a === void 0 ? void 0 : _a.value) || fallbackSymbol;
    }
    catch (_b) {
        symbol = fallbackSymbol;
    }
    const normalizedSymbol = symbol.replace(/[A-Za-z]+/g, '').trim() || '$';
    const absoluteAmount = Math.abs(balance);
    const fractionDigits = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(absoluteAmount);
    const sign = balance < 0 ? '-' : '';
    const amount = `${sign}${normalizedSymbol}${fractionDigits}`;
    if (!accountReference) {
        return amount;
    }
    const account = plugin.getTransactionAccountDisplay(accountReference);
    return `${account.name}: ${amount}`;
}
export class ExpensicaTransactionsView {
    constructor(app, plugin) {
        this.transactions = [];
        this.filteredTransactions = [];
        this.searchQuery = '';
        this.selectedTypeFilters = [];
        this.selectedAccountReferences = [];
        this.selectedCategoryIds = [];
        this.inputFocused = false;
        // Pagination
        this.currentPage = 1;
        this.pageSize = 20;
        this.totalPages = 1;
        this.scrollTop = 0;
        this.hasRenderedView = false;
        this.embeddedContentEl = null;
        this.selectedTransactionIds = new Set();
        this.customStartDate = null;
        this.customEndDate = null;
        this.dateRangeUpdatedAt = 0;
        this._debounceTimeout = null;
        this.app = app;
        this.plugin = plugin;
        this.dateRange = this.getDateRange(DateRangeType.THIS_MONTH);
    }
    renderDashboardTab(container, preserveFocus = false) {
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
    getActiveContentEl() {
        if (!this.embeddedContentEl) {
            throw new Error('Transactions renderer has no active container.');
        }
        return this.embeddedContentEl;
    }
    renderTransactionsBody(container, preserveFocus = false) {
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
            const target = e.target;
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
    renderCategoryFilter(container) {
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
        filterMenu.createDiv({ text: 'Filter by', cls: 'expensica-filter-menu-title' });
        this.renderFilterMenuSection(filterMenu, 'Type', (submenu) => this.renderTypeFilterOptions(submenu));
        if (this.plugin.settings.enableAccounts) {
            this.renderFilterMenuSection(filterMenu, 'Accounts', (submenu) => this.renderAccountFilterOptions(submenu));
        }
        this.renderFilterMenuSection(filterMenu, 'Categories', (submenu) => this.renderCategoryFilterOptions(submenu));
        const closeMenu = () => {
            filterContainer.removeClass('is-open');
            filterMenu.addClass('is-hidden');
        };
        filterButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const isHidden = filterMenu.hasClass('is-hidden');
            filterMenu.querySelectorAll('.expensica-filter-menu-parent.is-open').forEach(item => {
                item.removeClass('is-open');
            });
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
    renderFilterMenuSection(filterMenu, label, renderOptions) {
        const menuItem = filterMenu.createDiv('expensica-filter-menu-item expensica-filter-menu-parent');
        menuItem.createSpan({ text: label, cls: 'expensica-filter-menu-value' });
        const menuArrow = menuItem.createSpan('expensica-filter-menu-arrow');
        menuArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        const submenu = menuItem.createDiv('expensica-filter-submenu');
        renderOptions(submenu);
        const openOnlyThisMenu = () => {
            filterMenu.querySelectorAll('.expensica-filter-menu-parent.is-open').forEach(item => {
                if (item !== menuItem) {
                    item.removeClass('is-open');
                }
            });
            menuItem.addClass('is-open');
        };
        const closeMenu = () => {
            menuItem.removeClass('is-open');
        };
        menuItem.addEventListener('mouseenter', () => {
            openOnlyThisMenu();
        });
        menuItem.addEventListener('mouseleave', () => {
            closeMenu();
        });
        menuItem.addEventListener('click', (event) => {
            event.stopPropagation();
            closeMenu();
        });
        menuItem.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });
    }
    renderTypeFilterOptions(container) {
        const optionsHost = container.createDiv('expensica-filter-submenu-options');
        const options = [
            { value: TransactionType.INCOME, label: 'Income', emoji: '💰' },
            { value: TransactionType.EXPENSE, label: 'Expenses', emoji: '💸' },
            { value: TransactionType.INTERNAL, label: 'Internal', emoji: '🔁' }
        ];
        options.forEach(option => {
            const isSelected = this.selectedTypeFilters.includes(option.value);
            const button = optionsHost.createEl('button', {
                cls: `expensica-filter-category-option ${isSelected ? 'is-selected' : ''}`.trim(),
                attr: {
                    type: 'button',
                    'aria-pressed': String(isSelected),
                    'data-filter-type': option.value
                }
            });
            button.createSpan({ text: option.emoji, cls: 'expensica-filter-category-emoji' });
            button.createSpan({ text: option.label, cls: 'expensica-filter-category-name' });
            button.addEventListener('click', (event) => {
                var _a;
                event.stopPropagation();
                this.toggleSelectedType(option.value);
                (_a = button.closest('.expensica-filter-menu-parent')) === null || _a === void 0 ? void 0 : _a.removeClass('is-open');
            });
        });
    }
    renderAccountFilterOptions(container) {
        const optionsHost = container.createDiv('expensica-filter-submenu-options');
        const accounts = this.plugin.getAccounts();
        if (accounts.length === 0) {
            optionsHost.createDiv({ text: 'No accounts', cls: 'expensica-filter-menu-empty' });
            return;
        }
        accounts.forEach(account => {
            const accountReference = this.plugin.normalizeTransactionAccountReference(formatAccountReference(account.type, account.name));
            const isSelected = this.selectedAccountReferences.includes(accountReference);
            const button = optionsHost.createEl('button', {
                cls: `expensica-filter-category-option ${isSelected ? 'is-selected' : ''}`.trim(),
                attr: {
                    type: 'button',
                    'aria-pressed': String(isSelected),
                    'data-account-reference': accountReference
                }
            });
            button.createSpan({ text: getAccountEmoji(account.type), cls: 'expensica-filter-category-emoji' });
            button.createSpan({ text: account.name, cls: 'expensica-filter-category-name' });
            button.addEventListener('click', (event) => {
                var _a;
                event.stopPropagation();
                this.toggleSelectedAccount(accountReference);
                (_a = button.closest('.expensica-filter-menu-parent')) === null || _a === void 0 ? void 0 : _a.removeClass('is-open');
            });
        });
    }
    renderCategoryFilterOptions(container) {
        const optionsHost = container.createDiv('expensica-filter-submenu-options');
        const categories = this.plugin.getCategories();
        if (categories.length === 0) {
            optionsHost.createDiv({
                text: 'No categories',
                cls: 'expensica-filter-menu-empty'
            });
            return;
        }
        categories.forEach(category => {
            const isSelected = this.selectedCategoryIds.includes(category.id);
            const categoryButton = optionsHost.createEl('button', {
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
                var _a;
                event.stopPropagation();
                this.toggleSelectedCategory(category.id);
                (_a = categoryButton.closest('.expensica-filter-menu-parent')) === null || _a === void 0 ? void 0 : _a.removeClass('is-open');
            });
        });
    }
    renderSelectedFilterChips(container) {
        const selectedFiltersContainer = container.createDiv('expensica-selected-filters');
        const hasFilters = this.selectedTypeFilters.length > 0
            || this.selectedAccountReferences.length > 0
            || this.selectedCategoryIds.length > 0;
        selectedFiltersContainer.toggleClass('is-hidden', !hasFilters);
        this.selectedTypeFilters.forEach(type => {
            const label = type === TransactionType.INCOME ? 'Income' : type === TransactionType.EXPENSE ? 'Expenses' : 'Internal';
            this.renderTextFilterChip(selectedFiltersContainer, label, () => this.removeSelectedType(type));
        });
        this.selectedAccountReferences.forEach(accountReference => {
            const account = this.plugin.findAccountByReference(accountReference);
            if (!account) {
                return;
            }
            this.renderTextFilterChip(selectedFiltersContainer, account.name, () => this.removeSelectedAccount(accountReference));
        });
        this.selectedCategoryIds.forEach(categoryId => {
            const category = this.plugin.getCategoryById(categoryId);
            if (!category) {
                return;
            }
            const chip = renderCategoryChip(selectedFiltersContainer, {
                emoji: this.plugin.getCategoryEmoji(category.id),
                text: category.name,
                color: this.plugin.getCategoryColor(category.id, category.name),
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
    renderTextFilterChip(container, text, onRemove) {
        const chip = container.createEl('button', {
            cls: 'expensica-selected-filter-chip expensica-selected-filter-chip-text',
            attr: {
                type: 'button',
                'aria-label': `Remove ${text} filter`
            }
        });
        chip.createSpan({ text });
        const removeIcon = chip.createSpan('expensica-selected-filter-remove');
        removeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        chip.addEventListener('click', onRemove);
    }
    refreshSelectedFilterChips() {
        var _a;
        const searchSection = this.getActiveContentEl().querySelector('.expensica-search-section');
        if (!searchSection) {
            return;
        }
        (_a = searchSection.querySelector('.expensica-selected-filters')) === null || _a === void 0 ? void 0 : _a.remove();
        this.renderSelectedFilterChips(searchSection);
    }
    refreshCategoryFilterOptions() {
        this.getActiveContentEl().querySelectorAll('.expensica-filter-category-option[data-filter-type]').forEach(option => {
            const type = option.getAttribute('data-filter-type');
            const isSelected = !!type && this.selectedTypeFilters.includes(type);
            option.toggleClass('is-selected', isSelected);
            option.setAttribute('aria-pressed', String(isSelected));
        });
        this.getActiveContentEl().querySelectorAll('.expensica-filter-category-option[data-account-reference]').forEach(option => {
            const accountReference = option.getAttribute('data-account-reference');
            const isSelected = !!accountReference && this.selectedAccountReferences.includes(accountReference);
            option.toggleClass('is-selected', isSelected);
            option.setAttribute('aria-pressed', String(isSelected));
        });
        this.getActiveContentEl().querySelectorAll('.expensica-filter-category-option').forEach(option => {
            const categoryId = option.getAttribute('data-category-id');
            if (!categoryId) {
                return;
            }
            const isSelected = this.selectedCategoryIds.includes(categoryId);
            option.toggleClass('is-selected', isSelected);
            option.setAttribute('aria-pressed', String(isSelected));
        });
    }
    toggleSelectedType(type) {
        if (this.selectedTypeFilters.includes(type)) {
            this.selectedTypeFilters = this.selectedTypeFilters.filter(value => value !== type);
        }
        else {
            this.selectedTypeFilters = [...this.selectedTypeFilters, type];
        }
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }
    removeSelectedType(type) {
        this.selectedTypeFilters = this.selectedTypeFilters.filter(value => value !== type);
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }
    toggleSelectedAccount(accountReference) {
        if (this.selectedAccountReferences.includes(accountReference)) {
            this.selectedAccountReferences = this.selectedAccountReferences.filter(value => value !== accountReference);
        }
        else {
            this.selectedAccountReferences = [...this.selectedAccountReferences, accountReference];
        }
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }
    removeSelectedAccount(accountReference) {
        this.selectedAccountReferences = this.selectedAccountReferences.filter(value => value !== accountReference);
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }
    toggleSelectedCategory(categoryId) {
        if (this.selectedCategoryIds.includes(categoryId)) {
            this.selectedCategoryIds = this.selectedCategoryIds.filter(id => id !== categoryId);
        }
        else {
            this.selectedCategoryIds = [...this.selectedCategoryIds, categoryId];
        }
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }
    removeSelectedCategory(categoryId) {
        this.selectedCategoryIds = this.selectedCategoryIds.filter(id => id !== categoryId);
        this.applyFilters(true);
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
        this.refreshSelectedFilterChips();
        this.refreshCategoryFilterOptions();
    }
    formatTransactionStatCurrency(amount) {
        var _a;
        const currencyCode = this.plugin.settings.defaultCurrency;
        const configuredSymbol = ((_a = getCurrencyByCode(currencyCode)) === null || _a === void 0 ? void 0 : _a.symbol) || '$';
        const displaySymbol = configuredSymbol.includes('$') ? '$' : configuredSymbol;
        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode,
                currencyDisplay: 'symbol'
            }).formatToParts(amount)
                .map(part => part.type === 'currency' ? displaySymbol : part.value)
                .join('');
        }
        catch (error) {
            return formatCurrency(amount, currencyCode).replace(/[A-Z]{1,3}(?=\$)/g, '');
        }
    }
    renderTransactionStatsHeader(container) {
        const totals = this.getFilteredTransactionTotals();
        const statChipsContainer = container.createDiv('expensica-transaction-total-chips expensica-transactions-tab-chips');
        statChipsContainer.createEl('span', {
            text: this.filteredTransactions.length > 0 ? `${this.filteredTransactions.length} total` : '',
            cls: `expensica-transaction-count expensica-transaction-count-chip ${this.filteredTransactions.length === 0 ? 'is-hidden' : ''}`.trim()
        });
        this.renderTransactionTotalChip(statChipsContainer, 'spent', totals.expenses);
        this.renderTransactionTotalChip(statChipsContainer, 'income', totals.income);
    }
    renderTransactionTotalChip(container, type, amount) {
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
    syncTransactionTotalChip(container, type, amount) {
        const className = type === 'spent'
            ? 'expensica-transaction-total-spent'
            : 'expensica-transaction-total-income';
        const existingChip = container.querySelector(`.${className}`);
        existingChip === null || existingChip === void 0 ? void 0 : existingChip.remove();
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
    applySharedDateRangeStateValues(state) {
        const startDate = parseLocalDate(state.startDate);
        const endDate = parseLocalDate(state.endDate);
        this.dateRange = this.createDateRangeFromState(state.type, startDate, endDate);
        this.customStartDate = state.customStartDate ? parseLocalDate(state.customStartDate) : null;
        this.customEndDate = state.customEndDate ? parseLocalDate(state.customEndDate) : null;
        this.dateRangeUpdatedAt = state.updatedAt;
    }
    applySharedDateRangeState(state) {
        return __awaiter(this, void 0, void 0, function* () {
            if (state.updatedAt < this.dateRangeUpdatedAt) {
                return;
            }
            this.applySharedDateRangeStateValues(state);
            yield this.loadTransactionsData(true);
            this.persistTransactionsState();
            if (this.embeddedContentEl) {
                this.refreshTransactionsListOnly();
            }
        });
    }
    applyCategoryFilter(categoryId) {
        this.selectedCategoryIds = this.plugin.getCategoryById(categoryId) ? [categoryId] : [];
        this.currentPage = 1;
        this.applyFilters(true);
        this.persistTransactionsState();
        if (this.embeddedContentEl) {
            this.refreshTransactionsListOnly();
            this.refreshSelectedFilterChips();
            this.refreshCategoryFilterOptions();
        }
    }
    createDateRangeFromState(type, startDate, endDate) {
        if (type === DateRangeType.CUSTOM && startDate && endDate) {
            return this.getDateRange(DateRangeType.CUSTOM, startDate, endDate);
        }
        return this.getDateRange(type);
    }
    loadTransactionsData(resetPage = false) {
        return __awaiter(this, void 0, void 0, function* () {
            // Load all transactions
            this.transactions = this.plugin.getAllTransactions();
            // Sort transactions by date and time (latest first)
            this.transactions = sortTransactionsByDateTimeDesc(this.transactions);
            this.applyFilters(resetPage);
        });
    }
    applyFilters(resetPage = false) {
        const validTransactionIds = new Set(this.transactions.map(transaction => transaction.id));
        this.selectedTransactionIds.forEach(id => {
            if (!validTransactionIds.has(id)) {
                this.selectedTransactionIds.delete(id);
            }
        });
        this.selectedTypeFilters = this.selectedTypeFilters.filter(type => Object.values(TransactionType).includes(type));
        if (!this.plugin.settings.enableAccounts) {
            this.selectedAccountReferences = [];
        }
        else {
            const validAccountReferences = new Set(this.plugin.getAccounts().map(account => this.plugin.normalizeTransactionAccountReference(formatAccountReference(account.type, account.name))));
            this.selectedAccountReferences = this.selectedAccountReferences.filter(accountReference => validAccountReferences.has(accountReference));
        }
        this.selectedCategoryIds = this.selectedCategoryIds.filter(categoryId => !!this.plugin.getCategoryById(categoryId));
        // Filter transactions based on the date range
        this.filteredTransactions = this.transactions.filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
            return transactionDate >= this.dateRange.startDate &&
                transactionDate <= this.dateRange.endDate;
        });
        // Apply search filter if there's a search query
        if (this.selectedCategoryIds.length > 0) {
            this.filteredTransactions = this.filteredTransactions.filter(transaction => this.selectedCategoryIds.includes(transaction.category));
        }
        if (this.selectedTypeFilters.length > 0) {
            this.filteredTransactions = this.filteredTransactions.filter(transaction => this.selectedTypeFilters.includes(transaction.type));
        }
        if (this.selectedAccountReferences.length > 0) {
            this.filteredTransactions = this.filteredTransactions.filter(transaction => {
                const accountReferences = new Set();
                accountReferences.add(this.plugin.normalizeTransactionAccountReference(transaction.account));
                if (transaction.fromAccount) {
                    accountReferences.add(this.plugin.normalizeTransactionAccountReference(transaction.fromAccount));
                }
                if (transaction.toAccount) {
                    accountReferences.add(this.plugin.normalizeTransactionAccountReference(transaction.toAccount));
                }
                return this.selectedAccountReferences.some(reference => accountReferences.has(reference));
            });
        }
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            this.filteredTransactions = this.filteredTransactions.filter(transaction => {
                var _a, _b, _c, _d, _e, _f, _g, _h;
                const category = this.plugin.getCategoryById(transaction.category);
                const typeLabel = transaction.type === TransactionType.INCOME
                    ? 'income'
                    : transaction.type === TransactionType.EXPENSE
                        ? 'expenses'
                        : 'internal';
                const accountNames = [
                    transaction.account ? (_b = (_a = this.plugin.findAccountByReference(transaction.account)) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '' : this.plugin.getDefaultAccount().name,
                    transaction.fromAccount ? (_d = (_c = this.plugin.findAccountByReference(transaction.fromAccount)) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : '' : '',
                    transaction.toAccount ? (_f = (_e = this.plugin.findAccountByReference(transaction.toAccount)) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : '' : ''
                ];
                const searchableValues = [
                    transaction.description,
                    transaction.category,
                    (_g = category === null || category === void 0 ? void 0 : category.name) !== null && _g !== void 0 ? _g : '',
                    category ? this.plugin.getCategoryEmoji(category.id) : '',
                    (_h = transaction.notes) !== null && _h !== void 0 ? _h : '',
                    typeLabel,
                    ...accountNames
                ];
                return searchableValues.some(value => value.toLowerCase().includes(query));
            });
        }
        // Update pagination
        this.totalPages = Math.max(1, Math.ceil(this.filteredTransactions.length / this.pageSize));
        if (resetPage) {
            this.currentPage = 1;
        }
        else if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
    }
    getFilteredTransactionTotals() {
        return this.filteredTransactions.reduce((totals, transaction) => {
            if (transaction.type === TransactionType.INCOME) {
                totals.income += transaction.amount;
            }
            else if (transaction.type === TransactionType.EXPENSE) {
                totals.expenses += transaction.amount;
            }
            return totals;
        }, { income: 0, expenses: 0 });
    }
    renderTransactionsList(container) {
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
        const runningBalances = getRunningBalanceByTransactionIdForAccount(this.plugin, this.plugin.normalizeTransactionAccountReference(undefined), this.transactions);
        this.renderTransactionsToContainer(transactionsContainer, pageTransactions, runningBalances);
        this.renderBulkSelectionFooter(transactionsSection);
    }
    renderTransactionGroupTitle(container, text, level) {
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
    getTransactionMonthKey(transaction) {
        const date = parseLocalDate(transaction.date);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    getTransactionDayKey(transaction) {
        const date = parseLocalDate(transaction.date);
        return formatDate(date);
    }
    getTransactionMonthLabel(transaction) {
        return parseLocalDate(transaction.date).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });
    }
    getTransactionDayLabel(transaction) {
        return parseLocalDate(transaction.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }
    renderTransactionCardWithEditHandler(container, transaction, runningBalanceLabel, secondaryRunningBalanceLabel) {
        renderTransactionCard(container, {
            plugin: this.plugin,
            transaction,
            runningBalanceLabel,
            secondaryRunningBalanceLabel,
            onEdit: (transaction) => {
                const modal = new TransactionModal(this.app, this.plugin, this, transaction, transaction.type);
                modal.open();
            },
            onCategoryChange: (transaction, categoryId) => __awaiter(this, void 0, void 0, function* () {
                yield this.updateTransaction(Object.assign(Object.assign({}, transaction), { category: categoryId }));
            }),
            selectable: true,
            selected: this.selectedTransactionIds.has(transaction.id),
            onSelectionToggle: (transaction, selected) => {
                if (selected) {
                    this.selectedTransactionIds.add(transaction.id);
                }
                else {
                    this.selectedTransactionIds.delete(transaction.id);
                }
                this.maybeShowMixedTransactionTypeSelectionNotice();
                this.syncBulkSelectionFooter();
            }
        });
    }
    renderBulkSelectionFooter(container) {
        var _a;
        (_a = container.querySelector('.expensica-transaction-bulk-footer')) === null || _a === void 0 ? void 0 : _a.remove();
        const selectedTransactions = this.getSelectedTransactions();
        if (selectedTransactions.length === 0) {
            return;
        }
        const footer = container.createDiv('expensica-transaction-bulk-footer');
        const leftGroup = footer.createDiv('expensica-transaction-bulk-group expensica-transaction-bulk-group-left');
        const clearButton = leftGroup.createEl('button', {
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary expensica-transaction-bulk-icon-button expensica-transaction-bulk-clear',
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
        leftGroup.createSpan({
            text: `${selectedTransactions.length} selected`,
            cls: 'expensica-transaction-bulk-count'
        });
        const visibleTransactions = this.getVisiblePageTransactions();
        const allVisibleSelected = visibleTransactions.length > 0
            && visibleTransactions.every(transaction => this.selectedTransactionIds.has(transaction.id));
        const selectAllButton = leftGroup.createEl('button', {
            text: 'Select All',
            cls: 'expensica-standard-button expensica-transaction-bulk-select-all-btn',
            attr: {
                type: 'button',
                'aria-label': allVisibleSelected ? 'All visible transactions selected' : 'Select all visible transactions'
            }
        });
        selectAllButton.disabled = allVisibleSelected;
        if (allVisibleSelected) {
            selectAllButton.title = 'All visible transactions are already selected.';
        }
        else {
            selectAllButton.addEventListener('click', () => {
                visibleTransactions.forEach(transaction => this.selectedTransactionIds.add(transaction.id));
                this.maybeShowMixedTransactionTypeSelectionNotice();
                this.syncVisibleTransactionSelectionState();
                this.syncBulkSelectionFooter();
            });
        }
        const selectedTypes = new Set(selectedTransactions.map(transaction => transaction.type));
        const hasMixedTypes = selectedTypes.size > 1;
        const hasInternalOnly = selectedTypes.size === 1 && selectedTypes.has(TransactionType.INTERNAL);
        const actionsGroup = footer.createDiv('expensica-transaction-bulk-group expensica-transaction-bulk-group-right');
        const categoryButton = actionsGroup.createEl('button', {
            text: 'Category',
            cls: 'expensica-standard-button expensica-transaction-bulk-category-btn',
            attr: {
                type: 'button',
                'aria-label': hasMixedTypes ? 'Category unavailable for mixed transaction types' : 'Change category for selected transactions'
            }
        });
        if (hasMixedTypes || hasInternalOnly) {
            categoryButton.disabled = true;
            categoryButton.title = hasInternalOnly
                ? 'Internal transaction category cannot be changed.'
                : 'Select only income or only expense transactions to bulk change category.';
        }
        else {
            categoryButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const categoryType = selectedTransactions[0].type === TransactionType.INCOME
                    ? CategoryType.INCOME
                    : CategoryType.EXPENSE;
                showTransactionBulkCategoryMenu(categoryButton, this.plugin, categoryType, (categoryId) => __awaiter(this, void 0, void 0, function* () {
                    yield this.bulkUpdateSelectedTransactionsCategory(categoryId);
                }));
            });
        }
        const deleteButton = actionsGroup.createEl('button', {
            cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid expensica-transaction-bulk-icon-button expensica-transaction-bulk-delete',
            attr: {
                type: 'button',
                'aria-label': 'Delete selected transactions',
                title: 'Delete selected transactions'
            }
        });
        deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        deleteButton.addEventListener('click', () => {
            void this.deleteSelectedTransactions();
        });
    }
    getSelectedTransactions() {
        return this.transactions.filter(transaction => this.selectedTransactionIds.has(transaction.id));
    }
    getVisiblePageTransactions() {
        const startIdx = (this.currentPage - 1) * this.pageSize;
        const endIdx = Math.min(startIdx + this.pageSize, this.filteredTransactions.length);
        return this.filteredTransactions.slice(startIdx, endIdx);
    }
    clearSelectedTransactions() {
        this.selectedTransactionIds.clear();
        this.syncVisibleTransactionSelectionState();
        this.syncBulkSelectionFooter();
    }
    maybeShowMixedTransactionTypeSelectionNotice() {
        const selectedTransactions = this.getSelectedTransactions();
        const hasMixedTypes = new Set(selectedTransactions.map(transaction => transaction.type)).size > 1;
        if (hasMixedTypes) {
            showExpensicaNotice('You can only change one transaction type at a time: Income or Expenses.');
        }
    }
    bulkUpdateSelectedTransactionsCategory(categoryId) {
        return __awaiter(this, void 0, void 0, function* () {
            const selectedTransactions = this.getSelectedTransactions();
            if (selectedTransactions.length === 0) {
                return;
            }
            yield Promise.all(selectedTransactions.map(transaction => this.plugin.updateTransaction(Object.assign(Object.assign({}, transaction), { category: categoryId }), this)));
            yield this.loadTransactionsData(false);
            this.selectedTransactionIds.clear();
            this.persistTransactionsState();
            this.refreshTransactionsListOnly();
            showExpensicaNotice('Transactions updated successfully');
        });
    }
    deleteSelectedTransactions() {
        return __awaiter(this, void 0, void 0, function* () {
            const selectedTransactions = this.getSelectedTransactions();
            if (selectedTransactions.length === 0) {
                return;
            }
            new ConfirmationModal(this.app, 'Delete Transactions?', `Are you sure you want to delete ${selectedTransactions.length} selected transactions? This action cannot be undone.`, (confirmed) => __awaiter(this, void 0, void 0, function* () {
                if (!confirmed) {
                    return;
                }
                yield Promise.all(selectedTransactions.map(transaction => this.plugin.deleteTransaction(transaction.id, this)));
                this.selectedTransactionIds.clear();
                yield this.loadTransactionsData(false);
                this.persistTransactionsState();
                this.refreshTransactionsListOnly();
                showExpensicaNotice('Transactions deleted successfully');
            })).open();
        });
    }
    syncBulkSelectionFooter() {
        const container = this.getActiveContentEl().querySelector('.expensica-transactions-section');
        if (!container) {
            return;
        }
        this.renderBulkSelectionFooter(container);
    }
    syncVisibleTransactionSelectionState() {
        const container = this.getActiveContentEl();
        container.querySelectorAll('.expensica-transaction[data-transaction-id]').forEach(card => {
            const transactionId = card.getAttribute('data-transaction-id');
            const isSelected = !!transactionId && this.selectedTransactionIds.has(transactionId);
            card.toggleClass('is-selected', isSelected);
            const selector = card.querySelector('.expensica-transaction-selector');
            selector === null || selector === void 0 ? void 0 : selector.toggleClass('is-selected', isSelected);
            selector === null || selector === void 0 ? void 0 : selector.setAttribute('aria-pressed', String(isSelected));
        });
    }
    getPaginationWindow() {
        const visiblePageCount = Math.min(3, this.totalPages);
        const maxStartPage = this.totalPages - visiblePageCount + 1;
        const startPage = Math.max(1, Math.min(this.currentPage - 1, maxStartPage));
        return Array.from({ length: visiblePageCount }, (_, index) => startPage + index);
    }
    setCurrentPage(page, scrollToTop = false) {
        const nextPage = Math.max(1, Math.min(page, this.totalPages));
        if (nextPage === this.currentPage)
            return;
        this.currentPage = nextPage;
        if (scrollToTop) {
            this.scrollTop = 0;
            this.app.workspace.requestSaveLayout();
            this.refreshTransactionsListOnly(false);
            return;
        }
        this.persistTransactionsState();
        this.refreshTransactionsListOnly();
    }
    renderPaginationButton(container, label, ariaLabel, isDisabled, onClick, extraClass = '') {
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
    renderPageSizeSelector(container) {
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
    renderPagination(container, placement) {
        if (this.filteredTransactions.length === 0)
            return;
        // Check for existing pagination in this placement and remove it
        const existingPagination = container.querySelector(`.expensica-pagination-${placement}`);
        if (existingPagination) {
            existingPagination.remove();
        }
        const paginationSection = container.createDiv(`expensica-pagination expensica-pagination-${placement}`);
        // Navigation buttons container
        const navigationContainer = paginationSection.createDiv('expensica-pagination-nav');
        // First page button
        this.renderPaginationButton(navigationContainer, '1', 'First page', this.currentPage === 1, () => this.setCurrentPage(1, placement === 'bottom'));
        // Previous page button
        this.renderPaginationButton(navigationContainer, '<', 'Previous page', this.currentPage === 1, () => this.setCurrentPage(this.currentPage - 1, placement === 'bottom'));
        // Sliding page buttons
        this.getPaginationWindow().forEach(page => {
            this.renderPaginationButton(navigationContainer, String(page), `Page ${page} of ${this.totalPages}`, false, () => this.setCurrentPage(page, placement === 'bottom'), page === this.currentPage ? 'active' : '');
        });
        // Next page button
        this.renderPaginationButton(navigationContainer, '>', 'Next page', this.currentPage === this.totalPages, () => this.setCurrentPage(this.currentPage + 1, placement === 'bottom'));
        // Last page button
        this.renderPaginationButton(navigationContainer, String(this.totalPages), 'Last page', this.currentPage === this.totalPages, () => this.setCurrentPage(this.totalPages, placement === 'bottom'));
        // Items per page selector container
        const itemsPerPageContainer = paginationSection.createDiv('expensica-items-per-page');
        itemsPerPageContainer.createEl('span', { text: 'Per Page:' });
        this.renderPageSizeSelector(itemsPerPageContainer);
    }
    refreshTransactionsListOnly(preserveScroll = true) {
        var _a;
        const container = this.getActiveContentEl();
        if (preserveScroll) {
            this.rememberScrollPosition();
        }
        container.addClass('expensica-suppress-motion');
        const countEl = container.querySelector('.expensica-transaction-count-chip');
        if (countEl) {
            countEl.textContent = this.filteredTransactions.length > 0 ? `${this.filteredTransactions.length} total` : '';
            countEl.classList.toggle('is-hidden', this.filteredTransactions.length === 0);
        }
        const totals = this.getFilteredTransactionTotals();
        const titleContainer = container.querySelector('.expensica-transaction-total-chips');
        if (titleContainer) {
            this.syncTransactionTotalChip(titleContainer, 'spent', totals.expenses);
            this.syncTransactionTotalChip(titleContainer, 'income', totals.income);
        }
        (_a = container.querySelector('.expensica-transactions-section')) === null || _a === void 0 ? void 0 : _a.remove();
        container.querySelectorAll('.expensica-pagination').forEach(section => section.remove());
        this.renderPagination(container, 'top');
        this.renderTransactionsList(container);
        this.renderPagination(container, 'bottom');
        this.restoreScrollPosition();
    }
    addTransaction(transaction) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.plugin.addTransaction(transaction, this);
            // Refresh transactions without resetting the user's current filter/page context.
            yield this.loadTransactionsData(false);
            this.persistTransactionsState();
            this.refreshTransactionsListOnly();
        });
    }
    updateTransaction(transaction) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.plugin.updateTransaction(transaction, this);
            // Refresh transactions without resetting the user's current filter/page context.
            yield this.loadTransactionsData(false);
            this.persistTransactionsState();
            this.refreshTransactionsListOnly();
        });
    }
    deleteTransaction(id, onDeleted, onConfirmDelete) {
        return __awaiter(this, void 0, void 0, function* () {
            const transaction = this.transactions.find(t => t.id === id);
            if (!transaction)
                return;
            new ConfirmationModal(this.app, 'Delete Transaction?', `Are you sure you want to delete this ${transaction.type.toLowerCase()} transaction? This action cannot be undone.`, (confirmed) => __awaiter(this, void 0, void 0, function* () {
                if (confirmed) {
                    onConfirmDelete === null || onConfirmDelete === void 0 ? void 0 : onConfirmDelete();
                    yield this.plugin.deleteTransaction(id, this);
                    // Refresh transactions without resetting the user's current filter/page context.
                    yield this.loadTransactionsData(false);
                    this.persistTransactionsState();
                    this.refreshTransactionsListOnly();
                    showExpensicaNotice('Transaction deleted successfully');
                    onDeleted === null || onDeleted === void 0 ? void 0 : onDeleted();
                }
            })).open();
        });
    }
    // Helper method to get a date range based on type
    getDateRange(type, startDate, endDate) {
        const now = new Date();
        let start;
        let end;
        let label;
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
                    const formatOptions = {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    };
                    const startStr = start.toLocaleDateString(undefined, formatOptions);
                    const endStr = end.toLocaleDateString(undefined, formatOptions);
                    label = `${startStr} - ${endStr}`;
                }
                else {
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
    getAllTimeDateRangeBounds() {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        return this.plugin.getAllTransactions().reduce((bounds, transaction) => {
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
        }, { start: todayStart, end: todayEnd });
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
                const searchInput = this.getActiveContentEl().querySelector('#expensica-search-input');
                if (searchInput) {
                    searchInput.focus();
                }
            }
            this._debounceTimeout = null;
        }, 300);
    }
    renderTransactionsToContainer(container, transactions, runningBalances = getRunningBalanceByTransactionIdForAccount(this.plugin, this.selectedAccountReferences.length === 1
        ? this.selectedAccountReferences[0]
        : this.plugin.normalizeTransactionAccountReference(undefined), this.transactions)) {
        let currentMonthKey = '';
        let currentDayKey = '';
        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const selectedAccountReference = this.selectedAccountReferences.length === 1
            ? this.selectedAccountReferences[0]
            : defaultAccountReference;
        const internalBalanceMaps = new Map();
        const ensureBalanceMap = (accountReference) => {
            const existing = internalBalanceMaps.get(accountReference);
            if (existing) {
                return existing;
            }
            const balances = accountReference === selectedAccountReference
                ? runningBalances
                : getRunningBalanceByTransactionIdForAccount(this.plugin, accountReference, this.transactions);
            internalBalanceMaps.set(accountReference, balances);
            return balances;
        };
        transactions.forEach(transaction => {
            var _a, _b, _c;
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
            const transactionAccountReference = this.plugin.settings.enableAccounts
                ? this.plugin.normalizeTransactionAccountReference(transaction.account)
                : defaultAccountReference;
            const transactionBalances = ensureBalanceMap(transactionAccountReference);
            let runningBalanceLabel = formatRunningBalanceLabel(this.plugin, (_a = transactionBalances[transaction.id]) !== null && _a !== void 0 ? _a : 0);
            let secondaryRunningBalanceLabel;
            if (this.plugin.settings.enableAccounts && transaction.type === TransactionType.INTERNAL) {
                const fromAccountReference = this.plugin.normalizeTransactionAccountReference(transaction.fromAccount);
                const toAccountReference = this.plugin.normalizeTransactionAccountReference(transaction.toAccount);
                const fromBalances = ensureBalanceMap(fromAccountReference);
                const toBalances = ensureBalanceMap(toAccountReference);
                runningBalanceLabel = formatRunningBalanceLabel(this.plugin, (_b = fromBalances[transaction.id]) !== null && _b !== void 0 ? _b : 0, fromAccountReference);
                secondaryRunningBalanceLabel = formatRunningBalanceLabel(this.plugin, (_c = toBalances[transaction.id]) !== null && _c !== void 0 ? _c : 0, toAccountReference);
            }
            this.renderTransactionCardWithEditHandler(container, transaction, runningBalanceLabel, secondaryRunningBalanceLabel);
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNhY3Rpb25zLXZpZXcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ0cmFuc2FjdGlvbnMtdmlldy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQ0EsT0FBTyxFQUNILFdBQVcsRUFDWCxZQUFZLEVBRVosZUFBZSxFQUNmLGNBQWMsRUFDZCxVQUFVLEVBQ1Ysc0JBQXNCLEVBQ3RCLGVBQWUsRUFFZixjQUFjLEVBQ2QsOEJBQThCLEVBQzlCLGlCQUFpQixFQUNwQixNQUFNLFVBQVUsQ0FBQztBQUdsQixPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxFQUFhLE1BQU0sa0JBQWtCLENBQUM7QUFDOUUsT0FBTyxFQUFFLGlCQUFpQixFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDekQsT0FBTyxFQUFFLG1CQUFtQixFQUFFLE1BQU0sVUFBVSxDQUFDO0FBQy9DLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSwrQkFBK0IsRUFBRSxNQUFNLG9CQUFvQixDQUFDO0FBQzVGLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLGlCQUFpQixDQUFDO0FBRXJELFNBQVMsMkJBQTJCLENBQUMsTUFBdUIsRUFBRSxXQUF3QixFQUFFLGdCQUF3QjtJQUM1RyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsc0JBQXNCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztJQUNoRSxNQUFNLFFBQVEsR0FBRyxDQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxJQUFJLE1BQUssV0FBVyxDQUFDLE1BQU0sQ0FBQztJQUV0RCxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDLFFBQVEsRUFBRTtRQUMvQyxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsb0NBQW9DLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDeEgsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFD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QUMsb0NBQW9DLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDO2dCQUN2RyxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsb0NBQW9DLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNuRyxNQUFNLFlBQVksR0FBRyxnQkFBZ0IsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO2dCQUM1RCxNQUFNLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO2dCQUN4RCxtQkFBbUIsR0FBRyx5QkFBeUIsQ0FDM0MsSUFBSSxDQUFDLE1BQU0sRUFDWCxNQUFBLFlBQVksQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLG1DQUFJLENBQUMsRUFDakMsb0JBQW9CLENBQ3ZCLENBQUM7Z0JBQ0YsNEJBQTRCLEdBQUcseUJBQXlCLENBQ3BELElBQUksQ0FBQyxNQUFNLEVBQ1gsTUFBQSxVQUFVLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxtQ0FBSSxDQUFDLEVBQy9CLGtCQUFrQixDQUNyQixDQUFDO2FBQ0w7WUFFRCxJQUFJLENBQUMsb0NBQW9DLENBQ3JDLFNBQVMsRUFDVCxXQUFXLEVBQ1gsbUJBQW1CLEVBQ25CLDRCQUE0QixDQUMvQixDQUFDO1FBQ04sQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0NBR0oiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQge1xuICAgIEFjY291bnRUeXBlLFxuICAgIENhdGVnb3J5VHlwZSxcbiAgICBUcmFuc2FjdGlvbixcbiAgICBUcmFuc2FjdGlvblR5cGUsXG4gICAgZm9ybWF0Q3VycmVuY3ksXG4gICAgZm9ybWF0RGF0ZSxcbiAgICBmb3JtYXRBY2NvdW50UmVmZXJlbmNlLFxuICAgIGdldEFjY291bnRFbW9qaSxcbiAgICBnZXRBY2NvdW50VHlwZUxhYmVsLFxuICAgIHBhcnNlTG9jYWxEYXRlLFxuICAgIHNvcnRUcmFuc2FjdGlvbnNCeURhdGVUaW1lRGVzYyxcbiAgICBnZXRDdXJyZW5jeUJ5Q29kZVxufSBmcm9tICcuL21vZGVscyc7XG5pbXBvcnQgRXhwZW5zaWNhUGx1Z2luIGZyb20gJy4uL21haW4nO1xuaW1wb3J0IHR5cGUgeyBTaGFyZWREYXRlUmFuZ2VTdGF0ZSB9IGZyb20gJy4uL21haW4nO1xuaW1wb3J0IHsgVHJhbnNhY3Rpb25Nb2RhbCwgRGF0ZVJhbmdlVHlwZSwgRGF0ZVJhbmdlIH0gZnJvbSAnLi9kYXNoYm9hcmQtdmlldyc7XG5pbXBvcnQgeyBDb25maXJtYXRpb25Nb2RhbCB9IGZyb20gJy4vY29uZmlybWF0aW9uLW1vZGFsJztcbmltcG9ydCB7IHNob3dFeHBlbnNpY2FOb3RpY2UgfSBmcm9tICcuL25vdGljZSc7XG5pbXBvcnQgeyByZW5kZXJUcmFuc2FjdGlvbkNhcmQsIHNob3dUcmFuc2FjdGlvbkJ1bGtDYXRlZ29yeU1lbnUgfSBmcm9tICcuL3RyYW5zYWN0aW9uLWNhcmQnO1xuaW1wb3J0IHsgcmVuZGVyQ2F0ZWdvcnlDaGlwIH0gZnJvbSAnLi9jYXRlZ29yeS1jaGlwJztcblxuZnVuY3Rpb24gZ2V0QWNjb3VudFRyYW5zYWN0aW9uQW1vdW50KHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luLCB0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24sIGFjY291bnRSZWZlcmVuY2U6IHN0cmluZyk6IG51bWJlciB7XG4gICAgY29uc3QgYWNjb3VudCA9IHBsdWdpbi5maW5kQWNjb3VudEJ5UmVmZXJlbmNlKGFjY291bnRSZWZlcmVuY2UpO1xuICAgIGNvbnN0IGlzQ3JlZGl0ID0gYWNjb3VudD8udHlwZSA9PT0gQWNjb3VudFR5cGUuQ1JFRElUO1xuXG4gICAgaWYgKHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTlRFUk5BTCkge1xuICAgICAgICBjb25zdCBmcm9tQWNjb3VudCA9IHRyYW5zYWN0aW9uLmZyb21BY2NvdW50ID8gcGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi5mcm9tQWNjb3VudCkgOiAnJztcbiAgICAgICAgY29uc3QgdG9BY2NvdW50ID0gdHJhbnNhY3Rpb24udG9BY2NvdW50ID8gcGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi50b0FjY291bnQpIDogJyc7XG4gICAgICAgIGlmIChmcm9tQWNjb3VudCA9PT0gYWNjb3VudFJlZmVyZW5jZSkge1xuICAgICAgICAgICAgcmV0dXJuIGlzQ3JlZGl0ID8gdHJhbnNhY3Rpb24uYW1vdW50IDogLXRyYW5zYWN0aW9uLmFtb3VudDtcbiAgICAgICAgfVxuICAgICAgICBpZiAodG9BY2NvdW50ID09PSBhY2NvdW50UmVmZXJlbmNlKSB7XG4gICAgICAgICAgICByZXR1cm4gaXNDcmVkaXQgPyAtdHJhbnNhY3Rpb24uYW1vdW50IDogdHJhbnNhY3Rpb24uYW1vdW50O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uQWNjb3VudCA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0cmFuc2FjdGlvbiwgJ2FjY291bnQnKVxuICAgICAgICA/IHBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UodHJhbnNhY3Rpb24uYWNjb3VudClcbiAgICAgICAgOiBwbHVnaW4ubm9ybWFsaXplVHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlKHVuZGVmaW5lZCk7XG5cbiAgICBpZiAodHJhbnNhY3Rpb25BY2NvdW50ICE9PSBhY2NvdW50UmVmZXJlbmNlKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGlmICh0cmFuc2FjdGlvbi50eXBlID09PSBUcmFuc2FjdGlvblR5cGUuSU5DT01FKSB7XG4gICAgICAgIHJldHVybiBpc0NyZWRpdCA/IC10cmFuc2FjdGlvbi5hbW91bnQgOiB0cmFuc2FjdGlvbi5hbW91bnQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFXG4gICAgICAgID8gKGlzQ3JlZGl0ID8gdHJhbnNhY3Rpb24uYW1vdW50IDogLXRyYW5zYWN0aW9uLmFtb3VudClcbiAgICAgICAgOiAwO1xufVxuXG5mdW5jdGlvbiBnZXRSdW5uaW5nQmFsYW5jZUJ5VHJhbnNhY3Rpb25JZEZvckFjY291bnQoXG4gICAgcGx1Z2luOiBFeHBlbnNpY2FQbHVnaW4sXG4gICAgYWNjb3VudFJlZmVyZW5jZTogc3RyaW5nLFxuICAgIHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXVxuKTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiB7XG4gICAgbGV0IHJ1bm5pbmdCYWxhbmNlID0gMDtcbiAgICBjb25zdCBub3JtYWxpemVCYWxhbmNlVmFsdWUgPSAodmFsdWU6IG51bWJlcikgPT4gTWF0aC5hYnModmFsdWUpIDwgMC4wMDAwMDEgPyAwIDogdmFsdWU7XG5cbiAgICByZXR1cm4gc29ydFRyYW5zYWN0aW9uc0J5RGF0ZVRpbWVEZXNjKHRyYW5zYWN0aW9ucylcbiAgICAgICAgLnJldmVyc2UoKVxuICAgICAgICAucmVkdWNlKChiYWxhbmNlcywgdHJhbnNhY3Rpb24pID0+IHtcbiAgICAgICAgICAgIHJ1bm5pbmdCYWxhbmNlID0gbm9ybWFsaXplQmFsYW5jZVZhbHVlKHJ1bm5pbmdCYWxhbmNlICsgZ2V0QWNjb3VudFRyYW5zYWN0aW9uQW1vdW50KHBsdWdpbiwgdHJhbnNhY3Rpb24sIGFjY291bnRSZWZlcmVuY2UpKTtcbiAgICAgICAgICAgIGJhbGFuY2VzW3RyYW5zYWN0aW9uLmlkXSA9IHJ1bm5pbmdCYWxhbmNlO1xuICAgICAgICAgICAgcmV0dXJuIGJhbGFuY2VzO1xuICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+KTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UnVubmluZ0JhbGFuY2VMYWJlbChwbHVnaW46IEV4cGVuc2ljYVBsdWdpbiwgYmFsYW5jZTogbnVtYmVyLCBhY2NvdW50UmVmZXJlbmNlPzogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjdXJyZW5jeSA9IGdldEN1cnJlbmN5QnlDb2RlKHBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q3VycmVuY3kpIHx8IGdldEN1cnJlbmN5QnlDb2RlKCdVU0QnKTtcbiAgICBjb25zdCBjb2RlID0gY3VycmVuY3k/LmNvZGUgfHwgJ1VTRCc7XG4gICAgY29uc3QgZmFsbGJhY2tTeW1ib2wgPSBjdXJyZW5jeT8uc3ltYm9sIHx8ICckJztcbiAgICBsZXQgc3ltYm9sID0gZmFsbGJhY2tTeW1ib2w7XG5cbiAgICB0cnkge1xuICAgICAgICBzeW1ib2wgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQoJ2VuLVVTJywge1xuICAgICAgICAgICAgc3R5bGU6ICdjdXJyZW5jeScsXG4gICAgICAgICAgICBjdXJyZW5jeTogY29kZSxcbiAgICAgICAgICAgIGN1cnJlbmN5RGlzcGxheTogJ25hcnJvd1N5bWJvbCdcbiAgICAgICAgfSkuZm9ybWF0VG9QYXJ0cygwKS5maW5kKHBhcnQgPT4gcGFydC50eXBlID09PSAnY3VycmVuY3knKT8udmFsdWUgfHwgZmFsbGJhY2tTeW1ib2w7XG4gICAgfSBjYXRjaCB7XG4gICAgICAgIHN5bWJvbCA9IGZhbGxiYWNrU3ltYm9sO1xuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTeW1ib2wgPSBzeW1ib2wucmVwbGFjZSgvW0EtWmEtel0rL2csICcnKS50cmltKCkgfHwgJyQnO1xuICAgIGNvbnN0IGFic29sdXRlQW1vdW50ID0gTWF0aC5hYnMoYmFsYW5jZSk7XG4gICAgY29uc3QgZnJhY3Rpb25EaWdpdHMgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQoJ2VuLVVTJywge1xuICAgICAgICBtaW5pbXVtRnJhY3Rpb25EaWdpdHM6IDIsXG4gICAgICAgIG1heGltdW1GcmFjdGlvbkRpZ2l0czogMlxuICAgIH0pLmZvcm1hdChhYnNvbHV0ZUFtb3VudCk7XG4gICAgY29uc3Qgc2lnbiA9IGJhbGFuY2UgPCAwID8gJy0nIDogJyc7XG4gICAgY29uc3QgYW1vdW50ID0gYCR7c2lnbn0ke25vcm1hbGl6ZWRTeW1ib2x9JHtmcmFjdGlvbkRpZ2l0c31gO1xuICAgIGlmICghYWNjb3VudFJlZmVyZW5jZSkge1xuICAgICAgICByZXR1cm4gYW1vdW50O1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBwbHVnaW4uZ2V0VHJhbnNhY3Rpb25BY2NvdW50RGlzcGxheShhY2NvdW50UmVmZXJlbmNlKTtcbiAgICByZXR1cm4gYCR7YWNjb3VudC5uYW1lfTogJHthbW91bnR9YDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBUcmFuc2FjdGlvblZpZXcge1xuICAgIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luO1xuICAgIGFkZFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uOiBUcmFuc2FjdGlvbik6IFByb21pc2U8dm9pZD47XG4gICAgdXBkYXRlVHJhbnNhY3Rpb24odHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKTogUHJvbWlzZTx2b2lkPjtcbiAgICBkZWxldGVUcmFuc2FjdGlvbihpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGNsYXNzIEV4cGVuc2ljYVRyYW5zYWN0aW9uc1ZpZXcgaW1wbGVtZW50cyBUcmFuc2FjdGlvblZpZXcge1xuICAgIGFwcDogQXBwO1xuICAgIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luO1xuICAgIHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXSA9IFtdO1xuICAgIGZpbHRlcmVkVHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdID0gW107XG4gICAgc2VhcmNoUXVlcnk6IHN0cmluZyA9ICcnO1xuICAgIHNlbGVjdGVkVHlwZUZpbHRlcnM6IFRyYW5zYWN0aW9uVHlwZVtdID0gW107XG4gICAgc2VsZWN0ZWRBY2NvdW50UmVmZXJlbmNlczogc3RyaW5nW10gPSBbXTtcbiAgICBzZWxlY3RlZENhdGVnb3J5SWRzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGlucHV0Rm9jdXNlZDogYm9vbGVhbiA9IGZhbHNlO1xuICAgIFxuICAgIC8vIFBhZ2luYXRpb25cbiAgICBjdXJyZW50UGFnZTogbnVtYmVyID0gMTtcbiAgICBwYWdlU2l6ZTogbnVtYmVyID0gMjA7XG4gICAgdG90YWxQYWdlczogbnVtYmVyID0gMTtcbiAgICBwcml2YXRlIHNjcm9sbFRvcDogbnVtYmVyID0gMDtcbiAgICBwcml2YXRlIGhhc1JlbmRlcmVkVmlldyA9IGZhbHNlO1xuICAgIHByaXZhdGUgZW1iZWRkZWRDb250ZW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gICAgcHJpdmF0ZSBzZWxlY3RlZFRyYW5zYWN0aW9uSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBEYXRlIHJhbmdlIHByb3BlcnRpZXNcbiAgICBkYXRlUmFuZ2U6IERhdGVSYW5nZTtcbiAgICBjdXN0b21TdGFydERhdGU6IERhdGUgfCBudWxsID0gbnVsbDtcbiAgICBjdXN0b21FbmREYXRlOiBEYXRlIHwgbnVsbCA9IG51bGw7XG4gICAgZGF0ZVJhbmdlVXBkYXRlZEF0OiBudW1iZXIgPSAwO1xuXG4gICAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luKSB7XG4gICAgICAgIHRoaXMuYXBwID0gYXBwO1xuICAgICAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICAgICAgdGhpcy5kYXRlUmFuZ2UgPSB0aGlzLmdldERhdGVSYW5nZShEYXRlUmFuZ2VUeXBlLlRISVNfTU9OVEgpO1xuICAgIH1cblxuICAgIHJlbmRlckRhc2hib2FyZFRhYihjb250YWluZXI6IEhUTUxFbGVtZW50LCBwcmVzZXJ2ZUZvY3VzID0gZmFsc2UpIHtcbiAgICAgICAgY29uc3Qgc2hhcmVkRGF0ZVJhbmdlU3RhdGUgPSB0aGlzLnBsdWdpbi5nZXRTaGFyZWREYXRlUmFuZ2VTdGF0ZSgpO1xuICAgICAgICBpZiAoc2hhcmVkRGF0ZVJhbmdlU3RhdGUpIHtcbiAgICAgICAgICAgIHRoaXMuYXBwbHlTaGFyZWREYXRlUmFuZ2VTdGF0ZVZhbHVlcyhzaGFyZWREYXRlUmFuZ2VTdGF0ZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmVtYmVkZGVkQ29udGVudEVsID0gY29udGFpbmVyO1xuICAgICAgICB0aGlzLnRyYW5zYWN0aW9ucyA9IHNvcnRUcmFuc2FjdGlvbnNCeURhdGVUaW1lRGVzYyh0aGlzLnBsdWdpbi5nZXRBbGxUcmFuc2FjdGlvbnMoKSk7XG4gICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKGZhbHNlKTtcbiAgICAgICAgY29udGFpbmVyLmFkZENsYXNzKCdleHBlbnNpY2EtZGFzaGJvYXJkLXRyYW5zYWN0aW9ucy10YWInKTtcbiAgICAgICAgdGhpcy5yZW5kZXJUcmFuc2FjdGlvblN0YXRzSGVhZGVyKGNvbnRhaW5lcik7XG4gICAgICAgIHRoaXMucmVuZGVyVHJhbnNhY3Rpb25zQm9keShjb250YWluZXIsIHByZXNlcnZlRm9jdXMpO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0QWN0aXZlQ29udGVudEVsKCk6IEhUTUxFbGVtZW50IHtcbiAgICAgICAgaWYgKCF0aGlzLmVtYmVkZGVkQ29udGVudEVsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RyYW5zYWN0aW9ucyByZW5kZXJlciBoYXMgbm8gYWN0aXZlIGNvbnRhaW5lci4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmVtYmVkZGVkQ29udGVudEVsO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVuZGVyVHJhbnNhY3Rpb25zQm9keShjb250YWluZXI6IEhUTUxFbGVtZW50LCBwcmVzZXJ2ZUZvY3VzID0gZmFsc2UpIHtcbiAgICAgICAgLy8gU2VhcmNoIGJhciBzZWN0aW9uXG4gICAgICAgIGNvbnN0IHNlYXJjaFNlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2Etc2VhcmNoLXNlY3Rpb24nKTtcbiAgICAgICAgY29uc3Qgc2VhcmNoQ29udHJvbHMgPSBzZWFyY2hTZWN0aW9uLmNyZWF0ZURpdignZXhwZW5zaWNhLXNlYXJjaC1jb250cm9scycpO1xuICAgICAgICBjb25zdCBzZWFyY2hDb250YWluZXIgPSBzZWFyY2hDb250cm9scy5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1zZWFyY2gtY29udGFpbmVyIGV4cGVuc2ljYS1jdXN0b20tc2VhcmNoJyk7XG4gICAgICAgIGNvbnN0IHNlYXJjaElucHV0ID0gc2VhcmNoQ29udGFpbmVyLmNyZWF0ZUVsKCdpbnB1dCcsIHtcbiAgICAgICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiAnU2VhcmNoIHRyYW5zYWN0aW9ucy4uLicsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2Etc2VhcmNoLWlucHV0IGV4cGVuc2ljYS1jdXN0b20taW5wdXQnLFxuICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgIGlkOiAnZXhwZW5zaWNhLXNlYXJjaC1pbnB1dCdcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHNlYXJjaElucHV0LnZhbHVlID0gdGhpcy5zZWFyY2hRdWVyeTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBzZWFyY2ggaWNvblxuICAgICAgICBjb25zdCBzZWFyY2hJY29uID0gc2VhcmNoQ29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLXNlYXJjaC1pY29uJyk7XG4gICAgICAgIHNlYXJjaEljb24uaW5uZXJIVE1MID0gJzxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHdpZHRoPVwiMThcIiBoZWlnaHQ9XCIxOFwiIHZpZXdCb3g9XCIwIDAgMjQgMjRcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjJcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIj48Y2lyY2xlIGN4PVwiMTFcIiBjeT1cIjExXCIgcj1cIjhcIj48L2NpcmNsZT48bGluZSB4MT1cIjIxXCIgeTE9XCIyMVwiIHgyPVwiMTYuNjVcIiB5Mj1cIjE2LjY1XCI+PC9saW5lPjwvc3ZnPic7XG5cbiAgICAgICAgdGhpcy5yZW5kZXJDYXRlZ29yeUZpbHRlcihzZWFyY2hDb250YWluZXIpO1xuICAgICAgICB0aGlzLnJlbmRlclNlbGVjdGVkRmlsdGVyQ2hpcHMoc2VhcmNoU2VjdGlvbik7XG4gICAgICAgIFxuICAgICAgICAvLyBQcmV2ZW50IGRlZmF1bHQgYmVoYXZpb3IgdGhhdCBtaWdodCBjYXVzZSBmb2N1cyBsb3NzXG4gICAgICAgIHNlYXJjaElucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZSkgPT4ge1xuICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBzZWFyY2hJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdpbnB1dCcsIChlKSA9PiB7XG4gICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudDtcbiAgICAgICAgICAgIHRoaXMuc2VhcmNoUXVlcnkgPSB0YXJnZXQudmFsdWU7XG4gICAgICAgICAgICB0aGlzLmlucHV0Rm9jdXNlZCA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlID0gMTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlU2VhcmNoUmVzdWx0cygpO1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIHNlYXJjaElucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2ZvY3VzJywgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pbnB1dEZvY3VzZWQgPSB0cnVlO1xuICAgICAgICB9KTtcblxuICAgICAgICBzZWFyY2hJbnB1dC5hZGRFdmVudExpc3RlbmVyKCdibHVyJywgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pbnB1dEZvY3VzZWQgPSBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZXN0b3JlIGZvY3VzIGlmIG5lZWRlZFxuICAgICAgICBpZiAocHJlc2VydmVGb2N1cyAmJiB0aGlzLmlucHV0Rm9jdXNlZCkge1xuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgc2VhcmNoSW5wdXQuZm9jdXMoKTtcbiAgICAgICAgICAgIH0sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGFnaW5hdGlvbiAobmVhciB0aGUgZmlsdGVycyBmb3IgbW9iaWxlIHJlYWNoYWJpbGl0eSlcbiAgICAgICAgdGhpcy5yZW5kZXJQYWdpbmF0aW9uKGNvbnRhaW5lciwgJ3RvcCcpO1xuICAgICAgICBcbiAgICAgICAgLy8gVHJhbnNhY3Rpb25zIGxpc3QgKHRha2VzIGF2YWlsYWJsZSBzcGFjZSlcbiAgICAgICAgdGhpcy5yZW5kZXJUcmFuc2FjdGlvbnNMaXN0KGNvbnRhaW5lcik7XG4gICAgICAgIFxuICAgICAgICAvLyBQYWdpbmF0aW9uIChhdCB0aGUgYm90dG9tKVxuICAgICAgICB0aGlzLnJlbmRlclBhZ2luYXRpb24oY29udGFpbmVyLCAnYm90dG9tJyk7XG5cbiAgICAgICAgdGhpcy5yZXN0b3JlU2Nyb2xsUG9zaXRpb24oKTtcbiAgICAgICAgdGhpcy5oYXNSZW5kZXJlZFZpZXcgPSB0cnVlO1xuICAgIH1cblxuICAgIHJlbmRlckNhdGVnb3J5RmlsdGVyKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpIHtcbiAgICAgICAgY29uc3QgZmlsdGVyQ29udGFpbmVyID0gY29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhdGVnb3J5LWZpbHRlci1jb250YWluZXInKTtcbiAgICAgICAgY29uc3QgZmlsdGVyQnV0dG9uID0gZmlsdGVyQ29udGFpbmVyLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2F0ZWdvcnktZmlsdGVyLWJ1dHRvbicsXG4gICAgICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ2J1dHRvbicsXG4gICAgICAgICAgICAgICAgJ2FyaWEtbGFiZWwnOiAnRmlsdGVyIHRyYW5zYWN0aW9ucycsXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdGaWx0ZXIgdHJhbnNhY3Rpb25zJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZmlsdGVyQnV0dG9uLmlubmVySFRNTCA9ICc8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB3aWR0aD1cIjE4XCIgaGVpZ2h0PVwiMThcIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIyXCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCI+PHBvbHlnb24gcG9pbnRzPVwiMjIgMyAyIDMgMTAgMTIuNDYgMTAgMTkgMTQgMjEgMTQgMTIuNDYgMjIgM1wiPjwvcG9seWdvbj48L3N2Zz4nO1xuXG4gICAgICAgIGNvbnN0IGZpbHRlck1lbnUgPSBmaWx0ZXJDb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtZmlsdGVyLW1lbnUnKTtcbiAgICAgICAgZmlsdGVyTWVudS5hZGRDbGFzcygnaXMtaGlkZGVuJyk7XG4gICAgICAgIGZpbHRlck1lbnUuY3JlYXRlRGl2KHsgdGV4dDogJ0ZpbHRlciBieScsIGNsczogJ2V4cGVuc2ljYS1maWx0ZXItbWVudS10aXRsZScgfSk7XG5cbiAgICAgICAgdGhpcy5yZW5kZXJGaWx0ZXJNZW51U2VjdGlvbihmaWx0ZXJNZW51LCAnVHlwZScsIChzdWJtZW51KSA9PiB0aGlzLnJlbmRlclR5cGVGaWx0ZXJPcHRpb25zKHN1Ym1lbnUpKTtcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmVuYWJsZUFjY291bnRzKSB7XG4gICAgICAgICAgICB0aGlzLnJlbmRlckZpbHRlck1lbnVTZWN0aW9uKGZpbHRlck1lbnUsICdBY2NvdW50cycsIChzdWJtZW51KSA9PiB0aGlzLnJlbmRlckFjY291bnRGaWx0ZXJPcHRpb25zKHN1Ym1lbnUpKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlbmRlckZpbHRlck1lbnVTZWN0aW9uKGZpbHRlck1lbnUsICdDYXRlZ29yaWVzJywgKHN1Ym1lbnUpID0+IHRoaXMucmVuZGVyQ2F0ZWdvcnlGaWx0ZXJPcHRpb25zKHN1Ym1lbnUpKTtcblxuICAgICAgICBjb25zdCBjbG9zZU1lbnUgPSAoKSA9PiB7XG4gICAgICAgICAgICBmaWx0ZXJDb250YWluZXIucmVtb3ZlQ2xhc3MoJ2lzLW9wZW4nKTtcbiAgICAgICAgICAgIGZpbHRlck1lbnUuYWRkQ2xhc3MoJ2lzLWhpZGRlbicpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGZpbHRlckJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldmVudCkgPT4ge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICBjb25zdCBpc0hpZGRlbiA9IGZpbHRlck1lbnUuaGFzQ2xhc3MoJ2lzLWhpZGRlbicpO1xuICAgICAgICAgICAgZmlsdGVyTWVudS5xdWVyeVNlbGVjdG9yQWxsKCcuZXhwZW5zaWNhLWZpbHRlci1tZW51LXBhcmVudC5pcy1vcGVuJykuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICBpdGVtLnJlbW92ZUNsYXNzKCdpcy1vcGVuJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGZpbHRlckNvbnRhaW5lci50b2dnbGVDbGFzcygnaXMtb3BlbicsIGlzSGlkZGVuKTtcbiAgICAgICAgICAgIGZpbHRlck1lbnUudG9nZ2xlQ2xhc3MoJ2lzLWhpZGRlbicsICFpc0hpZGRlbik7XG5cbiAgICAgICAgICAgIGlmIChpc0hpZGRlbikge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGNsb3NlTWVudSwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBmaWx0ZXJNZW51LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZW5kZXJGaWx0ZXJNZW51U2VjdGlvbihcbiAgICAgICAgZmlsdGVyTWVudTogSFRNTEVsZW1lbnQsXG4gICAgICAgIGxhYmVsOiBzdHJpbmcsXG4gICAgICAgIHJlbmRlck9wdGlvbnM6IChzdWJtZW51OiBIVE1MRWxlbWVudCkgPT4gdm9pZFxuICAgICkge1xuICAgICAgICBjb25zdCBtZW51SXRlbSA9IGZpbHRlck1lbnUuY3JlYXRlRGl2KCdleHBlbnNpY2EtZmlsdGVyLW1lbnUtaXRlbSBleHBlbnNpY2EtZmlsdGVyLW1lbnUtcGFyZW50Jyk7XG4gICAgICAgIG1lbnVJdGVtLmNyZWF0ZVNwYW4oeyB0ZXh0OiBsYWJlbCwgY2xzOiAnZXhwZW5zaWNhLWZpbHRlci1tZW51LXZhbHVlJyB9KTtcbiAgICAgICAgY29uc3QgbWVudUFycm93ID0gbWVudUl0ZW0uY3JlYXRlU3BhbignZXhwZW5zaWNhLWZpbHRlci1tZW51LWFycm93Jyk7XG4gICAgICAgIG1lbnVBcnJvdy5pbm5lckhUTUwgPSAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgd2lkdGg9XCIxNFwiIGhlaWdodD1cIjE0XCIgdmlld0JveD1cIjAgMCAyNCAyNFwiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiMi4yNVwiIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwb2x5bGluZSBwb2ludHM9XCIxNSAxOCA5IDEyIDE1IDZcIj48L3BvbHlsaW5lPjwvc3ZnPic7XG5cbiAgICAgICAgY29uc3Qgc3VibWVudSA9IG1lbnVJdGVtLmNyZWF0ZURpdignZXhwZW5zaWNhLWZpbHRlci1zdWJtZW51Jyk7XG4gICAgICAgIHJlbmRlck9wdGlvbnMoc3VibWVudSk7XG5cbiAgICAgICAgY29uc3Qgb3Blbk9ubHlUaGlzTWVudSA9ICgpID0+IHtcbiAgICAgICAgICAgIGZpbHRlck1lbnUucXVlcnlTZWxlY3RvckFsbCgnLmV4cGVuc2ljYS1maWx0ZXItbWVudS1wYXJlbnQuaXMtb3BlbicpLmZvckVhY2goaXRlbSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0gIT09IG1lbnVJdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW0ucmVtb3ZlQ2xhc3MoJ2lzLW9wZW4nKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIG1lbnVJdGVtLmFkZENsYXNzKCdpcy1vcGVuJyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgY2xvc2VNZW51ID0gKCkgPT4ge1xuICAgICAgICAgICAgbWVudUl0ZW0ucmVtb3ZlQ2xhc3MoJ2lzLW9wZW4nKTtcbiAgICAgICAgfTtcblxuICAgICAgICBtZW51SXRlbS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWVudGVyJywgKCkgPT4ge1xuICAgICAgICAgICAgb3Blbk9ubHlUaGlzTWVudSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBtZW51SXRlbS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWxlYXZlJywgKCkgPT4ge1xuICAgICAgICAgICAgY2xvc2VNZW51KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIG1lbnVJdGVtLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgIGNsb3NlTWVudSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBtZW51SXRlbS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVuZGVyVHlwZUZpbHRlck9wdGlvbnMoY29udGFpbmVyOiBIVE1MRWxlbWVudCkge1xuICAgICAgICBjb25zdCBvcHRpb25zSG9zdCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1maWx0ZXItc3VibWVudS1vcHRpb25zJyk7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSBbXG4gICAgICAgICAgICB7IHZhbHVlOiBUcmFuc2FjdGlvblR5cGUuSU5DT01FLCBsYWJlbDogJ0luY29tZScsIGVtb2ppOiAn8J+SsCcgfSxcbiAgICAgICAgICAgIHsgdmFsdWU6IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFLCBsYWJlbDogJ0V4cGVuc2VzJywgZW1vamk6ICfwn5K4JyB9LFxuICAgICAgICAgICAgeyB2YWx1ZTogVHJhbnNhY3Rpb25UeXBlLklOVEVSTkFMLCBsYWJlbDogJ0ludGVybmFsJywgZW1vamk6ICfwn5SBJyB9XG4gICAgICAgIF07XG5cbiAgICAgICAgb3B0aW9ucy5mb3JFYWNoKG9wdGlvbiA9PiB7XG4gICAgICAgICAgICBjb25zdCBpc1NlbGVjdGVkID0gdGhpcy5zZWxlY3RlZFR5cGVGaWx0ZXJzLmluY2x1ZGVzKG9wdGlvbi52YWx1ZSk7XG4gICAgICAgICAgICBjb25zdCBidXR0b24gPSBvcHRpb25zSG9zdC5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgICAgIGNsczogYGV4cGVuc2ljYS1maWx0ZXItY2F0ZWdvcnktb3B0aW9uICR7aXNTZWxlY3RlZCA/ICdpcy1zZWxlY3RlZCcgOiAnJ31gLnRyaW0oKSxcbiAgICAgICAgICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICdidXR0b24nLFxuICAgICAgICAgICAgICAgICAgICAnYXJpYS1wcmVzc2VkJzogU3RyaW5nKGlzU2VsZWN0ZWQpLFxuICAgICAgICAgICAgICAgICAgICAnZGF0YS1maWx0ZXItdHlwZSc6IG9wdGlvbi52YWx1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyB0ZXh0OiBvcHRpb24uZW1vamksIGNsczogJ2V4cGVuc2ljYS1maWx0ZXItY2F0ZWdvcnktZW1vamknIH0pO1xuICAgICAgICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyB0ZXh0OiBvcHRpb24ubGFiZWwsIGNsczogJ2V4cGVuc2ljYS1maWx0ZXItY2F0ZWdvcnktbmFtZScgfSk7XG4gICAgICAgICAgICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICB0aGlzLnRvZ2dsZVNlbGVjdGVkVHlwZShvcHRpb24udmFsdWUpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbi5jbG9zZXN0KCcuZXhwZW5zaWNhLWZpbHRlci1tZW51LXBhcmVudCcpPy5yZW1vdmVDbGFzcygnaXMtb3BlbicpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVuZGVyQWNjb3VudEZpbHRlck9wdGlvbnMoY29udGFpbmVyOiBIVE1MRWxlbWVudCkge1xuICAgICAgICBjb25zdCBvcHRpb25zSG9zdCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1maWx0ZXItc3VibWVudS1vcHRpb25zJyk7XG4gICAgICAgIGNvbnN0IGFjY291bnRzID0gdGhpcy5wbHVnaW4uZ2V0QWNjb3VudHMoKTtcblxuICAgICAgICBpZiAoYWNjb3VudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBvcHRpb25zSG9zdC5jcmVhdGVEaXYoeyB0ZXh0OiAnTm8gYWNjb3VudHMnLCBjbHM6ICdleHBlbnNpY2EtZmlsdGVyLW1lbnUtZW1wdHknIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYWNjb3VudHMuZm9yRWFjaChhY2NvdW50ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGFjY291bnRSZWZlcmVuY2UgPSB0aGlzLnBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UoXG4gICAgICAgICAgICAgICAgZm9ybWF0QWNjb3VudFJlZmVyZW5jZShhY2NvdW50LnR5cGUsIGFjY291bnQubmFtZSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25zdCBpc1NlbGVjdGVkID0gdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLmluY2x1ZGVzKGFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgY29uc3QgYnV0dG9uID0gb3B0aW9uc0hvc3QuY3JlYXRlRWwoJ2J1dHRvbicsIHtcbiAgICAgICAgICAgICAgICBjbHM6IGBleHBlbnNpY2EtZmlsdGVyLWNhdGVnb3J5LW9wdGlvbiAke2lzU2VsZWN0ZWQgPyAnaXMtc2VsZWN0ZWQnIDogJyd9YC50cmltKCksXG4gICAgICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICAgICAgJ2FyaWEtcHJlc3NlZCc6IFN0cmluZyhpc1NlbGVjdGVkKSxcbiAgICAgICAgICAgICAgICAgICAgJ2RhdGEtYWNjb3VudC1yZWZlcmVuY2UnOiBhY2NvdW50UmVmZXJlbmNlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBidXR0b24uY3JlYXRlU3Bhbih7IHRleHQ6IGdldEFjY291bnRFbW9qaShhY2NvdW50LnR5cGUpLCBjbHM6ICdleHBlbnNpY2EtZmlsdGVyLWNhdGVnb3J5LWVtb2ppJyB9KTtcbiAgICAgICAgICAgIGJ1dHRvbi5jcmVhdGVTcGFuKHsgdGV4dDogYWNjb3VudC5uYW1lLCBjbHM6ICdleHBlbnNpY2EtZmlsdGVyLWNhdGVnb3J5LW5hbWUnIH0pO1xuICAgICAgICAgICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgdGhpcy50b2dnbGVTZWxlY3RlZEFjY291bnQoYWNjb3VudFJlZmVyZW5jZSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uLmNsb3Nlc3QoJy5leHBlbnNpY2EtZmlsdGVyLW1lbnUtcGFyZW50Jyk/LnJlbW92ZUNsYXNzKCdpcy1vcGVuJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVuZGVyQ2F0ZWdvcnlGaWx0ZXJPcHRpb25zKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uc0hvc3QgPSBjb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtZmlsdGVyLXN1Ym1lbnUtb3B0aW9ucycpO1xuICAgICAgICBjb25zdCBjYXRlZ29yaWVzID0gdGhpcy5wbHVnaW4uZ2V0Q2F0ZWdvcmllcygpO1xuXG4gICAgICAgIGlmIChjYXRlZ29yaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgb3B0aW9uc0hvc3QuY3JlYXRlRGl2KHtcbiAgICAgICAgICAgICAgICB0ZXh0OiAnTm8gY2F0ZWdvcmllcycsXG4gICAgICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWZpbHRlci1tZW51LWVtcHR5J1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjYXRlZ29yaWVzLmZvckVhY2goY2F0ZWdvcnkgPT4ge1xuICAgICAgICAgICAgY29uc3QgaXNTZWxlY3RlZCA9IHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5pbmNsdWRlcyhjYXRlZ29yeS5pZCk7XG4gICAgICAgICAgICBjb25zdCBjYXRlZ29yeUJ1dHRvbiA9IG9wdGlvbnNIb3N0LmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICAgICAgY2xzOiBgZXhwZW5zaWNhLWZpbHRlci1jYXRlZ29yeS1vcHRpb24gJHtpc1NlbGVjdGVkID8gJ2lzLXNlbGVjdGVkJyA6ICcnfWAudHJpbSgpLFxuICAgICAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ2J1dHRvbicsXG4gICAgICAgICAgICAgICAgICAgICdhcmlhLXByZXNzZWQnOiBTdHJpbmcoaXNTZWxlY3RlZCksXG4gICAgICAgICAgICAgICAgICAgICdkYXRhLWNhdGVnb3J5LWlkJzogY2F0ZWdvcnkuaWRcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY2F0ZWdvcnlCdXR0b24uY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICAgICAgdGV4dDogdGhpcy5wbHVnaW4uZ2V0Q2F0ZWdvcnlFbW9qaShjYXRlZ29yeS5pZCksXG4gICAgICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWZpbHRlci1jYXRlZ29yeS1lbW9qaSdcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY2F0ZWdvcnlCdXR0b24uY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICAgICAgdGV4dDogY2F0ZWdvcnkubmFtZSxcbiAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtZmlsdGVyLWNhdGVnb3J5LW5hbWUnXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY2F0ZWdvcnlCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICB0aGlzLnRvZ2dsZVNlbGVjdGVkQ2F0ZWdvcnkoY2F0ZWdvcnkuaWQpO1xuICAgICAgICAgICAgICAgIGNhdGVnb3J5QnV0dG9uLmNsb3Nlc3QoJy5leHBlbnNpY2EtZmlsdGVyLW1lbnUtcGFyZW50Jyk/LnJlbW92ZUNsYXNzKCdpcy1vcGVuJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmVuZGVyU2VsZWN0ZWRGaWx0ZXJDaGlwcyhjb250YWluZXI6IEhUTUxFbGVtZW50KSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdGVkRmlsdGVyc0NvbnRhaW5lciA9IGNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1zZWxlY3RlZC1maWx0ZXJzJyk7XG4gICAgICAgIGNvbnN0IGhhc0ZpbHRlcnMgPSB0aGlzLnNlbGVjdGVkVHlwZUZpbHRlcnMubGVuZ3RoID4gMFxuICAgICAgICAgICAgfHwgdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgIHx8IHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5sZW5ndGggPiAwO1xuICAgICAgICBzZWxlY3RlZEZpbHRlcnNDb250YWluZXIudG9nZ2xlQ2xhc3MoJ2lzLWhpZGRlbicsICFoYXNGaWx0ZXJzKTtcblxuICAgICAgICB0aGlzLnNlbGVjdGVkVHlwZUZpbHRlcnMuZm9yRWFjaCh0eXBlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLklOQ09NRSA/ICdJbmNvbWUnIDogdHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLkVYUEVOU0UgPyAnRXhwZW5zZXMnIDogJ0ludGVybmFsJztcbiAgICAgICAgICAgIHRoaXMucmVuZGVyVGV4dEZpbHRlckNoaXAoc2VsZWN0ZWRGaWx0ZXJzQ29udGFpbmVyLCBsYWJlbCwgKCkgPT4gdGhpcy5yZW1vdmVTZWxlY3RlZFR5cGUodHlwZSkpO1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZXMuZm9yRWFjaChhY2NvdW50UmVmZXJlbmNlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGFjY291bnQgPSB0aGlzLnBsdWdpbi5maW5kQWNjb3VudEJ5UmVmZXJlbmNlKGFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgaWYgKCFhY2NvdW50KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLnJlbmRlclRleHRGaWx0ZXJDaGlwKHNlbGVjdGVkRmlsdGVyc0NvbnRhaW5lciwgYWNjb3VudC5uYW1lLCAoKSA9PiB0aGlzLnJlbW92ZVNlbGVjdGVkQWNjb3VudChhY2NvdW50UmVmZXJlbmNlKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5mb3JFYWNoKGNhdGVnb3J5SWQgPT4ge1xuICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUJ5SWQoY2F0ZWdvcnlJZCk7XG4gICAgICAgICAgICBpZiAoIWNhdGVnb3J5KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjaGlwID0gcmVuZGVyQ2F0ZWdvcnlDaGlwKHNlbGVjdGVkRmlsdGVyc0NvbnRhaW5lciwge1xuICAgICAgICAgICAgICAgIGVtb2ppOiB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUVtb2ppKGNhdGVnb3J5LmlkKSxcbiAgICAgICAgICAgICAgICB0ZXh0OiBjYXRlZ29yeS5uYW1lLFxuICAgICAgICAgICAgICAgIGNvbG9yOiB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUNvbG9yKGNhdGVnb3J5LmlkLCBjYXRlZ29yeS5uYW1lKSxcbiAgICAgICAgICAgICAgICBjb2xvck5hbWU6IGNhdGVnb3J5Lm5hbWUsXG4gICAgICAgICAgICAgICAgaW50ZXJhY3RpdmU6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY2hpcC5hZGRDbGFzcygnZXhwZW5zaWNhLXNlbGVjdGVkLWZpbHRlci1jaGlwJyk7XG4gICAgICAgICAgICBjaGlwLnNldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsIGBSZW1vdmUgJHtjYXRlZ29yeS5uYW1lfSBmaWx0ZXJgKTtcblxuICAgICAgICAgICAgY29uc3QgcmVtb3ZlSWNvbiA9IGNoaXAuY3JlYXRlU3BhbignZXhwZW5zaWNhLXNlbGVjdGVkLWZpbHRlci1yZW1vdmUnKTtcbiAgICAgICAgICAgIHJlbW92ZUljb24uaW5uZXJIVE1MID0gJzxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHdpZHRoPVwiMTJcIiBoZWlnaHQ9XCIxMlwiIHZpZXdCb3g9XCIwIDAgMjQgMjRcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjIuNFwiIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiPjxsaW5lIHgxPVwiMThcIiB5MT1cIjZcIiB4Mj1cIjZcIiB5Mj1cIjE4XCI+PC9saW5lPjxsaW5lIHgxPVwiNlwiIHkxPVwiNlwiIHgyPVwiMThcIiB5Mj1cIjE4XCI+PC9saW5lPjwvc3ZnPic7XG5cbiAgICAgICAgICAgIGNoaXAuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZW1vdmVTZWxlY3RlZENhdGVnb3J5KGNhdGVnb3J5LmlkKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlbmRlclRleHRGaWx0ZXJDaGlwKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHRleHQ6IHN0cmluZywgb25SZW1vdmU6ICgpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgY2hpcCA9IGNvbnRhaW5lci5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLXNlbGVjdGVkLWZpbHRlci1jaGlwIGV4cGVuc2ljYS1zZWxlY3RlZC1maWx0ZXItY2hpcC10ZXh0JyxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICAnYXJpYS1sYWJlbCc6IGBSZW1vdmUgJHt0ZXh0fSBmaWx0ZXJgXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjaGlwLmNyZWF0ZVNwYW4oeyB0ZXh0IH0pO1xuICAgICAgICBjb25zdCByZW1vdmVJY29uID0gY2hpcC5jcmVhdGVTcGFuKCdleHBlbnNpY2Etc2VsZWN0ZWQtZmlsdGVyLXJlbW92ZScpO1xuICAgICAgICByZW1vdmVJY29uLmlubmVySFRNTCA9ICc8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB3aWR0aD1cIjEyXCIgaGVpZ2h0PVwiMTJcIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIyLjRcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIj48bGluZSB4MT1cIjE4XCIgeTE9XCI2XCIgeDI9XCI2XCIgeTI9XCIxOFwiPjwvbGluZT48bGluZSB4MT1cIjZcIiB5MT1cIjZcIiB4Mj1cIjE4XCIgeTI9XCIxOFwiPjwvbGluZT48L3N2Zz4nO1xuICAgICAgICBjaGlwLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgb25SZW1vdmUpO1xuICAgIH1cblxuICAgIHJlZnJlc2hTZWxlY3RlZEZpbHRlckNoaXBzKCkge1xuICAgICAgICBjb25zdCBzZWFyY2hTZWN0aW9uID0gdGhpcy5nZXRBY3RpdmVDb250ZW50RWwoKS5xdWVyeVNlbGVjdG9yKCcuZXhwZW5zaWNhLXNlYXJjaC1zZWN0aW9uJykgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAoIXNlYXJjaFNlY3Rpb24pIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlYXJjaFNlY3Rpb24ucXVlcnlTZWxlY3RvcignLmV4cGVuc2ljYS1zZWxlY3RlZC1maWx0ZXJzJyk/LnJlbW92ZSgpO1xuICAgICAgICB0aGlzLnJlbmRlclNlbGVjdGVkRmlsdGVyQ2hpcHMoc2VhcmNoU2VjdGlvbik7XG4gICAgfVxuXG4gICAgcmVmcmVzaENhdGVnb3J5RmlsdGVyT3B0aW9ucygpIHtcbiAgICAgICAgdGhpcy5nZXRBY3RpdmVDb250ZW50RWwoKS5xdWVyeVNlbGVjdG9yQWxsKCcuZXhwZW5zaWNhLWZpbHRlci1jYXRlZ29yeS1vcHRpb25bZGF0YS1maWx0ZXItdHlwZV0nKS5mb3JFYWNoKG9wdGlvbiA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eXBlID0gb3B0aW9uLmdldEF0dHJpYnV0ZSgnZGF0YS1maWx0ZXItdHlwZScpIGFzIFRyYW5zYWN0aW9uVHlwZSB8IG51bGw7XG4gICAgICAgICAgICBjb25zdCBpc1NlbGVjdGVkID0gISF0eXBlICYmIHRoaXMuc2VsZWN0ZWRUeXBlRmlsdGVycy5pbmNsdWRlcyh0eXBlKTtcbiAgICAgICAgICAgIG9wdGlvbi50b2dnbGVDbGFzcygnaXMtc2VsZWN0ZWQnLCBpc1NlbGVjdGVkKTtcbiAgICAgICAgICAgIG9wdGlvbi5zZXRBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsIFN0cmluZyhpc1NlbGVjdGVkKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZ2V0QWN0aXZlQ29udGVudEVsKCkucXVlcnlTZWxlY3RvckFsbCgnLmV4cGVuc2ljYS1maWx0ZXItY2F0ZWdvcnktb3B0aW9uW2RhdGEtYWNjb3VudC1yZWZlcmVuY2VdJykuZm9yRWFjaChvcHRpb24gPT4ge1xuICAgICAgICAgICAgY29uc3QgYWNjb3VudFJlZmVyZW5jZSA9IG9wdGlvbi5nZXRBdHRyaWJ1dGUoJ2RhdGEtYWNjb3VudC1yZWZlcmVuY2UnKTtcbiAgICAgICAgICAgIGNvbnN0IGlzU2VsZWN0ZWQgPSAhIWFjY291bnRSZWZlcmVuY2UgJiYgdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLmluY2x1ZGVzKGFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgb3B0aW9uLnRvZ2dsZUNsYXNzKCdpcy1zZWxlY3RlZCcsIGlzU2VsZWN0ZWQpO1xuICAgICAgICAgICAgb3B0aW9uLnNldEF0dHJpYnV0ZSgnYXJpYS1wcmVzc2VkJywgU3RyaW5nKGlzU2VsZWN0ZWQpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5nZXRBY3RpdmVDb250ZW50RWwoKS5xdWVyeVNlbGVjdG9yQWxsKCcuZXhwZW5zaWNhLWZpbHRlci1jYXRlZ29yeS1vcHRpb24nKS5mb3JFYWNoKG9wdGlvbiA9PiB7XG4gICAgICAgICAgICBjb25zdCBjYXRlZ29yeUlkID0gb3B0aW9uLmdldEF0dHJpYnV0ZSgnZGF0YS1jYXRlZ29yeS1pZCcpO1xuICAgICAgICAgICAgaWYgKCFjYXRlZ29yeUlkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaXNTZWxlY3RlZCA9IHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5pbmNsdWRlcyhjYXRlZ29yeUlkKTtcbiAgICAgICAgICAgIG9wdGlvbi50b2dnbGVDbGFzcygnaXMtc2VsZWN0ZWQnLCBpc1NlbGVjdGVkKTtcbiAgICAgICAgICAgIG9wdGlvbi5zZXRBdHRyaWJ1dGUoJ2FyaWEtcHJlc3NlZCcsIFN0cmluZyhpc1NlbGVjdGVkKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHRvZ2dsZVNlbGVjdGVkVHlwZSh0eXBlOiBUcmFuc2FjdGlvblR5cGUpIHtcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXBlRmlsdGVycy5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgICAgICAgdGhpcy5zZWxlY3RlZFR5cGVGaWx0ZXJzID0gdGhpcy5zZWxlY3RlZFR5cGVGaWx0ZXJzLmZpbHRlcih2YWx1ZSA9PiB2YWx1ZSAhPT0gdHlwZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkVHlwZUZpbHRlcnMgPSBbLi4udGhpcy5zZWxlY3RlZFR5cGVGaWx0ZXJzLCB0eXBlXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKHRydWUpO1xuICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hTZWxlY3RlZEZpbHRlckNoaXBzKCk7XG4gICAgICAgIHRoaXMucmVmcmVzaENhdGVnb3J5RmlsdGVyT3B0aW9ucygpO1xuICAgIH1cblxuICAgIHJlbW92ZVNlbGVjdGVkVHlwZSh0eXBlOiBUcmFuc2FjdGlvblR5cGUpIHtcbiAgICAgICAgdGhpcy5zZWxlY3RlZFR5cGVGaWx0ZXJzID0gdGhpcy5zZWxlY3RlZFR5cGVGaWx0ZXJzLmZpbHRlcih2YWx1ZSA9PiB2YWx1ZSAhPT0gdHlwZSk7XG4gICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKHRydWUpO1xuICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hTZWxlY3RlZEZpbHRlckNoaXBzKCk7XG4gICAgICAgIHRoaXMucmVmcmVzaENhdGVnb3J5RmlsdGVyT3B0aW9ucygpO1xuICAgIH1cblxuICAgIHRvZ2dsZVNlbGVjdGVkQWNjb3VudChhY2NvdW50UmVmZXJlbmNlOiBzdHJpbmcpIHtcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRBY2NvdW50UmVmZXJlbmNlcy5pbmNsdWRlcyhhY2NvdW50UmVmZXJlbmNlKSkge1xuICAgICAgICAgICAgdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzID0gdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLmZpbHRlcih2YWx1ZSA9PiB2YWx1ZSAhPT0gYWNjb3VudFJlZmVyZW5jZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZXMgPSBbLi4udGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLCBhY2NvdW50UmVmZXJlbmNlXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKHRydWUpO1xuICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hTZWxlY3RlZEZpbHRlckNoaXBzKCk7XG4gICAgICAgIHRoaXMucmVmcmVzaENhdGVnb3J5RmlsdGVyT3B0aW9ucygpO1xuICAgIH1cblxuICAgIHJlbW92ZVNlbGVjdGVkQWNjb3VudChhY2NvdW50UmVmZXJlbmNlOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzID0gdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLmZpbHRlcih2YWx1ZSA9PiB2YWx1ZSAhPT0gYWNjb3VudFJlZmVyZW5jZSk7XG4gICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKHRydWUpO1xuICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hTZWxlY3RlZEZpbHRlckNoaXBzKCk7XG4gICAgICAgIHRoaXMucmVmcmVzaENhdGVnb3J5RmlsdGVyT3B0aW9ucygpO1xuICAgIH1cblxuICAgIHRvZ2dsZVNlbGVjdGVkQ2F0ZWdvcnkoY2F0ZWdvcnlJZDogc3RyaW5nKSB7XG4gICAgICAgIGlmICh0aGlzLnNlbGVjdGVkQ2F0ZWdvcnlJZHMuaW5jbHVkZXMoY2F0ZWdvcnlJZCkpIHtcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcyA9IHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5maWx0ZXIoaWQgPT4gaWQgIT09IGNhdGVnb3J5SWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5zZWxlY3RlZENhdGVnb3J5SWRzID0gWy4uLnRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcywgY2F0ZWdvcnlJZF07XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmFwcGx5RmlsdGVycyh0cnVlKTtcbiAgICAgICAgdGhpcy5wZXJzaXN0VHJhbnNhY3Rpb25zU3RhdGUoKTtcbiAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoKTtcbiAgICAgICAgdGhpcy5yZWZyZXNoU2VsZWN0ZWRGaWx0ZXJDaGlwcygpO1xuICAgICAgICB0aGlzLnJlZnJlc2hDYXRlZ29yeUZpbHRlck9wdGlvbnMoKTtcbiAgICB9XG5cbiAgICByZW1vdmVTZWxlY3RlZENhdGVnb3J5KGNhdGVnb3J5SWQ6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNlbGVjdGVkQ2F0ZWdvcnlJZHMgPSB0aGlzLnNlbGVjdGVkQ2F0ZWdvcnlJZHMuZmlsdGVyKGlkID0+IGlkICE9PSBjYXRlZ29yeUlkKTtcbiAgICAgICAgdGhpcy5hcHBseUZpbHRlcnModHJ1ZSk7XG4gICAgICAgIHRoaXMucGVyc2lzdFRyYW5zYWN0aW9uc1N0YXRlKCk7XG4gICAgICAgIHRoaXMucmVmcmVzaFRyYW5zYWN0aW9uc0xpc3RPbmx5KCk7XG4gICAgICAgIHRoaXMucmVmcmVzaFNlbGVjdGVkRmlsdGVyQ2hpcHMoKTtcbiAgICAgICAgdGhpcy5yZWZyZXNoQ2F0ZWdvcnlGaWx0ZXJPcHRpb25zKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBmb3JtYXRUcmFuc2FjdGlvblN0YXRDdXJyZW5jeShhbW91bnQ6IG51bWJlcik6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IGN1cnJlbmN5Q29kZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDdXJyZW5jeTtcbiAgICAgICAgY29uc3QgY29uZmlndXJlZFN5bWJvbCA9IGdldEN1cnJlbmN5QnlDb2RlKGN1cnJlbmN5Q29kZSk/LnN5bWJvbCB8fCAnJCc7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlTeW1ib2wgPSBjb25maWd1cmVkU3ltYm9sLmluY2x1ZGVzKCckJykgPyAnJCcgOiBjb25maWd1cmVkU3ltYm9sO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IEludGwuTnVtYmVyRm9ybWF0KCdlbi1VUycsIHtcbiAgICAgICAgICAgICAgICBzdHlsZTogJ2N1cnJlbmN5JyxcbiAgICAgICAgICAgICAgICBjdXJyZW5jeTogY3VycmVuY3lDb2RlLFxuICAgICAgICAgICAgICAgIGN1cnJlbmN5RGlzcGxheTogJ3N5bWJvbCdcbiAgICAgICAgICAgIH0pLmZvcm1hdFRvUGFydHMoYW1vdW50KVxuICAgICAgICAgICAgICAgIC5tYXAocGFydCA9PiBwYXJ0LnR5cGUgPT09ICdjdXJyZW5jeScgPyBkaXNwbGF5U3ltYm9sIDogcGFydC52YWx1ZSlcbiAgICAgICAgICAgICAgICAuam9pbignJyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0Q3VycmVuY3koYW1vdW50LCBjdXJyZW5jeUNvZGUpLnJlcGxhY2UoL1tBLVpdezEsM30oPz1cXCQpL2csICcnKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcmVuZGVyVHJhbnNhY3Rpb25TdGF0c0hlYWRlcihjb250YWluZXI6IEhUTUxFbGVtZW50KSB7XG4gICAgICAgIGNvbnN0IHRvdGFscyA9IHRoaXMuZ2V0RmlsdGVyZWRUcmFuc2FjdGlvblRvdGFscygpO1xuICAgICAgICBjb25zdCBzdGF0Q2hpcHNDb250YWluZXIgPSBjb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtdHJhbnNhY3Rpb24tdG90YWwtY2hpcHMgZXhwZW5zaWNhLXRyYW5zYWN0aW9ucy10YWItY2hpcHMnKTtcbiAgICAgICAgc3RhdENoaXBzQ29udGFpbmVyLmNyZWF0ZUVsKCdzcGFuJywge1xuICAgICAgICAgICAgdGV4dDogdGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5sZW5ndGggPiAwID8gYCR7dGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5sZW5ndGh9IHRvdGFsYCA6ICcnLFxuICAgICAgICAgICAgY2xzOiBgZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWNvdW50IGV4cGVuc2ljYS10cmFuc2FjdGlvbi1jb3VudC1jaGlwICR7dGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5sZW5ndGggPT09IDAgPyAnaXMtaGlkZGVuJyA6ICcnfWAudHJpbSgpXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnJlbmRlclRyYW5zYWN0aW9uVG90YWxDaGlwKHN0YXRDaGlwc0NvbnRhaW5lciwgJ3NwZW50JywgdG90YWxzLmV4cGVuc2VzKTtcbiAgICAgICAgdGhpcy5yZW5kZXJUcmFuc2FjdGlvblRvdGFsQ2hpcChzdGF0Q2hpcHNDb250YWluZXIsICdpbmNvbWUnLCB0b3RhbHMuaW5jb21lKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlbmRlclRyYW5zYWN0aW9uVG90YWxDaGlwKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHR5cGU6ICdzcGVudCcgfCAnaW5jb21lJywgYW1vdW50OiBudW1iZXIpIHtcbiAgICAgICAgaWYgKGFtb3VudCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYWJlbCA9IHR5cGUgPT09ICdzcGVudCcgPyAnU3BlbnQnIDogJ0luY29tZSc7XG4gICAgICAgIGNvbnN0IGNsYXNzTmFtZSA9IHR5cGUgPT09ICdzcGVudCdcbiAgICAgICAgICAgID8gJ2V4cGVuc2ljYS10cmFuc2FjdGlvbi10b3RhbC1zcGVudCdcbiAgICAgICAgICAgIDogJ2V4cGVuc2ljYS10cmFuc2FjdGlvbi10b3RhbC1pbmNvbWUnO1xuXG4gICAgICAgIHJldHVybiBjb250YWluZXIuY3JlYXRlRWwoJ3NwYW4nLCB7XG4gICAgICAgICAgICB0ZXh0OiBgJHtsYWJlbH0gJHt0aGlzLmZvcm1hdFRyYW5zYWN0aW9uU3RhdEN1cnJlbmN5KGFtb3VudCl9YCxcbiAgICAgICAgICAgIGNsczogYGV4cGVuc2ljYS10cmFuc2FjdGlvbi1jb3VudCBleHBlbnNpY2EtdHJhbnNhY3Rpb24tdG90YWwtY2hpcCAke2NsYXNzTmFtZX1gXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3luY1RyYW5zYWN0aW9uVG90YWxDaGlwKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHR5cGU6ICdzcGVudCcgfCAnaW5jb21lJywgYW1vdW50OiBudW1iZXIpIHtcbiAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gdHlwZSA9PT0gJ3NwZW50J1xuICAgICAgICAgICAgPyAnZXhwZW5zaWNhLXRyYW5zYWN0aW9uLXRvdGFsLXNwZW50J1xuICAgICAgICAgICAgOiAnZXhwZW5zaWNhLXRyYW5zYWN0aW9uLXRvdGFsLWluY29tZSc7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nQ2hpcCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKGAuJHtjbGFzc05hbWV9YCk7XG5cbiAgICAgICAgZXhpc3RpbmdDaGlwPy5yZW1vdmUoKTtcbiAgICAgICAgdGhpcy5yZW5kZXJUcmFuc2FjdGlvblRvdGFsQ2hpcChjb250YWluZXIsIHR5cGUsIGFtb3VudCk7XG4gICAgfVxuXG4gICAgcmVtZW1iZXJTY3JvbGxQb3NpdGlvbigpIHtcbiAgICAgICAgdGhpcy5zY3JvbGxUb3AgPSB0aGlzLmdldEFjdGl2ZUNvbnRlbnRFbCgpLnNjcm9sbFRvcDtcbiAgICB9XG5cbiAgICByZXN0b3JlU2Nyb2xsUG9zaXRpb24oKSB7XG4gICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmdldEFjdGl2ZUNvbnRlbnRFbCgpLnNjcm9sbFRvcCA9IHRoaXMuc2Nyb2xsVG9wO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwZXJzaXN0VHJhbnNhY3Rpb25zU3RhdGUoKSB7XG4gICAgICAgIHRoaXMucmVtZW1iZXJTY3JvbGxQb3NpdGlvbigpO1xuICAgICAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmVxdWVzdFNhdmVMYXlvdXQoKTtcbiAgICB9XG5cbiAgICBhcHBseVNoYXJlZERhdGVSYW5nZVN0YXRlVmFsdWVzKHN0YXRlOiBTaGFyZWREYXRlUmFuZ2VTdGF0ZSkge1xuICAgICAgICBjb25zdCBzdGFydERhdGUgPSBwYXJzZUxvY2FsRGF0ZShzdGF0ZS5zdGFydERhdGUpO1xuICAgICAgICBjb25zdCBlbmREYXRlID0gcGFyc2VMb2NhbERhdGUoc3RhdGUuZW5kRGF0ZSk7XG4gICAgICAgIHRoaXMuZGF0ZVJhbmdlID0gdGhpcy5jcmVhdGVEYXRlUmFuZ2VGcm9tU3RhdGUoc3RhdGUudHlwZSwgc3RhcnREYXRlLCBlbmREYXRlKTtcbiAgICAgICAgdGhpcy5jdXN0b21TdGFydERhdGUgPSBzdGF0ZS5jdXN0b21TdGFydERhdGUgPyBwYXJzZUxvY2FsRGF0ZShzdGF0ZS5jdXN0b21TdGFydERhdGUpIDogbnVsbDtcbiAgICAgICAgdGhpcy5jdXN0b21FbmREYXRlID0gc3RhdGUuY3VzdG9tRW5kRGF0ZSA/IHBhcnNlTG9jYWxEYXRlKHN0YXRlLmN1c3RvbUVuZERhdGUpIDogbnVsbDtcbiAgICAgICAgdGhpcy5kYXRlUmFuZ2VVcGRhdGVkQXQgPSBzdGF0ZS51cGRhdGVkQXQ7XG4gICAgfVxuXG4gICAgYXN5bmMgYXBwbHlTaGFyZWREYXRlUmFuZ2VTdGF0ZShzdGF0ZTogU2hhcmVkRGF0ZVJhbmdlU3RhdGUpIHtcbiAgICAgICAgaWYgKHN0YXRlLnVwZGF0ZWRBdCA8IHRoaXMuZGF0ZVJhbmdlVXBkYXRlZEF0KSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmFwcGx5U2hhcmVkRGF0ZVJhbmdlU3RhdGVWYWx1ZXMoc3RhdGUpO1xuICAgICAgICBhd2FpdCB0aGlzLmxvYWRUcmFuc2FjdGlvbnNEYXRhKHRydWUpO1xuICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuXG4gICAgICAgIGlmICh0aGlzLmVtYmVkZGVkQ29udGVudEVsKSB7XG4gICAgICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYXBwbHlDYXRlZ29yeUZpbHRlcihjYXRlZ29yeUlkOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZWxlY3RlZENhdGVnb3J5SWRzID0gdGhpcy5wbHVnaW4uZ2V0Q2F0ZWdvcnlCeUlkKGNhdGVnb3J5SWQpID8gW2NhdGVnb3J5SWRdIDogW107XG4gICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSAxO1xuICAgICAgICB0aGlzLmFwcGx5RmlsdGVycyh0cnVlKTtcbiAgICAgICAgdGhpcy5wZXJzaXN0VHJhbnNhY3Rpb25zU3RhdGUoKTtcblxuICAgICAgICBpZiAodGhpcy5lbWJlZGRlZENvbnRlbnRFbCkge1xuICAgICAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoKTtcbiAgICAgICAgICAgIHRoaXMucmVmcmVzaFNlbGVjdGVkRmlsdGVyQ2hpcHMoKTtcbiAgICAgICAgICAgIHRoaXMucmVmcmVzaENhdGVnb3J5RmlsdGVyT3B0aW9ucygpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY3JlYXRlRGF0ZVJhbmdlRnJvbVN0YXRlKHR5cGU6IERhdGVSYW5nZVR5cGUsIHN0YXJ0RGF0ZT86IERhdGUsIGVuZERhdGU/OiBEYXRlKTogRGF0ZVJhbmdlIHtcbiAgICAgICAgaWYgKHR5cGUgPT09IERhdGVSYW5nZVR5cGUuQ1VTVE9NICYmIHN0YXJ0RGF0ZSAmJiBlbmREYXRlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZXREYXRlUmFuZ2UoRGF0ZVJhbmdlVHlwZS5DVVNUT00sIHN0YXJ0RGF0ZSwgZW5kRGF0ZSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5nZXREYXRlUmFuZ2UodHlwZSk7XG4gICAgfVxuXG4gICAgYXN5bmMgbG9hZFRyYW5zYWN0aW9uc0RhdGEocmVzZXRQYWdlID0gZmFsc2UpIHtcbiAgICAgICAgLy8gTG9hZCBhbGwgdHJhbnNhY3Rpb25zXG4gICAgICAgIHRoaXMudHJhbnNhY3Rpb25zID0gdGhpcy5wbHVnaW4uZ2V0QWxsVHJhbnNhY3Rpb25zKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBTb3J0IHRyYW5zYWN0aW9ucyBieSBkYXRlIGFuZCB0aW1lIChsYXRlc3QgZmlyc3QpXG4gICAgICAgIHRoaXMudHJhbnNhY3Rpb25zID0gc29ydFRyYW5zYWN0aW9uc0J5RGF0ZVRpbWVEZXNjKHRoaXMudHJhbnNhY3Rpb25zKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKHJlc2V0UGFnZSk7XG4gICAgfVxuXG4gICAgYXBwbHlGaWx0ZXJzKHJlc2V0UGFnZSA9IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IHZhbGlkVHJhbnNhY3Rpb25JZHMgPSBuZXcgU2V0KHRoaXMudHJhbnNhY3Rpb25zLm1hcCh0cmFuc2FjdGlvbiA9PiB0cmFuc2FjdGlvbi5pZCkpO1xuICAgICAgICB0aGlzLnNlbGVjdGVkVHJhbnNhY3Rpb25JZHMuZm9yRWFjaChpZCA9PiB7XG4gICAgICAgICAgICBpZiAoIXZhbGlkVHJhbnNhY3Rpb25JZHMuaGFzKGlkKSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRUcmFuc2FjdGlvbklkcy5kZWxldGUoaWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnNlbGVjdGVkVHlwZUZpbHRlcnMgPSB0aGlzLnNlbGVjdGVkVHlwZUZpbHRlcnMuZmlsdGVyKHR5cGUgPT5cbiAgICAgICAgICAgIE9iamVjdC52YWx1ZXMoVHJhbnNhY3Rpb25UeXBlKS5pbmNsdWRlcyh0eXBlKVxuICAgICAgICApO1xuICAgICAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLmVuYWJsZUFjY291bnRzKSB7XG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZXMgPSBbXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbGlkQWNjb3VudFJlZmVyZW5jZXMgPSBuZXcgU2V0KHRoaXMucGx1Z2luLmdldEFjY291bnRzKCkubWFwKGFjY291bnQgPT5cbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UoZm9ybWF0QWNjb3VudFJlZmVyZW5jZShhY2NvdW50LnR5cGUsIGFjY291bnQubmFtZSkpXG4gICAgICAgICAgICApKTtcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRBY2NvdW50UmVmZXJlbmNlcyA9IHRoaXMuc2VsZWN0ZWRBY2NvdW50UmVmZXJlbmNlcy5maWx0ZXIoYWNjb3VudFJlZmVyZW5jZSA9PlxuICAgICAgICAgICAgICAgIHZhbGlkQWNjb3VudFJlZmVyZW5jZXMuaGFzKGFjY291bnRSZWZlcmVuY2UpXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcyA9IHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5maWx0ZXIoY2F0ZWdvcnlJZCA9PlxuICAgICAgICAgICAgISF0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUJ5SWQoY2F0ZWdvcnlJZClcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBGaWx0ZXIgdHJhbnNhY3Rpb25zIGJhc2VkIG9uIHRoZSBkYXRlIHJhbmdlXG4gICAgICAgIHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMgPSB0aGlzLnRyYW5zYWN0aW9ucy5maWx0ZXIodHJhbnNhY3Rpb24gPT4ge1xuICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25EYXRlID0gcGFyc2VMb2NhbERhdGUodHJhbnNhY3Rpb24uZGF0ZSk7XG4gICAgICAgICAgICByZXR1cm4gdHJhbnNhY3Rpb25EYXRlID49IHRoaXMuZGF0ZVJhbmdlLnN0YXJ0RGF0ZSAmJiBcbiAgICAgICAgICAgICAgICAgICB0cmFuc2FjdGlvbkRhdGUgPD0gdGhpcy5kYXRlUmFuZ2UuZW5kRGF0ZTtcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICAvLyBBcHBseSBzZWFyY2ggZmlsdGVyIGlmIHRoZXJlJ3MgYSBzZWFyY2ggcXVlcnlcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRDYXRlZ29yeUlkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmZpbHRlcmVkVHJhbnNhY3Rpb25zID0gdGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5maWx0ZXIodHJhbnNhY3Rpb24gPT5cbiAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkQ2F0ZWdvcnlJZHMuaW5jbHVkZXModHJhbnNhY3Rpb24uY2F0ZWdvcnkpXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXBlRmlsdGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmZpbHRlcmVkVHJhbnNhY3Rpb25zID0gdGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5maWx0ZXIodHJhbnNhY3Rpb24gPT5cbiAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkVHlwZUZpbHRlcnMuaW5jbHVkZXModHJhbnNhY3Rpb24udHlwZSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMgPSB0aGlzLmZpbHRlcmVkVHJhbnNhY3Rpb25zLmZpbHRlcih0cmFuc2FjdGlvbiA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWNjb3VudFJlZmVyZW5jZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgICAgICAgICBhY2NvdW50UmVmZXJlbmNlcy5hZGQodGhpcy5wbHVnaW4ubm9ybWFsaXplVHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlKHRyYW5zYWN0aW9uLmFjY291bnQpKTtcbiAgICAgICAgICAgICAgICBpZiAodHJhbnNhY3Rpb24uZnJvbUFjY291bnQpIHtcbiAgICAgICAgICAgICAgICAgICAgYWNjb3VudFJlZmVyZW5jZXMuYWRkKHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi5mcm9tQWNjb3VudCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodHJhbnNhY3Rpb24udG9BY2NvdW50KSB7XG4gICAgICAgICAgICAgICAgICAgIGFjY291bnRSZWZlcmVuY2VzLmFkZCh0aGlzLnBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UodHJhbnNhY3Rpb24udG9BY2NvdW50KSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuc2VsZWN0ZWRBY2NvdW50UmVmZXJlbmNlcy5zb21lKHJlZmVyZW5jZSA9PiBhY2NvdW50UmVmZXJlbmNlcy5oYXMocmVmZXJlbmNlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnNlYXJjaFF1ZXJ5KSB7XG4gICAgICAgICAgICBjb25zdCBxdWVyeSA9IHRoaXMuc2VhcmNoUXVlcnkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMgPSB0aGlzLmZpbHRlcmVkVHJhbnNhY3Rpb25zLmZpbHRlcih0cmFuc2FjdGlvbiA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUJ5SWQodHJhbnNhY3Rpb24uY2F0ZWdvcnkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHR5cGVMYWJlbCA9IHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTkNPTUVcbiAgICAgICAgICAgICAgICAgICAgPyAnaW5jb21lJ1xuICAgICAgICAgICAgICAgICAgICA6IHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFXG4gICAgICAgICAgICAgICAgICAgICAgICA/ICdleHBlbnNlcydcbiAgICAgICAgICAgICAgICAgICAgICAgIDogJ2ludGVybmFsJztcbiAgICAgICAgICAgICAgICBjb25zdCBhY2NvdW50TmFtZXMgPSBbXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uLmFjY291bnQgPyB0aGlzLnBsdWdpbi5maW5kQWNjb3VudEJ5UmVmZXJlbmNlKHRyYW5zYWN0aW9uLmFjY291bnQpPy5uYW1lID8/ICcnIDogdGhpcy5wbHVnaW4uZ2V0RGVmYXVsdEFjY291bnQoKS5uYW1lLFxuICAgICAgICAgICAgICAgICAgICB0cmFuc2FjdGlvbi5mcm9tQWNjb3VudCA/IHRoaXMucGx1Z2luLmZpbmRBY2NvdW50QnlSZWZlcmVuY2UodHJhbnNhY3Rpb24uZnJvbUFjY291bnQpPy5uYW1lID8/ICcnIDogJycsXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uLnRvQWNjb3VudCA/IHRoaXMucGx1Z2luLmZpbmRBY2NvdW50QnlSZWZlcmVuY2UodHJhbnNhY3Rpb24udG9BY2NvdW50KT8ubmFtZSA/PyAnJyA6ICcnXG4gICAgICAgICAgICAgICAgXTtcbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hhYmxlVmFsdWVzID0gW1xuICAgICAgICAgICAgICAgICAgICB0cmFuc2FjdGlvbi5kZXNjcmlwdGlvbixcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNhY3Rpb24uY2F0ZWdvcnksXG4gICAgICAgICAgICAgICAgICAgIGNhdGVnb3J5Py5uYW1lID8/ICcnLFxuICAgICAgICAgICAgICAgICAgICBjYXRlZ29yeSA/IHRoaXMucGx1Z2luLmdldENhdGVnb3J5RW1vamkoY2F0ZWdvcnkuaWQpIDogJycsXG4gICAgICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uLm5vdGVzID8/ICcnLFxuICAgICAgICAgICAgICAgICAgICB0eXBlTGFiZWwsXG4gICAgICAgICAgICAgICAgICAgIC4uLmFjY291bnROYW1lc1xuICAgICAgICAgICAgICAgIF07XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gc2VhcmNoYWJsZVZhbHVlcy5zb21lKHZhbHVlID0+IHZhbHVlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBVcGRhdGUgcGFnaW5hdGlvblxuICAgICAgICB0aGlzLnRvdGFsUGFnZXMgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwodGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5sZW5ndGggLyB0aGlzLnBhZ2VTaXplKSk7XG4gICAgICAgIGlmIChyZXNldFBhZ2UpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSAxO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuY3VycmVudFBhZ2UgPiB0aGlzLnRvdGFsUGFnZXMpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSB0aGlzLnRvdGFsUGFnZXM7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRGaWx0ZXJlZFRyYW5zYWN0aW9uVG90YWxzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5yZWR1Y2UoXG4gICAgICAgICAgICAodG90YWxzLCB0cmFuc2FjdGlvbikgPT4ge1xuICAgICAgICAgICAgICAgIGlmICh0cmFuc2FjdGlvbi50eXBlID09PSBUcmFuc2FjdGlvblR5cGUuSU5DT01FKSB7XG4gICAgICAgICAgICAgICAgICAgIHRvdGFscy5pbmNvbWUgKz0gdHJhbnNhY3Rpb24uYW1vdW50O1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodHJhbnNhY3Rpb24udHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLkVYUEVOU0UpIHtcbiAgICAgICAgICAgICAgICAgICAgdG90YWxzLmV4cGVuc2VzICs9IHRyYW5zYWN0aW9uLmFtb3VudDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gdG90YWxzO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHsgaW5jb21lOiAwLCBleHBlbnNlczogMCB9XG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgcmVuZGVyVHJhbnNhY3Rpb25zTGlzdChjb250YWluZXI6IEhUTUxFbGVtZW50KSB7XG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uc1NlY3Rpb24gPSBjb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtdHJhbnNhY3Rpb25zLXNlY3Rpb24nKTtcbiAgICAgICAgXG4gICAgICAgIGlmICh0aGlzLmZpbHRlcmVkVHJhbnNhY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgLy8gTm8gdHJhbnNhY3Rpb25zIGZvdW5kXG4gICAgICAgICAgICBjb25zdCBlbXB0eVN0YXRlID0gdHJhbnNhY3Rpb25zU2VjdGlvbi5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1lbXB0eS1zdGF0ZScpO1xuICAgICAgICAgICAgZW1wdHlTdGF0ZS5jcmVhdGVFbCgnZGl2JywgeyB0ZXh0OiAn8J+TiycsIGNsczogJ2V4cGVuc2ljYS1lbXB0eS1zdGF0ZS1pY29uJyB9KTtcbiAgICAgICAgICAgIGVtcHR5U3RhdGUuY3JlYXRlRWwoJ3AnLCB7XG4gICAgICAgICAgICAgICAgdGV4dDogJ05vIHRyYW5zYWN0aW9ucyBmb3VuZCBtYXRjaGluZyB5b3VyIGZpbHRlcnMuJyxcbiAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtZW1wdHktc3RhdGUtbWVzc2FnZSdcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBUcmFuc2FjdGlvbnMgY29udGFpbmVyXG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uc0NvbnRhaW5lciA9IHRyYW5zYWN0aW9uc1NlY3Rpb24uY3JlYXRlRGl2KCdleHBlbnNpY2EtdHJhbnNhY3Rpb25zJyk7XG4gICAgICAgIFxuICAgICAgICAvLyBDYWxjdWxhdGUgcGFnaW5hdGlvblxuICAgICAgICBjb25zdCBzdGFydElkeCA9ICh0aGlzLmN1cnJlbnRQYWdlIC0gMSkgKiB0aGlzLnBhZ2VTaXplO1xuICAgICAgICBjb25zdCBlbmRJZHggPSBNYXRoLm1pbihzdGFydElkeCArIHRoaXMucGFnZVNpemUsIHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMubGVuZ3RoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEdldCBjdXJyZW50IHBhZ2UgdHJhbnNhY3Rpb25zXG4gICAgICAgIGNvbnN0IHBhZ2VUcmFuc2FjdGlvbnMgPSB0aGlzLmZpbHRlcmVkVHJhbnNhY3Rpb25zLnNsaWNlKHN0YXJ0SWR4LCBlbmRJZHgpO1xuICAgICAgICBjb25zdCBydW5uaW5nQmFsYW5jZXMgPSBnZXRSdW5uaW5nQmFsYW5jZUJ5VHJhbnNhY3Rpb25JZEZvckFjY291bnQoXG4gICAgICAgICAgICB0aGlzLnBsdWdpbixcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh1bmRlZmluZWQpLFxuICAgICAgICAgICAgdGhpcy50cmFuc2FjdGlvbnNcbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIHRoaXMucmVuZGVyVHJhbnNhY3Rpb25zVG9Db250YWluZXIodHJhbnNhY3Rpb25zQ29udGFpbmVyLCBwYWdlVHJhbnNhY3Rpb25zLCBydW5uaW5nQmFsYW5jZXMpO1xuICAgICAgICB0aGlzLnJlbmRlckJ1bGtTZWxlY3Rpb25Gb290ZXIodHJhbnNhY3Rpb25zU2VjdGlvbik7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZW5kZXJUcmFuc2FjdGlvbkdyb3VwVGl0bGUoY29udGFpbmVyOiBIVE1MRWxlbWVudCwgdGV4dDogc3RyaW5nLCBsZXZlbDogJ21vbnRoJyB8ICdkYXknKSB7XG4gICAgICAgIGNvbnN0IGhlYWRpbmdMZXZlbCA9IGxldmVsID09PSAnbW9udGgnID8gJ2gyJyA6ICdoMyc7XG4gICAgICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXIuY3JlYXRlRWwoaGVhZGluZ0xldmVsLCB7XG4gICAgICAgICAgICBjbHM6IGBleHBlbnNpY2EtdHJhbnNhY3Rpb24tZ3JvdXAtdGl0bGUgZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWdyb3VwLXRpdGxlLSR7bGV2ZWx9YFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAobGV2ZWwgPT09ICdkYXknKSB7XG4gICAgICAgICAgICBjb25zdCBpY29uRWwgPSB0aXRsZUVsLmNyZWF0ZVNwYW4oJ2V4cGVuc2ljYS10cmFuc2FjdGlvbi1ncm91cC10aXRsZS1pY29uJyk7XG4gICAgICAgICAgICBpY29uRWwuaW5uZXJIVE1MID0gJzxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHdpZHRoPVwiMTJcIiBoZWlnaHQ9XCIxMlwiIHZpZXdCb3g9XCIwIDAgMjQgMjRcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjJcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIj48cmVjdCB4PVwiM1wiIHk9XCI0XCIgd2lkdGg9XCIxOFwiIGhlaWdodD1cIjE4XCIgcng9XCIyXCIgcnk9XCIyXCI+PC9yZWN0PjxsaW5lIHgxPVwiMTZcIiB5MT1cIjJcIiB4Mj1cIjE2XCIgeTI9XCI2XCI+PC9saW5lPjxsaW5lIHgxPVwiOFwiIHkxPVwiMlwiIHgyPVwiOFwiIHkyPVwiNlwiPjwvbGluZT48bGluZSB4MT1cIjNcIiB5MT1cIjEwXCIgeDI9XCIyMVwiIHkyPVwiMTBcIj48L2xpbmU+PC9zdmc+JztcbiAgICAgICAgfVxuXG4gICAgICAgIHRpdGxlRWwuY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICB0ZXh0LFxuICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWdyb3VwLXRpdGxlLXRleHQnXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0VHJhbnNhY3Rpb25Nb250aEtleSh0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24pOiBzdHJpbmcge1xuICAgICAgICBjb25zdCBkYXRlID0gcGFyc2VMb2NhbERhdGUodHJhbnNhY3Rpb24uZGF0ZSk7XG4gICAgICAgIHJldHVybiBgJHtkYXRlLmdldEZ1bGxZZWFyKCl9LSR7U3RyaW5nKGRhdGUuZ2V0TW9udGgoKSArIDEpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFRyYW5zYWN0aW9uRGF5S2V5KHRyYW5zYWN0aW9uOiBUcmFuc2FjdGlvbik6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUxvY2FsRGF0ZSh0cmFuc2FjdGlvbi5kYXRlKTtcbiAgICAgICAgcmV0dXJuIGZvcm1hdERhdGUoZGF0ZSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRUcmFuc2FjdGlvbk1vbnRoTGFiZWwodHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHBhcnNlTG9jYWxEYXRlKHRyYW5zYWN0aW9uLmRhdGUpLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tVVMnLCB7XG4gICAgICAgICAgICBtb250aDogJ2xvbmcnLFxuICAgICAgICAgICAgeWVhcjogJ251bWVyaWMnXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0VHJhbnNhY3Rpb25EYXlMYWJlbCh0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24pOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gcGFyc2VMb2NhbERhdGUodHJhbnNhY3Rpb24uZGF0ZSkudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1VUycsIHtcbiAgICAgICAgICAgIHdlZWtkYXk6ICdsb25nJyxcbiAgICAgICAgICAgIG1vbnRoOiAnbG9uZycsXG4gICAgICAgICAgICBkYXk6ICdudW1lcmljJ1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlbmRlclRyYW5zYWN0aW9uQ2FyZFdpdGhFZGl0SGFuZGxlcihcbiAgICAgICAgY29udGFpbmVyOiBIVE1MRWxlbWVudCxcbiAgICAgICAgdHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uLFxuICAgICAgICBydW5uaW5nQmFsYW5jZUxhYmVsOiBzdHJpbmcsXG4gICAgICAgIHNlY29uZGFyeVJ1bm5pbmdCYWxhbmNlTGFiZWw/OiBzdHJpbmdcbiAgICApIHtcbiAgICAgICAgcmVuZGVyVHJhbnNhY3Rpb25DYXJkKGNvbnRhaW5lciwge1xuICAgICAgICAgICAgcGx1Z2luOiB0aGlzLnBsdWdpbixcbiAgICAgICAgICAgIHRyYW5zYWN0aW9uLFxuICAgICAgICAgICAgcnVubmluZ0JhbGFuY2VMYWJlbCxcbiAgICAgICAgICAgIHNlY29uZGFyeVJ1bm5pbmdCYWxhbmNlTGFiZWwsXG4gICAgICAgICAgICBvbkVkaXQ6ICh0cmFuc2FjdGlvbikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vZGFsID0gbmV3IFRyYW5zYWN0aW9uTW9kYWwodGhpcy5hcHAsIHRoaXMucGx1Z2luLCB0aGlzIGFzIGFueSwgdHJhbnNhY3Rpb24sIHRyYW5zYWN0aW9uLnR5cGUpO1xuICAgICAgICAgICAgICAgIG1vZGFsLm9wZW4oKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBvbkNhdGVnb3J5Q2hhbmdlOiBhc3luYyAodHJhbnNhY3Rpb24sIGNhdGVnb3J5SWQpID0+IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRyYW5zYWN0aW9uKHtcbiAgICAgICAgICAgICAgICAgICAgLi4udHJhbnNhY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgIGNhdGVnb3J5OiBjYXRlZ29yeUlkXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2VsZWN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIHNlbGVjdGVkOiB0aGlzLnNlbGVjdGVkVHJhbnNhY3Rpb25JZHMuaGFzKHRyYW5zYWN0aW9uLmlkKSxcbiAgICAgICAgICAgIG9uU2VsZWN0aW9uVG9nZ2xlOiAodHJhbnNhY3Rpb24sIHNlbGVjdGVkKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKHNlbGVjdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRUcmFuc2FjdGlvbklkcy5hZGQodHJhbnNhY3Rpb24uaWQpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRUcmFuc2FjdGlvbklkcy5kZWxldGUodHJhbnNhY3Rpb24uaWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLm1heWJlU2hvd01peGVkVHJhbnNhY3Rpb25UeXBlU2VsZWN0aW9uTm90aWNlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5zeW5jQnVsa1NlbGVjdGlvbkZvb3RlcigpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlbmRlckJ1bGtTZWxlY3Rpb25Gb290ZXIoY29udGFpbmVyOiBIVE1MRWxlbWVudCkge1xuICAgICAgICBjb250YWluZXIucXVlcnlTZWxlY3RvcignLmV4cGVuc2ljYS10cmFuc2FjdGlvbi1idWxrLWZvb3RlcicpPy5yZW1vdmUoKTtcbiAgICAgICAgY29uc3Qgc2VsZWN0ZWRUcmFuc2FjdGlvbnMgPSB0aGlzLmdldFNlbGVjdGVkVHJhbnNhY3Rpb25zKCk7XG4gICAgICAgIGlmIChzZWxlY3RlZFRyYW5zYWN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZvb3RlciA9IGNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS10cmFuc2FjdGlvbi1idWxrLWZvb3RlcicpO1xuICAgICAgICBjb25zdCBsZWZ0R3JvdXAgPSBmb290ZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtdHJhbnNhY3Rpb24tYnVsay1ncm91cCBleHBlbnNpY2EtdHJhbnNhY3Rpb24tYnVsay1ncm91cC1sZWZ0Jyk7XG4gICAgICAgIGNvbnN0IGNsZWFyQnV0dG9uID0gbGVmdEdyb3VwLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2Etc3RhbmRhcmQtYnV0dG9uIGV4cGVuc2ljYS1idG4gZXhwZW5zaWNhLWJ0bi1zZWNvbmRhcnkgZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWJ1bGstaWNvbi1idXR0b24gZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWJ1bGstY2xlYXInLFxuICAgICAgICAgICAgYXR0cjoge1xuICAgICAgICAgICAgICAgIHR5cGU6ICdidXR0b24nLFxuICAgICAgICAgICAgICAgICdhcmlhLWxhYmVsJzogJ0NsZWFyIHNlbGVjdGVkIHRyYW5zYWN0aW9ucycsXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdDbGVhciBzZWxlY3RlZCB0cmFuc2FjdGlvbnMnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjbGVhckJ1dHRvbi5pbm5lckhUTUwgPSAnPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgd2lkdGg9XCIxNFwiIGhlaWdodD1cIjE0XCIgdmlld0JveD1cIjAgMCAyNCAyNFwiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiMi40XCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PGxpbmUgeDE9XCIxOFwiIHkxPVwiNlwiIHgyPVwiNlwiIHkyPVwiMThcIj48L2xpbmU+PGxpbmUgeDE9XCI2XCIgeTE9XCI2XCIgeDI9XCIxOFwiIHkyPVwiMThcIj48L2xpbmU+PC9zdmc+JztcbiAgICAgICAgY2xlYXJCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmNsZWFyU2VsZWN0ZWRUcmFuc2FjdGlvbnMoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbGVmdEdyb3VwLmNyZWF0ZVNwYW4oe1xuICAgICAgICAgICAgdGV4dDogYCR7c2VsZWN0ZWRUcmFuc2FjdGlvbnMubGVuZ3RofSBzZWxlY3RlZGAsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtdHJhbnNhY3Rpb24tYnVsay1jb3VudCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgdmlzaWJsZVRyYW5zYWN0aW9ucyA9IHRoaXMuZ2V0VmlzaWJsZVBhZ2VUcmFuc2FjdGlvbnMoKTtcbiAgICAgICAgY29uc3QgYWxsVmlzaWJsZVNlbGVjdGVkID0gdmlzaWJsZVRyYW5zYWN0aW9ucy5sZW5ndGggPiAwXG4gICAgICAgICAgICAmJiB2aXNpYmxlVHJhbnNhY3Rpb25zLmV2ZXJ5KHRyYW5zYWN0aW9uID0+IHRoaXMuc2VsZWN0ZWRUcmFuc2FjdGlvbklkcy5oYXModHJhbnNhY3Rpb24uaWQpKTtcbiAgICAgICAgY29uc3Qgc2VsZWN0QWxsQnV0dG9uID0gbGVmdEdyb3VwLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICB0ZXh0OiAnU2VsZWN0IEFsbCcsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2Etc3RhbmRhcmQtYnV0dG9uIGV4cGVuc2ljYS10cmFuc2FjdGlvbi1idWxrLXNlbGVjdC1hbGwtYnRuJyxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICAnYXJpYS1sYWJlbCc6IGFsbFZpc2libGVTZWxlY3RlZCA/ICdBbGwgdmlzaWJsZSB0cmFuc2FjdGlvbnMgc2VsZWN0ZWQnIDogJ1NlbGVjdCBhbGwgdmlzaWJsZSB0cmFuc2FjdGlvbnMnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBzZWxlY3RBbGxCdXR0b24uZGlzYWJsZWQgPSBhbGxWaXNpYmxlU2VsZWN0ZWQ7XG4gICAgICAgIGlmIChhbGxWaXNpYmxlU2VsZWN0ZWQpIHtcbiAgICAgICAgICAgIHNlbGVjdEFsbEJ1dHRvbi50aXRsZSA9ICdBbGwgdmlzaWJsZSB0cmFuc2FjdGlvbnMgYXJlIGFscmVhZHkgc2VsZWN0ZWQuJztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNlbGVjdEFsbEJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgICAgICAgICB2aXNpYmxlVHJhbnNhY3Rpb25zLmZvckVhY2godHJhbnNhY3Rpb24gPT4gdGhpcy5zZWxlY3RlZFRyYW5zYWN0aW9uSWRzLmFkZCh0cmFuc2FjdGlvbi5pZCkpO1xuICAgICAgICAgICAgICAgIHRoaXMubWF5YmVTaG93TWl4ZWRUcmFuc2FjdGlvblR5cGVTZWxlY3Rpb25Ob3RpY2UoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnN5bmNWaXNpYmxlVHJhbnNhY3Rpb25TZWxlY3Rpb25TdGF0ZSgpO1xuICAgICAgICAgICAgICAgIHRoaXMuc3luY0J1bGtTZWxlY3Rpb25Gb290ZXIoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VsZWN0ZWRUeXBlcyA9IG5ldyBTZXQoc2VsZWN0ZWRUcmFuc2FjdGlvbnMubWFwKHRyYW5zYWN0aW9uID0+IHRyYW5zYWN0aW9uLnR5cGUpKTtcbiAgICAgICAgY29uc3QgaGFzTWl4ZWRUeXBlcyA9IHNlbGVjdGVkVHlwZXMuc2l6ZSA+IDE7XG4gICAgICAgIGNvbnN0IGhhc0ludGVybmFsT25seSA9IHNlbGVjdGVkVHlwZXMuc2l6ZSA9PT0gMSAmJiBzZWxlY3RlZFR5cGVzLmhhcyhUcmFuc2FjdGlvblR5cGUuSU5URVJOQUwpO1xuICAgICAgICBjb25zdCBhY3Rpb25zR3JvdXAgPSBmb290ZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtdHJhbnNhY3Rpb24tYnVsay1ncm91cCBleHBlbnNpY2EtdHJhbnNhY3Rpb24tYnVsay1ncm91cC1yaWdodCcpO1xuICAgICAgICBjb25zdCBjYXRlZ29yeUJ1dHRvbiA9IGFjdGlvbnNHcm91cC5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgdGV4dDogJ0NhdGVnb3J5JyxcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1zdGFuZGFyZC1idXR0b24gZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWJ1bGstY2F0ZWdvcnktYnRuJyxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICAnYXJpYS1sYWJlbCc6IGhhc01peGVkVHlwZXMgPyAnQ2F0ZWdvcnkgdW5hdmFpbGFibGUgZm9yIG1peGVkIHRyYW5zYWN0aW9uIHR5cGVzJyA6ICdDaGFuZ2UgY2F0ZWdvcnkgZm9yIHNlbGVjdGVkIHRyYW5zYWN0aW9ucydcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGhhc01peGVkVHlwZXMgfHwgaGFzSW50ZXJuYWxPbmx5KSB7XG4gICAgICAgICAgICBjYXRlZ29yeUJ1dHRvbi5kaXNhYmxlZCA9IHRydWU7XG4gICAgICAgICAgICBjYXRlZ29yeUJ1dHRvbi50aXRsZSA9IGhhc0ludGVybmFsT25seVxuICAgICAgICAgICAgICAgID8gJ0ludGVybmFsIHRyYW5zYWN0aW9uIGNhdGVnb3J5IGNhbm5vdCBiZSBjaGFuZ2VkLidcbiAgICAgICAgICAgICAgICA6ICdTZWxlY3Qgb25seSBpbmNvbWUgb3Igb25seSBleHBlbnNlIHRyYW5zYWN0aW9ucyB0byBidWxrIGNoYW5nZSBjYXRlZ29yeS4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2F0ZWdvcnlCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5VHlwZSA9IHNlbGVjdGVkVHJhbnNhY3Rpb25zWzBdLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTkNPTUVcbiAgICAgICAgICAgICAgICAgICAgPyBDYXRlZ29yeVR5cGUuSU5DT01FXG4gICAgICAgICAgICAgICAgICAgIDogQ2F0ZWdvcnlUeXBlLkVYUEVOU0U7XG4gICAgICAgICAgICAgICAgc2hvd1RyYW5zYWN0aW9uQnVsa0NhdGVnb3J5TWVudShjYXRlZ29yeUJ1dHRvbiwgdGhpcy5wbHVnaW4sIGNhdGVnb3J5VHlwZSwgYXN5bmMgKGNhdGVnb3J5SWQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5idWxrVXBkYXRlU2VsZWN0ZWRUcmFuc2FjdGlvbnNDYXRlZ29yeShjYXRlZ29yeUlkKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGVsZXRlQnV0dG9uID0gYWN0aW9uc0dyb3VwLmNyZWF0ZUVsKCdidXR0b24nLCB7XG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2Etc3RhbmRhcmQtYnV0dG9uIGV4cGVuc2ljYS1idG4gZXhwZW5zaWNhLWJ0bi1kYW5nZXItc29saWQgZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWJ1bGstaWNvbi1idXR0b24gZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWJ1bGstZGVsZXRlJyxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnYnV0dG9uJyxcbiAgICAgICAgICAgICAgICAnYXJpYS1sYWJlbCc6ICdEZWxldGUgc2VsZWN0ZWQgdHJhbnNhY3Rpb25zJyxcbiAgICAgICAgICAgICAgICB0aXRsZTogJ0RlbGV0ZSBzZWxlY3RlZCB0cmFuc2FjdGlvbnMnXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBkZWxldGVCdXR0b24uaW5uZXJIVE1MID0gJzxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHdpZHRoPVwiMTRcIiBoZWlnaHQ9XCIxNFwiIHZpZXdCb3g9XCIwIDAgMjQgMjRcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjIuMlwiIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwb2x5bGluZSBwb2ludHM9XCIzIDYgNSA2IDIxIDZcIj48L3BvbHlsaW5lPjxwYXRoIGQ9XCJNMTkgNnYxNGEyIDIgMCAwIDEtMiAySDdhMiAyIDAgMCAxLTItMlY2bTMgMFY0YTIgMiAwIDAgMSAyLTJoNGEyIDIgMCAwIDEgMiAydjJcIj48L3BhdGg+PGxpbmUgeDE9XCIxMFwiIHkxPVwiMTFcIiB4Mj1cIjEwXCIgeTI9XCIxN1wiPjwvbGluZT48bGluZSB4MT1cIjE0XCIgeTE9XCIxMVwiIHgyPVwiMTRcIiB5Mj1cIjE3XCI+PC9saW5lPjwvc3ZnPic7XG4gICAgICAgIGRlbGV0ZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5kZWxldGVTZWxlY3RlZFRyYW5zYWN0aW9ucygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFNlbGVjdGVkVHJhbnNhY3Rpb25zKCk6IFRyYW5zYWN0aW9uW10ge1xuICAgICAgICByZXR1cm4gdGhpcy50cmFuc2FjdGlvbnMuZmlsdGVyKHRyYW5zYWN0aW9uID0+IHRoaXMuc2VsZWN0ZWRUcmFuc2FjdGlvbklkcy5oYXModHJhbnNhY3Rpb24uaWQpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFZpc2libGVQYWdlVHJhbnNhY3Rpb25zKCk6IFRyYW5zYWN0aW9uW10ge1xuICAgICAgICBjb25zdCBzdGFydElkeCA9ICh0aGlzLmN1cnJlbnRQYWdlIC0gMSkgKiB0aGlzLnBhZ2VTaXplO1xuICAgICAgICBjb25zdCBlbmRJZHggPSBNYXRoLm1pbihzdGFydElkeCArIHRoaXMucGFnZVNpemUsIHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMubGVuZ3RoKTtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMuc2xpY2Uoc3RhcnRJZHgsIGVuZElkeCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjbGVhclNlbGVjdGVkVHJhbnNhY3Rpb25zKCkge1xuICAgICAgICB0aGlzLnNlbGVjdGVkVHJhbnNhY3Rpb25JZHMuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5zeW5jVmlzaWJsZVRyYW5zYWN0aW9uU2VsZWN0aW9uU3RhdGUoKTtcbiAgICAgICAgdGhpcy5zeW5jQnVsa1NlbGVjdGlvbkZvb3RlcigpO1xuICAgIH1cblxuICAgIHByaXZhdGUgbWF5YmVTaG93TWl4ZWRUcmFuc2FjdGlvblR5cGVTZWxlY3Rpb25Ob3RpY2UoKSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdGVkVHJhbnNhY3Rpb25zID0gdGhpcy5nZXRTZWxlY3RlZFRyYW5zYWN0aW9ucygpO1xuICAgICAgICBjb25zdCBoYXNNaXhlZFR5cGVzID0gbmV3IFNldChzZWxlY3RlZFRyYW5zYWN0aW9ucy5tYXAodHJhbnNhY3Rpb24gPT4gdHJhbnNhY3Rpb24udHlwZSkpLnNpemUgPiAxO1xuICAgICAgICBpZiAoaGFzTWl4ZWRUeXBlcykge1xuICAgICAgICAgICAgc2hvd0V4cGVuc2ljYU5vdGljZSgnWW91IGNhbiBvbmx5IGNoYW5nZSBvbmUgdHJhbnNhY3Rpb24gdHlwZSBhdCBhIHRpbWU6IEluY29tZSBvciBFeHBlbnNlcy4nKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgYnVsa1VwZGF0ZVNlbGVjdGVkVHJhbnNhY3Rpb25zQ2F0ZWdvcnkoY2F0ZWdvcnlJZDogc3RyaW5nKSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdGVkVHJhbnNhY3Rpb25zID0gdGhpcy5nZXRTZWxlY3RlZFRyYW5zYWN0aW9ucygpO1xuICAgICAgICBpZiAoc2VsZWN0ZWRUcmFuc2FjdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChzZWxlY3RlZFRyYW5zYWN0aW9ucy5tYXAodHJhbnNhY3Rpb24gPT5cbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnVwZGF0ZVRyYW5zYWN0aW9uKHtcbiAgICAgICAgICAgICAgICAuLi50cmFuc2FjdGlvbixcbiAgICAgICAgICAgICAgICBjYXRlZ29yeTogY2F0ZWdvcnlJZFxuICAgICAgICAgICAgfSwgdGhpcylcbiAgICAgICAgKSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkVHJhbnNhY3Rpb25zRGF0YShmYWxzZSk7XG4gICAgICAgIHRoaXMuc2VsZWN0ZWRUcmFuc2FjdGlvbklkcy5jbGVhcigpO1xuICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICBzaG93RXhwZW5zaWNhTm90aWNlKCdUcmFuc2FjdGlvbnMgdXBkYXRlZCBzdWNjZXNzZnVsbHknKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIGRlbGV0ZVNlbGVjdGVkVHJhbnNhY3Rpb25zKCkge1xuICAgICAgICBjb25zdCBzZWxlY3RlZFRyYW5zYWN0aW9ucyA9IHRoaXMuZ2V0U2VsZWN0ZWRUcmFuc2FjdGlvbnMoKTtcbiAgICAgICAgaWYgKHNlbGVjdGVkVHJhbnNhY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbmV3IENvbmZpcm1hdGlvbk1vZGFsKFxuICAgICAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgICAgICAnRGVsZXRlIFRyYW5zYWN0aW9ucz8nLFxuICAgICAgICAgICAgYEFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBkZWxldGUgJHtzZWxlY3RlZFRyYW5zYWN0aW9ucy5sZW5ndGh9IHNlbGVjdGVkIHRyYW5zYWN0aW9ucz8gVGhpcyBhY3Rpb24gY2Fubm90IGJlIHVuZG9uZS5gLFxuICAgICAgICAgICAgYXN5bmMgKGNvbmZpcm1lZCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghY29uZmlybWVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChzZWxlY3RlZFRyYW5zYWN0aW9ucy5tYXAodHJhbnNhY3Rpb24gPT5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGVsZXRlVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24uaWQsIHRoaXMpXG4gICAgICAgICAgICAgICAgKSk7XG4gICAgICAgICAgICAgICAgdGhpcy5zZWxlY3RlZFRyYW5zYWN0aW9uSWRzLmNsZWFyKCk7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb2FkVHJhbnNhY3Rpb25zRGF0YShmYWxzZSk7XG4gICAgICAgICAgICAgICAgdGhpcy5wZXJzaXN0VHJhbnNhY3Rpb25zU3RhdGUoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICAgICAgICAgIHNob3dFeHBlbnNpY2FOb3RpY2UoJ1RyYW5zYWN0aW9ucyBkZWxldGVkIHN1Y2Nlc3NmdWxseScpO1xuICAgICAgICAgICAgfVxuICAgICAgICApLm9wZW4oKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN5bmNCdWxrU2VsZWN0aW9uRm9vdGVyKCkge1xuICAgICAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmdldEFjdGl2ZUNvbnRlbnRFbCgpLnF1ZXJ5U2VsZWN0b3IoJy5leHBlbnNpY2EtdHJhbnNhY3Rpb25zLXNlY3Rpb24nKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghY29udGFpbmVyKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnJlbmRlckJ1bGtTZWxlY3Rpb25Gb290ZXIoY29udGFpbmVyKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN5bmNWaXNpYmxlVHJhbnNhY3Rpb25TZWxlY3Rpb25TdGF0ZSgpIHtcbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5nZXRBY3RpdmVDb250ZW50RWwoKTtcbiAgICAgICAgY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCcuZXhwZW5zaWNhLXRyYW5zYWN0aW9uW2RhdGEtdHJhbnNhY3Rpb24taWRdJykuZm9yRWFjaChjYXJkID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uSWQgPSBjYXJkLmdldEF0dHJpYnV0ZSgnZGF0YS10cmFuc2FjdGlvbi1pZCcpO1xuICAgICAgICAgICAgY29uc3QgaXNTZWxlY3RlZCA9ICEhdHJhbnNhY3Rpb25JZCAmJiB0aGlzLnNlbGVjdGVkVHJhbnNhY3Rpb25JZHMuaGFzKHRyYW5zYWN0aW9uSWQpO1xuICAgICAgICAgICAgY2FyZC50b2dnbGVDbGFzcygnaXMtc2VsZWN0ZWQnLCBpc1NlbGVjdGVkKTtcblxuICAgICAgICAgICAgY29uc3Qgc2VsZWN0b3IgPSBjYXJkLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KCcuZXhwZW5zaWNhLXRyYW5zYWN0aW9uLXNlbGVjdG9yJyk7XG4gICAgICAgICAgICBzZWxlY3Rvcj8udG9nZ2xlQ2xhc3MoJ2lzLXNlbGVjdGVkJywgaXNTZWxlY3RlZCk7XG4gICAgICAgICAgICBzZWxlY3Rvcj8uc2V0QXR0cmlidXRlKCdhcmlhLXByZXNzZWQnLCBTdHJpbmcoaXNTZWxlY3RlZCkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBnZXRQYWdpbmF0aW9uV2luZG93KCk6IG51bWJlcltdIHtcbiAgICAgICAgY29uc3QgdmlzaWJsZVBhZ2VDb3VudCA9IE1hdGgubWluKDMsIHRoaXMudG90YWxQYWdlcyk7XG4gICAgICAgIGNvbnN0IG1heFN0YXJ0UGFnZSA9IHRoaXMudG90YWxQYWdlcyAtIHZpc2libGVQYWdlQ291bnQgKyAxO1xuICAgICAgICBjb25zdCBzdGFydFBhZ2UgPSBNYXRoLm1heCgxLCBNYXRoLm1pbih0aGlzLmN1cnJlbnRQYWdlIC0gMSwgbWF4U3RhcnRQYWdlKSk7XG5cbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20oeyBsZW5ndGg6IHZpc2libGVQYWdlQ291bnQgfSwgKF8sIGluZGV4KSA9PiBzdGFydFBhZ2UgKyBpbmRleCk7XG4gICAgfVxuXG4gICAgc2V0Q3VycmVudFBhZ2UocGFnZTogbnVtYmVyLCBzY3JvbGxUb1RvcCA9IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IG5leHRQYWdlID0gTWF0aC5tYXgoMSwgTWF0aC5taW4ocGFnZSwgdGhpcy50b3RhbFBhZ2VzKSk7XG5cbiAgICAgICAgaWYgKG5leHRQYWdlID09PSB0aGlzLmN1cnJlbnRQYWdlKSByZXR1cm47XG5cbiAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IG5leHRQYWdlO1xuICAgICAgICBpZiAoc2Nyb2xsVG9Ub3ApIHtcbiAgICAgICAgICAgIHRoaXMuc2Nyb2xsVG9wID0gMDtcbiAgICAgICAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5yZXF1ZXN0U2F2ZUxheW91dCgpO1xuICAgICAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoZmFsc2UpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5wZXJzaXN0VHJhbnNhY3Rpb25zU3RhdGUoKTtcbiAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoKTtcbiAgICB9XG5cbiAgICByZW5kZXJQYWdpbmF0aW9uQnV0dG9uKFxuICAgICAgICBjb250YWluZXI6IEhUTUxFbGVtZW50LFxuICAgICAgICBsYWJlbDogc3RyaW5nLFxuICAgICAgICBhcmlhTGFiZWw6IHN0cmluZyxcbiAgICAgICAgaXNEaXNhYmxlZDogYm9vbGVhbixcbiAgICAgICAgb25DbGljazogKCkgPT4gdm9pZCxcbiAgICAgICAgZXh0cmFDbGFzcyA9ICcnXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGJ1dHRvbiA9IGNvbnRhaW5lci5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgY2xzOiBgZXhwZW5zaWNhLXN0YW5kYXJkLWJ1dHRvbiBleHBlbnNpY2EtcGFnaW5hdGlvbi1idG4gJHtleHRyYUNsYXNzfSAke2lzRGlzYWJsZWQgPyAnZGlzYWJsZWQnIDogJyd9YC50cmltKCksXG4gICAgICAgICAgICB0ZXh0OiBsYWJlbCxcbiAgICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgICAgICAnYXJpYS1sYWJlbCc6IGFyaWFMYWJlbCxcbiAgICAgICAgICAgICAgICB0aXRsZTogYXJpYUxhYmVsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgICAgIGlmICghaXNEaXNhYmxlZCkge1xuICAgICAgICAgICAgICAgIG9uQ2xpY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJ1dHRvbjtcbiAgICB9XG5cbiAgICByZW5kZXJQYWdlU2l6ZVNlbGVjdG9yKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpIHtcbiAgICAgICAgY29uc3Qgc2VsZWN0b3IgPSBjb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtcGFnZS1zaXplLXNlbGVjdG9yIGV4cGVuc2ljYS1kYXRlLXJhbmdlLXNlbGVjdG9yJyk7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRTZWxlY3Rpb24gPSBzZWxlY3Rvci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1wYWdlLXNpemUtY3VycmVudCBleHBlbnNpY2EtZGF0ZS1yYW5nZS1jdXJyZW50Jyk7XG4gICAgICAgIGN1cnJlbnRTZWxlY3Rpb24uY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICB0ZXh0OiBTdHJpbmcodGhpcy5wYWdlU2l6ZSksXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtZGF0ZS1yYW5nZS10ZXh0J1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBkcm9wZG93bkljb24gPSBjdXJyZW50U2VsZWN0aW9uLmNyZWF0ZVNwYW4oeyBjbHM6ICdleHBlbnNpY2EtZGF0ZS1yYW5nZS1pY29uJyB9KTtcbiAgICAgICAgZHJvcGRvd25JY29uLmlubmVySFRNTCA9ICc8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB3aWR0aD1cIjE0XCIgaGVpZ2h0PVwiMTRcIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIyXCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCI+PHBvbHlsaW5lIHBvaW50cz1cIjYgOSAxMiAxNSAxOCA5XCI+PC9wb2x5bGluZT48L3N2Zz4nO1xuXG4gICAgICAgIGNvbnN0IG9wdGlvbnNDb250YWluZXIgPSBzZWxlY3Rvci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1kYXRlLXJhbmdlLW9wdGlvbnMgZXhwZW5zaWNhLWRhdGUtcmFuZ2UtaGlkZGVuJyk7XG5cbiAgICAgICAgWzEwLCAyMCwgNTAsIDEwMF0uZm9yRWFjaChzaXplID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbkl0ZW0gPSBvcHRpb25zQ29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWRhdGUtcmFuZ2Utb3B0aW9uJyk7XG4gICAgICAgICAgICBvcHRpb25JdGVtLnRleHRDb250ZW50ID0gU3RyaW5nKHNpemUpO1xuXG4gICAgICAgICAgICBpZiAoc2l6ZSA9PT0gdGhpcy5wYWdlU2l6ZSkge1xuICAgICAgICAgICAgICAgIG9wdGlvbkl0ZW0uYWRkQ2xhc3MoJ2V4cGVuc2ljYS1kYXRlLXJhbmdlLW9wdGlvbi1hY3RpdmUnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb3B0aW9uSXRlbS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIHRoaXMucGFnZVNpemUgPSBzaXplO1xuICAgICAgICAgICAgICAgIHRoaXMuYXBwbHlGaWx0ZXJzKHRydWUpO1xuICAgICAgICAgICAgICAgIHRoaXMucGVyc2lzdFRyYW5zYWN0aW9uc1N0YXRlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgIGNvbnN0IGlzSGlkZGVuID0gb3B0aW9uc0NvbnRhaW5lci5oYXNDbGFzcygnZXhwZW5zaWNhLWRhdGUtcmFuZ2UtaGlkZGVuJyk7XG4gICAgICAgICAgICBvcHRpb25zQ29udGFpbmVyLnRvZ2dsZUNsYXNzKCdleHBlbnNpY2EtZGF0ZS1yYW5nZS1oaWRkZW4nLCAhaXNIaWRkZW4pO1xuXG4gICAgICAgICAgICBpZiAoaXNIaWRkZW4pIHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zQ29udGFpbmVyLmFkZENsYXNzKCdleHBlbnNpY2EtZGF0ZS1yYW5nZS1oaWRkZW4nKTtcbiAgICAgICAgICAgICAgICAgICAgfSwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICByZW5kZXJQYWdpbmF0aW9uKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsIHBsYWNlbWVudDogJ3RvcCcgfCAnYm90dG9tJykge1xuICAgICAgICBpZiAodGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgICAvLyBDaGVjayBmb3IgZXhpc3RpbmcgcGFnaW5hdGlvbiBpbiB0aGlzIHBsYWNlbWVudCBhbmQgcmVtb3ZlIGl0XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUGFnaW5hdGlvbiA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKGAuZXhwZW5zaWNhLXBhZ2luYXRpb24tJHtwbGFjZW1lbnR9YCk7XG4gICAgICAgIGlmIChleGlzdGluZ1BhZ2luYXRpb24pIHtcbiAgICAgICAgICAgIGV4aXN0aW5nUGFnaW5hdGlvbi5yZW1vdmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBhZ2luYXRpb25TZWN0aW9uID0gY29udGFpbmVyLmNyZWF0ZURpdihgZXhwZW5zaWNhLXBhZ2luYXRpb24gZXhwZW5zaWNhLXBhZ2luYXRpb24tJHtwbGFjZW1lbnR9YCk7XG4gICAgICAgIFxuICAgICAgICAvLyBOYXZpZ2F0aW9uIGJ1dHRvbnMgY29udGFpbmVyXG4gICAgICAgIGNvbnN0IG5hdmlnYXRpb25Db250YWluZXIgPSBwYWdpbmF0aW9uU2VjdGlvbi5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1wYWdpbmF0aW9uLW5hdicpO1xuICAgICAgICBcbiAgICAgICAgLy8gRmlyc3QgcGFnZSBidXR0b25cbiAgICAgICAgdGhpcy5yZW5kZXJQYWdpbmF0aW9uQnV0dG9uKFxuICAgICAgICAgICAgbmF2aWdhdGlvbkNvbnRhaW5lcixcbiAgICAgICAgICAgICcxJyxcbiAgICAgICAgICAgICdGaXJzdCBwYWdlJyxcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPT09IDEsXG4gICAgICAgICAgICAoKSA9PiB0aGlzLnNldEN1cnJlbnRQYWdlKDEsIHBsYWNlbWVudCA9PT0gJ2JvdHRvbScpXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gUHJldmlvdXMgcGFnZSBidXR0b25cbiAgICAgICAgdGhpcy5yZW5kZXJQYWdpbmF0aW9uQnV0dG9uKFxuICAgICAgICAgICAgbmF2aWdhdGlvbkNvbnRhaW5lcixcbiAgICAgICAgICAgICc8JyxcbiAgICAgICAgICAgICdQcmV2aW91cyBwYWdlJyxcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPT09IDEsXG4gICAgICAgICAgICAoKSA9PiB0aGlzLnNldEN1cnJlbnRQYWdlKHRoaXMuY3VycmVudFBhZ2UgLSAxLCBwbGFjZW1lbnQgPT09ICdib3R0b20nKVxuICAgICAgICApO1xuXG4gICAgICAgIC8vIFNsaWRpbmcgcGFnZSBidXR0b25zXG4gICAgICAgIHRoaXMuZ2V0UGFnaW5hdGlvbldpbmRvdygpLmZvckVhY2gocGFnZSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlbmRlclBhZ2luYXRpb25CdXR0b24oXG4gICAgICAgICAgICAgICAgbmF2aWdhdGlvbkNvbnRhaW5lcixcbiAgICAgICAgICAgICAgICBTdHJpbmcocGFnZSksXG4gICAgICAgICAgICAgICAgYFBhZ2UgJHtwYWdlfSBvZiAke3RoaXMudG90YWxQYWdlc31gLFxuICAgICAgICAgICAgICAgIGZhbHNlLFxuICAgICAgICAgICAgICAgICgpID0+IHRoaXMuc2V0Q3VycmVudFBhZ2UocGFnZSwgcGxhY2VtZW50ID09PSAnYm90dG9tJyksXG4gICAgICAgICAgICAgICAgcGFnZSA9PT0gdGhpcy5jdXJyZW50UGFnZSA/ICdhY3RpdmUnIDogJydcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIE5leHQgcGFnZSBidXR0b25cbiAgICAgICAgdGhpcy5yZW5kZXJQYWdpbmF0aW9uQnV0dG9uKFxuICAgICAgICAgICAgbmF2aWdhdGlvbkNvbnRhaW5lcixcbiAgICAgICAgICAgICc+JyxcbiAgICAgICAgICAgICdOZXh0IHBhZ2UnLFxuICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9PT0gdGhpcy50b3RhbFBhZ2VzLFxuICAgICAgICAgICAgKCkgPT4gdGhpcy5zZXRDdXJyZW50UGFnZSh0aGlzLmN1cnJlbnRQYWdlICsgMSwgcGxhY2VtZW50ID09PSAnYm90dG9tJylcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBMYXN0IHBhZ2UgYnV0dG9uXG4gICAgICAgIHRoaXMucmVuZGVyUGFnaW5hdGlvbkJ1dHRvbihcbiAgICAgICAgICAgIG5hdmlnYXRpb25Db250YWluZXIsXG4gICAgICAgICAgICBTdHJpbmcodGhpcy50b3RhbFBhZ2VzKSxcbiAgICAgICAgICAgICdMYXN0IHBhZ2UnLFxuICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9PT0gdGhpcy50b3RhbFBhZ2VzLFxuICAgICAgICAgICAgKCkgPT4gdGhpcy5zZXRDdXJyZW50UGFnZSh0aGlzLnRvdGFsUGFnZXMsIHBsYWNlbWVudCA9PT0gJ2JvdHRvbScpXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gSXRlbXMgcGVyIHBhZ2Ugc2VsZWN0b3IgY29udGFpbmVyXG4gICAgICAgIGNvbnN0IGl0ZW1zUGVyUGFnZUNvbnRhaW5lciA9IHBhZ2luYXRpb25TZWN0aW9uLmNyZWF0ZURpdignZXhwZW5zaWNhLWl0ZW1zLXBlci1wYWdlJyk7XG4gICAgICAgIGl0ZW1zUGVyUGFnZUNvbnRhaW5lci5jcmVhdGVFbCgnc3BhbicsIHsgdGV4dDogJ1BlciBQYWdlOicgfSk7XG4gICAgICAgIHRoaXMucmVuZGVyUGFnZVNpemVTZWxlY3RvcihpdGVtc1BlclBhZ2VDb250YWluZXIpO1xuICAgIH1cblxuICAgIHJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seShwcmVzZXJ2ZVNjcm9sbCA9IHRydWUpIHtcbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5nZXRBY3RpdmVDb250ZW50RWwoKTtcbiAgICAgICAgaWYgKHByZXNlcnZlU2Nyb2xsKSB7XG4gICAgICAgICAgICB0aGlzLnJlbWVtYmVyU2Nyb2xsUG9zaXRpb24oKTtcbiAgICAgICAgfVxuICAgICAgICBjb250YWluZXIuYWRkQ2xhc3MoJ2V4cGVuc2ljYS1zdXBwcmVzcy1tb3Rpb24nKTtcblxuICAgICAgICBjb25zdCBjb3VudEVsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5leHBlbnNpY2EtdHJhbnNhY3Rpb24tY291bnQtY2hpcCcpO1xuICAgICAgICBpZiAoY291bnRFbCkge1xuICAgICAgICAgICAgY291bnRFbC50ZXh0Q29udGVudCA9IHRoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMubGVuZ3RoID4gMCA/IGAke3RoaXMuZmlsdGVyZWRUcmFuc2FjdGlvbnMubGVuZ3RofSB0b3RhbGAgOiAnJztcbiAgICAgICAgICAgIGNvdW50RWwuY2xhc3NMaXN0LnRvZ2dsZSgnaXMtaGlkZGVuJywgdGhpcy5maWx0ZXJlZFRyYW5zYWN0aW9ucy5sZW5ndGggPT09IDApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdG90YWxzID0gdGhpcy5nZXRGaWx0ZXJlZFRyYW5zYWN0aW9uVG90YWxzKCk7XG4gICAgICAgIGNvbnN0IHRpdGxlQ29udGFpbmVyID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5leHBlbnNpY2EtdHJhbnNhY3Rpb24tdG90YWwtY2hpcHMnKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICh0aXRsZUNvbnRhaW5lcikge1xuICAgICAgICAgICAgdGhpcy5zeW5jVHJhbnNhY3Rpb25Ub3RhbENoaXAodGl0bGVDb250YWluZXIsICdzcGVudCcsIHRvdGFscy5leHBlbnNlcyk7XG4gICAgICAgICAgICB0aGlzLnN5bmNUcmFuc2FjdGlvblRvdGFsQ2hpcCh0aXRsZUNvbnRhaW5lciwgJ2luY29tZScsIHRvdGFscy5pbmNvbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5leHBlbnNpY2EtdHJhbnNhY3Rpb25zLXNlY3Rpb24nKT8ucmVtb3ZlKCk7XG4gICAgICAgIGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yQWxsKCcuZXhwZW5zaWNhLXBhZ2luYXRpb24nKS5mb3JFYWNoKHNlY3Rpb24gPT4gc2VjdGlvbi5yZW1vdmUoKSk7XG5cbiAgICAgICAgdGhpcy5yZW5kZXJQYWdpbmF0aW9uKGNvbnRhaW5lciwgJ3RvcCcpO1xuICAgICAgICB0aGlzLnJlbmRlclRyYW5zYWN0aW9uc0xpc3QoY29udGFpbmVyKTtcbiAgICAgICAgdGhpcy5yZW5kZXJQYWdpbmF0aW9uKGNvbnRhaW5lciwgJ2JvdHRvbScpO1xuICAgICAgICB0aGlzLnJlc3RvcmVTY3JvbGxQb3NpdGlvbigpO1xuICAgIH1cblxuICAgIGFzeW5jIGFkZFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uOiBUcmFuc2FjdGlvbikge1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hZGRUcmFuc2FjdGlvbih0cmFuc2FjdGlvbiwgdGhpcyk7XG4gICAgICAgIFxuICAgICAgICAvLyBSZWZyZXNoIHRyYW5zYWN0aW9ucyB3aXRob3V0IHJlc2V0dGluZyB0aGUgdXNlcidzIGN1cnJlbnQgZmlsdGVyL3BhZ2UgY29udGV4dC5cbiAgICAgICAgYXdhaXQgdGhpcy5sb2FkVHJhbnNhY3Rpb25zRGF0YShmYWxzZSk7XG4gICAgICAgIHRoaXMucGVyc2lzdFRyYW5zYWN0aW9uc1N0YXRlKCk7XG4gICAgICAgIHRoaXMucmVmcmVzaFRyYW5zYWN0aW9uc0xpc3RPbmx5KCk7XG4gICAgfVxuXG4gICAgYXN5bmMgdXBkYXRlVHJhbnNhY3Rpb24odHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnVwZGF0ZVRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uLCB0aGlzKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlZnJlc2ggdHJhbnNhY3Rpb25zIHdpdGhvdXQgcmVzZXR0aW5nIHRoZSB1c2VyJ3MgY3VycmVudCBmaWx0ZXIvcGFnZSBjb250ZXh0LlxuICAgICAgICBhd2FpdCB0aGlzLmxvYWRUcmFuc2FjdGlvbnNEYXRhKGZhbHNlKTtcbiAgICAgICAgdGhpcy5wZXJzaXN0VHJhbnNhY3Rpb25zU3RhdGUoKTtcbiAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoKTtcbiAgICB9XG5cbiAgICBhc3luYyBkZWxldGVUcmFuc2FjdGlvbihpZDogc3RyaW5nLCBvbkRlbGV0ZWQ/OiAoKSA9PiB2b2lkLCBvbkNvbmZpcm1EZWxldGU/OiAoKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gdGhpcy50cmFuc2FjdGlvbnMuZmluZCh0ID0+IHQuaWQgPT09IGlkKTtcbiAgICAgICAgaWYgKCF0cmFuc2FjdGlvbikgcmV0dXJuO1xuXG4gICAgICAgIG5ldyBDb25maXJtYXRpb25Nb2RhbChcbiAgICAgICAgICAgIHRoaXMuYXBwLFxuICAgICAgICAgICAgJ0RlbGV0ZSBUcmFuc2FjdGlvbj8nLFxuICAgICAgICAgICAgYEFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBkZWxldGUgdGhpcyAke3RyYW5zYWN0aW9uLnR5cGUudG9Mb3dlckNhc2UoKX0gdHJhbnNhY3Rpb24/IFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuYCxcbiAgICAgICAgICAgIGFzeW5jIChjb25maXJtZWQpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29uZmlybWVkKSB7XG4gICAgICAgICAgICAgICAgICAgIG9uQ29uZmlybURlbGV0ZT8uKCk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmRlbGV0ZVRyYW5zYWN0aW9uKGlkLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVmcmVzaCB0cmFuc2FjdGlvbnMgd2l0aG91dCByZXNldHRpbmcgdGhlIHVzZXIncyBjdXJyZW50IGZpbHRlci9wYWdlIGNvbnRleHQuXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9hZFRyYW5zYWN0aW9uc0RhdGEoZmFsc2UpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlZnJlc2hUcmFuc2FjdGlvbnNMaXN0T25seSgpO1xuICAgICAgICAgICAgICAgICAgICBzaG93RXhwZW5zaWNhTm90aWNlKCdUcmFuc2FjdGlvbiBkZWxldGVkIHN1Y2Nlc3NmdWxseScpO1xuICAgICAgICAgICAgICAgICAgICBvbkRlbGV0ZWQ/LigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgKS5vcGVuKCk7XG4gICAgfVxuXG4gICAgLy8gSGVscGVyIG1ldGhvZCB0byBnZXQgYSBkYXRlIHJhbmdlIGJhc2VkIG9uIHR5cGVcbiAgICBnZXREYXRlUmFuZ2UodHlwZTogRGF0ZVJhbmdlVHlwZSwgc3RhcnREYXRlPzogRGF0ZSwgZW5kRGF0ZT86IERhdGUpOiBEYXRlUmFuZ2Uge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBsZXQgc3RhcnQ6IERhdGU7XG4gICAgICAgIGxldCBlbmQ6IERhdGU7XG4gICAgICAgIGxldCBsYWJlbDogc3RyaW5nO1xuXG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSBEYXRlUmFuZ2VUeXBlLlRPREFZOlxuICAgICAgICAgICAgICAgIHN0YXJ0ID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpKTtcbiAgICAgICAgICAgICAgICBlbmQgPSBuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCksIDIzLCA1OSwgNTksIDk5OSk7XG4gICAgICAgICAgICAgICAgbGFiZWwgPSAnVG9kYXknO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSBEYXRlUmFuZ2VUeXBlLlRISVNfV0VFSzpcbiAgICAgICAgICAgICAgICAvLyBHZXQgdGhlIGZpcnN0IGRheSBvZiB0aGUgd2VlayAoU3VuZGF5KVxuICAgICAgICAgICAgICAgIGNvbnN0IGRheU9mV2VlayA9IG5vdy5nZXREYXkoKTtcbiAgICAgICAgICAgICAgICBzdGFydCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSAtIGRheU9mV2Vlayk7XG4gICAgICAgICAgICAgICAgZW5kID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpICsgKDYgLSBkYXlPZldlZWspLCAyMywgNTksIDU5LCA5OTkpO1xuICAgICAgICAgICAgICAgIGxhYmVsID0gJ1RoaXMgV2Vlayc7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgRGF0ZVJhbmdlVHlwZS5MQVNUX1dFRUs6XG4gICAgICAgICAgICAgICAgLy8gR2V0IHRoZSBwcmV2aW91cyB3ZWVrIChTdW5kYXkgdGhyb3VnaCBTYXR1cmRheSlcbiAgICAgICAgICAgICAgICBjb25zdCBjdXJyZW50RGF5T2ZXZWVrID0gbm93LmdldERheSgpO1xuICAgICAgICAgICAgICAgIHN0YXJ0ID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpIC0gY3VycmVudERheU9mV2VlayAtIDcpO1xuICAgICAgICAgICAgICAgIGVuZCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSAtIGN1cnJlbnREYXlPZldlZWsgLSAxLCAyMywgNTksIDU5LCA5OTkpO1xuICAgICAgICAgICAgICAgIGxhYmVsID0gJ0xhc3QgV2Vlayc7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBjYXNlIERhdGVSYW5nZVR5cGUuVEhJU19NT05USDpcbiAgICAgICAgICAgICAgICBzdGFydCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMSk7XG4gICAgICAgICAgICAgICAgZW5kID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpICsgMSwgMCwgMjMsIDU5LCA1OSwgOTk5KTtcbiAgICAgICAgICAgICAgICBsYWJlbCA9ICdUaGlzIE1vbnRoJztcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIGNhc2UgRGF0ZVJhbmdlVHlwZS5MQVNUX01PTlRIOlxuICAgICAgICAgICAgICAgIHN0YXJ0ID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpIC0gMSwgMSk7XG4gICAgICAgICAgICAgICAgZW5kID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAwLCAyMywgNTksIDU5LCA5OTkpO1xuICAgICAgICAgICAgICAgIGxhYmVsID0gJ0xhc3QgTW9udGgnO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSBEYXRlUmFuZ2VUeXBlLlRISVNfWUVBUjpcbiAgICAgICAgICAgICAgICBzdGFydCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCAwLCAxKTtcbiAgICAgICAgICAgICAgICBlbmQgPSBuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgMTEsIDMxLCAyMywgNTksIDU5LCA5OTkpO1xuICAgICAgICAgICAgICAgIGxhYmVsID0gJ1RoaXMgWWVhcic7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgRGF0ZVJhbmdlVHlwZS5MQVNUX1lFQVI6XG4gICAgICAgICAgICAgICAgc3RhcnQgPSBuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSAtIDEsIDAsIDEpO1xuICAgICAgICAgICAgICAgIGVuZCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpIC0gMSwgMTEsIDMxLCAyMywgNTksIDU5LCA5OTkpO1xuICAgICAgICAgICAgICAgIGxhYmVsID0gJ0xhc3QgWWVhcic7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgRGF0ZVJhbmdlVHlwZS5BTExfVElNRTpcbiAgICAgICAgICAgICAgICAoeyBzdGFydCwgZW5kIH0gPSB0aGlzLmdldEFsbFRpbWVEYXRlUmFuZ2VCb3VuZHMoKSk7XG4gICAgICAgICAgICAgICAgbGFiZWwgPSAnQWxsIFRpbWUnO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSBEYXRlUmFuZ2VUeXBlLkNVU1RPTTpcbiAgICAgICAgICAgICAgICBpZiAoc3RhcnREYXRlICYmIGVuZERhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhcnQgPSBzdGFydERhdGU7XG4gICAgICAgICAgICAgICAgICAgIC8vIFNldCBlbmQgZGF0ZSB0byBlbmQgb2YgZGF5XG4gICAgICAgICAgICAgICAgICAgIGVuZCA9IG5ldyBEYXRlKGVuZERhdGUpO1xuICAgICAgICAgICAgICAgICAgICBlbmQuc2V0SG91cnMoMjMsIDU5LCA1OSwgOTk5KTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIEZvcm1hdCBkYXRlcyBmb3IgdGhlIGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvcm1hdE9wdGlvbnM6IEludGwuRGF0ZVRpbWVGb3JtYXRPcHRpb25zID0geyBcbiAgICAgICAgICAgICAgICAgICAgICAgIHllYXI6ICdudW1lcmljJywgXG4gICAgICAgICAgICAgICAgICAgICAgICBtb250aDogJ3Nob3J0JywgXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXk6ICdudW1lcmljJyBcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnRTdHIgPSBzdGFydC50b0xvY2FsZURhdGVTdHJpbmcodW5kZWZpbmVkLCBmb3JtYXRPcHRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZW5kU3RyID0gZW5kLnRvTG9jYWxlRGF0ZVN0cmluZyh1bmRlZmluZWQsIGZvcm1hdE9wdGlvbnMpO1xuICAgICAgICAgICAgICAgICAgICBsYWJlbCA9IGAke3N0YXJ0U3RyfSAtICR7ZW5kU3RyfWA7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gdGhpcyBtb250aCBpZiBjdXN0b20gZGF0ZXMgYXJlIG5vdCBwcm92aWRlZFxuICAgICAgICAgICAgICAgICAgICBzdGFydCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIGVuZCA9IG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSArIDEsIDAsIDIzLCA1OSwgNTksIDk5OSk7XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsID0gJ0N1c3RvbSBSYW5nZSc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICBzdGFydERhdGU6IHN0YXJ0LFxuICAgICAgICAgICAgZW5kRGF0ZTogZW5kLFxuICAgICAgICAgICAgbGFiZWxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBnZXRBbGxUaW1lRGF0ZVJhbmdlQm91bmRzKCk6IHsgc3RhcnQ6IERhdGU7IGVuZDogRGF0ZSB9IHtcbiAgICAgICAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBjb25zdCB0b2RheVN0YXJ0ID0gbmV3IERhdGUodG9kYXkuZ2V0RnVsbFllYXIoKSwgdG9kYXkuZ2V0TW9udGgoKSwgdG9kYXkuZ2V0RGF0ZSgpKTtcbiAgICAgICAgY29uc3QgdG9kYXlFbmQgPSBuZXcgRGF0ZSh0b2RheS5nZXRGdWxsWWVhcigpLCB0b2RheS5nZXRNb250aCgpLCB0b2RheS5nZXREYXRlKCksIDIzLCA1OSwgNTksIDk5OSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucGx1Z2luLmdldEFsbFRyYW5zYWN0aW9ucygpLnJlZHVjZShcbiAgICAgICAgICAgIChib3VuZHMsIHRyYW5zYWN0aW9uKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25EYXRlID0gcGFyc2VMb2NhbERhdGUodHJhbnNhY3Rpb24uZGF0ZSk7XG4gICAgICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25TdGFydCA9IG5ldyBEYXRlKHRyYW5zYWN0aW9uRGF0ZSk7XG4gICAgICAgICAgICAgICAgdHJhbnNhY3Rpb25TdGFydC5zZXRIb3VycygwLCAwLCAwLCAwKTtcbiAgICAgICAgICAgICAgICBjb25zdCB0cmFuc2FjdGlvbkVuZCA9IG5ldyBEYXRlKHRyYW5zYWN0aW9uRGF0ZSk7XG4gICAgICAgICAgICAgICAgdHJhbnNhY3Rpb25FbmQuc2V0SG91cnMoMjMsIDU5LCA1OSwgOTk5KTtcblxuICAgICAgICAgICAgICAgIGlmICh0cmFuc2FjdGlvblN0YXJ0IDwgYm91bmRzLnN0YXJ0KSB7XG4gICAgICAgICAgICAgICAgICAgIGJvdW5kcy5zdGFydCA9IHRyYW5zYWN0aW9uU3RhcnQ7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKHRyYW5zYWN0aW9uRW5kID4gYm91bmRzLmVuZCkge1xuICAgICAgICAgICAgICAgICAgICBib3VuZHMuZW5kID0gdHJhbnNhY3Rpb25FbmQ7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGJvdW5kcztcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7IHN0YXJ0OiB0b2RheVN0YXJ0LCBlbmQ6IHRvZGF5RW5kIH1cbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBOZXcgbWV0aG9kIHRvIHVwZGF0ZSBzZWFyY2ggcmVzdWx0cyB3aXRob3V0IHJlLXJlbmRlcmluZyB0aGUgZW50aXJlIHZpZXdcbiAgICB1cGRhdGVTZWFyY2hSZXN1bHRzKCkge1xuICAgICAgICAvLyBTdG9yZSBjdXJyZW50IGZvY3VzIHN0YXRlXG4gICAgICAgIGNvbnN0IHdhc0ZvY3VzZWQgPSB0aGlzLmlucHV0Rm9jdXNlZDtcbiAgICAgICAgXG4gICAgICAgIC8vIFVzZSBhIG1vcmUgZWZmaWNpZW50IGRlYm91bmNlIGFwcHJvYWNoXG4gICAgICAgIGlmICh0aGlzLl9kZWJvdW5jZVRpbWVvdXQpIHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9kZWJvdW5jZVRpbWVvdXQpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlzLl9kZWJvdW5jZVRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9hZFRyYW5zYWN0aW9uc0RhdGEodHJ1ZSk7XG4gICAgICAgICAgICB0aGlzLnBlcnNpc3RUcmFuc2FjdGlvbnNTdGF0ZSgpO1xuICAgICAgICAgICAgdGhpcy5yZWZyZXNoVHJhbnNhY3Rpb25zTGlzdE9ubHkoKTtcblxuICAgICAgICAgICAgLy8gUmVzdG9yZSBmb2N1cyB0byBzZWFyY2ggaW5wdXQgaWYgaXQgd2FzIHByZXZpb3VzbHkgZm9jdXNlZFxuICAgICAgICAgICAgaWYgKHdhc0ZvY3VzZWQpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzZWFyY2hJbnB1dCA9IHRoaXMuZ2V0QWN0aXZlQ29udGVudEVsKCkucXVlcnlTZWxlY3RvcignI2V4cGVuc2ljYS1zZWFyY2gtaW5wdXQnKSBhcyBIVE1MSW5wdXRFbGVtZW50O1xuICAgICAgICAgICAgICAgIGlmIChzZWFyY2hJbnB1dCkge1xuICAgICAgICAgICAgICAgICAgICBzZWFyY2hJbnB1dC5mb2N1cygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5fZGVib3VuY2VUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfSwgMzAwKTtcbiAgICB9XG4gICAgXG4gICAgcmVuZGVyVHJhbnNhY3Rpb25zVG9Db250YWluZXIoXG4gICAgICAgIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsXG4gICAgICAgIHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXSxcbiAgICAgICAgcnVubmluZ0JhbGFuY2VzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0gZ2V0UnVubmluZ0JhbGFuY2VCeVRyYW5zYWN0aW9uSWRGb3JBY2NvdW50KFxuICAgICAgICAgICAgdGhpcy5wbHVnaW4sXG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZXMubGVuZ3RoID09PSAxXG4gICAgICAgICAgICAgICAgPyB0aGlzLnNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZXNbMF1cbiAgICAgICAgICAgICAgICA6IHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh1bmRlZmluZWQpLFxuICAgICAgICAgICAgdGhpcy50cmFuc2FjdGlvbnNcbiAgICAgICAgKVxuICAgICkge1xuICAgICAgICBsZXQgY3VycmVudE1vbnRoS2V5ID0gJyc7XG4gICAgICAgIGxldCBjdXJyZW50RGF5S2V5ID0gJyc7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2NvdW50UmVmZXJlbmNlID0gdGhpcy5wbHVnaW4ubm9ybWFsaXplVHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlKHVuZGVmaW5lZCk7XG4gICAgICAgIGNvbnN0IHNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZSA9IHRoaXMuc2VsZWN0ZWRBY2NvdW50UmVmZXJlbmNlcy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgID8gdGhpcy5zZWxlY3RlZEFjY291bnRSZWZlcmVuY2VzWzBdXG4gICAgICAgICAgICA6IGRlZmF1bHRBY2NvdW50UmVmZXJlbmNlO1xuICAgICAgICBjb25zdCBpbnRlcm5hbEJhbGFuY2VNYXBzID0gbmV3IE1hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIG51bWJlcj4+KCk7XG4gICAgICAgIGNvbnN0IGVuc3VyZUJhbGFuY2VNYXAgPSAoYWNjb3VudFJlZmVyZW5jZTogc3RyaW5nKTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9PiB7XG4gICAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGludGVybmFsQmFsYW5jZU1hcHMuZ2V0KGFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBiYWxhbmNlcyA9IGFjY291bnRSZWZlcmVuY2UgPT09IHNlbGVjdGVkQWNjb3VudFJlZmVyZW5jZVxuICAgICAgICAgICAgICAgID8gcnVubmluZ0JhbGFuY2VzXG4gICAgICAgICAgICAgICAgOiBnZXRSdW5uaW5nQmFsYW5jZUJ5VHJhbnNhY3Rpb25JZEZvckFjY291bnQodGhpcy5wbHVnaW4sIGFjY291bnRSZWZlcmVuY2UsIHRoaXMudHJhbnNhY3Rpb25zKTtcbiAgICAgICAgICAgIGludGVybmFsQmFsYW5jZU1hcHMuc2V0KGFjY291bnRSZWZlcmVuY2UsIGJhbGFuY2VzKTtcbiAgICAgICAgICAgIHJldHVybiBiYWxhbmNlcztcbiAgICAgICAgfTtcblxuICAgICAgICB0cmFuc2FjdGlvbnMuZm9yRWFjaCh0cmFuc2FjdGlvbiA9PiB7XG4gICAgICAgICAgICBjb25zdCBtb250aEtleSA9IHRoaXMuZ2V0VHJhbnNhY3Rpb25Nb250aEtleSh0cmFuc2FjdGlvbik7XG4gICAgICAgICAgICBjb25zdCBkYXlLZXkgPSB0aGlzLmdldFRyYW5zYWN0aW9uRGF5S2V5KHRyYW5zYWN0aW9uKTtcblxuICAgICAgICAgICAgaWYgKG1vbnRoS2V5ICE9PSBjdXJyZW50TW9udGhLZXkpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50TW9udGhLZXkgPSBtb250aEtleTtcbiAgICAgICAgICAgICAgICBjdXJyZW50RGF5S2V5ID0gJyc7XG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJUcmFuc2FjdGlvbkdyb3VwVGl0bGUoY29udGFpbmVyLCB0aGlzLmdldFRyYW5zYWN0aW9uTW9udGhMYWJlbCh0cmFuc2FjdGlvbiksICdtb250aCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZGF5S2V5ICE9PSBjdXJyZW50RGF5S2V5KSB7XG4gICAgICAgICAgICAgICAgY3VycmVudERheUtleSA9IGRheUtleTtcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlclRyYW5zYWN0aW9uR3JvdXBUaXRsZShjb250YWluZXIsIHRoaXMuZ2V0VHJhbnNhY3Rpb25EYXlMYWJlbCh0cmFuc2FjdGlvbiksICdkYXknKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlQWNjb3VudHNcbiAgICAgICAgICAgICAgICA/IHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi5hY2NvdW50KVxuICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjY291bnRSZWZlcmVuY2U7XG4gICAgICAgICAgICBjb25zdCB0cmFuc2FjdGlvbkJhbGFuY2VzID0gZW5zdXJlQmFsYW5jZU1hcCh0cmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgbGV0IHJ1bm5pbmdCYWxhbmNlTGFiZWwgPSBmb3JtYXRSdW5uaW5nQmFsYW5jZUxhYmVsKFxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLFxuICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uQmFsYW5jZXNbdHJhbnNhY3Rpb24uaWRdID8/IDBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBsZXQgc2Vjb25kYXJ5UnVubmluZ0JhbGFuY2VMYWJlbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlQWNjb3VudHMgJiYgdHJhbnNhY3Rpb24udHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLklOVEVSTkFMKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZnJvbUFjY291bnRSZWZlcmVuY2UgPSB0aGlzLnBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UodHJhbnNhY3Rpb24uZnJvbUFjY291bnQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvQWNjb3VudFJlZmVyZW5jZSA9IHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi50b0FjY291bnQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGZyb21CYWxhbmNlcyA9IGVuc3VyZUJhbGFuY2VNYXAoZnJvbUFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvQmFsYW5jZXMgPSBlbnN1cmVCYWxhbmNlTWFwKHRvQWNjb3VudFJlZmVyZW5jZSk7XG4gICAgICAgICAgICAgICAgcnVubmluZ0JhbGFuY2VMYWJlbCA9IGZvcm1hdFJ1bm5pbmdCYWxhbmNlTGFiZWwoXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLFxuICAgICAgICAgICAgICAgICAgICBmcm9tQmFsYW5jZXNbdHJhbnNhY3Rpb24uaWRdID8/IDAsXG4gICAgICAgICAgICAgICAgICAgIGZyb21BY2NvdW50UmVmZXJlbmNlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBzZWNvbmRhcnlSdW5uaW5nQmFsYW5jZUxhYmVsID0gZm9ybWF0UnVubmluZ0JhbGFuY2VMYWJlbChcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4sXG4gICAgICAgICAgICAgICAgICAgIHRvQmFsYW5jZXNbdHJhbnNhY3Rpb24uaWRdID8/IDAsXG4gICAgICAgICAgICAgICAgICAgIHRvQWNjb3VudFJlZmVyZW5jZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMucmVuZGVyVHJhbnNhY3Rpb25DYXJkV2l0aEVkaXRIYW5kbGVyKFxuICAgICAgICAgICAgICAgIGNvbnRhaW5lcixcbiAgICAgICAgICAgICAgICB0cmFuc2FjdGlvbixcbiAgICAgICAgICAgICAgICBydW5uaW5nQmFsYW5jZUxhYmVsLFxuICAgICAgICAgICAgICAgIHNlY29uZGFyeVJ1bm5pbmdCYWxhbmNlTGFiZWxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICBwcml2YXRlIF9kZWJvdW5jZVRpbWVvdXQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG59IFxuIl19