import { App, Modal, setIcon } from 'obsidian';
import { getTimeInSeconds } from './models';

type TimeFormat = '12' | '24';
type ClockMode = 'hours' | 'minutes';

const OUTER_RADIUS = 0.4;
const INNER_RADIUS = 0.27;

function parseTime(value: string): { hour: number; minute: number } | null {
    const seconds = getTimeInSeconds(value.length === 5 ? `${value}:00` : value);
    return seconds === null ? null : { hour: Math.floor(seconds / 3600), minute: Math.floor(seconds / 60) % 60 };
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function formatTimeForDisplay(value: string, format: TimeFormat): string {
    const time = parseTime(value);
    return time ? formatTimeParts(time.hour, time.minute, format) : '';
}

function formatTimeParts(hour: number, minute: number, format: TimeFormat): string {
    return format === '24'
        ? `${pad(hour)}:${pad(minute)}`
        : `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

export class TimeSelectorModal extends Modal {
    private static nextId = 0;
    private hour: number;
    private minute: number;
    private mode: ClockMode = 'hours';
    private keyboardMode = false;
    private clock: HTMLDivElement;
    private hand: HTMLDivElement;
    private handTip: HTMLSpanElement;
    private labels: HTMLDivElement;
    private hourButton: HTMLButtonElement;
    private minuteButton: HTMLButtonElement;
    private hourInput: HTMLInputElement;
    private minuteInput: HTMLInputElement;
    private modeToggle: HTMLButtonElement;
    private periodButtons: HTMLButtonElement[] = [];
    private okButton: HTMLButtonElement;
    private numberLabels: Array<{ element: HTMLSpanElement; value: number }> = [];
    private activePointer: number | null = null;
    private pointerBounds: DOMRect | null = null;
    private pointerSelected = false;
    private dismissed = false;

    constructor(
        app: App,
        initialTime: string,
        private timeFormat: TimeFormat,
        private onConfirm: (time: string) => void,
        private onDismiss?: () => void
    ) {
        super(app);
        const time = parseTime(initialTime);
        if (time) {
            this.hour = time.hour;
            this.minute = time.minute;
        } else {
            const now = new Date();
            this.hour = now.getHours();
            this.minute = now.getMinutes();
        }
    }

    onOpen() {
        this.dismissed = false;
        this.mode = 'hours';
        this.keyboardMode = false;
        this.contentEl.empty();
        this.modalEl.addClass('expensica-time-selector-modal');
        this.contentEl.addClass('expensica-modal', 'expensica-time-selector');
        const id = `expensica-time-selector-${TimeSelectorModal.nextId++}`;
        this.contentEl.createEl('h2', {
            text: 'Select time',
            cls: 'expensica-modal-title',
            attr: { id: `${id}-title` }
        });
        this.modalEl.setAttribute('aria-labelledby', `${id}-title`);

        const header = this.contentEl.createDiv('expensica-time-selector-header');
        const values = header.createDiv('expensica-time-selector-values');
        this.hourButton = values.createEl('button', {
            cls: 'expensica-time-selector-value',
            attr: { type: 'button', 'aria-label': 'Choose hours' }
        });
        this.hourInput = this.createTimeInput(values, 'hours');
        values.createSpan({ text: ':', cls: 'expensica-time-selector-separator', attr: { 'aria-hidden': 'true' } });
        this.minuteButton = values.createEl('button', {
            cls: 'expensica-time-selector-value',
            attr: { type: 'button', 'aria-label': 'Choose minutes' }
        });
        this.minuteInput = this.createTimeInput(values, 'minutes');
        this.hourButton.addEventListener('click', () => this.selectMode('hours'));
        this.minuteButton.addEventListener('click', () => this.selectMode('minutes'));

        this.periodButtons = [];
        if (this.timeFormat === '12') {
            const periods = header.createDiv('expensica-time-selector-period');
            ['AM', 'PM'].forEach((period, index) => {
                const button = periods.createEl('button', {
                    text: period,
                    cls: 'expensica-time-selector-period-button',
                    attr: { type: 'button', 'aria-label': period }
                });
                button.addEventListener('click', () => {
                    const hour = this.hour % 12 + index * 12;
                    if (hour === this.hour) return;
                    this.hour = hour;
                    this.updateDisplay();
                });
                this.periodButtons.push(button);
            });
        }

        this.clock = this.contentEl.createDiv({
            cls: 'expensica-time-selector-clock',
            attr: { role: 'slider', tabindex: '0' }
        });
        this.hand = this.clock.createDiv('expensica-time-selector-hand');
        this.hand.setAttribute('aria-hidden', 'true');
        this.handTip = this.hand.createSpan('expensica-time-selector-hand-tip');
        this.clock.createSpan({ cls: 'expensica-time-selector-center', attr: { 'aria-hidden': 'true' } });
        this.labels = this.clock.createDiv('expensica-time-selector-labels');
        this.labels.setAttribute('aria-hidden', 'true');
        this.clock.addEventListener('pointerdown', event => this.startPointer(event));
        this.clock.addEventListener('pointermove', event => {
            if (event.pointerId !== this.activePointer) return;
            event.preventDefault();
            this.updateFromPointer(event);
        });
        this.clock.addEventListener('pointerup', event => {
            if (event.pointerId !== this.activePointer) return;
            event.preventDefault();
            this.updateFromPointer(event);
            const advance = this.pointerSelected && this.mode === 'hours';
            this.releasePointer();
            if (advance) this.selectMode('minutes');
        });
        this.clock.addEventListener('pointercancel', event => {
            if (event.pointerId === this.activePointer) this.releasePointer();
        });
        this.clock.addEventListener('lostpointercapture', event => {
            if (event.pointerId === this.activePointer) this.releasePointer();
        });
        this.clock.addEventListener('keydown', event => this.handleKey(event));

        const footer = this.contentEl.createDiv('expensica-form-footer');
        this.modeToggle = footer.createEl('button', {
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary expensica-time-selector-mode-toggle',
            attr: { type: 'button' }
        });
        this.modeToggle.addEventListener('click', () => this.toggleInputMode());
        const cancelButton = footer.createEl('button', {
            text: 'Cancel',
            cls: 'expensica-standard-button expensica-btn expensica-btn-secondary',
            attr: { type: 'button' }
        });
        cancelButton.addEventListener('click', () => this.close());
        this.okButton = footer.createEl('button', {
            text: 'OK',
            cls: 'expensica-standard-button expensica-btn expensica-btn-primary',
            attr: { type: 'button' }
        });
        this.okButton.addEventListener('click', () => this.confirmSelection());
        this.renderLabels();
        this.updateDisplay();
        this.renderInputMode();
    }

    private createTimeInput(container: HTMLElement, unit: ClockMode): HTMLInputElement {
        const input = container.createEl('input', {
            cls: 'expensica-time-selector-input',
            attr: {
                type: 'text', inputmode: 'numeric', maxlength: '2',
                autocomplete: 'off', spellcheck: 'false', required: 'required',
                'aria-label': unit === 'hours' ? 'Hours' : 'Minutes'
            }
        });
        input.addEventListener('focus', () => input.select());
        input.addEventListener('input', () => this.updateFromInput(unit));
        input.addEventListener('blur', () => {
            if (this.updateFromInput(unit)) {
                input.value = unit === 'hours' ? this.getHourText() : pad(this.minute);
            }
        });
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            if (!this.updateFromInput(unit, true)) return;
            if (unit === 'hours') this.minuteInput.focus();
            else this.confirmSelection();
        });
        return input;
    }

    private updateFromInput(unit: ClockMode, report = false): boolean {
        const input = unit === 'hours' ? this.hourInput : this.minuteInput;
        const minimum = unit === 'hours' && this.timeFormat === '12' ? 1 : 0;
        const maximum = unit === 'minutes' ? 59 : this.timeFormat === '12' ? 12 : 23;
        const value = Number(input.value);
        const valid = /^\d{1,2}$/.test(input.value) && value >= minimum && value <= maximum;
        input.setCustomValidity(valid ? '' : `Enter ${unit} from ${minimum} to ${maximum}.`);
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid) {
            if (report) {
                input.focus();
                input.reportValidity();
            }
            return false;
        }
        this.setClockValue(unit, value);
        return true;
    }

    private commitInputs(): boolean {
        return this.updateFromInput('hours', true) && this.updateFromInput('minutes', true);
    }

    private toggleInputMode() {
        if (this.keyboardMode && !this.commitInputs()) return;
        this.releasePointer();
        this.keyboardMode = !this.keyboardMode;
        if (this.keyboardMode) {
            this.hourInput.value = this.getHourText();
            this.minuteInput.value = pad(this.minute);
        }
        this.renderInputMode();
        if (this.keyboardMode) this.hourInput.focus();
        else this.clock.focus({ preventScroll: true });
    }

    private renderInputMode() {
        this.hourButton.hidden = this.keyboardMode;
        this.minuteButton.hidden = this.keyboardMode;
        this.hourInput.hidden = !this.keyboardMode;
        this.minuteInput.hidden = !this.keyboardMode;
        this.clock.hidden = this.keyboardMode;
        const label = this.keyboardMode ? 'Switch to analog clock' : 'Switch to keyboard input';
        this.modeToggle.setAttribute('aria-label', label);
        this.modeToggle.setAttribute('title', label);
        this.modeToggle.setAttribute('aria-pressed', String(this.keyboardMode));
        setIcon(this.modeToggle, this.keyboardMode ? 'clock' : 'keyboard');
    }

    private confirmSelection() {
        if (this.keyboardMode && !this.commitInputs()) return;
        const value = this.getValue();
        this.close();
        this.onConfirm(value);
    }

    private getValue(): string {
        return `${pad(this.hour)}:${pad(this.minute)}`;
    }

    private getHourText(): string {
        return this.timeFormat === '24' ? pad(this.hour) : String(this.hour % 12 || 12);
    }

    private selectMode(mode: ClockMode) {
        this.releasePointer();
        if (this.mode !== mode) {
            this.mode = mode;
            this.renderLabels();
            this.updateDisplay();
        }
        this.clock.focus({ preventScroll: true });
    }

    private renderLabels() {
        this.labels.empty();
        this.numberLabels = [];
        const addLabel = (value: number, position: number, inner: boolean) => {
            const angle = position * Math.PI / 6;
            const radius = inner ? INNER_RADIUS : OUTER_RADIUS;
            const element = this.labels.createSpan({
                text: this.mode === 'minutes' || inner ? pad(value) : String(value),
                cls: 'expensica-time-selector-number'
            });
            element.toggleClass('is-inner', inner);
            element.style.left = `${(0.5 + Math.sin(angle) * radius) * 100}%`;
            element.style.top = `${(0.5 - Math.cos(angle) * radius) * 100}%`;
            this.numberLabels.push({ element, value });
        };
        for (let position = 0; position < 12; position++) {
            addLabel(this.mode === 'minutes' ? position * 5 : position || 12, position, false);
            if (this.mode === 'hours' && this.timeFormat === '24') {
                addLabel(position === 0 ? 0 : position + 12, position, true);
            }
        }
    }

    private updateDisplay() {
        const hours = this.mode === 'hours';
        const hourValue = this.timeFormat === '12' ? this.hour % 12 || 12 : this.hour;
        this.hourButton.textContent = this.getHourText();
        this.minuteButton.textContent = pad(this.minute);
        this.hourButton.toggleClass('is-active', hours);
        this.minuteButton.toggleClass('is-active', !hours);
        this.hourButton.setAttribute('aria-pressed', String(hours));
        this.minuteButton.setAttribute('aria-pressed', String(!hours));
        this.periodButtons.forEach((button, index) => {
            const selected = Math.floor(this.hour / 12) === index;
            button.toggleClass('is-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        this.clock.setAttribute('aria-label', hours ? 'Hours' : 'Minutes');
        this.clock.setAttribute('aria-valuemin', hours && this.timeFormat === '12' ? '1' : '0');
        this.clock.setAttribute('aria-valuemax', hours ? this.timeFormat === '12' ? '12' : '23' : '59');
        this.clock.setAttribute('aria-valuenow', String(hours ? hourValue : this.minute));
        this.clock.setAttribute('aria-valuetext', formatTimeParts(this.hour, this.minute, this.timeFormat));
        const value = hours ? hourValue : this.minute;
        this.numberLabels.forEach(label => label.element.toggleClass('is-selected', label.value === value));
        const inner = hours && this.timeFormat === '24' && (this.hour === 0 || this.hour > 12);
        this.hand.style.height = `${(inner ? INNER_RADIUS : OUTER_RADIUS) * 100}%`;
        this.hand.style.transform = `rotate(${hours ? this.hour % 12 * 30 : this.minute * 6}deg)`;
        this.handTip.toggleClass('is-precise', !hours && this.minute % 5 !== 0);
    }

    private startPointer(event: PointerEvent) {
        if (!event.isPrimary || event.button !== 0 || this.activePointer !== null) return;
        event.preventDefault();
        this.clock.focus({ preventScroll: true });
        this.activePointer = event.pointerId;
        this.pointerBounds = this.clock.getBoundingClientRect();
        this.pointerSelected = false;
        this.clock.setPointerCapture(event.pointerId);
        this.updateFromPointer(event);
    }

    private updateFromPointer(event: PointerEvent) {
        const bounds = this.pointerBounds;
        if (!bounds || bounds.width === 0) return;
        const x = event.clientX - bounds.left - bounds.width / 2;
        const y = event.clientY - bounds.top - bounds.height / 2;
        const distance = Math.hypot(x, y) / bounds.width;
        // The center has no meaningful clock angle.
        if (distance < 0.08) return;
        const turns = (Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1;
        this.pointerSelected = true;
        if (this.mode === 'minutes') {
            this.setClockValue('minutes', Math.round(turns * 60) % 60);
        } else {
            const position = Math.round(turns * 12) % 12;
            const hour = this.timeFormat === '12'
                ? position || 12
                : distance < (INNER_RADIUS + OUTER_RADIUS) / 2
                    ? position === 0 ? 0 : position + 12
                    : position || 12;
            this.setClockValue('hours', hour);
        }
    }

    private releasePointer() {
        const pointer = this.activePointer;
        this.activePointer = null;
        this.pointerBounds = null;
        this.pointerSelected = false;
        if (pointer !== null && this.clock.hasPointerCapture(pointer)) {
            this.clock.releasePointerCapture(pointer);
        }
    }

    private handleKey(event: KeyboardEvent) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (this.mode === 'hours') this.selectMode('minutes');
            else this.okButton.focus();
            return;
        }
        const direction = ['ArrowUp', 'ArrowRight', 'PageUp'].includes(event.key) ? 1
            : ['ArrowDown', 'ArrowLeft', 'PageDown'].includes(event.key) ? -1 : 0;
        if (!direction && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        event.stopPropagation();
        const hours = this.mode === 'hours';
        const minimum = hours && this.timeFormat === '12' ? 1 : 0;
        const count = hours ? this.timeFormat === '12' ? 12 : 24 : 60;
        const current = hours ? this.timeFormat === '12' ? this.hour % 12 || 12 : this.hour : this.minute;
        const step = !hours && event.key.startsWith('Page') ? 5 : 1;
        const value = event.key === 'Home' ? minimum : event.key === 'End' ? minimum + count - 1
            : (current - minimum + direction * step + count) % count + minimum;
        this.setClockValue(this.mode, value);
    }

    private setClockValue(unit: ClockMode, value: number) {
        if (unit === 'hours') {
            const hour = this.timeFormat === '12' ? value % 12 + Math.floor(this.hour / 12) * 12 : value;
            if (hour === this.hour) return;
            this.hour = hour;
        } else {
            if (value === this.minute) return;
            this.minute = value;
        }
        this.updateDisplay();
    }

    onClose() {
        this.releasePointer();
        this.contentEl.empty();
        this.numberLabels = [];
        if (!this.dismissed) {
            this.dismissed = true;
            this.onDismiss?.();
        }
    }
}
