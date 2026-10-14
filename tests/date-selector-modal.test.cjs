const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

function loadModule(filename, dependencies = {}, globals = {}) {
    const sourcePath = path.join(__dirname, '../src', filename);
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const loaded = { exports: {} };
    vm.runInNewContext(compiled, {
        exports: loaded.exports,
        module: loaded,
        Date,
        Intl,
        ...globals,
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    }, { filename: sourcePath });
    return loaded.exports;
}

const models = loadModule('models.ts');
const selectorDependencies = {
    './models': models,
    obsidian: {
        Modal: class {
            constructor(app) {
                this.app = app;
                this.contentEl = { empty() {} };
            }
            close() { this.onClose(); }
        },
        setIcon() {}
    }
};
const { DateSelectorModal, parseDateInput, formatDateForDisplay } = loadModule('date-selector-modal.ts', selectorDependencies);

function makeField(value = '') {
    return {
        value,
        readOnly: true,
        attributes: {},
        focusCount: 0,
        reportCount: 0,
        setCustomValidity(message) { this.validationMessage = message; },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { this.focusCount++; },
        select() {},
        reportValidity() { this.reportCount++; }
    };
}

function makePicker(initialDate = '2026-10-15', onConfirm = () => {}, onDismiss) {
    const picker = new DateSelectorModal({}, initialDate, onConfirm, onDismiss);
    picker.dateInput = makeField(picker.selectedDate);
    picker.editButton = makeField();
    picker.render = () => {};
    picker.focusDay = () => {};
    picker.focusYear = () => {};
    return picker;
}

function keyEvent(key, modifiers = {}) {
    return {
        key,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...modifiers
    };
}

function attachDayGrid(picker) {
    const cells = [];
    picker.days = {
        empty() { cells.length = 0; },
        setAttribute() {},
        createSpan(options) { cells.push({ tag: 'span', attributes: options.attr }); },
        createEl(tag, options) {
            const cell = {
                tag, attributes: { ...options.attr }, text: options.text,
                setAttribute(name, value) { this.attributes[name] = value; },
                toggleClass() {}, addEventListener() {}
            };
            cells.push(cell);
            return cell;
        }
    };
    return cells;
}

test('shared date utilities preserve local midnight by default and support noon without remapping small years', () => {
    for (const value of ['0001-01-01', '0099-12-31', '0100-03-01', '2026-03-08', '2026-11-01', '9999-12-31']) {
        const midnight = models.parseLocalDate(value);
        const noon = models.parseLocalDate(value, 12);
        const expected = value.split('-').map(Number);
        for (const [date, hour] of [[midnight, 0], [noon, 12]]) {
            assert.deepEqual([date.getFullYear(), date.getMonth() + 1, date.getDate()], expected);
            assert.deepEqual([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()], [hour, 0, 0, 0]);
            assert.equal(models.formatDate(date), value);
        }
        assert.equal(parseDateInput(value).getTime(), noon.getTime());
    }
    const timestampDate = models.parseLocalDate('2026-10-15T23:59:58Z');
    assert.equal(models.formatDate(timestampDate), '2026-10-15');
    assert.equal(timestampDate.getHours(), 0);
});

test('native date parsing accepts calendar dates and years below 100 without remapping them', () => {
    for (const [value, year, month, day] of [
        ['2024-02-29', 2024, 1, 29], ['2000-02-29', 2000, 1, 29],
        ['0001-01-01', 1, 0, 1], ['0004-02-29', 4, 1, 29],
        ['0099-12-31', 99, 11, 31], ['0100-03-01', 100, 2, 1],
        ['9999-12-31', 9999, 11, 31]
    ]) {
        const date = parseDateInput(value);
        assert.ok(date, value);
        assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [year, month, day]);
        assert.equal(date.getHours(), 12);
        assert.equal(models.formatDate(date), value);
    }
    assert.equal(models.formatDate(parseDateInput(' 2026-10-15 ')), '2026-10-15');
});

test('strict date parsing rejects rolled-over dates, unsupported years, and malformed input', () => {
    for (const value of [
        '', '2025-02-29', '1900-02-29', '0100-02-29', '2026-04-31',
        '2026-00-15', '2026-13-15', '2026-10-00', '2026-10-32', '0000-01-01',
        '10000-01-01', '2026-1-05', '26-10-15', '2026/10/15', '2026-10-15T00:00:00Z', '2026-10-15x'
    ]) {
        assert.equal(parseDateInput(value), null, value);
    }
});

