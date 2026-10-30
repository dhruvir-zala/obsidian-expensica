import {
    App, Component, Modal, WorkspaceLeaf, ItemView, ViewStateResult, setIcon
} from 'obsidian';
import Chart from 'chart.js/auto';
import { Tooltip } from 'chart.js';
import type { ArcElement, Chart as ChartJS, Plugin as ChartPlugin, TooltipPositionerFunction } from 'chart.js';
type AnimatedChartDataset = Chart['data']['datasets'][number] & {
    __expensicaPendingAnimationData?: (number | null)[];
};
import { 
    Transaction, Category, TransactionType, CategoryType,
    formatCurrency, formatDate, formatTime, parseLocalDate, generateId, TransactionAggregator,
    Budget, BudgetPeriod, calculateBudgetStatus, getCategoryColor as getDefaultCategoryColor, sortTransactionsByDateTimeDesc,
    getTransactionDisplayTime, getTransactionTime, isSelfTransfer, ColorPalette,
    Account, AccountType, getAccountTypeLabel, parseAccountReference, formatAccountReference, normalizeAccountName, getAccountEmoji,
    INTERNAL_CATEGORY_ID, getCategoryTypeForTransactionType, getDefaultTransactionCategory, getAccountColor, getNextAccountColor, normalizePaletteColor
} from './models';
import ExpensicaPlugin from '../main';
import type { SharedDateRangeState } from '../main';
import type { TransactionNavigationFilter } from './transactions-view';
import { PremiumVisualizations } from './dashboard-integration';
import { ConfirmationModal } from './confirmation-modal';
import { preventBackdropDismissal, voidAsync } from './modal-utils';
import { DateSelectorModal, formatDateForDisplay } from './date-selector-modal';
import { TimeSelectorModal, formatTimeForDisplay } from './time-selector-modal';
import { showExpensicaNotice } from './notice';
import { renderTransactionCard } from './transaction-card';
import { renderBudgetCard } from './budget-cards';
import { showTransactionBulkCategoryMenu } from './transaction-card';
import { renderCategoryChip } from './category-chip';
import { renderCategoryCards } from './categories-cards';
import { EmojiPickerModal } from './emoji-picker-modal';
import { showCategoryQuickMenu } from './category-quick-menu';
import { renderAccountCard, renderCreateAccountCard } from './account-card';

declare module 'chart.js' {
    interface TooltipPositionerMap {
        expensicaDoughnutOuterEdge: TooltipPositionerFunction<'doughnut'>;
    }
}

Tooltip.positioners.expensicaDoughnutOuterEdge = (items) => {
    const arc = items[0]?.element as ArcElement | undefined;
    if (!arc || !arc.hasValue()) {
        return false;
    }

    const angle = (arc.startAngle + arc.endAngle) / 2;
    const radius = arc.outerRadius - (arc.outerRadius - arc.innerRadius) * 0.1 + arc.options.offset / 4;
    return {
        x: arc.x + Math.cos(angle) * radius,
        y: arc.y + Math.sin(angle) * radius
    };
};

// Extend the plugin interface to include the new method
declare module '../main' {
    interface ExpensicaPlugin {
        openTransactionsView(filter?: TransactionNavigationFilter): Promise<void>;
        openTransactionsViewForCategory(categoryId: string): Promise<void>;
        renderDashboardTransactionsTab(dashboard: ExpensicaDashboardView, container: HTMLElement): void;
        renderDashboardAccountsTab(dashboard: ExpensicaDashboardView, container: HTMLElement): void;
        openExportModal(): void;
    }
}

export const EXPENSICA_VIEW_TYPE = 'expensica-dashboard-view';
export const DATE_RANGE_LABEL_TODAY = 'TD';
export const DATE_RANGE_LABEL_THIS_WEEK = '1W';
export const DATE_RANGE_LABEL_LAST_WEEK = 'LW';
export const DATE_RANGE_LABEL_THIS_MONTH = '1M';
export const DATE_RANGE_LABEL_LAST_MONTH = 'LM';
export const DATE_RANGE_LABEL_THIS_YEAR = '1Y';
export const DATE_RANGE_LABEL_LAST_YEAR = 'LY';
export const DATE_RANGE_LABEL_ALL_TIME = 'All';
export const DATE_RANGE_LABEL_CUSTOM_RANGE = 'Range';

// Date range options
export enum DateRangeType {
    TODAY = 'today',
    THIS_WEEK = 'this_week',
    LAST_WEEK = 'last_week',
    THIS_MONTH = 'this_month',
    LAST_MONTH = 'last_month',
    THIS_YEAR = 'this_year',
    LAST_YEAR = 'last_year',
    ALL_TIME = 'all_time',
    CUSTOM = 'custom'
}

// Interface for date range
export interface DateRange {
    type: DateRangeType;
    startDate: Date;
    endDate: Date;
    label: string;
}

interface DashboardViewState {
    currentTab?: DashboardTab;
    dateRangeType?: DateRangeType;
    dateRangeStart?: string;
    dateRangeEnd?: string;
    customStartDate?: string | null;
    customEndDate?: string | null;
    dateRangeUpdatedAt?: number;
    currentDate?: string;
    selectedCalendarDate?: string | null;
    expenseChartPeriod?: 'category' | 'weekly' | 'monthly';
    categoryChartType?: CategoryType;
    incomeExpenseVisibility?: IncomeExpenseVisibility;
    scrollTop?: number;
}

interface IncomeExpenseVisibility {
    income: boolean;
    expenses: boolean;
    net: boolean;
    accounts: Record<string, boolean>;
}

function hasDashboardStateKey(state: DashboardViewState, key: keyof DashboardViewState): boolean {
    return Object.prototype.hasOwnProperty.call(state, key);
}

function normalizeTransactionTime(time: string | null): string {
    if (!time) {
        return formatTime();
    }

    return /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
}

function getTransactionFormTime(transaction: Transaction): string {
    return getTransactionDisplayTime(transaction) || '';
}

function getTransactionNotesValue(transaction: Transaction): string {
    return transaction.notes || '';
}

function isSameTransactionEdit(original: Transaction, updated: Transaction): boolean {
    return original.id === updated.id
        && original.date === updated.date
        && getTransactionFormTime(original) === getTransactionFormTime(updated)
        && original.type === updated.type
        && original.amount === updated.amount
        && original.description === updated.description
        && original.category === updated.category
        && (original.account || '') === (updated.account || '')
        && (original.fromAccount || '') === (updated.fromAccount || '')
        && (original.toAccount || '') === (updated.toAccount || '')
        && getTransactionNotesValue(original) === getTransactionNotesValue(updated);
}

