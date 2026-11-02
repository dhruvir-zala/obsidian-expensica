const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

function load(filename, dependencies = {}) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, console,
        require: name => dependencies[name] || (name.endsWith('/account-calculations') ? load('src/account-calculations.ts', { './models': dependencies['./models'] || dependencies['../models'] }) : undefined) || {}
    });
    return exports;
}

const models = load('src/models.ts');
const { ExpensicaDashboardView, DateRangeType } = load('src/dashboard-view.ts', {
    './models': models, obsidian: { Modal: class {}, ItemView: class {} },
    'chart.js': { Tooltip: { positioners: {} } }
});
class Element {
    constructor() { this.children = []; }
    empty() { this.children.length = 0; }
    addClass() {}
    createDiv() { const child = new Element(); this.children.push(child); return child; }
    createEl(tag, options) {
        const child = this.createDiv();
        child.tag = tag;
        child.text = options.text;
        return child;
    }
}
class Heatmap {
    constructor() { this.updates = []; this.selections = []; }
    render() {}
    updateMonth(date, transactions, selectedDate) { this.updates.push({ date, transactions, selectedDate }); }
    selectDate(date) { this.selections.push(date); }
}
const { PremiumVisualizations } = load('src/dashboard-integration.ts', {
    './visualizations/calendar-view': { CalendarHeatmap: Heatmap }
});

function navigation(initial, onTodayClick) {
    const source = models.parseLocalDate(initial, 12);
    const before = source.getTime();
    const queries = [];
    const rows = [];
    const plugin = { getTransactionsForMonth(year, month) { queries.push([year, month]); return rows; } };
    const container = new Element();
    const instance = new PremiumVisualizations(container, plugin, source, null, undefined, onTodayClick);
    instance.render();
    const buttons = container.children[0].children[0].children[1].children;
    return { instance, source, before, queries, rows, previous: buttons[0], today: buttons[1], next: buttons[2] };
}

for (const [initial, direction, expected] of [
    ['2026-01-31', 'next', '2026-02-28'],
    ['2024-01-31', 'next', '2024-02-29'],
    ['2026-03-31', 'previous', '2026-02-28'],
    ['2024-03-31', 'previous', '2024-02-29'],
    ['2024-02-29', 'next', '2024-03-29'],
    ['2024-02-29', 'previous', '2024-01-29'],
    ['2026-12-31', 'next', '2027-01-31'],
    ['2026-01-31', 'previous', '2025-12-31'],
    ['2026-04-30', 'next', '2026-05-30'],
    ['2026-12-31', 'previous', '2026-11-30'],
    ['2000-01-31', 'next', '2000-02-29'],
    ['2100-01-31', 'next', '2100-02-28']
]) {
    test(`calendar ${direction} from ${initial} clamps to ${expected}`, () => {
        const fixture = navigation(initial);
        fixture[direction].onclick();
        const { instance, source, before, queries, rows } = fixture;
        assert.equal(models.formatDate(instance.currentDate), expected);
        assert.equal(instance.currentDate.getHours(), 12);
        assert.equal(source.getTime(), before);
        assert.notEqual(instance.currentDate, source);
        assert.deepEqual(queries.at(-1), [instance.currentDate.getFullYear(), instance.currentDate.getMonth()]);
        assert.equal(instance.calendarHeatmap.updates.length, 1);
        assert.equal(instance.calendarHeatmap.updates[0].date, instance.currentDate);
        assert.equal(instance.calendarHeatmap.updates[0].transactions, rows);
    });
}

test('repeated calendar clicks advance exactly one month and retain the clamped day', () => {
    const fixture = navigation('2026-01-31');
    for (const expected of ['2026-02-28', '2026-03-28', '2026-04-28']) {
        fixture.next.onclick();
        assert.equal(models.formatDate(fixture.instance.currentDate), expected);
    }
    fixture.previous.onclick();
    assert.equal(models.formatDate(fixture.instance.currentDate), '2026-03-28');
    assert.equal(fixture.source.getTime(), fixture.before);
});

