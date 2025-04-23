import { Transaction, TransactionType, formatCurrency, ColorScheme } from '../models';
import ExpensicaPlugin from '../../main';
import * as d3 from 'd3';

interface DayData {
    date: Date;
    totalAmount: number;
    transactions: Transaction[];
    formattedDate: string;
}

export class CalendarHeatmap {
    private container: HTMLElement;
    private transactions: Transaction[];
    private plugin: ExpensicaPlugin;
    private currentDate: Date;
    private calendarData: DayData[] = [];
    private svg: any;
    private width: number = 0;
    private height: number = 0;
    private tooltipDiv: any;
    private detailsContainer: HTMLElement;
    private cellSize: number = 48;
    private cellGap: number = 8;
    private maxAmount: number = 0;
    private weekNumberWidth: number = 30; // Width of week number column

    constructor(container: HTMLElement, plugin: ExpensicaPlugin, transactions: Transaction[], currentDate: Date) {
        this.container = container;
        this.plugin = plugin;
        this.transactions = transactions;
        this.currentDate = currentDate;
        this.setupContainers();
        this.createTooltip();
    }

    private setupContainers() {
        // Clear any existing content
        this.container.empty();
        this.container.addClass('expensica-calendar-container');

        // Create a flex container for the calendar and details
        const flexContainer = this.container.createDiv('expensica-calendar-flex-container');
        
        // Create the calendar container
        const calendarContainer = flexContainer.createDiv('expensica-calendar-grid-container');
        
        // Create the details container for transaction details
        this.detailsContainer = flexContainer.createDiv('expensica-calendar-details-container');
        this.detailsContainer.createEl('h3', { 
            text: 'Click on a day to see transactions', 
            cls: 'expensica-calendar-details-title' 
        });

        // Get the width and height of the calendar container
        const rect = calendarContainer.getBoundingClientRect();
        this.width = rect.width;
        
        // Calculate additional width for week numbers if enabled
        const weekNumbersOffset = this.plugin.settings.showWeekNumbers ? this.weekNumberWidth : 0;
        
        // Adjust cell gap based on available width
        if (this.width < 500) {
            this.cellGap = 4; // Smaller gap for small screens
        } else if (this.width < 700) {
            this.cellGap = 6; // Medium gap for medium screens
        }
        // else use the default 8px gap for larger screens
        
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
    }

    private createTooltip() {
        this.tooltipDiv = d3.select(this.container)
            .append('div')
            .attr('class', 'expensica-calendar-tooltip')
            .style('opacity', 0);
    }

    public render() {
        this.prepareData();
        this.renderCalendar();
    }

