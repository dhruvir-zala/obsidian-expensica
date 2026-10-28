import { App, Modal, setIcon } from 'obsidian';
import { formatDate, parseLocalDate } from './models';

const MIN_YEAR = 1;
const MAX_YEAR = 9999;
const YEARS_PER_PAGE = 12;

// Labels use the system language and the same calendar as Date and stored ISO dates.
const dateFormatter = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory', year: 'numeric', month: 'short', day: 'numeric'
});
const monthFormatter = new Intl.DateTimeFormat(undefined, { calendar: 'gregory', month: 'long' });
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { calendar: 'gregory', weekday: 'short' });
const dayFormatter = new Intl.DateTimeFormat(undefined, {
    calendar: 'gregory', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// Local noon avoids midnight DST transitions. setFullYear also handles years 1–99.
function calendarDate(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setHours(12, 0, 0, 0);
    date.setFullYear(year, month, day);
    return date;
}

export function parseDateInput(value: string): Date | null {
    const input = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || input.startsWith('0000-')) return null;
    const date = parseLocalDate(input, 12);
    // Let Date handle calendar rules; reject values it normalized into another date.
    return formatDate(date) === input ? date : null;
}

export function formatDateForDisplay(value: string): string {
    const date = parseDateInput(value);
    return date ? dateFormatter.format(date) : value;
}

export class DateSelectorModal extends Modal {
    private static nextId = 0;
    private selectedDate: string;
    private focusedDate: string;
    private viewYear: number;
    private viewMonth: number;
    private yearStart: number;
    private focusedYear: number;
    private showingYears = false;
    private manualMode = false;
    private renderedManualMode: boolean | null = null;
    private dismissed = false;
    private today = formatDate(new Date());
    private dateInput: HTMLInputElement;
    private dateText: HTMLSpanElement;
    private editButton: HTMLButtonElement;
    private navigation: HTMLDivElement;
    private previousButton: HTMLButtonElement;
    private nextButton: HTMLButtonElement;
    private monthLabel: HTMLSpanElement;
    private yearButton: HTMLButtonElement;
    private calendar: HTMLDivElement;
    private days: HTMLDivElement;
    private years: HTMLDivElement;

    constructor(
        app: App,
        initialDate: string,
        private onConfirm: (date: string) => void,
        private onDismiss?: () => void
    ) {
        super(app);
        const date = parseDateInput(initialDate) || new Date();
        this.selectedDate = this.focusedDate = formatDate(date);
        this.viewYear = this.focusedYear = date.getFullYear();
        this.viewMonth = date.getMonth();
        this.yearStart = this.getYearPage(this.viewYear);
    }

    onOpen() {
        this.dismissed = false;
        this.showingYears = false;
        this.manualMode = false;
        this.renderedManualMode = null;
        this.contentEl.empty();
        this.modalEl.addClass('expensica-date-selector-modal');
        this.contentEl.addClass('expensica-modal', 'expensica-date-selector');
        const id = `expensica-date-selector-${DateSelectorModal.nextId++}`;
        this.contentEl.createEl('h2', {
            text: 'Select date', cls: 'expensica-modal-title', attr: { id: `${id}-title` }
        });
        this.modalEl.setAttribute('aria-labelledby', `${id}-title`);

        const entry = this.contentEl.createDiv('expensica-date-selector-entry');
        this.dateText = entry.createSpan('expensica-date-selector-value');
        this.dateInput = entry.createEl('input', {
            cls: 'expensica-date-selector-input',
            attr: {
                type: 'text', value: this.selectedDate,
                placeholder: 'YYYY-MM-DD', maxlength: '10', autocomplete: 'off', spellcheck: 'false',
                'aria-label': 'Date (YYYY-MM-DD)'
            }
        });
        this.editButton = this.createIconButton(entry, 'expensica-date-selector-edit', 'pencil', 'Edit date');
        this.editButton.addEventListener('click', () => this.toggleEditing());
        this.dateInput.addEventListener('input', () => this.applyManualInput());
        this.dateInput.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing || !this.manualMode) return;
            event.preventDefault();
            event.stopPropagation();
            this.toggleEditing();
        });

        this.navigation = this.contentEl.createDiv('expensica-date-selector-navigation');
        this.previousButton = this.createIconButton(this.navigation, 'expensica-date-selector-previous', 'chevron-left', 'Previous month');
        this.previousButton.addEventListener('click', () => this.navigate(-1));
        const heading = this.navigation.createDiv('expensica-date-selector-heading');
        this.monthLabel = heading.createSpan('expensica-date-selector-month');
        this.yearButton = heading.createEl('button', {
            cls: 'expensica-date-selector-year', attr: { type: 'button' }
        });
        this.yearButton.addEventListener('click', () => this.toggleYears());
        this.nextButton = this.createIconButton(this.navigation, 'expensica-date-selector-next', 'chevron-right', 'Next month');
        this.nextButton.addEventListener('click', () => this.navigate(1));

        this.calendar = this.contentEl.createDiv('expensica-date-selector-calendar');
        const weekdays = this.calendar.createDiv('expensica-date-selector-weekdays');
        weekdays.setAttribute('aria-hidden', 'true');
        for (let weekday = 0; weekday < 7; weekday++) {
            weekdays.createSpan({
                text: weekdayFormatter.format(calendarDate(2024, 0, 7 + weekday)),
                cls: 'expensica-date-selector-weekday'
            });
        }
        this.days = this.calendar.createDiv({ cls: 'expensica-date-selector-days', attr: { role: 'group' } });
        this.years = this.contentEl.createDiv({
            cls: 'expensica-date-selector-years', attr: { role: 'group', 'aria-label': 'Choose year' }
        });

        const footer = this.contentEl.createDiv('expensica-form-footer');
        const cancel = footer.createEl('button', {
            text: 'Cancel', cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        cancel.addEventListener('click', () => this.close());
        const ok = footer.createEl('button', {
            text: 'OK', cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
            attr: { type: 'button' }
        });
        ok.addEventListener('click', () => this.confirmSelection());
        this.render();
    }

    private createIconButton(parent: HTMLElement, cls: string, icon: string, label: string): HTMLButtonElement {
        const button = parent.createEl('button', {
            cls, attr: { type: 'button', 'aria-label': label, title: label }
        });
        setIcon(button, icon);
        return button;
    }

    private toggleEditing() {
        if (this.manualMode && !this.applyManualInput(true)) return;
        this.manualMode = !this.manualMode;
        this.showingYears = false;
        if (this.manualMode) this.dateInput.value = this.selectedDate;
        this.render();
        if (this.manualMode) {
            this.dateInput.focus();
            this.dateInput.select();
        } else {
            this.dateInput.value = this.selectedDate;
            this.focusDay();
        }
    }

    private applyManualInput(report = false): boolean {
        const date = parseDateInput(this.dateInput.value);
        this.dateInput.setCustomValidity(date ? '' : 'Enter a valid date as YYYY-MM-DD.');
        this.dateInput.setAttribute('aria-invalid', String(!date));
        if (!date) {
            if (report) {
                this.dateInput.focus();
                this.dateInput.reportValidity();
            }
            return false;
        }
        this.selectedDate = this.focusedDate = formatDate(date);
        this.viewYear = date.getFullYear();
        this.viewMonth = date.getMonth();
        this.showingYears = false;
        if (!this.manualMode) this.render();
        return true;
    }

    private selectDate(value: string) {
        if (value === this.selectedDate && value === this.focusedDate) return;
        this.dateInput.value = value;
        this.applyManualInput();
        this.focusDay();
    }

    private getYearPage(year: number): number {
        return Math.floor((year - MIN_YEAR) / YEARS_PER_PAGE) * YEARS_PER_PAGE + MIN_YEAR;
    }

    private toggleYears() {
        this.showingYears = !this.showingYears;
        if (this.showingYears) {
            this.focusedYear = this.viewYear;
            this.yearStart = this.getYearPage(this.viewYear);
        }
        this.render();
        if (this.showingYears) this.focusYear();
        else this.focusDay();
    }

    private selectYear(year: number) {
        this.viewYear = year;
        this.showingYears = false;
        this.setMonthFocus();
        this.render();
        this.focusDay();
    }

    private navigate(direction: number) {
        if (this.showingYears) {
            const start = this.yearStart + direction * YEARS_PER_PAGE;
            if (start < MIN_YEAR || start > MAX_YEAR) return;
            this.yearStart = this.focusedYear = start;
        } else {
            const month = calendarDate(this.viewYear, this.viewMonth + direction, 1);
            if (month.getFullYear() < MIN_YEAR || month.getFullYear() > MAX_YEAR) return;
            this.viewYear = month.getFullYear();
            this.viewMonth = month.getMonth();
            this.setMonthFocus();
        }
        this.render();
    }

    private setMonthFocus() {
        const selected = parseDateInput(this.selectedDate);
        this.focusedDate = selected && selected.getFullYear() === this.viewYear && selected.getMonth() === this.viewMonth
            ? this.selectedDate : formatDate(calendarDate(this.viewYear, this.viewMonth, 1));
    }

    private render() {
        this.dateText.textContent = formatDateForDisplay(this.selectedDate);
        this.dateText.hidden = this.manualMode;
        this.dateInput.hidden = !this.manualMode;
        this.navigation.hidden = this.manualMode;
        this.calendar.hidden = this.manualMode || this.showingYears;
        this.years.hidden = this.manualMode || !this.showingYears;
        if (this.renderedManualMode !== this.manualMode) {
            const editLabel = this.manualMode ? 'Switch to calendar' : 'Edit date';
            this.editButton.setAttribute('aria-label', editLabel);
            this.editButton.setAttribute('title', editLabel);
            this.editButton.setAttribute('aria-pressed', String(this.manualMode));
            setIcon(this.editButton, this.manualMode ? 'calendar' : 'pencil');
            this.renderedManualMode = this.manualMode;
        }
        if (this.manualMode) return;
        this.monthLabel.hidden = this.showingYears;
        this.monthLabel.textContent = monthFormatter.format(calendarDate(this.viewYear, this.viewMonth, 1));
        this.yearButton.textContent = this.showingYears
            ? `${this.yearStart}–${Math.min(this.yearStart + YEARS_PER_PAGE - 1, MAX_YEAR)}` : String(this.viewYear);
        this.yearButton.setAttribute('aria-label', this.showingYears ? 'Back to calendar' : `Choose year, ${this.viewYear}`);
        this.yearButton.setAttribute('aria-expanded', String(this.showingYears));
        for (const [button, direction] of [[this.previousButton, -1], [this.nextButton, 1]] as const) {
            const label = `${direction < 0 ? 'Previous' : 'Next'} ${this.showingYears ? 'years' : 'month'}`;
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
        }
        this.previousButton.disabled = this.showingYears ? this.yearStart === MIN_YEAR : this.viewYear === MIN_YEAR && this.viewMonth === 0;
        this.nextButton.disabled = this.showingYears ? this.yearStart + YEARS_PER_PAGE > MAX_YEAR : this.viewYear === MAX_YEAR && this.viewMonth === 11;
        if (this.showingYears) this.renderYears();
        else this.renderDays();
    }

    private renderDays() {
        this.days.empty();
        this.days.setAttribute('aria-label', `${this.monthLabel.textContent} ${this.viewYear}`);
        const offset = calendarDate(this.viewYear, this.viewMonth, 1).getDay();
        for (let index = 0; index < 42; index++) {
            const date = calendarDate(this.viewYear, this.viewMonth, index - offset + 1);
            const valid = date.getFullYear() >= MIN_YEAR && date.getFullYear() <= MAX_YEAR && date.getMonth() === this.viewMonth;
            if (!valid) {
                this.days.createSpan({ cls: 'expensica-date-selector-empty', attr: { 'aria-hidden': 'true' } });
                continue;
            }
            const value = formatDate(date);
            const button = this.days.createEl('button', {
                text: String(date.getDate()), cls: 'expensica-date-selector-day',
                attr: { type: 'button', tabindex: value === this.focusedDate ? '0' : '-1' }
            });
            button.setAttribute('data-date', value);
            button.setAttribute('aria-label', dayFormatter.format(date));
            button.setAttribute('aria-pressed', String(value === this.selectedDate));
            button.toggleClass('is-selected', value === this.selectedDate);
            button.toggleClass('is-today', value === this.today);
            if (value === this.today) button.setAttribute('aria-current', 'date');
            button.addEventListener('click', () => this.selectDate(value));
            button.addEventListener('keydown', event => this.handleDayKey(event, value));
        }
    }

    private renderYears() {
        this.years.empty();
        const selectedYear = Number(this.selectedDate.slice(0, 4));
        const todayYear = Number(this.today.slice(0, 4));
        for (let year = this.yearStart; year <= Math.min(this.yearStart + YEARS_PER_PAGE - 1, MAX_YEAR); year++) {
            const button = this.years.createEl('button', {
                text: String(year), cls: 'expensica-date-selector-year-option',
                attr: { type: 'button', 'data-year': String(year), tabindex: year === this.focusedYear ? '0' : '-1' }
            });
            button.toggleClass('is-selected', year === selectedYear);
            button.toggleClass('is-today', year === todayYear);
            button.setAttribute('aria-pressed', String(year === selectedYear));
            button.addEventListener('click', () => this.selectYear(year));
            button.addEventListener('keydown', event => this.handleYearKey(event, year));
        }
    }

    private handleDayKey(event: KeyboardEvent, value: string) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const date = parseDateInput(value);
        if (!date) return;
        const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getDay(), End: 6 - date.getDay() };
        let next: Date;
        if (event.key in steps) {
            next = calendarDate(date.getFullYear(), date.getMonth(), date.getDate() + steps[event.key]);
        } else if (event.key === 'PageUp' || event.key === 'PageDown') {
            const delta = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
            const month = calendarDate(date.getFullYear(), date.getMonth() + delta, 1);
            const lastDay = calendarDate(month.getFullYear(), month.getMonth() + 1, 0).getDate();
            next = calendarDate(month.getFullYear(), month.getMonth(), Math.min(date.getDate(), lastDay));
        } else return;
        event.preventDefault();
        event.stopPropagation();
        if (next.getFullYear() < MIN_YEAR || next.getFullYear() > MAX_YEAR) return;
        this.focusedDate = formatDate(next);
        this.viewYear = next.getFullYear();
        this.viewMonth = next.getMonth();
        this.render();
        this.focusDay();
    }

    private handleYearKey(event: KeyboardEvent, year: number) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -YEARS_PER_PAGE, PageDown: YEARS_PER_PAGE };
        const next = event.key === 'Home' ? this.yearStart : event.key === 'End' ? Math.min(this.yearStart + YEARS_PER_PAGE - 1, MAX_YEAR)
            : event.key in steps ? year + steps[event.key] : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        this.focusedYear = Math.max(MIN_YEAR, Math.min(MAX_YEAR, next));
        this.yearStart = this.getYearPage(this.focusedYear);
        this.render();
        this.focusYear();
    }

    private focusDay() {
        this.days.querySelector<HTMLButtonElement>(`[data-date="${this.focusedDate}"]`)?.focus({ preventScroll: true });
    }

    private focusYear() {
        this.years.querySelector<HTMLButtonElement>(`[data-year="${this.focusedYear}"]`)?.focus({ preventScroll: true });
    }

    private confirmSelection() {
        if (this.manualMode && !this.applyManualInput(true)) return;
        const value = this.selectedDate;
        this.close();
        this.onConfirm(value);
    }

    onClose() {
        this.contentEl.empty();
        if (!this.dismissed) {
            this.dismissed = true;
            this.onDismiss?.();
        }
    }
}
