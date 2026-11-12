import { calendarDate, createCalendarNavigation, createCalendarGrid, monthFormatter, renderCalendarDays, MIN_YEAR, MAX_YEAR } from '../calendar-ui';
import { renderUiIcon, renderPanelTitle, Transaction, TransactionType, TransactionAggregator, formatCurrency, ColorScheme, formatDate, parseLocalDate, sortTransactionsByDateTimeDesc, getAccountColor, getAccountIcon, formatAccountReference } from '../models';
import { getRunningBalanceByTransactionIdForAccount } from '../account-calculations';
import ExpensicaPlugin from '../../main';
import * as d3 from 'd3';
import { setChartTooltip } from '../chart-tooltip';
import { formatFinancialAmount, isEffectivelyZero, renderFinancialMetric, renderTrend, TREND_PERCENTAGE_LIMIT } from '../financial-metrics';

interface DayData {
    date: Date;
    dateKey: string;
    totalAmount: number;
    dayBalance: number;
    transactions: Transaction[];
    formattedDate: string;
}

export interface DailyReviewRange {
    startDate: Date;
    endDate: Date;
    label: string;
    transactions: Transaction[];
}

export class CalendarHeatmap {
    private container: HTMLElement;
    private transactions: Transaction[];
    private plugin: ExpensicaPlugin;
    private currentDate: Date;
    private calendarData: DayData[] = [];
    private detailsContainer: HTMLElement;
    private calendarContainer: HTMLElement;
    private days: HTMLElement;
    private maxAmount = 0;
    private selectedDate: Date | null;
    private onSelectedDateChange?: (date: Date) => void;
    private onTransactionEdit?: (transaction: Transaction) => void;
    private allTransactions: Transaction[] = [];
    private monthlyExpenseTotal = 0;
    private runningBalanceCache = new Map<string, Record<string, number>>();
    private releaseDailyTransactions: (() => void) | undefined;

    constructor(
        container: HTMLElement,
        plugin: ExpensicaPlugin,
        transactions: Transaction[],
        currentDate: Date,
        selectedDate: Date | null = null,
        onSelectedDateChange?: (date: Date) => void,
        onTransactionEdit?: (transaction: Transaction) => void,
        private readonly onMonthChange?: (offset: number) => void,
        private readonly getReviewRange?: () => DailyReviewRange
    ) {
        this.container = container;
        this.plugin = plugin;
        this.transactions = transactions;
        this.currentDate = currentDate;
        this.selectedDate = selectedDate;
        this.onSelectedDateChange = onSelectedDateChange;
        this.onTransactionEdit = onTransactionEdit;
        this.setupContainers();
    }

    private setupContainers() {
        // Clear any existing content
        this.destroy();
        this.container.empty();
        this.container.removeClass('expensica-calendar-container');
        this.container.addClass('expensica-calendar-flex-container');

        // Keep the calendar grid and day details as independent sibling panels.
        const calendarContainer = this.container.createDiv('expensica-calendar-container expensica-calendar-grid-container expensica-chart-container');
        this.calendarContainer = calendarContainer;
        this.calendarContainer.addClass('expensica-heatmap');
        const header = calendarContainer.createDiv('expensica-chart-header');
        renderPanelTitle(header, 'Spending Heatmap Calendar', 'calendar', 'h2', 'expensica-chart-title');
        const navigation = createCalendarNavigation(calendarContainer, offset => this.onMonthChange?.(offset));
        for (const button of [navigation.previousButton, navigation.nextButton]) {
            setChartTooltip(button, button.getAttribute('aria-label') || '');
        }
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        navigation.monthLabel.textContent = monthFormatter.format(this.currentDate);
        navigation.yearLabel.textContent = String(year);
        navigation.previousButton.disabled = year === MIN_YEAR && month === 0;
        navigation.nextButton.disabled = year === MAX_YEAR && month === 11;
        this.days = createCalendarGrid(calendarContainer, this.plugin.settings.showWeekNumbers).days;
        this.detailsContainer = this.container.createDiv('expensica-calendar-details-container expensica-chart-container');
    }

    public render() {
        this.prepareData();
        this.renderCalendar();
        this.resize();
    }

