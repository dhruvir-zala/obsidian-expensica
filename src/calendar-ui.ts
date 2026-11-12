import { setIcon } from 'obsidian';
import { formatDate } from './models';

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;
export const monthFormatter = new Intl.DateTimeFormat(undefined, { calendar: 'gregory', month: 'long' });
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { calendar: 'gregory', weekday: 'short' });
const dayFormatter = new Intl.DateTimeFormat(undefined, {
    calendar: 'gregory', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// Local noon avoids midnight DST transitions. setFullYear also handles years 1–99.
export function calendarDate(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setHours(12, 0, 0, 0);
    date.setFullYear(year, month, day);
    return date;
}

export function moveCalendarMonth(date: Date, offset: number): Date {
    const next = new Date(date);
    next.setMonth(next.getMonth() + offset, 1);
    const lastDay = calendarDate(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(date.getDate(), lastDay));
    return next;
}

export function createCalendarNavigation(parent: HTMLElement, onNavigate: (offset: number) => void, onYear?: () => void) {
    const navigation = parent.createDiv('expensica-date-selector-navigation');
    const createArrow = (direction: number) => {
        const label = direction < 0 ? 'Previous month' : 'Next month';
        const button = navigation.createEl('button', {
            cls: `expensica-calendar-navigation-button expensica-date-selector-${direction < 0 ? 'previous' : 'next'}`,
            attr: { type: 'button', 'aria-label': label, title: label }
        });
        setIcon(button, direction < 0 ? 'chevron-left' : 'chevron-right');
        button.addEventListener('click', () => onNavigate(direction));
        return button;
    };
    const previousButton = createArrow(-1);
    const heading = navigation.createDiv('expensica-date-selector-heading');
    const monthLabel = heading.createSpan('expensica-date-selector-month');
    const yearLabel = onYear
        ? heading.createEl('button', { cls: 'expensica-date-selector-year', attr: { type: 'button' } })
        : heading.createSpan('expensica-date-selector-year');
    if (onYear) yearLabel.addEventListener('click', onYear);
    const nextButton = createArrow(1);
    return { navigation, previousButton, nextButton, monthLabel, yearLabel };
}

export function createCalendarGrid(parent: HTMLElement, showWeekNumbers = false) {
    const calendar = parent.createDiv('expensica-date-selector-calendar');
    calendar.toggleClass('has-week-numbers', showWeekNumbers);
    const weekdays = calendar.createDiv('expensica-date-selector-weekdays');
    weekdays.setAttribute('aria-hidden', 'true');
    if (showWeekNumbers) weekdays.createSpan({ text: 'Wk' });
    for (let weekday = 0; weekday < 7; weekday++) {
        weekdays.createSpan({
            text: weekdayFormatter.format(calendarDate(2024, 0, 7 + weekday)),
            cls: 'expensica-date-selector-weekday'
        });
    }
    const days = calendar.createDiv({ cls: 'expensica-date-selector-days', attr: { role: 'group' } });
    return { calendar, days };
}

// ISO weeks, calculated entirely from local calendar fields (including across DST).
export function calendarWeekNumber(date: Date): number {
    const thursday = calendarDate(date.getFullYear(), date.getMonth(), date.getDate() + 4 - (date.getDay() || 7));
    let ordinal = thursday.getDate();
    for (let month = 0; month < thursday.getMonth(); month++) {
        ordinal += calendarDate(thursday.getFullYear(), month + 1, 0).getDate();
    }
    return Math.ceil(ordinal / 7);
}

interface CalendarDaysOptions {
    selectedDate: string | null;
    focusedDate?: string;
    today: string;
    showWeekNumbers?: boolean;
    onSelect: (value: string) => void;
    onKeyDown?: (event: KeyboardEvent, value: string) => void;
    decorateDay?: (button: HTMLButtonElement, date: Date) => void;
}

export function renderCalendarDays(days: HTMLElement, year: number, month: number, options: CalendarDaysOptions) {
    days.empty();
    days.setAttribute('aria-label', `${monthFormatter.format(calendarDate(year, month, 1))} ${year}`);
    const offset = calendarDate(year, month, 1).getDay();
    for (let index = 0; index < 42; index++) {
        const date = calendarDate(year, month, index - offset + 1);
        if (options.showWeekNumbers && index % 7 === 0) {
            days.createSpan({ text: String(calendarWeekNumber(date)), cls: 'expensica-calendar-week-number' });
        }
        const valid = date.getFullYear() >= MIN_YEAR && date.getFullYear() <= MAX_YEAR && date.getMonth() === month;
        if (!valid) {
            days.createSpan({ cls: 'expensica-date-selector-empty', attr: { 'aria-hidden': 'true' } });
            continue;
        }
        const value = formatDate(date);
        const button = days.createEl('button', {
            text: String(date.getDate()), cls: 'expensica-date-selector-day',
            attr: { type: 'button', tabindex: !options.focusedDate || value === options.focusedDate ? '0' : '-1' }
        });
        button.setAttribute('data-date', value);
        button.setAttribute('aria-label', dayFormatter.format(date));
        button.setAttribute('aria-pressed', String(value === options.selectedDate));
        button.toggleClass('is-selected', value === options.selectedDate);
        button.toggleClass('is-today', value === options.today);
        if (value === options.today) button.setAttribute('aria-current', 'date');
        button.addEventListener('click', () => options.onSelect(value));
        if (options.onKeyDown) button.addEventListener('keydown', event => options.onKeyDown?.(event, value));
        options.decorateDay?.(button, date);
    }
}
