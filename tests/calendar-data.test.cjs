const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

function load(filename, dependencies = {}, extraSource = '') {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extraSource;
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, console,
        require: name => dependencies[name] || {}
    });
    return exports;
}
const models = load('src/models.ts');
const { CalendarHeatmap } = load('src/visualizations/calendar-view.ts', { '../models': models });
const extraSource = '\nexport { getRunningBalanceByTransactionIdForAccount };';
const obsidian = { Modal: class {}, ItemView: class {} };
const dashboard = load('src/dashboard-view.ts', { './models': models, obsidian,
    'chart.js': { Tooltip: { positioners: {} } }
}, extraSource);
const transactions = load('src/transactions-view.ts', { './models': models, obsidian,
    './dashboard-view': dashboard
}, extraSource);
const row = (id, date, fields = {}) => ({ id, date, time: '12:00:00', amount: 10,
    type: 'expense', description: 'ENTRY', category: 'food', account: 'chequing-cash', ...fields });
const dayKey = row => models.formatDate(models.parseLocalDate(row.date));
const ids = rows => Array.from(rows, row => row.id);

function plugin(source, defaultReference = 'chequing-cash') {
    return {
        transactions: source,
        settings: { enableAccounts: true, defaultCurrency: 'USD' },
        getAllTransactions() { return [...this.transactions]; },
        getTransactionsForMonth(year, month) {
            return this.transactions.filter(row => {
                const date = models.parseLocalDate(row.date);
                return date.getFullYear() === year && date.getMonth() === month;
            });
        },
        normalizeTransactionAccountReference: reference => reference || defaultReference,
        findAccountByReference: reference => ({ type: reference.split('-')[0] })
    };
}
function calendar(p, month = '2026-10-01') {
    const currentDate = models.parseLocalDate(month);
    const instance = Object.assign(Object.create(CalendarHeatmap.prototype), {
        plugin: p, currentDate, runningBalanceCache: new Map(),
        transactions: p.getTransactionsForMonth(currentDate.getFullYear(), currentDate.getMonth())
    });
    instance.prepareData();
    return instance;
}
const dailyBalances = instance => Array.from(instance.calendarData, day => day.dayBalance);

test('calendar chart hover uses compact currency while leaving raw day values and details intact', () => {
    const handlers = {};
    let html = '';
    const chain = {};
    for (const method of ['selectAll', 'remove', 'data', 'enter', 'append', 'attr', 'classed', 'text', 'filter', 'transition', 'duration', 'style']) {
        chain[method] = () => chain;
    }
    chain.on = (name, callback) => { handlers[name] = callback; return chain; };
    chain.html = content => { html = content; return chain; };
    const { CalendarHeatmap } = load('src/visualizations/calendar-view.ts', { '../models': models, d3: { select: () => chain } });
    const entry = row('original', '2026-10-15', { amount: 1540.89 });
    const day = { date: models.parseLocalDate(entry.date), dateKey: entry.date, formattedDate: 'Oct 15',
        totalAmount: entry.amount, dayBalance: -entry.amount, transactions: [entry] };
    const original = JSON.stringify(day);
    const p = plugin([entry]);
    p.settings.defaultCurrency = 'CAD';
    const instance = Object.assign(Object.create(CalendarHeatmap.prototype), {
        plugin: p, svg: chain, tooltipDiv: chain, currentDate: models.parseLocalDate('2026-10-01'),
        calendarData: [day], transactions: [entry], maxAmount: entry.amount, cellSize: 30, cellGap: 4,
        getColorScale: () => () => '#fff', renderColorLegend() {}, showDayDetails() {}
    });
    instance.renderCalendar();
    for (const value of [0, 0.49, -0.49, 999.49, 999.5, 1000, 1540.89, -1540.89, 1000000]) {
        handlers.mouseover({ currentTarget: {}, pageX: 10, pageY: 20 }, { ...day, totalAmount: value });
        assert.ok(html.includes(`<div class="tooltip-value">${models.formatCurrency(value, 'CAD', true)}</div>`));
    }
    assert.equal(JSON.stringify(day), original);
    assert.equal(models.formatCurrency(day.dayBalance, 'CAD'), '-$1,540.89');
});

