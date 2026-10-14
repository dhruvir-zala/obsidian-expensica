const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/time-selector-modal.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const loaded = { exports: {} };
class FixedDate extends Date {
    constructor(...args) {
        super(...(args.length ? args : [2026, 0, 2, 17, 23, 45]));
    }
}
const modelsPath = path.join(__dirname, '../src/models.ts');
const models = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(modelsPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, {
    exports: models.exports, module: models, Date: FixedDate
}, { filename: modelsPath });
vm.runInNewContext(compiled, {
    exports: loaded.exports,
    module: loaded,
    Date: FixedDate,
    require(name) {
        if (name === './models') return models.exports;
        assert.equal(name, 'obsidian');
        return {
            Modal: class {
                constructor(app) {
                    this.app = app;
                    this.contentEl = { empty() {} };
                }
                close() { this.onClose(); }
            }
        };
    }
}, { filename: sourcePath });
const { TimeSelectorModal, formatTimeForDisplay } = loaded.exports;

function makeField() {
    return {
        value: '',
        attributes: {},
        focusCount: 0,
        reportCount: 0,
        setCustomValidity(message) { this.validationMessage = message; },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { this.focusCount++; },
        reportValidity() { this.reportCount++; }
    };
}

// Geometry is offset and not an integer size to catch viewport/scale assumptions.
const bounds = { left: 73, top: 119, width: 263.5, height: 263.5 };
function makePicker(initialTime = '10:37', format = '24', onConfirm = () => {}, onDismiss) {
    const picker = new TimeSelectorModal({}, initialTime, format, onConfirm, onDismiss);
    const captures = new Set();
    picker.clock = {
        captures,
        focus() {},
        getBoundingClientRect: () => bounds,
        setPointerCapture: id => captures.add(id),
        hasPointerCapture: id => captures.has(id),
        releasePointerCapture: id => captures.delete(id)
    };
    picker.updateDisplay = () => {};
    picker.renderLabels = () => {};
    picker.renderInputMode = () => {};
    picker.hourInput = makeField();
    picker.minuteInput = makeField();
    picker.okButton = { focus() {} };
    return picker;
}

function pointerAt(position, divisions = 12, radius = 0.4, overrides = {}) {
    const angle = position / divisions * Math.PI * 2;
    return {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: bounds.left + bounds.width / 2 + Math.sin(angle) * radius * bounds.width,
        clientY: bounds.top + bounds.height / 2 - Math.cos(angle) * radius * bounds.height,
        preventDefault() { this.defaultPrevented = true; },
        ...overrides
    };
}

function press(picker, key, modifiers = {}) {
    const event = {
        key,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...modifiers
    };
    picker.handleKey(event);
    return event;
}

test('formats midnight, noon, seconds, and invalid values using the selected preference', () => {
    for (const [value, format, expected] of [
        ['00:00', '12', '12:00 AM'],
        ['12:00', '12', '12:00 PM'],
        ['23:07:42', '12', '11:07 PM'],
        ['00:03:59', '24', '00:03'],
        ['12:15', '24', '12:15'],
        ['23:59', '24', '23:59']
    ]) {
        assert.equal(formatTimeForDisplay(value, format), expected);
        assert.equal(makePicker(value, format).getValue(), value.slice(0, 5));
    }
    for (const value of ['', '24:00', '12:60', '09:30:60', '9:30', '12:34garbage']) {
        assert.equal(formatTimeForDisplay(value, '12'), '');
        assert.equal(makePicker(value).getValue(), '17:23');
    }
});

test('picker accepts minute precision while stored transaction times still require and preserve seconds', () => {
    for (const value of ['00:00', '12:30', '23:59']) {
        assert.equal(models.exports.getTimeInSeconds(value), null);
        assert.equal(makePicker(value).getValue(), value);
        assert.equal(formatTimeForDisplay(value, '24'), value);
    }
    for (const value of ['00:00:00', '12:30:42', '23:59:59']) {
        assert.equal(models.exports.getTransactionTime({ id: '20261015-101112-example', time: value }), value);
        assert.equal(makePicker(value).getValue(), value.slice(0, 5));
    }
    assert.equal(models.exports.getTransactionTime({ id: '20261015-101112-example', time: '12:30' }), '10:11:12');
    for (const value of ['24:00', '00:60', '12:30:60', '12:30:1', '12:30:000', '12:3', '1:30', '12:30 ']) {
        assert.equal(formatTimeForDisplay(value, '24'), '');
    }
});

