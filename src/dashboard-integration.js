import { moveCalendarMonth } from './calendar-ui';
import { CalendarHeatmap } from './visualizations/calendar-view';
import { renderPanelTitle } from './models';
export class PremiumVisualizations {
    constructor(container, plugin, currentDate, selectedDate = null, onSelectedDateChange, onTransactionEdit) {
        this.container = container;
        this.plugin = plugin;
        this.currentDate = currentDate;
        this.selectedDate = selectedDate;
        this.onSelectedDateChange = onSelectedDateChange;
        this.onTransactionEdit = onTransactionEdit;
        this.calendarHeatmap = null;
    }
    render() {
        this.container.empty();
        this.container.addClass('expensica-premium-viz-container', 'expensica-chart-container');
        const header = this.container.createDiv('expensica-premium-viz-header expensica-chart-header');
        const headerContent = header.createDiv('expensica-calendar-header-content');
        renderPanelTitle(headerContent, 'Spending Heatmap Calendar', 'calendar', 'h2', 'expensica-calendar-title');
        const calendarContainer = this.container.createDiv('expensica-calendar-wrapper');
        const transactions = this.plugin.getTransactionsForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.calendarHeatmap = new CalendarHeatmap(calendarContainer, this.plugin, transactions, this.currentDate, this.selectedDate, (selectedDate) => {
            var _a;
            this.selectedDate = selectedDate;
            (_a = this.onSelectedDateChange) === null || _a === void 0 ? void 0 : _a.call(this, selectedDate);
        }, this.onTransactionEdit, (offset) => this.changeMonth(offset));
        this.calendarHeatmap.render();
    }
    changeMonth(offset) {
        this.updateDate(moveCalendarMonth(this.currentDate, offset));
    }
    updateDate(newDate) {
        this.currentDate = newDate;
        const transactions = this.plugin.getTransactionsForMonth(newDate.getFullYear(), newDate.getMonth());
        if (this.calendarHeatmap) {
            this.calendarHeatmap.updateMonth(newDate, transactions);
        }
        else {
            this.render();
        }
    }
    resize() {
        var _a, _b;
        return (_b = (_a = this.calendarHeatmap) === null || _a === void 0 ? void 0 : _a.resize()) !== null && _b !== void 0 ? _b : false;
    }
}