    private prepareData() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const daysInMonth = calendarDate(year, month + 1, 0).getDate();

        this.calendarData = [];
        this.maxAmount = 0;
        this.monthlyExpenseTotal = 0;
        this.runningBalanceCache.clear();
        this.allTransactions = this.plugin.getAllTransactions();

        const monthlyTransactionsByDate = new Map<string, Transaction[]>();
        this.transactions.forEach((transaction) => {
            const dateKey = this.getDateKey(parseLocalDate(transaction.date));
            const dayTransactions = monthlyTransactionsByDate.get(dateKey);
            if (dayTransactions) {
                dayTransactions.push(transaction);
            } else {
                monthlyTransactionsByDate.set(dateKey, [transaction]);
            }

            if (transaction.type === TransactionType.EXPENSE) {
                this.monthlyExpenseTotal += transaction.amount;
            }
        });

        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const runningBalances = this.getRunningBalanceMap(defaultAccountReference);
        const balancesByDate = new Map<string, number>();
        const monthStart = calendarDate(year, month, 1);
        monthStart.setHours(0, 0, 0, 0);
        let carriedBalance = 0;
        sortTransactionsByDateTimeDesc(this.allTransactions, this.allTransactions)
            .reverse()
            .forEach((transaction) => {
                const date = parseLocalDate(transaction.date);
                const balance = runningBalances[transaction.id];
                balancesByDate.set(this.getDateKey(date), balance);
                if (date < monthStart) {
                    carriedBalance = balance;
                }
            });