test('programmatic calendar selection reuses the day click and ignores an unchanged selection', () => {
    const first = models.parseLocalDate('2026-10-01');
    const target = models.parseLocalDate('2026-10-15');
    const rows = [{ date: first }, { date: target }, { date: models.parseLocalDate('2026-11-15') }];
    const clicks = [];
    let queries = 0;
    const instance = Object.assign(Object.create(CalendarHeatmap.prototype), {
        selectedDate: first,
        svg: { selectAll(selector) {
            assert.equal(selector, '.day-cell rect');
            queries++;
            return { filter(predicate) {
                return { dispatch(event) {
                    assert.equal(event, 'click');
                    for (const day of rows.filter(predicate)) {
                        clicks.push(models.formatDate(day.date));
                        instance.selectedDate = day.date;
                    }
                } };
            } };
        } }
    });
    instance.selectDate(target);
    instance.selectDate(new Date(target));
    assert.deepEqual(clicks, ['2026-10-15']);
    assert.equal(queries, 1);
});

test('changing calendar month sets the requested selection before rendering', () => {
    const target = models.parseLocalDate('2026-10-15');
    const rows = [];
    let renders = 0;
    const instance = Object.assign(Object.create(CalendarHeatmap.prototype), {
        selectedDate: models.parseLocalDate('2026-09-01'), setupContainers() {},
        render(animate) {
            renders++;
            assert.equal(animate, true);
            assert.equal(this.selectedDate, target);
            assert.equal(this.currentDate, target);
            assert.equal(this.transactions, rows);
        }
    });
    instance.updateMonth(target, rows, target);
    assert.equal(renders, 1);
});

test('empty months carry all prior income and expenses while excluding future transactions', () => {
    const source = [row('future', '2026-12-01', { amount: 999 }),
        row('prior-expense', '2026-09-30', { amount: 25 }),
        row('prior-income', '2026-08-31', { type: 'income', amount: 100 })];
    const p = plugin(source);
    for (const [month, days] of [['2026-10-01', 31], ['2026-11-01', 30]]) {
        const instance = calendar(p, month);
        assert.deepEqual(dailyBalances(instance), Array(days).fill(75));
        assert.ok(instance.calendarData.every(day => day.transactions.length === 0 && day.totalAmount === 0));
        assert.equal(instance.monthlyExpenseTotal, 0);
        assert.equal(instance.maxAmount, 0);
    }
    assert.deepEqual(dailyBalances(calendar(plugin([]))), Array(31).fill(0));
    assert.deepEqual(dailyBalances(calendar(plugin([source[0]]))), Array(31).fill(0));
});

test('days before a late first transaction retain opening balances, including negative and zero balances', () => {
    const p = plugin([row('prior', '2026-09-30', { amount: 15 }),
        row('late-income', '2026-10-20', { type: 'income', amount: 15 }),
        row('last-expense', '2026-10-31', { amount: 5 })]);
    const instance = calendar(p);
    assert.deepEqual(dailyBalances(instance), [...Array(19).fill(-15), ...Array(11).fill(0), -5]);
    assert.equal(instance.monthlyExpenseTotal, 5);
});