test('Today keeps its existing callback and fallback behavior', () => {
    let calls = 0;
    const delegated = navigation('2026-01-31', () => calls++);
    delegated.today.onclick();
    assert.equal(calls, 1);
    assert.equal(delegated.instance.currentDate, delegated.source);
    const fallback = navigation('2026-01-31');
    fallback.today.onclick();
    assert.equal(models.formatDate(fallback.instance.currentDate), models.formatDate(new Date()));
});

test('selecting Today in the visible month updates only the day selection', () => {
    const today = new Date();
    const fixture = navigation(models.formatDate(today));
    const heatmap = fixture.instance.calendarHeatmap;
    fixture.instance.updateDate(today, true);
    assert.equal(fixture.queries.length, 1, 'no monthly transaction reload');
    assert.equal(heatmap.updates.length, 0, 'no month rebuild');
    assert.deepEqual(heatmap.selections, [today]);
    assert.equal(fixture.instance.selectedDate, today);
});

test('returning to Today from another month updates that month once with Today selected', () => {
    const today = new Date();
    const previous = new Date(today);
    previous.setMonth(previous.getMonth() - 1, 1);
    const fixture = navigation(models.formatDate(previous));
    const heatmap = fixture.instance.calendarHeatmap;
    fixture.instance.updateDate(today, true);
    assert.equal(fixture.queries.length, 2);
    assert.equal(heatmap.updates.length, 1);
    assert.equal(heatmap.updates[0].selectedDate, today);
    assert.equal(heatmap.selections.length, 0);
    assert.equal(fixture.instance.calendarHeatmap, heatmap);
});

function chart(timeFormat = '24') {
    return Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: { settings: { timeFormat, dateFormat: 'YYYY-MM-DD', showWeekNumbers: false } }
    });
}
function dayRange(key) {
    const startDate = models.parseLocalDate(key);
    const endDate = models.parseLocalDate(key);
    endDate.setHours(23, 59, 59, 999);
    return { type: DateRangeType.CUSTOM, startDate, endDate };
}

test('ordinary, leap, spring and fall single local dates all use hourly resolution', () => {
    if (process.env.EXPENSICA_BOUNDARY_TZ_CHILD) {
        assert.equal(new Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.TZ);
    }
    const instance = chart();
    for (const key of ['2026-01-15', '2024-02-29', '2026-03-08', '2026-11-01', '2026-12-31']) {
        const { startDate, endDate } = dayRange(key);
        assert.equal(instance.getIncomeExpenseChartResolution(startDate, endDate), 'hour', key);
        assert.equal(instance.getIncomeExpenseChartResolution(startDate, startDate), 'hour');
        assert.equal(models.formatDate(startDate), key);
        assert.equal(models.formatDate(endDate), key);
        if (process.env.TZ === 'America/Denver' && ['2026-03-08', '2026-11-01'].includes(key)) {
            assert.equal((endDate - startDate + 1) / 3600000, key === '2026-03-08' ? 23 : 25);
        }
    }
});

test('different local dates use daily resolution even when separated by less than 24 hours', () => {
    const instance = chart();
    for (const [first, second] of [['2026-03-07', '2026-03-08'], ['2026-03-08', '2026-03-09'],
        ['2026-10-31', '2026-11-01'], ['2026-11-01', '2026-11-02'], ['2026-12-31', '2027-01-01']]) {
        const start = models.parseLocalDate(first, 23);
        const end = models.parseLocalDate(second, 1);
        assert.ok(end - start < 86400000);
        assert.equal(instance.getIncomeExpenseChartResolution(start, end), 'day');
    }
});

test('existing daily, weekly, monthly and yearly resolution thresholds remain intact', () => {
    const instance = chart();
    for (const [start, end, expected] of [
        ['2026-01-01', '2026-01-31', 'day'], ['2026-01-15', '2026-02-15', 'day'],
        ['2026-01-15', '2026-02-16', 'week'], ['2026-01-15', '2026-04-15', 'week'],
        ['2026-01-15', '2026-04-16', 'month'], ['2026-01-15', '2029-01-15', 'month'],
        ['2026-01-15', '2029-01-16', 'year']
    ]) assert.equal(instance.getIncomeExpenseChartResolution(models.parseLocalDate(start), models.parseLocalDate(end)), expected);
});