test('both 24-hour rings select every hour, including distinct midnight and noon', () => {
    const picker = makePicker();
    for (let hour = 0; hour < 24; hour++) {
        const inner = hour === 0 || hour > 12;
        picker.startPointer(pointerAt(hour % 12, 12, inner ? 0.27 : 0.4));
        assert.equal(picker.getValue(), `${String(hour).padStart(2, '0')}:37`);
        assert.equal(picker.mode, 'hours');
        picker.releasePointer();
    }
});

test('12-hour clock selection preserves the current AM or PM period', () => {
    for (const periodOffset of [0, 12]) {
        const picker = makePicker(periodOffset ? '21:37' : '09:37', '12');
        for (let position = 0; position < 12; position++) {
            picker.startPointer(pointerAt(position));
            assert.equal(picker.hour, position + periodOffset);
            assert.equal(picker.minute, 37);
            picker.releasePointer();
        }
    }
});

test('minutes support all sixty positions independently of hour and pointer distance', () => {
    const picker = makePicker('23:37');
    picker.selectMode('minutes');
    for (let minute = 0; minute < 60; minute++) {
        picker.startPointer(pointerAt(minute, 60, minute % 2 ? 0.27 : 0.4));
        assert.equal(picker.getValue(), `23:${String(minute).padStart(2, '0')}`);
        picker.releasePointer();
    }
});

test('minute rounding switches at half-minute boundaries and wraps from 59 to 00', () => {
    const picker = makePicker('23:00');
    picker.selectMode('minutes');
    for (const [position, expected] of [[17.49, 17], [17.51, 18], [59, 59], [59.49, 59], [59.51, 0], [0.49, 0]]) {
        picker.startPointer(pointerAt(position, 60));
        assert.equal(picker.minute, expected);
        assert.equal(picker.hour, 23);
        picker.releasePointer();
    }
});

test('dragging changes the hour without advancing modes until the gesture ends', () => {
    const picker = makePicker('10:37');
    picker.startPointer(pointerAt(2));
    assert.equal(picker.hour, 2);
    picker.updateFromPointer(pointerAt(6));
    assert.equal(picker.hour, 6);
    picker.updateFromPointer(pointerAt(9, 12, 0.27));
    assert.equal(picker.hour, 21);
    assert.equal(picker.mode, 'hours');
    assert.equal(picker.activePointer, 1);
    assert.ok(picker.clock.captures.has(1));
    picker.releasePointer();
    assert.equal(picker.activePointer, null);
    assert.equal(picker.clock.captures.size, 0);
});

test('stationary drags and unchanged typed values avoid redrawing the clock', () => {
    const picker = makePicker('10:37');
    let renders = 0;
    let labelRebuilds = 0;
    picker.updateDisplay = () => renders++;
    picker.renderLabels = () => labelRebuilds++;
    picker.startPointer(pointerAt(10));
    picker.updateFromPointer(pointerAt(10));
    assert.equal(renders, 0);
    picker.updateFromPointer(pointerAt(11));
    assert.equal(renders, 1);
    picker.updateFromPointer(pointerAt(11));
    assert.equal(renders, 1);
    picker.selectMode('hours');
    assert.equal(labelRebuilds, 0);
    assert.equal(picker.activePointer, null);
    picker.selectMode('minutes');
    assert.equal(labelRebuilds, 1);
    assert.equal(renders, 2);
    picker.toggleInputMode();
    picker.commitInputs();
    picker.commitInputs();
    assert.equal(renders, 2);
    assert.equal(picker.getValue(), '11:37');
});

test('ignores nonprimary, nonleft, competing pointers, and the ambiguous clock center', () => {
    const picker = makePicker();
    for (const overrides of [{ isPrimary: false }, { button: 1 }, { button: 2 }]) {
        const event = pointerAt(4, 12, 0.4, overrides);
        picker.startPointer(event);
        assert.equal(picker.getValue(), '10:37');
        assert.equal(picker.activePointer, null);
        assert.equal(event.defaultPrevented, undefined);
    }
    picker.startPointer(pointerAt(4));
    picker.startPointer(pointerAt(7, 12, 0.4, { pointerId: 2 }));
    assert.equal(picker.hour, 4);
    assert.equal(picker.activePointer, 1);
    picker.releasePointer();
    picker.startPointer(pointerAt(0, 12, 0));
    assert.equal(picker.hour, 4);
    assert.equal(picker.pointerSelected, false);
    picker.releasePointer();
});

