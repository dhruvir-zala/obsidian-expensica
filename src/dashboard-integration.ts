import { moveCalendarMonth } from './calendar-ui';
import { CalendarHeatmap, DailyReviewRange } from './visualizations/calendar-view';
import ExpensicaPlugin from '../main';
import { Transaction } from './models';

export class PremiumVisualizations {
    private calendarHeatmap: CalendarHeatmap | null = null;

    constructor(
        private container: HTMLElement,
        private plugin: ExpensicaPlugin,
        private currentDate: Date,
        private selectedDate: Date | null = null,
        private onSelectedDateChange?: (date: Date) => void,
        private onTransactionEdit?: (transaction: Transaction) => void,
        private getReviewRange?: () => DailyReviewRange
    ) {}

    render() {
        this.destroy();
        this.container.empty();
        this.container.addClass('expensica-premium-viz-container');
        const calendarContainer = this.container.createDiv('expensica-calendar-wrapper');
        const transactions = this.plugin.getTransactionsForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.calendarHeatmap = new CalendarHeatmap(
            calendarContainer, this.plugin, transactions, this.currentDate, this.selectedDate,
            (selectedDate) => {
                this.selectedDate = selectedDate;
                this.onSelectedDateChange?.(selectedDate);
            },
            this.onTransactionEdit,
            (offset) => this.changeMonth(offset),
            this.getReviewRange
        );
        this.calendarHeatmap.render();
    }

    private changeMonth(offset: number) {
        this.updateDate(moveCalendarMonth(this.currentDate, offset));
    }

    public updateDate(newDate: Date) {
        this.currentDate = newDate;
        const transactions = this.plugin.getTransactionsForMonth(newDate.getFullYear(), newDate.getMonth());
        if (this.calendarHeatmap) {
            this.calendarHeatmap.updateMonth(newDate, transactions);
        } else {
            this.render();
        }
    }

    public resize(): boolean {
        return this.calendarHeatmap?.resize() ?? false;
    }

    public destroy() {
        this.calendarHeatmap?.destroy();
        this.calendarHeatmap = null;
    }
}