test('hourly buckets retain 12/24-hour labels and financial totals on ordinary and DST dates', () => {
    for (const timeFormat of ['12', '24']) {
        const instance = chart(timeFormat);
        const settingsBefore = JSON.stringify(instance.plugin.settings);
        for (const key of ['2026-01-15', '2026-03-08', '2026-11-01']) {
            const range = dayRange(key);
            const bounds = [range.startDate.getTime(), range.endDate.getTime()];
            const transactions = [
                { id: 'income', date: key, time: '00:15:00', type: 'income', amount: 100 },
                { id: 'morning', date: key, time: '01:30:00', type: 'expense', amount: 10 },
                { id: 'noon', date: key, time: '12:30:00', type: 'expense', amount: 20 },
                { id: 'evening', date: key, time: '23:45:00', type: 'expense', amount: 30 },
                { id: 'transfer', date: key, time: '13:00:00', type: 'internal', amount: 999 }
            ];
            const before = JSON.stringify(transactions);
            const buckets = instance.getChartBucketsForRange(range, transactions);
            assert.ok(buckets.length > 1);
            assert.equal(buckets[0].label, timeFormat === '24' ? '0' : '12AM');
            assert.equal(buckets.find(bucket => bucket.start.getHours() === 1).label, timeFormat === '24' ? '1' : '1AM');
            assert.equal(buckets.find(bucket => bucket.start.getHours() === 12).label, timeFormat === '24' ? '12' : '12PM');
            assert.equal(buckets.at(-1).label, timeFormat === '24' ? '23' : '11PM');
            for (const bucket of buckets) {
                const hour = bucket.start.getHours();
                assert.equal(bucket.label, timeFormat === '24' ? String(hour) : `${hour % 12 || 12}${hour >= 12 ? 'PM' : 'AM'}`);
                assert.equal(models.formatDate(bucket.start), key);
                assert.equal(models.formatDate(bucket.end), key);
            }
            assert.equal(buckets.reduce((sum, bucket) => sum + bucket.income, 0), 100);
            assert.equal(buckets.reduce((sum, bucket) => sum + bucket.expenses, 0), 60);
            assert.equal(JSON.stringify(transactions), before);
            assert.deepEqual([range.startDate.getTime(), range.endDate.getTime()], bounds);
        }
        assert.equal(JSON.stringify(instance.plugin.settings), settingsBefore);
    }
});

test('daily bucket labels and explicit hourly date prefixes keep existing behavior', () => {
    const instance = chart();
    const range = { type: DateRangeType.THIS_MONTH,
        startDate: models.parseLocalDate('2026-01-01'), endDate: models.parseLocalDate('2026-01-03') };
    assert.deepEqual(Array.from(instance.getChartBucketsForRange(range, []), bucket => bucket.label), ['1', '2', '3']);
    const date = models.parseLocalDate('2026-01-01', 13);
    assert.equal(instance.formatChartHourLabel(date, true), `${instance.formatChartShortDateLabel(date)} 13`);
    instance.plugin.settings.timeFormat = '12';
    assert.equal(instance.formatChartHourLabel(date, true), `${instance.formatChartShortDateLabel(date)} 1PM`);
});

if (!process.env.EXPENSICA_BOUNDARY_TZ_CHILD) {
    test('navigation, DST resolution and labels pass in Denver, Kiritimati, Honolulu and UTC', () => {
        for (const timezone of ['America/Denver', 'Pacific/Kiritimati', 'Pacific/Honolulu', 'UTC']) {
            const env = { ...process.env, TZ: timezone, EXPENSICA_BOUNDARY_TZ_CHILD: '1' };
            delete env.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', __filename], { env, encoding: 'utf8', timeout: 20000 });
            assert.equal(child.error, undefined, child.error?.message);
            assert.equal(child.status, 0, `${timezone}\n${child.stdout}\n${child.stderr}`);
        }
    });
}