test('closing during a gesture releases capture and dismisses without confirming', () => {
    let confirmations = 0;
    let dismissals = 0;
    const picker = makePicker('10:37', '24', () => confirmations++, () => dismissals++);
    picker.startPointer(pointerAt(3));
    picker.close();
    assert.equal(picker.activePointer, null);
    assert.equal(picker.pointerBounds, null);
    assert.equal(picker.clock.captures.size, 0);
    assert.equal(confirmations, 0);
    assert.equal(dismissals, 1);
    picker.close();
    assert.equal(dismissals, 1);
});

test('minute keyboard controls step by one or five, wrap, and support Home/End', () => {
    const picker = makePicker('23:59');
    picker.selectMode('minutes');
    for (const [key, expected] of [
        ['ArrowUp', 0], ['ArrowDown', 59], ['ArrowRight', 0], ['ArrowLeft', 59],
        ['PageUp', 4], ['PageDown', 59], ['Home', 0], ['End', 59]
    ]) {
        const event = press(picker, key);
        assert.equal(picker.minute, expected);
        assert.equal(picker.hour, 23);
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.propagationStopped, true);
    }
});

test('hour keyboard controls respect 24-hour bounds and preserve AM/PM in 12-hour mode', () => {
    const picker = makePicker('23:37');
    for (const [key, expected] of [['ArrowUp', 0], ['ArrowDown', 23], ['Home', 0], ['End', 23]]) {
        press(picker, key);
        assert.equal(picker.hour, expected);
        assert.equal(picker.minute, 37);
    }
    for (const periodOffset of [0, 12]) {
        const twelveHourPicker = makePicker(periodOffset ? '23:37' : '11:37', '12');
        for (const [key, expected] of [['ArrowUp', 0], ['ArrowUp', 1], ['ArrowDown', 0], ['Home', 1], ['End', 0]]) {
            press(twelveHourPicker, key);
            assert.equal(twelveHourPicker.hour, periodOffset + expected);
        }
    }
});

test('keyboard activation advances hours to minutes, then focuses OK; modifier shortcuts stay untouched', () => {
    const picker = makePicker();
    let okFocusCount = 0;
    picker.okButton.focus = () => okFocusCount++;
    press(picker, 'Enter');
    assert.equal(picker.mode, 'minutes');
    assert.equal(okFocusCount, 0);
    press(picker, ' ');
    assert.equal(okFocusCount, 1);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
        const event = press(picker, 'ArrowUp', { [modifier]: true });
        assert.equal(picker.getValue(), '10:37');
        assert.equal(event.defaultPrevented, undefined);
    }
});

test('switching analog and typed input repeatedly preserves the same time in both preferences', () => {
    for (const [format, initialTime, displayedHour] of [
        ['12', '00:07', '12'], ['12', '12:07', '12'], ['12', '23:59', '11'],
        ['24', '00:07', '00'], ['24', '12:07', '12'], ['24', '23:59', '23']
    ]) {
        const picker = makePicker(initialTime, format);
        for (let repeat = 0; repeat < 3; repeat++) {
            picker.toggleInputMode();
            assert.equal(picker.keyboardMode, true);
            assert.equal(picker.hourInput.value, displayedHour);
            assert.equal(picker.minuteInput.value, initialTime.slice(3));
            assert.equal(picker.getValue(), initialTime);
            picker.toggleInputMode();
            assert.equal(picker.keyboardMode, false);
            assert.equal(picker.getValue(), initialTime);
        }
    }
});

