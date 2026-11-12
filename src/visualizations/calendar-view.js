import { calendarDate, createCalendarNavigation, createCalendarGrid, monthFormatter, renderCalendarDays, MIN_YEAR, MAX_YEAR } from '../calendar-ui';
import { renderUiIcon, renderPanelTitle, TransactionType, formatCurrency, ColorScheme, formatDate, parseLocalDate, sortTransactionsByDateTimeDesc, getAccountColor } from '../models';
import { getRunningBalanceByTransactionIdForAccount } from '../account-calculations';
import * as d3 from 'd3';
import { renderTransactionCard } from '../transaction-card';
import { setChartTooltip } from '../chart-tooltip';
function formatRunningBalanceLabel(plugin, balance, accountReference) {
    const amount = formatCurrency(balance, plugin.settings.defaultCurrency);
    if (!accountReference)
        return amount;
    return `${plugin.getTransactionAccountDisplay(accountReference).name}: ${amount}`;
}
export class CalendarHeatmap {
    constructor(container, plugin, transactions, currentDate, selectedDate = null, onSelectedDateChange, onTransactionEdit, onMonthChange) {
        this.onMonthChange = onMonthChange;
        this.calendarData = [];
        this.maxAmount = 0;
        this.allTransactions = [];
        this.monthlyExpenseTotal = 0;
        this.runningBalanceCache = new Map();
        this.container = container;
        this.plugin = plugin;
        this.transactions = transactions;
        this.currentDate = currentDate;
        this.selectedDate = selectedDate;
        this.onSelectedDateChange = onSelectedDateChange;
        this.onTransactionEdit = onTransactionEdit;
        this.setupContainers();
    }
    setupContainers() {
        // Clear any existing content
        this.container.empty();
        this.container.removeClass('expensica-calendar-container');
        this.container.addClass('expensica-calendar-flex-container');
        // Keep the calendar grid and day details as independent sibling panels.
        const calendarContainer = this.container.createDiv('expensica-calendar-container expensica-calendar-grid-container');
        this.calendarContainer = calendarContainer;
        this.calendarContainer.addClass('expensica-heatmap');
        const navigation = createCalendarNavigation(calendarContainer, offset => { var _a; return (_a = this.onMonthChange) === null || _a === void 0 ? void 0 : _a.call(this, offset); });
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
        this.detailsContainer = this.container.createDiv('expensica-calendar-details-container');
        renderPanelTitle(this.detailsContainer, 'Click on a day to see transactions', 'calendar', 'h3', 'expensica-calendar-details-title');
    }
    render() {
        this.prepareData();
        this.renderCalendar();
        this.resize();
    }
    prepareData() {
        var _a;
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const daysInMonth = calendarDate(year, month + 1, 0).getDate();
        this.calendarData = [];
        this.maxAmount = 0;
        this.monthlyExpenseTotal = 0;
        this.runningBalanceCache.clear();
        this.allTransactions = this.plugin.getAllTransactions();
        const monthlyTransactionsByDate = new Map();
        this.transactions.forEach((transaction) => {
            const dateKey = this.getDateKey(parseLocalDate(transaction.date));
            const dayTransactions = monthlyTransactionsByDate.get(dateKey);
            if (dayTransactions) {
                dayTransactions.push(transaction);
            }
            else {
                monthlyTransactionsByDate.set(dateKey, [transaction]);
            }
            if (transaction.type === TransactionType.EXPENSE) {
                this.monthlyExpenseTotal += transaction.amount;
            }
        });
        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const runningBalances = this.getRunningBalanceMap(defaultAccountReference);
        const balancesByDate = new Map();
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
            const dayTransactions = (_a = monthlyTransactionsByDate.get(dateKey)) !== null && _a !== void 0 ? _a : [];
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
    getDateKey(date) {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    getRunningBalanceMap(accountReference) {
        const existing = this.runningBalanceCache.get(accountReference);
        if (existing) {
            return existing;
        }
        const balances = getRunningBalanceByTransactionIdForAccount(this.plugin, accountReference, this.allTransactions);
        this.runningBalanceCache.set(accountReference, balances);
        return balances;
    }
    formatDate(date) {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
    // Get the color scale based on the selected color scheme
    getColorScale(maxValue) {
        if (maxValue <= 0) {
            maxValue = 1; // Prevent division by zero
        }
        const colorScheme = this.plugin.settings.calendarColorScheme;
        const createScale = (maxColor) => {
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
    withAlpha(color, alpha) {
        const parsedColor = d3.rgb(color);
        return `rgba(${parsedColor.r}, ${parsedColor.g}, ${parsedColor.b}, ${alpha})`;
    }
    renderCalendar() {
        var _a, _b;
        const today = new Date();
        const selected = (_b = (_a = this.calendarData.find(day => this.selectedDate && this.isSameDate(day.date, this.selectedDate))) !== null && _a !== void 0 ? _a : this.calendarData.find(day => this.isSameDate(day.date, today))) !== null && _b !== void 0 ? _b : this.calendarData.find(day => day.totalAmount > 0);
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
                    return [account.id, account];
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
        this.showDayDetails(selected !== null && selected !== void 0 ? selected : this.calendarData[0]);
    }
    isSameDate(left, right) {
        return left.getFullYear() === right.getFullYear()
            && left.getMonth() === right.getMonth()
            && left.getDate() === right.getDate();
    }
    getTextColor(amount, colorScale) {
        if (amount === 0)
            return 'var(--text-muted)';
        // Transparent/low-opacity heatmap cells visually sit on the Obsidian background.
        const color = d3.rgb(colorScale(amount));
        if (color.opacity < 0.55) {
            return 'var(--text-normal)';
        }
        const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
        return luminance > 160 ? 'var(--text-normal)' : 'var(--text-on-accent)';
    }
    renderColorLegend(colorScale) {
        var _a;
        (_a = this.calendarContainer.querySelector('.expensica-heatmap-legend')) === null || _a === void 0 ? void 0 : _a.remove();
        const legend = this.calendarContainer.createDiv('expensica-heatmap-legend');
        legend.createSpan({ text: 'Spending Intensity', cls: 'expensica-heatmap-legend-title' });
        const stops = Array.from({ length: 11 }, (_, i) => `${colorScale(i / 10 * this.maxAmount)} ${i * 10}%`);
        legend.createDiv('expensica-heatmap-gradient').setCssProps({ '--expensica-heatmap-gradient': `linear-gradient(to right, ${stops.join(', ')})` });
        const labels = legend.createDiv('expensica-heatmap-legend-labels');
        for (const [label, amount] of [['Minimum', 0], ['Maximum', this.maxAmount]]) {
            const item = labels.createDiv();
            item.createSpan({ text: formatCurrency(amount, this.plugin.settings.defaultCurrency) });
            item.createSpan({ text: label });
        }
    }
    showDayDetails(dayData) {
        this.detailsContainer.empty();
        // Get expense transactions
        const expenseTransactions = dayData.transactions.filter(t => t.type === TransactionType.EXPENSE);
        // Get total expenses
        const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
        const defaultAccountReference = this.plugin.normalizeTransactionAccountReference(undefined);
        const dayBalance = dayData.dayBalance;
        // Add title with day of week
        const dayOfWeek = dayData.date.toLocaleDateString('en-US', { weekday: 'long' });
        renderPanelTitle(this.detailsContainer, `${dayOfWeek}, ${dayData.formattedDate}`, 'calendar', 'h3', 'expensica-calendar-details-title');
        // If no expense transactions, show message without the spending summary.
        if (expenseTransactions.length === 0) {
            const emptyStateEl = this.detailsContainer.createDiv('expensica-calendar-empty-state');
            renderUiIcon(emptyStateEl, 'sparkles', 'expensica-calendar-empty-icon');
            emptyStateEl.createEl('p', {
                text: 'No expenses recorded for this day.',
                cls: 'expensica-calendar-empty-message'
            });
            return;
        }
        // Create summary container
        const summaryContainer = this.detailsContainer.createDiv('expensica-calendar-summary');
        const metricsContainer = summaryContainer.createDiv('expensica-calendar-details-metrics');
        // Display spending and balance
        const totalEl = metricsContainer.createDiv('expensica-calendar-details-total');
        // Left side with label and icon
        const labelContainer = totalEl.createDiv('expensica-calendar-details-label');
        // Add currency icon (similar to Notion's approach with icons)
        renderUiIcon(labelContainer, 'expense', 'expensica-calendar-details-icon', 'var(--text-error)');
        labelContainer.createSpan({
            text: 'Total Spent',
            cls: 'expensica-calendar-details-text'
        });
        // Right side with amount
        totalEl.createSpan({
            text: formatCurrency(totalExpenses, this.plugin.settings.defaultCurrency),
            cls: 'expensica-calendar-details-amount expensica-expense'
        });
        const balanceEl = metricsContainer.createDiv('expensica-calendar-details-total');
        const balanceLabelContainer = balanceEl.createDiv('expensica-calendar-details-label');
        renderUiIcon(balanceLabelContainer, 'balance', 'expensica-calendar-details-icon', 'var(--text-accent)');
        balanceLabelContainer.createSpan({
            text: 'Running Balance',
            cls: 'expensica-calendar-details-text'
        });
        balanceEl.createSpan({
            text: formatCurrency(dayBalance, this.plugin.settings.defaultCurrency),
            cls: 'expensica-calendar-details-amount expensica-calendar-details-balance-amount'
        });
        // Calculate and show additional insights if there are expenses
        if (totalExpenses > 0) {
            // Monthly context
            const monthlyTotal = this.monthlyExpenseTotal;
            // Only show insights if we have some monthly spending
            if (monthlyTotal > 0) {
                const percentage = ((totalExpenses / monthlyTotal) * 100).toFixed(1);
                const insightEl = summaryContainer.createDiv('expensica-calendar-insight');
                insightEl.createSpan({
                    text: `This represents ${percentage}% of your monthly spending.`,
                    cls: 'expensica-calendar-insight-text'
                });
                // Daily average comparison
                const daysInMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0).getDate();
                const dailyAverage = monthlyTotal / daysInMonth;
                const percentDiff = ((totalExpenses - dailyAverage) / dailyAverage) * 100;
                if (Math.abs(percentDiff) > 10) {
                    const comparisonEl = summaryContainer.createDiv('expensica-calendar-comparison');
                    if (percentDiff > 0) {
                        comparisonEl.createSpan({
                            text: `${percentDiff.toFixed(0)}% above `,
                            cls: 'expensica-trend-down' // Down is bad for expenses
                        });
                    }
                    else {
                        comparisonEl.createSpan({
                            text: `${Math.abs(percentDiff).toFixed(0)}% below `,
                            cls: 'expensica-trend-up' // Up is good for expenses
                        });
                    }
                    comparisonEl.createSpan({
                        text: `your daily average of ${formatCurrency(dailyAverage, this.plugin.settings.defaultCurrency)}`
                    });
                }
                // Add category breakdown if there are multiple categories
                const categories = new Map();
                expenseTransactions.forEach(t => {
                    const category = this.plugin.getCategoryById(t.category);
                    const categoryName = category ? category.name : 'Other Expenses';
                    const categoryColor = category
                        ? this.plugin.getCategoryColor(category.id, category.name)
                        : this.plugin.getCategoryColor(t.category, categoryName);
                    if (!categories.has(categoryName)) {
                        categories.set(categoryName, {
                            amount: 0,
                            color: categoryColor
                        });
                    }
                    const existingCategory = categories.get(categoryName);
                    if (existingCategory)
                        existingCategory.amount += t.amount;
                });
                if (categories.size > 1) {
                    const breakdownEl = summaryContainer.createDiv('expensica-category-breakdown');
                    // Create title container with icon
                    const titleContainer = breakdownEl.createDiv('expensica-breakdown-title-container');
                    // Add icon
                    renderUiIcon(titleContainer, 'budget', 'expensica-breakdown-icon');
                    // Add title text
                    titleContainer.createEl('h4', {
                        text: 'Category Breakdown',
                        cls: 'expensica-breakdown-title'
                    });
                    const breakdownChart = breakdownEl.createDiv('expensica-breakdown-chart');
                    // Sort categories by amount
                    const sortedCategories = Array.from(categories.entries())
                        .sort((a, b) => b[1].amount - a[1].amount);
                    // Calculate bar widths based on percentage
                    sortedCategories.forEach(([categoryName, categoryData]) => {
                        const amount = categoryData.amount;
                        const percentage = (amount / totalExpenses) * 100;
                        const categoryBar = breakdownChart.createDiv('expensica-category-bar');
                        // Create the color bar
                        const colorBar = categoryBar.createDiv('expensica-bar-fill color-bar-fill color-bar-hue');
                        colorBar.setCssProps({
                            '--color-bar-percentage': `${percentage}%`,
                            '--category-color': categoryData.color
                        });
                        // Label with amount and percentage
                        const labelEl = categoryBar.createDiv('expensica-bar-label');
                        labelEl.createSpan({
                            text: categoryName,
                            cls: 'expensica-bar-category'
                        });
                        labelEl.createSpan({
                            text: `${formatCurrency(amount, this.plugin.settings.defaultCurrency)} (${percentage.toFixed(0)}%)`,
                            cls: 'expensica-bar-amount'
                        });
                    });
                }
            }
        }
        // Create transaction list with header
        const transactionHeader = this.detailsContainer.createDiv('expensica-transactions-header');
        transactionHeader.createEl('h4', { text: 'Expenses', cls: 'expensica-transactions-title' });
        const transactionList = this.detailsContainer.createDiv('expensica-calendar-transaction-list');
        // Use the same chronology and canonical source ties as the other transaction views.
        const sortedTransactions = sortTransactionsByDateTimeDesc(expenseTransactions, this.allTransactions);
        const runningBalances = this.getRunningBalanceMap(defaultAccountReference);
        const internalBalanceMaps = new Map();
        const ensureBalanceMap = (accountReference) => {
            const existing = internalBalanceMaps.get(accountReference);
            if (existing) {
                return existing;
            }
            const balances = accountReference === defaultAccountReference
                ? runningBalances
                : this.getRunningBalanceMap(accountReference);
            internalBalanceMaps.set(accountReference, balances);
            return balances;
        };
        // Add each transaction
        sortedTransactions.forEach((transaction, index) => {
            var _a, _b, _c;
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
            const transactionEl = renderTransactionCard(transactionList, {
                plugin: this.plugin,
                transaction,
                runningBalanceLabel,
                secondaryRunningBalanceLabel,
                onEdit: this.onTransactionEdit,
                onCategoryChange: async (transaction, categoryId) => {
                    await this.updateTransactionCategory(transaction, categoryId);
                }
            });
            transactionEl.addClass('expensica-calendar-transaction-item');
            transactionEl.addClass('transaction-animate-delay');
            transactionEl.classList.add(`transaction-delay-${index * 50}`);
            transactionEl.classList.add('expensica-transaction-animate');
            if (sortedTransactions.length > 1) {
                const amountEl = transactionEl.querySelector('.expensica-transaction-amount');
                amountEl === null || amountEl === void 0 ? void 0 : amountEl.createSpan({
                    text: `${((transaction.amount / totalExpenses) * 100).toFixed(0)}%`,
                    cls: 'expensica-percentage'
                });
            }
            // Add animation delay for staggered entrance
            transactionEl.setCssProps({ '--transaction-delay': `${index * 50}ms` });
        });
    }
    async updateTransactionCategory(transaction, categoryId) {
        await this.plugin.updateTransaction({
            ...transaction,
            category: categoryId
        });
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        this.transactions = this.plugin.getTransactionsForMonth(year, month);
        this.prepareData();
        const selectedDayData = this.calendarData.find(dayData => this.isSameDate(dayData.date, parseLocalDate(transaction.date)));
        if (selectedDayData) {
            this.showDayDetails(selectedDayData);
        }
    }
    selectDate(date) {
        var _a;
        if (this.selectedDate && this.isSameDate(this.selectedDate, date))
            return;
        const day = this.calendarData.find(day => this.isSameDate(day.date, date));
        if (!day)
            return;
        this.selectedDate = day.date;
        this.days.querySelectorAll('[data-date]').forEach(button => {
            const selected = button.getAttribute('data-date') === formatDate(day.date);
            button.toggleClass('is-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        (_a = this.onSelectedDateChange) === null || _a === void 0 ? void 0 : _a.call(this, day.date);
        this.showDayDetails(day);
    }
    updateMonth(newDate, transactions, selectedDate) {
        this.currentDate = newDate;
        if (selectedDate)
            this.selectedDate = selectedDate;
        this.transactions = transactions;
        this.setupContainers();
        this.render();
    }
    resize() {
        // CSS owns wrapping and natural sizing. Only the scrollable details need the grid's height.
        const stacked = this.detailsContainer.offsetTop > this.calendarContainer.offsetTop;
        this.detailsContainer.style.height = stacked ? '' : `${this.calendarContainer.getBoundingClientRect().height}px`;
        return false;
    }
}