test('year and leap-month boundaries include the first and last day, excluding the following month', () => {
    for (const [month, prior, last, next, days] of [
        ['2026-01-01', '2025-12-31', '2026-01-31', '2026-02-01', 31],
        ['2024-02-01', '2024-01-31', '2024-02-29', '2024-03-01', 29]
    ]) {
        const p = plugin([row('opening', `${prior}T23:59:59-12:00`, { type: 'income', amount: 40 }),
            row('first', `${month}T00:00:00+14:00`, { amount: 5 }),
            row('last', `${last}T23:59:59Z`, { amount: 10 }),
            row('next', `${next}T00:00:00+14:00`, { amount: 999 })]);
        const instance = calendar(p, month);
        assert.deepEqual(dailyBalances(instance), [...Array(days - 1).fill(35), 25]);
        assert.deepEqual(ids(instance.calendarData[0].transactions), ['first']);
        assert.deepEqual(ids(instance.calendarData[days - 1].transactions), ['last']);
        assert.equal(instance.monthlyExpenseTotal, 15);
    }
});

test('ISO formats group by the existing local calendar date without timezone conversion or stored-date changes', () => {
    const dates = ['2026-10-01', '2026-10-01T00:10:00Z', '2026-10-01T00:10:00+14:00',
        '2026-10-01T23:50:00-12:00', '2026-10-01T12:34', '2026-10-01T12:34:56.123456',
        '2026-10-01T12:34:56.123Z'];
    const source = [row('opening', '2026-09-30T23:55:00-12:00', { type: 'income', amount: 100 }),
        ...dates.map((date, index) => row(`format-${index}`, date, { amount: index + 1 })),
        row('next-month', '2026-11-01T00:00:00+14:00', { amount: 999 })];
    const before = JSON.stringify(source);
    source.forEach(Object.freeze);
    Object.freeze(source);
    const instance = calendar(plugin(source));
    assert.deepEqual(ids(instance.calendarData[0].transactions), source.slice(1, -1).map(row => row.id));
    instance.calendarData[0].transactions.forEach((row, index) => assert.equal(row, source[index + 1]));
    assert.deepEqual(dailyBalances(instance), Array(31).fill(72));
    assert.equal(instance.calendarData[0].totalAmount, 28);
    assert.equal(instance.monthlyExpenseTotal, 28);
    assert.equal(instance.maxAmount, 28);
    assert.equal(JSON.stringify(source), before);
});

test('DST transition days retain their calendar groups and carried balances', () => {
    if (process.env.EXPENSICA_CALENDAR_TZ_CHILD) {
        assert.equal(new Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.TZ);
    }
    for (const [month, prior, days] of [
        ['2026-03-01', '2026-02-28', ['2026-03-07T23:59:59-07:00', '2026-03-08T03:00:00-06:00', '2026-03-09']],
        ['2026-11-01', '2026-10-31', ['2026-11-01T01:30:00-06:00', '2026-11-01T01:30:00-07:00', '2026-11-02']]
    ]) {
        const source = [row('opening', prior, { type: 'income', amount: 100 }),
            ...days.map((date, index) => row(`dst-${index}`, date))];
        const instance = calendar(plugin(source), month);
        let expected = 100;
        for (const day of instance.calendarData) {
            const matching = source.slice(1).filter(row => dayKey(row) === day.dateKey);
            expected -= matching.length * 10;
            assert.deepEqual(ids(day.transactions), matching.map(row => row.id));
            assert.equal(day.dayBalance, expected);
        }
    }
});