function getAccountTransactionAmount(plugin: ExpensicaPlugin, transaction: Transaction, accountReference: string,
    isCredit = plugin.findAccountByReference(accountReference)?.type === AccountType.CREDIT,
    defaultAccountReference?: string): number {
    if (transaction.type === TransactionType.INTERNAL) {
        const fromAccount = transaction.fromAccount ? plugin.normalizeTransactionAccountReference(transaction.fromAccount) : '';
        const toAccount = transaction.toAccount ? plugin.normalizeTransactionAccountReference(transaction.toAccount) : '';
        if (fromAccount === toAccount) return 0;
        if (fromAccount === accountReference) {
            return isCredit ? transaction.amount : -transaction.amount;
        }
        if (toAccount === accountReference) {
            return isCredit ? -transaction.amount : transaction.amount;
        }
        return 0;
    }

    const transactionAccount = defaultAccountReference !== undefined && !transaction.account
        ? defaultAccountReference
        : Object.prototype.hasOwnProperty.call(transaction, 'account')
            ? plugin.normalizeTransactionAccountReference(transaction.account)
            : defaultAccountReference ?? plugin.normalizeTransactionAccountReference(undefined);

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

function getAccountRunningBalance(plugin: ExpensicaPlugin, accountReference: string, transactions: Transaction[]): number {
    return transactions.reduce(
        (balance, transaction) => balance + getAccountTransactionAmount(plugin, transaction, accountReference),
        0
    );
}

function getRunningBalanceByTransactionIdForAccount(
    plugin: ExpensicaPlugin,
    accountReference: string,
    transactions: Transaction[]
): Record<string, number> {
    let runningBalance = 0;

    return sortTransactionsByDateTimeDesc(transactions, plugin.getAllTransactions())
        .reverse()
        .reduce((balances, transaction) => {
            runningBalance += getAccountTransactionAmount(plugin, transaction, accountReference);
            balances[transaction.id] = runningBalance;
            return balances;
        }, {} as Record<string, number>);
}

function formatRunningBalanceLabel(plugin: ExpensicaPlugin, balance: number, accountReference?: string): string {
    const amount = formatCurrency(balance, plugin.settings.defaultCurrency);
    if (!accountReference) return amount;
    return `${plugin.getTransactionAccountDisplay(accountReference).name}: ${amount}`;
}

function renderOverviewCurrencyValue(
    container: HTMLElement,
    currencyCode: string,
    amount: number,
    valueClass: string
): HTMLElement {
    const valueEl = container.createEl('p', {
        cls: `expensica-card-value ${valueClass}`
    });
    valueEl.createSpan({
        text: formatCurrency(amount, currencyCode),
        cls: 'expensica-card-currency-amount'
    });
    return valueEl;
}

function isEffectivelyZero(value: number, epsilon = 0.000001): boolean {
    return Math.abs(value) < epsilon;
}

function normalizeBalanceValue(value: number): number {
    return isEffectivelyZero(value) ? 0 : value;
}

function getTrendPercentage(currentValue: number, previousValue: number): number {
    if (isEffectivelyZero(previousValue)) {
        return isEffectivelyZero(currentValue) ? 0 : 100;
    }

    return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function renderTrend(
    container: HTMLElement,
    trendPercentage: number,
    comparisonLabel: string,
    isPositiveNews: boolean
): void {
    const formattedPercentage = `${Math.abs(trendPercentage).toFixed(1)}%`;

    if (isEffectivelyZero(trendPercentage)) {
        container.textContent = `${formattedPercentage} from ${comparisonLabel}`;
        return;
    }

    const isUpward = trendPercentage >= 0;
    const trendClass = isPositiveNews ? 'is-positive' : 'is-negative';
    const indicator = container.createSpan(`expensica-card-trend-indicator ${trendClass}`);
    const svg = indicator.createSvg('svg', {
        attr: {
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }
    });
    svg.createSvg('polyline', {
        attr: { points: isUpward ? '18 15 12 9 6 15' : '6 9 12 15 18 9' }
    });
    container.createSpan({ text: ` ${formattedPercentage} from ${comparisonLabel}` });
}

function handleDashboardAsync(operation: string, action: () => Promise<unknown>): void {
    void action().catch(error => {
        console.error(`Expensica: ${operation} did not complete`, error);
        showExpensicaNotice(`${operation} could not finish. Please try again.`);
    });
}

type DashboardSvgShape = {
    tag: 'line' | 'path' | 'polyline' | 'rect';
    attributes: Record<string, string>;
};

function createDashboardSvgIcon(
    container: HTMLElement,
    size: string,
    strokeWidth: string,
    shapes: DashboardSvgShape[],
    ariaHidden = false
): SVGSVGElement {
    const svg = container.createSvg('svg', {
        attr: {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': strokeWidth,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            ...(ariaHidden ? { 'aria-hidden': 'true' } : {})
        }
    });
    shapes.forEach(({ tag, attributes }) => svg.createSvg(tag, { attr: attributes }));
    return svg;
}

function appendCreditCardIcon(container: HTMLElement): void {
    createDashboardSvgIcon(container, '14', '2', [
        { tag: 'rect', attributes: { x: '2', y: '5', width: '20', height: '14', rx: '2' } },
        { tag: 'line', attributes: { x1: '2', y1: '10', x2: '22', y2: '10' } }
    ]);
}

function appendChevronIcon(container: HTMLElement, size: string): void {
    createDashboardSvgIcon(container, size, '2', [
        { tag: 'polyline', attributes: { points: '6 9 12 15 18 9' } }
    ]);
}

// existingTransactions includes the original row on edits, in canonical ledger order.
function getCreditLimitExceededAccount(plugin: ExpensicaPlugin, transaction: Transaction, existingTransactions: Transaction[]): Account | null {
    const original = existingTransactions.find(existing => existing.id === transaction.id);
    const projectedTransactions = original
        ? existingTransactions.map(existing => existing.id === transaction.id ? transaction : existing)
        : [...existingTransactions, transaction];
    const candidateReferences = new Set<string>();
    for (const affected of [original, transaction]) {
        if (!affected) continue;
        if (affected.type === TransactionType.INTERNAL) {
            for (const reference of [affected.fromAccount, affected.toAccount]) {
                if (reference) candidateReferences.add(plugin.normalizeTransactionAccountReference(reference));
            }
        } else {
            candidateReferences.add(plugin.normalizeTransactionAccountReference(affected.account));
        }
    }

    for (const reference of candidateReferences) {
        const account = plugin.findAccountByReference(reference);
        if (!account || account.type !== AccountType.CREDIT || typeof account.creditLimit !== 'number') {
            continue;
        }

        const currentBalance = getAccountRunningBalance(plugin, reference, existingTransactions);
        const projectedBalance = getAccountRunningBalance(plugin, reference, projectedTransactions);
        if (projectedBalance > account.creditLimit && projectedBalance > currentBalance) {
            return account;
        }
    }

    return null;
}

class BulkRenameTransactionsModal extends Modal {
    private readonly onSubmit: (name: string) => Promise<void> | void;

    constructor(app: App, onSubmit: (name: string) => Promise<void> | void, private readonly plugin: ExpensicaPlugin) {
        super(app);
        this.onSubmit = onSubmit;
    }

    open() {
        if (this.plugin.canEditData(["transactions"])) super.open();
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('expensica-transaction-modal', 'expensica-bulk-rename-modal-shell');
        contentEl.addClass('expensica-modal', 'expensica-bulk-rename-modal');

        const title = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        const titleIcon = title.createSpan({ cls: 'expensica-modal-title-icon' });
        const titleSvg = titleIcon.createSvg('svg', {
            attr: {
                width: '18',
                height: '18',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2.1',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'aria-hidden': 'true'
            }
        });
        titleSvg.createSvg('path', { attr: { d: 'M12 20h9' } });
        titleSvg.createSvg('path', { attr: { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' } });
        title.createSpan({ text: ' Bulk Rename' });

        const form = contentEl.createEl('form', { cls: 'expensica-form' });
        const formGroup = form.createDiv('expensica-form-group');
        formGroup.createEl('label', {
            text: 'Name',
            cls: 'expensica-form-label',
            attr: { for: 'expensica-dashboard-bulk-rename-input' }
        });

        const input = formGroup.createEl('input', {
            type: 'text',
            cls: 'expensica-form-input expensica-edit-field',
            attr: {
                id: 'expensica-dashboard-bulk-rename-input',
                autocomplete: 'off'
            }
        });

        const footer = form.createDiv('expensica-form-footer expensica-bulk-rename-modal-footer');
        const cancelButton = footer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        footer.createEl('button', {
            text: 'Update',
            cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
            attr: { type: 'submit' }
        });

        cancelButton.addEventListener('click', () => {
            this.close();
        });

        form.addEventListener('submit', voidAsync(async (event) => {
            event.preventDefault();
            await this.plugin.runSaveOperation(this, 'Rename transactions', async () => {
                if (!form.reportValidity()) return false;
                const nextName = input.value.trim();
                if (!nextName) {
                    showExpensicaNotice('Transaction name is required.');
                    input.focus();
                    return false;
                }

                await this.onSubmit(nextName);
                this.close();
            });
        }));

        window.setTimeout(() => input.focus(), 0);
    }
    onClose() {
        this.plugin.releaseSaveOperation(this);
        this.contentEl.empty();
    }
}

// Dashboard tab options
export enum DashboardTab {
    OVERVIEW = 'overview',
    TRANSACTIONS = 'transactions',
    ACCOUNTS = 'accounts',
    BUDGET = 'budget',
    CATEGORIES = 'categories'
}

export class ExpensicaDashboardView extends ItemView {
    plugin: ExpensicaPlugin;
    transactions: Transaction[] = [];
    filteredTransactions: Transaction[] = [];
    currentDate: Date = new Date();
    selectedCalendarDate: Date | null = null;
    expensesChart: Chart | null = null;
    incomeExpenseChart: Chart | null = null;
    cumulativeExpensesChart: Chart | null = null;
    
    // Track previous month data for trends
    previousMonthTransactions: Transaction[] = [];
    
    // Chart period for expenses (weekly, monthly, yearly)
    expenseChartPeriod: 'category' | 'weekly' | 'monthly' = 'category';
    categoryChartType: CategoryType = CategoryType.EXPENSE;
    incomeExpenseVisibility: IncomeExpenseVisibility = {
        income: true,
        expenses: true,
        net: true,
        accounts: {}
    };
    
    // Premium visualizations
    premiumVisualizations: PremiumVisualizations | null = null;
    
    // New: Date range properties
    dateRange: DateRange;
    customStartDate: Date | null = null;
    customEndDate: Date | null = null;
    dateRangeUpdatedAt = 0;

    // Current tab
    currentTab: DashboardTab = DashboardTab.OVERVIEW;
    private themeObserver: MutationObserver | null = null;
    private themeRefreshTimeout: number | null = null;
    private pendingThemeRefresh = false;
    private pendingDataRefresh: 'transactions' | 'budgets' | null = null;
    private dateRangeSelectorComponent: Component | null = null;
    private categoryChartTypeSelectorComponent: Component | null = null;
    private lastThemeSignature = '';
    private calendarResizeTimeout: number | null = null;
    private resizeRefreshTimeout: number | null = null;
    private chartAnimationResetTimeout: number | null = null;
    private incomeExpenseToggleAnimationFrame: number | null = null;
    private incomeExpenseHoverAnimationFrame: number | null = null;
    private doughnutLabelAnimationFrame: number | null = null;
    private doughnutLabelAnimationIndex: number | null = null;
    private doughnutLabelAnimationStartTime = 0;
    private doughnutLabelAnimationTarget = 0;
    private doughnutLabelAnimationValue = 0;
    private doughnutAmountAnimationTarget = 0;
    private doughnutAmountAnimationValue = 0;
    private paneResizeObserver: ResizeObserver | null = null;
    private lastObservedDashboardWidth = 0;
    private lastObservedDashboardHeight = 0;
    private shouldAnimateExpensesChartOnNextRender = true;
    private shouldAnimateIncomeExpenseChartOnNextRender = true;
    private shouldAnimateCumulativeExpensesChartOnNextRender = true;
    private animateExpensesChartThisRender = false;
    private animateIncomeExpenseChartThisRender = false;
    private animateCumulativeExpensesChartThisRender = false;
    private scrollTop = 0;
    private pendingChartScrollAnchorSelector: string | null = null;
    private selectedTransactionIds = new Set<string>();
    private mobileActiveCategorySliceIndex: number | null = null;
    private hasRenderedDashboard = false;
    private wasDashboardVisible = false;
    private readonly boundHandleResize = this.handleResize.bind(this);

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
        return 'Expensica';
    }

    getIcon(): string {
        return 'dollar-sign';
    }

    async onOpen() {
        const sharedDateRangeState = this.plugin.getSharedDateRangeState();
        if (sharedDateRangeState) {
            this.applySharedDateRangeStateValues(sharedDateRangeState);
        }

        // Load transactions for the current month and previous month
        await this.loadTransactionsData();

        // Render the dashboard
        this.renderDashboard();

        // Add resize event listener
        window.addEventListener('resize', this.boundHandleResize);
        this.setupPaneResizeObserver();
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            this.handleWorkspaceVisibilityChange();
        }));
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.handleWorkspaceVisibilityChange();
        }));

        this.setupThemeObserver();
    }

    private destroyCharts() {
        this.cancelDoughnutLabelAnimation();
        this.expensesChart?.destroy();
        this.incomeExpenseChart?.destroy();
        this.cumulativeExpensesChart?.destroy();
        this.expensesChart = null;
        this.incomeExpenseChart = null;
        this.cumulativeExpensesChart = null;
    }

    async onClose() {
        this.plugin.deactivateDashboardTransactionsTab?.(this);
        this.clearSelectorListeners();
        this.destroyCharts();

        // Premium visualizations will be garbage collected
        this.premiumVisualizations = null;

        // Remove resize event listener
        window.removeEventListener('resize', this.boundHandleResize);
        if (this.paneResizeObserver) {
            this.paneResizeObserver.disconnect();
            this.paneResizeObserver = null;
        }

        if (this.themeObserver) {
            this.themeObserver.disconnect();
            this.themeObserver = null;
        }

        if (this.themeRefreshTimeout !== null) {
            window.clearTimeout(this.themeRefreshTimeout);
            this.themeRefreshTimeout = null;
        }

        if (this.calendarResizeTimeout !== null) {
            window.clearTimeout(this.calendarResizeTimeout);
            this.calendarResizeTimeout = null;
        }

        if (this.resizeRefreshTimeout !== null) {
            window.clearTimeout(this.resizeRefreshTimeout);
            this.resizeRefreshTimeout = null;
        }

        if (this.chartAnimationResetTimeout !== null) {
            window.clearTimeout(this.chartAnimationResetTimeout);
            this.chartAnimationResetTimeout = null;
        }

        if (this.incomeExpenseToggleAnimationFrame !== null) {
            window.cancelAnimationFrame(this.incomeExpenseToggleAnimationFrame);
            this.incomeExpenseToggleAnimationFrame = null;
        }

        if (this.incomeExpenseHoverAnimationFrame !== null) {
            window.cancelAnimationFrame(this.incomeExpenseHoverAnimationFrame);
            this.incomeExpenseHoverAnimationFrame = null;
        }

        this.cancelDoughnutLabelAnimation();

    }

    getState(): Record<string, unknown> {
        this.rememberScrollPosition();
        return {
            ...super.getState(),
            currentTab: this.currentTab,
            dateRangeType: this.dateRange.type,
            dateRangeStart: formatDate(this.dateRange.startDate),
            dateRangeEnd: formatDate(this.dateRange.endDate),
            customStartDate: this.customStartDate ? formatDate(this.customStartDate) : null,
            customEndDate: this.customEndDate ? formatDate(this.customEndDate) : null,
            dateRangeUpdatedAt: this.dateRangeUpdatedAt,
            currentDate: formatDate(this.currentDate),
            selectedCalendarDate: this.selectedCalendarDate ? formatDate(this.selectedCalendarDate) : null,
            expenseChartPeriod: this.expenseChartPeriod,
            categoryChartType: this.categoryChartType,
            incomeExpenseVisibility: this.incomeExpenseVisibility,
            scrollTop: this.scrollTop
        };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);

        if (!state || typeof state !== 'object') {
            return;
        }

        const dashboardState = state as DashboardViewState;
        const previousRenderState = this.getDashboardRenderStateSignature();

        if (dashboardState.currentTab && Object.values(DashboardTab).includes(dashboardState.currentTab)) {
            this.currentTab = dashboardState.currentTab;
        }

        if (
            dashboardState.expenseChartPeriod === 'category'
            || dashboardState.expenseChartPeriod === 'weekly'
            || dashboardState.expenseChartPeriod === 'monthly'
        ) {
            this.expenseChartPeriod = dashboardState.expenseChartPeriod;
        }

        if (
            dashboardState.categoryChartType === CategoryType.EXPENSE
            || dashboardState.categoryChartType === CategoryType.INCOME
        ) {
            this.categoryChartType = dashboardState.categoryChartType;
        }

        if (dashboardState.incomeExpenseVisibility) {
            const savedVisibility = dashboardState.incomeExpenseVisibility as IncomeExpenseVisibility & { balance?: boolean };
            this.incomeExpenseVisibility = {
                income: savedVisibility.income !== false,
                expenses: savedVisibility.expenses !== false,
                net: (savedVisibility.net ?? savedVisibility.balance) !== false,
                accounts: savedVisibility.accounts ?? {}
            };
        }

        if (dashboardState.currentDate) {
            this.currentDate = parseLocalDate(dashboardState.currentDate);
        }

        if (hasDashboardStateKey(dashboardState, 'selectedCalendarDate')) {
            this.selectedCalendarDate = dashboardState.selectedCalendarDate
                ? parseLocalDate(dashboardState.selectedCalendarDate)
                : null;
        }

        if (hasDashboardStateKey(dashboardState, 'customStartDate')) {
            this.customStartDate = dashboardState.customStartDate
                ? parseLocalDate(dashboardState.customStartDate)
                : null;
        }

        if (hasDashboardStateKey(dashboardState, 'customEndDate')) {
            this.customEndDate = dashboardState.customEndDate
                ? parseLocalDate(dashboardState.customEndDate)
                : null;
        }

        if (dashboardState.dateRangeType) {
            const startDate = dashboardState.dateRangeStart ? parseLocalDate(dashboardState.dateRangeStart) : undefined;
            const endDate = dashboardState.dateRangeEnd ? parseLocalDate(dashboardState.dateRangeEnd) : undefined;
            this.dateRange = this.createDateRangeFromState(dashboardState.dateRangeType, startDate, endDate);
            this.dateRangeUpdatedAt = dashboardState.dateRangeUpdatedAt ?? 0;

            if (dashboardState.dateRangeType === DateRangeType.CUSTOM && startDate && endDate) {
                this.customStartDate = startDate;
                this.customEndDate = endDate;
            }
        }

        const sharedDateRangeState = this.plugin.getSharedDateRangeState();
        if (sharedDateRangeState && sharedDateRangeState.updatedAt >= this.dateRangeUpdatedAt) {
            this.applySharedDateRangeStateValues(sharedDateRangeState);
        } else if (dashboardState.dateRangeType) {
            await this.plugin.setSharedDateRangeState(this.createSharedDateRangeState(), this);
        }

        if (typeof dashboardState.scrollTop === 'number') {
            this.scrollTop = dashboardState.scrollTop;
        }

        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (
            container
            && container.childElementCount > 0
            && this.getDashboardRenderStateSignature() !== previousRenderState
        ) {
            await this.loadTransactionsData();
            this.renderDashboard();
        }
    }

    // Handler for window resize events
    private handleResize() {
        this.setRefreshing(true);
        this.setChartAnimations(false);

        if (this.resizeRefreshTimeout !== null) {
            window.clearTimeout(this.resizeRefreshTimeout);
        }

        this.resizeRefreshTimeout = window.setTimeout(() => {
            window.requestAnimationFrame(() => {
                this.setChartAnimations(false);
                this.resizeChartsToContainers();
                this.premiumVisualizations?.resize();
                this.setRefreshing(false);
            });
            this.resizeRefreshTimeout = null;
        }, this.getChartResizeDelay());
    }

    private setupPaneResizeObserver() {
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const dashboardContainer = this.containerEl.children[1] as HTMLElement | undefined;
        if (!dashboardContainer) {
            return;
        }

        this.paneResizeObserver?.disconnect();
        this.lastObservedDashboardWidth = 0;
        this.lastObservedDashboardHeight = 0;
        this.paneResizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }

            const width = Math.round(entry.contentRect.width);
            const height = Math.round(entry.contentRect.height);

            if (width <= 0 || height <= 0) {
                return;
            }

            if (width === this.lastObservedDashboardWidth && height === this.lastObservedDashboardHeight) {
                return;
            }

            this.lastObservedDashboardWidth = width;
            this.lastObservedDashboardHeight = height;
            this.handleResize();
        });
        this.paneResizeObserver.observe(dashboardContainer);
    }

    private scheduleCalendarResize() {
        if (this.calendarResizeTimeout !== null) {
            window.clearTimeout(this.calendarResizeTimeout);
        }

        this.calendarResizeTimeout = window.setTimeout(() => {
            window.requestAnimationFrame(() => {
                this.premiumVisualizations?.resize();
            });
            this.calendarResizeTimeout = null;
        }, this.getChartResizeDelay());
    }

    private isDashboardVisible(): boolean {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container || !container.isConnected) {
            return false;
        }

        const bounds = container.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
    }

    private handleWorkspaceVisibilityChange() {
        const isVisible = this.isDashboardVisible();

        if (!isVisible) {
            this.wasDashboardVisible = false;
            return;
        }

        if (this.pendingDataRefresh === 'transactions') {
            this.pendingDataRefresh = null;
            this.pendingThemeRefresh = false;
            this.renderDashboard();
            this.wasDashboardVisible = true;
            return;
        }

        if (this.pendingThemeRefresh || this.pendingDataRefresh === 'budgets') {
            this.pendingDataRefresh = null;
            this.pendingThemeRefresh = false;
            this.refreshCurrentTabContent();
            this.wasDashboardVisible = true;
            return;
        }

        const becameVisible = !this.wasDashboardVisible;
        this.wasDashboardVisible = true;

        window.requestAnimationFrame(() => {
            const resizedCharts = this.resizeChartsToContainers();

            if (becameVisible || resizedCharts) {
                this.premiumVisualizations?.resize();
            }
        });
    }

    private setRefreshing(isRefreshing: boolean) {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        container?.toggleClass('expensica-is-refreshing', isRefreshing);
    }

    private setChartAnimations(enabled: boolean) {
        [this.expensesChart, this.incomeExpenseChart, this.cumulativeExpensesChart].forEach(chart => {
            if (!chart) return;
            chart.options.animation = enabled
                ? this.getChartAnimationOptions(true)
                : { duration: 0 };
        });
    }

    private prepareChartCanvasSize(canvas: HTMLCanvasElement) {
        const container = canvas.parentElement;
        if (!container) return;

        const { width, height, minimumWidth, minimumHeight, isMiniDonut } = this.getChartCanvasDimensions(container);

        container.setCssProps({
            '--expensica-panel-natural-width': `${width}px`,
            '--expensica-panel-natural-height': `${height}px`
        });
        if (isMiniDonut) {
            container.style.removeProperty('--expensica-panel-min-width');
            container.style.removeProperty('--expensica-panel-min-height');
        } else {
            container.setCssProps({
                '--expensica-panel-min-width': `${minimumWidth}px`,
                '--expensica-panel-min-height': `${minimumHeight}px`
            });
        }
        canvas.width = width;
        canvas.height = height;
        if (isMiniDonut) {
            canvas.style.removeProperty('min-width');
            canvas.style.removeProperty('min-height');
        } else {
            canvas.setCssStyles({
                minWidth: 'var(--expensica-panel-min-width)',
                minHeight: 'var(--expensica-panel-min-height)'
            });
        }
    }

    private resizeChartToContainer(chart: Chart, force = false): boolean {
        const canvas = chart.canvas;
        const container = canvas.parentElement;
        if (!container) return false;

        const { width, height, minimumWidth, minimumHeight, isMiniDonut } = this.getChartCanvasDimensions(container);

        container.setCssProps({
            '--expensica-panel-natural-width': `${width}px`,
            '--expensica-panel-natural-height': `${height}px`
        });
        if (isMiniDonut) {
            container.style.removeProperty('--expensica-panel-min-width');
            container.style.removeProperty('--expensica-panel-min-height');
            canvas.style.removeProperty('min-width');
            canvas.style.removeProperty('min-height');
        } else {
            container.setCssProps({
                '--expensica-panel-min-width': `${minimumWidth}px`,
                '--expensica-panel-min-height': `${minimumHeight}px`
            });
            canvas.setCssStyles({
                minWidth: 'var(--expensica-panel-min-width)',
                minHeight: 'var(--expensica-panel-min-height)'
            });
        }

        if (!force && canvas.width === width && canvas.height === height) {
            return false;
        }

        chart.stop();
        chart.resize(width, height);
        chart.update('none');
        return true;
    }

    private getChartCanvasDimensions(container: HTMLElement): {
        width: number;
        height: number;
        minimumWidth: number;
        minimumHeight: number;
        isMiniDonut: boolean;
    } {
        const bounds = container.getBoundingClientRect();
        const isMiniDonut = container.classList.contains('expensica-mini-donut-canvas-container');
        let width = Math.max(1, Math.round(bounds.width));
        let height = Math.max(1, Math.round(bounds.height));

        if (isMiniDonut) {
            const styles = window.getComputedStyle(container);
            const horizontalPadding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
            const verticalPadding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
            const minSize = parseFloat(styles.getPropertyValue('--expensica-mini-donut-min-size')) || 128;
            const maxSize = parseFloat(styles.getPropertyValue('--expensica-mini-donut-max-size')) || 160;
            width = Math.round(Math.min(maxSize, Math.max(minSize, bounds.width - horizontalPadding)));
            height = Math.round(Math.min(maxSize, Math.max(minSize, bounds.height - verticalPadding)));
        }

        return {
            width,
            height,
            minimumWidth: Math.round(width * 0.75),
            minimumHeight: Math.round(height * 0.75),
            isMiniDonut
        };
    }

    private clearChartCanvasMeasurement(chart: Chart) {
        const canvas = chart.canvas;
        const container = canvas.parentElement;
        if (!container) return;

        chart.stop();
        this.clearChartLayoutConstraints(container, canvas);
    }

    private clearChartLayoutConstraints(container: HTMLElement, canvas?: HTMLCanvasElement) {
        container.style.removeProperty('--expensica-panel-natural-width');
        container.style.removeProperty('--expensica-panel-natural-height');
        container.style.removeProperty('--expensica-panel-min-width');
        container.style.removeProperty('--expensica-panel-min-height');

        if (canvas) {
            canvas.style.removeProperty('min-width');
            canvas.style.removeProperty('min-height');
        }
    }

    private clearCategoryChartMeasurements(container: HTMLElement) {
        container
            .querySelectorAll<HTMLElement>('.expensica-canvas-container')
            .forEach(canvasContainer => {
                const canvas = canvasContainer.querySelector('canvas');
                this.clearChartLayoutConstraints(canvasContainer, canvas || undefined);
            });
    }

    private clearIncomeExpenseChartLayoutConstraints() {
        const canvasContainer = this.containerEl.querySelector<HTMLElement>(
            '.expensica-income-expense-chart-container .expensica-canvas-container'
        );

        if (!canvasContainer) return;

        const canvas = canvasContainer.querySelector('canvas');
        this.clearChartLayoutConstraints(canvasContainer, canvas || undefined);
    }

    private clearCurrentCategoryChartLayoutConstraints() {
        const container = this.containerEl.querySelector<HTMLElement>('.expensica-expenses-chart-container');
        if (!container) return;

        this.clearCategoryChartMeasurements(container);
    }

    private resetDashboardChartGridStretch() {
        const grid = this.containerEl.querySelector<HTMLElement>('.expensica-dashboard-grid');
        if (!grid) return;

        grid.removeClass('expensica-chart-grid-same-row');
        this.clearCurrentCategoryChartLayoutConstraints();
        this.clearIncomeExpenseChartLayoutConstraints();
    }

    private clearDashboardChartPanelHeights() {
        const grid = this.containerEl.querySelector<HTMLElement>('.expensica-dashboard-grid');
        if (!grid) return;

        const categoriesContainer = grid.querySelector<HTMLElement>('.expensica-expenses-chart-container');
        const incomeExpenseContainer = grid.querySelector<HTMLElement>('.expensica-income-expense-chart-container');
        categoriesContainer?.style.removeProperty('height');
        incomeExpenseContainer?.style.removeProperty('height');
    }

    private getCategoryChartNaturalHeight(): number {
        const container = this.containerEl.querySelector<HTMLElement>('.expensica-expenses-chart-container');
        if (!container) return 0;

        return Math.ceil(container.scrollHeight);
    }

    private syncSameRowChartPanelHeightsToCategory(): boolean {
        this.clearDashboardChartPanelHeights();
        const isSameRow = this.updateDashboardChartGridLayout();
        if (!isSameRow) {
            return false;
        }

        const grid = this.containerEl.querySelector<HTMLElement>('.expensica-dashboard-grid');
        const categoriesContainer = grid?.querySelector('.expensica-expenses-chart-container') as HTMLElement | null;
        const incomeExpenseContainer = grid?.querySelector('.expensica-income-expense-chart-container') as HTMLElement | null;
        const targetHeight = this.getCategoryChartNaturalHeight();

        if (!categoriesContainer || !incomeExpenseContainer || targetHeight <= 0) {
            return false;
        }

        categoriesContainer.setCssStyles({ height: `${targetHeight}px` });
        incomeExpenseContainer.setCssStyles({ height: `${targetHeight}px` });
        return true;
    }

    private getCssPixelValue(element: HTMLElement, property: string, fallback: number): number {
        const probe = element.createDiv();
        probe.setCssStyles({
            position: 'absolute',
            visibility: 'hidden',
            pointerEvents: 'none'
        });
        probe.setCssProps({ width: `var(${property})` });
        const value = parseFloat(getComputedStyle(probe).width);
        probe.remove();
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    private updateDashboardChartGridLayout(dashboardGrid?: HTMLElement | null): boolean {
        const grid = dashboardGrid ?? this.containerEl.querySelector<HTMLElement>('.expensica-dashboard-grid');
        if (!grid) return false;

        const categoriesContainer = grid.querySelector<HTMLElement>('.expensica-expenses-chart-container');
        const incomeExpenseContainer = grid.querySelector<HTMLElement>('.expensica-income-expense-chart-container');
        const categoryChartLayout = categoriesContainer?.querySelector('.expensica-category-chart-layout') as HTMLElement | null;
        if (!categoriesContainer || !incomeExpenseContainer) {
            grid.removeClass('expensica-chart-grid-same-row');
            grid.removeClass('is-narrow');
            categoryChartLayout?.removeClass('is-narrow');
            return false;
        }

        const gridStyles = getComputedStyle(grid);
        const gridWidth = grid.getBoundingClientRect().width;
        const panelMinWidth = this.getCssPixelValue(grid, '--expensica-chart-panel-min-width', 400);
        const gridGap = parseFloat(gridStyles.columnGap || gridStyles.gap) || 0;
        const isNarrow = gridWidth < ((panelMinWidth * 2) + gridGap);

        grid.toggleClass('is-narrow', isNarrow);
        categoryChartLayout?.toggleClass('is-narrow', isNarrow);

        const categoriesTop = categoriesContainer.getBoundingClientRect().top;
        const incomeExpenseTop = incomeExpenseContainer.getBoundingClientRect().top;
        const isSameRow = !isNarrow && Math.abs(categoriesTop - incomeExpenseTop) < 2;
        grid.toggleClass('expensica-chart-grid-same-row', isSameRow);
        return isSameRow;
    }

    private resizeChartsToContainers(): boolean {
        this.updateDashboardChartGridLayout();
        let resizedAnyChart = false;

        [this.expensesChart, this.incomeExpenseChart, this.cumulativeExpensesChart].forEach(chart => {
            if (chart) {
                resizedAnyChart = this.resizeChartToContainer(chart) || resizedAnyChart;
            }
        });

        return resizedAnyChart;
    }

    private refreshIncomeExpenseChartOnly() {
        const container = this.containerEl.querySelector<HTMLElement>('.expensica-income-expense-chart-container');
        if (!container) {
            this.renderDashboard();
            return;
        }

        if (this.incomeExpenseChart) {
            this.incomeExpenseChart.destroy();
            this.incomeExpenseChart = null;
        }

        this.animateIncomeExpenseChartThisRender = this.shouldAnimateIncomeExpenseChartOnNextRender;
        this.shouldAnimateIncomeExpenseChartOnNextRender = false;
        container.empty();
        this.renderIncomeExpenseChart(container);

        window.requestAnimationFrame(() => {
            this.updateDashboardChartGridLayout();
            if (this.incomeExpenseChart) {
                this.resizeChartToContainer(this.incomeExpenseChart);
            }
        });
    }

    private refreshCategoryChartOnly() {
        const container = this.containerEl.querySelector<HTMLElement>('.expensica-expenses-chart-container');
        if (!container) {
            this.renderDashboard();
            return;
        }

        if (this.expensesChart) {
            this.cancelDoughnutLabelAnimation();
            this.clearChartCanvasMeasurement(this.expensesChart);
            this.expensesChart.destroy();
            this.expensesChart = null;
        }

        this.clearDashboardChartPanelHeights();
        this.clearCategoryChartMeasurements(container);
        this.clearIncomeExpenseChartLayoutConstraints();
        this.animateExpensesChartThisRender = this.shouldAnimateExpensesChartOnNextRender;
        this.shouldAnimateExpensesChartOnNextRender = false;
        this.clearSelectorListeners(false);
        container.empty();
        this.renderExpensesChart(container);
    }

    private syncChartsAfterCategoryLayoutChange() {
        window.requestAnimationFrame(() => {
            this.clearDashboardChartPanelHeights();
            this.clearCurrentCategoryChartLayoutConstraints();
            this.clearIncomeExpenseChartLayoutConstraints();

            window.requestAnimationFrame(() => {
                this.clearCurrentCategoryChartLayoutConstraints();
                this.clearIncomeExpenseChartLayoutConstraints();

                const isSameRow = this.syncSameRowChartPanelHeightsToCategory();

                if (this.expensesChart) {
                    this.resizeChartToContainer(this.expensesChart, true);
                }

                if (isSameRow && this.incomeExpenseChart) {
                    this.resizeChartToContainer(this.incomeExpenseChart, true);
                }

                this.premiumVisualizations?.resize();
            });
        });
    }

    private clearChartHoverState(chart: Chart, point = { x: 0, y: 0 }) {
        this.mobileActiveCategorySliceIndex = null;
        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], point);
        chart.update('none');
    }

    private isMobileDashboard(): boolean {
        return document.body.classList.contains('is-mobile');
    }

    private activateCategorySliceByIndex(chart: Chart, index: number, animate = false) {
        const chartElement = chart.getDatasetMeta(0).data[index];
        const tooltipPosition = chartElement?.tooltipPosition?.(false) ?? {
            x: chart.chartArea.left + chart.chartArea.width / 2,
            y: chart.chartArea.top + chart.chartArea.height / 2
        };

        chart.setActiveElements([{ datasetIndex: 0, index }]);
        chart.tooltip?.setActiveElements([{ datasetIndex: 0, index }], tooltipPosition);

        if (animate) {
            this.temporarilyEnableChartAnimations();
        }

        chart.update();
    }

    private activateLineChartElements(
        chart: Chart,
        elements: Array<{ datasetIndex: number; index: number }>,
        animate = false
    ) {
        if (elements.length === 0) {
            this.clearChartHoverState(chart);
            return;
        }

        const firstElement = elements[0];
        const chartElement = chart.getDatasetMeta(firstElement.datasetIndex).data[firstElement.index];
        const tooltipPosition = chartElement?.tooltipPosition?.(false) ?? {
            x: chart.chartArea.left + chart.chartArea.width / 2,
            y: chart.chartArea.top + chart.chartArea.height / 2
        };

        chart.setActiveElements(elements);
        chart.tooltip?.setActiveElements(elements, tooltipPosition);

        if (animate) {
            this.temporarilyEnableChartAnimations();
        }

        chart.update();
    }

    private formatCategoryCardCurrency(amount: number): string {
        return formatCurrency(amount, this.plugin.settings.defaultCurrency);
    }

    private formatBudgetCurrency(amount: number): string {
        return formatCurrency(amount, this.plugin.settings.defaultCurrency);
    }

    private getCategoryChartTransactionType(): TransactionType {
        return this.categoryChartType === CategoryType.INCOME
            ? TransactionType.INCOME
            : TransactionType.EXPENSE;
    }

    private formatCompactChartCurrency(amount: number): string {
        return formatCurrency(amount, this.plugin.settings.defaultCurrency, true);
    }

    private bindChartAreaTooltipClear(canvas: HTMLCanvasElement, chart: Chart) {
        const clearTooltip = () => {
            if (this.isMobileDashboard()) {
                return;
            }
            this.clearChartHoverState(chart);
        };

        canvas.addEventListener('mouseleave', clearTooltip);
        canvas.addEventListener('pointerleave', (event) => {
            if (this.isMobileDashboard() && event.pointerType !== 'mouse') {
                return;
            }
            clearTooltip();
        });
        canvas.addEventListener('pointermove', (event) => {
            if (this.isMobileDashboard() && event.pointerType !== 'mouse') {
                return;
            }

            const chartArea = chart.chartArea;
            if (!chartArea) return;

            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const isInsideChartArea = x >= chartArea.left
                && x <= chartArea.right
                && y >= chartArea.top
                && y <= chartArea.bottom;

            if (!isInsideChartArea) {
                this.clearChartHoverState(chart, { x, y });
            }
        });
        canvas.addEventListener('click', (event) => {
            if (!this.isMobileDashboard()) {
                return;
            }

            const elements = chart.getElementsAtEventForMode(event, 'index', { intersect: false }, false);
            if (elements.length === 0) {
                this.clearChartHoverState(chart);
                return;
            }

            this.activateLineChartElements(chart, elements.map(element => ({
                datasetIndex: element.datasetIndex,
                index: element.index
            })));
        });
    }

    private getChartBarRadius() {
        const probe = document.body.createSpan({ cls: 'expensica-chart-radius-probe' });
        const radius = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
        probe.remove();
        return Number.isFinite(radius) ? radius : 4;
    }

    requestAllChartAnimations() {
        this.shouldAnimateExpensesChartOnNextRender = true;
        this.shouldAnimateIncomeExpenseChartOnNextRender = true;
        this.shouldAnimateCumulativeExpensesChartOnNextRender = true;
    }

    private consumeChartAnimationRequest() {
        this.animateExpensesChartThisRender = this.shouldAnimateExpensesChartOnNextRender;
        this.animateIncomeExpenseChartThisRender = this.shouldAnimateIncomeExpenseChartOnNextRender;
        this.animateCumulativeExpensesChartThisRender = this.shouldAnimateCumulativeExpensesChartOnNextRender;
        this.shouldAnimateExpensesChartOnNextRender = false;
        this.shouldAnimateIncomeExpenseChartOnNextRender = false;
        this.shouldAnimateCumulativeExpensesChartOnNextRender = false;
    }

    private requestExpensesChartAnimation() {
        this.shouldAnimateExpensesChartOnNextRender = true;
    }

    private requestIncomeExpenseChartAnimation() {
        this.shouldAnimateIncomeExpenseChartOnNextRender = true;
    }

    private getChartAnimationOptions(shouldAnimate: boolean) {
        return shouldAnimate
            ? { duration: this.getChartAnimationDuration(), easing: 'easeOutQuart' as const }
            : { duration: 0 };
    }

    private getDoughnutVisibleDoughnutTotal(chart: ChartJS<'doughnut', number[], unknown>): number {
        const dataset = chart.data.datasets[0];
        const rawData = Array.isArray(dataset?.data) ? dataset.data  : [];
        return rawData.reduce((sum, value, index) => {
            if (!chart.getDataVisibility(index)) {
                return sum;
            }

            const numericValue = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(numericValue) ? sum + numericValue : sum;
        }, 0);
    }

    private getActiveDoughnutPercentageValue(chart: ChartJS<'doughnut', number[], unknown>): { index: number; percentage: number; amount: number } | null {
        const [activeElement] = chart.getActiveElements();
        if (!activeElement || !chart.getDataVisibility(activeElement.index)) {
            return null;
        }

        const dataset = chart.data.datasets[activeElement.datasetIndex];
        const rawValue = Array.isArray(dataset?.data) ? dataset.data[activeElement.index] : null;
        const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        const total = this.getDoughnutVisibleDoughnutTotal(chart);

        if (!Number.isFinite(value) || total <= 0) {
            return null;
        }

        return {
            index: activeElement.index,
            percentage: (value / total) * 100,
            amount: value
        };
    }

    private formatDoughnutPercentageLabel(percentage: number, allowZero = false): string {
        if (allowZero && percentage <= 0) {
            return '0%';
        }

        if (!Number.isFinite(percentage) || percentage <= 0) {
            return '0.01%';
        }

        if (percentage >= 100) {
            return '100%';
        }

        if (percentage >= 1) {
            return `${parseFloat(percentage.toFixed(2)).toString()}%`;
        }

        return `${percentage.toFixed(2)}%`;
    }

    private easeOutDoughnutLabelAnimation(progress: number): number {
        return 1 - Math.pow(1 - progress, 3);
    }

    private cancelDoughnutLabelAnimation() {
        if (this.doughnutLabelAnimationFrame != null) {
            window.cancelAnimationFrame(this.doughnutLabelAnimationFrame);
            this.doughnutLabelAnimationFrame = null;
        }

        this.doughnutLabelAnimationIndex = null;
        this.doughnutLabelAnimationStartTime = 0;
        this.doughnutLabelAnimationTarget = 0;
        this.doughnutLabelAnimationValue = 0;
        this.doughnutAmountAnimationTarget = 0;
        this.doughnutAmountAnimationValue = 0;
    }

    private startDoughnutLabelAnimation(chart: ChartJS<'doughnut', number[], unknown>, index: number, targetPercentage: number, targetAmount: number) {
        this.cancelDoughnutLabelAnimation();
        this.doughnutLabelAnimationIndex = index;
        this.doughnutLabelAnimationTarget = targetPercentage;
        this.doughnutLabelAnimationValue = 0;
        this.doughnutAmountAnimationTarget = targetAmount;
        this.doughnutAmountAnimationValue = 0;
        this.doughnutLabelAnimationStartTime = performance.now();

        const duration = 450;
        const tick = (now: number) => {
            if (this.doughnutLabelAnimationIndex !== index) {
                this.doughnutLabelAnimationFrame = null;
                return;
            }

            const progress = Math.min(1, (now - this.doughnutLabelAnimationStartTime) / duration);
            const easedProgress = this.easeOutDoughnutLabelAnimation(progress);
            this.doughnutLabelAnimationValue = targetPercentage * easedProgress;
            this.doughnutAmountAnimationValue = targetAmount * easedProgress;
            chart.draw();

            if (progress < 1) {
                this.doughnutLabelAnimationFrame = window.requestAnimationFrame(tick);
                return;
            }

            this.doughnutLabelAnimationValue = targetPercentage;
            this.doughnutAmountAnimationValue = targetAmount;
            this.doughnutLabelAnimationFrame = null;
            chart.draw();
        };

        this.doughnutLabelAnimationFrame = window.requestAnimationFrame(tick);
    }

    private createDoughnutCenterTextPlugin(): ChartPlugin<'doughnut'> {
        return {
            id: 'expensicaDoughnutCenterText',
            afterDatasetsDraw: (chart) => {
                const activePercentage = this.getActiveDoughnutPercentageValue(chart);
                if (!activePercentage) {
                    this.cancelDoughnutLabelAnimation();
                } else if (
                    this.doughnutLabelAnimationIndex !== activePercentage.index
                    || Math.abs(this.doughnutLabelAnimationTarget - activePercentage.percentage) > 0.001
                    || Math.abs(this.doughnutAmountAnimationTarget - activePercentage.amount) > 0.001
                ) {
                    this.startDoughnutLabelAnimation(chart, activePercentage.index, activePercentage.percentage, activePercentage.amount);
                }

                const meta = chart.getDatasetMeta(0);
                const firstArc = meta.data[0] as ArcElement | undefined;
                const amountValue = activePercentage
                    ? this.doughnutAmountAnimationValue : this.getDoughnutVisibleDoughnutTotal(chart);
                const percentageValue = activePercentage
                    ? this.doughnutLabelAnimationValue : amountValue > 0 ? 100 : 0;
                const label = this.formatDoughnutPercentageLabel(percentageValue, true);

                const ctx = chart.ctx;
                const styles = getComputedStyle(chart.canvas);
                const fontSize = styles.getPropertyValue('--expensica-font-size-donut-current').trim()
                    || styles.getPropertyValue('--expensica-font-size-donut').trim()
                    || '64px';
                const amountFontSize = styles.getPropertyValue('--expensica-font-size-donut-amount-current').trim()
                    || styles.getPropertyValue('--expensica-font-size-donut-amount').trim()
                    || '20px';
                const amount = formatCurrency(amountValue, this.plugin.settings.defaultCurrency);
                const fontFamily = styles.fontFamily || getComputedStyle(document.body).fontFamily || 'sans-serif';
                const x = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
                const y = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
                const gap = parseFloat(styles.getPropertyValue('--expensica-donut-label-gap')) || 8;
                const amountY = y + (parseFloat(fontSize) + parseFloat(amountFontSize)) / 2 + gap;
                const textWidth = Math.max(0, firstArc ? firstArc.innerRadius * 2 - 8 : chart.chartArea.width);

                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = styles.color || 'currentColor';
                ctx.font = `700 ${fontSize} ${fontFamily}`;
                ctx.fillText(label, x, y);
                ctx.font = `400 ${amountFontSize} ${fontFamily}`;
                ctx.fillText(amount, x, amountY, textWidth);
                ctx.restore();
            }
        };
    }

    private getChartAnimationDuration() {
        return 500;
    }

    private getChartResizeDelay() {
        return 350;
    }

    private scheduleChartAnimationReset(delay = this.getChartAnimationDuration() + 100) {
        if (this.chartAnimationResetTimeout !== null) {
            window.clearTimeout(this.chartAnimationResetTimeout);
        }

        this.chartAnimationResetTimeout = window.setTimeout(() => {
            this.setChartAnimations(false);
            this.chartAnimationResetTimeout = null;
        }, delay);
    }

    private temporarilyEnableChartAnimations(delay = this.getChartAnimationDuration() + 100) {
        this.setChartAnimations(true);
        this.scheduleChartAnimationReset(delay);
    }

    private cancelIncomeExpenseToggleAnimation() {
        if (this.incomeExpenseToggleAnimationFrame !== null) {
            window.cancelAnimationFrame(this.incomeExpenseToggleAnimationFrame);
            this.incomeExpenseToggleAnimationFrame = null;
        }
    }

    private cancelIncomeExpenseHoverAnimation() {
        if (this.incomeExpenseHoverAnimationFrame !== null) {
            window.cancelAnimationFrame(this.incomeExpenseHoverAnimationFrame);
            this.incomeExpenseHoverAnimationFrame = null;
        }
    }

    private restoreIncomeExpenseAnimationData(chart: Chart) {
        chart.data.datasets.forEach(dataset => {
            const animatedDataset = dataset as AnimatedChartDataset;
            const pendingData = animatedDataset.__expensicaPendingAnimationData;
            if (pendingData) {
                dataset.data = pendingData;
                delete animatedDataset.__expensicaPendingAnimationData;
            }
        });
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
                label = DATE_RANGE_LABEL_TODAY;
                break;
                
            case DateRangeType.THIS_WEEK: {
                // Get the first day of the week (Sunday)
                const dayOfWeek = now.getDay();
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek), 23, 59, 59, 999);
                label = DATE_RANGE_LABEL_THIS_WEEK;
                break;
            }

            case DateRangeType.LAST_WEEK: {
                // Get the previous week (Sunday through Saturday)
                const currentDayOfWeek = now.getDay();
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayOfWeek - 7);
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayOfWeek - 1, 23, 59, 59, 999);
                label = DATE_RANGE_LABEL_LAST_WEEK;
                break;
            }
                
            case DateRangeType.THIS_MONTH:
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                label = DATE_RANGE_LABEL_THIS_MONTH;
                break;
                
            case DateRangeType.LAST_MONTH:
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                label = DATE_RANGE_LABEL_LAST_MONTH;
                break;
                
            case DateRangeType.THIS_YEAR:
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
                label = DATE_RANGE_LABEL_THIS_YEAR;
                break;

            case DateRangeType.LAST_YEAR:
                start = new Date(now.getFullYear() - 1, 0, 1);
                end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
                label = DATE_RANGE_LABEL_LAST_YEAR;
                break;

            case DateRangeType.ALL_TIME:
                ({ start, end } = this.getAllTimeDateRangeBounds());
                label = DATE_RANGE_LABEL_ALL_TIME;
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
                    label = DATE_RANGE_LABEL_CUSTOM_RANGE;
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

    getCumulativeBalanceThrough(endDate: Date): number {
        const normalizedEndDate = new Date(endDate);
        normalizedEndDate.setHours(23, 59, 59, 999);

        return this.plugin.getAllTransactions().reduce((balance, transaction) => {
            const transactionDate = parseLocalDate(transaction.date);
            if (transactionDate > normalizedEndDate) {
                return balance;
            }

            if (transaction.type === TransactionType.INCOME) {
                return balance + transaction.amount;
            }

            return transaction.type === TransactionType.EXPENSE
                ? balance - transaction.amount
                : balance;
        }, 0);
    }

    getDefaultAccountBalanceThrough(endDate: Date): number {
        const normalizedEndDate = new Date(endDate);
        normalizedEndDate.setHours(23, 59, 59, 999);
        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const transactionsThroughDate = this.plugin.getAllTransactions().filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
            return transactionDate <= normalizedEndDate;
        });

        return getAccountRunningBalance(this.plugin, defaultAccountReference, transactionsThroughDate);
    }

    getIncomeExpenseChartAccounts(): { reference: string; name: string; color: string; isCredit: boolean }[] {
        if (!this.plugin.settings.enableAccounts) {
            const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
            const defaultAccount = this.plugin.getTransactionAccountDisplay(undefined);
            return [{
                reference: defaultAccountReference,
                name: defaultAccount.name,
                color: getAccountColor(defaultAccount, [defaultAccount]),
                isCredit: false
            }];
        }

        const accounts = this.plugin.getAccounts();
        return accounts.map(account => ({
            reference: this.plugin.normalizeTransactionAccountReference(
                formatAccountReference(account.type, account.name)
            ),
            name: account.name,
            color: getAccountColor(account, accounts),
            isCredit: account.type === AccountType.CREDIT
        }));
    }

    getAccountBalanceThroughDateTime(accountReference: string, endDate: Date): number {
        return this.plugin.getAllTransactions().reduce((balance, transaction) => {
            if (this.getTransactionDateTime(transaction) > endDate) {
                return balance;
            }

            return balance + getAccountTransactionAmount(this.plugin, transaction, accountReference);
        }, 0);
    }

    getNetBalanceThrough(endDate: Date): number {
        const normalizedEndDate = new Date(endDate);
        normalizedEndDate.setHours(23, 59, 59, 999);
        const transactionsThroughDate = this.plugin.getAllTransactions().filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
            return transactionDate <= normalizedEndDate;
        });

        if (!this.plugin.settings.enableAccounts) {
            return transactionsThroughDate.reduce((balance, transaction) => {
                if (transaction.type === TransactionType.INCOME) {
                    return balance + transaction.amount;
                }

                return transaction.type === TransactionType.EXPENSE
                    ? balance - transaction.amount
                    : balance;
            }, 0);
        }

        return this.plugin.getAccounts().reduce((netBalance, account) => {
            const accountReference = this.plugin.normalizeTransactionAccountReference(
                formatAccountReference(account.type, account.name)
            );
            const accountBalance = getAccountRunningBalance(this.plugin, accountReference, transactionsThroughDate);

            return netBalance + (account.type === AccountType.CREDIT ? -accountBalance : accountBalance);
        }, 0);
    }

    getPreviousMonthEndDate(): Date {
        return new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 0, 23, 59, 59, 999);
    }

    getSummaryComparisonRange(): { range: DateRange; label: string } | null {
        switch (this.dateRange.type) {
            case DateRangeType.THIS_WEEK:
                return { range: this.getDateRange(DateRangeType.LAST_WEEK), label: 'Last Wk' };
            case DateRangeType.THIS_MONTH:
                return { range: this.getDateRange(DateRangeType.LAST_MONTH), label: 'Last M' };
            case DateRangeType.THIS_YEAR:
                return { range: this.getDateRange(DateRangeType.LAST_YEAR), label: 'Last Y' };
            default:
                return null;
        }
    }

    getPreviousPeriodComparisonRange(): { range: DateRange; label: string } | null {
        const start = new Date(this.dateRange.startDate);
        const end = new Date(this.dateRange.endDate);

        switch (this.dateRange.type) {
            case DateRangeType.TODAY:
                {
                    const range = this.getDateRange(
                        DateRangeType.CUSTOM,
                        new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1),
                        new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
                    );
                    return {
                        range,
                        label: this.getResolvedDateRangeLegendLabel(range)
                    };
                }
            case DateRangeType.THIS_WEEK:
            case DateRangeType.LAST_WEEK:
                {
                    const range = this.getDateRange(
                        DateRangeType.CUSTOM,
                        new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7),
                        new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7)
                    );
                    return {
                        range,
                        label: this.getResolvedDateRangeLegendLabel(range)
                    };
                }
            case DateRangeType.THIS_MONTH:
            case DateRangeType.LAST_MONTH:
                {
                    const range = this.getDateRange(
                        DateRangeType.CUSTOM,
                        new Date(start.getFullYear(), start.getMonth() - 1, 1),
                        new Date(start.getFullYear(), start.getMonth(), 0)
                    );
                    return {
                        range,
                        label: this.getResolvedDateRangeLegendLabel(range)
                    };
                }
            case DateRangeType.THIS_YEAR:
            case DateRangeType.LAST_YEAR:
                {
                    const range = this.getDateRange(
                        DateRangeType.CUSTOM,
                        new Date(start.getFullYear() - 1, 0, 1),
                        new Date(start.getFullYear() - 1, 11, 31)
                    );
                    return {
                        range,
                        label: this.getResolvedDateRangeLegendLabel(range)
                    };
                }
            case DateRangeType.CUSTOM:
                {
                    const range = this.getDateRange(
                        DateRangeType.CUSTOM,
                        new Date(start.getFullYear() - 1, start.getMonth(), start.getDate()),
                        new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
                    );
                    return {
                        range,
                        label: this.getResolvedDateRangeLegendLabel(range)
                    };
                }
            case DateRangeType.ALL_TIME:
            default:
                return null;
        }
    }

    getTransactionsForDateRange(dateRange: DateRange): Transaction[] {
        return this.plugin.getAllTransactions().filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
            return transactionDate >= dateRange.startDate && transactionDate <= dateRange.endDate;
        });
    }

    loadTransactionsForDateRange() {
        // All Time bounds depend on the current ledger, including newly recovered/imported records.
        if (this.dateRange.type === DateRangeType.ALL_TIME) {
            this.dateRange = this.getDateRange(DateRangeType.ALL_TIME);
        }
        // Get all transactions
        const allTransactions = this.plugin.getAllTransactions();
        
        // Filter transactions based on the date range
        this.transactions = allTransactions.filter(transaction => {
            const transactionDate = parseLocalDate(transaction.date);
            return transactionDate >= this.dateRange.startDate && 
                   transactionDate <= this.dateRange.endDate;
        });
        
        this.filteredTransactions = [...this.transactions];
        
        // For first-load defaults, align the calendar to the selected range end, but do not overwrite restored calendar state.
        if (this.dateRange.type === DateRangeType.THIS_MONTH && !this.selectedCalendarDate) {
            const selectionDate = this.getDateRangeSelectionDate(this.dateRange);
            this.currentDate = selectionDate;
            this.selectedCalendarDate = selectionDate;
        }
    }

    async addTransaction(transaction: Transaction) {
        await this.plugin.addTransaction(transaction, this);
        await this.loadTransactionsData();
        this.requestAllChartAnimations();
        this.renderDashboard();
        showExpensicaNotice('Transaction added successfully');
    }

    async updateTransaction(transaction: Transaction) {
        await this.plugin.updateTransaction(transaction, this);
        this.selectedTransactionIds.delete(transaction.id);
        await this.loadTransactionsData();
        this.requestAllChartAnimations();
        this.renderDashboard();
        showExpensicaNotice('Transaction updated successfully');
    }

    async deleteTransaction(id: string, onDeleted?: () => void, onConfirmDelete?: () => void) {
        const transaction = this.transactions.find(t => t.id === id);
        if (!transaction) return;

        new ConfirmationModal(
            this.app,
            'Delete Transaction?',
            `Are you sure you want to delete this ${transaction.type.toLowerCase()} transaction? This action cannot be undone.`,
            async (confirmed) => {
                if (confirmed) {
                    await this.plugin.deleteTransaction(id, this);
                    onConfirmDelete?.();
                    this.selectedTransactionIds.delete(id);
                    await this.loadTransactionsData();
                    this.requestAllChartAnimations();
                    this.renderDashboard();
                    showExpensicaNotice('Transaction deleted successfully');
                    onDeleted?.();
                }
            }, 'Delete', this.plugin
        ).open();
    }

    async deleteBudget(id: string, onDeleted?: () => void) {
        const budget = this.plugin.getAllBudgets().find(entry => entry.id === id);
        if (!budget) return;

        const category = this.plugin.getCategoryById(budget.categoryId);
        const categoryName = category?.name || 'this category';

        new ConfirmationModal(
            this.app,
            'Delete Budget?',
            `Are you sure you want to delete the budget for ${categoryName}? This action cannot be undone.`,
            async (confirmed) => {
                if (!confirmed) {
                    return;
                }

                await this.plugin.deleteBudget(id);
                showExpensicaNotice('Budget deleted successfully');
                onDeleted?.();
            }, 'Delete', this.plugin
        ).open();
    }

    private async deleteSelectedTransactions(selectedTransactions: Transaction[]) {
        if (selectedTransactions.length === 0) {
            return;
        }

        new ConfirmationModal(
            this.app,
            'Delete Transactions?',
            `Are you sure you want to delete ${selectedTransactions.length} selected transactions? This action cannot be undone.`,
            async (confirmed) => {
                if (!confirmed) {
                    return;
                }

                await this.plugin.deleteTransactions(selectedTransactions.map(transaction => transaction.id), this);
                this.selectedTransactionIds.clear();
                await this.loadTransactionsData();
                this.requestAllChartAnimations();
                this.renderDashboard();
                showExpensicaNotice('Transactions deleted successfully');
            }, 'Delete', this.plugin
        ).open();
    }

    getDefaultTransactionDate(): Date {
        return this.selectedCalendarDate ? new Date(this.selectedCalendarDate) : new Date();
    }

    async refreshData(budgetsOnly = false) {
        if (budgetsOnly && this.currentTab !== DashboardTab.BUDGET) return;
        if (!budgetsOnly) await this.loadTransactionsData();

        if (!this.isDashboardVisible()) {
            this.pendingDataRefresh = budgetsOnly && this.pendingDataRefresh !== 'transactions'
                ? 'budgets' : 'transactions';
            return;
        }

        this.pendingDataRefresh = null;
        if (budgetsOnly) this.refreshCurrentTabContent();
        else this.renderDashboard();
    }

    renderDashboard() {
        this.pendingDataRefresh = null;
        const container = this.containerEl.children[1] as HTMLElement;
        const isRoutineRender = this.hasRenderedDashboard;
        const pendingChartAnchorSelector = this.pendingChartScrollAnchorSelector;
        this.consumeChartAnimationRequest();
        this.rememberScrollPosition();
        this.clearSelectorListeners();
        this.destroyCharts();
        this.plugin.deactivateDashboardTransactionsTab?.(this);
        container.empty();
        container.removeClass('expensica-container');
        container.removeClass('transactions-container');
        container.removeClass('expensica-dashboard-transactions-tab');
        container.addClass('expensica-dashboard');
        container.toggleClass('expensica-suppress-motion', isRoutineRender);
        this.plugin.renderDataRecoveryWarning(container);

        // If budgeting is disabled and current tab is budget, switch to overview
        if (!this.plugin.settings.enableBudgeting && this.currentTab === DashboardTab.BUDGET) {
            this.currentTab = DashboardTab.OVERVIEW;
        }

        if (!this.plugin.settings.enableAccounts && this.currentTab === DashboardTab.ACCOUNTS) {
            this.currentTab = DashboardTab.OVERVIEW;
        }

        // Header
        this.renderHeader(container);

        // Tab navigation
        this.renderTabNavigation(container);

        this.renderCurrentTabContent(container);

        if (pendingChartAnchorSelector) {
            this.restoreChartAnchorPosition(pendingChartAnchorSelector);
        } else {
            this.restoreScrollPosition();
        }
        this.hasRenderedDashboard = true;
    }

    private refreshCurrentTabContent() {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container || container.childElementCount === 0) {
            this.renderDashboard();
            return;
        }

        const pendingChartAnchorSelector = this.pendingChartScrollAnchorSelector;
        this.consumeChartAnimationRequest();
        this.rememberScrollPosition();
        this.clearTabContent(container);
        container.toggleClass('expensica-suppress-motion', true);
        this.renderCurrentTabContent(container);

        if (pendingChartAnchorSelector) {
            this.restoreChartAnchorPosition(pendingChartAnchorSelector);
        } else {
            this.restoreScrollPosition();
        }
    }

    private renderCurrentTabContent(container: HTMLElement) {
        this.pendingDataRefresh = null;
        container.removeClass('expensica-container');
        container.removeClass('transactions-container');
        container.removeClass('expensica-dashboard-transactions-tab');

        switch (this.currentTab) {
            case DashboardTab.OVERVIEW:
                this.renderOverviewTab(container);
                break;
            case DashboardTab.TRANSACTIONS:
                this.renderTransactionsTab(container);
                break;
            case DashboardTab.ACCOUNTS:
                if (this.plugin.settings.enableAccounts) {
                    this.renderAccountsTab(container);
                } else {
                    this.renderOverviewTab(container);
                }
                break;
            case DashboardTab.BUDGET:
                this.renderBudgetTab(container);
                break;
            case DashboardTab.CATEGORIES:
                this.renderCategoriesTab(container);
                break;
        }
    }

    private clearSelectorListeners(includeDateRange = true) {
        if (includeDateRange && this.dateRangeSelectorComponent) {
            this.removeChild(this.dateRangeSelectorComponent);
            this.dateRangeSelectorComponent = null;
        }
        if (this.categoryChartTypeSelectorComponent) {
            this.removeChild(this.categoryChartTypeSelectorComponent);
            this.categoryChartTypeSelectorComponent = null;
        }
    }

    private clearTabContent(container: HTMLElement) {
        this.plugin.deactivateDashboardTransactionsTab?.(this);
        this.clearSelectorListeners(false);
        this.destroyCharts();
        const children = Array.from(container.children);
        const tabsIndex = children.findIndex(child => child.classList.contains('expensica-tabs'));
        const firstContentIndex = tabsIndex >= 0 ? tabsIndex + 1 : 0;

        children.slice(firstContentIndex).forEach(child => child.remove());
    }

    private updateActiveTabButtons(container: HTMLElement) {
        container.querySelectorAll<HTMLElement>('.expensica-tab').forEach(tab => {
            const tabName = tab.getAttribute('data-expensica-tab') as DashboardTab | null;
            tab.toggleClass('active', tabName === this.currentTab);
        });
    }

    switchDashboardTab(tab: DashboardTab) {
        if (this.currentTab === tab) {
            return;
        }

        this.currentTab = tab;
        this.persistDashboardState();

        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container || container.childElementCount === 0) {
            this.renderDashboard();
            return;
        }

        this.consumeChartAnimationRequest();
        this.rememberScrollPosition();
        this.clearTabContent(container);
        this.updateActiveTabButtons(container);
        this.renderCurrentTabContent(container);
        this.restoreScrollPosition();
    }

    rememberScrollPosition() {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (container && container.childElementCount > 0) {
            this.scrollTop = container.scrollTop;
        }
    }

    restoreScrollPosition() {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container) return;

        window.requestAnimationFrame(() => {
            container.scrollTop = this.scrollTop;
        });
    }

    private restoreChartAnchorPosition(selector: string) {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container) {
            this.pendingChartScrollAnchorSelector = null;
            return;
        }

        window.requestAnimationFrame(() => {
            const anchor = container.querySelector<HTMLElement>(selector);
            if (!anchor) {
                this.pendingChartScrollAnchorSelector = null;
                container.scrollTop = this.scrollTop;
                return;
            }

            const containerRect = container.getBoundingClientRect();
            const anchorRect = anchor.getBoundingClientRect();
            const targetAnchorTop = containerRect.top + ((containerRect.height - anchorRect.height) / 2);
            const nextScrollTop = container.scrollTop + (anchorRect.top - targetAnchorTop);
            container.scrollTop = Math.max(0, nextScrollTop);
            this.scrollTop = container.scrollTop;
            this.pendingChartScrollAnchorSelector = null;
        });
    }

    private getChartScrollAnchorSelector(container: HTMLElement): string | null {
        const chartContainer = container.closest<HTMLElement>('.expensica-chart-container');
        if (!chartContainer) {
            return null;
        }

        if (chartContainer.classList.contains('expensica-cumulative-expenses-chart-container')) {
            return '.expensica-cumulative-expenses-chart-container';
        }

        if (chartContainer.classList.contains('expensica-expenses-chart-container')) {
            return '.expensica-expenses-chart-container';
        }

        if (chartContainer.classList.contains('expensica-income-expense-chart-container')) {
            return '.expensica-income-expense-chart-container';
        }

        return null;
    }

    scrollToTop() {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        this.scrollTop = 0;
        if (!container) return;

        window.requestAnimationFrame(() => {
            container.scrollTop = 0;
        });
    }

    persistDashboardState() {
        this.rememberScrollPosition();
        this.app.workspace.requestSaveLayout();
    }

    private getDashboardRenderStateSignature(): string {
        return JSON.stringify({
            currentTab: this.currentTab,
            dateRangeType: this.dateRange.type,
            dateRangeStart: formatDate(this.dateRange.startDate),
            dateRangeEnd: formatDate(this.dateRange.endDate),
            customStartDate: this.customStartDate ? formatDate(this.customStartDate) : null,
            customEndDate: this.customEndDate ? formatDate(this.customEndDate) : null,
            dateRangeUpdatedAt: this.dateRangeUpdatedAt,
            currentDate: formatDate(this.currentDate),
            selectedCalendarDate: this.selectedCalendarDate ? formatDate(this.selectedCalendarDate) : null,
            expenseChartPeriod: this.expenseChartPeriod,
            categoryChartType: this.categoryChartType,
            incomeExpenseVisibility: this.incomeExpenseVisibility
        });
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

        const selectionDate = this.getDateRangeSelectionDate(this.dateRange);
        this.currentDate = selectionDate;
        this.selectedCalendarDate = selectionDate;
    }

    async applySharedDateRangeState(state: SharedDateRangeState) {
        if (state.updatedAt < this.dateRangeUpdatedAt) {
            return;
        }

        this.applySharedDateRangeStateValues(state);
        await this.loadTransactionsData();
        this.persistDashboardState();
        this.requestAllChartAnimations();
        this.renderDashboard();
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

    getDateRangeSelectionDate(dateRange: DateRange): Date {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

        if (dateRange.startDate <= todayEnd && dateRange.endDate >= todayStart) {
            return todayStart;
        }

        const selectionDate = dateRange.endDate < todayStart
            ? new Date(dateRange.endDate)
            : new Date(dateRange.startDate);
        selectionDate.setHours(0, 0, 0, 0);
        return selectionDate;
    }

    async handleCalendarTodayClick() {
        const today = new Date();
        const todayStart = parseLocalDate(formatDate(today));
        const rangeChanged = this.dateRange.endDate < todayStart;

        if (rangeChanged) {
            this.dateRange = this.getDateRange(DateRangeType.THIS_MONTH);
            const selectionDate = this.getDateRangeSelectionDate(this.dateRange);
            this.currentDate = selectionDate;
            this.selectedCalendarDate = selectionDate;
        } else {
            this.currentDate = todayStart;
            this.selectedCalendarDate = todayStart;
        }

        if (rangeChanged) {
            await this.loadTransactionsData();
            this.persistDashboardState();
            this.requestAllChartAnimations();
            const container = this.containerEl.children[1] as HTMLElement;
            container.querySelector('.shadcn-date-range-text')?.setText(this.dateRange.label);
            container.querySelectorAll<HTMLElement>('.shadcn-date-range-option').forEach(option => {
                option.toggleClass('shadcn-date-range-option-active', option.textContent === this.dateRange.label);
            });
            this.refreshCurrentTabContent();
        } else {
            this.premiumVisualizations?.updateDate(todayStart, true);
            this.persistDashboardState();
        }
    }

    // Render the tab navigation
    renderTabNavigation(container: HTMLElement) {
        const tabsContainer = container.createDiv('expensica-tabs');
        
        // Overview tab
        const overviewTab = tabsContainer.createEl('button', {
            text: 'Overview',
            cls: `expensica-standard-button expensica-tab ${this.currentTab === DashboardTab.OVERVIEW ? 'active' : ''}`,
            attr: { 'data-expensica-tab': DashboardTab.OVERVIEW }
        });

        const transactionsTab = tabsContainer.createEl('button', {
            text: 'Transactions',
            cls: `expensica-standard-button expensica-tab ${this.currentTab === DashboardTab.TRANSACTIONS ? 'active' : ''}`,
            attr: { 'data-expensica-tab': DashboardTab.TRANSACTIONS }
        });

        let accountsTab: HTMLButtonElement | null = null;
        if (this.plugin.settings.enableAccounts) {
            accountsTab = tabsContainer.createEl('button', {
                text: 'Accounts',
                cls: `expensica-standard-button expensica-tab ${this.currentTab === DashboardTab.ACCOUNTS ? 'active' : ''}`,
                attr: { 'data-expensica-tab': DashboardTab.ACCOUNTS }
            });
        }
        
        // Budget tab - only show if budgeting is enabled
        if (this.plugin.settings.enableBudgeting) {
            const budgetTab = tabsContainer.createEl('button', {
                text: 'Budgets',
                cls: `expensica-standard-button expensica-tab ${this.currentTab === DashboardTab.BUDGET ? 'active' : ''}`,
                attr: { 'data-expensica-tab': DashboardTab.BUDGET }
            });
            
            // Add event listener
            budgetTab.addEventListener('click', () => {
                this.switchDashboardTab(DashboardTab.BUDGET);
            });
        }

        const categoriesTab = tabsContainer.createEl('button', {
            text: 'Categories',
            cls: `expensica-standard-button expensica-tab ${this.currentTab === DashboardTab.CATEGORIES ? 'active' : ''}`,
            attr: { 'data-expensica-tab': DashboardTab.CATEGORIES }
        });

        categoriesTab.addEventListener('click', () => {
            this.switchDashboardTab(DashboardTab.CATEGORIES);
        });
        
        // Add event listeners
        overviewTab.addEventListener('click', () => {
            this.switchDashboardTab(DashboardTab.OVERVIEW);
        });

        transactionsTab.addEventListener('click', () => {
            this.switchDashboardTab(DashboardTab.TRANSACTIONS);
        });

        accountsTab?.addEventListener('click', () => {
            this.switchDashboardTab(DashboardTab.ACCOUNTS);
        });
    }

    // Render the overview tab (original dashboard content)
    renderOverviewTab(container: HTMLElement) {
        // Summary cards
        this.renderSummary(container);

        const cumulativeExpensesChartContainer = container.createDiv('expensica-chart-container expensica-cumulative-expenses-chart-container expensica-animate expensica-animate-delay-1');
        this.renderCumulativeExpensesChart(cumulativeExpensesChartContainer);

        // Premium visualizations section
        this.renderPremiumVisualizations(container);

        // Charts in a grid
        const dashboardGrid = container.createDiv('expensica-dashboard-grid');

        // Expenses by category chart container
        const expensesChartContainer = dashboardGrid.createDiv('expensica-chart-container expensica-expenses-chart-container expensica-animate expensica-animate-delay-1');
        this.renderExpensesChart(expensesChartContainer);

        // Income vs Expenses chart container
        const incomeExpenseChartContainer = dashboardGrid.createDiv('expensica-chart-container expensica-income-expense-chart-container expensica-animate expensica-animate-delay-2');
        this.renderIncomeExpenseChart(incomeExpenseChartContainer);

        window.requestAnimationFrame(() => {
            this.updateDashboardChartGridLayout(dashboardGrid);
            this.resizeChartsToContainers();
        });

        // Recent transactions
        this.renderTransactions(container);
    }

    renderTransactionsTab(container: HTMLElement) {
        this.plugin.renderDashboardTransactionsTab(this, container);
    }

    renderAccountsTab(container: HTMLElement) {
        const accountsContainer = container.createDiv('expensica-accounts-container');
        const accountsList = accountsContainer.createDiv('expensica-accounts-list');
        const accounts = this.plugin.getAccounts();
        const sourceTransactions = this.plugin.getAllTransactions();
        const allTransactions = sortTransactionsByDateTimeDesc(sourceTransactions, sourceTransactions);
        const defaultAccountReference = allTransactions.length
            ? this.plugin.normalizeTransactionAccountReference(undefined) : undefined;

        accounts.forEach(account => {
            const accountReference = formatAccountReference(account.type, account.name);
            const isCredit = account.type === AccountType.CREDIT;
            let lastTransaction: Transaction | null = null;
            let runningBalance = 0;
            for (const transaction of allTransactions) {
                const amount = getAccountTransactionAmount(this.plugin, transaction, accountReference, isCredit, defaultAccountReference);
                if (amount === 0) continue;
                lastTransaction ??= transaction;
                runningBalance += amount;
            }

            renderAccountCard(accountsList, {
                account,
                runningBalance: normalizeBalanceValue(runningBalance),
                currencyCode: this.plugin.settings.defaultCurrency,
                color: getAccountColor(account, accounts),
                creditLimitLabel: account.type === AccountType.CREDIT && typeof account.creditLimit === 'number'
                    ? `${formatCurrency(
                        Math.max(0, account.creditLimit - Math.max(0, runningBalance)),
                        this.plugin.settings.defaultCurrency
                    )}`
                    : undefined,
                lastTransactionDateLabel: lastTransaction
                    ? parseLocalDate(lastTransaction.date).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric'
                    })
                    : 'No transactions yet',
                onClick: () => {
                    new AccountEditorModal(this.app, this.plugin, this, account).open();
                }
            });
        });

        renderCreateAccountCard(accountsList, {
            onClick: () => {
                new AccountEditorModal(this.app, this.plugin, this).open();
            }
        });
    }

    // New method to render the budget tab
    renderBudgetTab(container: HTMLElement) {
        const budgetContainer = container.createDiv('expensica-budget-container');
        const budgetStatuses = this.getBudgetStatuses();
        budgetContainer.createEl('p', {
            text: `Budget periods containing ${formatDate(this.dateRange.endDate)}. Historical views use current budget terms.`,
            cls: 'expensica-form-description'
        });
        
        // Budget summary section
        const budgetSummary = budgetContainer.createDiv('expensica-budget-summary expensica-animate');
        this.renderBudgetSummary(budgetSummary, budgetStatuses);
        
        // Budget list section
        const budgetList = budgetContainer.createDiv('expensica-budget-list expensica-animate expensica-animate-delay-1');
        
        // Check if there are budgets
        if (budgetStatuses.length === 0) {
            // Enhanced empty state
            const emptyState = budgetList.createDiv('expensica-empty-budget-state');
            
            createDashboardSvgIcon(emptyState, '24', '1', [
                { tag: 'rect', attributes: { x: '2', y: '3', width: '20', height: '14', rx: '2', ry: '2' } },
                { tag: 'line', attributes: { x1: '8', y1: '21', x2: '16', y2: '21' } },
                { tag: 'line', attributes: { x1: '12', y1: '17', x2: '12', y2: '21' } },
                { tag: 'path', attributes: { d: 'M6 8h.01M12 8h.01M18 8h.01' } }
            ]);
            
            // Add heading
            const heading = emptyState.createEl('h3');
            heading.textContent = 'No Budgets Created Yet';
            
            // Add paragraph
            const paragraph = emptyState.createEl('p');
            paragraph.textContent = 'Create your first budget to start tracking spending against your targets and stay on top of your financial goals.';
        } else {
            this.renderBudgetList(budgetList, budgetStatuses);
        }
        
        // Add budget button
        const addBudgetContainer = budgetContainer.createDiv('expensica-add-budget-container expensica-animate expensica-animate-delay-2');
        const addBudgetBtn = addBudgetContainer.createDiv('expensica-account-card expensica-account-card-create expensica-account-card-interactive');
        addBudgetBtn.setAttribute('role', 'button');
        addBudgetBtn.setAttribute('tabindex', '0');

        const addBudgetHeader = addBudgetBtn.createDiv('expensica-account-card-header');
        const addBudgetIdentity = addBudgetHeader.createDiv('expensica-account-card-identity');
        addBudgetIdentity.createDiv({ text: '+', cls: 'expensica-account-card-icon expensica-account-card-icon-create' });

        const addBudgetTextGroup = addBudgetIdentity.createDiv('expensica-account-card-text');
        const addBudgetTitleRow = addBudgetTextGroup.createDiv('expensica-account-card-title-row');
        addBudgetTitleRow.createSpan({ text: 'Add Budget', cls: 'expensica-account-card-name' });
        addBudgetTextGroup.createSpan({
            text: 'Create a new budget target',
            cls: 'expensica-account-card-date'
        });

        const openBudgetModal = () => {
            const modal = new BudgetModal(this.app, this.plugin, this);
            modal.open();
        };

        addBudgetBtn.addEventListener('click', openBudgetModal);
        addBudgetBtn.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            openBudgetModal();
        });
    }

    renderCategoriesTab(container: HTMLElement) {
        const categoriesContainer = container.createDiv('expensica-categories-tab');
        const chartContainer = categoriesContainer.createDiv('expensica-chart-container expensica-chart-container-donut expensica-categories-chart-container expensica-animate');
        const listContainer = categoriesContainer.createDiv('expensica-categories-list expensica-animate expensica-animate-delay-1');
        const categoryData = this.getCategoriesTabData();
        const unusedCategoryData = this.getUnusedCategoriesTabData();

        this.renderCategoryChartTypeSelector(chartContainer, () => {
            this.renderDashboard();
        }, {
            showTitle: false,
            overlayClass: 'expensica-category-chart-type-selector-overlay',
            leadingAction: {
                ariaLabel: this.categoryChartType === CategoryType.INCOME
                    ? 'New Income Category'
                    : 'New Expenses Category',
                onClick: () => {
                    new CategoryModal(this.app, this.plugin, this, null, this.categoryChartType).open();
                }
            }
        });

        if (categoryData.length === 0) {
            const chartTypeLabel = this.categoryChartType === CategoryType.INCOME ? 'income' : 'expenses';
            chartContainer.createDiv('expensica-empty-charts').createEl('p', {
                text: `No ${chartTypeLabel} categories found for this period.`,
                cls: 'expensica-empty-state-message'
            });
        } else {
            const chartLayout = chartContainer.createDiv('expensica-category-chart-layout expensica-categories-chart-layout');
            const canvasContainer = chartLayout.createDiv('expensica-mini-donut-canvas-container expensica-categories-canvas-container');
            const canvas = canvasContainer.createEl('canvas', {
                cls: 'mini-donut__content',
                attr: { id: 'categories-chart' }
            });

            this.prepareChartCanvasSize(canvas);

            window.setTimeout(() => {
                if (canvas.isConnected === false) return;
                this.createCategoryExpensesChart(canvas, null, categoryData);
            }, 50);

            renderCategoryCards(
                listContainer,
                categoryData.map(category => ({
                    ...category,
                    formattedAmount: this.formatCategoryCardCurrency(category.amount)
                })),
                {
                    onHoverStart: (index, event) => this.activateCategorySlice(this.expensesChart, index, event),
                    onHoverEnd: () => this.clearCategorySlice(this.expensesChart),
                    onEditClick: (category) => this.openCategoryModal(category.id),
                    onClick: (category) => {
                        if (category.id) {
                            void this.plugin.openTransactionsViewForCategory(category.id);
                        }
                    }
                }
            );
        }

        if (unusedCategoryData.length > 0) {
            listContainer.createEl('h3', {
                text: 'Other Categories',
                cls: 'expensica-chart-title expensica-categories-unused-title'
            });

            const unusedList = listContainer.createDiv('expensica-categories-list');
            renderCategoryCards(
                unusedList,
                unusedCategoryData.map(category => ({
                    ...category,
                    formattedAmount: this.formatCategoryCardCurrency(0)
                })),
                {
                    onEditClick: (category) => this.openCategoryModal(category.id),
                    onClick: (category) => {
                        if (category.id) {
                            void this.plugin.openTransactionsViewForCategory(category.id);
                        }
                    }
                }
            );
        }
    }

    private getBudgetStatuses() {
        const transactions = this.plugin.getAllTransactions();
        // Each budget uses the complete period containing the selected range's final day.
        return this.plugin.getAllBudgets().map(budget => ({
            budget,
            status: calculateBudgetStatus(budget, transactions, this.dateRange.endDate)
        }));
    }

    // Render budget summary cards
    renderBudgetSummary(container: HTMLElement, budgetStatuses = this.getBudgetStatuses()) {
        
        // If no budgets, show a simplified summary
        if (budgetStatuses.length === 0) {
            const summaryEl = container.createDiv('expensica-summary expensica-overview-summary expensica-budget-summary');
            
            // Empty budgeted card
            const budgetedCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-animate');
            const budgetedCardTitle = budgetedCard.createEl('h3', { cls: 'expensica-card-title' });
            
            budgetedCardTitle.createSpan({ text: '💰', cls: 'emoji' });
            budgetedCardTitle.createSpan({ text: ' Total Budgeted' });
            budgetedCard.createEl('p', {
                text: this.formatBudgetCurrency(0),
                cls: 'expensica-card-value expensica-budget'
            });
            
            // Empty spent card
            const spentCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-animate expensica-animate-delay-1');
            const spentCardTitle = spentCard.createEl('h3', { cls: 'expensica-card-title' });
            
            spentCardTitle.createSpan({ text: '💸', cls: 'emoji' });
            spentCardTitle.createSpan({ text: ' Total Spent' });
            spentCard.createEl('p', {
                text: this.formatBudgetCurrency(0),
                cls: 'expensica-card-value expensica-expense'
            });
            
            // Empty remaining card
            const remainingCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-animate expensica-animate-delay-2');
            const remainingCardTitle = remainingCard.createEl('h3', { cls: 'expensica-card-title' });
            
            remainingCardTitle.createSpan({ text: '💵', cls: 'emoji' });
            remainingCardTitle.createSpan({ text: ' Remaining' });
            remainingCard.createEl('p', {
                text: this.formatBudgetCurrency(0),
                cls: 'expensica-card-value expensica-budget-remaining'
            });
            
            return;
        }
        
        // Create summary cards
        const totalBudgeted = budgetStatuses.reduce((sum, { status }) => sum + status.available, 0);
        const totalSpent = budgetStatuses.reduce((sum, { status }) => sum + status.spent, 0);
        
        const remainingAmount = budgetStatuses.reduce((sum, { status }) => sum + status.remaining, 0);
        const spentPercentage = totalBudgeted > 0 ? Math.min(100, (totalSpent / totalBudgeted) * 100) : 0;
        
        // Create summary container with dashboard style
        const summaryEl = container.createDiv('expensica-summary expensica-overview-summary expensica-budget-summary');
        
        // Total budgeted card
        const budgetedCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-animate');
        const budgetedCardTitle = budgetedCard.createEl('h3', { cls: 'expensica-card-title' });
        budgetedCardTitle.createSpan({ text: '💰', cls: 'emoji' });
        budgetedCardTitle.createSpan({ text: ' Total Budgeted' });
        budgetedCard.createEl('p', {
            text: this.formatBudgetCurrency(totalBudgeted),
            cls: 'expensica-card-value expensica-budget'
        });
        
        // Total spent card
        const spentCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-animate expensica-animate-delay-1');
        const spentCardTitle = spentCard.createEl('h3', { cls: 'expensica-card-title' });
        
        spentCardTitle.createSpan({ text: '💸', cls: 'emoji' });
        spentCardTitle.createSpan({ text: ' Total Spent' });
        spentCard.createEl('p', {
            text: this.formatBudgetCurrency(totalSpent),
            cls: 'expensica-card-value expensica-expense'
        });
        
        // Remaining amount card
        const remainingCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-animate expensica-animate-delay-2');
        const remainingCardTitle = remainingCard.createEl('h3', { cls: 'expensica-card-title' });
        
        remainingCardTitle.createSpan({ text: '💵', cls: 'emoji' });
        remainingCardTitle.createSpan({ text: ' Remaining' });
        remainingCard.createEl('p', {
            text: this.formatBudgetCurrency(remainingAmount),
            cls: 'expensica-card-value expensica-budget-remaining'
        });
        
        // Overall budget progress
        const progressContainer = container.createDiv('notion-budget-progress-container');
        
        // Add header
        const progressHeader = progressContainer.createEl('h3');
        progressHeader.textContent = 'Overall Budget Progress';
        
        // Create progress container
        const progressDiv = progressContainer.createDiv('notion-budget-progress');
        
        // Create bar container
        const barContainer = progressDiv.createDiv('notion-budget-bar');
        
        // Create progress fill
        const progressFill = barContainer.createDiv('notion-budget-fill expensica-budget-fill-width');
        progressFill.setAttribute('data-percentage', Math.round(spentPercentage).toString());
        
        // Create percentage element
        const percentageDiv = progressDiv.createDiv('notion-budget-percentage');
        percentageDiv.textContent = `${Math.round(spentPercentage)}%`;
        
        // Create labels container
        const labelsDiv = progressDiv.createDiv('notion-budget-labels');
        
        // Create spent label
        const spentLabel = labelsDiv.createSpan();
        spentLabel.textContent = this.formatBudgetCurrency(totalSpent);
        
        // Create budget label
        const budgetLabel = labelsDiv.createSpan();
        budgetLabel.textContent = this.formatBudgetCurrency(totalBudgeted);
    }

    // Render budget list
    renderBudgetList(container: HTMLElement, budgetStatuses = this.getBudgetStatuses()) {
        
        // If no budgets, return early
        if (budgetStatuses.length === 0) {
            return;
        }
        
        // Create the list container with chart container styling
        const listContainer = container.createDiv('notion-budget-items');
        
        // Create header with chart header styling
        const headerSection = listContainer.createDiv('notion-chart-title-container');
        
        // Create title
        const chartTitle = headerSection.createEl('h3', { cls: 'notion-chart-title' });
        chartTitle.textContent = 'Budget Details';
        
        // Create subtitle
        const chartSubtitle = headerSection.createSpan({ cls: 'notion-chart-subtitle' });
        chartSubtitle.textContent = `${budgetStatuses.length} active ${budgetStatuses.length === 1 ? 'budget' : 'budgets'}`;
        
        const budgetItemsWrapper = listContainer.createDiv('expensica-budget-cards');
        
        // Create a budget item for each budget
        budgetStatuses.forEach(({ budget, status }) => {
            const category = this.plugin.getCategoryById(budget.categoryId);
            if (!category) return; // Skip if category doesn't exist
            
            // Determine the status color
            let statusClass = 'expensica-status-good';
            let statusText = '';
            
            if (status.percentage >= 90) {
                statusClass = 'expensica-status-danger';
                statusText = 'At Risk';
            } else if (status.percentage >= 75) {
                statusClass = 'expensica-status-warning';
                statusText = 'Caution';
            } else {
                statusText = 'On Track';
            }
            if (budget.rollover && !budget.rolloverStartDate) {
                statusText = 'Set rollover start';
            }
            
            renderBudgetCard(budgetItemsWrapper, {
                budget,
                categoryName: category.name,
                categoryEmoji: this.plugin.getCategoryEmoji(category.id),
                categoryColor: this.plugin.getCategoryColor(category.id, category.name),
                currencyCode: this.plugin.settings.defaultCurrency,
                spent: status.spent,
                available: status.available,
                rolloverAmount: status.rolloverAmount,
                remaining: status.remaining,
                percentage: status.percentage,
                periodLabel: budget.period,
                statusText,
                statusClass,
                onEdit: (entry) => {
                    const modal = new BudgetModal(this.app, this.plugin, this, entry);
                    modal.open();
                }
            });
        });

        // We're not adding the 'Add Budget' button here since it already exists in renderBudgetTab
    }

    renderHeader(container: HTMLElement) {
        const headerEl = container.createDiv('shadcn-header');
        
        // Left section - Logo and title
        const titleSection = headerEl.createDiv('shadcn-title-section');
        const logoTitle = titleSection.createEl('h1', { cls: 'shadcn-title' });
        
        // Add title text directly without the logo
        logoTitle.textContent = "Expensica";

        const actionsEl = headerEl.createDiv('shadcn-actions');

        // Add date range selector
        this.renderDateRangeSelector(actionsEl);

        // Add transaction button with shadcn design
        const addTransactionBtn = actionsEl.createEl('button', {
            cls: 'expensica-standard-button shadcn-btn shadcn-btn-primary',
        });
        
        createDashboardSvgIcon(addTransactionBtn, '16', '2', [
            { tag: 'line', attributes: { x1: '12', y1: '5', x2: '12', y2: '19' } },
            { tag: 'line', attributes: { x1: '5', y1: '12', x2: '19', y2: '12' } }
        ]);
        addTransactionBtn.createSpan({ text: ' Transaction' });

        // Add export button with shadcn design
        const exportBtn = actionsEl.createEl('button', {
            cls: 'expensica-standard-button shadcn-btn shadcn-btn-primary',
        });
        
        createDashboardSvgIcon(exportBtn, '16', '2', [
            { tag: 'path', attributes: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } },
            { tag: 'polyline', attributes: { points: '7 10 12 15 17 10' } },
            { tag: 'line', attributes: { x1: '12', y1: '15', x2: '12', y2: '3' } }
        ]);
        exportBtn.createSpan({ text: ' Export' });

        const importBtn = actionsEl.createEl('button', {
            cls: 'expensica-standard-button shadcn-btn shadcn-btn-primary',
            attr: { type: 'button', 'aria-label': 'Import transactions' }
        });
        setIcon(importBtn, 'upload');
        importBtn.createSpan({ text: ' Import' });
        importBtn.addEventListener('click', () => this.plugin.openImportModal());

        // Event listeners
        addTransactionBtn.addEventListener('click', () => {
            const modal = new TransactionModal(this.app, this.plugin, this);
            modal.open();
        });

        exportBtn.addEventListener('click', () => {
            this.plugin.openExportModal();
        });
    }

    // Updated method to render the date range selector with shadcn/ui-inspired design
    private renderDateRangeSelector(container: HTMLElement) {
        if (this.dateRangeSelectorComponent) this.removeChild(this.dateRangeSelectorComponent);
        this.dateRangeSelectorComponent = this.addChild(new Component());
        const dateRangeContainer = container.createDiv('shadcn-date-range-container');

        // Create the date range selector dropdown
        const dateRangeSelector = dateRangeContainer.createDiv('shadcn-date-range-selector');
        
        // Current selection display with calendar icon
        const currentSelection = dateRangeSelector.createDiv('expensica-standard-button shadcn-date-range-current');
        
        createDashboardSvgIcon(currentSelection, '16', '2', [
            { tag: 'rect', attributes: { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' } },
            { tag: 'line', attributes: { x1: '16', y1: '2', x2: '16', y2: '6' } },
            { tag: 'line', attributes: { x1: '8', y1: '2', x2: '8', y2: '6' } },
            { tag: 'line', attributes: { x1: '3', y1: '10', x2: '21', y2: '10' } }
        ]);
        
        const dateRangeText = currentSelection.createSpan({ 
            text: this.dateRange.label,
            cls: 'shadcn-date-range-text'
        });
        
        // Chevron down icon
        const dropdownIcon = currentSelection.createSpan({ cls: 'shadcn-date-range-icon' });
        appendChevronIcon(dropdownIcon, '14');

        // Dropdown options container
        const optionsContainer = dateRangeSelector.createDiv('shadcn-date-range-options');
        optionsContainer.addClass('shadcn-date-range-hidden');

        // Add dropdown options
        const options = this.getDateRangeOptions();

        options.forEach(option => {
            const optionItem = optionsContainer.createDiv('shadcn-date-range-option');
            optionItem.textContent = option.label;
            
            // Highlight the active option
            if (this.dateRange.type === option.type) {
                optionItem.addClass('shadcn-date-range-option-active');
            }
            
            // Handle option selection
            optionItem.addEventListener('click', () => {
                handleDashboardAsync('Update date range', async () => {
                    await this.applyDateRangeSelection(option.type);
                    dateRangeText.textContent = this.dateRange.label;
                    
                    // Hide the dropdown and reset icon rotation
                    optionsContainer.addClass('shadcn-date-range-hidden');
                    dropdownIcon.classList.remove('dropdown-icon-open');
                });
            });
        });

        // Toggle dropdown on click
        currentSelection.addEventListener('click', () => {
            const isHidden = optionsContainer.hasClass('shadcn-date-range-hidden');
            optionsContainer.toggleClass('shadcn-date-range-hidden', !isHidden);
            
            // Rotate dropdown icon when open/closed
            if (isHidden) {
                dropdownIcon.classList.add('dropdown-icon-open');
            } else {
                dropdownIcon.classList.remove('dropdown-icon-open');
            }
        });

        // Close dropdown when clicking outside
        this.dateRangeSelectorComponent.registerDomEvent(container.ownerDocument, 'click', (event) => {
            const target = event.target as HTMLElement;
            if (!dateRangeSelector.contains(target)) {
                optionsContainer.addClass('shadcn-date-range-hidden');
                dropdownIcon.classList.remove('dropdown-icon-open');
            }
        });
    }

    private getDateRangeOptions(): { type: DateRangeType; label: string }[] {
        return [
            { type: DateRangeType.TODAY, label: DATE_RANGE_LABEL_TODAY },
            { type: DateRangeType.THIS_WEEK, label: DATE_RANGE_LABEL_THIS_WEEK },
            { type: DateRangeType.LAST_WEEK, label: DATE_RANGE_LABEL_LAST_WEEK },
            { type: DateRangeType.THIS_MONTH, label: DATE_RANGE_LABEL_THIS_MONTH },
            { type: DateRangeType.LAST_MONTH, label: DATE_RANGE_LABEL_LAST_MONTH },
            { type: DateRangeType.THIS_YEAR, label: DATE_RANGE_LABEL_THIS_YEAR },
            { type: DateRangeType.LAST_YEAR, label: DATE_RANGE_LABEL_LAST_YEAR },
            { type: DateRangeType.ALL_TIME, label: DATE_RANGE_LABEL_ALL_TIME },
            { type: DateRangeType.CUSTOM, label: DATE_RANGE_LABEL_CUSTOM_RANGE }
        ];
    }

    private async applyDateRangeSelection(type: DateRangeType, anchorContainer?: HTMLElement) {
        this.pendingChartScrollAnchorSelector = anchorContainer
            ? this.getChartScrollAnchorSelector(anchorContainer)
            : null;

        if (type === DateRangeType.CUSTOM) {
            const modal = new DateRangePickerModal(this.app, this.customStartDate || new Date(), this.customEndDate || new Date(), async (startDate, endDate) => {
                if (!startDate || !endDate) {
                    this.pendingChartScrollAnchorSelector = null;
                    return;
                }

                this.customStartDate = startDate;
                this.customEndDate = endDate;
                this.dateRange = this.getDateRange(DateRangeType.CUSTOM, startDate, endDate);
                const selectionDate = this.getDateRangeSelectionDate(this.dateRange);
                this.currentDate = selectionDate;
                this.selectedCalendarDate = selectionDate;
                await this.updateSharedDateRange();
                await this.loadTransactionsData();
                this.persistDashboardState();
                this.requestAllChartAnimations();
                this.renderDashboard();
            });
            modal.open();
            return;
        }

        this.dateRange = this.getDateRange(type);
        const selectionDate = this.getDateRangeSelectionDate(this.dateRange);
        this.currentDate = selectionDate;
        this.selectedCalendarDate = selectionDate;
        await this.updateSharedDateRange();
        await this.loadTransactionsData();
        this.persistDashboardState();
        this.requestAllChartAnimations();
        this.renderDashboard();
    }

    private renderChartDateRangeButtons(container: HTMLElement) {
        const buttonRow = container.createDiv('expensica-chart-range-buttons');

        this.getDateRangeOptions().forEach((option) => {
            const button = buttonRow.createEl('button', {
                text: option.label,
                cls: `expensica-chart-range-button${this.dateRange.type === option.type ? ' is-active' : ''}`
            });
            button.type = 'button';
            button.addEventListener('click', () => {
                handleDashboardAsync('Update date range', async () => {
                    await this.applyDateRangeSelection(option.type, container);
                });
            });
        });
    }

    renderSummary(container: HTMLElement) {
        const summaryEl = container.createDiv('expensica-summary expensica-overview-summary');

        // Get data for current and previous month
        const totalIncome = TransactionAggregator.getTotalIncome(this.transactions);
        const totalExpenses = TransactionAggregator.getTotalExpenses(this.transactions);
        const netBalance = this.getNetBalanceThrough(this.dateRange.endDate);
        const balance = this.getDefaultAccountBalanceThrough(this.dateRange.endDate);

        const comparison = this.getPreviousPeriodComparisonRange();
        const comparisonLabel = comparison
            ? this.getResolvedDateRangeLegendLabel(comparison.range, comparison.label, 'short')
            : '';
        const comparisonTransactions = comparison ? this.getTransactionsForDateRange(comparison.range) : [];
        const prevTotalIncome = TransactionAggregator.getTotalIncome(comparisonTransactions);
        const prevTotalExpenses = TransactionAggregator.getTotalExpenses(comparisonTransactions);
        const prevNetBalance = comparison ? this.getNetBalanceThrough(comparison.range.endDate) : 0;

        const incomeTrend = getTrendPercentage(totalIncome, prevTotalIncome);
        const expenseTrend = getTrendPercentage(totalExpenses, prevTotalExpenses);
        const netBalanceTrend = getTrendPercentage(netBalance, prevNetBalance);

        // Income card
        const incomeCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-overview-card-primary expensica-animate');
        this.linkSummaryCardToTransactions(incomeCard, 'View income transactions', { type: TransactionType.INCOME });
        const incomeCardTitle = incomeCard.createEl('h3', { cls: 'expensica-card-title' });
        incomeCardTitle.createSpan({ text: '💰', cls: 'emoji' });
        incomeCardTitle.createSpan({ text: ' Income' });
        renderOverviewCurrencyValue(incomeCard, this.plugin.settings.defaultCurrency, totalIncome, 'expensica-income');

        if (comparison) {
            const trendEl = incomeCard.createDiv({ cls: 'expensica-card-trend' });
            renderTrend(trendEl, incomeTrend, comparisonLabel, totalIncome >= prevTotalIncome);
        }


        // Expenses card
        const expensesCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-overview-card-primary expensica-animate expensica-animate-delay-1');
        this.linkSummaryCardToTransactions(expensesCard, 'View expense transactions', { type: TransactionType.EXPENSE });
        const expensesCardTitle = expensesCard.createEl('h3', { cls: 'expensica-card-title' });
        expensesCardTitle.createSpan({ text: '💸', cls: 'emoji' });
        expensesCardTitle.createSpan({ text: ' Expenses' });
        renderOverviewCurrencyValue(expensesCard, this.plugin.settings.defaultCurrency, totalExpenses, 'expensica-expense');

        if (comparison) {
            const trendEl = expensesCard.createDiv({ cls: 'expensica-card-trend' });
            renderTrend(trendEl, expenseTrend, comparisonLabel, totalExpenses <= prevTotalExpenses);
        }


        // Net Balance card
        const netBalanceCard = summaryEl.createDiv('expensica-card expensica-overview-card expensica-overview-card-primary expensica-animate expensica-animate-delay-2');
        this.linkSummaryCardToTransactions(netBalanceCard, 'View all transactions', {});
        const netBalanceCardTitle = netBalanceCard.createEl('h3', { cls: 'expensica-card-title' });
        netBalanceCardTitle.createSpan({ text: '⚖️', cls: 'emoji' });
        netBalanceCardTitle.createSpan({ text: ' Net Balance' });
        renderOverviewCurrencyValue(netBalanceCard, this.plugin.settings.defaultCurrency, netBalance, 'expensica-balance');

        if (comparison) {
            const trendEl = netBalanceCard.createDiv({ cls: 'expensica-card-trend' });
            renderTrend(trendEl, netBalanceTrend, comparisonLabel, netBalance >= prevNetBalance);
        }

        const balanceAccounts = this.plugin.settings.enableAccounts
            ? this.plugin.getAccounts()
            : [{
                ...this.plugin.getTransactionAccountDisplay(undefined),
                name: 'Running Balance'
            }];

        balanceAccounts.forEach((account, index) => {
            const accountReference = this.plugin.settings.enableAccounts
                ? this.plugin.normalizeTransactionAccountReference(
                    formatAccountReference(account.type, account.name)
                )
                : this.plugin.normalizeTransactionAccountReference(undefined);
            const accountBalance = this.plugin.settings.enableAccounts
                ? this.getAccountBalanceThroughDateTime(accountReference, new Date(this.dateRange.endDate.getFullYear(), this.dateRange.endDate.getMonth(), this.dateRange.endDate.getDate(), 23, 59, 59, 999))
                : balance;
            const prevAccountBalance = comparison
                ? (this.plugin.settings.enableAccounts
                    ? this.getAccountBalanceThroughDateTime(accountReference, new Date(comparison.range.endDate.getFullYear(), comparison.range.endDate.getMonth(), comparison.range.endDate.getDate(), 23, 59, 59, 999))
                    : this.getDefaultAccountBalanceThrough(comparison.range.endDate))
                : 0;
            const accountBalanceTrend = getTrendPercentage(accountBalance, prevAccountBalance);
            const accountColor = getAccountColor(account, balanceAccounts);

            const balanceCard = summaryEl.createDiv(`expensica-card expensica-overview-card expensica-overview-card-balance expensica-animate expensica-animate-delay-${Math.min(3, index + 3)}`);
            this.linkSummaryCardToTransactions(balanceCard, `View ${account.name} transactions`, { accountReference });
            const balanceCardTitle = balanceCard.createEl('h3', { cls: 'expensica-card-title' });
            balanceCardTitle.createSpan({
                text: this.plugin.settings.enableAccounts ? getAccountEmoji(account.type) : '💵',
                cls: 'emoji'
            });
            balanceCardTitle.createSpan({
                text: this.plugin.settings.enableAccounts ? ` ${account.name} Balance` : ' Running Balance'
            });
            const balanceValue = renderOverviewCurrencyValue(
                balanceCard,
                this.plugin.settings.defaultCurrency,
                accountBalance,
                'expensica-balance'
            );
            balanceValue.setCssStyles({ color: accountColor });

            if (comparison) {
                const trendEl = balanceCard.createDiv({ cls: 'expensica-card-trend' });
                const isPositiveNews = account.type === AccountType.CREDIT
                    ? accountBalance <= prevAccountBalance
                    : accountBalance >= prevAccountBalance;
                renderTrend(trendEl, accountBalanceTrend, comparisonLabel, isPositiveNews);
            }
        });

    }

    private linkSummaryCardToTransactions(
        card: HTMLElement,
        label: string,
        filter: { type?: TransactionType; accountReference?: string }
    ) {
        card.addClass('expensica-overview-card-interactive');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', label);
        const open = () => void this.plugin.openTransactionsView(filter);
        card.addEventListener('click', open);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });
    }

    renderExpensesChart(container: HTMLElement) {
        // Header with title and view options
        this.renderCategoryChartTypeSelector(container, () => {
            this.requestExpensesChartAnimation();
            this.refreshCategoryChartOnly();
        });
        this.renderChartDateRangeButtons(container);

        container.addClass('expensica-chart-container-donut');

        // Canvas container
        const chartLayout = container.createDiv('expensica-category-chart-layout');
        const canvasContainer = chartLayout.createDiv('expensica-canvas-container');
        const legendContainer = chartLayout.createDiv('expensica-chart-html-legend');
        const transactionType = this.getCategoryChartTransactionType();

        if (this.transactions.filter(t => t.type === transactionType).length === 0) {
            canvasContainer.addClass('is-empty');
            legendContainer.remove();
            canvasContainer.empty();
            const emptyState = canvasContainer.createDiv('expensica-empty-charts');
            emptyState.createDiv({ text: '📊', cls: 'expensica-empty-icon' });
            emptyState.createEl('p', {
                text: `No transactions found for this period. Add income or expenses to see your category patterns.`,
                cls: 'expensica-empty-state-message'
            });
            this.syncChartsAfterCategoryLayoutChange();
            return;
        }

        const canvas = canvasContainer.createEl('canvas', { attr: { id: 'expenses-chart' }});

        // Create chart based on selected period
        window.setTimeout(() => {
            if (canvas.isConnected === false) return;
            this.updateCategoryChartLayout(container, chartLayout);
            this.createCategoryExpensesChart(canvas, legendContainer);
        }, 50);

    }

    updateCategoryChartLayout(container: HTMLElement, chartLayout: HTMLElement) {
        const dashboardGrid = container.closest<HTMLElement>('.expensica-dashboard-grid');
        if (dashboardGrid) {
            this.updateDashboardChartGridLayout(dashboardGrid);
            return;
        }

        chartLayout.removeClass('is-narrow');
    }

    getDateRangeDayBounds(): { start: Date; end: Date } {
        const start = new Date(this.dateRange.startDate);
        start.setHours(0, 0, 0, 0);

        const end = new Date(this.dateRange.endDate);
        end.setHours(23, 59, 59, 999);

        return { start, end };
    }

    getIncomeExpenseChartDayBounds(): { start: Date; end: Date } | null {
        const { start, end } = this.getDateRangeDayBounds();
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const cappedEnd = end > todayEnd ? todayEnd : end;
        if (start > cappedEnd) {
            return null;
        }

        return { start, end: cappedEnd };
    }

    getDateRangeDays(): Date[] {
        const { start, end } = this.getDateRangeDayBounds();
        const days: Date[] = [];
        const currentDay = new Date(start);

        while (currentDay <= end) {
            days.push(new Date(currentDay));
            currentDay.setDate(currentDay.getDate() + 1);
        }

        return days;
    }

    formatChartDateLabel(date: Date, includeYear = false): string {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        return includeYear ? `${day}/${month}/${year}` : `${day}/${month}`;
    }

    formatChartShortDateLabel(date: Date, includeYear = false): string {
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            ...(includeYear ? { year: 'numeric' } : {})
        });
    }

    formatChartDayNumberLabel(date: Date): string {
        return String(date.getDate());
    }

    formatChartMonthLabel(date: Date, includeYear = false): string {
        return date.toLocaleDateString(undefined, {
            month: 'short',
            ...(includeYear ? { year: 'numeric' } : {})
        });
    }

    formatChartTooltipDayTitle(date: Date): string {
        return date.toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }

    formatChartTooltipMonthTitle(date: Date): string {
        return `${date.toLocaleDateString(undefined, { month: 'long' })}, ${date.getFullYear()}`;
    }

    formatChartTooltipRangeTitle(start: Date, end: Date): string {
        if (
            start.getFullYear() === end.getFullYear()
            && start.getMonth() === end.getMonth()
            && start.getDate() === end.getDate()
        ) {
            return this.formatChartTooltipDayTitle(start);
        }

        if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
            return this.formatChartTooltipMonthTitle(start);
        }

        return `${this.formatChartTooltipDayTitle(start)} - ${this.formatChartTooltipDayTitle(end)}`;
    }

    formatChartHourLabel(date: Date, includeDate = false): string {
        const hours = date.getHours();
        const timeLabel = this.plugin.settings.timeFormat === '24'
            ? String(hours)
            : `${hours % 12 || 12}${hours >= 12 ? 'PM' : 'AM'}`;

        if (!includeDate) {
            return timeLabel;
        }

        return `${this.formatChartShortDateLabel(date)} ${timeLabel}`;
    }

    formatChartYearLabel(date: Date): string {
        return String(date.getFullYear());
    }

    getIsoWeek(date: Date): { year: number; week: number } {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));

        const yearStart = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return { year: d.getFullYear(), week };
    }

    getTransactionDateTime(transaction: Transaction): Date {
        const date = parseLocalDate(transaction.date);
        const transactionTime = getTransactionTime(transaction);

        if (!transactionTime) {
            return date;
        }

        const [hours, minutes, seconds] = transactionTime.split(':').map(Number);
        date.setHours(hours, minutes, seconds, 0);
        return date;
    }

    getCumulativeBalanceThroughDateTime(endDate: Date): number {
        return this.plugin.getAllTransactions().reduce((balance, transaction) => {
            if (this.getTransactionDateTime(transaction) > endDate) {
                return balance;
            }

            if (transaction.type === TransactionType.INCOME) {
                return balance + transaction.amount;
            }

            return transaction.type === TransactionType.EXPENSE
                ? balance - transaction.amount
                : balance;
        }, 0);
    }

    getIncomeExpenseChartResolution(start: Date, end: Date): 'hour' | 'day' | 'week' | 'month' | 'year' {
        const monthSpan = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());

        if (formatDate(start) === formatDate(end)) {
            return 'hour';
        }

        if (monthSpan < 1 || (monthSpan === 1 && end.getDate() <= start.getDate())) {
            return 'day';
        }

        if (monthSpan < 3 || (monthSpan === 3 && end.getDate() <= start.getDate())) {
            return 'week';
        }

        if (monthSpan < 36 || (monthSpan === 36 && end.getDate() <= start.getDate())) {
            return 'month';
        }

        return 'year';
    }

    createIncomeExpenseBucket(
        label: string,
        start: Date,
        end: Date,
        accountReferences: string[] = []
    ): { label: string; start: Date; end: Date; income: number; expenses: number; net: number; accountBalances: Record<string, number> } {
        return {
            label,
            start,
            end,
            income: 0,
            expenses: 0,
            net: 0,
            accountBalances: accountReferences.reduce((balances, reference) => {
                balances[reference] = 0;
                return balances;
            }, {} as Record<string, number>)
        };
    }

    getChartBucketsForRange(
        dateRange: DateRange,
        transactions: Transaction[],
        resolutionOverride?: 'hour' | 'day' | 'week' | 'month' | 'year'
    ): { label: string; start: Date; end: Date; income: number; expenses: number; net: number; accountBalances: Record<string, number> }[] {
        const start = new Date(dateRange.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dateRange.endDate);
        end.setHours(23, 59, 59, 999);

        if (start > end) {
            return [];
        }

        const includeYear = start.getFullYear() !== end.getFullYear();
        const resolution = resolutionOverride ?? this.getIncomeExpenseChartResolution(start, end);
        const buckets: { label: string; start: Date; end: Date; income: number; expenses: number; net: number; accountBalances: Record<string, number> }[] = [];

        if (resolution === 'hour') {
            const currentHour = new Date(start);
            currentHour.setMinutes(0, 0, 0);

            while (currentHour <= end) {
                const bucketStart = new Date(currentHour);
                const bucketEnd = new Date(currentHour);
                bucketEnd.setMinutes(59, 59, 999);
                buckets.push(this.createIncomeExpenseBucket(
                    this.formatChartHourLabel(currentHour, includeYear || formatDate(start) !== formatDate(end)),
                    bucketStart < start ? new Date(start) : bucketStart,
                    bucketEnd > end ? new Date(end) : bucketEnd
                ));
                currentHour.setHours(currentHour.getHours() + 1);
            }
        }

        if (resolution === 'day') {
            const currentDay = new Date(start);

            while (currentDay <= end) {
                const bucketStart = new Date(currentDay);
                const bucketEnd = new Date(currentDay);
                bucketEnd.setHours(23, 59, 59, 999);
                buckets.push(this.createIncomeExpenseBucket(
                    dateRange.type === DateRangeType.THIS_MONTH || dateRange.type === DateRangeType.LAST_MONTH
                        ? this.formatChartDayNumberLabel(currentDay)
                        : this.formatChartShortDateLabel(currentDay, includeYear),
                    bucketStart,
                    bucketEnd > end ? new Date(end) : bucketEnd
                ));
                currentDay.setDate(currentDay.getDate() + 1);
            }
        }

        if (resolution === 'week') {
            const weekBuckets: { label: string; isoYear: number; isoWeek: number; start: Date; end: Date; income: number; expenses: number; net: number; accountBalances: Record<string, number> }[] = [];
            const currentDay = new Date(start);

            while (currentDay <= end) {
                const { year, week } = this.getIsoWeek(currentDay);
                const existingBucket = weekBuckets.find(bucket => bucket.isoYear === year && bucket.isoWeek === week);

                if (existingBucket) {
                    existingBucket.end = new Date(currentDay);
                    existingBucket.end.setHours(23, 59, 59, 999);
                } else {
                    weekBuckets.push({
                        label: this.plugin.settings.showWeekNumbers
                            ? (includeYear ? `${year} Wk ${week}` : `Wk ${week}`)
                            : '',
                        isoYear: year,
                        isoWeek: week,
                        start: new Date(currentDay),
                        end: new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 23, 59, 59, 999),
                        income: 0,
                        expenses: 0,
                        net: 0,
                        accountBalances: {}
                    });
                }

                currentDay.setDate(currentDay.getDate() + 1);
            }

            if (!this.plugin.settings.showWeekNumbers) {
                weekBuckets.forEach(bucket => {
                    bucket.label = `${this.formatChartDateLabel(bucket.start, includeYear)} - ${this.formatChartDateLabel(bucket.end, includeYear)}`;
                });
            }

            buckets.push(...weekBuckets.map(({ isoYear, isoWeek, ...bucket }) => bucket));
        }

        if (resolution === 'month') {
            const currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);

            while (currentMonth <= end) {
                const bucketStart = new Date(currentMonth);
                const bucketEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59, 999);
                buckets.push(this.createIncomeExpenseBucket(
                    this.formatChartMonthLabel(currentMonth, includeYear),
                    bucketStart < start ? new Date(start) : bucketStart,
                    bucketEnd > end ? new Date(end) : bucketEnd
                ));
                currentMonth.setMonth(currentMonth.getMonth() + 1);
            }
        }

        if (resolution === 'year') {
            const currentYear = new Date(start.getFullYear(), 0, 1);

            while (currentYear <= end) {
                const bucketStart = new Date(currentYear);
                const bucketEnd = new Date(currentYear.getFullYear(), 11, 31, 23, 59, 59, 999);
                buckets.push(this.createIncomeExpenseBucket(
                    this.formatChartYearLabel(currentYear),
                    bucketStart < start ? new Date(start) : bucketStart,
                    bucketEnd > end ? new Date(end) : bucketEnd
                ));
                currentYear.setFullYear(currentYear.getFullYear() + 1);
            }
        }

        this.assignTransactionsToIncomeExpenseBuckets(buckets, transactions);
        return buckets;
    }

    getIncomeExpenseChartBuckets(accounts = this.getIncomeExpenseChartAccounts(), sortedTransactions?: Transaction[]): { label: string; start: Date; end: Date; income: number; expenses: number; net: number; accountBalances: Record<string, number> }[] {
        const chartBounds = this.getIncomeExpenseChartDayBounds();
        if (!chartBounds) {
            return [];
        }

        const { start, end } = this.getDateRangeDayBounds();
        const resolution = this.getIncomeExpenseChartResolution(start, end);
        const accountReferences = accounts.map(account => account.reference);
        const buckets = this.getChartBucketsForRange(this.dateRange, this.transactions, resolution).map(bucket => ({
            ...bucket,
            accountBalances: accountReferences.reduce((balances, reference) => {
                balances[reference] = 0;
                return balances;
            }, {} as Record<string, number>)
        }));

        if (buckets.length === 0) {
            return buckets;
        }

        const allTransactions = sortedTransactions ?? this.plugin.getAllTransactions()
            .slice()
            .sort((a, b) => this.getTransactionDateTime(a).getTime() - this.getTransactionDateTime(b).getTime());
        const defaultReference = allTransactions.length
            ? this.plugin.normalizeTransactionAccountReference(undefined) : undefined;
        const defaultIsCredit = !this.plugin.settings.enableAccounts && accountReferences.length > 0
            && this.plugin.findAccountByReference(accountReferences[0])?.type === AccountType.CREDIT;
        const runningAccountBalances = accountReferences.reduce((balances, reference) => {
            balances[reference] = 0;
            return balances;
        }, {} as Record<string, number>);
        let transactionIndex = 0;
        let runningNetBalance = 0;

        buckets.forEach(bucket => {
            while (
                transactionIndex < allTransactions.length
                && this.getTransactionDateTime(allTransactions[transactionIndex]) <= bucket.end
            ) {
                const transaction = allTransactions[transactionIndex];

                if (this.plugin.settings.enableAccounts) {
                    accounts.forEach(account => {
                        runningAccountBalances[account.reference] += getAccountTransactionAmount(this.plugin, transaction, account.reference, account.isCredit, defaultReference);
                    });
                } else {
                    const reference = accountReferences[0];
                    if (reference) {
                        runningAccountBalances[reference] += getAccountTransactionAmount(this.plugin, transaction, reference, defaultIsCredit, defaultReference);
                    }
                }

                if (!this.plugin.settings.enableAccounts) {
                    if (transaction.type === TransactionType.INCOME) {
                        runningNetBalance += transaction.amount;
                    } else if (transaction.type === TransactionType.EXPENSE) {
                        runningNetBalance -= transaction.amount;
                    }
                }

                transactionIndex += 1;
            }

            accounts.forEach(account => {
                bucket.accountBalances[account.reference] = runningAccountBalances[account.reference] ?? 0;
            });

            bucket.net = this.plugin.settings.enableAccounts
                ? accounts.reduce((netBalance, account) => (
                    netBalance + (account.isCredit
                        ? -(runningAccountBalances[account.reference] ?? 0)
                        : (runningAccountBalances[account.reference] ?? 0))
                ), 0)
                : runningNetBalance;
        });

        return buckets;
    }

    assignTransactionsToIncomeExpenseBuckets(
        buckets: { start: Date; end: Date; income: number; expenses: number }[],
        transactions: Transaction[] = this.transactions
    ) {
        if (buckets.length === 0 || transactions.length === 0) {
            return;
        }

        const sortedTransactions = transactions
            .slice()
            .sort((a, b) => this.getTransactionDateTime(a).getTime() - this.getTransactionDateTime(b).getTime());
        let bucketIndex = 0;

        sortedTransactions.forEach(transaction => {
            const transactionDate = this.getTransactionDateTime(transaction);

            while (bucketIndex < buckets.length && transactionDate > buckets[bucketIndex].end) {
                bucketIndex += 1;
            }

            const bucket = buckets[bucketIndex];
            if (!bucket || transactionDate < bucket.start || transactionDate > bucket.end) {
                return;
            }

            if (transaction.type === TransactionType.INCOME) {
                bucket.income += transaction.amount;
            } else if (transaction.type === TransactionType.EXPENSE) {
                bucket.expenses += transaction.amount;
            }
        });
    }

    renderCumulativeExpensesChart(container: HTMLElement) {
        const chartHeader = container.createDiv('expensica-chart-header');
        const chartTitle = chartHeader.createEl('h3', { cls: 'expensica-chart-title' });
        chartTitle.setText('Cumulative Expenses');
        this.renderChartDateRangeButtons(container);

        const canvasContainer = container.createDiv('expensica-canvas-container');
        const legendContainer = container.createDiv('expensica-chart-html-legend expensica-cumulative-expenses-legend');
        const expenseTransactions = this.transactions.filter(transaction => transaction.type === TransactionType.EXPENSE);

        if (expenseTransactions.length === 0) {
            canvasContainer.addClass('is-empty');
            legendContainer.remove();
            const emptyState = canvasContainer.createDiv('expensica-empty-charts');
            emptyState.createDiv({ text: '📉', cls: 'expensica-empty-icon' });
            emptyState.createEl('p', {
                text: 'No expenses found for this period.',
                cls: 'expensica-empty-state-message'
            });
            return;
        }

        const canvas = canvasContainer.createEl('canvas', { attr: { id: 'cumulative-expenses-chart' } });
        window.setTimeout(() => {
            if (canvas.isConnected === false) return;
            this.createCumulativeExpensesChart(canvas, legendContainer);
        }, 50);
    }

    createCumulativeExpensesChart(canvas: HTMLCanvasElement, legendContainer: HTMLElement | null = null) {
        if (this.cumulativeExpensesChart) {
            this.cumulativeExpensesChart.destroy();
            this.cumulativeExpensesChart = null;
        }

        const currentRange = {
            ...this.dateRange,
            endDate: new Date(this.dateRange.endDate)
        };
        currentRange.endDate.setHours(23, 59, 59, 999);
        const currentBuckets = this.getChartBucketsForRange(
            currentRange,
            this.transactions
        );
        if (currentBuckets.length === 0) {
            return;
        }

        const currentData = currentBuckets.reduce((series, bucket) => {
            const nextValue = (series[series.length - 1] || 0) + bucket.expenses;
            series.push(nextValue);
            return series;
        }, [] as number[]);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const visibleCurrentData = currentBuckets.map((bucket, index) => (
            bucket.start > todayEnd ? null : currentData[index]
        ));

        const comparison = this.getPreviousPeriodComparisonRange();
        const previousTransactions = comparison ? this.getTransactionsForDateRange(comparison.range) : [];
        const previousExpenseTransactions = previousTransactions.filter(transaction => transaction.type === TransactionType.EXPENSE);
        const previousBuckets = comparison && previousExpenseTransactions.length > 0
            ? this.getChartBucketsForRange(
                {
                    ...comparison.range,
                    endDate: new Date(comparison.range.endDate.getFullYear(), comparison.range.endDate.getMonth(), comparison.range.endDate.getDate(), 23, 59, 59, 999)
                },
                previousTransactions,
                this.getIncomeExpenseChartResolution(this.dateRange.startDate, this.dateRange.endDate)
            )
            : [];
        const previousData = previousBuckets.reduce((series, bucket) => {
            const nextValue = (series[series.length - 1] || 0) + bucket.expenses;
            series.push(nextValue);
            return series;
        }, [] as number[]);

        const currentLegendLabel = this.getResolvedDateRangeLegendLabel(currentRange);
        const comparisonLabel = comparison?.label ?? 'Previous';
        const comparisonLegendLabel = this.getResolvedDateRangeLegendLabel(comparison?.range, comparisonLabel);
        const formattedDates = currentBuckets.map(bucket => bucket.label);
        const expenseColor = this.getThemeColor('--text-error', 'rgb(212, 76, 71)');
        const expenseFillColor = this.getThemeColorWithAlpha('--text-error', 'rgb(212, 76, 71)', 0.14);
        const comparisonColor = this.getThemeColorWithAlpha('--text-muted', 'rgb(148, 163, 184)', 0.7);
        const helperTextColor = this.getChartHelperTextColor();

        this.prepareChartCanvasSize(canvas);
        this.cumulativeExpensesChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: formattedDates,
                datasets: [
                    {
                        label: comparisonLegendLabel,
                        data: formattedDates.map((_, index) => previousData[index] ?? null),
                        borderColor: comparisonColor,
                        backgroundColor: comparisonColor,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        tension: 0.35,
                        fill: false,
                        spanGaps: false,
                        order: 1
                    },
                    {
                        label: currentLegendLabel,
                        data: visibleCurrentData,
                        borderColor: expenseColor,
                        backgroundColor: expenseFillColor,
                        borderWidth: 3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: expenseColor,
                        pointHoverBorderColor: expenseColor,
                        pointHitRadius: 16,
                        tension: 0.35,
                        fill: true,
                        spanGaps: false,
                        order: 0
                    }
                ]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: this.getChartAnimationOptions(this.animateCumulativeExpensesChartThisRender),
                resizeDelay: this.getChartResizeDelay(),
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                transitions: {
                    resize: {
                        animation: {
                            duration: 0
                        }
                    }
                },
                layout: {
                    padding: {
                        bottom: 12
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: helperTextColor,
                            callback: (value) => this.formatCompactChartCurrency(value as number)
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: helperTextColor,
                            padding: 6
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: this.getTooltipBackgroundColor(),
                        titleColor: this.getTooltipTitleColor(),
                        bodyColor: this.getTooltipBodyColor(),
                        borderColor: this.getTooltipBorderColor(),
                        borderWidth: 1,
                        multiKeyBackground: 'transparent',
                        callbacks: {
                            title: (contexts) => {
                                const bucket = currentBuckets[contexts[0]?.dataIndex ?? -1];
                                return bucket
                                    ? this.formatChartTooltipRangeTitle(bucket.start, bucket.end)
                                    : '';
                            },
                            label: (context) => `${context.dataset.label}: ${this.formatCompactChartCurrency(context.raw as number)}`,
                            labelColor: (context) => {
                                const dataset = context.dataset;
                                return {
                                    borderColor: dataset.borderColor as string,
                                    backgroundColor: dataset.backgroundColor as string
                                };
                            }
                        },
                        filter: (context) => context.raw !== null
                    }
                }
            }
        });

        this.bindChartAreaTooltipClear(canvas, this.cumulativeExpensesChart);

        if (legendContainer) {
            this.renderCumulativeExpensesLegend(legendContainer, [
                {
                    label: currentLegendLabel,
                    color: expenseColor
                },
                ...(previousBuckets.some(bucket => bucket.expenses > 0)
                    ? [{
                        label: comparisonLegendLabel,
                        color: comparisonColor
                    }]
                    : [])
            ]);
        }

        if (this.animateCumulativeExpensesChartThisRender) {
            this.scheduleChartAnimationReset();
        }
    }

    private getResolvedDateRangeLegendLabel(dateRange?: DateRange, fallbackLabel?: string, monthFormat: 'long' | 'short' = 'long'): string {
        if (!dateRange) {
            return fallbackLabel ?? '';
        }

        const start = new Date(dateRange.startDate);
        const end = new Date(dateRange.endDate);
        const includeYear = start.getFullYear() !== end.getFullYear();
        const durationDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
        const isSingleDay = durationDays === 1;
        const isFullMonth = start.getDate() === 1
            && end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()
            && start.getMonth() === end.getMonth()
            && start.getFullYear() === end.getFullYear();
        const isFullYear = start.getMonth() === 0
            && start.getDate() === 1
            && end.getMonth() === 11
            && end.getDate() === 31
            && start.getFullYear() === end.getFullYear();
        const referenceWeekDate = new Date(start);
        referenceWeekDate.setDate(referenceWeekDate.getDate() + Math.floor((durationDays - 1) / 2));
        const referenceIsoWeek = this.getIsoWeek(referenceWeekDate);
        const isSingleWeek = durationDays === 7
            && start.getDay() === 0
            && end.getDay() === 6
            && end.getTime() - start.getTime() < 7 * 86400000;

        if (isSingleDay) {
            return start.toLocaleDateString(undefined, {
                weekday: 'long',
                month: monthFormat,
                day: 'numeric',
                ...(includeYear ? { year: 'numeric' } : {})
            });
        }

        if (isSingleWeek) {
            return `Week ${referenceIsoWeek.week}, ${referenceIsoWeek.year}`;
        }

        if (isFullMonth) {
            return `${start.toLocaleDateString(undefined, { month: monthFormat })}, ${start.getFullYear()}`;
        }

        if (isFullYear) {
            return String(start.getFullYear());
        }

        switch (dateRange.type) {
            case DateRangeType.THIS_WEEK:
            case DateRangeType.LAST_WEEK: {
                const { year, week } = this.getIsoWeek(start);
                return `Week ${week}, ${year}`;
            }
            case DateRangeType.THIS_MONTH:
            case DateRangeType.LAST_MONTH:
                return `${start.toLocaleDateString(undefined, { month: monthFormat })}, ${start.getFullYear()}`;
            case DateRangeType.THIS_YEAR:
            case DateRangeType.LAST_YEAR:
                return String(start.getFullYear());
            case DateRangeType.ALL_TIME:
            case DateRangeType.CUSTOM:
                return fallbackLabel ?? dateRange.label;
            default:
                return fallbackLabel ?? dateRange.label;
        }
    }

    private renderCumulativeExpensesLegend(
        container: HTMLElement,
        legendItems: { label: string; color: string }[]
    ) {
        container.empty();
        container.setCssProps({
            '--expensica-cumulative-legend-columns': String(Math.min(Math.max(legendItems.length, 1), 2))
        });

        legendItems.forEach((item) => {
            const legendItem = container.createDiv('expensica-cumulative-expenses-legend-item');
            const swatch = legendItem.createSpan('expensica-cumulative-expenses-legend-line');
            swatch.setCssStyles({ backgroundColor: item.color });

            legendItem.createSpan({
                text: item.label,
                cls: 'expensica-cumulative-expenses-legend-label'
            });
        });
    }

    createCategoryExpensesChart(
        canvas: HTMLCanvasElement,
        legendContainer: HTMLElement | null = null,
        categoryEntries?: { name: string; amount: number; color: string; emoji?: string }[]
    ) {
        // Cleanup previous chart
        if (this.expensesChart) {
            this.cancelDoughnutLabelAnimation();
            this.expensesChart.destroy();
            this.expensesChart = null;
        }

        const categoryData = categoryEntries ?? this.getCurrentCategoryChartData();
        const categories = categoryData.map(category => category.name);
        const amounts = categoryData.map(category => category.amount);
        this.mobileActiveCategorySliceIndex = null;

        // If there are no expenses, return
        if (categories.length === 0) {
            return;
        }

        const colors = categoryData.map(category => category.color);
        const isMiniDonut = canvas.parentElement?.classList.contains('expensica-mini-donut-canvas-container') ?? false;
        const miniDonutGap = isMiniDonut && canvas.parentElement
            ? this.getCssPixelValue(canvas.parentElement, '--expensica-gap-md', 8)
            : 8;
        const hoverOffset = isMiniDonut ? miniDonutGap : 15;
        const chartPadding = legendContainer
            ? 12
            : isMiniDonut
                ? miniDonutGap
                : 0;
        const showTooltip = legendContainer !== null;
        const doughnutDataset: Record<string, unknown> = {
            data: amounts,
            backgroundColor: colors,
            borderColor: colors.map(color => this.adjustColor(color, -20)),
            borderWidth: 1,
            hoverOffset
        };

        // Create the chart
        this.prepareChartCanvasSize(canvas);
        this.expensesChart = new Chart(canvas, {
            type: 'doughnut',
            plugins: [this.createDoughnutCenterTextPlugin()],
            data: {
                labels: categories,
                datasets: [doughnutDataset as never]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                events: ['mousemove', 'mouseout', 'click'],
                animation: this.getChartAnimationOptions(this.animateExpensesChartThisRender),
                resizeDelay: this.getChartResizeDelay(),
                transitions: {
                    active: {
                        animation: {
                            duration: this.getChartAnimationDuration(),
                            easing: 'easeOutQuart'
                        }
                    },
                    resize: {
                        animation: {
                            duration: 0
                        }
                    }
                },
                layout: {
                    padding: chartPadding
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: showTooltip,
                        position: 'expensicaDoughnutOuterEdge',
                        displayColors: false,
                        backgroundColor: this.getTooltipBackgroundColor(),
                        titleColor: this.getTooltipTitleColor(),
                        bodyColor: this.getTooltipBodyColor(),
                        borderColor: this.getTooltipBorderColor(),
                        borderWidth: 1,
                        callbacks: {
                            title: () => '',
                            label: (context) => {
                                const emoji = categoryData[context.dataIndex]?.emoji;
                                return emoji ? `${emoji} ${context.label || ''}` : context.label || '';
                            }
                        }
                    }
                },
                onClick: (_event, elements, chart) => {
                    if (!legendContainer) {
                        return;
                    }

                    if (elements.length === 0) {
                        if (this.isMobileDashboard()) {
                            this.clearChartHoverState(chart);
                        }
                        return;
                    }

                    if (this.isMobileDashboard()) {
                        const clickedIndex = elements[0].index;

                        if (this.mobileActiveCategorySliceIndex === clickedIndex) {
                            this.switchDashboardTab(DashboardTab.CATEGORIES);
                            this.scrollToTop();
                            return;
                        }

                        this.mobileActiveCategorySliceIndex = clickedIndex;
                        this.activateCategorySliceByIndex(chart, clickedIndex, true);
                        return;
                    }

                    this.switchDashboardTab(DashboardTab.CATEGORIES);
                    this.scrollToTop();
                }
            }
        });

        if (legendContainer) {
            this.renderCategoryExpensesLegend(legendContainer, this.expensesChart, categoryData);
        }

        window.requestAnimationFrame(() => {
            this.updateDashboardChartGridLayout();
            this.syncChartsAfterCategoryLayoutChange();
        });

        if (this.animateExpensesChartThisRender) {
            this.scheduleChartAnimationReset();
        }
    }

    renderCategoryExpensesLegend(
        container: HTMLElement,
        chart: Chart,
        categoryData: { name: string; amount: number; color: string; emoji?: string }[]
    ) {
        container.empty();
        const columnCount = categoryData.length === 1
            ? 1
            : categoryData.length === 2
                ? 2
                : categoryData.length === 3
                    ? 3
                    : categoryData.length === 4
                        ? 2
                        : 3;

        container.addClass('expensica-category-chip-grid');
        container.addClass('expensica-donut-category-legend');
        container.setCssProps({ '--expensica-category-chip-columns': String(columnCount) });

        categoryData.forEach((category, index) => {
            const categoryName = category.name;
            const categoryEmoji = category.emoji;
            const legendItem = container.createEl('button', {
                cls: 'expensica-category-chip expensica-donut-legend-chip',
                attr: { type: 'button' }
            });
            legendItem.setCssProps({ '--expensica-category-chip-color': category.color });
            legendItem.setAttribute('aria-label', `Toggle ${categoryName}`);
            legendItem.toggleClass('is-hidden', !chart.getDataVisibility(index));

            const swatch = legendItem.createSpan('expensica-category-chip-swatch');
            swatch.setCssStyles({ backgroundColor: category.color });

            if (categoryEmoji) {
                legendItem.createSpan({ text: categoryEmoji, cls: 'expensica-donut-legend-emoji' });
            }

            legendItem.createSpan({ text: categoryName, cls: 'expensica-category-chip-label' });
            legendItem.setAttribute('data-category-index', String(index));

            legendItem.addEventListener('click', () => {
                this.clearChartHoverState(chart);
                this.temporarilyEnableChartAnimations();
                chart.toggleDataVisibility(index);
                chart.update();
                legendItem.toggleClass('is-hidden', !chart.getDataVisibility(index));
            });

            legendItem.addEventListener('pointerenter', (event) => this.activateCategorySlice(chart, index, event));
            legendItem.addEventListener('pointerleave', () => this.clearCategorySlice(chart));
        });
    }

    private activateCategorySlice(chart: Chart | null, index: number, event: PointerEvent) {
        if (!chart || event.pointerType !== 'mouse' || !chart.getDataVisibility(index)) {
            return;
        }

        this.activateCategorySliceByIndex(chart, index);
    }

    private clearCategorySlice(chart: Chart | null) {
        if (!chart) {
            return;
        }

        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        chart.update();
    }

    createWeeklyExpensesChart(canvas: HTMLCanvasElement) {
        // Cleanup previous chart
        if (this.expensesChart) {
            this.expensesChart.destroy();
            this.expensesChart = null;
        }

        const { start, end } = this.getDateRangeDayBounds();
        const includeYear = start.getFullYear() !== end.getFullYear();
        const weekBuckets: { label: string; isoYear: number; isoWeek: number; start: Date; end: Date; amount: number }[] = [];
        const currentDay = new Date(start);

        const getIsoWeek = (date: Date): { year: number; week: number } => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 4 - (d.getDay() || 7));

            const yearStart = new Date(d.getFullYear(), 0, 1);
            const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
            return { year: d.getFullYear(), week };
        };

        while (currentDay <= end) {
            const { year, week } = getIsoWeek(currentDay);

            if (!weekBuckets.some(bucket => bucket.isoYear === year && bucket.isoWeek === week)) {
                weekBuckets.push({
                    label: includeYear ? `${year} Week ${week}` : `Week ${week}`,
                    isoYear: year,
                    isoWeek: week,
                    start: new Date(currentDay),
                    end: new Date(currentDay),
                    amount: 0
                });
            } else {
                const bucket = weekBuckets.find(bucket => bucket.isoYear === year && bucket.isoWeek === week);
                if (bucket) {
                    bucket.end = new Date(currentDay);
                }
            }

            currentDay.setDate(currentDay.getDate() + 1);
        }

        if (!this.plugin.settings.showWeekNumbers) {
            weekBuckets.forEach(bucket => {
                bucket.label = `${this.formatChartDateLabel(bucket.start, includeYear)} - ${this.formatChartDateLabel(bucket.end, includeYear)}`;
            });
        }

        // Assign transactions to weeks
        this.transactions
            .filter(t => t.type === TransactionType.EXPENSE)
            .forEach(transaction => {
                const date = parseLocalDate(transaction.date);
                const { year, week } = getIsoWeek(date);
                const bucket = weekBuckets.find(weekBucket =>
                    weekBucket.isoYear === year
                    && weekBucket.isoWeek === week
                );
                if (bucket) {
                    bucket.amount += transaction.amount;
                }
            });

        // Prepare data for chart
        const weeks = weekBuckets.map(week => week.label);
        const amounts = weekBuckets.map(week => week.amount);
        const expenseColor = this.getThemeColor('--text-error', 'rgb(212, 76, 71)');
        const expenseFillColor = this.getThemeColorWithAlpha('--text-error', 'rgb(212, 76, 71)', 0.7);
        const expenseHoverColor = this.getThemeColorWithAlpha('--text-error', 'rgb(212, 76, 71)', 0.9);
        const barRadius = this.getChartBarRadius();

        // Create the chart
        this.prepareChartCanvasSize(canvas);
        this.expensesChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: weeks,
                datasets: [{
                    label: 'Expenses',
                    data: amounts,
                    backgroundColor: expenseFillColor,
                    borderColor: expenseColor,
                    borderWidth: 1,
                    borderRadius: barRadius,
                    hoverBackgroundColor: expenseHoverColor
                }]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: this.getChartAnimationOptions(this.animateExpensesChartThisRender),
                resizeDelay: this.getChartResizeDelay(),
                transitions: {
                    resize: {
                        animation: {
                            duration: 0
                        }
                    }
                },
                layout: {
                    padding: {
                        bottom: 12
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: this.getTextColor(),
                            callback: (value) => {
                                return this.formatCompactChartCurrency(value as number);
                            }
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: this.getTextColor(),
                            padding: 6
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: this.getTooltipBackgroundColor(),
                        titleColor: this.getTooltipTitleColor(),
                        bodyColor: this.getTooltipBodyColor(),
                        borderColor: this.getTooltipBorderColor(),
                        borderWidth: 1,
                        callbacks: {
                            title: (contexts) => {
                                const bucket = weekBuckets[contexts[0]?.dataIndex ?? -1];
                                return bucket
                                    ? this.formatChartTooltipRangeTitle(bucket.start, bucket.end)
                                    : '';
                            },
                            label: (context) => {
                                const value = context.raw as number;
                                return `Expenses: ${this.formatCompactChartCurrency(value)}`;
                            }
                        }
                    }
                }
            }
        });

        if (this.animateExpensesChartThisRender) {
            this.scheduleChartAnimationReset();
        }
    }

    createMonthlyExpensesChart(canvas: HTMLCanvasElement) {
        // Cleanup previous chart
        if (this.expensesChart) {
            this.expensesChart.destroy();
            this.expensesChart = null;
        }

        const { start, end } = this.getDateRangeDayBounds();
        const includeYear = start.getFullYear() !== end.getFullYear();
        const monthsData: { label: string, year: number, month: number, expenses: number }[] = [];
        const currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);

        while (currentMonth <= end) {
            monthsData.push({
                label: this.formatChartMonthLabel(currentMonth, includeYear),
                year: currentMonth.getFullYear(),
                month: currentMonth.getMonth(),
                expenses: 0
            });
            currentMonth.setMonth(currentMonth.getMonth() + 1);
        }

        this.transactions
            .filter(t => t.type === TransactionType.EXPENSE)
            .forEach(transaction => {
                const transactionDate = parseLocalDate(transaction.date);
                const bucket = monthsData.find(month =>
                    month.year === transactionDate.getFullYear()
                    && month.month === transactionDate.getMonth()
                );

                if (bucket) {
                    bucket.expenses += transaction.amount;
                }
            });

        // Prepare data for chart
        const months = monthsData.map(m => m.label);
        const expenses = monthsData.map(m => m.expenses);
        const expenseColor = this.getThemeColor('--text-error', 'rgb(212, 76, 71)');
        const expenseFillColor = this.getThemeColorWithAlpha('--text-error', 'rgb(212, 76, 71)', 0.7);
        const expenseHoverColor = this.getThemeColorWithAlpha('--text-error', 'rgb(212, 76, 71)', 0.9);
        const barRadius = this.getChartBarRadius();

        // Create the chart
        this.prepareChartCanvasSize(canvas);
        this.expensesChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [{
                    label: 'Monthly Expenses',
                    data: expenses,
                    backgroundColor: expenseFillColor,
                    borderColor: expenseColor,
                    borderWidth: 1,
                    borderRadius: barRadius,
                    hoverBackgroundColor: expenseHoverColor
                }]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: this.getChartAnimationOptions(this.animateExpensesChartThisRender),
                resizeDelay: this.getChartResizeDelay(),
                transitions: {
                    resize: {
                        animation: {
                            duration: 0
                        }
                    }
                },
                layout: {
                    padding: {
                        bottom: 12
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: this.getTextColor(),
                            callback: (value) => {
                                return this.formatCompactChartCurrency(value as number);
                            }
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: this.getTextColor(),
                            padding: 6
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: this.getTooltipBackgroundColor(),
                        titleColor: this.getTooltipTitleColor(),
                        bodyColor: this.getTooltipBodyColor(),
                        borderColor: this.getTooltipBorderColor(),
                        borderWidth: 1,
                        callbacks: {
                            title: (contexts) => {
                                const month = monthsData[contexts[0]?.dataIndex ?? -1];
                                return month
                                    ? this.formatChartTooltipMonthTitle(new Date(month.year, month.month, 1))
                                    : '';
                            },
                            label: (context) => {
                                const value = context.raw as number;
                                return `Expenses: ${this.formatCompactChartCurrency(value)}`;
                            }
                        }
                    }
                }
            }
        });

        if (this.animateExpensesChartThisRender) {
            this.scheduleChartAnimationReset();
        }
    }

    renderIncomeExpenseChart(container: HTMLElement) {
        // Header with title
        const chartHeader = container.createDiv('expensica-chart-header');
        const chartTitle = chartHeader.createEl('h3', { cls: 'expensica-chart-title' });
        chartTitle.setText('Transactions & Balances');
        this.renderChartDateRangeButtons(container);

        // Canvas container
        const canvasContainer = container.createDiv('expensica-canvas-container');
        const legendContainer = container.createDiv('expensica-chart-html-legend expensica-income-expense-legend');

        // If there are no transactions, show an empty state
        if (this.transactions.length === 0) {
            canvasContainer.addClass('is-empty');
            canvasContainer.empty();
            legendContainer.remove();
            const emptyState = canvasContainer.createDiv('expensica-empty-charts');
            emptyState.createDiv({ text: '📈', cls: 'expensica-empty-icon' });
            emptyState.createEl('p', {
                text: 'No transactions found for this period. Add income and expenses to see your financial flow.',
                cls: 'expensica-empty-state-message'
            });
            this.syncChartsAfterCategoryLayoutChange();
            return;
        }

        const canvas = canvasContainer.createEl('canvas', { attr: { id: 'income-expense-chart' }});

        // Create chart
        window.setTimeout(() => {
            if (canvas.isConnected === false) return;
            this.createIncomeExpenseChart(canvas, legendContainer);
        }, 50);
    }

    createIncomeExpenseChart(canvas: HTMLCanvasElement, legendContainer: HTMLElement | null = null) {
        // Cleanup previous chart
        if (this.incomeExpenseChart) {
            this.incomeExpenseChart.destroy();
            this.incomeExpenseChart = null;
        }

        if (!this.getIncomeExpenseChartDayBounds()) {
            return;
        }

        const accounts = this.getIncomeExpenseChartAccounts();
        const allTransactions = this.plugin.getAllTransactions()
            .slice()
            .sort((a, b) => this.getTransactionDateTime(a).getTime() - this.getTransactionDateTime(b).getTime());
        const buckets = this.getIncomeExpenseChartBuckets(accounts, allTransactions);

        if (buckets.length === 0) {
            return;
        }

        const incomeData = buckets.map(bucket => bucket.income);
        const expenseData = buckets.map(bucket => -bucket.expenses);
        const netData = buckets.map(bucket => bucket.net);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const visibleNetData = buckets.map((bucket, index) => (
            bucket.start > todayEnd ? null : netData[index]
        ));
        const defaultReference = allTransactions.length
            ? this.plugin.normalizeTransactionAccountReference(undefined) : undefined;
        const defaultIsCredit = !this.plugin.settings.enableAccounts && accounts.length > 0
            && this.plugin.findAccountByReference(accounts[0].reference)?.type === AccountType.CREDIT;
        const accountSeries = accounts.map((account) => {
            const firstTransaction = allTransactions.find(transaction => getAccountTransactionAmount(this.plugin, transaction,
                account.reference, this.plugin.settings.enableAccounts ? account.isCredit : defaultIsCredit, defaultReference) !== 0);
            const firstTransactionAt = firstTransaction ? this.getTransactionDateTime(firstTransaction) : null;

            return {
                ...account,
                data: buckets.map(bucket => {
                    if (firstTransactionAt && bucket.end < firstTransactionAt) {
                        return null;
                    }
                    if (bucket.start > todayEnd) {
                        return null;
                    }

                    const balance = bucket.accountBalances[account.reference] ?? 0;
                    return account.isCredit ? -balance : balance;
                })
            };
        });
        const canShowNegativeValues = expenseData.some(value => value < 0)
            || netData.some(value => value < 0)
            || accountSeries.some(account => account.data.some(value => value !== null && value < 0));

        const formattedDates = buckets.map(bucket => bucket.label);
        const incomeColor = this.getThemeColor('--text-success', 'rgb(68, 131, 97)');
        const incomeFillColor = this.getThemeColorWithAlpha('--text-success', 'rgb(68, 131, 97)', 0.75);
        const expenseColor = this.getThemeColor('--text-error', 'rgb(212, 76, 71)');
        const expenseFillColor = this.getThemeColorWithAlpha('--text-error', 'rgb(212, 76, 71)', 0.75);
        const netColor = this.getThemeColor('--interactive-accent', 'rgb(123, 108, 217)');
        const barRadius = this.getChartBarRadius();
        const helperTextColor = this.getChartHelperTextColor();

        // Create the chart
        this.prepareChartCanvasSize(canvas);
        this.incomeExpenseChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: formattedDates,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        type: 'bar',
                        grouped: false,
                        hidden: !this.incomeExpenseVisibility.income,
                        borderColor: incomeFillColor,
                        backgroundColor: incomeFillColor,
                        borderWidth: 0,
                        borderRadius: barRadius,
                        order: 2
                    },
                    {
                        label: 'Expenses',
                        data: expenseData,
                        type: 'bar',
                        grouped: false,
                        hidden: !this.incomeExpenseVisibility.expenses,
                        borderColor: expenseFillColor,
                        backgroundColor: expenseFillColor,
                        borderWidth: 0,
                        borderRadius: barRadius,
                        order: 1
                    },
                    {
                        label: 'Net',
                        data: visibleNetData,
                        type: 'line',
                        hidden: !this.incomeExpenseVisibility.net,
                        borderColor: netColor,
                        backgroundColor: netColor,
                        // Keep Net visible behind an account with identical balances.
                        borderWidth: 4,
                        fill: false,
                        tension: 0.35,
                        pointBackgroundColor: netColor,
                        pointBorderColor: netColor,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: netColor,
                        pointHoverBorderColor: netColor,
                        pointHoverBorderWidth: 2,
                        pointHitRadius: 16,
                        spanGaps: false,
                        order: 0
                    },
                    ...accountSeries.map((account, index) => ({
                        label: account.name,
                        data: account.data,
                        type: 'line' as const,
                        hidden: this.incomeExpenseVisibility.accounts[account.reference] === false,
                        borderColor: account.color,
                        backgroundColor: account.color,
                        borderWidth: 2,
                        fill: false,
                        tension: 0.35,
                        pointBackgroundColor: account.color,
                        pointBorderColor: account.color,
                        // A range may contain many buckets but only one drawable balance.
                        pointRadius: account.data.filter(value => value !== null).length === 1 ? 3 : 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: account.color,
                        pointHoverBorderColor: account.color,
                        pointHoverBorderWidth: 2,
                        pointHitRadius: 16,
                        spanGaps: false,
                        expensicaValueDisplayMode: account.isCredit ? 'absolute' : 'default',
                        // Chart.js draws lower orders last; account lines must sit above Net.
                        order: -(index + 1)
                    }))
                ]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: this.getChartAnimationOptions(this.animateIncomeExpenseChartThisRender),
                resizeDelay: this.getChartResizeDelay(),
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                transitions: {
                    resize: {
                        animation: {
                            duration: 0
                        }
                    }
                },
                layout: {
                    padding: {
                        bottom: 12
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        min: canShowNegativeValues ? undefined : 0,
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: helperTextColor,
                            callback: (value) => {
                                return this.formatCompactChartCurrency(value as number);
                            }
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    },
                    x: {
                        display: this.shouldShowChartAxes() || this.shouldShowChartGrid(),
                        ticks: {
                            display: this.shouldShowChartAxes(),
                            color: helperTextColor,
                            padding: 6
                        },
                        border: {
                            display: this.shouldShowChartAxes()
                        },
                        grid: {
                            display: this.shouldShowChartGrid(),
                            drawTicks: this.shouldShowChartAxes(),
                            color: this.getGridColor()
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: this.getTooltipBackgroundColor(),
                        titleColor: this.getTooltipTitleColor(),
                        bodyColor: this.getTooltipBodyColor(),
                        borderColor: this.getTooltipBorderColor(),
                        borderWidth: 1,
                        callbacks: {
                            title: (contexts) => {
                                const bucket = buckets[contexts[0]?.dataIndex ?? -1];
                                return bucket
                                    ? this.formatChartTooltipRangeTitle(bucket.start, bucket.end)
                                    : '';
                            },
                            label: (context) => {
                                const label = context.dataset.label || '';
                                const value = context.raw as number;
                                const displayMode = (context.dataset as { expensicaValueDisplayMode?: string }).expensicaValueDisplayMode;
                                const formattedValue = label === 'Expenses' || displayMode === 'absolute'
                                    ? this.formatCompactChartCurrency(Math.abs(value))
                                    : this.formatCompactChartCurrency(value);
                                return `${label}: ${formattedValue}`;
                            }
                        },
                        filter: (context) => {
                            const value = context.raw as number;
                            return context.dataset.type === 'line' || value !== 0;
                        }
                    }
                }
            }
        });
        this.bindChartAreaTooltipClear(canvas, this.incomeExpenseChart);

        if (this.animateIncomeExpenseChartThisRender) {
            this.scheduleChartAnimationReset();
        }

        if (legendContainer) {
            this.renderIncomeExpenseLegend(legendContainer, this.incomeExpenseChart, [
                { label: 'Income', datasetIndex: 0, color: incomeColor },
                { label: 'Expenses', datasetIndex: 1, color: expenseColor },
                { label: 'Net', datasetIndex: 2, color: netColor },
                ...accountSeries.map((account, index) => ({
                    label: account.name,
                    datasetIndex: index + 3,
                    color: account.color,
                    accountReference: account.reference
                }))
            ]);
        }
    }

    toggleIncomeExpenseDataset(chart: Chart, datasetIndex: number) {
        this.restoreIncomeExpenseAnimationData(chart);
        chart.stop();
        this.cancelIncomeExpenseToggleAnimation();
        this.cancelIncomeExpenseHoverAnimation();

        const isVisible = chart.isDatasetVisible(datasetIndex);
        if (isVisible) {
            this.temporarilyEnableChartAnimations();
            chart.hide(datasetIndex);
        } else {
            const dataset = chart.data.datasets[datasetIndex] as AnimatedChartDataset;
            const data = [...(dataset.data as (number | null)[])];
            dataset.__expensicaPendingAnimationData = data;
            dataset.data = data.map(value => value === null ? null : 0);
            chart.setDatasetVisibility(datasetIndex, true);
            chart.update('none');

            this.incomeExpenseToggleAnimationFrame = window.requestAnimationFrame(() => {
                this.incomeExpenseToggleAnimationFrame = null;
                dataset.data = data;
                delete dataset.__expensicaPendingAnimationData;
                this.temporarilyEnableChartAnimations();
                chart.update();
            });
        }

        this.incomeExpenseVisibility = {
            income: chart.isDatasetVisible(0),
            expenses: chart.isDatasetVisible(1),
            net: chart.isDatasetVisible(2),
            accounts: this.getIncomeExpenseChartAccounts().reduce((visibility, account, index) => {
                visibility[account.reference] = chart.isDatasetVisible(index + 3);
                return visibility;
            }, {} as Record<string, boolean>)
        };
        this.persistDashboardState();
    }

    replayIncomeExpenseDatasetAnimation(chart: Chart, datasetIndex: number) {
        if (!chart.isDatasetVisible(datasetIndex)) {
            return;
        }

        this.restoreIncomeExpenseAnimationData(chart);
        const dataset = chart.data.datasets[datasetIndex] as AnimatedChartDataset;
        const data = [...(dataset.data as (number | null)[])];

        if (data.every(value => Number(value) === 0)) {
            return;
        }

        chart.stop();
        this.cancelIncomeExpenseHoverAnimation();
        dataset.__expensicaPendingAnimationData = data;
        dataset.data = data.map(value => value === null ? null : 0);
        chart.update('none');

        this.incomeExpenseHoverAnimationFrame = window.requestAnimationFrame(() => {
            this.incomeExpenseHoverAnimationFrame = null;
            dataset.data = data;
            delete dataset.__expensicaPendingAnimationData;
            this.temporarilyEnableChartAnimations();
            chart.update();
        });
    }

    renderIncomeExpenseLegend(
        container: HTMLElement,
        chart: Chart,
        legendItems: { label: string; datasetIndex: number; color: string; accountReference?: string }[]
    ) {
        container.empty();
        legendItems.forEach((item) => {
            const legendItem = renderCategoryChip(container, {
                text: item.label,
                color: item.color,
                swatchColor: item.color,
                interactive: true,
                hidden: !chart.isDatasetVisible(item.datasetIndex)
            });
            legendItem.setAttribute('aria-label', `Toggle ${item.label}`);

            legendItem.addEventListener('click', () => {
                this.toggleIncomeExpenseDataset(chart, item.datasetIndex);
                legendItem.toggleClass('is-hidden', !chart.isDatasetVisible(item.datasetIndex));
            });

            legendItem.addEventListener('pointerenter', (event) => {
                if (event.pointerType === 'mouse') {
                    this.replayIncomeExpenseDatasetAnimation(chart, item.datasetIndex);
                }
            });
        });
    }

    private getCurrentCategoryChartData(): { id?: string; name: string; amount: number; color: string; emoji?: string }[] {
        const totals = new Map<string, { id?: string; name: string; amount: number; color: string; emoji?: string }>();

        this.transactions.forEach(transaction => {
            if (transaction.type !== this.getCategoryChartTransactionType()) {
                return;
            }

            const category = this.plugin.settings.categories.find(candidate => candidate.id === transaction.category);
            const name = category?.name || 'Other Expenses';
            const existing = totals.get(name);

            if (existing) {
                existing.amount += transaction.amount;
                return;
            }

            totals.set(name, {
                id: category?.id,
                name,
                amount: transaction.amount,
                color: category ? this.plugin.getCategoryColor(category.id, category.name) : getDefaultCategoryColor(name),
                emoji: category ? this.plugin.getCategoryEmoji(category.id) : undefined
            });
        });

        return Array.from(totals.values()).sort((left, right) => right.amount - left.amount);
    }

    private getCategoriesTabData(): { id?: string; name: string; amount: number; color: string; emoji?: string; percentage: number }[] {
        const transactionType = this.getCategoryChartTransactionType();
        const categories = this.transactions.reduce((totals, transaction) => {
            if (transaction.type !== transactionType) {
                return totals;
            }

            const category = this.plugin.settings.categories.find(candidate => candidate.id === transaction.category);
            const name = category?.name || 'Other Expenses';
            const existing = totals.get(name);

            if (existing) {
                existing.amount += transaction.amount;
                return totals;
            }

            totals.set(name, {
                id: category?.id,
                name,
                amount: transaction.amount,
                color: category ? this.plugin.getCategoryColor(category.id, category.name) : getDefaultCategoryColor(name),
                emoji: category ? this.plugin.getCategoryEmoji(category.id) : undefined
            });

            return totals;
        }, new Map<string, { id?: string; name: string; amount: number; color: string; emoji?: string }>());

        const items = Array.from(categories.values()).sort((left, right) => right.amount - left.amount);
        const total = items.reduce((sum, item) => sum + item.amount, 0);

        return items.map(item => ({
            ...item,
            percentage: total > 0 ? (item.amount / total) * 100 : 0
        }));
    }

    private getUnusedCategoriesTabData(): { id?: string; name: string; amount: number; color: string; emoji?: string; percentage: number }[] {
        const usedCategoryIds = new Set(
            this.transactions
                .filter(transaction => transaction.type === this.getCategoryChartTransactionType())
                .map(transaction => transaction.category)
        );

        return this.plugin
            .getCategories(this.categoryChartType)
            .filter(category => !usedCategoryIds.has(category.id) && category.id !== INTERNAL_CATEGORY_ID)
            .map(category => ({
                id: category.id,
                name: category.name,
                amount: 0,
                color: this.plugin.getCategoryColor(category.id, category.name),
                emoji: this.plugin.getCategoryEmoji(category.id),
                percentage: 0
            }));
    }

    private renderCategoryChartTypeSelector(
        container: HTMLElement,
        onChange: () => void,
        options: {
            showTitle?: boolean;
            overlayClass?: string;
            leadingAction?: {
                ariaLabel: string;
                onClick: () => void;
            };
        } = {}
    ) {
        if (this.categoryChartTypeSelectorComponent) this.removeChild(this.categoryChartTypeSelectorComponent);
        this.categoryChartTypeSelectorComponent = this.addChild(new Component());
        const chartHeader = container.createDiv('expensica-chart-header');
        if (options.overlayClass) {
            chartHeader.addClass(options.overlayClass);
        }

        if (options.showTitle !== false) {
            chartHeader.createEl('h3', {
                text: 'Categories',
                cls: 'expensica-chart-title'
            });
        }

        if (options.leadingAction) {
            const leadingActionButton = chartHeader.createEl('button', {
                cls: 'expensica-standard-button shadcn-btn shadcn-btn-primary expensica-category-create-button',
                attr: {
                    type: 'button',
                    'aria-label': options.leadingAction.ariaLabel,
                    title: options.leadingAction.ariaLabel
                }
            });
            leadingActionButton.createSpan({
                text: '+',
                cls: 'expensica-category-create-button-icon expensica-account-card-icon-create'
            });
            leadingActionButton.addEventListener('click', options.leadingAction.onClick);
        }

        const chartTypeOptions: { value: CategoryType; label: string }[] = [
            { value: CategoryType.EXPENSE, label: 'Expenses' },
            { value: CategoryType.INCOME, label: 'Income' }
        ];
        const selectedChartType = chartTypeOptions.find(option => option.value === this.categoryChartType) || chartTypeOptions[0];
        const chartTypeSelector = chartHeader.createDiv('expensica-chart-type-selector');
        const chartTypeCurrent = chartTypeSelector.createEl('button', {
            cls: 'expensica-standard-button shadcn-date-range-current expensica-chart-type-current',
            attr: {
                type: 'button',
                'aria-label': 'Category chart type',
                'aria-expanded': 'false'
            }
        });
        chartTypeCurrent.createSpan({
            text: selectedChartType.label,
            cls: 'shadcn-date-range-text expensica-chart-type-text'
        });
        const dropdownIcon = chartTypeCurrent.createSpan({ cls: 'shadcn-date-range-icon expensica-chart-type-icon' });
        appendChevronIcon(dropdownIcon, '14');

        const chartTypeMenu = chartTypeSelector.createDiv('shadcn-date-range-options expensica-chart-type-options shadcn-date-range-hidden');
        chartTypeOptions.forEach(option => {
            const optionButton = chartTypeMenu.createEl('button', {
                text: option.label,
                cls: 'shadcn-date-range-option expensica-chart-type-option',
                attr: { type: 'button' }
            });
            optionButton.toggleClass('is-active', this.categoryChartType === option.value);
            optionButton.toggleClass('shadcn-date-range-option-active', this.categoryChartType === option.value);
            optionButton.addEventListener('click', () => {
                if (this.categoryChartType === option.value) {
                    chartTypeMenu.addClass('shadcn-date-range-hidden');
                    dropdownIcon.removeClass('dropdown-icon-open');
                    chartTypeCurrent.setAttribute('aria-expanded', 'false');
                    return;
                }

                this.categoryChartType = option.value;
                chartTypeMenu.addClass('shadcn-date-range-hidden');
                dropdownIcon.removeClass('dropdown-icon-open');
                chartTypeCurrent.setAttribute('aria-expanded', 'false');
                this.persistDashboardState();
                onChange();
            });
        });

        chartTypeCurrent.addEventListener('click', () => {
            const isHidden = chartTypeMenu.hasClass('shadcn-date-range-hidden');
            chartTypeMenu.toggleClass('shadcn-date-range-hidden', !isHidden);
            dropdownIcon.toggleClass('dropdown-icon-open', isHidden);
            chartTypeCurrent.setAttribute('aria-expanded', String(isHidden));
        });

        this.categoryChartTypeSelectorComponent.registerDomEvent(container.ownerDocument, 'click', (event) => {
            const target = event.target as HTMLElement;
            if (!chartTypeSelector.contains(target)) {
                chartTypeMenu.addClass('shadcn-date-range-hidden');
                dropdownIcon.removeClass('dropdown-icon-open');
                chartTypeCurrent.setAttribute('aria-expanded', 'false');
            }
        });
    }

    private openCategoryModal(categoryId?: string) {
        if (!categoryId) {
            return;
        }

        const category = this.plugin.getCategoryById(categoryId);
        if (!category) {
            showExpensicaNotice('Category no longer exists.');
            return;
        }

        new CategoryModal(this.app, this.plugin, this, category).open();
    }

    renderTransactions(container: HTMLElement) {
        const transactionsSection = container.createDiv('expensica-section expensica-recent-transactions-section expensica-animate expensica-animate-delay-3');

        // Section header
        const sectionHeader = transactionsSection.createDiv('expensica-section-header');
        sectionHeader.createEl('h2', {
            text: 'Transactions',
            cls: 'expensica-section-title expensica-transactions-title'
        });
        
        this.renderViewAllTransactionsButton(sectionHeader);

        // Transactions container
        const transactionsContainer = transactionsSection.createDiv('expensica-transactions');

        // Sort transactions by date and creation time (most recent first)
        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const allTransactions = this.plugin.getAllTransactions();
        const sortedTransactions = sortTransactionsByDateTimeDesc(this.transactions, allTransactions);
        const internalBalanceMaps = new Map<string, Record<string, number>>();
        const ensureBalanceMap = (accountReference: string): Record<string, number> => {
            const existing = internalBalanceMaps.get(accountReference);
            if (existing) {
                return existing;
            }

            const balances = getRunningBalanceByTransactionIdForAccount(this.plugin, accountReference, allTransactions);
            internalBalanceMaps.set(accountReference, balances);
            return balances;
        };

        // Limit to 10 most recent transactions
        const recentTransactions = sortedTransactions.slice(0, 10);

        if (recentTransactions.length === 0) {
            const emptyState = transactionsContainer.createDiv('expensica-empty-state');
            emptyState.createDiv({ text: '📝', cls: 'expensica-empty-state-icon' });
            emptyState.createEl('p', {
                text: `No transactions found for ${this.dateRange.label.toLowerCase()}. Add your first transaction using the buttons above!`,
                cls: 'expensica-empty-state-message'
            });
        } else {
            let currentMonthKey = '';
            let currentDayKey = '';

            recentTransactions.forEach(transaction => {
                const monthKey = this.getTransactionMonthKey(transaction);
                const dayKey = this.getTransactionDayKey(transaction);

                if (monthKey !== currentMonthKey) {
                    currentMonthKey = monthKey;
                    currentDayKey = '';
                    this.renderTransactionGroupTitle(transactionsContainer, this.getTransactionMonthLabel(transaction), 'month');
                }

                if (dayKey !== currentDayKey) {
                    currentDayKey = dayKey;
                    this.renderTransactionGroupTitle(transactionsContainer, this.getTransactionDayLabel(transaction), 'day');
                }

                const transactionAccountReference = this.plugin.settings.enableAccounts
                    ? this.plugin.normalizeTransactionAccountReference(transaction.account)
                    : defaultAccountReference;
                const transactionBalances = ensureBalanceMap(transactionAccountReference);
                let runningBalanceLabel = formatRunningBalanceLabel(
                    this.plugin,
                    transactionBalances[transaction.id] ?? 0
                );
                let secondaryRunningBalanceLabel: string | undefined;

                if (this.plugin.settings.enableAccounts && transaction.type === TransactionType.INTERNAL) {
                    const fromAccountReference = this.plugin.normalizeTransactionAccountReference(transaction.fromAccount);
                    const toAccountReference = this.plugin.normalizeTransactionAccountReference(transaction.toAccount);
                    const fromBalances = ensureBalanceMap(fromAccountReference);
                    const toBalances = ensureBalanceMap(toAccountReference);
                    runningBalanceLabel = formatRunningBalanceLabel(
                        this.plugin,
                        fromBalances[transaction.id] ?? 0,
                        fromAccountReference
                    );
                    secondaryRunningBalanceLabel = formatRunningBalanceLabel(
                        this.plugin,
                        toBalances[transaction.id] ?? 0,
                        toAccountReference
                    );
                }

                renderTransactionCard(transactionsContainer, {
                    plugin: this.plugin,
                    transaction,
                    runningBalanceLabel,
                    secondaryRunningBalanceLabel,
                    onEdit: (transaction) => {
                        this.openTransactionModal(transaction);
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
                        this.syncOverviewBulkSelectionFooter();
                    }
                });
            });

            this.renderTransactionBulkFooter(transactionsSection);

            if (sortedTransactions.length > recentTransactions.length) {
                const footer = transactionsSection.createDiv('expensica-transactions-footer');
                this.renderViewAllTransactionsButton(footer, 'expensica-view-all-footer-btn');
            }
        }
    }

    private renderTransactionBulkFooter(container: HTMLElement) {
        container.querySelector('.expensica-transaction-bulk-footer')?.remove();
        const selectedTransactions = this.transactions.filter(transaction => this.selectedTransactionIds.has(transaction.id));
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
        createDashboardSvgIcon(clearButton, '14', '2.4', [
            { tag: 'line', attributes: { x1: '18', y1: '6', x2: '6', y2: '18' } },
            { tag: 'line', attributes: { x1: '6', y1: '6', x2: '18', y2: '18' } }
        ], true);
        clearButton.addEventListener('click', () => {
            this.selectedTransactionIds.clear();
            this.syncOverviewVisibleTransactionSelectionState();
            this.syncOverviewBulkSelectionFooter();
        });

        leftGroup.createSpan({
            text: `${selectedTransactions.length} selected`,
            cls: 'expensica-transaction-bulk-count'
        });

        const visibleTransactions = sortTransactionsByDateTimeDesc(this.transactions, this.plugin.getAllTransactions()).slice(0, 10);
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
        } else {
            selectAllButton.addEventListener('click', () => {
                visibleTransactions.forEach(transaction => this.selectedTransactionIds.add(transaction.id));
                this.maybeShowMixedTransactionTypeSelectionNotice();
                this.syncOverviewVisibleTransactionSelectionState();
                this.syncOverviewBulkSelectionFooter();
            });
        }

        const hasMixedTypes = new Set(selectedTransactions.map(transaction => transaction.type)).size > 1;
        const hasInternalOnly = new Set(selectedTransactions.map(transaction => transaction.type)).size === 1
            && selectedTransactions[0].type === TransactionType.INTERNAL;
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
        } else {
            categoryButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const categoryType = selectedTransactions[0].type === TransactionType.INCOME
                    ? CategoryType.INCOME
                    : CategoryType.EXPENSE;
                showTransactionBulkCategoryMenu(categoryButton, this.plugin, categoryType, async (categoryId) => {
                    await this.plugin.updateTransactions(selectedTransactions.map(transaction => transaction.id), { category: categoryId }, this);
                    this.selectedTransactionIds.clear();
                    await this.loadTransactionsData();
                    this.requestAllChartAnimations();
                    this.renderDashboard();
                    showExpensicaNotice('Transactions updated successfully');
                });
            });
        }

        const renameButton = actionsGroup.createEl('button', {
            cls: 'expensica-standard-button expensica-transaction-bulk-icon-button expensica-transaction-bulk-rename',
            attr: {
                type: 'button',
                'aria-label': 'Rename selected transactions',
                title: 'Rename selected transactions'
            }
        });
        createDashboardSvgIcon(renameButton, '14', '2.1', [
            { tag: 'path', attributes: { d: 'M12 20h9' } },
            { tag: 'path', attributes: { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' } }
        ], true);
        renameButton.addEventListener('click', () => {
            new BulkRenameTransactionsModal(this.app, async (name) => {
                await this.bulkRenameSelectedTransactions(name);
            }, this.plugin).open();
        });

        const deleteButton = actionsGroup.createEl('button', {
            cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid expensica-transaction-bulk-icon-button expensica-transaction-bulk-delete',
            attr: {
                type: 'button',
                'aria-label': 'Delete selected transactions',
                title: 'Delete selected transactions'
            }
        });
        createDashboardSvgIcon(deleteButton, '14', '2.2', [
            { tag: 'polyline', attributes: { points: '3 6 5 6 21 6' } },
            { tag: 'path', attributes: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' } },
            { tag: 'line', attributes: { x1: '10', y1: '11', x2: '10', y2: '17' } },
            { tag: 'line', attributes: { x1: '14', y1: '11', x2: '14', y2: '17' } }
        ], true);
        deleteButton.addEventListener('click', () => {
            void this.deleteSelectedTransactions(selectedTransactions);
        });
    }

    private syncOverviewBulkSelectionFooter() {
        const container = this.containerEl.querySelector<HTMLElement>('.expensica-recent-transactions-section');
        if (!container) {
            return;
        }

        this.renderTransactionBulkFooter(container);
    }

    private maybeShowMixedTransactionTypeSelectionNotice() {
        const selectedTransactions = this.transactions.filter(transaction => this.selectedTransactionIds.has(transaction.id));
        const hasMixedTypes = new Set(selectedTransactions.map(transaction => transaction.type)).size > 1;
        if (hasMixedTypes) {
            showExpensicaNotice('You can only change one transaction type at a time: Income or Expenses.');
        }
    }

    private async bulkRenameSelectedTransactions(name: string) {
        const selectedTransactions = this.transactions.filter(transaction => this.selectedTransactionIds.has(transaction.id));
        if (selectedTransactions.length === 0) {
            return;
        }

        await this.plugin.updateTransactions(selectedTransactions.map(transaction => transaction.id), { description: name }, this);

        await this.loadTransactionsData();
        this.requestAllChartAnimations();
        this.renderDashboard();
        showExpensicaNotice('Transactions renamed successfully');
    }

    private syncOverviewVisibleTransactionSelectionState() {
        this.containerEl.querySelectorAll<HTMLElement>('.expensica-transaction[data-transaction-id]').forEach(card => {
            const transactionId = card.getAttribute('data-transaction-id');
            const isSelected = !!transactionId && this.selectedTransactionIds.has(transactionId);
            card.toggleClass('is-selected', isSelected);

            const selector = card.querySelector<HTMLElement>('.expensica-transaction-selector');
            selector?.toggleClass('is-selected', isSelected);
            selector?.setAttribute('aria-pressed', String(isSelected));
        });
    }

    private renderViewAllTransactionsButton(container: HTMLElement, extraClass = '') {
        const viewAllBtn = container.createEl('button', {
            cls: `expensica-standard-button expensica-view-all-btn ${extraClass}`.trim(),
            attr: { 'aria-label': 'View all transactions' }
        });
        viewAllBtn.textContent = 'View All';
        viewAllBtn.addEventListener('click', () => {
            void this.plugin.openTransactionsView();
        });
    }

    renderTransactionGroupTitle(container: HTMLElement, text: string, level: 'month' | 'day') {
        const headingLevel = level === 'month' ? 'h2' : 'h3';
        const titleEl = container.createEl(headingLevel, {
            cls: `expensica-transaction-group-title expensica-transaction-group-title-${level}`
        });

        if (level === 'day') {
            const iconEl = titleEl.createSpan('expensica-transaction-group-title-icon');
            createDashboardSvgIcon(iconEl, '12', '2', [
                { tag: 'rect', attributes: { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' } },
                { tag: 'line', attributes: { x1: '16', y1: '2', x2: '16', y2: '6' } },
                { tag: 'line', attributes: { x1: '8', y1: '2', x2: '8', y2: '6' } },
                { tag: 'line', attributes: { x1: '3', y1: '10', x2: '21', y2: '10' } }
            ]);
        }

        titleEl.createSpan({
            text,
            cls: 'expensica-transaction-group-title-text'
        });
    }

    getTransactionMonthKey(transaction: Transaction): string {
        const date = parseLocalDate(transaction.date);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    getTransactionDayKey(transaction: Transaction): string {
        return formatDate(parseLocalDate(transaction.date));
    }

    getTransactionMonthLabel(transaction: Transaction): string {
        return parseLocalDate(transaction.date).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });
    }

    getTransactionDayLabel(transaction: Transaction): string {
        return parseLocalDate(transaction.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }

    getTextColor(): string {
        const fallback = this.isDarkTheme()
            ? 'rgba(255, 255, 255, 0.88)'
            : 'rgba(0, 0, 0, 0.78)';
        return this.getThemeColorWithAlpha('--text-normal', fallback, 1);
    }

    getChartHelperTextColor(): string {
        const fallback = this.isDarkTheme()
            ? 'rgba(255, 255, 255, 0.42)'
            : 'rgba(0, 0, 0, 0.38)';
        return this.getThemeColorWithAlpha('--text-faint', fallback, 1);
    }

    shouldShowChartAxes(): boolean {
        return this.plugin.settings.showChartAxes;
    }

    shouldShowChartGrid(): boolean {
        return this.plugin.settings.showChartGrid;
    }

    getGridColor(): string {
        const fallback = this.isDarkTheme()
            ? 'rgba(255, 255, 255, 1)'
            : 'rgba(0, 0, 0, 1)';
        return this.getThemeColorWithAlpha('--text-normal', fallback, 0.14);
    }

    getTooltipBackgroundColor(): string {
        return this.getThemeColor('--background-secondary', getComputedStyle(document.body).backgroundColor);
    }

    getTooltipTitleColor(): string {
        return this.getThemeColor('--text-normal', getComputedStyle(document.body).color);
    }

    getTooltipBodyColor(): string {
        return this.getThemeColor('--text-muted', this.getTooltipTitleColor());
    }

    getTooltipBorderColor(): string {
        return this.getThemeColor('--background-modifier-border', this.getGridColor());
    }

    setupThemeObserver() {
        if (this.themeObserver) {
            this.themeObserver.disconnect();
        }

        this.lastThemeSignature = this.getThemeSignature();

        this.themeObserver = new MutationObserver(() => {
            const themeSignature = this.getThemeSignature();
            if (themeSignature === this.lastThemeSignature) {
                return;
            }

            this.lastThemeSignature = themeSignature;

            if (this.themeRefreshTimeout !== null) {
                window.clearTimeout(this.themeRefreshTimeout);
            }

            this.themeRefreshTimeout = window.setTimeout(() => {
                this.themeRefreshTimeout = null;
                this.pendingThemeRefresh = true;

                if (this.isDashboardVisible()) {
                    this.pendingThemeRefresh = false;
                    this.refreshCurrentTabContent();
                }
            }, 120);
        });

        this.themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    private getThemeSignature(): string {
        const body = document.body;
        const themeMode = body.classList.contains('theme-light')
            ? 'light'
            : body.classList.contains('theme-dark')
                ? 'dark'
                : 'unknown';

        return JSON.stringify({
            themeMode,
            accentColor: getComputedStyle(body).getPropertyValue('--interactive-accent').trim()
        });
    }

    isDarkTheme(): boolean {
        if (document.body.classList.contains('theme-light')) {
            return false;
        }

        if (document.body.classList.contains('theme-dark')) {
            return true;
        }

        const backgroundColor = this.getThemeColor('--background-primary', getComputedStyle(document.body).backgroundColor);
        const rgbMatch = backgroundColor.match(/rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/);
        if (!rgbMatch) {
            return false;
        }

        const red = parseFloat(rgbMatch[1]);
        const green = parseFloat(rgbMatch[2]);
        const blue = parseFloat(rgbMatch[3]);
        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        return luminance < 128;
    }

    getThemeColor(variableName: string, fallback: string): string {
        const value = getComputedStyle(document.body).getPropertyValue(variableName).trim();
        if (!value) {
            return fallback;
        }

        return this.resolveCssColor(`var(${variableName})`, fallback);
    }

    getThemeColorWithAlpha(variableName: string, fallback: string, alpha: number): string {
        return this.withAlpha(this.getThemeColor(variableName, fallback), alpha);
    }

    resolveCssColor(color: string, fallback: string): string {
        const probe = document.body.createSpan();
        probe.setCssStyles({ color: fallback });
        probe.setCssStyles({ color });
        probe.setCssStyles({ display: 'none' });
        const resolvedColor = getComputedStyle(probe).color;
        probe.remove();
        return resolvedColor && resolvedColor !== 'rgba(0, 0, 0, 0)' ? resolvedColor : fallback;
    }

    withAlpha(color: string, alpha: number): string {
        const rgbMatch = color.match(/rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/);
        if (rgbMatch) {
            return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
        }

        const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hexMatch) {
            const hex = hexMatch[1].length === 3
                ? hexMatch[1].split('').map((value) => value + value).join('')
                : hexMatch[1];
            const red = parseInt(hex.slice(0, 2), 16);
            const green = parseInt(hex.slice(2, 4), 16);
            const blue = parseInt(hex.slice(4, 6), 16);
            return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        }

        return color;
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

        const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
        if (hexMatch) {
            const hex = hexMatch[1];
            const red = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount));
            const green = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount));
            const blue = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount));
            return `#${this.toHex(red)}${this.toHex(green)}${this.toHex(blue)}`;
        }

        return color;
    }

    private toHex(value: number): string {
        return value.toString(16).padStart(2, '0');
    }

    // New method to render premium visualizations
    private renderPremiumVisualizations(container: HTMLElement) {
        // Add section title
        const premiumSection = container.createDiv('expensica-section expensica-animate');

        // Container for premium visualizations
        const vizContainer = premiumSection.createDiv('expensica-premium-visualizations');

        // Initialize or update premium visualizations
        if (!this.premiumVisualizations) {
            this.premiumVisualizations = new PremiumVisualizations(
                vizContainer,
                this.plugin,
                this.currentDate,
                this.selectedCalendarDate,
                (selectedDate) => {
                    this.selectedCalendarDate = selectedDate;
                    this.currentDate = selectedDate;
                    this.persistDashboardState();
                },
                () => {
                    void this.handleCalendarTodayClick();
                },
                (transaction) => {
                    this.openTransactionModal(transaction);
                }
            );
            this.premiumVisualizations.render();
        } else {
            vizContainer.empty();
            this.premiumVisualizations = new PremiumVisualizations(
                vizContainer,
                this.plugin,
                this.currentDate,
                this.selectedCalendarDate,
                (selectedDate) => {
                    this.selectedCalendarDate = selectedDate;
                    this.currentDate = selectedDate;
                    this.persistDashboardState();
                },
                () => {
                    void this.handleCalendarTodayClick();
                },
                (transaction) => {
                    this.openTransactionModal(transaction);
                }
            );
            this.premiumVisualizations.render();
        }
    }

    private openTransactionModal(transaction: Transaction) {
        const modal = new TransactionModal(this.app, this.plugin, this, transaction, transaction.type);
        modal.open();
    }

    // Show budget tab
    showBudgetTab() {
        // Only switch to budget tab if budgeting is enabled
        if (this.plugin.settings.enableBudgeting) {
            this.switchDashboardTab(DashboardTab.BUDGET);
        } else {
            // If budgeting is disabled, stay on overview tab
            this.switchDashboardTab(DashboardTab.OVERVIEW);
            
            // Show a notice that budgeting is disabled
            showExpensicaNotice('Budgeting is disabled. Enable it in settings to use budget features.');
        }
    }
}