test('selected-date display uses a stable readable month-day-year format', () => {
    assert.equal(formatDateForDisplay('2026-10-15'), 'Oct 15, 2026');
    assert.equal(formatDateForDisplay('2024-02-29'), 'Feb 29, 2024');
    assert.equal(formatDateForDisplay('invalid'), 'invalid');
});

test('system-language labels use the same calendar as stored dates under non-Gregorian locale defaults', () => {
    for (const locale of ['th-TH', 'fa-IR']) {
        assert.notEqual(new Intl.DateTimeFormat(locale).resolvedOptions().calendar, 'gregory');
        const localized = loadModule('date-selector-modal.ts', selectorDependencies, {
            Intl: {
                DateTimeFormat: function (locales, options) {
                    return new Intl.DateTimeFormat(locales ?? locale, options);
                }
            }
        });
        const picker = new localized.DateSelectorModal({}, '2026-10-15', () => {});
        Object.assign(picker, {
            dateInput: makeField('2026-10-15'), editButton: makeField(), dateText: {},
            navigation: {}, calendar: {}, years: {}, monthLabel: {},
            yearButton: makeField(), previousButton: makeField(), nextButton: makeField()
        });
        const cells = attachDayGrid(picker);
        picker.render();
        const date = models.parseLocalDate('2026-10-15', 12);
        assert.equal(picker.dateText.textContent, 'Oct 15, 2026');
        assert.equal(picker.yearButton.textContent, '2026');
        assert.equal(picker.monthLabel.textContent, new Intl.DateTimeFormat(locale, { calendar: 'gregory', month: 'long' }).format(date));
        const selected = cells.find(cell => cell.attributes['data-date'] === '2026-10-15');
        assert.equal(selected.attributes['aria-pressed'], 'true');
        assert.equal(selected.attributes['aria-label'], new Intl.DateTimeFormat(locale, {
            calendar: 'gregory', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }).format(date));
    }
});

test('constructor and confirmation preserve the supplied calendar date, including small years', () => {
    for (const initial of ['0001-01-01', '0099-12-31', '2024-02-29', '2026-10-15', '9999-12-31']) {
        const events = [];
        const picker = makePicker(initial, value => events.push(value), () => events.push('dismiss'));
        assert.equal(picker.selectedDate, initial);
        assert.equal(picker.focusedDate, initial);
        assert.equal(picker.viewYear, Number(initial.slice(0, 4)));
        assert.equal(picker.viewMonth, Number(initial.slice(5, 7)) - 1);
        picker.confirmSelection();
        assert.deepEqual(events, ['dismiss', initial]);
    }
});

test('month and year navigation changes the viewed calendar without changing selection', () => {
    const picker = makePicker('2026-12-31');
    picker.navigate(1);
    assert.deepEqual([picker.viewYear, picker.viewMonth, picker.focusedDate], [2027, 0, '2027-01-01']);
    assert.equal(picker.selectedDate, '2026-12-31');
    picker.navigate(-1);
    assert.equal(picker.focusedDate, '2026-12-31');
    picker.toggleYears();
    const firstPage = picker.yearStart;
    picker.navigate(1);
    assert.equal(picker.yearStart, firstPage + 12);
    assert.equal(picker.selectedDate, '2026-12-31');
    picker.selectYear(2024);
    assert.equal(picker.showingYears, false);
    assert.deepEqual([picker.viewYear, picker.viewMonth, picker.focusedDate], [2024, 11, '2024-12-01']);
    assert.equal(picker.selectedDate, '2026-12-31');
});

test('month and year page navigation stays within years 1 through 9999', () => {
    for (const [initial, direction] of [['0001-01-01', -1], ['9999-12-31', 1]]) {
        const picker = makePicker(initial);
        const original = [picker.viewYear, picker.viewMonth, picker.focusedDate];
        picker.navigate(direction);
        assert.deepEqual([picker.viewYear, picker.viewMonth, picker.focusedDate], original);
        picker.toggleYears();
        const page = picker.yearStart;
        picker.navigate(direction);
        assert.equal(picker.yearStart, page);
        assert.equal(picker.selectedDate, initial);
    }
});