        for (let day = 1; day <= daysInMonth; day++) {
            const date = calendarDate(year, month, day);
            const dateKey = this.getDateKey(date);
            const dateStr = this.formatDate(date);
            const dayTransactions = monthlyTransactionsByDate.get(dateKey) ?? [];
            const totalAmount = dayTransactions
                .filter(t => t.type === TransactionType.EXPENSE)
                .reduce((sum, t) => sum + t.amount, 0);

            const dayBalance = balancesByDate.get(dateKey);
            if (typeof dayBalance === 'number') {
                carriedBalance = dayBalance;
            }

            this.calendarData.push({
                date: date,
                dateKey,
                totalAmount: totalAmount,
                dayBalance: carriedBalance,
                transactions: dayTransactions,
                formattedDate: dateStr
            });

            if (totalAmount > this.maxAmount) {
                this.maxAmount = totalAmount;
            }
        }
    }

    private getDateKey(date: Date): string {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private getRunningBalanceMap(accountReference: string): Record<string, number> {
        const existing = this.runningBalanceCache.get(accountReference);
        if (existing) {
            return existing;
        }

        const balances = getRunningBalanceByTransactionIdForAccount(this.plugin, accountReference, this.allTransactions);
        this.runningBalanceCache.set(accountReference, balances);
        return balances;
    }

    private formatDate(date: Date, month: 'long' | 'short' = 'long'): string {
        return date.toLocaleDateString('en-US', { 
            month,
            day: 'numeric', 
            year: 'numeric' 
        });
    }

    // Get the color scale based on the selected color scheme
    private getColorScale(maxValue: number): d3.ScaleSequential<string> {
        if (maxValue <= 0) {
            maxValue = 1; // Prevent division by zero
        }
        
        const colorScheme = this.plugin.settings.calendarColorScheme;
        const createScale = (maxColor: string) => {
            const transparentMinColor = this.withAlpha(maxColor, 0);
            return d3.scaleSequential()
                .domain([0, maxValue])
                .interpolator(d3.interpolateRgb(transparentMinColor, maxColor));
        };
        
        switch (colorScheme) {
            case ColorScheme.RED:
                return createScale("#FF5252");
            
            case ColorScheme.BLUE:
                return createScale("#0066CC");
                    
            case ColorScheme.GREEN:
                return createScale("#38A169");
                    
            case ColorScheme.PURPLE:
                return createScale("#805AD5");
                    
            case ColorScheme.ORANGE:
                return createScale("#ED8936");
                    
            case ColorScheme.TEAL:
                return createScale("#38B2AC");
                    
            case ColorScheme.COLORBLIND_FRIENDLY:
                // Use a colorblind-friendly palette (blue to yellow)
                return createScale("#FFBF00");
                    
            case ColorScheme.CUSTOM:
                // Use custom color
                return createScale(this.plugin.settings.customCalendarColor);
                    
            default:
                // Default to red
                return createScale("#FF5252");
        }
    }

    private withAlpha(color: string, alpha: number): string {
        const parsedColor = d3.rgb(color);
        return `rgba(${parsedColor.r}, ${parsedColor.g}, ${parsedColor.b}, ${alpha})`;
    }

    private renderCalendar() {
        const today = new Date();
        const selected = this.calendarData.find(day => this.selectedDate && this.isSameDate(day.date, this.selectedDate))
            ?? this.calendarData.find(day => this.isSameDate(day.date, today))
            ?? this.calendarData.find(day => day.totalAmount > 0);
        const colorScale = this.getColorScale(this.maxAmount);
        renderCalendarDays(this.days, this.currentDate.getFullYear(), this.currentDate.getMonth(), {
            selectedDate: selected ? formatDate(selected.date) : null,
            today: formatDate(today), showWeekNumbers: this.plugin.settings.showWeekNumbers,
            onSelect: value => this.selectDate(parseLocalDate(value, 12)),
            decorateDay: (button, date) => {
                const day = this.calendarData[date.getDate() - 1];
                button.empty();
                const content = button.createDiv('expensica-heatmap-day-content');
                content.createSpan({ text: String(date.getDate()) });
                button.setCssProps({
                    '--expensica-day-color': day.totalAmount > 0 ? colorScale(day.totalAmount) : 'transparent',
                    '--expensica-day-text': day.totalAmount > 0 ? this.getTextColor(day.totalAmount, colorScale) : 'var(--text-normal)'
                });
                if (day.totalAmount > 0) {
                    content.createSpan({ text: formatCurrency(day.totalAmount, this.plugin.settings.defaultCurrency, true),
                        cls: 'expensica-heatmap-amount' });
                }
                const incomeAccounts = new Map(day.transactions
                    .filter(transaction => transaction.type === TransactionType.INCOME)
                    .map(transaction => {
                        const account = this.plugin.getTransactionAccountDisplay(transaction.account);
                        return [account.id, account] as const;
                    }));
                if (incomeAccounts.size > 0) {
                    const dots = button.createDiv({ cls: 'expensica-heatmap-income-dots', attr: { 'aria-hidden': 'true' } });
                    for (const account of incomeAccounts.values()) {
                        dots.createSpan('expensica-heatmap-income-dot')
                            .setCssProps({ '--expensica-income-dot-color': getAccountColor(account) });
                    }
                }
                button.setAttribute('aria-description', button.getAttribute('aria-label') || '');
                button.removeAttribute('aria-label');
            }
        });
        this.days.setAttribute('aria-description', this.days.getAttribute('aria-label') || '');
        this.days.removeAttribute('aria-label');
        this.renderColorLegend(colorScale);
        this.showDayDetails(selected ?? this.calendarData[0]);
    }

    private isSameDate(left: Date, right: Date): boolean {
        return left.getFullYear() === right.getFullYear()
            && left.getMonth() === right.getMonth()
            && left.getDate() === right.getDate();
    }

    private getTextColor(amount: number, colorScale: d3.ScaleSequential<string>): string {
        if (amount === 0) return 'var(--text-muted)';
        
        // Transparent/low-opacity heatmap cells visually sit on the Obsidian background.
        const color = d3.rgb(colorScale(amount));
        if (color.opacity < 0.55) {
            return 'var(--text-normal)';
        }

        const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
        
        return luminance > 160 ? 'var(--text-normal)' : 'var(--text-on-accent)';
    }

    private renderColorLegend(colorScale: d3.ScaleSequential<string>) {
        this.calendarContainer.querySelector('.expensica-heatmap-legend')?.remove();
        const legend = this.calendarContainer.createDiv('expensica-heatmap-legend');
        legend.createSpan({ text: 'Spending Intensity', cls: 'expensica-heatmap-legend-title' });
        const stops = Array.from({ length: 11 }, (_, i) => `${colorScale(i / 10 * this.maxAmount)} ${i * 10}%`);
        legend.createDiv('expensica-heatmap-gradient').setCssProps({ '--expensica-heatmap-gradient': `linear-gradient(to right, ${stops.join(', ')})` });
        const labels = legend.createDiv('expensica-heatmap-legend-labels');
        for (const [label, amount] of [['Minimum', 0], ['Maximum', this.maxAmount]] as const) {
            const item = labels.createDiv();
            item.createSpan({ text: formatCurrency(amount, this.plugin.settings.defaultCurrency) });
            item.createSpan({ text: label });
        }
    }

    private renderDailyReviewMetrics(dayData: DayData) {
        let metrics: HTMLElement | null = null;
        const currency = this.plugin.settings.defaultCurrency;
        const range = this.getReviewRange?.() ?? {
            startDate: calendarDate(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1),
            endDate: calendarDate(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0),
            label: this.currentDate.toLocaleDateString(undefined, { month: 'short' }),
            transactions: this.transactions
        };
        const days = Math.max(1, (Date.parse(formatDate(range.endDate)) - Date.parse(formatDate(range.startDate))) / 86400000 + 1);
        for (const metric of [
            { label: 'Income', total: TransactionAggregator.getTotalIncome, color: 'var(--text-success)' },
            { label: 'Expenses', total: TransactionAggregator.getTotalExpenses, color: 'var(--text-error)' }
        ]) {
            const current = metric.total(dayData.transactions);
            if (isEffectivelyZero(current)) continue;
            metrics ??= this.detailsContainer.createDiv('expensica-cash-flow-metrics expensica-daily-review-metrics');
            const average = metric.total(range.transactions) / days;
            const item = renderFinancialMetric(metrics, metric.label, current, currency, metric.color, this.formatDate(dayData.date, 'short'));
            const pill = item.createDiv('expensica-card-trend expensica-cash-flow-comparison');
            const formatAmount = (value: number) => formatFinancialAmount(value, currency);
            renderTrend(pill, current, average, currency, range.label, metric.label === 'Expenses', trend => {
                const difference = trend.useAmount ? trend.amount : `${trend.percentage}% (${trend.amount})`;
                const comparison = trend.change === 0
                    ? `At daily average (${formatAmount(current)}) of ${range.label}.`
                    : `${trend.change > 0 ? 'Above' : 'Below'} daily average by ${difference} of ${range.label}.`;
                const share = Number((current / average * 100).toFixed(1));
                const rangeShare = average >= 1 && current >= 0 && Number.isFinite(share) && share < TREND_PERCENTAGE_LIMIT && (current === 0 || share > 0)
                    ? ` This represents ${share}% (${formatAmount(current)}) of the ${range.label} average.`
                    : ` The ${range.label} average is ${formatAmount(average)}.`;
                return {
                    label: trend.useAmount ? trend.amount : `${trend.percentage}%`,
                    tooltip: `${comparison}${rangeShare}`
                };
            });
        }
    }

    private renderDailyAccountBalances(container: HTMLElement, dayData: DayData) {
        const panel = container.createDiv('expensica-category-breakdown expensica-daily-account-balances');
        const header = panel.createDiv('expensica-breakdown-title-container');
        renderPanelTitle(header, 'Account Running Balances', 'balance', 'h3', 'expensica-breakdown-title');
        const cards = panel.createDiv('expensica-daily-account-cards');
        const accounts = this.plugin.settings.enableAccounts
            ? this.plugin.getAccounts() : [this.plugin.getTransactionAccountDisplay(undefined)];
        const lastTransaction = sortTransactionsByDateTimeDesc(this.allTransactions, this.allTransactions)
            .find(transaction => parseLocalDate(transaction.date) <= dayData.date);
        for (const account of accounts) {
            const reference = this.plugin.normalizeTransactionAccountReference(this.plugin.settings.enableAccounts
                ? formatAccountReference(account.type, account.name) : undefined);
            const balance = lastTransaction ? this.getRunningBalanceMap(reference)[lastTransaction.id] ?? 0 : 0;
            const color = getAccountColor(account, accounts);
            const card = cards.createDiv({
                cls: 'expensica-card expensica-overview-card-balance expensica-daily-account-card',
                attr: { role: 'button', tabindex: '0' }
            });
            renderUiIcon(card, this.plugin.settings.enableAccounts ? getAccountIcon(account.type) : 'wallet', '', color);
            card.createSpan({ text: account.name, cls: 'expensica-card-title' });
            const value = card.createSpan({
                text: formatCurrency(balance, this.plugin.settings.defaultCurrency),
                cls: 'expensica-card-value expensica-card-currency-amount'
            });
            value.style.color = color;
            setChartTooltip(card, `${account.name}'s running balance as of ${this.formatDate(dayData.date, 'short')}`, true);
        }
    }

    private renderDailyCategoryBreakdown(container: HTMLElement, transactions: Transaction[]) {
        const groups = [
            { type: TransactionType.EXPENSE, label: 'Expenses', color: 'var(--text-error)' },
            { type: TransactionType.INCOME, label: 'Income', color: 'var(--text-success)' }
        ].map(group => {
            const rows = transactions.filter(transaction => transaction.type === group.type);
            return { ...group, rows, total: rows.reduce((sum, transaction) => sum + transaction.amount, 0) };
        }).filter(group => !isEffectivelyZero(group.total));
        if (groups.length === 0) return;
        const panel = container.createDiv('expensica-category-breakdown');
        const header = panel.createDiv('expensica-breakdown-title-container');
        renderPanelTitle(header, 'Category Breakdown', 'budget', 'h3', 'expensica-breakdown-title');
        const chart = panel.createDiv('expensica-breakdown-chart');
        const ownerWindow = container.ownerDocument.defaultView ?? window;
        const reducedMotion = ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // Match the donut's 500ms shape transition and 450ms cubic-out counter.
        const duration = reducedMotion ? 0 : 500;
        const shapeEasing = d3.easePolyOut.exponent(4);
        for (const group of groups) {
            const categories = new Map<string, { amount: number; color: string }>();
            for (const transaction of group.rows) {
                const categoryId = transaction.category;
                const category = this.plugin.getCategoryById(categoryId);
                const name = category?.name ?? (group.type === TransactionType.INCOME ? 'Other Income' : 'Other Expenses');
                const existing = categories.get(name);
                if (existing) existing.amount += transaction.amount;
                else categories.set(name, { amount: transaction.amount,
                    color: this.plugin.getCategoryColor(categoryId, name) });
            }
            const row = chart.createDiv('expensica-category-bar-row');
            const swatch = row.createSpan({ cls: 'expensica-chart-legend-swatch', attr: { role: 'button', tabindex: '0' } });
            swatch.setCssProps({ 'background-color': group.color });
            setChartTooltip(swatch, group.label, true);
            const bar = row.createDiv({ cls: 'expensica-category-bar', attr: {
                'data-transaction-type': group.type, role: 'group', 'aria-description': group.label
            } });
            if (duration) {
                d3.select(bar).style('clip-path', 'inset(-15% 100% -15% 0)').transition()
                    .duration(duration).ease(shapeEasing).style('clip-path', 'inset(-15% 0% -15% 0)')
                    .on('end', () => bar.style.removeProperty('clip-path'));
            }
            for (const [name, { amount, color }] of Array.from(categories).sort((a, b) => b[1].amount - a[1].amount)) {
                if (isEffectivelyZero(amount)) continue;
                const percentage = amount / group.total * 100;
                const percentageLabel = `${Number(percentage.toFixed(2))}%`;
                const formattedAmount = formatCurrency(amount, this.plugin.settings.defaultCurrency);
                const segment = bar.createDiv({ cls: 'expensica-category-segment', attr: {
                    role: 'button', tabindex: '0', 'aria-description': group.label
                } });
                setChartTooltip(segment, `${name}: ${formattedAmount} (${percentageLabel})`, true);
                segment.setCssProps({
                    height: '100%',
                    '--category-percentage': `${Math.max(0, Math.min(100, percentage))}%`,
                    '--category-color': color
                });
                const label = segment.createSpan({ cls: 'expensica-category-segment-percentage' });
                const countPercentage = () => {
                    const counter = d3.select(label).interrupt();
                    label.textContent = duration ? '0%' : percentageLabel;
                    if (duration) counter.transition().duration(450).ease(d3.easeCubicOut)
                        .tween('text', () => progress => { label.textContent = `${Number((percentage * progress).toFixed(2))}%`; });
                };
                countPercentage();
                let active = false;
                const updateActive = () => {
                    const next = segment.getAttribute('aria-expanded') === 'true' || segment.matches(':hover, :focus-visible');
                    if (next === active) return;
                    active = next;
                    segment.classList.toggle('is-active', active);
                    const shape = d3.select(segment).interrupt();
                    const height = active ? '130%' : '100%';
                    if (duration) shape.transition().duration(duration).ease(shapeEasing).style('height', height);
                    else shape.style('height', height);
                    if (active) countPercentage();
                };
                for (const event of ['mouseenter', 'mouseleave', 'focus', 'blur', 'click', 'keydown']) {
                    segment.addEventListener(event, updateActive);
                }
            }
        }
    }

    private showDayDetails(dayData: DayData) {
        this.releaseDailyTransactions?.();
        this.releaseDailyTransactions = undefined;
        d3.select(this.detailsContainer).selectAll('.expensica-category-bar, .expensica-category-segment, .expensica-category-segment-percentage').interrupt();
        this.detailsContainer.empty();
        
        // Add title with day of week
        const dayOfWeek = dayData.date.toLocaleDateString('en-US', { weekday: 'long' });
        const header = this.detailsContainer.createDiv('expensica-chart-header');
        renderPanelTitle(header, `${dayOfWeek}, ${dayData.formattedDate}`, 'calendar', 'h2', 'expensica-chart-title');

        this.renderDailyReviewMetrics(dayData);
        const details = this.detailsContainer.createDiv('expensica-daily-review-details');
        this.renderDailyAccountBalances(details, dayData);

        this.renderDailyCategoryBreakdown(details, dayData.transactions);

        // Create transaction list with header
        const transactionHeader = this.detailsContainer.createDiv('expensica-breakdown-title-container expensica-transactions-header');
        renderPanelTitle(transactionHeader, 'Transactions', 'file', 'h3', 'expensica-breakdown-title expensica-transactions-title');
        if (dayData.transactions.length === 0) {
            const emptyStateEl = this.detailsContainer.createDiv('expensica-calendar-empty-state');
            renderUiIcon(emptyStateEl, 'sparkles', 'expensica-calendar-empty-icon');
            emptyStateEl.createEl('p', {
                text: 'No transactions recorded for this day',
                cls: 'expensica-calendar-empty-message'
            });
            return;
        }

        this.releaseDailyTransactions = this.plugin.renderDailyReviewTransactions(
            this.detailsContainer.createDiv('expensica-daily-review-transactions'), dayData.date,
            transaction => this.onTransactionEdit?.(transaction)
        );
    }

    public selectDate(date: Date) {
        if (this.selectedDate && this.isSameDate(this.selectedDate, date)) return;
        const day = this.calendarData.find(day => this.isSameDate(day.date, date));
        if (!day) return;
        this.selectedDate = day.date;
        this.days.querySelectorAll<HTMLButtonElement>('[data-date]').forEach(button => {
            const selected = button.getAttribute('data-date') === formatDate(day.date);
            button.toggleClass('is-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        this.onSelectedDateChange?.(day.date);
        this.showDayDetails(day);
    }

    public destroy() {
        d3.select(this.container).selectAll('.expensica-category-bar, .expensica-category-segment, .expensica-category-segment-percentage').interrupt();
        this.releaseDailyTransactions?.();
        this.releaseDailyTransactions = undefined;
    }

    public updateMonth(newDate: Date, transactions: Transaction[], selectedDate?: Date) {
        this.currentDate = newDate;
        if (selectedDate) this.selectedDate = selectedDate;
        this.transactions = transactions;
        this.setupContainers();
        this.render();
    }

    public resize(): boolean {
        // CSS stretches sibling panels to the tallest content without constraining the review.
        return false;
    }
}