    private prepareData() {
        // Get all days in the month
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        this.calendarData = [];
        
        // Initialize data for each day of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = this.formatDate(date);
            
            // Filter transactions for this date
            const dayTransactions = this.transactions.filter(t => {
                const tDate = new Date(t.date);
                return tDate.getFullYear() === year && 
                       tDate.getMonth() === month && 
                       tDate.getDate() === day;
            });
            
            // Calculate total spending for this day
            const totalAmount = dayTransactions
                .filter(t => t.type === TransactionType.EXPENSE)
                .reduce((sum, t) => sum + t.amount, 0);
            
            this.calendarData.push({
                date: date,
                totalAmount: totalAmount,
                transactions: dayTransactions,
                formattedDate: dateStr
            });
            
            // Update the maximum amount if needed
            if (totalAmount > this.maxAmount) {
                this.maxAmount = totalAmount;
            }
        }
    }

    private formatDate(date: Date): string {
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    }

    private getWeeksInMonth(year: number, month: number): number {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        return Math.ceil((firstDay + daysInMonth) / 7);
    }
    
    // Get the week number for a given date (ISO week number)
    private getWeekNumber(date: Date): number {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }
    
    // Get the color scale based on the selected color scheme
    private getColorScale(maxValue: number): any {
        if (maxValue <= 0) {
            maxValue = 1; // Prevent division by zero
        }
        
        const colorScheme = this.plugin.settings.calendarColorScheme;
        
        switch (colorScheme) {
            case ColorScheme.RED:
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#FFF5F5", "#FF5252"));
            
            case ColorScheme.BLUE:
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#EFF8FF", "#0066CC"));
                    
            case ColorScheme.GREEN:
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#F2FDF5", "#38A169"));
                    
            case ColorScheme.PURPLE:
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#F8F4FF", "#805AD5"));
                    
            case ColorScheme.ORANGE:
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#FFF8F1", "#ED8936"));
                    
            case ColorScheme.TEAL:
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#EFFCFC", "#38B2AC"));
                    
            case ColorScheme.COLORBLIND_FRIENDLY:
                // Use a colorblind-friendly palette (blue to yellow)
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#F0F8FF", "#FFBF00"));
                    
            case ColorScheme.CUSTOM:
                // Use custom color
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#F5F5F5", this.plugin.settings.customCalendarColor));
                    
            default:
                // Default to red
                return d3.scaleSequential()
                    .domain([0, maxValue])
                    .interpolator(d3.interpolateRgb("#FFF5F5", "#FF5252"));
        }
    }

    private renderCalendar() {
        // Clear SVG
        this.svg.selectAll('*').remove();
        
        const monthLabel = this.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        // Calculate week numbers offset if enabled
        const weekNumbersOffset = this.plugin.settings.showWeekNumbers ? this.weekNumberWidth : 0;
        
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
            .attr('x', (d: string, i: number) => weekNumbersOffset + i * (this.cellSize + this.cellGap) + this.cellSize / 2)
            .attr('y', 60)
            .attr('text-anchor', 'middle')
            .attr('font-size', '12px')
            .attr('fill', 'rgba(55, 53, 47, 0.65)')
            .text((d: string) => d);
        
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
        let selectedCell: any = null;
        
        // Add week numbers if enabled
        if (this.plugin.settings.showWeekNumbers) {
            // Add "Week" header
            this.svg.append('text')
                .attr('class', 'week-label')
                .attr('x', this.weekNumberWidth / 2)
                .attr('y', 60)
                .attr('text-anchor', 'middle')
                .attr('font-size', '11px')
                .attr('fill', 'rgba(55, 53, 47, 0.5)')
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
                    .attr('x', this.weekNumberWidth / 2)
                    .attr('y', (week + 1) * (this.cellSize + this.cellGap) + 60)
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'middle')
                    .attr('font-size', '11px')
                    .attr('fill', 'rgba(55, 53, 47, 0.5)')
                    .text(weekNumber);
            }
        }
        
        const dayCells = this.svg.selectAll('.day-cell')
            .data(this.calendarData)
            .enter()
            .append('g')
            .attr('class', 'day-cell')
            .attr('transform', (d: DayData, i: number) => {
                const dayOfMonth = d.date.getDate();
                const dayOfWeek = d.date.getDay();
                const weekOfMonth = Math.floor((dayOfMonth + firstDayOfMonth - 1) / 7);
                
                // Calculate position with added gap between cells
                const xPos = weekNumbersOffset + dayOfWeek * (this.cellSize + this.cellGap);
                const yPos = (weekOfMonth + 1) * (this.cellSize + this.cellGap) + 40;
                
                return `translate(${xPos}, ${yPos})`;
            });
        
        // Add cell background with Notion-inspired visual design
        dayCells.append('rect')
            .attr('width', this.cellSize - 4)
            .attr('height', this.cellSize - 4)
            .attr('rx', 4) // Subtle rounded corners like Notion
            .attr('ry', 4)
            .attr('fill', (d: DayData) => d.totalAmount > 0 ? colorScale(d.totalAmount) : 'var(--background-primary)')
            .attr('stroke', (d: DayData) => {
                // Highlight today's date with a special border
                if (isCurrentMonth && d.date.getDate() === todayDate) {
                    return 'var(--interactive-accent)';
                }
                return 'var(--background-modifier-border)'; // Using a more visible border color from Obsidian
            })
            .attr('stroke-width', (d: DayData) => {
                return isCurrentMonth && d.date.getDate() === todayDate ? 2 : 1.5;
            })
            .attr('opacity', (d: DayData) => {
                // More subtle opacity for Notion-like aesthetic
                const isWeekend = d.date.getDay() === 0 || d.date.getDay() === 6;
                if (d.totalAmount > 0) {
                    return 1.0; // Full opacity for cells with expenses
                }
                return isWeekend ? 0.7 : 0.6; // Subtle distinction for weekend days
            })
            .classed('has-expenses', (d: DayData) => d.totalAmount > 0)
            .classed('is-today', (d: DayData) => isCurrentMonth && d.date.getDate() === todayDate)
            .on('mouseover', (event: any, d: DayData) => {
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
                
                const formatCurrencyValue = (value: number) => {
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
                    } else if (parseInt(comparedToAverage) < -20) {
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
            .on('mouseout', (event: any, d: DayData) => {
                // Don't reset if this is the selected cell
                if (selectedCell && selectedCell.node() === event.currentTarget) {
                    return;
                }
                
                // Reset the cell with Notion styling
                d3.select(event.currentTarget)
                    .transition()
                    .duration(100) // Faster transition for better responsiveness
                    .attr('stroke', (d: DayData) => {
                        // Maintain today's highlight
                        if (isCurrentMonth && d.date.getDate() === todayDate) {
                            return 'var(--interactive-accent)';
                        }
                        return 'var(--background-modifier-border)'; // Using a more visible border color from Obsidian
                    })
                    .attr('stroke-width', (d: DayData) => {
                        return isCurrentMonth && d.date.getDate() === todayDate ? 2 : 1.5;
                    })
                    .attr('opacity', (d: DayData) => {
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
            .on('click', (event: any, d: DayData) => {
                // Remove previous selection
                if (selectedCell) {
                    selectedCell
                        .attr('stroke', (d: DayData) => {
                            // Maintain today's highlight with Notion styling
                            if (isCurrentMonth && d.date.getDate() === todayDate) {
                                return 'var(--interactive-accent)';
                            }
                            return 'var(--background-modifier-border)'; // Using a more visible border color from Obsidian
                        })
                        .attr('stroke-width', (d: DayData) => {
                            return isCurrentMonth && d.date.getDate() === todayDate ? 2 : 1.5;
                        });
                }
                
                // Highlight the selected cell with a Notion-like subtle highlight
                selectedCell = d3.select(event.currentTarget);
                selectedCell
                    .attr('stroke', 'var(--interactive-accent)')
                    .attr('stroke-width', 2.5); // Increased thickness for better visibility
                
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
            .attr('font-weight', (d: DayData) => d.totalAmount > 0 ? '500' : '400')
            .attr('fill', (d: DayData) => {
                if (d.totalAmount > 0) {
                    return this.getTextColor(d.totalAmount, colorScale);
                }
                return 'var(--text-normal)';
            })
            .text((d: DayData) => d.date.getDate());
        
        // Add spending amount for days with expenses with Notion-like styling
        dayCells.filter((d: DayData) => d.totalAmount > 0)
            .append('text')
            .attr('x', this.cellSize / 2 - 2)
            .attr('y', this.cellSize / 2 + 12)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('font-weight', '500')
            .attr('fill', (d: DayData) => this.getTextColor(d.totalAmount, colorScale))
            .text((d: DayData) => {
                const currency = this.plugin.settings.defaultCurrency;
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: currency,
                    notation: 'compact',
                    maximumFractionDigits: 0
                }).format(d.totalAmount);
            });
        
        // Add tiny indicator for days with income
        dayCells.filter((d: DayData) => d.transactions.some(t => t.type === TransactionType.INCOME))
            .append('circle')
            .attr('cx', this.cellSize - 12)
            .attr('cy', 10)
            .attr('r', 3.5)
            .attr('fill', 'var(--expensica-success)')
            .attr('opacity', 0.8);
        
        // Add color legend
        this.renderColorLegend(colorScale, weekNumbersOffset, calendarHeight);
        
        // Add animation for the calendar cells with staggered timing for a nice effect
        dayCells
            .style('opacity', 0)
            .transition()
            .duration(500)
            .delay((d: DayData, i: number) => {
                // Animate from left to right, top to bottom
                const dayOfMonth = d.date.getDate();
                const dayOfWeek = d.date.getDay();
                const weekOfMonth = Math.floor((dayOfMonth + firstDayOfMonth - 1) / 7);
                return (weekOfMonth * 7 + dayOfWeek) * 20;
            })
            .style('opacity', 1);
        
        // If nothing is currently selected, show the details for today or the first day with expenses
        if (isCurrentMonth) {
            const todayData = this.calendarData.find(d => d.date.getDate() === todayDate);
            if (todayData) {
                this.showDayDetails(todayData);
                // Also visually select today's cell
                const todayCell = this.svg.selectAll('.day-cell rect')
                    .filter((d: any) => d.date.getDate() === todayDate);
                todayCell.attr('stroke', 'var(--interactive-accent)')
                    .attr('stroke-width', 2);
                selectedCell = todayCell;
            }
        } else {
            // Find the first day with expenses as fallback
            const firstDayWithExpenses = this.calendarData.find(d => d.totalAmount > 0);
            if (firstDayWithExpenses) {
                this.showDayDetails(firstDayWithExpenses);
                // Also visually select this cell
                const firstExpenseCell = this.svg.selectAll('.day-cell rect')
                    .filter((d: any) => d.date.getDate() === firstDayWithExpenses.date.getDate());
                firstExpenseCell.attr('stroke', 'var(--interactive-accent)')
                    .attr('stroke-width', 2);
                selectedCell = firstExpenseCell;
            } else {
                // Default to first day of month if no expenses
                this.showDayDetails(this.calendarData[0]);
            }
        }
    }

    private getTextColor(amount: number, colorScale: any): string {
        if (amount === 0) return 'var(--text-muted)';
        
        // For darker background colors, use white text
        const color = d3.rgb(colorScale(amount));
        const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
        
        return luminance > 160 ? 'var(--text-normal)' : 'white';
    }

    private renderColorLegend(colorScale: any, weekNumbersOffset: number, calendarHeight: number) {
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

    private showDayDetails(dayData: DayData) {
        this.detailsContainer.empty();
        
        // Get expense transactions
        const expenseTransactions = dayData.transactions.filter(t => 
            t.type === TransactionType.EXPENSE
        );
        
        // Get total expenses
        const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
        
        // Add title with day of week
        const dayOfWeek = dayData.date.toLocaleDateString('en-US', { weekday: 'long' });
        this.detailsContainer.createEl('h3', { 
            text: `${dayOfWeek}, ${dayData.formattedDate}`, 
            cls: 'expensica-calendar-details-title' 
        });
        
        // Create summary container
        const summaryContainer = this.detailsContainer.createDiv('expensica-calendar-summary');
        
        // Display total expenses
        const totalEl = summaryContainer.createDiv('expensica-calendar-details-total');
        
        // Left side with label and icon
        const labelContainer = totalEl.createDiv('expensica-calendar-details-label');
        // Add currency icon (similar to Notion's approach with icons)
        const iconSpan = labelContainer.createSpan({
            cls: 'expensica-calendar-details-icon'
        });
        iconSpan.innerHTML = '💰';
        
        labelContainer.createSpan({
            text: 'Total Expenses',
            cls: 'expensica-calendar-details-text'
        });
        
        // Right side with amount
        totalEl.createSpan({
            text: formatCurrency(totalExpenses, this.plugin.settings.defaultCurrency),
            cls: 'expensica-calendar-details-amount expensica-expense'
        });
        
        // Calculate and show additional insights if there are expenses
        if (totalExpenses > 0) {
            // Monthly context
            const monthlyTotal = this.transactions
                .filter(t => t.type === TransactionType.EXPENSE)
                .reduce((sum, t) => sum + t.amount, 0);
            
            // Only show insights if we have some monthly spending
            if (monthlyTotal > 0) {
                const percentage = ((totalExpenses / monthlyTotal) * 100).toFixed(1);
                const insightEl = summaryContainer.createDiv('expensica-calendar-insight');
                insightEl.createSpan({ 
                    text: `This represents ${percentage}% of your monthly spending.`, 
                    cls: 'expensica-calendar-insight-text' 
                });
                
                // Daily average comparison
                const daysInMonth = new Date(
                    this.currentDate.getFullYear(), 
                    this.currentDate.getMonth() + 1, 
                    0
                ).getDate();
                
                const dailyAverage = monthlyTotal / daysInMonth;
                const percentDiff = ((totalExpenses - dailyAverage) / dailyAverage) * 100;
                
                if (Math.abs(percentDiff) > 10) {
                    const comparisonEl = summaryContainer.createDiv('expensica-calendar-comparison');
                    
                    if (percentDiff > 0) {
                        comparisonEl.createSpan({ 
                            text: `${percentDiff.toFixed(0)}% above `, 
                            cls: 'expensica-trend-down' // Down is bad for expenses
                        });
                    } else {
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
                const categories = new Map<string, number>();
                
                expenseTransactions.forEach(t => {
                    const category = this.plugin.getCategoryById(t.category);
                    const categoryName = category ? category.name : 'Unknown';
                    
                    if (!categories.has(categoryName)) {
                        categories.set(categoryName, 0);
                    }
                    
                    categories.set(categoryName, categories.get(categoryName)! + t.amount);
                });
                
                if (categories.size > 1) {
                    const breakdownEl = summaryContainer.createDiv('expensica-category-breakdown');
                    
                    // Create title container with icon
                    const titleContainer = breakdownEl.createDiv('expensica-breakdown-title-container');
                    
                    // Add icon
                    const iconSpan = titleContainer.createSpan({
                        cls: 'expensica-breakdown-icon'
                    });
                    iconSpan.innerHTML = '📊';
                    
                    // Add title text
                    titleContainer.createEl('h4', { 
                        text: 'Category Breakdown', 
                        cls: 'expensica-breakdown-title' 
                    });
                    
                    const breakdownChart = breakdownEl.createDiv('expensica-breakdown-chart');
                    
                    // Sort categories by amount
                    const sortedCategories = Array.from(categories.entries())
                        .sort((a, b) => b[1] - a[1]);
                    
                    // Calculate bar widths based on percentage
                    sortedCategories.forEach(([categoryName, amount]) => {
                        const percentage = (amount / totalExpenses) * 100;
                        const categoryBar = breakdownChart.createDiv('expensica-category-bar');
                        
                        // Create the color bar
                        const colorBar = categoryBar.createDiv('expensica-bar-fill');
                        colorBar.style.width = `${percentage}%`;
                        
                        // Random but consistent color based on category name
                        const hue = this.stringToHue(categoryName);
                        colorBar.style.backgroundColor = `hsl(${hue}, 70%, 60%)`;
                        
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
        
        // If no expense transactions, show message
        if (expenseTransactions.length === 0) {
            const emptyStateEl = this.detailsContainer.createDiv('expensica-calendar-empty-state');
            emptyStateEl.createEl('div', { text: '✨', cls: 'expensica-calendar-empty-icon' });
            emptyStateEl.createEl('p', {
                text: 'No expenses recorded for this day.',
                cls: 'expensica-calendar-empty-message'
            });
            
            return;
        }
        
        // Create transaction list with header
        const transactionHeader = this.detailsContainer.createDiv('expensica-transactions-header');
        transactionHeader.createEl('h4', { text: 'Expenses', cls: 'expensica-transactions-title' });
        
        const transactionList = this.detailsContainer.createDiv('expensica-calendar-transaction-list');
        
        // Sort transactions by amount (descending)
        const sortedTransactions = [...expenseTransactions].sort((a, b) => {
            return b.amount - a.amount;
        });
        
        // Add each transaction
        sortedTransactions.forEach((transaction, index) => {
            const transactionEl = transactionList.createDiv('expensica-calendar-transaction-item');
            // Add animation delay for staggered entrance
            transactionEl.style.animationDelay = `${index * 50}ms`;
            transactionEl.classList.add('expensica-transaction-animate');
            
            // Get category
            const category = this.plugin.getCategoryById(transaction.category);
            const categoryName = category ? category.name : 'Unknown Category';
            const categoryEmoji = category ? category.emoji : '❓';
            
            // Icon
            const iconEl = transactionEl.createDiv('expensica-calendar-transaction-icon');
            iconEl.innerText = categoryEmoji;
            iconEl.addClass('expense-icon');
            
            // Details
            const detailsEl = transactionEl.createDiv('expensica-calendar-transaction-details');
            detailsEl.createDiv({
                text: transaction.description,
                cls: 'expensica-calendar-transaction-title'
            });
            
            const metaEl = detailsEl.createDiv('expensica-calendar-transaction-meta');
            metaEl.createSpan({
                text: categoryName,
                cls: 'expensica-calendar-transaction-category'
            });
            
            if (transaction.notes) {
                metaEl.createSpan({
                    text: transaction.notes,
                    cls: 'expensica-calendar-transaction-notes'
                });
            }
            
            // Amount
            const amountEl = transactionEl.createDiv('expensica-calendar-transaction-amount');
            const formattedAmount = formatCurrency(transaction.amount, this.plugin.settings.defaultCurrency);
            
            // Calculate percentage of day's total
            const percentOfDay = ((transaction.amount / totalExpenses) * 100).toFixed(0);
            
            const amountContainer = amountEl.createDiv('expensica-amount-container');
            amountContainer.createSpan({
                text: `-${formattedAmount}`,
                cls: 'expensica-expense'
            });
            
            // Only show percentage if there are multiple transactions
            if (sortedTransactions.length > 1) {
                amountContainer.createSpan({
                    text: `${percentOfDay}%`,
                    cls: 'expensica-percentage'
                });
            }
        });
    }
    
    // Helper function to generate deterministic color from string
    private stringToHue(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return hash % 360;
    }

    public updateMonth(newDate: Date, transactions: Transaction[]) {
        this.currentDate = newDate;
        this.transactions = transactions;
        this.maxAmount = 0;
        this.setupContainers();
        this.render();
    }

    public resize() {
        // Get new width
        const rect = this.container.querySelector('.expensica-calendar-grid-container')?.getBoundingClientRect();
        if (rect) {
            this.width = rect.width;
            // Update SVG width
            d3.select(this.container).select('svg')
                .attr('width', this.width)
                .attr('viewBox', `0 0 ${this.width} ${this.height}`);
            
            // Re-render the calendar
            this.renderCalendar();
        }
    }
}