test('keyboard day navigation crosses month boundaries and clamps month/year jumps to valid days', () => {
    for (const [initial, key, modifiers, expected] of [
        ['2026-01-31', 'ArrowRight', {}, '2026-02-01'],
        ['2026-03-01', 'ArrowLeft', {}, '2026-02-28'],
        ['2024-03-01', 'ArrowUp', {}, '2024-02-23'],
        ['2026-12-28', 'ArrowDown', {}, '2027-01-04'],
        ['2024-01-31', 'PageDown', {}, '2024-02-29'],
        ['2026-03-31', 'PageUp', {}, '2026-02-28'],
        ['2024-02-29', 'PageDown', { shiftKey: true }, '2025-02-28'],
        ['2024-02-29', 'PageUp', { shiftKey: true }, '2023-02-28'],
        ['2026-10-15', 'Home', {}, '2026-10-11'],
        ['2026-10-15', 'End', {}, '2026-10-17']
    ]) {
        const picker = makePicker(initial);
        const event = keyEvent(key, modifiers);
        picker.handleDayKey(event, initial);
        assert.equal(picker.focusedDate, expected);
        assert.equal(picker.selectedDate, initial);
        assert.equal(event.defaultPrevented, true);
        assert.equal(event.propagationStopped, true);
    }
});

test('keyboard day and year navigation respect year bounds and leave modifier shortcuts alone', () => {
    for (const [initial, key] of [['0001-01-01', 'ArrowLeft'], ['9999-12-31', 'ArrowRight']]) {
        const picker = makePicker(initial);
        picker.handleDayKey(keyEvent(key), initial);
        assert.equal(picker.focusedDate, initial);
        picker.toggleYears();
        picker.handleYearKey(keyEvent(key), picker.viewYear);
        assert.equal(picker.focusedYear, picker.viewYear);
    }
    const picker = makePicker();
    picker.toggleYears();
    picker.handleYearKey(keyEvent('ArrowDown'), 2026);
    assert.equal(picker.focusedYear, 2029);
    picker.handleYearKey(keyEvent('PageUp'), 2029);
    assert.equal(picker.focusedYear, 2017);
    assert.equal(picker.selectedDate, '2026-10-15');
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
        const event = keyEvent('ArrowRight', { [modifier]: true });
        picker.handleDayKey(event, picker.focusedDate);
        assert.equal(picker.focusedDate, '2026-10-15');
        assert.equal(event.defaultPrevented, undefined);
    }
});

test('manual editing and calendar selection share the selected date without resetting on mode changes', () => {
    const picker = makePicker();
    picker.toggleEditing();
    assert.equal(picker.manualMode, true);
    assert.equal(picker.dateInput.value, '2026-10-15');
    picker.dateInput.value = '2024-02-29';
    assert.equal(picker.applyManualInput(), true);
    assert.deepEqual([picker.selectedDate, picker.focusedDate, picker.viewYear, picker.viewMonth], ['2024-02-29', '2024-02-29', 2024, 1]);
    picker.toggleEditing();
    assert.equal(picker.manualMode, false);
    picker.selectDate('2024-03-01');
    picker.toggleEditing();
    assert.equal(picker.dateInput.value, '2024-03-01');
    picker.toggleEditing();
    assert.equal(picker.selectedDate, '2024-03-01');
    assert.equal(picker.dateInput.attributes['aria-invalid'], 'false');
});

test('manual mode hides calendar navigation and year choices until returning to the calendar', () => {
    const picker = makePicker();
    Object.assign(picker, {
        dateText: {}, navigation: {}, calendar: {}, years: {}, monthLabel: {},
        yearButton: makeField(), previousButton: makeField(), nextButton: makeField(),
        renderDays() {}, renderYears() {}, render: DateSelectorModal.prototype.render
    });
    picker.render();
    assert.equal(picker.dateText.textContent, 'Oct 15, 2026');
    assert.equal(picker.dateText.hidden, false);
    assert.equal(picker.dateInput.hidden, true);
    assert.equal(picker.calendar.hidden, false);
    picker.toggleYears();
    assert.equal(picker.years.hidden, false);
    picker.toggleEditing();
    assert.equal(picker.manualMode, true);
    assert.equal(picker.dateText.hidden, true);
    assert.equal(picker.dateInput.hidden, false);
    assert.equal(picker.navigation.hidden, true);
    assert.equal(picker.calendar.hidden, true);
    assert.equal(picker.years.hidden, true);
    picker.toggleEditing();
    assert.equal(picker.navigation.hidden, false);
    assert.equal(picker.calendar.hidden, false);
    assert.equal(picker.years.hidden, true);
    assert.equal(picker.dateText.textContent, 'Oct 15, 2026');
});