// Date Range Picker Modal
export class DateRangePickerModal extends Modal {
    startDate: Date;
    endDate: Date;
    onConfirm: (startDate: Date, endDate: Date) => void | Promise<void>;
    private dateSelector: DateSelectorModal | null = null;
    private dismissed = false;

    constructor(
        app: App,
        startDate: Date,
        endDate: Date,
        onConfirm: (startDate: Date, endDate: Date) => void | Promise<void>
    ) {
        super(app);
        this.startDate = startDate;
        this.endDate = endDate;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        this.dismissed = false;
        const {contentEl} = this;
        
        contentEl.empty();
        contentEl.addClass('expensica-modal');
        
        // Modal title
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.createSpan({ text: '📅', cls: 'expensica-modal-title-icon' });
        modalTitle.createSpan({ text: ' Custom Date Range' });
        
        // Create form container
        const form = contentEl.createDiv('expensica-form');
        
        const startDateInput = this.createDateField(form, 'Start Date', 'start-date', this.startDate);
        const endDateInput = this.createDateField(form, 'End Date', 'end-date', this.endDate);
        
        // Button container
        const buttonContainer = form.createDiv('expensica-form-footer');
        
        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        
        // Apply button
        const applyButton = buttonContainer.createEl('button', {
            text: 'Apply',
            cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
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
                const start = parseLocalDate(startDateValue);
                const end = parseLocalDate(endDateValue);
                
                // Validate dates
                if (start > end) {
                    showExpensicaNotice('Start date cannot be after end date');
                    return;
                }
                
                handleDashboardAsync('Apply custom date range', async () => {
                    await this.onConfirm(start, end);
                });
                this.close();
            } else {
                showExpensicaNotice('Please select both start and end dates');
            }
        });
    }

    private createDateField(form: HTMLElement, label: string, id: string, date: Date): HTMLInputElement {
        const group = form.createDiv('expensica-form-group');
        group.createEl('label', { text: label, cls: 'expensica-form-label', attr: { for: id } });
        const input = group.createEl('input', { attr: { type: 'hidden', name: id, value: formatDate(date) } });
        const button = group.createEl('button', {
            cls: 'expensica-form-input expensica-edit-field expensica-date-field',
            attr: { type: 'button', id, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }
        });
        const icon = button.createSpan({ cls: 'expensica-date-field-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(icon, 'calendar');
        const text = button.createSpan('expensica-date-field-label');
        const updateDisplay = () => {
            text.textContent = formatDateForDisplay(input.value);
            button.setAttribute('aria-label', `Choose ${label.toLowerCase()}, ${text.textContent}`);
        };
        updateDisplay();
        button.addEventListener('click', () => {
            if (this.dateSelector || this.dismissed) return;
            const selector = new DateSelectorModal(this.app, input.value, value => {
                if (this.dismissed) return;
                input.value = value;
                updateDisplay();
            }, () => {
                if (this.dateSelector !== selector) return;
                this.dateSelector = null;
                button.setAttribute('aria-expanded', 'false');
                if (button.isConnected) button.focus();
            });
            this.dateSelector = selector;
            button.setAttribute('aria-expanded', 'true');
            selector.open();
        });
        return input;
    }

    onClose() {
        this.dismissed = true;
        const selector = this.dateSelector;
        this.dateSelector = null;
        selector?.close();
        this.contentEl.empty();
    }
}

// Transaction modal base class
export class TransactionModal extends Modal {
    plugin: ExpensicaPlugin;
    dashboardView: ExpensicaDashboardView;
    transaction: Transaction | null;
    defaultType: TransactionType;
    private discardConfirmation: ConfirmationModal | null = null;
    private dateSelector: DateSelectorModal | null = null;
    private timeSelector: TimeSelectorModal | null = null;
    private hasUnsavedChanges = () => false;

    constructor(app: App, plugin: ExpensicaPlugin, dashboardView: ExpensicaDashboardView, transaction: Transaction | null = null, defaultType: TransactionType = plugin.settings.lastTransactionSelection.type || TransactionType.EXPENSE) {
        super(app);
        this.plugin = plugin;
        this.dashboardView = dashboardView;
        this.transaction = transaction;
        this.defaultType = transaction?.type || defaultType;
        if (!transaction && this.defaultType === TransactionType.INTERNAL
            && (!plugin.settings.enableAccounts || plugin.getAccounts().length < 2)) {
            this.defaultType = TransactionType.EXPENSE;
        }
    }

    getTitle(): string {
        return this.transaction ? 'Edit Transaction' : 'New Transaction';
    }

    getTransactionType(): TransactionType {
        return this.defaultType;
    }

    getCategoryType(): CategoryType {
        return getCategoryTypeForTransactionType(this.getTransactionType());
    }

    getModalIcon(): string {
        return this.getTransactionType() === TransactionType.EXPENSE ?
            '💸' : '💰';
    }

    open() {
        if (this.plugin.canEditData(this.transaction ? ['transactions'] : ['transactions', 'accounts'])) super.open();
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-transaction-modal');
        contentEl.addClass('expensica-modal');

        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.createSpan({ text: this.getModalIcon(), cls: 'expensica-modal-title-icon' });
        modalTitle.createSpan({ text: ` ${this.getTitle()}` });

        const form = contentEl.createEl('form', {
            cls: 'expensica-form',
            attr: { novalidate: 'novalidate' }
        });
        const closeModalSelectMenus = () => {
            form.querySelectorAll<HTMLElement>('.expensica-select-options').forEach(menu => menu.addClass('expensica-select-hidden'));
        };

        // Description
        const descGroup = form.createDiv('expensica-form-group');
        descGroup.createEl('label', {
            text: 'Description',
            cls: 'expensica-form-label',
            attr: { for: 'description' }
        });
        const descInput = descGroup.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field',
            attr: {
                type: 'text',
                id: 'description',
                name: 'description',
                placeholder: 'Enter a description',
                required: 'required'
            }
        });

        // Amount + type
        const amountRow = form.createDiv('expensica-form-row');
        const amountGroup = amountRow.createDiv('expensica-form-group');
        amountGroup.createEl('label', {
            text: 'Amount',
            cls: 'expensica-form-label',
            attr: { for: 'amount' }
        });
        const amountInputWrapper = amountGroup.createDiv('expensica-currency-input');
        amountInputWrapper.createSpan({
            text: formatCurrency(0, this.plugin.settings.defaultCurrency, false, { currencyOnly: true }),
            cls: 'expensica-currency-symbol'
        });
        const amountInput = amountInputWrapper.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field',
            attr: {
                type: 'number',
                id: 'amount',
                name: 'amount',
                placeholder: 'Enter amount',
                step: 'any',
                min: '0',
                required: 'required'
            }
        });

        let selectedTransactionType = this.getTransactionType();
        const lastSelection = this.plugin.settings.lastTransactionSelection;
        const availableAccounts = this.plugin.getAccounts();
        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const lastSelectedAccount = this.plugin.settings.enableAccounts
            ? availableAccounts.find(account => account.id === lastSelection.accountId)
            : undefined;
        const secondAccount = availableAccounts.find(account =>
            formatAccountReference(account.type, account.name) !== defaultAccountReference
        );
        const secondAccountReference = secondAccount
            ? formatAccountReference(secondAccount.type, secondAccount.name)
            : defaultAccountReference;
        let selectedAccountReference = this.transaction
            ? this.plugin.normalizeTransactionAccountReference(this.transaction.account)
            : lastSelectedAccount
                ? formatAccountReference(lastSelectedAccount.type, lastSelectedAccount.name)
                : defaultAccountReference;
        let selectedFromAccountReference = this.transaction?.fromAccount
            ? this.plugin.normalizeTransactionAccountReference(this.transaction.fromAccount)
            : defaultAccountReference;
        let selectedToAccountReference = this.transaction?.toAccount
            ? this.plugin.normalizeTransactionAccountReference(this.transaction.toAccount)
            : secondAccountReference;
        const initialAccountReference = selectedAccountReference;
        const initialFromAccountReference = selectedFromAccountReference;
        const initialToAccountReference = selectedToAccountReference;

        if (!this.transaction && selectedFromAccountReference === selectedToAccountReference) {
            const fallbackToReference = availableAccounts.find(account =>
                formatAccountReference(account.type, account.name) !== selectedFromAccountReference
            );
            if (fallbackToReference) {
                selectedToAccountReference = formatAccountReference(fallbackToReference.type, fallbackToReference.name);
            }
        }

        const typeOptions = [
            { value: TransactionType.EXPENSE, label: 'Expense' },
            { value: TransactionType.INCOME, label: 'Income' }
        ];
        const canUseInternalTransactions = this.plugin.settings.enableAccounts && availableAccounts.length > 1;
        if (canUseInternalTransactions) {
            typeOptions.push({ value: TransactionType.INTERNAL, label: 'Internal' });
        }
        const typeGroup = amountRow.createDiv('expensica-form-group');
        typeGroup.createEl('label', {
            text: 'Type',
            cls: 'expensica-form-label',
            attr: { for: 'transaction-type' }
        });
        const typeSelectContainer = typeGroup.createDiv('expensica-custom-select-container');
        const hiddenTypeSelect = typeSelectContainer.createEl('select', {
            cls: 'expensica-form-select hidden-select',
            attr: { id: 'transaction-type', name: 'transaction-type' }
        });
        const typeDisplay = typeSelectContainer.createEl('button', {
            cls: 'expensica-select-display expensica-edit-field',
            attr: {
                type: 'button',
                'aria-label': 'Choose type'
            }
        });
        const typeDisplayText = typeDisplay.createSpan('expensica-select-display-text');
        const typeDropdownIcon = typeDisplay.createSpan('expensica-select-arrow');
        appendChevronIcon(typeDropdownIcon, '16');
        const typeOptionsMenu = typeSelectContainer.createDiv('expensica-select-options expensica-select-hidden');
        const updateTypeSelection = (type: TransactionType) => {
            const option = typeOptions.find(item => item.value === type);
            typeDisplayText.textContent = option?.label || '';
            typeOptionsMenu.querySelectorAll('.expensica-select-option').forEach(optionEl => {
                optionEl.removeClass('expensica-option-selected');
            });
            typeOptionsMenu.querySelector(`[data-transaction-type="${type}"]`)?.addClass('expensica-option-selected');
            typeOptionsMenu.addClass('expensica-select-hidden');
        };
        hiddenTypeSelect.addEventListener('change', () => {
            selectedTransactionType = hiddenTypeSelect.value as TransactionType;
            updateTypeSelection(selectedTransactionType);
            syncTransactionTypeVisibility();
        });
        typeOptions.forEach(option => {
            hiddenTypeSelect.createEl('option', {
                text: option.label,
                attr: { value: option.value }
            });
            const optionEl = typeOptionsMenu.createDiv({ cls: 'expensica-select-option' });
            optionEl.setAttribute('data-transaction-type', option.value);
            optionEl.textContent = option.label;
            optionEl.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                hiddenTypeSelect.value = option.value;
                hiddenTypeSelect.dispatchEvent(new Event('change'));
            });
        });
        hiddenTypeSelect.value = selectedTransactionType;
        updateTypeSelection(selectedTransactionType);
        typeDisplay.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const willOpen = typeOptionsMenu.hasClass('expensica-select-hidden');
            closeModalSelectMenus();
            if (willOpen) {
                typeOptionsMenu.removeClass('expensica-select-hidden');
            }
        });
        typeOptionsMenu.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        // Date and time
        const dateTimeRow = form.createDiv('expensica-form-row');
        const dateGroup = dateTimeRow.createDiv('expensica-form-group');
        dateGroup.createEl('label', {
            text: 'Date',
            cls: 'expensica-form-label',
            attr: { for: 'date' }
        });
        const dateInput = dateGroup.createEl('input', {
            attr: {
                type: 'hidden',
                name: 'date'
            }
        });
        const dateButton = dateGroup.createEl('button', {
            cls: 'expensica-form-input expensica-edit-field expensica-date-field',
            attr: {
                type: 'button',
                id: 'date',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false'
            }
        });
        const dateIcon = dateButton.createSpan({
            cls: 'expensica-date-field-icon',
            attr: { 'aria-hidden': 'true' }
        });
        setIcon(dateIcon, 'calendar');
        const dateLabel = dateButton.createSpan('expensica-date-field-label');
        const updateDateDisplay = () => {
            dateLabel.textContent = formatDateForDisplay(dateInput.value);
            dateButton.setAttribute('aria-label', `Choose date, ${dateLabel.textContent}`);
        };
        dateButton.addEventListener('click', () => {
            if (this.dateSelector) return;
            closeModalSelectMenus();
            const selector = new DateSelectorModal(
                this.app,
                dateInput.value,
                (date) => {
                    dateInput.value = date;
                    updateDateDisplay();
                },
                () => {
                    if (this.dateSelector !== selector) return;
                    this.dateSelector = null;
                    dateButton.setAttribute('aria-expanded', 'false');
                    if (dateButton.isConnected) dateButton.focus();
                }
            );
            this.dateSelector = selector;
            dateButton.setAttribute('aria-expanded', 'true');
            selector.open();
        });
        const timeGroup = dateTimeRow.createDiv('expensica-form-group');
        timeGroup.createEl('label', {
            text: 'Time',
            cls: 'expensica-form-label',
            attr: { for: 'time' }
        });
        const timeInput = timeGroup.createEl('input', {
            attr: {
                type: 'hidden',
                name: 'time'
            }
        });
        const timeButton = timeGroup.createEl('button', {
            cls: 'expensica-form-input expensica-edit-field expensica-time-field',
            attr: {
                type: 'button',
                id: 'time',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false'
            }
        });
        const timeIcon = timeButton.createSpan({
            cls: 'expensica-time-field-icon',
            attr: { 'aria-hidden': 'true' }
        });
        setIcon(timeIcon, 'clock');
        const timeLabel = timeButton.createSpan('expensica-time-field-label');
        const updateTimeDisplay = () => {
            timeLabel.textContent = formatTimeForDisplay(timeInput.value, this.plugin.settings.timeFormat);
            timeButton.setAttribute('aria-label', `Choose time, ${timeLabel.textContent}`);
        };
        timeButton.addEventListener('click', () => {
            if (this.timeSelector) return;
            closeModalSelectMenus();
            const selector = new TimeSelectorModal(
                this.app,
                timeInput.value,
                this.plugin.settings.timeFormat,
                (time) => {
                    timeInput.value = time;
                    updateTimeDisplay();
                },
                () => {
                    if (this.timeSelector !== selector) return;
                    this.timeSelector = null;
                    timeButton.setAttribute('aria-expanded', 'false');
                    if (timeButton.isConnected) timeButton.focus();
                }
            );
            this.timeSelector = selector;
            timeButton.setAttribute('aria-expanded', 'true');
            selector.open();
        });

        const taxonomyRow = form.createDiv('expensica-form-row');
        let accountGroup: HTMLDivElement | null = null;
        let hiddenAccountSelect: HTMLSelectElement | null = null;

        // Category - Custom implementation for better visibility
        const categoryGroup = taxonomyRow.createDiv('expensica-form-group');
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
        const categoryDisplay = categorySelectContainer.createEl('button', {
            cls: 'expensica-select-display expensica-edit-field',
            attr: {
                type: 'button',
                'aria-label': 'Choose category'
            }
        });
        const categoryDisplayText = categoryDisplay.createSpan('expensica-select-display-text');
        const dropdownIcon = categoryDisplay.createSpan('expensica-select-arrow');
        appendChevronIcon(dropdownIcon, '16');

        // Check if we need to show a warning about deleted category
        let categoryWarning: HTMLDivElement | null = null;
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

        const isLockedInternalTransaction = !this.plugin.settings.enableAccounts
            && this.transaction?.type === TransactionType.INTERNAL;

        const getAvailableCategories = () => this.plugin
            .getCategories(getCategoryTypeForTransactionType(selectedTransactionType))
            .filter(category => category.id !== INTERNAL_CATEGORY_ID);

        const updateCategorySelection = (categoryId: string) => {
            const category = this.plugin.getCategoryById(categoryId);
            if (!category) {
                return;
            }

            selectedCategoryId = category.id;
            hiddenCategorySelect.value = category.id;
            categoryDisplayText.empty();
            categoryDisplayText.createSpan({
                text: this.plugin.getCategoryEmoji(category.id),
                cls: 'expensica-category-emoji'
            });
            categoryDisplayText.createSpan({ text: ` ${category.name}` });

            if (categoryWarning) {
                categoryWarning.remove();
                categoryWarning = null;
            }
        };

        const syncCategoryOptions = () => {
            hiddenCategorySelect.empty();

            if (selectedTransactionType === TransactionType.INTERNAL || isLockedInternalTransaction) {
                selectedCategoryId = INTERNAL_CATEGORY_ID;
                selectedCategoryLabel = 'Internal';
                selectedCategoryEmoji = this.plugin.getCategoryEmoji(INTERNAL_CATEGORY_ID);
                hiddenCategorySelect.createEl('option', {
                    text: 'Internal',
                    attr: { value: INTERNAL_CATEGORY_ID }
                });
                hiddenCategorySelect.value = INTERNAL_CATEGORY_ID;
                categoryDisplayText.empty();
                categoryDisplayText.createSpan({
                    text: selectedCategoryEmoji,
                    cls: 'expensica-category-emoji'
                });
                categoryDisplayText.createSpan({ text: ` ${selectedCategoryLabel}` });
                return;
            }

            const categories = getAvailableCategories();
            categories.forEach(category => {
                hiddenCategorySelect.createEl('option', {
                    text: category.name,
                    attr: { value: category.id }
                });
            });

            const currentCategory = this.plugin.getCategoryById(selectedCategoryId);
            const currentCategoryMatchesType = currentCategory && currentCategory.type === getCategoryTypeForTransactionType(selectedTransactionType);

            if (!currentCategoryMatchesType) {
                selectedCategoryId = getDefaultTransactionCategory(selectedTransactionType, this.plugin.getCategories());
            }

            if (selectedCategoryId && hiddenCategorySelect.querySelector(`option[value="${selectedCategoryId}"]`)) {
                updateCategorySelection(selectedCategoryId);
            } else {
                const fallbackCategoryId = categories[0]?.id || '';
                if (fallbackCategoryId) {
                    updateCategorySelection(fallbackCategoryId);
                } else {
                    categoryDisplayText.textContent = 'Select a category';
                }
            }
        };

        if (selectedTransactionType === TransactionType.INTERNAL || isLockedInternalTransaction) {
            selectedCategoryId = INTERNAL_CATEGORY_ID;
        } else if (this.transaction && this.plugin.getCategoryById(this.transaction.category)?.type === getCategoryTypeForTransactionType(selectedTransactionType)) {
            selectedCategoryId = this.transaction.category;
        } else {
            selectedCategoryId = (!this.transaction && lastSelection.category)
                || getDefaultTransactionCategory(selectedTransactionType, this.plugin.getCategories());
        }

        syncCategoryOptions();

        let categoryMenuOpen = false;
        const syncCategoryMenuState = () => {
            categoryMenuOpen = !!document.querySelector('.expensica-category-quick-menu');
        };

        categoryDisplay.addEventListener('click', (event) => {
            event.preventDefault();
            if (isLockedInternalTransaction || selectedTransactionType === TransactionType.INTERNAL) {
                return;
            }
            closeModalSelectMenus();
            if (categoryMenuOpen) {
                const syntheticOutsideTarget = document.body.createDiv();
                syntheticOutsideTarget.setCssStyles({
                    position: 'fixed',
                    left: '0',
                    top: '0',
                    width: '1px',
                    height: '1px',
                    pointerEvents: 'none'
                });
                syntheticOutsideTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                syntheticOutsideTarget.remove();
                syncCategoryMenuState();
                window.setTimeout(() => categoryDisplay.focus(), 0);
                return;
            }

            showCategoryQuickMenu(categoryDisplay, this.plugin, getCategoryTypeForTransactionType(selectedTransactionType), async (categoryId) => {
                if (!hiddenCategorySelect.querySelector(`option[value="${categoryId}"]`)) {
                    const category = this.plugin.getCategoryById(categoryId);
                    if (category) {
                        hiddenCategorySelect.createEl('option', {
                            text: category.name,
                            attr: { value: category.id }
                        });
                    }
                }

                updateCategorySelection(categoryId);
                syncCategoryMenuState();
                window.setTimeout(() => categoryDisplay.focus(), 0);
            }, hiddenCategorySelect.value || undefined);
            window.setTimeout(() => {
                syncCategoryMenuState();
                document.querySelector<HTMLInputElement>('.expensica-category-quick-menu-search-input')?.focus();
            }, 0);
        });

        categoryDisplay.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });

        if (this.plugin.settings.enableAccounts) {
            accountGroup = taxonomyRow.createDiv('expensica-form-group');
            accountGroup.createEl('label', {
                text: 'Account',
                cls: 'expensica-form-label',
                attr: { for: 'account' }
            });

            const accountSelectContainer = accountGroup.createDiv('expensica-custom-select-container');
            hiddenAccountSelect = accountSelectContainer.createEl('select', {
                cls: 'expensica-form-select hidden-select',
                attr: {
                    id: 'account',
                    name: 'account',
                    required: 'required'
                }
            });
            const accountSelect = hiddenAccountSelect;
            const accountDisplay = accountSelectContainer.createEl('button', {
                cls: 'expensica-select-display expensica-edit-field',
                attr: {
                    type: 'button',
                    'aria-label': 'Choose account'
                }
            });
            const accountDisplayText = accountDisplay.createSpan('expensica-select-display-text');
            const accountDropdownIcon = accountDisplay.createSpan('expensica-select-arrow');
            appendChevronIcon(accountDropdownIcon, '16');
            const accountOptionsMenu = accountSelectContainer.createDiv('expensica-select-options expensica-select-hidden');

            const accountOptions = [...this.plugin.getAccounts()];
            const selectedAccount = this.plugin.findAccountByReference(selectedAccountReference);
            if (!selectedAccount) {
                const parsedAccount = parseAccountReference(selectedAccountReference);
                accountOptions.push({
                    id: `virtual-${selectedAccountReference}`,
                    name: parsedAccount.name,
                    type: parsedAccount.type,
                    createdAt: new Date().toISOString()
                });
            }

            const updateAccountSelection = (accountReference: string) => {
                const parsedAccount = parseAccountReference(accountReference);
                selectedAccountReference = formatAccountReference(parsedAccount.type, parsedAccount.name);
                accountSelect.value = selectedAccountReference;
                accountDisplayText.empty();
                appendCreditCardIcon(accountDisplayText);
                accountDisplayText.createSpan({ text: ` ${parsedAccount.name} · ${getAccountTypeLabel(parsedAccount.type)}` });
                const account = accountOptions.find(option =>
                    formatAccountReference(option.type, option.name) === selectedAccountReference
                );
                accountDisplayText.setCssStyles({ color: account ? getAccountColor(account, availableAccounts) : '' });
                accountOptionsMenu.querySelectorAll('.expensica-select-option').forEach(option => {
                    option.removeClass('expensica-option-selected');
                });
                accountOptionsMenu.querySelector(`[data-account-reference="${accountSelect.value}"]`)?.addClass('expensica-option-selected');
                accountOptionsMenu.addClass('expensica-select-hidden');
            };

            accountOptions.forEach(account => {
                const accountReference = formatAccountReference(account.type, account.name);
                accountSelect.createEl('option', {
                    text: `${account.name} · ${getAccountTypeLabel(account.type)}`,
                    attr: { value: accountReference }
                });

                const optionEl = accountOptionsMenu.createDiv({ cls: 'expensica-select-option' });
                optionEl.setAttribute('data-account-reference', accountReference);
                appendCreditCardIcon(optionEl);
                optionEl.createSpan({ text: ` ${account.name} · ${getAccountTypeLabel(account.type)}` });
                optionEl.setCssStyles({ color: getAccountColor(account, availableAccounts) });
                optionEl.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    updateAccountSelection(accountReference);
                });
            });

            updateAccountSelection(selectedAccountReference);

            accountDisplay.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const willOpen = accountOptionsMenu.hasClass('expensica-select-hidden');
                closeModalSelectMenus();
                if (willOpen) {
                    accountOptionsMenu.removeClass('expensica-select-hidden');
                }
            });

            accountOptionsMenu.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        }

        let fromAccountGroup: HTMLDivElement | null = null;
        let toAccountGroup: HTMLDivElement | null = null;
        let hiddenFromAccountSelect: HTMLSelectElement | null = null;
        let hiddenToAccountSelect: HTMLSelectElement | null = null;

        if (this.plugin.settings.enableAccounts) {
            const accountOptions = this.plugin.getAccounts();

            const createAccountTransferGroup = (label: string, id: string, onSelect: (reference: string) => void) => {
                const group = taxonomyRow.createDiv('expensica-form-group');
                group.createEl('label', {
                    text: label,
                    cls: 'expensica-form-label',
                    attr: { for: id }
                });
                const selectContainer = group.createDiv('expensica-custom-select-container');
                const select = selectContainer.createEl('select', {
                    cls: 'expensica-form-select hidden-select',
                    attr: { id, name: id }
                });
                const display = selectContainer.createEl('button', {
                    cls: 'expensica-select-display expensica-edit-field',
                    attr: {
                        type: 'button',
                        'aria-label': label
                    }
                });
                const displayText = display.createSpan('expensica-select-display-text');
                const displayArrow = display.createSpan('expensica-select-arrow');
                appendChevronIcon(displayArrow, '16');
                const optionsMenu = selectContainer.createDiv('expensica-select-options expensica-select-hidden');
                accountOptions.forEach(account => {
                    select.createEl('option', {
                        text: `${account.name} · ${getAccountTypeLabel(account.type)}`,
                        attr: { value: formatAccountReference(account.type, account.name) }
                    });
                    const reference = formatAccountReference(account.type, account.name);
                    const optionEl = optionsMenu.createDiv({ cls: 'expensica-select-option' });
                    optionEl.setAttribute(`data-${id}-reference`, reference);
                    appendCreditCardIcon(optionEl);
                    optionEl.createSpan({ text: ` ${account.name} · ${getAccountTypeLabel(account.type)}` });
                    optionEl.setCssStyles({ color: getAccountColor(account, availableAccounts) });
                    optionEl.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect(reference);
                    });
                });
                select.addEventListener('change', () => onSelect(select.value));
                const updateSelection = (reference: string) => {
                    select.value = reference;
                    const parsedAccount = parseAccountReference(reference);
                    displayText.empty();
                    appendCreditCardIcon(displayText);
                    displayText.createSpan({ text: ` ${parsedAccount.name} · ${getAccountTypeLabel(parsedAccount.type)}` });
                    const account = accountOptions.find(option =>
                        formatAccountReference(option.type, option.name) === reference
                    );
                    displayText.setCssStyles({ color: account ? getAccountColor(account, availableAccounts) : '' });
                    optionsMenu.querySelectorAll('.expensica-select-option').forEach(option => option.removeClass('expensica-option-selected'));
                    optionsMenu.querySelector(`[data-${id}-reference="${reference}"]`)?.addClass('expensica-option-selected');
                    optionsMenu.addClass('expensica-select-hidden');
                };
                display.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const willOpen = optionsMenu.hasClass('expensica-select-hidden');
                    closeModalSelectMenus();
                    if (willOpen) {
                        optionsMenu.removeClass('expensica-select-hidden');
                    }
                });
                optionsMenu.addEventListener('click', (event) => event.stopPropagation());
                return { group, select, updateSelection };
            };

            const fromGroupParts = createAccountTransferGroup('From Account', 'from-account', (reference) => {
                selectedFromAccountReference = reference;
                if (selectedFromAccountReference === selectedToAccountReference && hiddenToAccountSelect) {
                    const replacement = Array.from(hiddenToAccountSelect.options).find(option => option.value !== reference);
                    if (replacement) {
                        hiddenToAccountSelect.value = replacement.value;
                        selectedToAccountReference = replacement.value;
                        toGroupParts.updateSelection(replacement.value);
                    }
                }
                syncTransferAccountOptions();
                fromGroupParts.updateSelection(reference);
            });
            fromAccountGroup = fromGroupParts.group;
            hiddenFromAccountSelect = fromGroupParts.select;

            const toGroupParts = createAccountTransferGroup('To Account', 'to-account', (reference) => {
                selectedToAccountReference = reference;
                if (selectedToAccountReference === selectedFromAccountReference && hiddenFromAccountSelect) {
                    const replacement = Array.from(hiddenFromAccountSelect.options).find(option => option.value !== reference);
                    if (replacement) {
                        hiddenFromAccountSelect.value = replacement.value;
                        selectedFromAccountReference = replacement.value;
                        fromGroupParts.updateSelection(replacement.value);
                    }
                }
                syncTransferAccountOptions();
                toGroupParts.updateSelection(reference);
            });
            toAccountGroup = toGroupParts.group;
            hiddenToAccountSelect = toGroupParts.select;
            fromGroupParts.updateSelection(selectedFromAccountReference);
            toGroupParts.updateSelection(selectedToAccountReference);
        }

        function syncTransferAccountOptions() {
            if (!hiddenFromAccountSelect || !hiddenToAccountSelect) {
                return;
            }

            hiddenFromAccountSelect.value = selectedFromAccountReference;
            hiddenToAccountSelect.value = selectedToAccountReference;
        }

        const syncTransactionTypeVisibility = () => {
            const isInternalType = selectedTransactionType === TransactionType.INTERNAL;
            const isInternal = isInternalType && canUseInternalTransactions;
            if (fromAccountGroup) {
                fromAccountGroup.setCssStyles({ display: isInternal ? '' : 'none' });
            }
            if (toAccountGroup) {
                toAccountGroup.setCssStyles({ display: isInternal ? '' : 'none' });
            }
            if (accountGroup) {
                accountGroup.setCssStyles({ display: isInternal ? 'none' : '' });
            }
            categoryGroup.setCssStyles({ display: isInternal && !isLockedInternalTransaction ? 'none' : '' });
            categoryDisplay.disabled = isInternalType;
            hiddenCategorySelect.required = !isInternalType;
            if (hiddenAccountSelect) {
                hiddenAccountSelect.required = !isInternal;
            }
            if (hiddenFromAccountSelect) {
                hiddenFromAccountSelect.required = isInternal;
            }
            if (hiddenToAccountSelect) {
                hiddenToAccountSelect.required = isInternal;
            }
            if (isInternalType) {
                selectedCategoryId = INTERNAL_CATEGORY_ID;
                syncTransferAccountOptions();
            }
            syncCategoryOptions();
        };

        syncTransactionTypeVisibility();

        // Notes
        const notesGroup = form.createDiv('expensica-form-group');
        notesGroup.createEl('label', {
            text: 'Notes (optional)',
            cls: 'expensica-form-label',
            attr: { for: 'notes' }
        });
        const notesInput = notesGroup.createEl('textarea', {
            cls: 'expensica-form-textarea expensica-edit-field',
            attr: {
                id: 'notes',
                name: 'notes',
                placeholder: 'Additional notes'
            }
        });

        // Buttons
        const formFooter = form.createDiv('expensica-form-footer');
        let deleteBtn: HTMLButtonElement | null = null;
        if (this.transaction) {
            deleteBtn = formFooter.createEl('button', {
                text: 'Delete',
                cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid expensica-modal-delete-btn',
                attr: { type: 'button' }
            });
        }
        const cancelBtn = formFooter.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        const saveBtn = formFooter.createEl('button', {
            text: this.transaction ? 'Update' : 'Save',
            cls: `expensica-standard-button expensica-btn ${this.getTransactionType() === TransactionType.EXPENSE ? 'expensica-btn-danger' : 'expensica-btn-success'}`,
            attr: { type: 'submit' }
        });

        // Fill form with transaction data if editing
        if (this.transaction) {
            descInput.value = this.transaction.description;
            amountInput.value = this.transaction.amount.toString();
            dateInput.value = this.transaction.date.substring(0, 10); // YYYY-MM-DD
            timeInput.value = getTransactionDisplayTime(this.transaction) || formatTime().slice(0, 5);
            notesInput.value = this.transaction.notes || '';
        } else {
            // Set default date to the selected calendar day when available
            dateInput.value = formatDate(this.dashboardView.getDefaultTransactionDate?.() || new Date());
            timeInput.value = formatTime().slice(0, 5);
        }
        updateDateDisplay();
        updateTimeDisplay();

        const getFormValues = () => JSON.stringify(Array.from(
            form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'),
            field => field.value
        ));
        const initialValues = getFormValues();
        this.hasUnsavedChanges = () => getFormValues() !== initialValues;

        // Event listeners
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        deleteBtn?.addEventListener('click', voidAsync(async () => {
            if (!this.transaction) return;
            const closeEditor = () => this.close();
            await this.dashboardView.deleteTransaction(this.transaction.id, closeEditor, closeEditor);
        }));

        let saving = false;
        form.addEventListener('submit', voidAsync(async (e) => {
            e.preventDefault();
            await this.plugin.runSaveOperation(this, this.transaction ? 'Edit transaction' : 'Add transaction', async () => {
                if (!form.reportValidity()) return false;
                if (saving) return false;
                saving = true;
                saveBtn.disabled = true;
                try {
                    const showValidationError = (message: string, element?: HTMLElement | null) => {
                        showExpensicaNotice(message);
                        element?.focus();
                    };

                    if (!descInput.value.trim()) {
                        showValidationError('Please fill this field.', descInput);
                        return false;
                    }

                    if (!amountInput.value || !Number.isFinite(Number(amountInput.value)) || Number(amountInput.value) < 0) {
                        showValidationError('Please fill this field.', amountInput);
                        return false;
                    }

                    if (!dateInput.value) {
                        showValidationError('Please fill this field.', dateButton);
                        return false;
                    }

                    if (!timeInput.value) {
                        showValidationError('Please fill this field.', timeButton);
                        return false;
                    }

                    if (selectedTransactionType === TransactionType.INTERNAL && canUseInternalTransactions) {
                        if (!selectedFromAccountReference) {
                            showValidationError('Please fill this field.', fromAccountGroup);
                            return false;
                        }

                        if (!selectedToAccountReference) {
                            showValidationError('Please fill this field.', toAccountGroup);
                            return false;
                        }
                    } else {
                        if (!selectedCategoryId) {
                            showValidationError('Please fill this field.', categoryDisplay);
                            return false;
                        }

                        if (this.plugin.settings.enableAccounts && !selectedAccountReference) {
                            showValidationError('Please fill this field.', accountGroup);
                            return false;
                        }
                    }

                    const formData = new FormData(form);
                    const submittedTimeValue = formData.get('time') as string | null;
                    const submittedDisplayTime = submittedTimeValue || '';
                    const submittedTime = this.transaction && submittedDisplayTime === getTransactionFormTime(this.transaction)
                        ? getTransactionTime(this.transaction) || this.transaction.time || normalizeTransactionTime(submittedTimeValue)
                        : normalizeTransactionTime(submittedTimeValue);
                    const notes = formData.get('notes') as string || '';
                    const transaction: Transaction = {
                        ...this.transaction,
                        id: this.transaction ? this.transaction.id : generateId(),
                        date: formData.get('date') as string,
                        time: submittedTime,
                        type: selectedTransactionType,
                        amount: parseFloat(formData.get('amount') as string),
                        description: formData.get('description') as string,
                        category: selectedTransactionType === TransactionType.INTERNAL
                            ? INTERNAL_CATEGORY_ID
                            : ((formData.get('category') as string) || selectedCategoryId),
                        account: selectedTransactionType === TransactionType.INTERNAL
                            ? undefined
                            : (this.plugin.settings.enableAccounts
                                ? this.plugin.normalizeTransactionAccountReference(selectedAccountReference)
                                : (this.transaction?.account ? this.plugin.normalizeTransactionAccountReference(this.transaction.account) : this.plugin.normalizeTransactionAccountReference(undefined))),
                        fromAccount: selectedTransactionType === TransactionType.INTERNAL
                            ? this.plugin.normalizeTransactionAccountReference(selectedFromAccountReference)
                            : undefined,
                        toAccount: selectedTransactionType === TransactionType.INTERNAL
                            ? this.plugin.normalizeTransactionAccountReference(selectedToAccountReference)
                            : undefined
                    };
                    if (notes.trim()) transaction.notes = notes;
                    else delete transaction.notes;

                    if (this.transaction && this.plugin.isAccountDataProtected()) {
                        if (selectedAccountReference === initialAccountReference) transaction.account = this.transaction.account;
                        if (selectedFromAccountReference === initialFromAccountReference) transaction.fromAccount = this.transaction.fromAccount;
                        if (selectedToAccountReference === initialToAccountReference) transaction.toAccount = this.transaction.toAccount;
                    }
                    if (isSelfTransfer(transaction)) {
                        showValidationError('Transfer accounts must differ.', toAccountGroup);
                        return false;
                    }
                    if (!this.plugin.canSaveTransaction(transaction)) return false;
                    const existingTransactions = this.plugin.getAllTransactions();
                    const creditLimitExceededAccount = this.plugin.isAccountDataProtected() ? null
                        : getCreditLimitExceededAccount(this.plugin, transaction, existingTransactions);
                    if (creditLimitExceededAccount) {
                        showExpensicaNotice(`This transaction exceeds the credit limit for ${creditLimitExceededAccount.name}.`);
                        return false;
                    }

                    if (this.transaction) {
                        if (isSameTransactionEdit(this.transaction, transaction)) {
                            this.close();
                            return false;
                        }

                        await this.dashboardView.updateTransaction(transaction);
                    } else {
                        await this.dashboardView.addTransaction(transaction);
                    }

                    const selection = {
                        type: transaction.type,
                        category: transaction.category,
                        accountId: this.plugin.settings.enableAccounts && !this.plugin.isAccountDataProtected() && transaction.type !== TransactionType.INTERNAL
                            ? this.plugin.findAccountByReference(transaction.account)?.id ?? lastSelection.accountId
                            : lastSelection.accountId
                    };
                    if (Object.entries(selection).some(([key, value]) => lastSelection[key as keyof typeof selection] !== value)) {
                        this.plugin.settings.lastTransactionSelection = selection;
                        try {
                            await this.plugin.saveSettings(false);
                        } catch (error) {
                            console.error('Expensica: Could not save last transaction selection', error);
                            showExpensicaNotice('Transaction saved, but its last-used selection could not be saved.');
                        }
                    }

                    super.close();
                } finally {
                    saving = false;
                    saveBtn.disabled = false;
                }
            });
        }));
    }

    close() {
        if (this.transaction || !this.hasUnsavedChanges()) {
            super.close();
            return;
        }

        if (this.discardConfirmation) {
            return;
        }

        this.discardConfirmation = new ConfirmationModal(
            this.app,
            'Discard Transaction?',
            'This transaction has not been saved. Are you sure you want to discard it?',
            (confirmed) => {
                this.discardConfirmation = null;
                if (confirmed) {
                    super.close();
                }
            },
            'Discard'
        );
        this.discardConfirmation.open();
    }

    onClose() {
        this.plugin.releaseSaveOperation(this);
        this.hasUnsavedChanges = () => false;
        const dateSelector = this.dateSelector;
        this.dateSelector = null;
        dateSelector?.close();
        const timeSelector = this.timeSelector;
        this.timeSelector = null;
        timeSelector?.close();
        this.discardConfirmation?.close();
        this.discardConfirmation = null;
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

export class AccountModal extends Modal {
    plugin: ExpensicaPlugin;
    dashboardView: ExpensicaDashboardView;

    constructor(app: App, plugin: ExpensicaPlugin, dashboardView: ExpensicaDashboardView) {
        super(app);
        this.plugin = plugin;
        this.dashboardView = dashboardView;
    }

    open() {
        if (this.plugin.canEditData(['accounts'])) super.open();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-transaction-modal');
        contentEl.addClass('expensica-modal');
        contentEl.addClass('expensica-account-editor-modal');

        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.createSpan({ text: '🏦', cls: 'expensica-modal-title-icon' });
        modalTitle.createSpan({ text: ' Create new account' });

        const form = contentEl.createEl('form', { cls: 'expensica-form' });

        const nameGroup = form.createDiv('expensica-form-group');
        nameGroup.createEl('label', {
            text: 'Name',
            cls: 'expensica-form-label',
            attr: { for: 'account-name' }
        });
        const nameInput = nameGroup.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field',
            attr: {
                id: 'account-name',
                name: 'account-name',
                type: 'text',
                placeholder: 'Enter account name',
                required: 'required'
            }
        });

        const typeGroup = form.createDiv('expensica-form-group');
        typeGroup.createEl('label', {
            text: 'Account type',
            cls: 'expensica-form-label',
            attr: { for: 'account-type' }
        });
        const typeSelect = typeGroup.createEl('select', {
            cls: 'expensica-form-select expensica-edit-field',
            attr: {
                id: 'account-type',
                name: 'account-type',
                required: 'required'
            }
        });

        [
            { value: AccountType.CHEQUING, label: 'Chequing' },
            { value: AccountType.SAVING, label: 'Saving' },
            { value: AccountType.CREDIT, label: 'Credit' }
        ].forEach(option => {
            typeSelect.createEl('option', {
                text: option.label,
                attr: { value: option.value }
            });
        });

        const creditLimitGroup = form.createDiv('expensica-form-group is-hidden');
        creditLimitGroup.createEl('label', {
            text: 'Credit Limit',
            cls: 'expensica-form-label',
            attr: { for: 'credit-limit' }
        });
        const creditLimitInput = creditLimitGroup.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field',
            attr: {
                id: 'credit-limit',
                name: 'credit-limit',
                type: 'number',
                step: 'any',
                min: '0',
                placeholder: '0.00'
            }
        });

        const syncCreditLimitVisibility = () => {
            creditLimitGroup.toggleClass('is-hidden', (typeSelect.value as AccountType) !== AccountType.CREDIT);
        };
        typeSelect.addEventListener('change', syncCreditLimitVisibility);
        syncCreditLimitVisibility();

        const formFooter = form.createDiv('expensica-form-footer');
        const cancelBtn = formFooter.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        const saveAccountButton = formFooter.createEl('button', {
            text: 'Save',
            cls: 'expensica-standard-button expensica-btn expensica-btn-success',
            attr: { type: 'submit' }
        });

        cancelBtn.addEventListener('click', () => this.close());

        form.addEventListener('submit', voidAsync(async (event) => {
            event.preventDefault();
            await this.plugin.runSaveOperation(this, 'Add account', async () => {
                if (!form.reportValidity()) return false;

                if (saveAccountButton.disabled) return false;
                const accountName = normalizeAccountName(nameInput.value);
                if (!accountName) {
                    showExpensicaNotice('Account name is required');
                    return false;
                }

                const accountType = typeSelect.value as AccountType;
                const accountReference = formatAccountReference(accountType, accountName);
                if (this.plugin.findAccountByReference(accountReference)) {
                    showExpensicaNotice('Account already exists');
                    return false;
                }

                saveAccountButton.disabled = true;
                try {
                    await this.plugin.addAccount({
                        id: generateId(),
                        name: accountName,
                        type: accountType,
                        createdAt: new Date().toISOString(),
                        creditLimit: accountType === AccountType.CREDIT && creditLimitInput.value
                            ? Number(creditLimitInput.value)
                            : undefined
                    }, this.dashboardView);

                    await this.dashboardView.loadTransactionsData();
                    this.dashboardView.renderDashboard();
                    this.close();
                } finally {
                    saveAccountButton.disabled = false;
                }
            });
        }));
    }

    onClose() {
        this.plugin.releaseSaveOperation(this);
        this.contentEl.empty();
    }
}

