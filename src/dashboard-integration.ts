import { CalendarHeatmap } from './visualizations/calendar-view';
import ExpensicaPlugin from '../main';
import { getMonthName } from './models';

export class PremiumVisualizations {
    private container: HTMLElement;
    private plugin: ExpensicaPlugin;
    private currentDate: Date;
    private calendarHeatmap: CalendarHeatmap | null = null;

    constructor(container: HTMLElement, plugin: ExpensicaPlugin, currentDate: Date) {
        this.container = container;
        this.plugin = plugin;
        this.currentDate = currentDate;
    }

    render() {
        // Clear container
        this.container.empty();
        this.container.addClass('expensica-premium-viz-container');

        // Create visualization header
        const header = this.container.createDiv('expensica-premium-viz-header');
        
        // Create header content container
        const headerContent = header.createDiv('expensica-calendar-header-content');
        
        // Add navigation buttons
        const navContainer = headerContent.createDiv('expensica-calendar-nav');
        
        // Previous month button
        const prevButton = navContainer.createEl('button', {
            cls: 'expensica-calendar-nav-button',
            text: '←'
        });
        prevButton.onclick = () => {
            const newDate = new Date(this.currentDate);
            newDate.setMonth(newDate.getMonth() - 1);
            this.updateDate(newDate);
        };
        
        // Today button
        const todayButton = navContainer.createEl('button', {
            cls: 'expensica-calendar-nav-button',
            text: 'Today'
        });
        todayButton.onclick = () => {
            this.updateDate(new Date());
        };
        
        // Next month button
        const nextButton = navContainer.createEl('button', {
            cls: 'expensica-calendar-nav-button',
            text: '→'
        });
        nextButton.onclick = () => {
            const newDate = new Date(this.currentDate);
            newDate.setMonth(newDate.getMonth() + 1);
            this.updateDate(newDate);
        };

        // Create the Calendar heatmap container
        const calendarContainer = this.container.createDiv('expensica-calendar-wrapper');
        
        // Get transactions for current month
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const transactions = this.plugin.getTransactionsForMonth(year, month);
        
        // Initialize Calendar heatmap
        this.calendarHeatmap = new CalendarHeatmap(
            calendarContainer, 
            this.plugin, 
            transactions, 
            this.currentDate
        );
        this.calendarHeatmap.render();
    }

    public updateDate(newDate: Date) {
        this.currentDate = newDate;
        
        // Get transactions for the new date
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const transactions = this.plugin.getTransactionsForMonth(year, month);
        
        // Update the calendar heatmap
        if (this.calendarHeatmap) {
            this.calendarHeatmap.updateMonth(this.currentDate, transactions);
        } else {
            this.render(); // Re-render if the heatmap doesn't exist
        }
    }

    public resize() {
        // Resize the calendar heatmap
        if (this.calendarHeatmap) {
            this.calendarHeatmap.resize();
        }
    }
}