test('invalid manual dates block returning and OK without resetting the entry or invoking callbacks', () => {
    for (const invalid of ['', '2025-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026/10/15', '2026-10-']) {
        const events = [];
        const picker = makePicker('2026-10-15', value => events.push(value), () => events.push('dismiss'));
        picker.toggleEditing();
        picker.dateInput.value = invalid;
        assert.equal(picker.applyManualInput(), false);
        picker.toggleEditing();
        assert.equal(picker.manualMode, true);
        assert.equal(picker.dateInput.value, invalid);
        assert.equal(picker.selectedDate, '2026-10-15');
        picker.confirmSelection();
        assert.deepEqual(events, []);
        assert.equal(picker.dateInput.attributes['aria-invalid'], 'true');
        assert.notEqual(picker.dateInput.validationMessage, '');
        assert.ok(picker.dateInput.reportCount > 0);
        picker.close();
        assert.deepEqual(events, ['dismiss']);
    }
});

test('correcting an invalid manual date clears validity and confirms its canonical value after dismissal', () => {
    const events = [];
    const picker = makePicker('2026-10-15', value => events.push(value), () => events.push('dismiss'));
    picker.toggleEditing();
    picker.dateInput.value = '2025-02-29';
    picker.confirmSelection();
    assert.deepEqual(events, []);
    picker.dateInput.value = ' 2024-02-29 ';
    picker.confirmSelection();
    assert.equal(picker.dateInput.validationMessage, '');
    assert.equal(picker.dateInput.attributes['aria-invalid'], 'false');
    assert.deepEqual(events, ['dismiss', '2024-02-29']);
});

test('Cancel discards and OK confirms the shared selection from calendar or manual entry', () => {
    for (const manual of [false, true]) {
        for (const confirm of [false, true]) {
            const events = [];
            const picker = makePicker('2026-10-15', value => events.push(value), () => events.push('dismiss'));
            if (manual) {
                picker.toggleEditing();
                picker.dateInput.value = '2024-02-29';
                picker.applyManualInput();
            } else picker.selectDate('2024-02-29');
            if (confirm) picker.confirmSelection();
            else picker.close();
            assert.deepEqual(events, confirm ? ['dismiss', '2024-02-29'] : ['dismiss']);
            picker.close();
            assert.equal(events.filter(event => event === 'dismiss').length, 1);
        }
    }
});

test('calendar grids render only current-month dates and leave neighboring-month cells empty', () => {
    for (const [initial, expectedDays] of [['2024-02-15', 29], ['2026-02-15', 28], ['2026-10-15', 31], ['0001-01-01', 31], ['9999-12-31', 31]]) {
        const picker = makePicker(initial);
        const cells = attachDayGrid(picker);
        picker.monthLabel = { textContent: 'Month' };
        picker.renderDays();
        assert.equal(cells.length, 42);
        const dates = cells.filter(cell => cell.tag === 'button');
        assert.equal(dates.length, expectedDays);
        assert.deepEqual(dates.map(cell => Number(cell.text)), Array.from({ length: expectedDays }, (_, index) => index + 1));
        for (const cell of dates) assert.ok(cell.attributes['data-date'].startsWith(initial.slice(0, 7)));
        for (const cell of cells.filter(cell => cell.tag === 'span')) assert.equal(cell.attributes['aria-hidden'], 'true');
    }
});

test('local parsing and DST-adjacent keyboard navigation preserve calendar dates', () => {
    if (process.env.EXPENSICA_DATE_TZ_CHILD) {
        assert.equal(new Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.TZ);
    }
    for (const value of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
        assert.equal(models.formatDate(parseDateInput(value)), value);
        assert.equal(makePicker(value).selectedDate, value);
    }
    for (const [initial, expected] of [['2026-03-07', '2026-03-08'], ['2026-03-08', '2026-03-09'], ['2026-10-31', '2026-11-01'], ['2026-11-01', '2026-11-02']]) {
        const picker = makePicker(initial);
        picker.handleDayKey(keyEvent('ArrowRight'), initial);
        assert.equal(picker.focusedDate, expected);
        assert.equal(picker.selectedDate, initial);
    }
});

if (!process.env.EXPENSICA_DATE_TZ_CHILD) {
    test('date behavior remains invariant in Denver, Kiritimati, and Honolulu', () => {
        for (const timezone of ['America/Denver', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
            const environment = { ...process.env, TZ: timezone, EXPENSICA_DATE_TZ_CHILD: '1' };
            delete environment.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', __filename], {
                env: environment,
                encoding: 'utf8',
                timeout: 20000
            });
            assert.equal(child.error, undefined, child.error?.message);
            assert.equal(child.status, 0, `${timezone}\n${child.stdout}\n${child.stderr}`);
            assert.match(child.stdout, /local parsing and DST-adjacent keyboard navigation preserve calendar dates/);
        }
    });
}