test('opening and daily balances agree across views for debit, savings, credit and transfers', () => {
    const source = [row('income', '2026-09-29', { type: 'income', amount: 200 }),
        row('expense', '2026-09-30', { amount: 40 }),
        row('savings', '2026-09-30', { type: 'income', amount: 100, account: 'saving-reserve' }),
        row('credit-expense', '2026-09-30', { amount: 60, account: 'credit-card' }),
        row('payment', '2026-09-30T23:50:00Z', { time: '23:50:00', type: 'internal', amount: 25,
            fromAccount: 'chequing-cash', toAccount: 'credit-card' }),
        row('save', '2026-10-20T00:05:00+14:00', { type: 'internal', amount: 30,
            fromAccount: 'chequing-cash', toAccount: 'saving-reserve' }),
        row('pay-from-savings', '2026-10-21', { type: 'internal', amount: 10,
            fromAccount: 'saving-reserve', toAccount: 'credit-card' }),
        row('card-purchase', '2026-10-22', { amount: 5, account: 'credit-card' }),
        row('card-income', '2026-10-23', { type: 'income', amount: 2, account: 'credit-card' }),
        row('cash-purchase', '2026-10-24', { amount: 5 }),
        row('savings-income', '2026-10-25', { type: 'income', amount: 3, account: 'saving-reserve' }),
        row('future', '2026-11-01', { amount: 999 })];
    for (const [reference, opening, final] of [
        ['chequing-cash', 135, 100], ['saving-reserve', 100, 123], ['credit-card', 35, 28]
    ]) {
        const p = plugin(source, reference);
        const instance = calendar(p);
        const calendarBalances = instance.getRunningBalanceMap(reference);
        for (const view of [dashboard, transactions]) {
            const rows = models.sortTransactionsByDateTimeDesc(source, source).map(row => ({ ...row }));
            assert.deepEqual({ ...view.getRunningBalanceByTransactionIdForAccount(p, reference, rows) }, { ...calendarBalances });
        }
        const chronological = models.sortTransactionsByDateTimeDesc(source, source).reverse();
        let expected = opening;
        for (const day of instance.calendarData) {
            for (const row of chronological.filter(row => dayKey(row) === day.dateKey)) expected = calendarBalances[row.id];
            assert.equal(day.dayBalance, expected, `${reference} ${day.dateKey}`);
        }
        assert.equal(instance.calendarData[0].dayBalance, opening);
        assert.equal(instance.calendarData[30].dayBalance, final);
    }
});

test('repeated preparation preserves canonical ties and refreshes cached balances when the ledger changes', () => {
    const source = [row('opening', '2026-09-30', { type: 'income', amount: 100 }),
        row('equal-first', '2026-10-20T12:00:00Z', { amount: 7 }),
        row('equal-last', '2026-10-20', { amount: 3 })];
    const original = JSON.stringify(source);
    const p = plugin(source);
    const instance = calendar(p);
    const expected = JSON.stringify(instance.calendarData);
    for (let attempt = 0; attempt < 3; attempt++) {
        instance.transactions.reverse();
        instance.prepareData();
        assert.deepEqual(dailyBalances(instance), [...Array(19).fill(100), ...Array(12).fill(90)]);
        assert.deepEqual({ ...instance.getRunningBalanceMap('chequing-cash') }, { opening: 100, 'equal-last': 97, 'equal-first': 90 });
    }
    instance.transactions = p.getTransactionsForMonth(2026, 9);
    instance.prepareData();
    assert.equal(JSON.stringify(instance.calendarData), expected);
    p.transactions = [...source, row('new', '2026-10-31', { amount: 5 })];
    instance.transactions = p.getTransactionsForMonth(2026, 9);
    instance.prepareData();
    assert.equal(instance.calendarData[30].dayBalance, 85);
    assert.equal(instance.getRunningBalanceMap('chequing-cash').new, 85);
    assert.equal(JSON.stringify(source), original);
});

if (!process.env.EXPENSICA_CALENDAR_TZ_CHILD) {
    test('calendar balances and ISO grouping are invariant in Denver, Kiritimati, Honolulu and UTC', () => {
        for (const timezone of ['America/Denver', 'Pacific/Kiritimati', 'Pacific/Honolulu', 'UTC']) {
            const env = { ...process.env, TZ: timezone, EXPENSICA_CALENDAR_TZ_CHILD: '1' };
            delete env.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', __filename], { env, encoding: 'utf8', timeout: 20000 });
            assert.equal(child.error, undefined, child.error?.message);
            assert.equal(child.status, 0, `${timezone}\n${child.stdout}\n${child.stderr}`);
        }
    });
}