test('valid typed hour and minute edits retain AM/PM and survive switching back to the clock', () => {
    for (const [format, initialTime, typedHour, expected] of [
        ['12', '00:37', '12', '00:09'], ['12', '00:37', '1', '01:09'],
        ['12', '12:37', '12', '12:09'], ['12', '12:37', '1', '13:09'],
        ['24', '10:37', '0', '00:09'], ['24', '10:37', '23', '23:09']
    ]) {
        const picker = makePicker(initialTime, format);
        picker.toggleInputMode();
        picker.hourInput.value = typedHour;
        assert.equal(picker.updateFromInput('hours'), true);
        picker.minuteInput.value = '9';
        assert.equal(picker.updateFromInput('minutes'), true);
        assert.equal(picker.getValue(), expected);
        assert.equal(picker.hourInput.validationMessage, '');
        assert.equal(picker.minuteInput.attributes['aria-invalid'], 'false');
        picker.toggleInputMode();
        assert.equal(picker.keyboardMode, false);
        assert.equal(picker.getValue(), expected);
        picker.toggleInputMode();
        assert.equal(picker.minuteInput.value, '09');
        assert.equal(picker.getValue(), expected);
    }
});

test('clock changes after typed edits appear when switching back to typed input', () => {
    const picker = makePicker('10:37');
    picker.toggleInputMode();
    picker.hourInput.value = '19';
    picker.minuteInput.value = '22';
    picker.toggleInputMode();
    assert.equal(picker.getValue(), '19:22');
    picker.startPointer(pointerAt(8, 12, 0.27));
    picker.releasePointer();
    picker.selectMode('minutes');
    picker.startPointer(pointerAt(41, 60));
    picker.releasePointer();
    picker.toggleInputMode();
    assert.equal(picker.getValue(), '20:41');
    assert.equal(picker.hourInput.value, '20');
    assert.equal(picker.minuteInput.value, '41');
});

test('invalid typed values block both OK and mode switching without confirming or resetting the input', () => {
    for (const format of ['12', '24']) {
        for (const unit of ['hours', 'minutes']) {
            const outsideRange = unit === 'minutes' ? ['60'] : format === '12' ? ['0', '13'] : ['24'];
            for (const invalid of ['', 'a', '1x', '1.5', '-1', '123', '007', ' 3', '3 ', ...outsideRange]) {
                let confirmations = 0;
                let dismissals = 0;
                const picker = makePicker('10:37', format, () => confirmations++, () => dismissals++);
                picker.toggleInputMode();
                const input = unit === 'hours' ? picker.hourInput : picker.minuteInput;
                input.value = invalid;
                assert.equal(picker.updateFromInput(unit), false);
                assert.equal(input.attributes['aria-invalid'], 'true');
                assert.notEqual(input.validationMessage, '');
                picker.confirmSelection();
                assert.equal(confirmations, 0);
                assert.equal(dismissals, 0);
                assert.ok(input.reportCount > 0);
                picker.toggleInputMode();
                assert.equal(picker.keyboardMode, true);
                assert.equal(input.value, invalid);
                assert.equal(picker.getValue(), '10:37');
                assert.equal(confirmations, 0);
                assert.equal(dismissals, 0);
            }
        }
    }
});

test('correcting invalid typed input clears validation and allows confirmation', () => {
    const events = [];
    const picker = makePicker('10:37', '24', value => events.push(value), () => events.push('dismiss'));
    picker.toggleInputMode();
    picker.minuteInput.value = '60';
    picker.confirmSelection();
    assert.deepEqual(events, []);
    picker.minuteInput.value = '59';
    picker.confirmSelection();
    assert.equal(picker.minuteInput.validationMessage, '');
    assert.equal(picker.minuteInput.attributes['aria-invalid'], 'false');
    assert.deepEqual(events, ['dismiss', '10:59']);
});

test('Cancel discards and OK confirms the shared time from either input mode after dismissal', () => {
    for (const keyboardMode of [false, true]) {
        for (const confirm of [false, true]) {
            const events = [];
            const picker = makePicker('10:37', '24', value => events.push(value), () => events.push('dismiss'));
            if (keyboardMode) {
                picker.toggleInputMode();
                picker.hourInput.value = '20';
                picker.minuteInput.value = '41';
                picker.updateFromInput('hours');
                picker.updateFromInput('minutes');
            } else {
                picker.startPointer(pointerAt(8, 12, 0.27));
                picker.releasePointer();
                picker.selectMode('minutes');
                picker.startPointer(pointerAt(41, 60));
                picker.releasePointer();
            }
            assert.equal(picker.getValue(), '20:41');
            if (confirm) picker.confirmSelection();
            else picker.close();
            assert.deepEqual(events, confirm ? ['dismiss', '20:41'] : ['dismiss']);
        }
    }
});