function getAccountTypeOptions(): Array<{ value: AccountType; label: string }> {
    return [
        { value: AccountType.CHEQUING, label: 'Chequing' },
        { value: AccountType.SAVING, label: 'Saving' },
        { value: AccountType.CREDIT, label: 'Credit' },
        { value: AccountType.OTHER, label: 'Other' }
    ];
}

function getAccountTypeOptionsForAccount(account: Account | null): Array<{ value: AccountType; label: string }> {
    const options = getAccountTypeOptions();
    if (account?.isDefault) {
        return options.filter(option => option.value !== AccountType.CREDIT);
    }

    return options;
}

class AccountDeleteBlockedModal extends Modal {
    constructor(app: App, private readonly message: string) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('expensica-confirmation-dialog');
        contentEl.addClass('expensica-confirmation-modal');
        contentEl.createEl('h2', { text: 'Account cannot be deleted', cls: 'expensica-modal-title' });
        contentEl.createEl('p', { text: this.message, cls: 'expensica-modal-message' });
        const buttonContainer = contentEl.createDiv('expensica-modal-buttons');
        buttonContainer.createEl('button', {
            text: 'Got it',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary'
        }).addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

class AccountUpdateWarningModal extends Modal {
    private readonly onConfirm: (confirmed: boolean) => void;

