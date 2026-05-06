import { __awaiter } from "tslib";
import { AccountType, TransactionType, formatCurrency, ColorScheme, parseLocalDate, sortTransactionsByDateTimeDesc, getCurrencyByCode } from '../models';
import * as d3 from 'd3';
import { renderTransactionCard } from '../transaction-card';
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
export class CalendarHeatmap {
    constructor(container, plugin, transactions, currentDate, selectedDate = null, onSelectedDateChange, onTransactionEdit) {
        this.calendarData = [];
        this.width = 0;
        this.height = 0;
        this.cellSize = 48;
        this.cellGap = 6;
        this.maxAmount = 0;
        this.defaultCellSize = 48;
        this.minimumCellScale = 0.75;
        this.weekNumberWidth = 32; // Reserve one day-column width for week numbers.
        this.calendarHorizontalPadding = 8;
        this.lastRenderedLayoutKey = '';
        this.lastMeasuredContainerSizeKey = '';
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
        this.createTooltip();
    }
    setupContainers() {
        var _a;
        // Clear any existing content
        this.container.empty();
        this.container.removeClass('expensica-calendar-container');
        this.container.addClass('expensica-calendar-flex-container');
        // Keep the calendar grid and day details as independent sibling panels.
        const calendarContainer = this.container.createDiv('expensica-calendar-container expensica-calendar-grid-container');
        this.calendarContainer = calendarContainer;
        // Create the details container for transaction details
        this.detailsContainer = this.container.createDiv('expensica-calendar-details-container');
        this.detailsContainer.createEl('h3', {
            text: 'Click on a day to see transactions',
            cls: 'expensica-calendar-details-title'
        });
        const renderableWidth = (_a = this.getRenderableWidth(this.container)) !== null && _a !== void 0 ? _a : this.getNaturalCalendarWidth();
        this.updateCalendarHorizontalPadding(renderableWidth);
        this.updateStackedLayout(renderableWidth);
        // Size the SVG to the actual calendar grid instead of the full panel width.
        this.width = this.getCalendarGridWidth();
        // Calculate additional width for week numbers if enabled
        const weekNumbersOffset = this.getWeekNumbersOffset();
        // Calculate height based on number of weeks in the month
        const weeksInMonth = this.getWeeksInMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        const calendarHeight = (weeksInMonth + 1) * (this.cellSize + this.cellGap) + 50; // Calendar height
        // Add extra space at the bottom for the legend (90px instead of 75px)
        this.height = calendarHeight + 90;
        // Create the SVG inside the calendar container
        this.svg = d3.select(calendarContainer)
            .append('svg')
            .attr('width', this.width + weekNumbersOffset)
            .attr('height', this.height)
            .attr('viewBox', `0 0 ${this.width + weekNumbersOffset} ${this.height}`)
            .attr('class', 'expensica-calendar-svg');
        this.updateCalendarScaleBounds(this.width + weekNumbersOffset);
        this.updateDetailsPanelHeight();
        this.lastRenderedLayoutKey = this.getLayoutKey(this.width + weekNumbersOffset, this.height);
        this.lastMeasuredContainerSizeKey = this.getContainerSizeKey(this.container);
    }
    createTooltip() {
        this.tooltipDiv = d3.select(this.container)
            .append('div')
            .attr('class', 'expensica-calendar-tooltip')
            .style('opacity', 0);
    }
    render(animateCells = false) {
        this.prepareData();
        this.renderCalendar(animateCells);
    }
    prepareData() {
        var _a;
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        this.calendarData = [];
        this.maxAmount = 0;
        this.monthlyExpenseTotal = 0;
        this.runningBalanceCache.clear();
        this.allTransactions = this.plugin.getAllTransactions();
        const monthlyTransactionsByDate = new Map();
        this.transactions.forEach((transaction) => {
            const dateKey = transaction.date;
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
        const balancesByDate = new Map();
        let runningBalance = 0;
        sortTransactionsByDateTimeDesc(this.allTransactions)
            .reverse()
            .forEach((transaction) => {
            runningBalance += getAccountTransactionAmount(this.plugin, transaction, defaultAccountReference);
            balancesByDate.set(transaction.date, Math.abs(runningBalance) < 0.000001 ? 0 : runningBalance);
        });
        let carriedBalance = 0;
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
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
    getWeeksInMonth(year, month) {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        return Math.ceil((firstDay + daysInMonth) / 7);
    }
    // Get the week number for a given date (ISO week number)
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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
    renderCalendar(animateCells = false) {
        // Clear SVG
        this.svg.selectAll('*').remove();
        const monthLabel = this.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        // Calculate week numbers offset if enabled
        const weekNumbersOffset = this.getWeekNumbersOffset();
        // Calculate calendar height (without the legend space)
        const weeksInMonth = this.getWeeksInMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        const calendarHeight = (weeksInMonth + 1) * (this.cellSize + this.cellGap) + 50;
        // Add month label with Notion-inspired styling
        this.svg.append('text')
            .attr('class', 'month-label')
            .attr('x', (this.width + weekNumbersOffset) / 2)
            .attr('y', 25)
            .attr('text-anchor', 'middle')
            .attr('font-size', '16px')
            .attr('font-weight', '500')
            .attr('fill', 'var(--text-normal)')
            .text(monthLabel);
        // Days of the week - Shorter Notion-like format
        const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        this.svg.selectAll('.day-of-week')
            .data(daysOfWeek)
            .enter()
            .append('text')
            .attr('class', 'day-of-week')
            .attr('x', (d, i) => this.calendarHorizontalPadding + weekNumbersOffset + i * (this.cellSize + this.cellGap) + this.cellSize / 2)
            .attr('y', 60)
            .attr('text-anchor', 'middle')
            .attr('font-size', '12px')
            .attr('fill', 'var(--text-muted)')
            .text((d) => d);
        // Calculate colorscale based on max expense amount using the selected color scheme
        const colorScale = this.getColorScale(this.maxAmount);
        // Create day cells
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        // Get current day for today's highlight
        const today = new Date();
        const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
        const todayDate = today.getDate();
        // Track selected cell for reference
        let selectedCell = null;
        // Add week numbers if enabled
        if (this.plugin.settings.showWeekNumbers) {
            // Add "Week" header
            this.svg.append('text')
                .attr('class', 'week-label')
                .attr('x', this.calendarHorizontalPadding + this.weekNumberWidth / 2)
                .attr('y', 60)
                .attr('text-anchor', 'middle')
                .attr('font-size', '11px')
                .attr('fill', 'var(--text-faint)')
                .text('Wk');
            // Add week numbers
            const weeksInMonth = this.getWeeksInMonth(year, month);
            const firstDayDate = new Date(year, month, 1);
            for (let week = 0; week < weeksInMonth; week++) {
                // Calculate the date for the first day of this week
                const weekStart = new Date(year, month, 1 + (week * 7) - firstDayOfMonth);
                // Get week number
                const weekNumber = this.getWeekNumber(weekStart);
                this.svg.append('text')
                    .attr('class', 'week-number')
                    .attr('x', this.calendarHorizontalPadding + this.weekNumberWidth / 2)
                    .attr('y', (week + 1) * (this.cellSize + this.cellGap) + 60)
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'middle')
                    .attr('font-size', '11px')
                    .attr('fill', 'var(--text-faint)')
                    .text(weekNumber);
            }
        }
        const dayCells = this.svg.selectAll('.day-cell')
            .data(this.calendarData)
            .enter()
            .append('g')
            .attr('class', 'day-cell')
            .attr('transform', (d, i) => {
            const dayOfMonth = d.date.getDate();
            const dayOfWeek = d.date.getDay();
            const weekOfMonth = Math.floor((dayOfMonth + firstDayOfMonth - 1) / 7);
            // Calculate position with added gap between cells
            const xPos = this.calendarHorizontalPadding + weekNumbersOffset + dayOfWeek * (this.cellSize + this.cellGap);
            const yPos = (weekOfMonth + 1) * (this.cellSize + this.cellGap) + 40;
            return `translate(${xPos}, ${yPos})`;
        });
        // Add cell background with Notion-inspired visual design
        dayCells.append('rect')
            .attr('width', this.cellSize - 4)
            .attr('height', this.cellSize - 4)
            .attr('rx', 4) // Subtle rounded corners like Notion
            .attr('ry', 4)
            .attr('fill', (d) => d.totalAmount > 0 ? colorScale(d.totalAmount) : 'transparent')
            .attr('stroke', (d) => {
            // Highlight today's date with a special border
            if (isCurrentMonth && d.date.getDate() === todayDate) {
                return 'var(--interactive-accent)';
            }
            return 'var(--background-modifier-border)'; // Using a more visible border color from Obsidian
        })
            .attr('stroke-width', (d) => {
            return isCurrentMonth && d.date.getDate() === todayDate ? 2 : 1.5;
        })
            .attr('opacity', (d) => {
            // More subtle opacity for Notion-like aesthetic
            const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
            if (d.totalAmount > 0) {
                return 1.0; // Full opacity for cells with expenses
            }
            return isWeekend ? 0.7 : 0.6; // Subtle distinction for weekend days
        })
            .classed('has-expenses', (d) => d.totalAmount > 0)
            .classed('is-today', (d) => isCurrentMonth && d.date.getDate() === todayDate)
            .on('mouseover', (event, d) => {
            // Highlight the cell
            const cell = d3.select(event.currentTarget);
            cell.transition()
                .duration(100) // Faster transition for better responsiveness
                .attr('stroke', 'var(--interactive-accent)')
                .attr('stroke-width', 2) // Consistent with non-selected cells
                .attr('opacity', 1);
            // Show tooltip
            this.tooltipDiv.transition()
                .duration(100)
                .style('opacity', .9);
            const formatCurrencyValue = (value) => {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: this.plugin.settings.defaultCurrency
                }).format(value);
            };
            // Count only expense transactions
            const expenseTransactions = d.transactions.filter(t => t.type === TransactionType.EXPENSE);
            // Calculate percentage of monthly expenses for this day
            const monthlyTotal = this.transactions
                .filter(t => t.type === TransactionType.EXPENSE)
                .reduce((sum, t) => sum + t.amount, 0);
            const percentage = monthlyTotal > 0 ? ((d.totalAmount / monthlyTotal) * 100).toFixed(1) : '0';
            // Determine if this day is above average
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dailyAverage = monthlyTotal / daysInMonth;
            const comparedToAverage = dailyAverage > 0
                ? (((d.totalAmount - dailyAverage) / dailyAverage) * 100).toFixed(0)
                : '0';
            let comparisonText = '';
            if (d.totalAmount > 0) {
                if (parseInt(comparedToAverage) > 20) {
                    comparisonText = `<div class="tooltip-comparison tooltip-higher">▲ ${comparedToAverage}% above daily average</div>`;
                }
                else if (parseInt(comparedToAverage) < -20) {
                    comparisonText = `<div class="tooltip-comparison tooltip-lower">▼ ${Math.abs(parseInt(comparedToAverage))}% below daily average</div>`;
                }
            }
            // Enhanced tooltip with more context
            this.tooltipDiv.html(`
                    <div class="tooltip-title">${d.formattedDate}</div>
                    <div class="tooltip-value">${formatCurrencyValue(d.totalAmount)}</div>
                    <div class="tooltip-hint">${expenseTransactions.length} expense(s) · ${percentage}% of monthly spend</div>
                    ${comparisonText}
                `)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        })
            .on('mouseout', (event, d) => {
            // Don't reset if this is the selected cell
            if (selectedCell && selectedCell.node() === event.currentTarget) {
                return;
            }
            // Reset the cell with Notion styling
            d3.select(event.currentTarget)
                .transition()
                .duration(100) // Faster transition for better responsiveness
                .attr('stroke', (d) => {
                // Maintain today's highlight
                if (isCurrentMonth && d.date.getDate() === todayDate) {
                    return 'var(--interactive-accent)';
                }
                return 'var(--background-modifier-border)'; // Using a more visible border color from Obsidian
            })
                .attr('stroke-width', (d) => {
                return isCurrentMonth && d.date.getDate() === todayDate ? 2 : 1.5;
            })
                .attr('opacity', (d) => {
                // Notion-like opacity values
                const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                if (d.totalAmount > 0) {
                    return 1.0; // Full opacity for cells with expenses
                }
                return isWeekend ? 0.7 : 0.6; // Subtle distinction for weekend days
            });
            // Hide tooltip with subtle fade
            this.tooltipDiv.transition()
                .duration(100)
                .style('opacity', 0);
        })
            .on('click', (event, d) => {
            var _a;
            // Remove previous selection
            if (selectedCell) {
                selectedCell
                    .attr('stroke', (d) => {
                    // Maintain today's highlight with Notion styling
                    if (isCurrentMonth && d.date.getDate() === todayDate) {
                        return 'var(--interactive-accent)';
                    }
                    return 'var(--background-modifier-border)'; // Using a more visible border color from Obsidian
                })
                    .attr('stroke-width', (d) => {
                    return isCurrentMonth && d.date.getDate() === todayDate ? 2 : 1.5;
                });
            }
            // Highlight the selected cell with a Notion-like subtle highlight
            selectedCell = d3.select(event.currentTarget);
            selectedCell
                .attr('stroke', 'var(--interactive-accent)')
                .attr('stroke-width', 2.5); // Increased thickness for better visibility
            this.selectedDate = d.date;
            (_a = this.onSelectedDateChange) === null || _a === void 0 ? void 0 : _a.call(this, d.date);
            // Show transaction details with a nice transition
            this.showDayDetails(d);
        });
        // Add day number with Notion-inspired styling
        dayCells.append('text')
            .attr('x', this.cellSize / 2 - 2)
            .attr('y', this.cellSize / 2 - 6)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', '13px')
            .attr('font-weight', (d) => d.totalAmount > 0 ? '500' : '400')
            .attr('pointer-events', 'none')
            .attr('fill', (d) => {
            if (d.totalAmount > 0) {
                return this.getTextColor(d.totalAmount, colorScale);
            }
            return 'var(--text-normal)';
        })
            .text((d) => d.date.getDate());
        // Add spending amount for days with expenses with Notion-like styling
        dayCells.filter((d) => d.totalAmount > 0)
            .append('text')
            .attr('x', this.cellSize / 2 - 2)
            .attr('y', this.cellSize / 2 + 12)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('font-weight', '500')
            .attr('pointer-events', 'none')
            .attr('fill', (d) => this.getTextColor(d.totalAmount, colorScale))
            .text((d) => {
            const currency = this.plugin.settings.defaultCurrency;
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency,
                notation: 'compact',
                maximumFractionDigits: 0
            }).format(d.totalAmount);
        });
        // Add tiny indicator for days with income
        dayCells.filter((d) => d.transactions.some(t => t.type === TransactionType.INCOME))
            .append('circle')
            .attr('cx', this.cellSize - 12)
            .attr('cy', 10)
            .attr('r', 3.5)
            .attr('fill', 'var(--expensica-success)')
            .attr('pointer-events', 'none')
            .attr('opacity', 0.8);
        // Add color legend
        this.renderColorLegend(colorScale, weekNumbersOffset, calendarHeight);
        if (animateCells) {
            // Only animate when month/data changes, not during resize or workspace focus refreshes.
            dayCells
                .style('opacity', 0)
                .transition()
                .duration(500)
                .delay((d, i) => {
                const dayOfMonth = d.date.getDate();
                const dayOfWeek = d.date.getDay();
                const weekOfMonth = Math.floor((dayOfMonth + firstDayOfMonth - 1) / 7);
                return (weekOfMonth * 7 + dayOfWeek) * 20;
            })
                .style('opacity', 1);
        }
        const selectedData = this.selectedDate
            ? this.calendarData.find(d => this.isSameDate(d.date, this.selectedDate))
            : null;
        if (selectedData) {
            this.showDayDetails(selectedData);
            const selectedDateCell = this.svg.selectAll('.day-cell rect')
                .filter((d) => this.isSameDate(d.date, selectedData.date));
            selectedDateCell.attr('stroke', 'var(--interactive-accent)')
                .attr('stroke-width', 2.5);
            selectedCell = selectedDateCell;
        }
        else if (isCurrentMonth) {
            const todayData = this.calendarData.find(d => d.date.getDate() === todayDate);
            if (todayData) {
                this.showDayDetails(todayData);
                // Also visually select today's cell
                const todayCell = this.svg.selectAll('.day-cell rect')
                    .filter((d) => d.date.getDate() === todayDate);
                todayCell.attr('stroke', 'var(--interactive-accent)')
                    .attr('stroke-width', 2);
                selectedCell = todayCell;
            }
        }
        else {
            // Find the first day with expenses as fallback
            const firstDayWithExpenses = this.calendarData.find(d => d.totalAmount > 0);
            if (firstDayWithExpenses) {
                this.showDayDetails(firstDayWithExpenses);
                // Also visually select this cell
                const firstExpenseCell = this.svg.selectAll('.day-cell rect')
                    .filter((d) => d.date.getDate() === firstDayWithExpenses.date.getDate());
                firstExpenseCell.attr('stroke', 'var(--interactive-accent)')
                    .attr('stroke-width', 2);
                selectedCell = firstExpenseCell;
            }
            else {
                // Default to first day of month if no expenses
                this.showDayDetails(this.calendarData[0]);
            }
        }
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
    renderColorLegend(colorScale, weekNumbersOffset, calendarHeight) {
        // Create a centered legend at the bottom with improved Notion-inspired styling
        const legendWidth = 220; // Wider legend for better visibility
        const legendHeight = 16; // Taller bar for better visibility
        const legendY = calendarHeight + 35; // Increased from 20px to 35px for more space at the top
        const legend = this.svg.append('g')
            .attr('class', 'legend')
            .attr('transform', `translate(${(this.width + weekNumbersOffset - legendWidth) / 2}, ${legendY})`);
        // Add legend title with improved styling
        legend.append('text')
            .attr('x', legendWidth / 2)
            .attr('y', -15)
            .attr('text-anchor', 'middle')
            .attr('font-size', '13px')
            .attr('font-weight', '500')
            .attr('fill', 'var(--text-normal)')
            .text('Spending Intensity');
        // Create gradient
        const defs = this.svg.append('defs');
        const gradient = defs.append('linearGradient')
            .attr('id', 'legend-gradient')
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '100%')
            .attr('y2', '0%');
        // Add color stops
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const offset = i / steps;
            const value = offset * this.maxAmount;
            gradient.append('stop')
                .attr('offset', `${offset * 100}%`)
                .attr('stop-color', colorScale(value));
        }
        // Draw the gradient rect with improved styling
        legend.append('rect')
            .attr('width', legendWidth)
            .attr('height', legendHeight)
            .attr('fill', 'url(#legend-gradient)')
            .attr('rx', 4) // More noticeable rounding
            .attr('ry', 4)
            .attr('stroke', 'var(--background-modifier-border)') // Match cell border color
            .attr('stroke-width', 1.5); // Match cell border thickness
        // Add min and max labels with improved styling
        legend.append('text')
            .attr('x', 0)
            .attr('y', legendHeight + 16)
            .attr('text-anchor', 'start')
            .attr('font-size', '12px')
            .attr('font-weight', '500')
            .attr('fill', 'var(--text-muted)')
            .text(formatCurrency(0, this.plugin.settings.defaultCurrency));
        legend.append('text')
            .attr('x', legendWidth)
            .attr('y', legendHeight + 16)
            .attr('text-anchor', 'end')
            .attr('font-size', '12px')
            .attr('font-weight', '500')
            .attr('fill', 'var(--text-muted)')
            .text(formatCurrency(this.maxAmount, this.plugin.settings.defaultCurrency));
        // Add "min" and "max" labels for clarity
        legend.append('text')
            .attr('x', 0)
            .attr('y', legendHeight + 32)
            .attr('text-anchor', 'start')
            .attr('font-size', '10px')
            .attr('fill', 'var(--text-faint)')
            .text('Minimum');
        legend.append('text')
            .attr('x', legendWidth)
            .attr('y', legendHeight + 32)
            .attr('text-anchor', 'end')
            .attr('font-size', '10px')
            .attr('fill', 'var(--text-faint)')
            .text('Maximum');
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
        this.detailsContainer.createEl('h3', {
            text: `${dayOfWeek}, ${dayData.formattedDate}`,
            cls: 'expensica-calendar-details-title'
        });
        // If no expense transactions, show message without the spending summary.
        if (expenseTransactions.length === 0) {
            const emptyStateEl = this.detailsContainer.createDiv('expensica-calendar-empty-state');
            emptyStateEl.createEl('div', { text: '✨', cls: 'expensica-calendar-empty-icon' });
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
        const iconSpan = labelContainer.createSpan({
            cls: 'expensica-calendar-details-icon',
            text: '💰'
        });
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
        balanceLabelContainer.createSpan({
            cls: 'expensica-calendar-details-icon',
            text: '💸'
        });
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
                    existingCategory.amount += t.amount;
                });
                if (categories.size > 1) {
                    const breakdownEl = summaryContainer.createDiv('expensica-category-breakdown');
                    // Create title container with icon
                    const titleContainer = breakdownEl.createDiv('expensica-breakdown-title-container');
                    // Add icon
                    const iconSpan = titleContainer.createSpan({
                        cls: 'expensica-breakdown-icon',
                        text: '📊'
                    });
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
                        colorBar.setAttribute('style', `--color-bar-percentage: ${percentage}%; --category-color: ${categoryData.color}`);
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
        // Sort transactions by creation time (newest first), with legacy ID/JSON-order fallbacks.
        const sortedTransactions = sortTransactionsByDateTimeDesc(expenseTransactions);
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
                onCategoryChange: (transaction, categoryId) => __awaiter(this, void 0, void 0, function* () {
                    yield this.updateTransactionCategory(transaction, categoryId);
                })
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
            transactionEl.setAttribute('style', `--transaction-delay: ${index * 50}ms`);
        });
    }
    updateTransactionCategory(transaction, categoryId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.plugin.updateTransaction(Object.assign(Object.assign({}, transaction), { category: categoryId }));
            const year = this.currentDate.getFullYear();
            const month = this.currentDate.getMonth();
            this.transactions = this.plugin.getTransactionsForMonth(year, month);
            this.prepareData();
            const selectedDayData = this.calendarData.find(dayData => this.isSameDate(dayData.date, parseLocalDate(transaction.date)));
            if (selectedDayData) {
                this.showDayDetails(selectedDayData);
            }
        });
    }
    updateMonth(newDate, transactions) {
        this.currentDate = newDate;
        this.transactions = transactions;
        this.maxAmount = 0;
        this.setupContainers();
        this.render(true);
    }
    resize() {
        const containerSizeKey = this.getContainerSizeKey(this.container);
        if (containerSizeKey === this.lastMeasuredContainerSizeKey) {
            return false;
        }
        const width = this.getRenderableWidth(this.container);
        if (!width) {
            this.updateCalendarHorizontalPadding(0);
            this.updateStackedLayout(0);
            this.lastMeasuredContainerSizeKey = this.getContainerSizeKey(this.container);
            return false;
        }
        this.updateCalendarHorizontalPadding(width);
        this.updateStackedLayout(width);
        this.updateDetailsPanelHeight();
        this.lastMeasuredContainerSizeKey = this.getContainerSizeKey(this.container);
        return false;
    }
    updateCalendarHorizontalPadding(availableWidth) {
        this.calendarHorizontalPadding = this.isMobileLayout() ? 8 : 16;
    }
    updateStackedLayout(availableWidth) {
        const detailsMinimumWidth = 300;
        const panelGap = 16;
        const weekNumbersOffset = this.getWeekNumbersOffset();
        const calendarWidth = this.getCalendarGridWidth() + weekNumbersOffset;
        const isStacked = this.isMobileLayout() || availableWidth < calendarWidth + detailsMinimumWidth + panelGap;
        this.container.toggleClass('expensica-calendar-stacked', isStacked);
        if (isStacked && this.detailsContainer) {
            this.detailsContainer.style.removeProperty('height');
            this.detailsContainer.style.removeProperty('max-height');
        }
    }
    updateCalendarScaleBounds(svgWidth) {
        const minimumSvgWidth = svgWidth * this.minimumCellScale;
        this.calendarContainer.style.setProperty('--expensica-panel-natural-width', `${svgWidth}px`);
        this.calendarContainer.style.setProperty('--expensica-panel-min-width', `${minimumSvgWidth}px`);
    }
    getCalendarGridWidth() {
        return (7 * this.cellSize) + (6 * this.cellGap) + (this.calendarHorizontalPadding * 2);
    }
    getNaturalCalendarWidth() {
        return (7 * this.defaultCellSize) + (6 * this.cellGap) + (this.calendarHorizontalPadding * 2) + this.getWeekNumbersOffset();
    }
    updateDetailsPanelHeight() {
        var _a, _b;
        if (!this.detailsContainer || this.isMobileLayout() || this.container.hasClass('expensica-calendar-stacked')) {
            (_a = this.detailsContainer) === null || _a === void 0 ? void 0 : _a.style.removeProperty('height');
            (_b = this.detailsContainer) === null || _b === void 0 ? void 0 : _b.style.removeProperty('max-height');
            return;
        }
        const calendarHeight = this.calendarContainer.getBoundingClientRect().height;
        const detailsHeight = calendarHeight > 0 ? calendarHeight : this.height;
        this.detailsContainer.style.boxSizing = 'border-box';
        this.detailsContainer.style.height = `${detailsHeight}px`;
        this.detailsContainer.style.maxHeight = `${detailsHeight}px`;
    }
    getLayoutKey(svgWidth, svgHeight) {
        return [
            Math.round(svgWidth),
            Math.round(svgHeight),
            this.cellGap,
            this.calendarHorizontalPadding,
            this.getWeekNumbersOffset()
        ].join(':');
    }
    getContainerSizeKey(calendarContainer) {
        if (!calendarContainer) {
            return '';
        }
        const rect = calendarContainer.getBoundingClientRect();
        return [
            Math.round(rect.width),
            this.plugin.settings.showWeekNumbers ? 'weeks' : 'no-weeks',
            this.isMobileLayout() ? 'mobile' : 'desktop'
        ].join(':');
    }
    isMobileLayout() {
        return document.body.classList.contains('is-mobile') || !!this.container.closest('.is-mobile');
    }
    getWeekNumbersOffset() {
        return this.plugin.settings.showWeekNumbers ? this.weekNumberWidth : 0;
    }
    getRenderableWidth(calendarContainer) {
        var _a, _b;
        if (!calendarContainer) {
            return null;
        }
        const candidates = [
            calendarContainer,
            calendarContainer.parentElement,
            (_a = calendarContainer.parentElement) === null || _a === void 0 ? void 0 : _a.parentElement,
            this.container,
            this.container.parentElement,
            (_b = this.container.parentElement) === null || _b === void 0 ? void 0 : _b.parentElement
        ];
        const widths = candidates
            .filter((element) => !!element)
            .map(element => element.getBoundingClientRect().width)
            .filter(width => width > 0);
        return widths.length > 0 ? Math.min(...widths) : null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FsZW5kYXItdmlldy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNhbGVuZGFyLXZpZXcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLE9BQU8sRUFBRSxXQUFXLEVBQWUsZUFBZSxFQUFFLGNBQWMsRUFBRSxXQUFXLEVBQUUsY0FBYyxFQUFFLDhCQUE4QixFQUFFLGlCQUFpQixFQUFFLE1BQU0sV0FBVyxDQUFDO0FBRXRLLE9BQU8sS0FBSyxFQUFFLE1BQU0sSUFBSSxDQUFDO0FBQ3pCLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBRTVELFNBQVMsMkJBQTJCLENBQUMsTUFBdUIsRUFBRSxXQUF3QixFQUFFLGdCQUF3QjtJQUM1RyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsc0JBQXNCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztJQUNoRSxNQUFNLFFBQVEsR0FBRyxDQUFBLE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxJQUFJLE1BQUssV0FBVyxDQUFDLE1BQU0sQ0FBQztJQUV0RCxJQUFJLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDLFFBQVEsRUFBRTtRQUMvQyxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsb0NBQW9DLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDeEgsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLG9DQUFvQyxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ2xILElBQUksV0FBVyxLQUFLLGdCQUFnQixFQUFFO1lBQ2xDLE9BQU8sUUFBUSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUM7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LENBQUMsQ0FBQztJQUNuRyxDQUFDO0lBRU8sb0JBQW9CO1FBQ3hCLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDM0UsQ0FBQztJQUVPLGtCQUFrQixDQUFDLGlCQUFpRDs7UUFDeEUsSUFBSSxDQUFDLGlCQUFpQixFQUFFO1lBQ3BCLE9BQU8sSUFBSSxDQUFDO1NBQ2Y7UUFFRCxNQUFNLFVBQVUsR0FBRztZQUNmLGlCQUFpQjtZQUNqQixpQkFBaUIsQ0FBQyxhQUFhO1lBQy9CLE1BQUEsaUJBQWlCLENBQUMsYUFBYSwwQ0FBRSxhQUFhO1lBQzlDLElBQUksQ0FBQyxTQUFTO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhO1lBQzVCLE1BQUEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLDBDQUFFLGFBQWE7U0FDOUMsQ0FBQztRQUNGLE1BQU0sTUFBTSxHQUFHLFVBQVU7YUFDcEIsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUEwQixFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQzthQUN0RCxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxLQUFLLENBQUM7YUFDckQsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRWhDLE9BQU8sTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0lBQzFELENBQUM7Q0FDSiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFjY291bnRUeXBlLCBUcmFuc2FjdGlvbiwgVHJhbnNhY3Rpb25UeXBlLCBmb3JtYXRDdXJyZW5jeSwgQ29sb3JTY2hlbWUsIHBhcnNlTG9jYWxEYXRlLCBzb3J0VHJhbnNhY3Rpb25zQnlEYXRlVGltZURlc2MsIGdldEN1cnJlbmN5QnlDb2RlIH0gZnJvbSAnLi4vbW9kZWxzJztcbmltcG9ydCBFeHBlbnNpY2FQbHVnaW4gZnJvbSAnLi4vLi4vbWFpbic7XG5pbXBvcnQgKiBhcyBkMyBmcm9tICdkMyc7XG5pbXBvcnQgeyByZW5kZXJUcmFuc2FjdGlvbkNhcmQgfSBmcm9tICcuLi90cmFuc2FjdGlvbi1jYXJkJztcblxuZnVuY3Rpb24gZ2V0QWNjb3VudFRyYW5zYWN0aW9uQW1vdW50KHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luLCB0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24sIGFjY291bnRSZWZlcmVuY2U6IHN0cmluZyk6IG51bWJlciB7XG4gICAgY29uc3QgYWNjb3VudCA9IHBsdWdpbi5maW5kQWNjb3VudEJ5UmVmZXJlbmNlKGFjY291bnRSZWZlcmVuY2UpO1xuICAgIGNvbnN0IGlzQ3JlZGl0ID0gYWNjb3VudD8udHlwZSA9PT0gQWNjb3VudFR5cGUuQ1JFRElUO1xuXG4gICAgaWYgKHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTlRFUk5BTCkge1xuICAgICAgICBjb25zdCBmcm9tQWNjb3VudCA9IHRyYW5zYWN0aW9uLmZyb21BY2NvdW50ID8gcGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi5mcm9tQWNjb3VudCkgOiAnJztcbiAgICAgICAgY29uc3QgdG9BY2NvdW50ID0gdHJhbnNhY3Rpb24udG9BY2NvdW50ID8gcGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi50b0FjY291bnQpIDogJyc7XG4gICAgICAgIGlmIChmcm9tQWNjb3VudCA9PT0gYWNjb3VudFJlZmVyZW5jZSkge1xuICAgICAgICAgICAgcmV0dXJuIGlzQ3JlZGl0ID8gdHJhbnNhY3Rpb24uYW1vdW50IDogLXRyYW5zYWN0aW9uLmFtb3VudDtcbiAgICAgICAgfVxuICAgICAgICBpZiAodG9BY2NvdW50ID09PSBhY2NvdW50UmVmZXJlbmNlKSB7XG4gICAgICAgICAgICByZXR1cm4gaXNDcmVkaXQgPyAtdHJhbnNhY3Rpb24uYW1vdW50IDogdHJhbnNhY3Rpb24uYW1vdW50O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uQWNjb3VudCA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0cmFuc2FjdGlvbiwgJ2FjY291bnQnKVxuICAgICAgICA/IHBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UodHJhbnNhY3Rpb24uYWNjb3VudClcbiAgICAgICAgOiBwbHVnaW4ubm9ybWFsaXplVHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlKHVuZGVmaW5lZCk7XG5cbiAgICBpZiAodHJhbnNhY3Rpb25BY2NvdW50ICE9PSBhY2NvdW50UmVmZXJlbmNlKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGlmICh0cmFuc2FjdGlvbi50eXBlID09PSBUcmFuc2FjdGlvblR5cGUuSU5DT01FKSB7XG4gICAgICAgIHJldHVybiBpc0NyZWRpdCA/IC10cmFuc2FjdGlvbi5hbW91bnQgOiB0cmFuc2FjdGlvbi5hbW91bnQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uLnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFXG4gICAgICAgID8gKGlzQ3JlZGl0ID8gdHJhbnNhY3Rpb24uYW1vdW50IDogLXRyYW5zYWN0aW9uLmFtb3VudClcbiAgICAgICAgOiAwO1xufVxuXG5mdW5jdGlvbiBnZXRSdW5uaW5nQmFsYW5jZUJ5VHJhbnNhY3Rpb25JZEZvckFjY291bnQoXG4gICAgcGx1Z2luOiBFeHBlbnNpY2FQbHVnaW4sXG4gICAgYWNjb3VudFJlZmVyZW5jZTogc3RyaW5nLFxuICAgIHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXVxuKTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiB7XG4gICAgbGV0IHJ1bm5pbmdCYWxhbmNlID0gMDtcbiAgICBjb25zdCBub3JtYWxpemVCYWxhbmNlVmFsdWUgPSAodmFsdWU6IG51bWJlcikgPT4gTWF0aC5hYnModmFsdWUpIDwgMC4wMDAwMDEgPyAwIDogdmFsdWU7XG5cbiAgICByZXR1cm4gc29ydFRyYW5zYWN0aW9uc0J5RGF0ZVRpbWVEZXNjKHRyYW5zYWN0aW9ucylcbiAgICAgICAgLnJldmVyc2UoKVxuICAgICAgICAucmVkdWNlKChiYWxhbmNlcywgdHJhbnNhY3Rpb24pID0+IHtcbiAgICAgICAgICAgIHJ1bm5pbmdCYWxhbmNlID0gbm9ybWFsaXplQmFsYW5jZVZhbHVlKHJ1bm5pbmdCYWxhbmNlICsgZ2V0QWNjb3VudFRyYW5zYWN0aW9uQW1vdW50KHBsdWdpbiwgdHJhbnNhY3Rpb24sIGFjY291bnRSZWZlcmVuY2UpKTtcbiAgICAgICAgICAgIGJhbGFuY2VzW3RyYW5zYWN0aW9uLmlkXSA9IHJ1bm5pbmdCYWxhbmNlO1xuICAgICAgICAgICAgcmV0dXJuIGJhbGFuY2VzO1xuICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+KTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0UnVubmluZ0JhbGFuY2VMYWJlbChwbHVnaW46IEV4cGVuc2ljYVBsdWdpbiwgYmFsYW5jZTogbnVtYmVyLCBhY2NvdW50UmVmZXJlbmNlPzogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjdXJyZW5jeSA9IGdldEN1cnJlbmN5QnlDb2RlKHBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q3VycmVuY3kpIHx8IGdldEN1cnJlbmN5QnlDb2RlKCdVU0QnKTtcbiAgICBjb25zdCBjb2RlID0gY3VycmVuY3k/LmNvZGUgfHwgJ1VTRCc7XG4gICAgY29uc3QgZmFsbGJhY2tTeW1ib2wgPSBjdXJyZW5jeT8uc3ltYm9sIHx8ICckJztcbiAgICBsZXQgc3ltYm9sID0gZmFsbGJhY2tTeW1ib2w7XG5cbiAgICB0cnkge1xuICAgICAgICBzeW1ib2wgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQoJ2VuLVVTJywge1xuICAgICAgICAgICAgc3R5bGU6ICdjdXJyZW5jeScsXG4gICAgICAgICAgICBjdXJyZW5jeTogY29kZSxcbiAgICAgICAgICAgIGN1cnJlbmN5RGlzcGxheTogJ25hcnJvd1N5bWJvbCdcbiAgICAgICAgfSkuZm9ybWF0VG9QYXJ0cygwKS5maW5kKHBhcnQgPT4gcGFydC50eXBlID09PSAnY3VycmVuY3knKT8udmFsdWUgfHwgZmFsbGJhY2tTeW1ib2w7XG4gICAgfSBjYXRjaCB7XG4gICAgICAgIHN5bWJvbCA9IGZhbGxiYWNrU3ltYm9sO1xuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTeW1ib2wgPSBzeW1ib2wucmVwbGFjZSgvW0EtWmEtel0rL2csICcnKS50cmltKCkgfHwgJyQnO1xuICAgIGNvbnN0IGFic29sdXRlQW1vdW50ID0gTWF0aC5hYnMoYmFsYW5jZSk7XG4gICAgY29uc3QgZnJhY3Rpb25EaWdpdHMgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQoJ2VuLVVTJywge1xuICAgICAgICBtaW5pbXVtRnJhY3Rpb25EaWdpdHM6IDIsXG4gICAgICAgIG1heGltdW1GcmFjdGlvbkRpZ2l0czogMlxuICAgIH0pLmZvcm1hdChhYnNvbHV0ZUFtb3VudCk7XG4gICAgY29uc3Qgc2lnbiA9IGJhbGFuY2UgPCAwID8gJy0nIDogJyc7XG4gICAgY29uc3QgYW1vdW50ID0gYCR7c2lnbn0ke25vcm1hbGl6ZWRTeW1ib2x9JHtmcmFjdGlvbkRpZ2l0c31gO1xuICAgIGlmICghYWNjb3VudFJlZmVyZW5jZSkge1xuICAgICAgICByZXR1cm4gYW1vdW50O1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBwbHVnaW4uZ2V0VHJhbnNhY3Rpb25BY2NvdW50RGlzcGxheShhY2NvdW50UmVmZXJlbmNlKTtcbiAgICByZXR1cm4gYCR7YWNjb3VudC5uYW1lfTogJHthbW91bnR9YDtcbn1cblxuaW50ZXJmYWNlIERheURhdGEge1xuICAgIGRhdGU6IERhdGU7XG4gICAgZGF0ZUtleTogc3RyaW5nO1xuICAgIHRvdGFsQW1vdW50OiBudW1iZXI7XG4gICAgZGF5QmFsYW5jZTogbnVtYmVyO1xuICAgIHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXTtcbiAgICBmb3JtYXR0ZWREYXRlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDYWxlbmRhckhlYXRtYXAge1xuICAgIHByaXZhdGUgY29udGFpbmVyOiBIVE1MRWxlbWVudDtcbiAgICBwcml2YXRlIHRyYW5zYWN0aW9uczogVHJhbnNhY3Rpb25bXTtcbiAgICBwcml2YXRlIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luO1xuICAgIHByaXZhdGUgY3VycmVudERhdGU6IERhdGU7XG4gICAgcHJpdmF0ZSBjYWxlbmRhckRhdGE6IERheURhdGFbXSA9IFtdO1xuICAgIHByaXZhdGUgc3ZnOiBhbnk7XG4gICAgcHJpdmF0ZSB3aWR0aDogbnVtYmVyID0gMDtcbiAgICBwcml2YXRlIGhlaWdodDogbnVtYmVyID0gMDtcbiAgICBwcml2YXRlIHRvb2x0aXBEaXY6IGFueTtcbiAgICBwcml2YXRlIGRldGFpbHNDb250YWluZXI6IEhUTUxFbGVtZW50O1xuICAgIHByaXZhdGUgY2FsZW5kYXJDb250YWluZXI6IEhUTUxFbGVtZW50O1xuICAgIHByaXZhdGUgY2VsbFNpemU6IG51bWJlciA9IDQ4O1xuICAgIHByaXZhdGUgY2VsbEdhcDogbnVtYmVyID0gNjtcbiAgICBwcml2YXRlIG1heEFtb3VudDogbnVtYmVyID0gMDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRDZWxsU2l6ZTogbnVtYmVyID0gNDg7XG4gICAgcHJpdmF0ZSByZWFkb25seSBtaW5pbXVtQ2VsbFNjYWxlOiBudW1iZXIgPSAwLjc1O1xuICAgIHByaXZhdGUgd2Vla051bWJlcldpZHRoOiBudW1iZXIgPSAzMjsgLy8gUmVzZXJ2ZSBvbmUgZGF5LWNvbHVtbiB3aWR0aCBmb3Igd2VlayBudW1iZXJzLlxuICAgIHByaXZhdGUgY2FsZW5kYXJIb3Jpem9udGFsUGFkZGluZzogbnVtYmVyID0gODtcbiAgICBwcml2YXRlIGxhc3RSZW5kZXJlZExheW91dEtleTogc3RyaW5nID0gJyc7XG4gICAgcHJpdmF0ZSBsYXN0TWVhc3VyZWRDb250YWluZXJTaXplS2V5OiBzdHJpbmcgPSAnJztcbiAgICBwcml2YXRlIHNlbGVjdGVkRGF0ZTogRGF0ZSB8IG51bGw7XG4gICAgcHJpdmF0ZSBvblNlbGVjdGVkRGF0ZUNoYW5nZT86IChkYXRlOiBEYXRlKSA9PiB2b2lkO1xuICAgIHByaXZhdGUgb25UcmFuc2FjdGlvbkVkaXQ/OiAodHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKSA9PiB2b2lkO1xuICAgIHByaXZhdGUgYWxsVHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdID0gW107XG4gICAgcHJpdmF0ZSBtb250aGx5RXhwZW5zZVRvdGFsOiBudW1iZXIgPSAwO1xuICAgIHByaXZhdGUgcnVubmluZ0JhbGFuY2VDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+PigpO1xuXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQsXG4gICAgICAgIHBsdWdpbjogRXhwZW5zaWNhUGx1Z2luLFxuICAgICAgICB0cmFuc2FjdGlvbnM6IFRyYW5zYWN0aW9uW10sXG4gICAgICAgIGN1cnJlbnREYXRlOiBEYXRlLFxuICAgICAgICBzZWxlY3RlZERhdGU6IERhdGUgfCBudWxsID0gbnVsbCxcbiAgICAgICAgb25TZWxlY3RlZERhdGVDaGFuZ2U/OiAoZGF0ZTogRGF0ZSkgPT4gdm9pZCxcbiAgICAgICAgb25UcmFuc2FjdGlvbkVkaXQ/OiAodHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKSA9PiB2b2lkXG4gICAgKSB7XG4gICAgICAgIHRoaXMuY29udGFpbmVyID0gY29udGFpbmVyO1xuICAgICAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICAgICAgdGhpcy50cmFuc2FjdGlvbnMgPSB0cmFuc2FjdGlvbnM7XG4gICAgICAgIHRoaXMuY3VycmVudERhdGUgPSBjdXJyZW50RGF0ZTtcbiAgICAgICAgdGhpcy5zZWxlY3RlZERhdGUgPSBzZWxlY3RlZERhdGU7XG4gICAgICAgIHRoaXMub25TZWxlY3RlZERhdGVDaGFuZ2UgPSBvblNlbGVjdGVkRGF0ZUNoYW5nZTtcbiAgICAgICAgdGhpcy5vblRyYW5zYWN0aW9uRWRpdCA9IG9uVHJhbnNhY3Rpb25FZGl0O1xuICAgICAgICB0aGlzLnNldHVwQ29udGFpbmVycygpO1xuICAgICAgICB0aGlzLmNyZWF0ZVRvb2x0aXAoKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNldHVwQ29udGFpbmVycygpIHtcbiAgICAgICAgLy8gQ2xlYXIgYW55IGV4aXN0aW5nIGNvbnRlbnRcbiAgICAgICAgdGhpcy5jb250YWluZXIuZW1wdHkoKTtcbiAgICAgICAgdGhpcy5jb250YWluZXIucmVtb3ZlQ2xhc3MoJ2V4cGVuc2ljYS1jYWxlbmRhci1jb250YWluZXInKTtcbiAgICAgICAgdGhpcy5jb250YWluZXIuYWRkQ2xhc3MoJ2V4cGVuc2ljYS1jYWxlbmRhci1mbGV4LWNvbnRhaW5lcicpO1xuXG4gICAgICAgIC8vIEtlZXAgdGhlIGNhbGVuZGFyIGdyaWQgYW5kIGRheSBkZXRhaWxzIGFzIGluZGVwZW5kZW50IHNpYmxpbmcgcGFuZWxzLlxuICAgICAgICBjb25zdCBjYWxlbmRhckNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhbGVuZGFyLWNvbnRhaW5lciBleHBlbnNpY2EtY2FsZW5kYXItZ3JpZC1jb250YWluZXInKTtcbiAgICAgICAgdGhpcy5jYWxlbmRhckNvbnRhaW5lciA9IGNhbGVuZGFyQ29udGFpbmVyO1xuICAgICAgICBcbiAgICAgICAgLy8gQ3JlYXRlIHRoZSBkZXRhaWxzIGNvbnRhaW5lciBmb3IgdHJhbnNhY3Rpb24gZGV0YWlsc1xuICAgICAgICB0aGlzLmRldGFpbHNDb250YWluZXIgPSB0aGlzLmNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLWNvbnRhaW5lcicpO1xuICAgICAgICB0aGlzLmRldGFpbHNDb250YWluZXIuY3JlYXRlRWwoJ2gzJywgeyBcbiAgICAgICAgICAgIHRleHQ6ICdDbGljayBvbiBhIGRheSB0byBzZWUgdHJhbnNhY3Rpb25zJywgXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2FsZW5kYXItZGV0YWlscy10aXRsZScgXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbmRlcmFibGVXaWR0aCA9IHRoaXMuZ2V0UmVuZGVyYWJsZVdpZHRoKHRoaXMuY29udGFpbmVyKSA/PyB0aGlzLmdldE5hdHVyYWxDYWxlbmRhcldpZHRoKCk7XG4gICAgICAgIHRoaXMudXBkYXRlQ2FsZW5kYXJIb3Jpem9udGFsUGFkZGluZyhyZW5kZXJhYmxlV2lkdGgpO1xuICAgICAgICB0aGlzLnVwZGF0ZVN0YWNrZWRMYXlvdXQocmVuZGVyYWJsZVdpZHRoKTtcblxuICAgICAgICAvLyBTaXplIHRoZSBTVkcgdG8gdGhlIGFjdHVhbCBjYWxlbmRhciBncmlkIGluc3RlYWQgb2YgdGhlIGZ1bGwgcGFuZWwgd2lkdGguXG4gICAgICAgIHRoaXMud2lkdGggPSB0aGlzLmdldENhbGVuZGFyR3JpZFdpZHRoKCk7XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIGFkZGl0aW9uYWwgd2lkdGggZm9yIHdlZWsgbnVtYmVycyBpZiBlbmFibGVkXG4gICAgICAgIGNvbnN0IHdlZWtOdW1iZXJzT2Zmc2V0ID0gdGhpcy5nZXRXZWVrTnVtYmVyc09mZnNldCgpO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2FsY3VsYXRlIGhlaWdodCBiYXNlZCBvbiBudW1iZXIgb2Ygd2Vla3MgaW4gdGhlIG1vbnRoXG4gICAgICAgIGNvbnN0IHdlZWtzSW5Nb250aCA9IHRoaXMuZ2V0V2Vla3NJbk1vbnRoKHRoaXMuY3VycmVudERhdGUuZ2V0RnVsbFllYXIoKSwgdGhpcy5jdXJyZW50RGF0ZS5nZXRNb250aCgpKTtcbiAgICAgICAgY29uc3QgY2FsZW5kYXJIZWlnaHQgPSAod2Vla3NJbk1vbnRoICsgMSkgKiAodGhpcy5jZWxsU2l6ZSArIHRoaXMuY2VsbEdhcCkgKyA1MDsgLy8gQ2FsZW5kYXIgaGVpZ2h0XG4gICAgICAgIFxuICAgICAgICAvLyBBZGQgZXh0cmEgc3BhY2UgYXQgdGhlIGJvdHRvbSBmb3IgdGhlIGxlZ2VuZCAoOTBweCBpbnN0ZWFkIG9mIDc1cHgpXG4gICAgICAgIHRoaXMuaGVpZ2h0ID0gY2FsZW5kYXJIZWlnaHQgKyA5MDtcblxuICAgICAgICAvLyBDcmVhdGUgdGhlIFNWRyBpbnNpZGUgdGhlIGNhbGVuZGFyIGNvbnRhaW5lclxuICAgICAgICB0aGlzLnN2ZyA9IGQzLnNlbGVjdChjYWxlbmRhckNvbnRhaW5lcilcbiAgICAgICAgICAgIC5hcHBlbmQoJ3N2ZycpXG4gICAgICAgICAgICAuYXR0cignd2lkdGgnLCB0aGlzLndpZHRoICsgd2Vla051bWJlcnNPZmZzZXQpXG4gICAgICAgICAgICAuYXR0cignaGVpZ2h0JywgdGhpcy5oZWlnaHQpXG4gICAgICAgICAgICAuYXR0cigndmlld0JveCcsIGAwIDAgJHt0aGlzLndpZHRoICsgd2Vla051bWJlcnNPZmZzZXR9ICR7dGhpcy5oZWlnaHR9YClcbiAgICAgICAgICAgIC5hdHRyKCdjbGFzcycsICdleHBlbnNpY2EtY2FsZW5kYXItc3ZnJyk7XG5cbiAgICAgICAgdGhpcy51cGRhdGVDYWxlbmRhclNjYWxlQm91bmRzKHRoaXMud2lkdGggKyB3ZWVrTnVtYmVyc09mZnNldCk7XG4gICAgICAgIHRoaXMudXBkYXRlRGV0YWlsc1BhbmVsSGVpZ2h0KCk7XG4gICAgICAgIHRoaXMubGFzdFJlbmRlcmVkTGF5b3V0S2V5ID0gdGhpcy5nZXRMYXlvdXRLZXkodGhpcy53aWR0aCArIHdlZWtOdW1iZXJzT2Zmc2V0LCB0aGlzLmhlaWdodCk7XG4gICAgICAgIHRoaXMubGFzdE1lYXN1cmVkQ29udGFpbmVyU2l6ZUtleSA9IHRoaXMuZ2V0Q29udGFpbmVyU2l6ZUtleSh0aGlzLmNvbnRhaW5lcik7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVUb29sdGlwKCkge1xuICAgICAgICB0aGlzLnRvb2x0aXBEaXYgPSBkMy5zZWxlY3QodGhpcy5jb250YWluZXIpXG4gICAgICAgICAgICAuYXBwZW5kKCdkaXYnKVxuICAgICAgICAgICAgLmF0dHIoJ2NsYXNzJywgJ2V4cGVuc2ljYS1jYWxlbmRhci10b29sdGlwJylcbiAgICAgICAgICAgIC5zdHlsZSgnb3BhY2l0eScsIDApO1xuICAgIH1cblxuICAgIHB1YmxpYyByZW5kZXIoYW5pbWF0ZUNlbGxzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5wcmVwYXJlRGF0YSgpO1xuICAgICAgICB0aGlzLnJlbmRlckNhbGVuZGFyKGFuaW1hdGVDZWxscyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBwcmVwYXJlRGF0YSgpIHtcbiAgICAgICAgY29uc3QgeWVhciA9IHRoaXMuY3VycmVudERhdGUuZ2V0RnVsbFllYXIoKTtcbiAgICAgICAgY29uc3QgbW9udGggPSB0aGlzLmN1cnJlbnREYXRlLmdldE1vbnRoKCk7XG4gICAgICAgIGNvbnN0IGRheXNJbk1vbnRoID0gbmV3IERhdGUoeWVhciwgbW9udGggKyAxLCAwKS5nZXREYXRlKCk7XG5cbiAgICAgICAgdGhpcy5jYWxlbmRhckRhdGEgPSBbXTtcbiAgICAgICAgdGhpcy5tYXhBbW91bnQgPSAwO1xuICAgICAgICB0aGlzLm1vbnRobHlFeHBlbnNlVG90YWwgPSAwO1xuICAgICAgICB0aGlzLnJ1bm5pbmdCYWxhbmNlQ2FjaGUuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5hbGxUcmFuc2FjdGlvbnMgPSB0aGlzLnBsdWdpbi5nZXRBbGxUcmFuc2FjdGlvbnMoKTtcblxuICAgICAgICBjb25zdCBtb250aGx5VHJhbnNhY3Rpb25zQnlEYXRlID0gbmV3IE1hcDxzdHJpbmcsIFRyYW5zYWN0aW9uW10+KCk7XG4gICAgICAgIHRoaXMudHJhbnNhY3Rpb25zLmZvckVhY2goKHRyYW5zYWN0aW9uKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkYXRlS2V5ID0gdHJhbnNhY3Rpb24uZGF0ZTtcbiAgICAgICAgICAgIGNvbnN0IGRheVRyYW5zYWN0aW9ucyA9IG1vbnRobHlUcmFuc2FjdGlvbnNCeURhdGUuZ2V0KGRhdGVLZXkpO1xuICAgICAgICAgICAgaWYgKGRheVRyYW5zYWN0aW9ucykge1xuICAgICAgICAgICAgICAgIGRheVRyYW5zYWN0aW9ucy5wdXNoKHRyYW5zYWN0aW9uKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbW9udGhseVRyYW5zYWN0aW9uc0J5RGF0ZS5zZXQoZGF0ZUtleSwgW3RyYW5zYWN0aW9uXSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0cmFuc2FjdGlvbi50eXBlID09PSBUcmFuc2FjdGlvblR5cGUuRVhQRU5TRSkge1xuICAgICAgICAgICAgICAgIHRoaXMubW9udGhseUV4cGVuc2VUb3RhbCArPSB0cmFuc2FjdGlvbi5hbW91bnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2NvdW50UmVmZXJlbmNlID0gdGhpcy5wbHVnaW4ubm9ybWFsaXplVHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlKHVuZGVmaW5lZCk7XG4gICAgICAgIGNvbnN0IGJhbGFuY2VzQnlEYXRlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICAgICAgbGV0IHJ1bm5pbmdCYWxhbmNlID0gMDtcbiAgICAgICAgc29ydFRyYW5zYWN0aW9uc0J5RGF0ZVRpbWVEZXNjKHRoaXMuYWxsVHJhbnNhY3Rpb25zKVxuICAgICAgICAgICAgLnJldmVyc2UoKVxuICAgICAgICAgICAgLmZvckVhY2goKHRyYW5zYWN0aW9uKSA9PiB7XG4gICAgICAgICAgICAgICAgcnVubmluZ0JhbGFuY2UgKz0gZ2V0QWNjb3VudFRyYW5zYWN0aW9uQW1vdW50KHRoaXMucGx1Z2luLCB0cmFuc2FjdGlvbiwgZGVmYXVsdEFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgICAgIGJhbGFuY2VzQnlEYXRlLnNldCh0cmFuc2FjdGlvbi5kYXRlLCBNYXRoLmFicyhydW5uaW5nQmFsYW5jZSkgPCAwLjAwMDAwMSA/IDAgOiBydW5uaW5nQmFsYW5jZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICBsZXQgY2FycmllZEJhbGFuY2UgPSAwO1xuICAgICAgICBmb3IgKGxldCBkYXkgPSAxOyBkYXkgPD0gZGF5c0luTW9udGg7IGRheSsrKSB7XG4gICAgICAgICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoeWVhciwgbW9udGgsIGRheSk7XG4gICAgICAgICAgICBjb25zdCBkYXRlS2V5ID0gdGhpcy5nZXREYXRlS2V5KGRhdGUpO1xuICAgICAgICAgICAgY29uc3QgZGF0ZVN0ciA9IHRoaXMuZm9ybWF0RGF0ZShkYXRlKTtcbiAgICAgICAgICAgIGNvbnN0IGRheVRyYW5zYWN0aW9ucyA9IG1vbnRobHlUcmFuc2FjdGlvbnNCeURhdGUuZ2V0KGRhdGVLZXkpID8/IFtdO1xuICAgICAgICAgICAgY29uc3QgdG90YWxBbW91bnQgPSBkYXlUcmFuc2FjdGlvbnNcbiAgICAgICAgICAgICAgICAuZmlsdGVyKHQgPT4gdC50eXBlID09PSBUcmFuc2FjdGlvblR5cGUuRVhQRU5TRSlcbiAgICAgICAgICAgICAgICAucmVkdWNlKChzdW0sIHQpID0+IHN1bSArIHQuYW1vdW50LCAwKTtcblxuICAgICAgICAgICAgY29uc3QgZGF5QmFsYW5jZSA9IGJhbGFuY2VzQnlEYXRlLmdldChkYXRlS2V5KTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZGF5QmFsYW5jZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgICAgICBjYXJyaWVkQmFsYW5jZSA9IGRheUJhbGFuY2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuY2FsZW5kYXJEYXRhLnB1c2goe1xuICAgICAgICAgICAgICAgIGRhdGU6IGRhdGUsXG4gICAgICAgICAgICAgICAgZGF0ZUtleSxcbiAgICAgICAgICAgICAgICB0b3RhbEFtb3VudDogdG90YWxBbW91bnQsXG4gICAgICAgICAgICAgICAgZGF5QmFsYW5jZTogY2FycmllZEJhbGFuY2UsXG4gICAgICAgICAgICAgICAgdHJhbnNhY3Rpb25zOiBkYXlUcmFuc2FjdGlvbnMsXG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkRGF0ZTogZGF0ZVN0clxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmICh0b3RhbEFtb3VudCA+IHRoaXMubWF4QW1vdW50KSB7XG4gICAgICAgICAgICAgICAgdGhpcy5tYXhBbW91bnQgPSB0b3RhbEFtb3VudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0RGF0ZUtleShkYXRlOiBEYXRlKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgeWVhciA9IGRhdGUuZ2V0RnVsbFllYXIoKTtcbiAgICAgICAgY29uc3QgbW9udGggPSBgJHtkYXRlLmdldE1vbnRoKCkgKyAxfWAucGFkU3RhcnQoMiwgJzAnKTtcbiAgICAgICAgY29uc3QgZGF5ID0gYCR7ZGF0ZS5nZXREYXRlKCl9YC5wYWRTdGFydCgyLCAnMCcpO1xuICAgICAgICByZXR1cm4gYCR7eWVhcn0tJHttb250aH0tJHtkYXl9YDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFJ1bm5pbmdCYWxhbmNlTWFwKGFjY291bnRSZWZlcmVuY2U6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4ge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucnVubmluZ0JhbGFuY2VDYWNoZS5nZXQoYWNjb3VudFJlZmVyZW5jZSk7XG4gICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmFsYW5jZXMgPSBnZXRSdW5uaW5nQmFsYW5jZUJ5VHJhbnNhY3Rpb25JZEZvckFjY291bnQodGhpcy5wbHVnaW4sIGFjY291bnRSZWZlcmVuY2UsIHRoaXMuYWxsVHJhbnNhY3Rpb25zKTtcbiAgICAgICAgdGhpcy5ydW5uaW5nQmFsYW5jZUNhY2hlLnNldChhY2NvdW50UmVmZXJlbmNlLCBiYWxhbmNlcyk7XG4gICAgICAgIHJldHVybiBiYWxhbmNlcztcbiAgICB9XG5cbiAgICBwcml2YXRlIGZvcm1hdERhdGUoZGF0ZTogRGF0ZSk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBkYXRlLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tVVMnLCB7IFxuICAgICAgICAgICAgbW9udGg6ICdzaG9ydCcsIFxuICAgICAgICAgICAgZGF5OiAnbnVtZXJpYycsIFxuICAgICAgICAgICAgeWVhcjogJ251bWVyaWMnIFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFdlZWtzSW5Nb250aCh5ZWFyOiBudW1iZXIsIG1vbnRoOiBudW1iZXIpOiBudW1iZXIge1xuICAgICAgICBjb25zdCBmaXJzdERheSA9IG5ldyBEYXRlKHllYXIsIG1vbnRoLCAxKS5nZXREYXkoKTtcbiAgICAgICAgY29uc3QgZGF5c0luTW9udGggPSBuZXcgRGF0ZSh5ZWFyLCBtb250aCArIDEsIDApLmdldERhdGUoKTtcbiAgICAgICAgcmV0dXJuIE1hdGguY2VpbCgoZmlyc3REYXkgKyBkYXlzSW5Nb250aCkgLyA3KTtcbiAgICB9XG4gICAgXG4gICAgLy8gR2V0IHRoZSB3ZWVrIG51bWJlciBmb3IgYSBnaXZlbiBkYXRlIChJU08gd2VlayBudW1iZXIpXG4gICAgcHJpdmF0ZSBnZXRXZWVrTnVtYmVyKGRhdGU6IERhdGUpOiBudW1iZXIge1xuICAgICAgICBjb25zdCBkID0gbmV3IERhdGUoRGF0ZS5VVEMoZGF0ZS5nZXRGdWxsWWVhcigpLCBkYXRlLmdldE1vbnRoKCksIGRhdGUuZ2V0RGF0ZSgpKSk7XG4gICAgICAgIGQuc2V0VVRDRGF0ZShkLmdldFVUQ0RhdGUoKSArIDQgLSAoZC5nZXRVVENEYXkoKSB8fCA3KSk7XG4gICAgICAgIGNvbnN0IHllYXJTdGFydCA9IG5ldyBEYXRlKERhdGUuVVRDKGQuZ2V0VVRDRnVsbFllYXIoKSwgMCwgMSkpO1xuICAgICAgICByZXR1cm4gTWF0aC5jZWlsKCgoKGQuZ2V0VGltZSgpIC0geWVhclN0YXJ0LmdldFRpbWUoKSkgLyA4NjQwMDAwMCkgKyAxKSAvIDcpO1xuICAgIH1cbiAgICBcbiAgICAvLyBHZXQgdGhlIGNvbG9yIHNjYWxlIGJhc2VkIG9uIHRoZSBzZWxlY3RlZCBjb2xvciBzY2hlbWVcbiAgICBwcml2YXRlIGdldENvbG9yU2NhbGUobWF4VmFsdWU6IG51bWJlcik6IGFueSB7XG4gICAgICAgIGlmIChtYXhWYWx1ZSA8PSAwKSB7XG4gICAgICAgICAgICBtYXhWYWx1ZSA9IDE7IC8vIFByZXZlbnQgZGl2aXNpb24gYnkgemVyb1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBjb2xvclNjaGVtZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNhbGVuZGFyQ29sb3JTY2hlbWU7XG4gICAgICAgIGNvbnN0IGNyZWF0ZVNjYWxlID0gKG1heENvbG9yOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRyYW5zcGFyZW50TWluQ29sb3IgPSB0aGlzLndpdGhBbHBoYShtYXhDb2xvciwgMCk7XG4gICAgICAgICAgICByZXR1cm4gZDMuc2NhbGVTZXF1ZW50aWFsKClcbiAgICAgICAgICAgICAgICAuZG9tYWluKFswLCBtYXhWYWx1ZV0pXG4gICAgICAgICAgICAgICAgLmludGVycG9sYXRvcihkMy5pbnRlcnBvbGF0ZVJnYih0cmFuc3BhcmVudE1pbkNvbG9yLCBtYXhDb2xvcikpO1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgc3dpdGNoIChjb2xvclNjaGVtZSkge1xuICAgICAgICAgICAgY2FzZSBDb2xvclNjaGVtZS5SRUQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNjYWxlKFwiI0ZGNTI1MlwiKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSBDb2xvclNjaGVtZS5CTFVFOlxuICAgICAgICAgICAgICAgIHJldHVybiBjcmVhdGVTY2FsZShcIiMwMDY2Q0NcIik7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSBDb2xvclNjaGVtZS5HUkVFTjpcbiAgICAgICAgICAgICAgICByZXR1cm4gY3JlYXRlU2NhbGUoXCIjMzhBMTY5XCIpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIGNhc2UgQ29sb3JTY2hlbWUuUFVSUExFOlxuICAgICAgICAgICAgICAgIHJldHVybiBjcmVhdGVTY2FsZShcIiM4MDVBRDVcIik7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSBDb2xvclNjaGVtZS5PUkFOR0U6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNjYWxlKFwiI0VEODkzNlwiKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBjYXNlIENvbG9yU2NoZW1lLlRFQUw6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZVNjYWxlKFwiIzM4QjJBQ1wiKTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBjYXNlIENvbG9yU2NoZW1lLkNPTE9SQkxJTkRfRlJJRU5ETFk6XG4gICAgICAgICAgICAgICAgLy8gVXNlIGEgY29sb3JibGluZC1mcmllbmRseSBwYWxldHRlIChibHVlIHRvIHllbGxvdylcbiAgICAgICAgICAgICAgICByZXR1cm4gY3JlYXRlU2NhbGUoXCIjRkZCRjAwXCIpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIGNhc2UgQ29sb3JTY2hlbWUuQ1VTVE9NOlxuICAgICAgICAgICAgICAgIC8vIFVzZSBjdXN0b20gY29sb3JcbiAgICAgICAgICAgICAgICByZXR1cm4gY3JlYXRlU2NhbGUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY3VzdG9tQ2FsZW5kYXJDb2xvcik7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAvLyBEZWZhdWx0IHRvIHJlZFxuICAgICAgICAgICAgICAgIHJldHVybiBjcmVhdGVTY2FsZShcIiNGRjUyNTJcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHdpdGhBbHBoYShjb2xvcjogc3RyaW5nLCBhbHBoYTogbnVtYmVyKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgcGFyc2VkQ29sb3IgPSBkMy5yZ2IoY29sb3IpO1xuICAgICAgICByZXR1cm4gYHJnYmEoJHtwYXJzZWRDb2xvci5yfSwgJHtwYXJzZWRDb2xvci5nfSwgJHtwYXJzZWRDb2xvci5ifSwgJHthbHBoYX0pYDtcbiAgICB9XG5cbiAgICBwcml2YXRlIHJlbmRlckNhbGVuZGFyKGFuaW1hdGVDZWxsczogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgICAgIC8vIENsZWFyIFNWR1xuICAgICAgICB0aGlzLnN2Zy5zZWxlY3RBbGwoJyonKS5yZW1vdmUoKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IG1vbnRoTGFiZWwgPSB0aGlzLmN1cnJlbnREYXRlLnRvTG9jYWxlRGF0ZVN0cmluZygnZW4tVVMnLCB7IG1vbnRoOiAnbG9uZycsIHllYXI6ICdudW1lcmljJyB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vIENhbGN1bGF0ZSB3ZWVrIG51bWJlcnMgb2Zmc2V0IGlmIGVuYWJsZWRcbiAgICAgICAgY29uc3Qgd2Vla051bWJlcnNPZmZzZXQgPSB0aGlzLmdldFdlZWtOdW1iZXJzT2Zmc2V0KCk7XG4gICAgICAgIFxuICAgICAgICAvLyBDYWxjdWxhdGUgY2FsZW5kYXIgaGVpZ2h0ICh3aXRob3V0IHRoZSBsZWdlbmQgc3BhY2UpXG4gICAgICAgIGNvbnN0IHdlZWtzSW5Nb250aCA9IHRoaXMuZ2V0V2Vla3NJbk1vbnRoKHRoaXMuY3VycmVudERhdGUuZ2V0RnVsbFllYXIoKSwgdGhpcy5jdXJyZW50RGF0ZS5nZXRNb250aCgpKTtcbiAgICAgICAgY29uc3QgY2FsZW5kYXJIZWlnaHQgPSAod2Vla3NJbk1vbnRoICsgMSkgKiAodGhpcy5jZWxsU2l6ZSArIHRoaXMuY2VsbEdhcCkgKyA1MDtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBtb250aCBsYWJlbCB3aXRoIE5vdGlvbi1pbnNwaXJlZCBzdHlsaW5nXG4gICAgICAgIHRoaXMuc3ZnLmFwcGVuZCgndGV4dCcpXG4gICAgICAgICAgICAuYXR0cignY2xhc3MnLCAnbW9udGgtbGFiZWwnKVxuICAgICAgICAgICAgLmF0dHIoJ3gnLCAodGhpcy53aWR0aCArIHdlZWtOdW1iZXJzT2Zmc2V0KSAvIDIpXG4gICAgICAgICAgICAuYXR0cigneScsIDI1KVxuICAgICAgICAgICAgLmF0dHIoJ3RleHQtYW5jaG9yJywgJ21pZGRsZScpXG4gICAgICAgICAgICAuYXR0cignZm9udC1zaXplJywgJzE2cHgnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtd2VpZ2h0JywgJzUwMCcpXG4gICAgICAgICAgICAuYXR0cignZmlsbCcsICd2YXIoLS10ZXh0LW5vcm1hbCknKVxuICAgICAgICAgICAgLnRleHQobW9udGhMYWJlbCk7XG4gICAgICAgIFxuICAgICAgICAvLyBEYXlzIG9mIHRoZSB3ZWVrIC0gU2hvcnRlciBOb3Rpb24tbGlrZSBmb3JtYXRcbiAgICAgICAgY29uc3QgZGF5c09mV2VlayA9IFsnUycsICdNJywgJ1QnLCAnVycsICdUJywgJ0YnLCAnUyddO1xuICAgICAgICBcbiAgICAgICAgdGhpcy5zdmcuc2VsZWN0QWxsKCcuZGF5LW9mLXdlZWsnKVxuICAgICAgICAgICAgLmRhdGEoZGF5c09mV2VlaylcbiAgICAgICAgICAgIC5lbnRlcigpXG4gICAgICAgICAgICAuYXBwZW5kKCd0ZXh0JylcbiAgICAgICAgICAgIC5hdHRyKCdjbGFzcycsICdkYXktb2Ytd2VlaycpXG4gICAgICAgICAgICAuYXR0cigneCcsIChkOiBzdHJpbmcsIGk6IG51bWJlcikgPT4gdGhpcy5jYWxlbmRhckhvcml6b250YWxQYWRkaW5nICsgd2Vla051bWJlcnNPZmZzZXQgKyBpICogKHRoaXMuY2VsbFNpemUgKyB0aGlzLmNlbGxHYXApICsgdGhpcy5jZWxsU2l6ZSAvIDIpXG4gICAgICAgICAgICAuYXR0cigneScsIDYwKVxuICAgICAgICAgICAgLmF0dHIoJ3RleHQtYW5jaG9yJywgJ21pZGRsZScpXG4gICAgICAgICAgICAuYXR0cignZm9udC1zaXplJywgJzEycHgnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAndmFyKC0tdGV4dC1tdXRlZCknKVxuICAgICAgICAgICAgLnRleHQoKGQ6IHN0cmluZykgPT4gZCk7XG4gICAgICAgIFxuICAgICAgICAvLyBDYWxjdWxhdGUgY29sb3JzY2FsZSBiYXNlZCBvbiBtYXggZXhwZW5zZSBhbW91bnQgdXNpbmcgdGhlIHNlbGVjdGVkIGNvbG9yIHNjaGVtZVxuICAgICAgICBjb25zdCBjb2xvclNjYWxlID0gdGhpcy5nZXRDb2xvclNjYWxlKHRoaXMubWF4QW1vdW50KTtcbiAgICAgICAgXG4gICAgICAgIC8vIENyZWF0ZSBkYXkgY2VsbHNcbiAgICAgICAgY29uc3QgeWVhciA9IHRoaXMuY3VycmVudERhdGUuZ2V0RnVsbFllYXIoKTtcbiAgICAgICAgY29uc3QgbW9udGggPSB0aGlzLmN1cnJlbnREYXRlLmdldE1vbnRoKCk7XG4gICAgICAgIGNvbnN0IGZpcnN0RGF5T2ZNb250aCA9IG5ldyBEYXRlKHllYXIsIG1vbnRoLCAxKS5nZXREYXkoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEdldCBjdXJyZW50IGRheSBmb3IgdG9kYXkncyBoaWdobGlnaHRcbiAgICAgICAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBjb25zdCBpc0N1cnJlbnRNb250aCA9IHRvZGF5LmdldE1vbnRoKCkgPT09IG1vbnRoICYmIHRvZGF5LmdldEZ1bGxZZWFyKCkgPT09IHllYXI7XG4gICAgICAgIGNvbnN0IHRvZGF5RGF0ZSA9IHRvZGF5LmdldERhdGUoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFRyYWNrIHNlbGVjdGVkIGNlbGwgZm9yIHJlZmVyZW5jZVxuICAgICAgICBsZXQgc2VsZWN0ZWRDZWxsOiBhbnkgPSBudWxsO1xuICAgICAgICBcbiAgICAgICAgLy8gQWRkIHdlZWsgbnVtYmVycyBpZiBlbmFibGVkXG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93V2Vla051bWJlcnMpIHtcbiAgICAgICAgICAgIC8vIEFkZCBcIldlZWtcIiBoZWFkZXJcbiAgICAgICAgICAgIHRoaXMuc3ZnLmFwcGVuZCgndGV4dCcpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2NsYXNzJywgJ3dlZWstbGFiZWwnKVxuICAgICAgICAgICAgICAgIC5hdHRyKCd4JywgdGhpcy5jYWxlbmRhckhvcml6b250YWxQYWRkaW5nICsgdGhpcy53ZWVrTnVtYmVyV2lkdGggLyAyKVxuICAgICAgICAgICAgICAgIC5hdHRyKCd5JywgNjApXG4gICAgICAgICAgICAgICAgLmF0dHIoJ3RleHQtYW5jaG9yJywgJ21pZGRsZScpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtc2l6ZScsICcxMXB4JylcbiAgICAgICAgICAgICAgICAuYXR0cignZmlsbCcsICd2YXIoLS10ZXh0LWZhaW50KScpXG4gICAgICAgICAgICAgICAgLnRleHQoJ1drJyk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBBZGQgd2VlayBudW1iZXJzXG4gICAgICAgICAgICBjb25zdCB3ZWVrc0luTW9udGggPSB0aGlzLmdldFdlZWtzSW5Nb250aCh5ZWFyLCBtb250aCk7XG4gICAgICAgICAgICBjb25zdCBmaXJzdERheURhdGUgPSBuZXcgRGF0ZSh5ZWFyLCBtb250aCwgMSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGZvciAobGV0IHdlZWsgPSAwOyB3ZWVrIDwgd2Vla3NJbk1vbnRoOyB3ZWVrKyspIHtcbiAgICAgICAgICAgICAgICAvLyBDYWxjdWxhdGUgdGhlIGRhdGUgZm9yIHRoZSBmaXJzdCBkYXkgb2YgdGhpcyB3ZWVrXG4gICAgICAgICAgICAgICAgY29uc3Qgd2Vla1N0YXJ0ID0gbmV3IERhdGUoeWVhciwgbW9udGgsIDEgKyAod2VlayAqIDcpIC0gZmlyc3REYXlPZk1vbnRoKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBHZXQgd2VlayBudW1iZXJcbiAgICAgICAgICAgICAgICBjb25zdCB3ZWVrTnVtYmVyID0gdGhpcy5nZXRXZWVrTnVtYmVyKHdlZWtTdGFydCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgdGhpcy5zdmcuYXBwZW5kKCd0ZXh0JylcbiAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2NsYXNzJywgJ3dlZWstbnVtYmVyJylcbiAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3gnLCB0aGlzLmNhbGVuZGFySG9yaXpvbnRhbFBhZGRpbmcgKyB0aGlzLndlZWtOdW1iZXJXaWR0aCAvIDIpXG4gICAgICAgICAgICAgICAgICAgIC5hdHRyKCd5JywgKHdlZWsgKyAxKSAqICh0aGlzLmNlbGxTaXplICsgdGhpcy5jZWxsR2FwKSArIDYwKVxuICAgICAgICAgICAgICAgICAgICAuYXR0cigndGV4dC1hbmNob3InLCAnbWlkZGxlJylcbiAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RvbWluYW50LWJhc2VsaW5lJywgJ21pZGRsZScpXG4gICAgICAgICAgICAgICAgICAgIC5hdHRyKCdmb250LXNpemUnLCAnMTFweCcpXG4gICAgICAgICAgICAgICAgICAgIC5hdHRyKCdmaWxsJywgJ3ZhcigtLXRleHQtZmFpbnQpJylcbiAgICAgICAgICAgICAgICAgICAgLnRleHQod2Vla051bWJlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGRheUNlbGxzID0gdGhpcy5zdmcuc2VsZWN0QWxsKCcuZGF5LWNlbGwnKVxuICAgICAgICAgICAgLmRhdGEodGhpcy5jYWxlbmRhckRhdGEpXG4gICAgICAgICAgICAuZW50ZXIoKVxuICAgICAgICAgICAgLmFwcGVuZCgnZycpXG4gICAgICAgICAgICAuYXR0cignY2xhc3MnLCAnZGF5LWNlbGwnKVxuICAgICAgICAgICAgLmF0dHIoJ3RyYW5zZm9ybScsIChkOiBEYXlEYXRhLCBpOiBudW1iZXIpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBkYXlPZk1vbnRoID0gZC5kYXRlLmdldERhdGUoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBkYXlPZldlZWsgPSBkLmRhdGUuZ2V0RGF5KCk7XG4gICAgICAgICAgICAgICAgY29uc3Qgd2Vla09mTW9udGggPSBNYXRoLmZsb29yKChkYXlPZk1vbnRoICsgZmlyc3REYXlPZk1vbnRoIC0gMSkgLyA3KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBDYWxjdWxhdGUgcG9zaXRpb24gd2l0aCBhZGRlZCBnYXAgYmV0d2VlbiBjZWxsc1xuICAgICAgICAgICAgICAgIGNvbnN0IHhQb3MgPSB0aGlzLmNhbGVuZGFySG9yaXpvbnRhbFBhZGRpbmcgKyB3ZWVrTnVtYmVyc09mZnNldCArIGRheU9mV2VlayAqICh0aGlzLmNlbGxTaXplICsgdGhpcy5jZWxsR2FwKTtcbiAgICAgICAgICAgICAgICBjb25zdCB5UG9zID0gKHdlZWtPZk1vbnRoICsgMSkgKiAodGhpcy5jZWxsU2l6ZSArIHRoaXMuY2VsbEdhcCkgKyA0MDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICByZXR1cm4gYHRyYW5zbGF0ZSgke3hQb3N9LCAke3lQb3N9KWA7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBjZWxsIGJhY2tncm91bmQgd2l0aCBOb3Rpb24taW5zcGlyZWQgdmlzdWFsIGRlc2lnblxuICAgICAgICBkYXlDZWxscy5hcHBlbmQoJ3JlY3QnKVxuICAgICAgICAgICAgLmF0dHIoJ3dpZHRoJywgdGhpcy5jZWxsU2l6ZSAtIDQpXG4gICAgICAgICAgICAuYXR0cignaGVpZ2h0JywgdGhpcy5jZWxsU2l6ZSAtIDQpXG4gICAgICAgICAgICAuYXR0cigncngnLCA0KSAvLyBTdWJ0bGUgcm91bmRlZCBjb3JuZXJzIGxpa2UgTm90aW9uXG4gICAgICAgICAgICAuYXR0cigncnknLCA0KVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAoZDogRGF5RGF0YSkgPT4gZC50b3RhbEFtb3VudCA+IDAgPyBjb2xvclNjYWxlKGQudG90YWxBbW91bnQpIDogJ3RyYW5zcGFyZW50JylcbiAgICAgICAgICAgIC5hdHRyKCdzdHJva2UnLCAoZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIEhpZ2hsaWdodCB0b2RheSdzIGRhdGUgd2l0aCBhIHNwZWNpYWwgYm9yZGVyXG4gICAgICAgICAgICAgICAgaWYgKGlzQ3VycmVudE1vbnRoICYmIGQuZGF0ZS5nZXREYXRlKCkgPT09IHRvZGF5RGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZhcigtLWludGVyYWN0aXZlLWFjY2VudCknO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gJ3ZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKSc7IC8vIFVzaW5nIGEgbW9yZSB2aXNpYmxlIGJvcmRlciBjb2xvciBmcm9tIE9ic2lkaWFuXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmF0dHIoJ3N0cm9rZS13aWR0aCcsIChkOiBEYXlEYXRhKSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzQ3VycmVudE1vbnRoICYmIGQuZGF0ZS5nZXREYXRlKCkgPT09IHRvZGF5RGF0ZSA/IDIgOiAxLjU7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmF0dHIoJ29wYWNpdHknLCAoZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIE1vcmUgc3VidGxlIG9wYWNpdHkgZm9yIE5vdGlvbi1saWtlIGFlc3RoZXRpY1xuICAgICAgICAgICAgICAgIGNvbnN0IGlzV2Vla2VuZCA9IGQuZGF0ZS5nZXREYXkoKSA9PT0gMCB8fCBkLmRhdGUuZ2V0RGF5KCkgPT09IDY7XG4gICAgICAgICAgICAgICAgaWYgKGQudG90YWxBbW91bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAxLjA7IC8vIEZ1bGwgb3BhY2l0eSBmb3IgY2VsbHMgd2l0aCBleHBlbnNlc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gaXNXZWVrZW5kID8gMC43IDogMC42OyAvLyBTdWJ0bGUgZGlzdGluY3Rpb24gZm9yIHdlZWtlbmQgZGF5c1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jbGFzc2VkKCdoYXMtZXhwZW5zZXMnLCAoZDogRGF5RGF0YSkgPT4gZC50b3RhbEFtb3VudCA+IDApXG4gICAgICAgICAgICAuY2xhc3NlZCgnaXMtdG9kYXknLCAoZDogRGF5RGF0YSkgPT4gaXNDdXJyZW50TW9udGggJiYgZC5kYXRlLmdldERhdGUoKSA9PT0gdG9kYXlEYXRlKVxuICAgICAgICAgICAgLm9uKCdtb3VzZW92ZXInLCAoZXZlbnQ6IGFueSwgZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIEhpZ2hsaWdodCB0aGUgY2VsbFxuICAgICAgICAgICAgICAgIGNvbnN0IGNlbGwgPSBkMy5zZWxlY3QoZXZlbnQuY3VycmVudFRhcmdldCk7XG4gICAgICAgICAgICAgICAgY2VsbC50cmFuc2l0aW9uKClcbiAgICAgICAgICAgICAgICAgICAgLmR1cmF0aW9uKDEwMCkgLy8gRmFzdGVyIHRyYW5zaXRpb24gZm9yIGJldHRlciByZXNwb25zaXZlbmVzc1xuICAgICAgICAgICAgICAgICAgICAuYXR0cignc3Ryb2tlJywgJ3ZhcigtLWludGVyYWN0aXZlLWFjY2VudCknKVxuICAgICAgICAgICAgICAgICAgICAuYXR0cignc3Ryb2tlLXdpZHRoJywgMikgLy8gQ29uc2lzdGVudCB3aXRoIG5vbi1zZWxlY3RlZCBjZWxsc1xuICAgICAgICAgICAgICAgICAgICAuYXR0cignb3BhY2l0eScsIDEpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFNob3cgdG9vbHRpcFxuICAgICAgICAgICAgICAgIHRoaXMudG9vbHRpcERpdi50cmFuc2l0aW9uKClcbiAgICAgICAgICAgICAgICAgICAgLmR1cmF0aW9uKDEwMClcbiAgICAgICAgICAgICAgICAgICAgLnN0eWxlKCdvcGFjaXR5JywgLjkpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IGZvcm1hdEN1cnJlbmN5VmFsdWUgPSAodmFsdWU6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IEludGwuTnVtYmVyRm9ybWF0KCdlbi1VUycsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlOiAnY3VycmVuY3knLFxuICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVuY3k6IHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDdXJyZW5jeVxuICAgICAgICAgICAgICAgICAgICB9KS5mb3JtYXQodmFsdWUpO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQ291bnQgb25seSBleHBlbnNlIHRyYW5zYWN0aW9uc1xuICAgICAgICAgICAgICAgIGNvbnN0IGV4cGVuc2VUcmFuc2FjdGlvbnMgPSBkLnRyYW5zYWN0aW9ucy5maWx0ZXIodCA9PiB0LnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBDYWxjdWxhdGUgcGVyY2VudGFnZSBvZiBtb250aGx5IGV4cGVuc2VzIGZvciB0aGlzIGRheVxuICAgICAgICAgICAgICAgIGNvbnN0IG1vbnRobHlUb3RhbCA9IHRoaXMudHJhbnNhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIodCA9PiB0LnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5FWFBFTlNFKVxuICAgICAgICAgICAgICAgICAgICAucmVkdWNlKChzdW0sIHQpID0+IHN1bSArIHQuYW1vdW50LCAwKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zdCBwZXJjZW50YWdlID0gbW9udGhseVRvdGFsID4gMCA/ICgoZC50b3RhbEFtb3VudCAvIG1vbnRobHlUb3RhbCkgKiAxMDApLnRvRml4ZWQoMSkgOiAnMCc7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIGlmIHRoaXMgZGF5IGlzIGFib3ZlIGF2ZXJhZ2VcbiAgICAgICAgICAgICAgICBjb25zdCBkYXlzSW5Nb250aCA9IG5ldyBEYXRlKHllYXIsIG1vbnRoICsgMSwgMCkuZ2V0RGF0ZSgpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGNvbnN0IGRhaWx5QXZlcmFnZSA9IG1vbnRobHlUb3RhbCAvIGRheXNJbk1vbnRoO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbXBhcmVkVG9BdmVyYWdlID0gZGFpbHlBdmVyYWdlID4gMCBcbiAgICAgICAgICAgICAgICAgICAgPyAoKChkLnRvdGFsQW1vdW50IC0gZGFpbHlBdmVyYWdlKSAvIGRhaWx5QXZlcmFnZSkgKiAxMDApLnRvRml4ZWQoMClcbiAgICAgICAgICAgICAgICAgICAgOiAnMCc7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbGV0IGNvbXBhcmlzb25UZXh0ID0gJyc7XG4gICAgICAgICAgICAgICAgaWYgKGQudG90YWxBbW91bnQgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXJzZUludChjb21wYXJlZFRvQXZlcmFnZSkgPiAyMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29tcGFyaXNvblRleHQgPSBgPGRpdiBjbGFzcz1cInRvb2x0aXAtY29tcGFyaXNvbiB0b29sdGlwLWhpZ2hlclwiPuKWsiAke2NvbXBhcmVkVG9BdmVyYWdlfSUgYWJvdmUgZGFpbHkgYXZlcmFnZTwvZGl2PmA7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGFyc2VJbnQoY29tcGFyZWRUb0F2ZXJhZ2UpIDwgLTIwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wYXJpc29uVGV4dCA9IGA8ZGl2IGNsYXNzPVwidG9vbHRpcC1jb21wYXJpc29uIHRvb2x0aXAtbG93ZXJcIj7ilrwgJHtNYXRoLmFicyhwYXJzZUludChjb21wYXJlZFRvQXZlcmFnZSkpfSUgYmVsb3cgZGFpbHkgYXZlcmFnZTwvZGl2PmA7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gRW5oYW5jZWQgdG9vbHRpcCB3aXRoIG1vcmUgY29udGV4dFxuICAgICAgICAgICAgICAgIHRoaXMudG9vbHRpcERpdi5odG1sKGBcbiAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRvb2x0aXAtdGl0bGVcIj4ke2QuZm9ybWF0dGVkRGF0ZX08L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInRvb2x0aXAtdmFsdWVcIj4ke2Zvcm1hdEN1cnJlbmN5VmFsdWUoZC50b3RhbEFtb3VudCl9PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ0b29sdGlwLWhpbnRcIj4ke2V4cGVuc2VUcmFuc2FjdGlvbnMubGVuZ3RofSBleHBlbnNlKHMpIMK3ICR7cGVyY2VudGFnZX0lIG9mIG1vbnRobHkgc3BlbmQ8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgJHtjb21wYXJpc29uVGV4dH1cbiAgICAgICAgICAgICAgICBgKVxuICAgICAgICAgICAgICAgICAgICAuc3R5bGUoJ2xlZnQnLCAoZXZlbnQucGFnZVggKyAxMCkgKyAncHgnKVxuICAgICAgICAgICAgICAgICAgICAuc3R5bGUoJ3RvcCcsIChldmVudC5wYWdlWSAtIDI4KSArICdweCcpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5vbignbW91c2VvdXQnLCAoZXZlbnQ6IGFueSwgZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIERvbid0IHJlc2V0IGlmIHRoaXMgaXMgdGhlIHNlbGVjdGVkIGNlbGxcbiAgICAgICAgICAgICAgICBpZiAoc2VsZWN0ZWRDZWxsICYmIHNlbGVjdGVkQ2VsbC5ub2RlKCkgPT09IGV2ZW50LmN1cnJlbnRUYXJnZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBSZXNldCB0aGUgY2VsbCB3aXRoIE5vdGlvbiBzdHlsaW5nXG4gICAgICAgICAgICAgICAgZDMuc2VsZWN0KGV2ZW50LmN1cnJlbnRUYXJnZXQpXG4gICAgICAgICAgICAgICAgICAgIC50cmFuc2l0aW9uKClcbiAgICAgICAgICAgICAgICAgICAgLmR1cmF0aW9uKDEwMCkgLy8gRmFzdGVyIHRyYW5zaXRpb24gZm9yIGJldHRlciByZXNwb25zaXZlbmVzc1xuICAgICAgICAgICAgICAgICAgICAuYXR0cignc3Ryb2tlJywgKGQ6IERheURhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE1haW50YWluIHRvZGF5J3MgaGlnaGxpZ2h0XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNDdXJyZW50TW9udGggJiYgZC5kYXRlLmdldERhdGUoKSA9PT0gdG9kYXlEYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICd2YXIoLS1pbnRlcmFjdGl2ZS1hY2NlbnQpJztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAndmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpJzsgLy8gVXNpbmcgYSBtb3JlIHZpc2libGUgYm9yZGVyIGNvbG9yIGZyb20gT2JzaWRpYW5cbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3N0cm9rZS13aWR0aCcsIChkOiBEYXlEYXRhKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gaXNDdXJyZW50TW9udGggJiYgZC5kYXRlLmdldERhdGUoKSA9PT0gdG9kYXlEYXRlID8gMiA6IDEuNTtcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ29wYWNpdHknLCAoZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gTm90aW9uLWxpa2Ugb3BhY2l0eSB2YWx1ZXNcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlzV2Vla2VuZCA9IGQuZGF0ZS5nZXREYXkoKSA9PT0gMCB8fCBkLmRhdGUuZ2V0RGF5KCkgPT09IDY7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZC50b3RhbEFtb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gMS4wOyAvLyBGdWxsIG9wYWNpdHkgZm9yIGNlbGxzIHdpdGggZXhwZW5zZXNcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBpc1dlZWtlbmQgPyAwLjcgOiAwLjY7IC8vIFN1YnRsZSBkaXN0aW5jdGlvbiBmb3Igd2Vla2VuZCBkYXlzXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEhpZGUgdG9vbHRpcCB3aXRoIHN1YnRsZSBmYWRlXG4gICAgICAgICAgICAgICAgdGhpcy50b29sdGlwRGl2LnRyYW5zaXRpb24oKVxuICAgICAgICAgICAgICAgICAgICAuZHVyYXRpb24oMTAwKVxuICAgICAgICAgICAgICAgICAgICAuc3R5bGUoJ29wYWNpdHknLCAwKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAub24oJ2NsaWNrJywgKGV2ZW50OiBhbnksIGQ6IERheURhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBSZW1vdmUgcHJldmlvdXMgc2VsZWN0aW9uXG4gICAgICAgICAgICAgICAgaWYgKHNlbGVjdGVkQ2VsbCkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZENlbGxcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdzdHJva2UnLCAoZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE1haW50YWluIHRvZGF5J3MgaGlnaGxpZ2h0IHdpdGggTm90aW9uIHN0eWxpbmdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNDdXJyZW50TW9udGggJiYgZC5kYXRlLmdldERhdGUoKSA9PT0gdG9kYXlEYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAndmFyKC0taW50ZXJhY3RpdmUtYWNjZW50KSc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAndmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpJzsgLy8gVXNpbmcgYSBtb3JlIHZpc2libGUgYm9yZGVyIGNvbG9yIGZyb20gT2JzaWRpYW5cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cignc3Ryb2tlLXdpZHRoJywgKGQ6IERheURhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gaXNDdXJyZW50TW9udGggJiYgZC5kYXRlLmdldERhdGUoKSA9PT0gdG9kYXlEYXRlID8gMiA6IDEuNTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBIaWdobGlnaHQgdGhlIHNlbGVjdGVkIGNlbGwgd2l0aCBhIE5vdGlvbi1saWtlIHN1YnRsZSBoaWdobGlnaHRcbiAgICAgICAgICAgICAgICBzZWxlY3RlZENlbGwgPSBkMy5zZWxlY3QoZXZlbnQuY3VycmVudFRhcmdldCk7XG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRDZWxsXG4gICAgICAgICAgICAgICAgICAgIC5hdHRyKCdzdHJva2UnLCAndmFyKC0taW50ZXJhY3RpdmUtYWNjZW50KScpXG4gICAgICAgICAgICAgICAgICAgIC5hdHRyKCdzdHJva2Utd2lkdGgnLCAyLjUpOyAvLyBJbmNyZWFzZWQgdGhpY2tuZXNzIGZvciBiZXR0ZXIgdmlzaWJpbGl0eVxuICAgICAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWREYXRlID0gZC5kYXRlO1xuICAgICAgICAgICAgICAgIHRoaXMub25TZWxlY3RlZERhdGVDaGFuZ2U/LihkLmRhdGUpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFNob3cgdHJhbnNhY3Rpb24gZGV0YWlscyB3aXRoIGEgbmljZSB0cmFuc2l0aW9uXG4gICAgICAgICAgICAgICAgdGhpcy5zaG93RGF5RGV0YWlscyhkKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgLy8gQWRkIGRheSBudW1iZXIgd2l0aCBOb3Rpb24taW5zcGlyZWQgc3R5bGluZ1xuICAgICAgICBkYXlDZWxscy5hcHBlbmQoJ3RleHQnKVxuICAgICAgICAgICAgLmF0dHIoJ3gnLCB0aGlzLmNlbGxTaXplIC8gMiAtIDIpXG4gICAgICAgICAgICAuYXR0cigneScsIHRoaXMuY2VsbFNpemUgLyAyIC0gNilcbiAgICAgICAgICAgIC5hdHRyKCd0ZXh0LWFuY2hvcicsICdtaWRkbGUnKVxuICAgICAgICAgICAgLmF0dHIoJ2RvbWluYW50LWJhc2VsaW5lJywgJ21pZGRsZScpXG4gICAgICAgICAgICAuYXR0cignZm9udC1zaXplJywgJzEzcHgnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtd2VpZ2h0JywgKGQ6IERheURhdGEpID0+IGQudG90YWxBbW91bnQgPiAwID8gJzUwMCcgOiAnNDAwJylcbiAgICAgICAgICAgIC5hdHRyKCdwb2ludGVyLWV2ZW50cycsICdub25lJylcbiAgICAgICAgICAgIC5hdHRyKCdmaWxsJywgKGQ6IERheURhdGEpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZC50b3RhbEFtb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0VGV4dENvbG9yKGQudG90YWxBbW91bnQsIGNvbG9yU2NhbGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gJ3ZhcigtLXRleHQtbm9ybWFsKSc7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnRleHQoKGQ6IERheURhdGEpID0+IGQuZGF0ZS5nZXREYXRlKCkpO1xuICAgICAgICBcbiAgICAgICAgLy8gQWRkIHNwZW5kaW5nIGFtb3VudCBmb3IgZGF5cyB3aXRoIGV4cGVuc2VzIHdpdGggTm90aW9uLWxpa2Ugc3R5bGluZ1xuICAgICAgICBkYXlDZWxscy5maWx0ZXIoKGQ6IERheURhdGEpID0+IGQudG90YWxBbW91bnQgPiAwKVxuICAgICAgICAgICAgLmFwcGVuZCgndGV4dCcpXG4gICAgICAgICAgICAuYXR0cigneCcsIHRoaXMuY2VsbFNpemUgLyAyIC0gMilcbiAgICAgICAgICAgIC5hdHRyKCd5JywgdGhpcy5jZWxsU2l6ZSAvIDIgKyAxMilcbiAgICAgICAgICAgIC5hdHRyKCd0ZXh0LWFuY2hvcicsICdtaWRkbGUnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtc2l6ZScsICcxMHB4JylcbiAgICAgICAgICAgIC5hdHRyKCdmb250LXdlaWdodCcsICc1MDAnKVxuICAgICAgICAgICAgLmF0dHIoJ3BvaW50ZXItZXZlbnRzJywgJ25vbmUnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAoZDogRGF5RGF0YSkgPT4gdGhpcy5nZXRUZXh0Q29sb3IoZC50b3RhbEFtb3VudCwgY29sb3JTY2FsZSkpXG4gICAgICAgICAgICAudGV4dCgoZDogRGF5RGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbmN5ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdEN1cnJlbmN5O1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgSW50bC5OdW1iZXJGb3JtYXQoJ2VuLVVTJywge1xuICAgICAgICAgICAgICAgICAgICBzdHlsZTogJ2N1cnJlbmN5JyxcbiAgICAgICAgICAgICAgICAgICAgY3VycmVuY3k6IGN1cnJlbmN5LFxuICAgICAgICAgICAgICAgICAgICBub3RhdGlvbjogJ2NvbXBhY3QnLFxuICAgICAgICAgICAgICAgICAgICBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDBcbiAgICAgICAgICAgICAgICB9KS5mb3JtYXQoZC50b3RhbEFtb3VudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCB0aW55IGluZGljYXRvciBmb3IgZGF5cyB3aXRoIGluY29tZVxuICAgICAgICBkYXlDZWxscy5maWx0ZXIoKGQ6IERheURhdGEpID0+IGQudHJhbnNhY3Rpb25zLnNvbWUodCA9PiB0LnR5cGUgPT09IFRyYW5zYWN0aW9uVHlwZS5JTkNPTUUpKVxuICAgICAgICAgICAgLmFwcGVuZCgnY2lyY2xlJylcbiAgICAgICAgICAgIC5hdHRyKCdjeCcsIHRoaXMuY2VsbFNpemUgLSAxMilcbiAgICAgICAgICAgIC5hdHRyKCdjeScsIDEwKVxuICAgICAgICAgICAgLmF0dHIoJ3InLCAzLjUpXG4gICAgICAgICAgICAuYXR0cignZmlsbCcsICd2YXIoLS1leHBlbnNpY2Etc3VjY2VzcyknKVxuICAgICAgICAgICAgLmF0dHIoJ3BvaW50ZXItZXZlbnRzJywgJ25vbmUnKVxuICAgICAgICAgICAgLmF0dHIoJ29wYWNpdHknLCAwLjgpO1xuICAgICAgICBcbiAgICAgICAgLy8gQWRkIGNvbG9yIGxlZ2VuZFxuICAgICAgICB0aGlzLnJlbmRlckNvbG9yTGVnZW5kKGNvbG9yU2NhbGUsIHdlZWtOdW1iZXJzT2Zmc2V0LCBjYWxlbmRhckhlaWdodCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoYW5pbWF0ZUNlbGxzKSB7XG4gICAgICAgICAgICAvLyBPbmx5IGFuaW1hdGUgd2hlbiBtb250aC9kYXRhIGNoYW5nZXMsIG5vdCBkdXJpbmcgcmVzaXplIG9yIHdvcmtzcGFjZSBmb2N1cyByZWZyZXNoZXMuXG4gICAgICAgICAgICBkYXlDZWxsc1xuICAgICAgICAgICAgICAgIC5zdHlsZSgnb3BhY2l0eScsIDApXG4gICAgICAgICAgICAgICAgLnRyYW5zaXRpb24oKVxuICAgICAgICAgICAgICAgIC5kdXJhdGlvbig1MDApXG4gICAgICAgICAgICAgICAgLmRlbGF5KChkOiBEYXlEYXRhLCBpOiBudW1iZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGF5T2ZNb250aCA9IGQuZGF0ZS5nZXREYXRlKCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRheU9mV2VlayA9IGQuZGF0ZS5nZXREYXkoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgd2Vla09mTW9udGggPSBNYXRoLmZsb29yKChkYXlPZk1vbnRoICsgZmlyc3REYXlPZk1vbnRoIC0gMSkgLyA3KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICh3ZWVrT2ZNb250aCAqIDcgKyBkYXlPZldlZWspICogMjA7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAuc3R5bGUoJ29wYWNpdHknLCAxKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3Qgc2VsZWN0ZWREYXRhID0gdGhpcy5zZWxlY3RlZERhdGVcbiAgICAgICAgICAgID8gdGhpcy5jYWxlbmRhckRhdGEuZmluZChkID0+IHRoaXMuaXNTYW1lRGF0ZShkLmRhdGUsIHRoaXMuc2VsZWN0ZWREYXRlISkpXG4gICAgICAgICAgICA6IG51bGw7XG5cbiAgICAgICAgaWYgKHNlbGVjdGVkRGF0YSkge1xuICAgICAgICAgICAgdGhpcy5zaG93RGF5RGV0YWlscyhzZWxlY3RlZERhdGEpO1xuICAgICAgICAgICAgY29uc3Qgc2VsZWN0ZWREYXRlQ2VsbCA9IHRoaXMuc3ZnLnNlbGVjdEFsbCgnLmRheS1jZWxsIHJlY3QnKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKGQ6IGFueSkgPT4gdGhpcy5pc1NhbWVEYXRlKGQuZGF0ZSwgc2VsZWN0ZWREYXRhLmRhdGUpKTtcbiAgICAgICAgICAgIHNlbGVjdGVkRGF0ZUNlbGwuYXR0cignc3Ryb2tlJywgJ3ZhcigtLWludGVyYWN0aXZlLWFjY2VudCknKVxuICAgICAgICAgICAgICAgIC5hdHRyKCdzdHJva2Utd2lkdGgnLCAyLjUpO1xuICAgICAgICAgICAgc2VsZWN0ZWRDZWxsID0gc2VsZWN0ZWREYXRlQ2VsbDtcbiAgICAgICAgfSBlbHNlIGlmIChpc0N1cnJlbnRNb250aCkge1xuICAgICAgICAgICAgY29uc3QgdG9kYXlEYXRhID0gdGhpcy5jYWxlbmRhckRhdGEuZmluZChkID0+IGQuZGF0ZS5nZXREYXRlKCkgPT09IHRvZGF5RGF0ZSk7XG4gICAgICAgICAgICBpZiAodG9kYXlEYXRhKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zaG93RGF5RGV0YWlscyh0b2RheURhdGEpO1xuICAgICAgICAgICAgICAgIC8vIEFsc28gdmlzdWFsbHkgc2VsZWN0IHRvZGF5J3MgY2VsbFxuICAgICAgICAgICAgICAgIGNvbnN0IHRvZGF5Q2VsbCA9IHRoaXMuc3ZnLnNlbGVjdEFsbCgnLmRheS1jZWxsIHJlY3QnKVxuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChkOiBhbnkpID0+IGQuZGF0ZS5nZXREYXRlKCkgPT09IHRvZGF5RGF0ZSk7XG4gICAgICAgICAgICAgICAgdG9kYXlDZWxsLmF0dHIoJ3N0cm9rZScsICd2YXIoLS1pbnRlcmFjdGl2ZS1hY2NlbnQpJylcbiAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3N0cm9rZS13aWR0aCcsIDIpO1xuICAgICAgICAgICAgICAgIHNlbGVjdGVkQ2VsbCA9IHRvZGF5Q2VsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGZpcnN0IGRheSB3aXRoIGV4cGVuc2VzIGFzIGZhbGxiYWNrXG4gICAgICAgICAgICBjb25zdCBmaXJzdERheVdpdGhFeHBlbnNlcyA9IHRoaXMuY2FsZW5kYXJEYXRhLmZpbmQoZCA9PiBkLnRvdGFsQW1vdW50ID4gMCk7XG4gICAgICAgICAgICBpZiAoZmlyc3REYXlXaXRoRXhwZW5zZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dEYXlEZXRhaWxzKGZpcnN0RGF5V2l0aEV4cGVuc2VzKTtcbiAgICAgICAgICAgICAgICAvLyBBbHNvIHZpc3VhbGx5IHNlbGVjdCB0aGlzIGNlbGxcbiAgICAgICAgICAgICAgICBjb25zdCBmaXJzdEV4cGVuc2VDZWxsID0gdGhpcy5zdmcuc2VsZWN0QWxsKCcuZGF5LWNlbGwgcmVjdCcpXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKGQ6IGFueSkgPT4gZC5kYXRlLmdldERhdGUoKSA9PT0gZmlyc3REYXlXaXRoRXhwZW5zZXMuZGF0ZS5nZXREYXRlKCkpO1xuICAgICAgICAgICAgICAgIGZpcnN0RXhwZW5zZUNlbGwuYXR0cignc3Ryb2tlJywgJ3ZhcigtLWludGVyYWN0aXZlLWFjY2VudCknKVxuICAgICAgICAgICAgICAgICAgICAuYXR0cignc3Ryb2tlLXdpZHRoJywgMik7XG4gICAgICAgICAgICAgICAgc2VsZWN0ZWRDZWxsID0gZmlyc3RFeHBlbnNlQ2VsbDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gRGVmYXVsdCB0byBmaXJzdCBkYXkgb2YgbW9udGggaWYgbm8gZXhwZW5zZXNcbiAgICAgICAgICAgICAgICB0aGlzLnNob3dEYXlEZXRhaWxzKHRoaXMuY2FsZW5kYXJEYXRhWzBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgaXNTYW1lRGF0ZShsZWZ0OiBEYXRlLCByaWdodDogRGF0ZSk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gbGVmdC5nZXRGdWxsWWVhcigpID09PSByaWdodC5nZXRGdWxsWWVhcigpXG4gICAgICAgICAgICAmJiBsZWZ0LmdldE1vbnRoKCkgPT09IHJpZ2h0LmdldE1vbnRoKClcbiAgICAgICAgICAgICYmIGxlZnQuZ2V0RGF0ZSgpID09PSByaWdodC5nZXREYXRlKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRUZXh0Q29sb3IoYW1vdW50OiBudW1iZXIsIGNvbG9yU2NhbGU6IGFueSk6IHN0cmluZyB7XG4gICAgICAgIGlmIChhbW91bnQgPT09IDApIHJldHVybiAndmFyKC0tdGV4dC1tdXRlZCknO1xuICAgICAgICBcbiAgICAgICAgLy8gVHJhbnNwYXJlbnQvbG93LW9wYWNpdHkgaGVhdG1hcCBjZWxscyB2aXN1YWxseSBzaXQgb24gdGhlIE9ic2lkaWFuIGJhY2tncm91bmQuXG4gICAgICAgIGNvbnN0IGNvbG9yID0gZDMucmdiKGNvbG9yU2NhbGUoYW1vdW50KSk7XG4gICAgICAgIGlmIChjb2xvci5vcGFjaXR5IDwgMC41NSkge1xuICAgICAgICAgICAgcmV0dXJuICd2YXIoLS10ZXh0LW5vcm1hbCknO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbHVtaW5hbmNlID0gMC4yOTkgKiBjb2xvci5yICsgMC41ODcgKiBjb2xvci5nICsgMC4xMTQgKiBjb2xvci5iO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIGx1bWluYW5jZSA+IDE2MCA/ICd2YXIoLS10ZXh0LW5vcm1hbCknIDogJ3ZhcigtLXRleHQtb24tYWNjZW50KSc7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZW5kZXJDb2xvckxlZ2VuZChjb2xvclNjYWxlOiBhbnksIHdlZWtOdW1iZXJzT2Zmc2V0OiBudW1iZXIsIGNhbGVuZGFySGVpZ2h0OiBudW1iZXIpIHtcbiAgICAgICAgLy8gQ3JlYXRlIGEgY2VudGVyZWQgbGVnZW5kIGF0IHRoZSBib3R0b20gd2l0aCBpbXByb3ZlZCBOb3Rpb24taW5zcGlyZWQgc3R5bGluZ1xuICAgICAgICBjb25zdCBsZWdlbmRXaWR0aCA9IDIyMDsgLy8gV2lkZXIgbGVnZW5kIGZvciBiZXR0ZXIgdmlzaWJpbGl0eVxuICAgICAgICBjb25zdCBsZWdlbmRIZWlnaHQgPSAxNjsgLy8gVGFsbGVyIGJhciBmb3IgYmV0dGVyIHZpc2liaWxpdHlcbiAgICAgICAgY29uc3QgbGVnZW5kWSA9IGNhbGVuZGFySGVpZ2h0ICsgMzU7IC8vIEluY3JlYXNlZCBmcm9tIDIwcHggdG8gMzVweCBmb3IgbW9yZSBzcGFjZSBhdCB0aGUgdG9wXG4gICAgICAgIFxuICAgICAgICBjb25zdCBsZWdlbmQgPSB0aGlzLnN2Zy5hcHBlbmQoJ2cnKVxuICAgICAgICAgICAgLmF0dHIoJ2NsYXNzJywgJ2xlZ2VuZCcpXG4gICAgICAgICAgICAuYXR0cigndHJhbnNmb3JtJywgYHRyYW5zbGF0ZSgkeyh0aGlzLndpZHRoICsgd2Vla051bWJlcnNPZmZzZXQgLSBsZWdlbmRXaWR0aCkgLyAyfSwgJHtsZWdlbmRZfSlgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBsZWdlbmQgdGl0bGUgd2l0aCBpbXByb3ZlZCBzdHlsaW5nXG4gICAgICAgIGxlZ2VuZC5hcHBlbmQoJ3RleHQnKVxuICAgICAgICAgICAgLmF0dHIoJ3gnLCBsZWdlbmRXaWR0aCAvIDIpXG4gICAgICAgICAgICAuYXR0cigneScsIC0xNSlcbiAgICAgICAgICAgIC5hdHRyKCd0ZXh0LWFuY2hvcicsICdtaWRkbGUnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtc2l6ZScsICcxM3B4JylcbiAgICAgICAgICAgIC5hdHRyKCdmb250LXdlaWdodCcsICc1MDAnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAndmFyKC0tdGV4dC1ub3JtYWwpJylcbiAgICAgICAgICAgIC50ZXh0KCdTcGVuZGluZyBJbnRlbnNpdHknKTtcbiAgICAgICAgXG4gICAgICAgIC8vIENyZWF0ZSBncmFkaWVudFxuICAgICAgICBjb25zdCBkZWZzID0gdGhpcy5zdmcuYXBwZW5kKCdkZWZzJyk7XG4gICAgICAgIGNvbnN0IGdyYWRpZW50ID0gZGVmcy5hcHBlbmQoJ2xpbmVhckdyYWRpZW50JylcbiAgICAgICAgICAgIC5hdHRyKCdpZCcsICdsZWdlbmQtZ3JhZGllbnQnKVxuICAgICAgICAgICAgLmF0dHIoJ3gxJywgJzAlJylcbiAgICAgICAgICAgIC5hdHRyKCd5MScsICcwJScpXG4gICAgICAgICAgICAuYXR0cigneDInLCAnMTAwJScpXG4gICAgICAgICAgICAuYXR0cigneTInLCAnMCUnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBjb2xvciBzdG9wc1xuICAgICAgICBjb25zdCBzdGVwcyA9IDEwO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBzdGVwczsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBvZmZzZXQgPSBpIC8gc3RlcHM7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IG9mZnNldCAqIHRoaXMubWF4QW1vdW50O1xuICAgICAgICAgICAgZ3JhZGllbnQuYXBwZW5kKCdzdG9wJylcbiAgICAgICAgICAgICAgICAuYXR0cignb2Zmc2V0JywgYCR7b2Zmc2V0ICogMTAwfSVgKVxuICAgICAgICAgICAgICAgIC5hdHRyKCdzdG9wLWNvbG9yJywgY29sb3JTY2FsZSh2YWx1ZSkpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBEcmF3IHRoZSBncmFkaWVudCByZWN0IHdpdGggaW1wcm92ZWQgc3R5bGluZ1xuICAgICAgICBsZWdlbmQuYXBwZW5kKCdyZWN0JylcbiAgICAgICAgICAgIC5hdHRyKCd3aWR0aCcsIGxlZ2VuZFdpZHRoKVxuICAgICAgICAgICAgLmF0dHIoJ2hlaWdodCcsIGxlZ2VuZEhlaWdodClcbiAgICAgICAgICAgIC5hdHRyKCdmaWxsJywgJ3VybCgjbGVnZW5kLWdyYWRpZW50KScpXG4gICAgICAgICAgICAuYXR0cigncngnLCA0KSAvLyBNb3JlIG5vdGljZWFibGUgcm91bmRpbmdcbiAgICAgICAgICAgIC5hdHRyKCdyeScsIDQpXG4gICAgICAgICAgICAuYXR0cignc3Ryb2tlJywgJ3ZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKScpIC8vIE1hdGNoIGNlbGwgYm9yZGVyIGNvbG9yXG4gICAgICAgICAgICAuYXR0cignc3Ryb2tlLXdpZHRoJywgMS41KTsgLy8gTWF0Y2ggY2VsbCBib3JkZXIgdGhpY2tuZXNzXG4gICAgICAgIFxuICAgICAgICAvLyBBZGQgbWluIGFuZCBtYXggbGFiZWxzIHdpdGggaW1wcm92ZWQgc3R5bGluZ1xuICAgICAgICBsZWdlbmQuYXBwZW5kKCd0ZXh0JylcbiAgICAgICAgICAgIC5hdHRyKCd4JywgMClcbiAgICAgICAgICAgIC5hdHRyKCd5JywgbGVnZW5kSGVpZ2h0ICsgMTYpXG4gICAgICAgICAgICAuYXR0cigndGV4dC1hbmNob3InLCAnc3RhcnQnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtc2l6ZScsICcxMnB4JylcbiAgICAgICAgICAgIC5hdHRyKCdmb250LXdlaWdodCcsICc1MDAnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAndmFyKC0tdGV4dC1tdXRlZCknKVxuICAgICAgICAgICAgLnRleHQoZm9ybWF0Q3VycmVuY3koMCwgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdEN1cnJlbmN5KSk7XG4gICAgICAgIFxuICAgICAgICBsZWdlbmQuYXBwZW5kKCd0ZXh0JylcbiAgICAgICAgICAgIC5hdHRyKCd4JywgbGVnZW5kV2lkdGgpXG4gICAgICAgICAgICAuYXR0cigneScsIGxlZ2VuZEhlaWdodCArIDE2KVxuICAgICAgICAgICAgLmF0dHIoJ3RleHQtYW5jaG9yJywgJ2VuZCcpXG4gICAgICAgICAgICAuYXR0cignZm9udC1zaXplJywgJzEycHgnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZvbnQtd2VpZ2h0JywgJzUwMCcpXG4gICAgICAgICAgICAuYXR0cignZmlsbCcsICd2YXIoLS10ZXh0LW11dGVkKScpXG4gICAgICAgICAgICAudGV4dChmb3JtYXRDdXJyZW5jeSh0aGlzLm1heEFtb3VudCwgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdEN1cnJlbmN5KSk7XG4gICAgICAgICAgICBcbiAgICAgICAgLy8gQWRkIFwibWluXCIgYW5kIFwibWF4XCIgbGFiZWxzIGZvciBjbGFyaXR5XG4gICAgICAgIGxlZ2VuZC5hcHBlbmQoJ3RleHQnKVxuICAgICAgICAgICAgLmF0dHIoJ3gnLCAwKVxuICAgICAgICAgICAgLmF0dHIoJ3knLCBsZWdlbmRIZWlnaHQgKyAzMilcbiAgICAgICAgICAgIC5hdHRyKCd0ZXh0LWFuY2hvcicsICdzdGFydCcpXG4gICAgICAgICAgICAuYXR0cignZm9udC1zaXplJywgJzEwcHgnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAndmFyKC0tdGV4dC1mYWludCknKVxuICAgICAgICAgICAgLnRleHQoJ01pbmltdW0nKTtcbiAgICAgICAgICAgIFxuICAgICAgICBsZWdlbmQuYXBwZW5kKCd0ZXh0JylcbiAgICAgICAgICAgIC5hdHRyKCd4JywgbGVnZW5kV2lkdGgpXG4gICAgICAgICAgICAuYXR0cigneScsIGxlZ2VuZEhlaWdodCArIDMyKVxuICAgICAgICAgICAgLmF0dHIoJ3RleHQtYW5jaG9yJywgJ2VuZCcpXG4gICAgICAgICAgICAuYXR0cignZm9udC1zaXplJywgJzEwcHgnKVxuICAgICAgICAgICAgLmF0dHIoJ2ZpbGwnLCAndmFyKC0tdGV4dC1mYWludCknKVxuICAgICAgICAgICAgLnRleHQoJ01heGltdW0nKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHNob3dEYXlEZXRhaWxzKGRheURhdGE6IERheURhdGEpIHtcbiAgICAgICAgdGhpcy5kZXRhaWxzQ29udGFpbmVyLmVtcHR5KCk7XG4gICAgICAgIFxuICAgICAgICAvLyBHZXQgZXhwZW5zZSB0cmFuc2FjdGlvbnNcbiAgICAgICAgY29uc3QgZXhwZW5zZVRyYW5zYWN0aW9ucyA9IGRheURhdGEudHJhbnNhY3Rpb25zLmZpbHRlcih0ID0+IFxuICAgICAgICAgICAgdC50eXBlID09PSBUcmFuc2FjdGlvblR5cGUuRVhQRU5TRVxuICAgICAgICApO1xuICAgICAgICBcbiAgICAgICAgLy8gR2V0IHRvdGFsIGV4cGVuc2VzXG4gICAgICAgIGNvbnN0IHRvdGFsRXhwZW5zZXMgPSBleHBlbnNlVHJhbnNhY3Rpb25zLnJlZHVjZSgoc3VtLCB0KSA9PiBzdW0gKyB0LmFtb3VudCwgMCk7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRBY2NvdW50UmVmZXJlbmNlID0gdGhpcy5wbHVnaW4ubm9ybWFsaXplVHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlKHVuZGVmaW5lZCk7XG4gICAgICAgIGNvbnN0IGRheUJhbGFuY2UgPSBkYXlEYXRhLmRheUJhbGFuY2U7XG4gICAgICAgIFxuICAgICAgICAvLyBBZGQgdGl0bGUgd2l0aCBkYXkgb2Ygd2Vla1xuICAgICAgICBjb25zdCBkYXlPZldlZWsgPSBkYXlEYXRhLmRhdGUudG9Mb2NhbGVEYXRlU3RyaW5nKCdlbi1VUycsIHsgd2Vla2RheTogJ2xvbmcnIH0pO1xuICAgICAgICB0aGlzLmRldGFpbHNDb250YWluZXIuY3JlYXRlRWwoJ2gzJywgeyBcbiAgICAgICAgICAgIHRleHQ6IGAke2RheU9mV2Vla30sICR7ZGF5RGF0YS5mb3JtYXR0ZWREYXRlfWAsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2FsZW5kYXItZGV0YWlscy10aXRsZScgXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIG5vIGV4cGVuc2UgdHJhbnNhY3Rpb25zLCBzaG93IG1lc3NhZ2Ugd2l0aG91dCB0aGUgc3BlbmRpbmcgc3VtbWFyeS5cbiAgICAgICAgaWYgKGV4cGVuc2VUcmFuc2FjdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBjb25zdCBlbXB0eVN0YXRlRWwgPSB0aGlzLmRldGFpbHNDb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2FsZW5kYXItZW1wdHktc3RhdGUnKTtcbiAgICAgICAgICAgIGVtcHR5U3RhdGVFbC5jcmVhdGVFbCgnZGl2JywgeyB0ZXh0OiAn4pyoJywgY2xzOiAnZXhwZW5zaWNhLWNhbGVuZGFyLWVtcHR5LWljb24nIH0pO1xuICAgICAgICAgICAgZW1wdHlTdGF0ZUVsLmNyZWF0ZUVsKCdwJywge1xuICAgICAgICAgICAgICAgIHRleHQ6ICdObyBleHBlbnNlcyByZWNvcmRlZCBmb3IgdGhpcyBkYXkuJyxcbiAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2FsZW5kYXItZW1wdHktbWVzc2FnZSdcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENyZWF0ZSBzdW1tYXJ5IGNvbnRhaW5lclxuICAgICAgICBjb25zdCBzdW1tYXJ5Q29udGFpbmVyID0gdGhpcy5kZXRhaWxzQ29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhbGVuZGFyLXN1bW1hcnknKTtcbiAgICAgICAgY29uc3QgbWV0cmljc0NvbnRhaW5lciA9IHN1bW1hcnlDb250YWluZXIuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2FsZW5kYXItZGV0YWlscy1tZXRyaWNzJyk7XG4gICAgICAgIFxuICAgICAgICAvLyBEaXNwbGF5IHNwZW5kaW5nIGFuZCBiYWxhbmNlXG4gICAgICAgIGNvbnN0IHRvdGFsRWwgPSBtZXRyaWNzQ29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhbGVuZGFyLWRldGFpbHMtdG90YWwnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIExlZnQgc2lkZSB3aXRoIGxhYmVsIGFuZCBpY29uXG4gICAgICAgIGNvbnN0IGxhYmVsQ29udGFpbmVyID0gdG90YWxFbC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLWxhYmVsJyk7XG4gICAgICAgIC8vIEFkZCBjdXJyZW5jeSBpY29uIChzaW1pbGFyIHRvIE5vdGlvbidzIGFwcHJvYWNoIHdpdGggaWNvbnMpXG4gICAgICAgIGNvbnN0IGljb25TcGFuID0gbGFiZWxDb250YWluZXIuY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2FsZW5kYXItZGV0YWlscy1pY29uJyxcbiAgICAgICAgICAgIHRleHQ6ICfwn5KwJ1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGxhYmVsQ29udGFpbmVyLmNyZWF0ZVNwYW4oe1xuICAgICAgICAgICAgdGV4dDogJ1RvdGFsIFNwZW50JyxcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLXRleHQnXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgLy8gUmlnaHQgc2lkZSB3aXRoIGFtb3VudFxuICAgICAgICB0b3RhbEVsLmNyZWF0ZVNwYW4oe1xuICAgICAgICAgICAgdGV4dDogZm9ybWF0Q3VycmVuY3kodG90YWxFeHBlbnNlcywgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVmYXVsdEN1cnJlbmN5KSxcbiAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLWFtb3VudCBleHBlbnNpY2EtZXhwZW5zZSdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYmFsYW5jZUVsID0gbWV0cmljc0NvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLXRvdGFsJyk7XG4gICAgICAgIGNvbnN0IGJhbGFuY2VMYWJlbENvbnRhaW5lciA9IGJhbGFuY2VFbC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLWxhYmVsJyk7XG5cbiAgICAgICAgYmFsYW5jZUxhYmVsQ29udGFpbmVyLmNyZWF0ZVNwYW4oe1xuICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWNhbGVuZGFyLWRldGFpbHMtaWNvbicsXG4gICAgICAgICAgICB0ZXh0OiAn8J+SuCdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmFsYW5jZUxhYmVsQ29udGFpbmVyLmNyZWF0ZVNwYW4oe1xuICAgICAgICAgICAgdGV4dDogJ1J1bm5pbmcgQmFsYW5jZScsXG4gICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtY2FsZW5kYXItZGV0YWlscy10ZXh0J1xuICAgICAgICB9KTtcblxuICAgICAgICBiYWxhbmNlRWwuY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICB0ZXh0OiBmb3JtYXRDdXJyZW5jeShkYXlCYWxhbmNlLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWZhdWx0Q3VycmVuY3kpLFxuICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWNhbGVuZGFyLWRldGFpbHMtYW1vdW50IGV4cGVuc2ljYS1jYWxlbmRhci1kZXRhaWxzLWJhbGFuY2UtYW1vdW50J1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vIENhbGN1bGF0ZSBhbmQgc2hvdyBhZGRpdGlvbmFsIGluc2lnaHRzIGlmIHRoZXJlIGFyZSBleHBlbnNlc1xuICAgICAgICBpZiAodG90YWxFeHBlbnNlcyA+IDApIHtcbiAgICAgICAgICAgIC8vIE1vbnRobHkgY29udGV4dFxuICAgICAgICAgICAgY29uc3QgbW9udGhseVRvdGFsID0gdGhpcy5tb250aGx5RXhwZW5zZVRvdGFsO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPbmx5IHNob3cgaW5zaWdodHMgaWYgd2UgaGF2ZSBzb21lIG1vbnRobHkgc3BlbmRpbmdcbiAgICAgICAgICAgIGlmIChtb250aGx5VG90YWwgPiAwKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcGVyY2VudGFnZSA9ICgodG90YWxFeHBlbnNlcyAvIG1vbnRobHlUb3RhbCkgKiAxMDApLnRvRml4ZWQoMSk7XG4gICAgICAgICAgICAgICAgY29uc3QgaW5zaWdodEVsID0gc3VtbWFyeUNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci1pbnNpZ2h0Jyk7XG4gICAgICAgICAgICAgICAgaW5zaWdodEVsLmNyZWF0ZVNwYW4oeyBcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogYFRoaXMgcmVwcmVzZW50cyAke3BlcmNlbnRhZ2V9JSBvZiB5b3VyIG1vbnRobHkgc3BlbmRpbmcuYCwgXG4gICAgICAgICAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1jYWxlbmRhci1pbnNpZ2h0LXRleHQnIFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIERhaWx5IGF2ZXJhZ2UgY29tcGFyaXNvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRheXNJbk1vbnRoID0gbmV3IERhdGUoXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudERhdGUuZ2V0RnVsbFllYXIoKSwgXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudERhdGUuZ2V0TW9udGgoKSArIDEsIFxuICAgICAgICAgICAgICAgICAgICAwXG4gICAgICAgICAgICAgICAgKS5nZXREYXRlKCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc3QgZGFpbHlBdmVyYWdlID0gbW9udGhseVRvdGFsIC8gZGF5c0luTW9udGg7XG4gICAgICAgICAgICAgICAgY29uc3QgcGVyY2VudERpZmYgPSAoKHRvdGFsRXhwZW5zZXMgLSBkYWlseUF2ZXJhZ2UpIC8gZGFpbHlBdmVyYWdlKSAqIDEwMDtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoTWF0aC5hYnMocGVyY2VudERpZmYpID4gMTApIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29tcGFyaXNvbkVsID0gc3VtbWFyeUNvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci1jb21wYXJpc29uJyk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAocGVyY2VudERpZmYgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wYXJpc29uRWwuY3JlYXRlU3Bhbih7IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IGAke3BlcmNlbnREaWZmLnRvRml4ZWQoMCl9JSBhYm92ZSBgLCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtdHJlbmQtZG93bicgLy8gRG93biBpcyBiYWQgZm9yIGV4cGVuc2VzXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBhcmlzb25FbC5jcmVhdGVTcGFuKHsgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogYCR7TWF0aC5hYnMocGVyY2VudERpZmYpLnRvRml4ZWQoMCl9JSBiZWxvdyBgLCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtdHJlbmQtdXAnIC8vIFVwIGlzIGdvb2QgZm9yIGV4cGVuc2VzXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgY29tcGFyaXNvbkVsLmNyZWF0ZVNwYW4oeyBcbiAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IGB5b3VyIGRhaWx5IGF2ZXJhZ2Ugb2YgJHtmb3JtYXRDdXJyZW5jeShkYWlseUF2ZXJhZ2UsIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDdXJyZW5jeSl9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gQWRkIGNhdGVnb3J5IGJyZWFrZG93biBpZiB0aGVyZSBhcmUgbXVsdGlwbGUgY2F0ZWdvcmllc1xuICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3JpZXMgPSBuZXcgTWFwPHN0cmluZywgeyBhbW91bnQ6IG51bWJlcjsgY29sb3I6IHN0cmluZyB9PigpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGV4cGVuc2VUcmFuc2FjdGlvbnMuZm9yRWFjaCh0ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUJ5SWQodC5jYXRlZ29yeSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5TmFtZSA9IGNhdGVnb3J5ID8gY2F0ZWdvcnkubmFtZSA6ICdPdGhlciBFeHBlbnNlcyc7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5Q29sb3IgPSBjYXRlZ29yeVxuICAgICAgICAgICAgICAgICAgICAgICAgPyB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUNvbG9yKGNhdGVnb3J5LmlkLCBjYXRlZ29yeS5uYW1lKVxuICAgICAgICAgICAgICAgICAgICAgICAgOiB0aGlzLnBsdWdpbi5nZXRDYXRlZ29yeUNvbG9yKHQuY2F0ZWdvcnksIGNhdGVnb3J5TmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAoIWNhdGVnb3JpZXMuaGFzKGNhdGVnb3J5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhdGVnb3JpZXMuc2V0KGNhdGVnb3J5TmFtZSwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFtb3VudDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvcjogY2F0ZWdvcnlDb2xvclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nQ2F0ZWdvcnkgPSBjYXRlZ29yaWVzLmdldChjYXRlZ29yeU5hbWUpITtcbiAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdDYXRlZ29yeS5hbW91bnQgKz0gdC5hbW91bnQ7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGNhdGVnb3JpZXMuc2l6ZSA+IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnJlYWtkb3duRWwgPSBzdW1tYXJ5Q29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLWNhdGVnb3J5LWJyZWFrZG93bicpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIHRpdGxlIGNvbnRhaW5lciB3aXRoIGljb25cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGl0bGVDb250YWluZXIgPSBicmVha2Rvd25FbC5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1icmVha2Rvd24tdGl0bGUtY29udGFpbmVyJyk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBBZGQgaWNvblxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpY29uU3BhbiA9IHRpdGxlQ29udGFpbmVyLmNyZWF0ZVNwYW4oe1xuICAgICAgICAgICAgICAgICAgICAgICAgY2xzOiAnZXhwZW5zaWNhLWJyZWFrZG93bi1pY29uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6ICfwn5OKJ1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0aXRsZSB0ZXh0XG4gICAgICAgICAgICAgICAgICAgIHRpdGxlQ29udGFpbmVyLmNyZWF0ZUVsKCdoNCcsIHsgXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiAnQ2F0ZWdvcnkgQnJlYWtkb3duJywgXG4gICAgICAgICAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtYnJlYWtkb3duLXRpdGxlJyBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBicmVha2Rvd25DaGFydCA9IGJyZWFrZG93bkVsLmNyZWF0ZURpdignZXhwZW5zaWNhLWJyZWFrZG93bi1jaGFydCcpO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gU29ydCBjYXRlZ29yaWVzIGJ5IGFtb3VudFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzb3J0ZWRDYXRlZ29yaWVzID0gQXJyYXkuZnJvbShjYXRlZ29yaWVzLmVudHJpZXMoKSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBiWzFdLmFtb3VudCAtIGFbMV0uYW1vdW50KTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIENhbGN1bGF0ZSBiYXIgd2lkdGhzIGJhc2VkIG9uIHBlcmNlbnRhZ2VcbiAgICAgICAgICAgICAgICAgICAgc29ydGVkQ2F0ZWdvcmllcy5mb3JFYWNoKChbY2F0ZWdvcnlOYW1lLCBjYXRlZ29yeURhdGFdKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhbW91bnQgPSBjYXRlZ29yeURhdGEuYW1vdW50O1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGVyY2VudGFnZSA9IChhbW91bnQgLyB0b3RhbEV4cGVuc2VzKSAqIDEwMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNhdGVnb3J5QmFyID0gYnJlYWtkb3duQ2hhcnQuY3JlYXRlRGl2KCdleHBlbnNpY2EtY2F0ZWdvcnktYmFyJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSB0aGUgY29sb3IgYmFyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjb2xvckJhciA9IGNhdGVnb3J5QmFyLmNyZWF0ZURpdignZXhwZW5zaWNhLWJhci1maWxsIGNvbG9yLWJhci1maWxsIGNvbG9yLWJhci1odWUnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yQmFyLnNldEF0dHJpYnV0ZSgnc3R5bGUnLCBgLS1jb2xvci1iYXItcGVyY2VudGFnZTogJHtwZXJjZW50YWdlfSU7IC0tY2F0ZWdvcnktY29sb3I6ICR7Y2F0ZWdvcnlEYXRhLmNvbG9yfWApO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBMYWJlbCB3aXRoIGFtb3VudCBhbmQgcGVyY2VudGFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFiZWxFbCA9IGNhdGVnb3J5QmFyLmNyZWF0ZURpdignZXhwZW5zaWNhLWJhci1sYWJlbCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWxFbC5jcmVhdGVTcGFuKHsgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogY2F0ZWdvcnlOYW1lLCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHM6ICdleHBlbnNpY2EtYmFyLWNhdGVnb3J5JyBcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbEVsLmNyZWF0ZVNwYW4oeyBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiBgJHtmb3JtYXRDdXJyZW5jeShhbW91bnQsIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlZmF1bHRDdXJyZW5jeSl9ICgke3BlcmNlbnRhZ2UudG9GaXhlZCgwKX0lKWAsIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1iYXItYW1vdW50JyBcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENyZWF0ZSB0cmFuc2FjdGlvbiBsaXN0IHdpdGggaGVhZGVyXG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uSGVhZGVyID0gdGhpcy5kZXRhaWxzQ29udGFpbmVyLmNyZWF0ZURpdignZXhwZW5zaWNhLXRyYW5zYWN0aW9ucy1oZWFkZXInKTtcbiAgICAgICAgdHJhbnNhY3Rpb25IZWFkZXIuY3JlYXRlRWwoJ2g0JywgeyB0ZXh0OiAnRXhwZW5zZXMnLCBjbHM6ICdleHBlbnNpY2EtdHJhbnNhY3Rpb25zLXRpdGxlJyB9KTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uTGlzdCA9IHRoaXMuZGV0YWlsc0NvbnRhaW5lci5jcmVhdGVEaXYoJ2V4cGVuc2ljYS1jYWxlbmRhci10cmFuc2FjdGlvbi1saXN0Jyk7XG4gICAgICAgIFxuICAgICAgICAvLyBTb3J0IHRyYW5zYWN0aW9ucyBieSBjcmVhdGlvbiB0aW1lIChuZXdlc3QgZmlyc3QpLCB3aXRoIGxlZ2FjeSBJRC9KU09OLW9yZGVyIGZhbGxiYWNrcy5cbiAgICAgICAgY29uc3Qgc29ydGVkVHJhbnNhY3Rpb25zID0gc29ydFRyYW5zYWN0aW9uc0J5RGF0ZVRpbWVEZXNjKGV4cGVuc2VUcmFuc2FjdGlvbnMpO1xuICAgICAgICBjb25zdCBydW5uaW5nQmFsYW5jZXMgPSB0aGlzLmdldFJ1bm5pbmdCYWxhbmNlTWFwKGRlZmF1bHRBY2NvdW50UmVmZXJlbmNlKTtcbiAgICAgICAgY29uc3QgaW50ZXJuYWxCYWxhbmNlTWFwcyA9IG5ldyBNYXA8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+PigpO1xuICAgICAgICBjb25zdCBlbnN1cmVCYWxhbmNlTWFwID0gKGFjY291bnRSZWZlcmVuY2U6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPT4ge1xuICAgICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBpbnRlcm5hbEJhbGFuY2VNYXBzLmdldChhY2NvdW50UmVmZXJlbmNlKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgICAgICAgIHJldHVybiBleGlzdGluZztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgYmFsYW5jZXMgPSBhY2NvdW50UmVmZXJlbmNlID09PSBkZWZhdWx0QWNjb3VudFJlZmVyZW5jZVxuICAgICAgICAgICAgICAgID8gcnVubmluZ0JhbGFuY2VzXG4gICAgICAgICAgICAgICAgOiB0aGlzLmdldFJ1bm5pbmdCYWxhbmNlTWFwKGFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgaW50ZXJuYWxCYWxhbmNlTWFwcy5zZXQoYWNjb3VudFJlZmVyZW5jZSwgYmFsYW5jZXMpO1xuICAgICAgICAgICAgcmV0dXJuIGJhbGFuY2VzO1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgLy8gQWRkIGVhY2ggdHJhbnNhY3Rpb25cbiAgICAgICAgc29ydGVkVHJhbnNhY3Rpb25zLmZvckVhY2goKHRyYW5zYWN0aW9uLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25BY2NvdW50UmVmZXJlbmNlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlQWNjb3VudHNcbiAgICAgICAgICAgICAgICA/IHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi5hY2NvdW50KVxuICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjY291bnRSZWZlcmVuY2U7XG4gICAgICAgICAgICBjb25zdCB0cmFuc2FjdGlvbkJhbGFuY2VzID0gZW5zdXJlQmFsYW5jZU1hcCh0cmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgbGV0IHJ1bm5pbmdCYWxhbmNlTGFiZWwgPSBmb3JtYXRSdW5uaW5nQmFsYW5jZUxhYmVsKFxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLFxuICAgICAgICAgICAgICAgIHRyYW5zYWN0aW9uQmFsYW5jZXNbdHJhbnNhY3Rpb24uaWRdID8/IDBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBsZXQgc2Vjb25kYXJ5UnVubmluZ0JhbGFuY2VMYWJlbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlQWNjb3VudHMgJiYgdHJhbnNhY3Rpb24udHlwZSA9PT0gVHJhbnNhY3Rpb25UeXBlLklOVEVSTkFMKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZnJvbUFjY291bnRSZWZlcmVuY2UgPSB0aGlzLnBsdWdpbi5ub3JtYWxpemVUcmFuc2FjdGlvbkFjY291bnRSZWZlcmVuY2UodHJhbnNhY3Rpb24uZnJvbUFjY291bnQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvQWNjb3VudFJlZmVyZW5jZSA9IHRoaXMucGx1Z2luLm5vcm1hbGl6ZVRyYW5zYWN0aW9uQWNjb3VudFJlZmVyZW5jZSh0cmFuc2FjdGlvbi50b0FjY291bnQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGZyb21CYWxhbmNlcyA9IGVuc3VyZUJhbGFuY2VNYXAoZnJvbUFjY291bnRSZWZlcmVuY2UpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRvQmFsYW5jZXMgPSBlbnN1cmVCYWxhbmNlTWFwKHRvQWNjb3VudFJlZmVyZW5jZSk7XG4gICAgICAgICAgICAgICAgcnVubmluZ0JhbGFuY2VMYWJlbCA9IGZvcm1hdFJ1bm5pbmdCYWxhbmNlTGFiZWwoXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLFxuICAgICAgICAgICAgICAgICAgICBmcm9tQmFsYW5jZXNbdHJhbnNhY3Rpb24uaWRdID8/IDAsXG4gICAgICAgICAgICAgICAgICAgIGZyb21BY2NvdW50UmVmZXJlbmNlXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBzZWNvbmRhcnlSdW5uaW5nQmFsYW5jZUxhYmVsID0gZm9ybWF0UnVubmluZ0JhbGFuY2VMYWJlbChcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4sXG4gICAgICAgICAgICAgICAgICAgIHRvQmFsYW5jZXNbdHJhbnNhY3Rpb24uaWRdID8/IDAsXG4gICAgICAgICAgICAgICAgICAgIHRvQWNjb3VudFJlZmVyZW5jZVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHRyYW5zYWN0aW9uRWwgPSByZW5kZXJUcmFuc2FjdGlvbkNhcmQodHJhbnNhY3Rpb25MaXN0LCB7XG4gICAgICAgICAgICAgICAgcGx1Z2luOiB0aGlzLnBsdWdpbixcbiAgICAgICAgICAgICAgICB0cmFuc2FjdGlvbixcbiAgICAgICAgICAgICAgICBydW5uaW5nQmFsYW5jZUxhYmVsLFxuICAgICAgICAgICAgICAgIHNlY29uZGFyeVJ1bm5pbmdCYWxhbmNlTGFiZWwsXG4gICAgICAgICAgICAgICAgb25FZGl0OiB0aGlzLm9uVHJhbnNhY3Rpb25FZGl0LFxuICAgICAgICAgICAgICAgIG9uQ2F0ZWdvcnlDaGFuZ2U6IGFzeW5jICh0cmFuc2FjdGlvbiwgY2F0ZWdvcnlJZCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRyYW5zYWN0aW9uQ2F0ZWdvcnkodHJhbnNhY3Rpb24sIGNhdGVnb3J5SWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0cmFuc2FjdGlvbkVsLmFkZENsYXNzKCdleHBlbnNpY2EtY2FsZW5kYXItdHJhbnNhY3Rpb24taXRlbScpO1xuICAgICAgICAgICAgdHJhbnNhY3Rpb25FbC5hZGRDbGFzcygndHJhbnNhY3Rpb24tYW5pbWF0ZS1kZWxheScpO1xuICAgICAgICAgICAgdHJhbnNhY3Rpb25FbC5jbGFzc0xpc3QuYWRkKGB0cmFuc2FjdGlvbi1kZWxheS0ke2luZGV4ICogNTB9YCk7XG4gICAgICAgICAgICB0cmFuc2FjdGlvbkVsLmNsYXNzTGlzdC5hZGQoJ2V4cGVuc2ljYS10cmFuc2FjdGlvbi1hbmltYXRlJyk7XG5cbiAgICAgICAgICAgIGlmIChzb3J0ZWRUcmFuc2FjdGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFtb3VudEVsID0gdHJhbnNhY3Rpb25FbC5xdWVyeVNlbGVjdG9yKCcuZXhwZW5zaWNhLXRyYW5zYWN0aW9uLWFtb3VudCcpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgICAgICAgICBhbW91bnRFbD8uY3JlYXRlU3Bhbih7XG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IGAkeygodHJhbnNhY3Rpb24uYW1vdW50IC8gdG90YWxFeHBlbnNlcykgKiAxMDApLnRvRml4ZWQoMCl9JWAsXG4gICAgICAgICAgICAgICAgICAgIGNsczogJ2V4cGVuc2ljYS1wZXJjZW50YWdlJ1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBBZGQgYW5pbWF0aW9uIGRlbGF5IGZvciBzdGFnZ2VyZWQgZW50cmFuY2VcbiAgICAgICAgICAgIHRyYW5zYWN0aW9uRWwuc2V0QXR0cmlidXRlKCdzdHlsZScsIGAtLXRyYW5zYWN0aW9uLWRlbGF5OiAke2luZGV4ICogNTB9bXNgKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyB1cGRhdGVUcmFuc2FjdGlvbkNhdGVnb3J5KHRyYW5zYWN0aW9uOiBUcmFuc2FjdGlvbiwgY2F0ZWdvcnlJZDogc3RyaW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnVwZGF0ZVRyYW5zYWN0aW9uKHtcbiAgICAgICAgICAgIC4uLnRyYW5zYWN0aW9uLFxuICAgICAgICAgICAgY2F0ZWdvcnk6IGNhdGVnb3J5SWRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgeWVhciA9IHRoaXMuY3VycmVudERhdGUuZ2V0RnVsbFllYXIoKTtcbiAgICAgICAgY29uc3QgbW9udGggPSB0aGlzLmN1cnJlbnREYXRlLmdldE1vbnRoKCk7XG4gICAgICAgIHRoaXMudHJhbnNhY3Rpb25zID0gdGhpcy5wbHVnaW4uZ2V0VHJhbnNhY3Rpb25zRm9yTW9udGgoeWVhciwgbW9udGgpO1xuICAgICAgICB0aGlzLnByZXBhcmVEYXRhKCk7XG5cbiAgICAgICAgY29uc3Qgc2VsZWN0ZWREYXlEYXRhID0gdGhpcy5jYWxlbmRhckRhdGEuZmluZChkYXlEYXRhID0+IHRoaXMuaXNTYW1lRGF0ZShkYXlEYXRhLmRhdGUsIHBhcnNlTG9jYWxEYXRlKHRyYW5zYWN0aW9uLmRhdGUpKSk7XG4gICAgICAgIGlmIChzZWxlY3RlZERheURhdGEpIHtcbiAgICAgICAgICAgIHRoaXMuc2hvd0RheURldGFpbHMoc2VsZWN0ZWREYXlEYXRhKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBwdWJsaWMgdXBkYXRlTW9udGgobmV3RGF0ZTogRGF0ZSwgdHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdKSB7XG4gICAgICAgIHRoaXMuY3VycmVudERhdGUgPSBuZXdEYXRlO1xuICAgICAgICB0aGlzLnRyYW5zYWN0aW9ucyA9IHRyYW5zYWN0aW9ucztcbiAgICAgICAgdGhpcy5tYXhBbW91bnQgPSAwO1xuICAgICAgICB0aGlzLnNldHVwQ29udGFpbmVycygpO1xuICAgICAgICB0aGlzLnJlbmRlcih0cnVlKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgcmVzaXplKCk6IGJvb2xlYW4ge1xuICAgICAgICBjb25zdCBjb250YWluZXJTaXplS2V5ID0gdGhpcy5nZXRDb250YWluZXJTaXplS2V5KHRoaXMuY29udGFpbmVyKTtcbiAgICAgICAgaWYgKGNvbnRhaW5lclNpemVLZXkgPT09IHRoaXMubGFzdE1lYXN1cmVkQ29udGFpbmVyU2l6ZUtleSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgd2lkdGggPSB0aGlzLmdldFJlbmRlcmFibGVXaWR0aCh0aGlzLmNvbnRhaW5lcik7XG4gICAgICAgIGlmICghd2lkdGgpIHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ2FsZW5kYXJIb3Jpem9udGFsUGFkZGluZygwKTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlU3RhY2tlZExheW91dCgwKTtcbiAgICAgICAgICAgIHRoaXMubGFzdE1lYXN1cmVkQ29udGFpbmVyU2l6ZUtleSA9IHRoaXMuZ2V0Q29udGFpbmVyU2l6ZUtleSh0aGlzLmNvbnRhaW5lcik7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnVwZGF0ZUNhbGVuZGFySG9yaXpvbnRhbFBhZGRpbmcod2lkdGgpO1xuICAgICAgICB0aGlzLnVwZGF0ZVN0YWNrZWRMYXlvdXQod2lkdGgpO1xuICAgICAgICB0aGlzLnVwZGF0ZURldGFpbHNQYW5lbEhlaWdodCgpO1xuICAgICAgICB0aGlzLmxhc3RNZWFzdXJlZENvbnRhaW5lclNpemVLZXkgPSB0aGlzLmdldENvbnRhaW5lclNpemVLZXkodGhpcy5jb250YWluZXIpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB1cGRhdGVDYWxlbmRhckhvcml6b250YWxQYWRkaW5nKGF2YWlsYWJsZVdpZHRoOiBudW1iZXIpIHtcbiAgICAgICAgdGhpcy5jYWxlbmRhckhvcml6b250YWxQYWRkaW5nID0gdGhpcy5pc01vYmlsZUxheW91dCgpID8gOCA6IDE2O1xuICAgIH1cblxuICAgIHByaXZhdGUgdXBkYXRlU3RhY2tlZExheW91dChhdmFpbGFibGVXaWR0aDogbnVtYmVyKSB7XG4gICAgICAgIGNvbnN0IGRldGFpbHNNaW5pbXVtV2lkdGggPSAzMDA7XG4gICAgICAgIGNvbnN0IHBhbmVsR2FwID0gMTY7XG4gICAgICAgIGNvbnN0IHdlZWtOdW1iZXJzT2Zmc2V0ID0gdGhpcy5nZXRXZWVrTnVtYmVyc09mZnNldCgpO1xuICAgICAgICBjb25zdCBjYWxlbmRhcldpZHRoID0gdGhpcy5nZXRDYWxlbmRhckdyaWRXaWR0aCgpICsgd2Vla051bWJlcnNPZmZzZXQ7XG4gICAgICAgIGNvbnN0IGlzU3RhY2tlZCA9IHRoaXMuaXNNb2JpbGVMYXlvdXQoKSB8fCBhdmFpbGFibGVXaWR0aCA8IGNhbGVuZGFyV2lkdGggKyBkZXRhaWxzTWluaW11bVdpZHRoICsgcGFuZWxHYXA7XG5cbiAgICAgICAgdGhpcy5jb250YWluZXIudG9nZ2xlQ2xhc3MoJ2V4cGVuc2ljYS1jYWxlbmRhci1zdGFja2VkJywgaXNTdGFja2VkKTtcblxuICAgICAgICBpZiAoaXNTdGFja2VkICYmIHRoaXMuZGV0YWlsc0NvbnRhaW5lcikge1xuICAgICAgICAgICAgdGhpcy5kZXRhaWxzQ29udGFpbmVyLnN0eWxlLnJlbW92ZVByb3BlcnR5KCdoZWlnaHQnKTtcbiAgICAgICAgICAgIHRoaXMuZGV0YWlsc0NvbnRhaW5lci5zdHlsZS5yZW1vdmVQcm9wZXJ0eSgnbWF4LWhlaWdodCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB1cGRhdGVDYWxlbmRhclNjYWxlQm91bmRzKHN2Z1dpZHRoOiBudW1iZXIpIHtcbiAgICAgICAgY29uc3QgbWluaW11bVN2Z1dpZHRoID0gc3ZnV2lkdGggKiB0aGlzLm1pbmltdW1DZWxsU2NhbGU7XG4gICAgICAgIHRoaXMuY2FsZW5kYXJDb250YWluZXIuc3R5bGUuc2V0UHJvcGVydHkoJy0tZXhwZW5zaWNhLXBhbmVsLW5hdHVyYWwtd2lkdGgnLCBgJHtzdmdXaWR0aH1weGApO1xuICAgICAgICB0aGlzLmNhbGVuZGFyQ29udGFpbmVyLnN0eWxlLnNldFByb3BlcnR5KCctLWV4cGVuc2ljYS1wYW5lbC1taW4td2lkdGgnLCBgJHttaW5pbXVtU3ZnV2lkdGh9cHhgKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldENhbGVuZGFyR3JpZFdpZHRoKCkge1xuICAgICAgICByZXR1cm4gKDcgKiB0aGlzLmNlbGxTaXplKSArICg2ICogdGhpcy5jZWxsR2FwKSArICh0aGlzLmNhbGVuZGFySG9yaXpvbnRhbFBhZGRpbmcgKiAyKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldE5hdHVyYWxDYWxlbmRhcldpZHRoKCkge1xuICAgICAgICByZXR1cm4gKDcgKiB0aGlzLmRlZmF1bHRDZWxsU2l6ZSkgKyAoNiAqIHRoaXMuY2VsbEdhcCkgKyAodGhpcy5jYWxlbmRhckhvcml6b250YWxQYWRkaW5nICogMikgKyB0aGlzLmdldFdlZWtOdW1iZXJzT2Zmc2V0KCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSB1cGRhdGVEZXRhaWxzUGFuZWxIZWlnaHQoKSB7XG4gICAgICAgIGlmICghdGhpcy5kZXRhaWxzQ29udGFpbmVyIHx8IHRoaXMuaXNNb2JpbGVMYXlvdXQoKSB8fCB0aGlzLmNvbnRhaW5lci5oYXNDbGFzcygnZXhwZW5zaWNhLWNhbGVuZGFyLXN0YWNrZWQnKSkge1xuICAgICAgICAgICAgdGhpcy5kZXRhaWxzQ29udGFpbmVyPy5zdHlsZS5yZW1vdmVQcm9wZXJ0eSgnaGVpZ2h0Jyk7XG4gICAgICAgICAgICB0aGlzLmRldGFpbHNDb250YWluZXI/LnN0eWxlLnJlbW92ZVByb3BlcnR5KCdtYXgtaGVpZ2h0Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYWxlbmRhckhlaWdodCA9IHRoaXMuY2FsZW5kYXJDb250YWluZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkuaGVpZ2h0O1xuICAgICAgICBjb25zdCBkZXRhaWxzSGVpZ2h0ID0gY2FsZW5kYXJIZWlnaHQgPiAwID8gY2FsZW5kYXJIZWlnaHQgOiB0aGlzLmhlaWdodDtcblxuICAgICAgICB0aGlzLmRldGFpbHNDb250YWluZXIuc3R5bGUuYm94U2l6aW5nID0gJ2JvcmRlci1ib3gnO1xuICAgICAgICB0aGlzLmRldGFpbHNDb250YWluZXIuc3R5bGUuaGVpZ2h0ID0gYCR7ZGV0YWlsc0hlaWdodH1weGA7XG4gICAgICAgIHRoaXMuZGV0YWlsc0NvbnRhaW5lci5zdHlsZS5tYXhIZWlnaHQgPSBgJHtkZXRhaWxzSGVpZ2h0fXB4YDtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldExheW91dEtleShzdmdXaWR0aDogbnVtYmVyLCBzdmdIZWlnaHQ6IG51bWJlcikge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgTWF0aC5yb3VuZChzdmdXaWR0aCksXG4gICAgICAgICAgICBNYXRoLnJvdW5kKHN2Z0hlaWdodCksXG4gICAgICAgICAgICB0aGlzLmNlbGxHYXAsXG4gICAgICAgICAgICB0aGlzLmNhbGVuZGFySG9yaXpvbnRhbFBhZGRpbmcsXG4gICAgICAgICAgICB0aGlzLmdldFdlZWtOdW1iZXJzT2Zmc2V0KClcbiAgICAgICAgXS5qb2luKCc6Jyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXRDb250YWluZXJTaXplS2V5KGNhbGVuZGFyQ29udGFpbmVyOiBIVE1MRWxlbWVudCB8IG51bGwgfCB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKCFjYWxlbmRhckNvbnRhaW5lcikge1xuICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVjdCA9IGNhbGVuZGFyQ29udGFpbmVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgTWF0aC5yb3VuZChyZWN0LndpZHRoKSxcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dXZWVrTnVtYmVycyA/ICd3ZWVrcycgOiAnbm8td2Vla3MnLFxuICAgICAgICAgICAgdGhpcy5pc01vYmlsZUxheW91dCgpID8gJ21vYmlsZScgOiAnZGVza3RvcCdcbiAgICAgICAgXS5qb2luKCc6Jyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBpc01vYmlsZUxheW91dCgpIHtcbiAgICAgICAgcmV0dXJuIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmNvbnRhaW5zKCdpcy1tb2JpbGUnKSB8fCAhIXRoaXMuY29udGFpbmVyLmNsb3Nlc3QoJy5pcy1tb2JpbGUnKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldFdlZWtOdW1iZXJzT2Zmc2V0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd1dlZWtOdW1iZXJzID8gdGhpcy53ZWVrTnVtYmVyV2lkdGggOiAwO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0UmVuZGVyYWJsZVdpZHRoKGNhbGVuZGFyQ29udGFpbmVyOiBIVE1MRWxlbWVudCB8IG51bGwgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgICAgICAgaWYgKCFjYWxlbmRhckNvbnRhaW5lcikge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xuICAgICAgICAgICAgY2FsZW5kYXJDb250YWluZXIsXG4gICAgICAgICAgICBjYWxlbmRhckNvbnRhaW5lci5wYXJlbnRFbGVtZW50LFxuICAgICAgICAgICAgY2FsZW5kYXJDb250YWluZXIucGFyZW50RWxlbWVudD8ucGFyZW50RWxlbWVudCxcbiAgICAgICAgICAgIHRoaXMuY29udGFpbmVyLFxuICAgICAgICAgICAgdGhpcy5jb250YWluZXIucGFyZW50RWxlbWVudCxcbiAgICAgICAgICAgIHRoaXMuY29udGFpbmVyLnBhcmVudEVsZW1lbnQ/LnBhcmVudEVsZW1lbnRcbiAgICAgICAgXTtcbiAgICAgICAgY29uc3Qgd2lkdGhzID0gY2FuZGlkYXRlc1xuICAgICAgICAgICAgLmZpbHRlcigoZWxlbWVudCk6IGVsZW1lbnQgaXMgSFRNTEVsZW1lbnQgPT4gISFlbGVtZW50KVxuICAgICAgICAgICAgLm1hcChlbGVtZW50ID0+IGVsZW1lbnQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkud2lkdGgpXG4gICAgICAgICAgICAuZmlsdGVyKHdpZHRoID0+IHdpZHRoID4gMCk7XG5cbiAgICAgICAgcmV0dXJuIHdpZHRocy5sZW5ndGggPiAwID8gTWF0aC5taW4oLi4ud2lkdGhzKSA6IG51bGw7XG4gICAgfVxufVxuIl19