    constructor(app: App, onConfirm: (confirmed: boolean) => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('expensica-confirmation-dialog');
        contentEl.addClass('expensica-confirmation-modal');
        contentEl.createEl('h2', { text: 'Update Account?', cls: 'expensica-modal-title' });
        contentEl.createEl('p', {
            text: 'This will alter the transaction history, are you sure you want to change the account details?',
            cls: 'expensica-modal-message'
        });
        const buttonContainer = contentEl.createDiv('expensica-modal-buttons');
        buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary'
        }).addEventListener('click', () => {
            this.onConfirm(false);
            this.close();
        });
        buttonContainer.createEl('button', {
            text: 'Yes',
            cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid'
        }).addEventListener('click', () => {
            this.onConfirm(true);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class AccountEditorModal extends Modal {
    private saving = false;
    plugin: ExpensicaPlugin;
    dashboardView: ExpensicaDashboardView | null;
    account: Account | null;

    constructor(app: App, plugin: ExpensicaPlugin, dashboardView: ExpensicaDashboardView | null, account: Account | null = null,
        private readonly onDraft?: (account: Account) => void) {
        super(app);
        if (onDraft) preventBackdropDismissal(this);
        this.plugin = plugin;
        this.dashboardView = dashboardView;
        this.account = account;
    }

    private getAccountReference(): string | null {
        return this.account ? formatAccountReference(this.account.type, this.account.name) : null;
    }

    private async persistAccount(nextAccount: Account) {
        if (this.saving) return;
        if (this.onDraft) {
            this.onDraft(nextAccount);
            this.close();
            return;
        }
        this.saving = true;
        try {
            if (this.account) {
                await this.plugin.updateAccount(formatAccountReference(this.account.type, this.account.name), nextAccount, this.dashboardView);
            } else {
                await this.plugin.addAccount(nextAccount, this.dashboardView);
            }
            await this.dashboardView?.loadTransactionsData();
            this.dashboardView?.requestAllChartAnimations();
            this.dashboardView?.renderDashboard();
            this.close();
        } finally {
            this.saving = false;
        }
    }

    private applyMeasuredModalHeight(contentEl: HTMLElement, optionsMenu: HTMLElement) {
        const modalContent = contentEl.closest<HTMLElement>('.modal-content');
        const wasHidden = optionsMenu.hasClass('expensica-select-hidden');
        const previousVisibility = optionsMenu.style.visibility;
        const previousPointerEvents = optionsMenu.style.pointerEvents;

        if (wasHidden) {
            optionsMenu.removeClass('expensica-select-hidden');
        }

        optionsMenu.setCssStyles({ visibility: 'hidden', pointerEvents: 'none' });

        const dropdownHeight = optionsMenu.scrollHeight;
        const baseHeight = contentEl.scrollHeight - dropdownHeight;
        const measuredHeight = baseHeight + dropdownHeight;
        const measuredValue = `${measuredHeight}px`;

        contentEl.setCssProps({ '--expensica-account-editor-measured-height': measuredValue });
        contentEl.setCssStyles({ minHeight: measuredValue });
        modalContent?.setCssProps({ '--expensica-account-editor-measured-height': measuredValue });
        if (modalContent) {
            modalContent.setCssStyles({
                minHeight: measuredValue,
                maxHeight: 'none',
                overflow: 'visible'
            });
        }
        this.modalEl.setCssStyles({ minHeight: measuredValue, maxHeight: 'none' });

        optionsMenu.setCssStyles({
            visibility: previousVisibility,
            pointerEvents: previousPointerEvents
        });

        if (wasHidden) {
            optionsMenu.addClass('expensica-select-hidden');
        }
    }

    open() {
        if (this.plugin.canEditData(this.account && !this.onDraft ? ['accounts', 'transactions'] : ['accounts'])) super.open();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-transaction-modal');
        contentEl.addClass('expensica-modal');
        contentEl.addClass('expensica-account-editor-modal');

        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        const modalLabel = this.account
            ? `Edit ${getAccountTypeLabel(this.account.type)} Account`
            : 'Create New Account';
        modalTitle.createSpan({
            text: getAccountEmoji(this.account?.type || AccountType.CHEQUING),
            cls: 'expensica-modal-title-icon'
        });
        modalTitle.createSpan({ text: ` ${modalLabel}` });

        const form = contentEl.createEl('form', { cls: 'expensica-form' });

        const nameGroup = form.createDiv('expensica-form-group');
        nameGroup.createEl('label', {
            text: 'Name',
            cls: 'expensica-form-label',
            attr: { for: 'account-name' }
        });
        const nameRow = nameGroup.createDiv('expensica-category-name-row');
        let selectedColor = this.account
            ? (normalizePaletteColor(this.account.color) || getAccountColor(this.account, this.plugin.getAccounts()))
            : getNextAccountColor(this.plugin.getAccounts());

        const colorButton = nameRow.createEl('button', {
            cls: 'expensica-standard-button expensica-category-color-button',
            attr: {
                type: 'button',
                id: 'account-color',
                'aria-label': 'Choose color'
            }
        });
        colorButton.setCssProps({ '--expensica-category-button-color': selectedColor });
        colorButton.addEventListener('click', () => {
            new CategoryColorPaletteModal(this.app, selectedColor, (color) => {
                selectedColor = normalizePaletteColor(color) || selectedColor;
                colorButton.setCssProps({ '--expensica-category-button-color': selectedColor });
            }).open();
        });

        const nameInput = nameRow.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field expensica-category-name-field',
            attr: {
                id: 'account-name',
                name: 'account-name',
                type: 'text',
                placeholder: 'Enter account name',
                required: 'required'
            }
        });
        nameInput.value = this.account?.name || '';

        const typeGroup = form.createDiv('expensica-form-group');
        typeGroup.createEl('label', {
            text: 'Account type',
            cls: 'expensica-form-label',
            attr: { for: 'account-type' }
        });
        const typeSelectContainer = typeGroup.createDiv('expensica-custom-select-container');
        const hiddenTypeSelect = typeSelectContainer.createEl('select', {
            cls: 'hidden-select',
            attr: {
                id: 'account-type',
                name: 'account-type',
                required: 'required'
            }
        });
        const typeDisplay = typeSelectContainer.createEl('button', {
            cls: 'expensica-select-display expensica-edit-field',
            attr: {
                type: 'button',
                'aria-label': 'Choose account type'
            }
        });
        const typeDisplayText = typeDisplay.createSpan('expensica-select-display-text');
        const typeDisplayArrow = typeDisplay.createSpan('expensica-select-arrow');
        appendChevronIcon(typeDisplayArrow, '16');
        const typeOptionsMenu = typeSelectContainer.createDiv('expensica-select-options expensica-select-hidden');

        const creditLimitSlot = form.createDiv('expensica-credit-limit-slot');
        let creditLimitGroup: HTMLDivElement | null = null;
        let creditLimitInput: HTMLInputElement | null = null;

        const ensureCreditLimitField = (type: AccountType) => {
            if (type !== AccountType.CREDIT) {
                creditLimitGroup?.remove();
                creditLimitGroup = null;
                creditLimitInput = null;
                return;
            }

            if (creditLimitGroup && creditLimitInput) {
                return;
            }

            creditLimitGroup = creditLimitSlot.createDiv('expensica-form-group');
            creditLimitGroup.createEl('label', {
                text: 'Credit Limit',
                cls: 'expensica-form-label',
                attr: { for: 'credit-limit' }
            });
            const creditLimitInputWrapper = creditLimitGroup.createDiv('expensica-currency-input');
            creditLimitInputWrapper.createSpan({
                text: formatCurrency(0, this.plugin.settings.defaultCurrency, false, { currencyOnly: true }),
                cls: 'expensica-currency-symbol'
            });
            creditLimitInput = creditLimitInputWrapper.createEl('input', {
                cls: 'expensica-form-input expensica-edit-field',
                attr: {
                    id: 'credit-limit',
                    name: 'credit-limit',
                    type: 'number',
                    step: 'any',
                    min: '0',
                    placeholder: '0.00'
                }
            });
            creditLimitInput.value = this.account?.type === AccountType.CREDIT
                ? this.account.creditLimit?.toString() || ''
                : '';
        };

        const updateTypeSelection = (type: AccountType) => {
            hiddenTypeSelect.value = type;
            typeDisplayText.empty();
            appendCreditCardIcon(typeDisplayText);
            typeDisplayText.createSpan({ text: ` ${getAccountTypeLabel(type)}` });
            typeOptionsMenu.querySelectorAll('.expensica-select-option').forEach(option => {
                option.removeClass('expensica-option-selected');
            });
            typeOptionsMenu.querySelector(`[data-account-type="${type}"]`)?.addClass('expensica-option-selected');
            typeOptionsMenu.addClass('expensica-select-hidden');
            ensureCreditLimitField(type);
        };

        getAccountTypeOptionsForAccount(this.account).forEach(option => {
            hiddenTypeSelect.createEl('option', {
                text: option.label,
                attr: { value: option.value }
            });
            const optionEl = typeOptionsMenu.createDiv({ cls: 'expensica-select-option' });
            optionEl.setAttribute('data-account-type', option.value);
            appendCreditCardIcon(optionEl);
            optionEl.createSpan({ text: ` ${option.label}` });
            optionEl.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                updateTypeSelection(option.value);
            });
        });

        updateTypeSelection(this.account?.type || AccountType.CHEQUING);
        window.requestAnimationFrame(() => this.applyMeasuredModalHeight(contentEl, typeOptionsMenu));

        typeDisplay.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            typeOptionsMenu.toggleClass('expensica-select-hidden', !typeOptionsMenu.hasClass('expensica-select-hidden'));
        });

        if (this.account?.isDefault) {
            form.createEl('p', {
                text: 'This is a Default account',
                cls: 'expensica-account-default-note'
            });
        }

        const formFooter = form.createDiv('expensica-form-footer');
        let deleteBtn: HTMLButtonElement | null = null;
        if (this.account && !this.account.isDefault && !this.onDraft) {
            deleteBtn = formFooter.createEl('button', {
                text: 'Delete',
                cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid expensica-modal-delete-btn',
                attr: { type: 'button' }
            });
        }
        const cancelBtn = formFooter.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        formFooter.createEl('button', {
            text: this.onDraft ? 'Use account' : this.account ? 'Update' : 'Save',
            cls: 'expensica-standard-button expensica-btn expensica-btn-success',
            attr: { type: 'submit' }
        });

        cancelBtn.addEventListener('click', () => this.close());

        deleteBtn?.addEventListener('click', () => {
            const accountReference = this.getAccountReference();
            if (!this.account || !accountReference) {
                return;
            }

            if (this.plugin.hasTransactionsForAccount(accountReference)) {
                new AccountDeleteBlockedModal(
                    this.app,
                    `This ${getAccountTypeLabel(this.account.type).toLowerCase()} account has a transaction history. In order to delete it, reassign or remove transactions affected`
                ).open();
                return;
            }

            new ConfirmationModal(
                this.app,
                'Delete Account?',
                `Are you sure you want to delete this ${getAccountTypeLabel(this.account.type).toLowerCase()} account? This action cannot be undone.`,
                (confirmed) => {
                    if (!confirmed) {
                        return;
                    }

                    handleDashboardAsync('Delete account', async () => {
                        await this.plugin.deleteAccount(accountReference, this.dashboardView);
                        await this.dashboardView?.loadTransactionsData();
                        this.dashboardView?.requestAllChartAnimations();
                        this.dashboardView?.renderDashboard();
                        this.close();
                    });
                }, 'Delete', this.plugin
            ).open();
        });

        const submitAccount = async (event: Event, confirmed = false) => {
            event.preventDefault();
            if (!form.reportValidity()) return false;

            const accountName = normalizeAccountName(nameInput.value);
            if (!accountName) {
                showExpensicaNotice('Account name is required');
                return false;
            }

            const accountType = hiddenTypeSelect.value as AccountType;
            const nextAccount: Account = {
                id: this.account?.id || generateId(),
                name: accountName,
                type: accountType,
                createdAt: this.account?.createdAt || new Date().toISOString(),
                color: selectedColor,
                isDefault: this.account?.isDefault
            };
            if (accountType === AccountType.CREDIT && creditLimitInput?.value) {
                nextAccount.creditLimit = Number(creditLimitInput.value);
            }

            if (
                !confirmed && this.account
                && this.account.isDefault
                && (
                    this.account.name !== nextAccount.name
                    || this.account.type !== nextAccount.type
                    || (this.account.creditLimit || 0) !== (nextAccount.creditLimit || 0)
                )
            ) {
                new AccountUpdateWarningModal(this.app, voidAsync(async (confirmed) => {
                    if (!confirmed) {
                        return;
                    }

                    await this.plugin.runSaveOperation(this, 'Edit account', () => submitAccount(event, true));
                })).open();
                return false;
            }

            await this.persistAccount(nextAccount);
        };
        form.addEventListener('submit', voidAsync(async (event) => {
            event.preventDefault();
            await this.plugin.runSaveOperation(this, this.account ? 'Edit account' : 'Add account', () => submitAccount(event));
        }));
    }

    onClose() {
        this.plugin.releaseSaveOperation(this);
        this.contentEl.empty();
    }
}

class CategoryModal extends Modal {
    plugin: ExpensicaPlugin;
    dashboardView: ExpensicaDashboardView;
    category: Category | null;
    initialType: CategoryType;

    constructor(
        app: App,
        plugin: ExpensicaPlugin,
        dashboardView: ExpensicaDashboardView,
        category: Category | null,
        initialType: CategoryType = CategoryType.EXPENSE
    ) {
        super(app);
        this.plugin = plugin;
        this.dashboardView = dashboardView;
        this.category = category;
        this.initialType = category?.type || initialType;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-transaction-modal');
        contentEl.addClass('expensica-modal');
        const isProtectedCategory = this.category?.id === 'other_expense' || this.category?.id === 'other_income';
        const draftCategory: Category = this.category || {
            id: generateId(),
            name: '',
            type: this.initialType
        };

        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.createSpan({ text: '🏷️', cls: 'expensica-modal-title-icon' });
        modalTitle.createSpan({
            text: ` ${this.category
                ? 'Edit Category'
                : (draftCategory.type === CategoryType.INCOME ? 'New Income Category' : 'New Expenses Category')}`
        });

        const form = contentEl.createEl('form', { cls: 'expensica-form' });
        const nameGroup = form.createDiv('expensica-form-group');
        nameGroup.createEl('label', {
            text: 'Name',
            cls: 'expensica-form-label',
            attr: { for: 'category-name' }
        });
        const nameRow = nameGroup.createDiv('expensica-category-name-row');
        let selectedEmoji = this.category ? this.plugin.getCategoryEmoji(this.category.id) : this.plugin.getCategoryEmoji('other_expense');
        let selectedColor = this.category
            ? this.normalizeColorInputValue(this.plugin.getCategoryColor(this.category.id, this.category.name))
            : this.normalizeColorInputValue(ColorPalette.colors[0]);

        const colorButton = nameRow.createEl('button', {
            cls: 'expensica-standard-button expensica-category-color-button',
            attr: {
                type: 'button',
                id: 'category-color',
                'aria-label': 'Choose color'
            }
        });
        colorButton.setCssProps({ '--expensica-category-button-color': selectedColor });
        colorButton.addEventListener('click', () => {
            new CategoryColorPaletteModal(this.app, selectedColor, (color) => {
                selectedColor = this.normalizeColorInputValue(color);
                colorButton.setCssProps({ '--expensica-category-button-color': selectedColor });
            }).open();
        });

        const emojiButton = nameRow.createEl('button', {
            text: selectedEmoji,
            cls: 'expensica-standard-button expensica-category-picker-trigger expensica-category-modal-emoji-button',
            attr: {
                type: 'button',
                id: 'category-emoji',
                'aria-label': 'Choose emoji'
            }
        });
        emojiButton.addEventListener('click', () => {
            new EmojiPickerModal(this.app, draftCategory, selectedEmoji, (emoji) => {
                selectedEmoji = emoji;
                emojiButton.setText(emoji);
            }).open();
        });

        const nameInput = nameRow.createEl('input', {
            cls: 'expensica-form-input expensica-edit-field expensica-category-name-field',
            attr: {
                type: 'text',
                id: 'category-name',
                name: 'category-name',
                placeholder: 'Enter category name',
                required: 'required'
            }
        });
        nameInput.value = this.category?.name || '';
        if (isProtectedCategory) {
            nameInput.disabled = true;
        }

        const formFooter = form.createDiv('expensica-form-footer');
        let deleteBtn: HTMLButtonElement | null = null;
        if (this.category && !isProtectedCategory) {
            deleteBtn = formFooter.createEl('button', {
                text: 'Delete',
                cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid expensica-modal-delete-btn',
                attr: { type: 'button' }
            });
        }
        const cancelBtn = formFooter.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        formFooter.createEl('button', {
            text: this.category ? 'Update' : 'Save',
            cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
            attr: { type: 'submit' }
        });

        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        deleteBtn?.addEventListener('click', () => {
            if (!this.category) {
                return;
            }

            const categoryId = this.category.id;
            handleDashboardAsync('Delete category', async () => {
                const deleted = await this.plugin.deleteCategory(categoryId);
                if (deleted) {
                    this.dashboardView.renderDashboard();
                    this.close();
                }
            });
        });

        form.addEventListener('submit', (event) => {
            event.preventDefault();

            handleDashboardAsync('Save category', async () => {
                const nextName = this.plugin.normalizeCategoryName(nameInput.value.trim()).name;
                const nextEmoji = selectedEmoji || (this.category ? this.plugin.getCategoryEmoji(this.category.id) : this.plugin.getCategoryEmoji('other_expense'));
                const nextColor = selectedColor;

                if (!nextName) {
                    showExpensicaNotice('Category name is required.');
                    return;
                }

                const duplicate = this.plugin.getCategories(draftCategory.type).find(candidate =>
                    candidate.id !== draftCategory.id
                    && this.plugin.normalizeCategoryName(candidate.name).name.toLowerCase() === nextName.toLowerCase()
                );
                if (duplicate) {
                    showExpensicaNotice(`Category "${nextName}" already exists.`);
                    return;
                }

                if (this.category) {
                    await this.plugin.updateCategory({
                        ...this.category,
                        name: nextName
                    });
                    await this.plugin.updateCategoryEmoji(this.category.id, nextEmoji);
                    await this.plugin.updateCategoryColor(this.category.id, nextColor);
                } else {
                    await this.plugin.addCategory({
                        ...draftCategory,
                        name: nextName
                    });
                    await this.plugin.updateCategoryEmoji(draftCategory.id, nextEmoji);
                    await this.plugin.updateCategoryColor(draftCategory.id, nextColor);
                }
                this.dashboardView.renderDashboard();
                this.close();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private normalizeColorInputValue(color: string): string {
        if (/^#[0-9a-f]{6}$/i.test(color)) {
            return color;
        }

        if (/^#[0-9a-f]{3}$/i.test(color)) {
            return `#${color.slice(1).split('').map(char => `${char}${char}`).join('')}`;
        }

        const probe = document.body.createDiv();
        probe.setCssStyles({ color });
        const computed = getComputedStyle(probe).color;
        probe.remove();

        const match = computed.match(/\d+/g);
        if (!match || match.length < 3) {
            return '#000000';
        }

        return `#${match.slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
    }
}

class CategoryColorPaletteModal extends Modal {
    currentColor: string;
    onSelect: (color: string) => void;

    constructor(app: App, currentColor: string, onSelect: (color: string) => void) {
        super(app);
        this.currentColor = currentColor;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-category-color-palette-dialog');
        contentEl.addClass('expensica-category-color-palette-modal');

        const grid = contentEl.createDiv('expensica-category-color-palette-grid');

        ColorPalette.colors.forEach(color => {
            const normalizedColor = color.slice(0, 7);
            const swatch = grid.createEl('button', {
                cls: 'expensica-category-color-swatch',
                attr: {
                    type: 'button',
                    'aria-label': `Select color ${normalizedColor}`
                }
            });
            swatch.setCssStyles({ backgroundColor: normalizedColor });
            if (normalizedColor.toLowerCase() === this.currentColor.toLowerCase()) {
                swatch.addClass('is-selected');
            }

            swatch.addEventListener('click', () => {
                this.onSelect(normalizedColor);
                this.close();
            });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
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
    rolloverStartInput: HTMLInputElement | null = null;
    private rolloverStartButton: HTMLButtonElement | null = null;
    private rolloverDateSelector: DateSelectorModal | null = null;
    isRollover = false;
    
    // Add properties for custom dropdowns
    selectedCategoryId = '';
    selectedPeriod: BudgetPeriod = BudgetPeriod.MONTHLY;
    categoryOptions: HTMLElement | null = null;
    periodOptions: HTMLElement | null = null;
    categoryDisplay: HTMLElement | null = null;
    periodDisplay: HTMLElement | null = null;

    constructor(app: App, plugin: ExpensicaPlugin, dashboard: ExpensicaDashboardView, budget: Budget | null = null) {
        super(app);
        this.plugin = plugin;
        this.dashboard = dashboard;
        this.budget = budget;
        
        // If editing an existing budget, set the initial values
        if (budget) {
            this.isRollover = budget.rollover;
            this.selectedCategoryId = budget.categoryId;
            this.selectedPeriod = budget.period;
        }
    }

    open() {
        if (this.plugin.canEditData(["budgets"])) super.open();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.addClass('expensica-transaction-modal');
        contentEl.addClass('expensica-modal');
        contentEl.addClass('expensica-budget-modal');

        // Add title with icon
        const modalTitle = contentEl.createEl('h2', { cls: 'expensica-modal-title' });
        modalTitle.createSpan({ text: '📊', cls: 'expensica-modal-title-icon' });
        modalTitle.createSpan({ text: ` ${this.budget ? 'Edit Budget' : 'Add Budget'}` });

        // Create form
        const form = contentEl.createEl('form', { cls: 'expensica-form' });

        // Category selection
        this.renderCategorySelect(form);

        // Amount input
        this.renderAmountInput(form);

        // Period selection
        this.renderPeriodSelect(form);

        // Rollover toggle
        this.renderRolloverToggle(form);

        // Form footer with buttons
        const formFooter = form.createDiv('expensica-form-footer');
        let deleteBtn: HTMLButtonElement | null = null;

        if (this.budget) {
            deleteBtn = formFooter.createEl('button', {
                text: 'Delete',
                cls: 'expensica-standard-button expensica-btn expensica-btn-danger-solid expensica-modal-delete-btn',
                attr: { type: 'button' }
            });
        }
        
        // Cancel button
        const cancelBtn = formFooter.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        
        // Save button
        const saveBtn = formFooter.createEl('button', {
            text: this.budget ? 'Update' : 'Save Budget',
            cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
            attr: { type: 'submit' }
        });

        // Event listeners to close dropdowns when clicking outside
        document.addEventListener('click', this.handleOutsideClick);

        // Events
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        deleteBtn?.addEventListener('click', voidAsync(async () => {
            if (!this.budget) {
                return;
            }

            await this.dashboard.deleteBudget(this.budget.id, () => {
                this.close();
            });
        }));

        let saving = false;
        form.addEventListener('submit', voidAsync(async (e) => {
            e.preventDefault();
            await this.plugin.runSaveOperation(this, this.budget ? 'Edit budget' : 'Add budget', async () => {
                if (!form.reportValidity()) return false;
                if (this.isRollover && this.needsRolloverStart() && !this.rolloverStartInput?.value) {
                    this.rolloverStartButton?.click();
                    return false;
                }
                if (saving) return;
                saving = true;
                saveBtn.disabled = true;
                try {
                    await this.saveBudget();
                    this.close();
                } finally {
                    saving = false;
                    saveBtn.disabled = false;
                }
            });
        }));
    }

    onClose() {
        this.plugin.releaseSaveOperation(this);
        const dateSelector = this.rolloverDateSelector;
        this.rolloverDateSelector = null;
        dateSelector?.close();
        // Remove event listener
        document.removeEventListener('click', this.handleOutsideClick);
    }

    // Handle clicks outside the dropdown to close it
    handleOutsideClick = (e: MouseEvent) => {
        if (this.categoryOptions && !this.categoryOptions.contains(e.target as Node) && 
            this.categoryDisplay && !this.categoryDisplay.contains(e.target as Node)) {
            this.categoryOptions.classList.add('expensica-select-hidden');
        }
        
        if (this.periodOptions && !this.periodOptions.contains(e.target as Node) && 
            this.periodDisplay && !this.periodDisplay.contains(e.target as Node)) {
            this.periodOptions.classList.add('expensica-select-hidden');
        }
    }

    // Render category dropdown
    private renderCategorySelect(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        formGroup.createEl('label', { 
            text: 'Category', 
            cls: 'expensica-form-label',
            attr: { for: 'budget-category' } 
        });
        
        // Get expense categories
        const categories = this.plugin.getCategories(CategoryType.EXPENSE);
        
        // Create custom select container
        const customSelectContainer = formGroup.createDiv('expensica-custom-select-container');
        
        // Create hidden select for form submission
        this.categorySelect = customSelectContainer.createEl('select', {
            cls: 'hidden-select',
            attr: { 
                id: 'budget-category', 
                name: 'category', 
                required: 'true' 
            }
        });
        
        // Add placeholder option
        this.categorySelect.createEl('option', {
            text: 'Select a category',
            value: '',
            attr: { disabled: 'true' }
        });
        
        // Create display element
        this.categoryDisplay = customSelectContainer.createDiv('expensica-select-display');
        
        // Default text if no category selected
        let displayText = 'Select a category';
        let displayEmoji = '';
        
        // Create display text container
        const displayTextEl = this.categoryDisplay.createDiv('expensica-select-display-text');
        
        // Create arrow icon
        const arrowIcon = this.categoryDisplay.createDiv('expensica-select-arrow');
        appendChevronIcon(arrowIcon, '18');
        
        // Create options container
        this.categoryOptions = customSelectContainer.createDiv('expensica-select-options expensica-select-hidden');
        
        // Add options for each category
        categories.forEach(category => {
            // Add option to hidden select
            const option = this.categorySelect?.createEl('option', {
                text: category.name,
                value: category.id
            });
            
            // If editing a budget, select the correct category
            if (this.budget && this.budget.categoryId === category.id) {
                if (option) option.selected = true;
                displayText = category.name;
                displayEmoji = this.plugin.getCategoryEmoji(category.id);
            }
            
            // Check if category already has a budget
            const existingBudget = this.plugin.getBudgetForCategory(category.id);
            const isDisabled = existingBudget && (!this.budget || existingBudget.id !== this.budget.id);
            
            // Create visual option using a different approach
            if (this.categoryOptions) {
                const optionEl = this.categoryOptions.createDiv(
                    `expensica-select-option${this.selectedCategoryId === category.id ? ' expensica-option-selected' : ''}${isDisabled ? ' expensica-option-disabled' : ''}`
                );
                optionEl.createSpan({
                    text: this.plugin.getCategoryEmoji(category.id),
                    cls: 'expensica-category-emoji'
                });
                optionEl.createSpan({ text: ` ${category.name}` });
                if (isDisabled) {
                    optionEl.createSpan({ text: ' (already budgeted)', cls: 'expensica-option-note' });
                }
                
                // Skip event listener if disabled
                if (isDisabled) return;
                
                // Add click event
                optionEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectedCategoryId = category.id;
                    
                    // Update hidden select
                    if (this.categorySelect) {
                        Array.from(this.categorySelect.options).forEach(opt => {
                            opt.selected = opt.value === category.id;
                        });
                    }
                    
                    // Update display text
                    displayTextEl.empty();
                    displayTextEl.createSpan({
                        text: this.plugin.getCategoryEmoji(category.id),
                        cls: 'expensica-category-emoji'
                    });
                    displayTextEl.createSpan({ text: ` ${category.name}` });
                    
                    // Update selected class
                    if (this.categoryOptions) {
                        this.categoryOptions.querySelectorAll('.expensica-select-option').forEach(el => {
                            el.classList.remove('expensica-option-selected');
                        });
                    }
                    optionEl.classList.add('expensica-option-selected');
                    
                    // Hide options
                    if (this.categoryOptions) {
                        this.categoryOptions.classList.add('expensica-select-hidden');
                    }
                });
            }
        });
        
        // Set initial display text
        if (displayEmoji) {
            displayTextEl.empty();
            displayTextEl.createSpan({ text: displayEmoji, cls: 'expensica-category-emoji' });
            displayTextEl.createSpan({ text: ` ${displayText}` });
        } else {
            displayTextEl.setText(displayText);
        }
        
        // Toggle options on display click
        this.categoryDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.categoryOptions) {
                this.categoryOptions.classList.toggle('expensica-select-hidden');
            }
            if (this.periodOptions) {
                this.periodOptions.classList.add('expensica-select-hidden'); // Close other dropdown if open
            }
        });
    }

    // Render amount input
    private renderAmountInput(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        formGroup.createEl('label', { 
            text: 'Budget Amount', 
            cls: 'expensica-form-label',
            attr: { for: 'budget-amount' } 
        });
        
        // Currency symbol wrapper
        const inputWrapper = formGroup.createDiv('expensica-currency-input');
        
        // Currency symbol
        const symbol = formatCurrency(0, this.plugin.settings.defaultCurrency, false, { currencyOnly: true });
        
        inputWrapper.createSpan({
            text: symbol,
            cls: 'expensica-currency-symbol'
        });
        
        // Amount input
        this.amountInput = inputWrapper.createEl('input', {
            type: 'number',
            cls: 'expensica-form-input',
            attr: {
                id: 'budget-amount',
                name: 'amount',
                placeholder: '0.00',
                step: 'any',
                min: '0',
                required: 'true',
                value: this.budget ? this.budget.amount.toString() : ''
            }
        });
    }

    // Render period select
    private renderPeriodSelect(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        formGroup.createEl('label', { 
            text: 'Budget Period', 
            cls: 'expensica-form-label',
            attr: { for: 'budget-period' } 
        });
        
        // Period options
        const periods = [
            { value: BudgetPeriod.MONTHLY, text: 'Monthly' },
            { value: BudgetPeriod.QUARTERLY, text: 'Quarterly' },
            { value: BudgetPeriod.YEARLY, text: 'Yearly' }
        ];
        
        // Create custom select container
        const customSelectContainer = formGroup.createDiv('expensica-custom-select-container');
        
        // Create hidden select for form submission
        this.periodSelect = customSelectContainer.createEl('select', {
            cls: 'hidden-select',
            attr: { 
                id: 'budget-period', 
                name: 'period', 
                required: 'true' 
            }
        });
        
        // Add options to hidden select
        periods.forEach(period => {
            const option = this.periodSelect?.createEl('option', {
                text: period.text,
                value: period.value
            });
            
            // If editing a budget, select the correct period
            if (this.budget && this.budget.period === period.value) {
                if (option) option.selected = true;
            }
        });
        
        // Create display element
        this.periodDisplay = customSelectContainer.createDiv('expensica-select-display');
        
        // Default period if none selected
        let displayText = 'Select a period';
        
        // If editing, set display text to current period
        if (this.selectedPeriod) {
            const periodObj = periods.find(p => p.value === this.selectedPeriod);
            if (periodObj) {
                displayText = periodObj.text;
            }
        }
        
        // Create display text container
        const displayTextEl = this.periodDisplay.createDiv('expensica-select-display-text');
        displayTextEl.setText(displayText);
        
        // Create arrow icon
        const arrowIcon = this.periodDisplay.createDiv('expensica-select-arrow');
        appendChevronIcon(arrowIcon, '18');
        
        // Create options container
        this.periodOptions = customSelectContainer.createDiv('expensica-select-options expensica-select-hidden');
        
        // Add options for each period
        periods.forEach(period => {
            // Create visual option using a different approach
            if (this.periodOptions) {
                const optionEl = this.periodOptions.createDiv(
                    `expensica-select-option${this.selectedPeriod === period.value ? ' expensica-option-selected' : ''}`
                );
                optionEl.textContent = period.text;
                
                // Add click event
                optionEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectedPeriod = period.value;
                    
                    // Update hidden select
                    if (this.periodSelect) {
                        Array.from(this.periodSelect.options).forEach(opt => {
                            opt.selected = (opt.value as BudgetPeriod) === period.value;
                        });
                    }
                    
                    // Update display text
                    displayTextEl.setText(period.text);
                    
                    // Update selected class
                    if (this.periodOptions) {
                        this.periodOptions.querySelectorAll('.expensica-select-option').forEach(el => {
                            el.classList.remove('expensica-option-selected');
                        });
                    }
                    optionEl.classList.add('expensica-option-selected');
                    
                    // Hide options
                    if (this.periodOptions) {
                        this.periodOptions.classList.add('expensica-select-hidden');
                    }
                });
            }
        });
        
        // Toggle options on display click
        this.periodDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.periodOptions) {
                this.periodOptions.classList.toggle('expensica-select-hidden');
            }
            if (this.categoryOptions) {
                this.categoryOptions.classList.add('expensica-select-hidden'); // Close other dropdown if open
            }
        });
    }

    // Render rollover toggle
    private renderRolloverToggle(container: HTMLElement) {
        const formGroup = container.createDiv('expensica-form-group');
        
        // Create toggle container with improved styling
        const toggleContainer = formGroup.createDiv('expensica-toggle-container expensica-form-control-container');
        
        // Toggle switch with label
        this.rolloverToggle = toggleContainer.createDiv('expensica-toggle');
        if (this.isRollover && this.rolloverToggle) {
            this.rolloverToggle.addClass('active');
        }
        
        // Toggle slider
        if (this.rolloverToggle) {
            this.rolloverToggle.createDiv('expensica-toggle-slider');
        }
        
        // Toggle label with improved appearance
        toggleContainer.createEl('label', {
            text: 'Roll over unspent budget to next period',
            cls: 'expensica-toggle-label expensica-form-label-inline'
        });

        const startGroup = formGroup.createDiv('expensica-form-group');
        startGroup.hidden = !this.isRollover;
        startGroup.createEl('label', {
            text: 'Rollover starts', cls: 'expensica-form-label', attr: { for: 'budget-rollover-start' }
        });
        this.rolloverStartInput = startGroup.createEl('input', {
            attr: { type: 'hidden', name: 'rolloverStartDate' }
        });
        const dateInput = this.rolloverStartInput;
        dateInput.disabled = !this.isRollover;
        const dateButton = startGroup.createEl('button', {
            cls: 'expensica-form-input expensica-edit-field expensica-date-field',
            attr: { type: 'button', id: 'budget-rollover-start', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }
        });
        this.rolloverStartButton = dateButton;
        dateButton.disabled = !this.isRollover;
        const dateIcon = dateButton.createSpan({ cls: 'expensica-date-field-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(dateIcon, 'calendar');
        const dateLabel = dateButton.createSpan('expensica-date-field-label');
        const updateDateDisplay = () => {
            dateLabel.textContent = dateInput.value ? formatDateForDisplay(dateInput.value) : 'Choose date';
            dateButton.setAttribute('aria-label', `Choose rollover start date, ${dateLabel.textContent}`);
        };
        updateDateDisplay();
        dateButton.addEventListener('click', () => {
            if (this.rolloverDateSelector) return;
            const selector = new DateSelectorModal(this.app, dateInput.value || this.budget?.rolloverStartDate || '', date => {
                dateInput.value = date;
                updateDateDisplay();
            }, () => {
                if (this.rolloverDateSelector !== selector) return;
                this.rolloverDateSelector = null;
                dateButton.setAttribute('aria-expanded', 'false');
                if (dateButton.isConnected) dateButton.focus();
            });
            this.rolloverDateSelector = selector;
            dateButton.setAttribute('aria-expanded', 'true');
            selector.open();
        });
        startGroup.createEl('p', {
            text: 'Starts with this full budget period and zero carry. Only unused funds roll over; overspending does not carry debt. Choose a start again when changing the amount, category, or period.',
            cls: 'expensica-form-description'
        });
        if (this.budget?.rolloverStartDate) {
            startGroup.createEl('p', {
                text: `Current start: ${this.budget.rolloverStartDate}. Leave blank to keep it when budget terms are unchanged. Earlier budget definitions are not retained.`,
                cls: 'expensica-form-description'
            });
        }
        
        // Add event listener
        if (this.rolloverToggle) {
            this.rolloverToggle.addEventListener('click', () => {
                this.isRollover = !this.isRollover;
                startGroup.hidden = !this.isRollover;
                if (this.rolloverStartInput) this.rolloverStartInput.disabled = !this.isRollover;
                dateButton.disabled = !this.isRollover;
                if (this.isRollover && this.rolloverToggle) {
                    this.rolloverToggle.addClass('active');
                } else if (this.rolloverToggle) {
                    this.rolloverToggle.removeClass('active');
                }
            });
        }
    }

    private needsRolloverStart(): boolean {
        return !this.budget?.rollover || !this.budget.rolloverStartDate
            || this.budget.amount !== Number(this.amountInput?.value)
            || this.budget.categoryId !== this.categorySelect?.value
            || this.budget.period !== this.periodSelect?.value;
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
        const rolloverStartDate = this.isRollover
            ? this.rolloverStartInput?.value || (this.needsRolloverStart() ? undefined : this.budget?.rolloverStartDate)
            : undefined;
        if (this.isRollover && !rolloverStartDate) {
            throw new Error('Choose a rollover start period. Opening carry starts at zero.');
        }
        
        // Create or update budget
        if (this.budget) {
            // Update existing budget
            const updatedBudget: Budget = {
                ...this.budget,
                categoryId,
                amount,
                period,
                rollover: this.isRollover,
                rolloverStartDate,
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
                rolloverStartDate,
                lastUpdated: new Date().toISOString()
            };
            
            await this.plugin.addBudget(newBudget);
        }
        
    }
}
