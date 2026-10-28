const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

function load(filename, dependencies = {}, globals = {}) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, console, ...globals, require: name => dependencies[name] || {} });
    return exports;
}
const models = load('src/models.ts');
const { BudgetPeriod: Period, calculateBudgetStatus: status, getBudgetPeriodDates: dates, parseLocalDate: date } = models;
const budget = fields => ({ id: 'budget', categoryId: 'food', amount: 100, period: Period.MONTHLY,
    rollover: false, lastUpdated: '2026-10-27T12:00:00Z', ...fields });
const row = (id, date, amount = 10, fields = {}) => ({ id, date, amount, time: '12:00:00',
    type: 'expense', category: 'food', description: 'ENTRY', ...fields });
const plain = value => JSON.parse(JSON.stringify(value));

test('budget period boundaries cover complete monthly, quarterly and yearly calendar periods', () => {
    for (const [period, anchor, first, last] of [
        [Period.MONTHLY, '2024-02-15', '2024-02-01', '2024-02-29'],
        [Period.MONTHLY, '2026-11-01', '2026-11-01', '2026-11-30'],
        [Period.QUARTERLY, '2025-12-31', '2025-10-01', '2025-12-31'],
        [Period.QUARTERLY, '2026-04-01', '2026-04-01', '2026-06-30'],
        [Period.YEARLY, '2024-10-15', '2024-01-01', '2024-12-31']
    ]) {
        const selected = date(anchor);
        const original = selected.getTime();
        const { startDate, endDate } = dates(period, selected);
        assert.equal(models.formatDate(startDate), first);
        assert.equal(models.formatDate(endDate), last);
        assert.equal(startDate.getHours(), 0);
        assert.equal(endDate.getHours(), 23);
        assert.equal(endDate.getMilliseconds(), 999);
        assert.equal(selected.getTime(), original);
    }
});

test('spending includes full historical periods and date-only or ISO boundary transactions only', () => {
    const source = [row('previous-year', '2024-12-31', 999), row('first', '2025-01-01T00:00:00+14:00', 10),
        row('february', '2025-02-15', 20), row('march-end', '2025-03-31T23:59:59-12:00', 30),
        row('next-quarter', '2025-04-01', 40), row('year-end', '2025-12-31T23:59:59Z', 50),
        row('next-year', '2026-01-01', 999), row('income', '2025-02-15', 999, { type: 'income' }),
        row('transfer', '2025-02-15', 999, { type: 'internal' }),
        row('other-category', '2025-02-15', 999, { category: 'rent' })];
    assert.equal(status(budget({ period: Period.MONTHLY }), source, date('2025-02-27')).spent, 20);
    assert.equal(status(budget({ period: Period.QUARTERLY }), source, date('2025-02-27')).spent, 60);
    assert.equal(status(budget({ period: Period.YEARLY }), source, date('2025-02-27')).spent, 150);
    assert.equal(status(budget({ period: Period.MONTHLY }), source, date('2024-02-01')).spent, 0);
});

test('empty periods and overspending retain bounded remaining amounts and percentages', () => {
    assert.deepEqual(plain(status(budget(), [], date('2025-01-15'))), { spent: 0, remaining: 100, percentage: 0, available: 100, rolloverAmount: 0 });
    assert.deepEqual(plain(status(budget(), [row('over', '2025-01-15', 150)], date('2025-01-15'))),
        { spent: 150, remaining: 0, percentage: 100, available: 100, rolloverAmount: 0 });
    assert.deepEqual(plain(status(budget({ amount: 0 }), [], date('2025-01-15'))), { spent: 0, remaining: 0, percentage: 0, available: 0, rolloverAmount: 0 });
});

test('current budget edits apply consistently without changing ledger values or inventing historical definitions', () => {
    const source = Object.freeze([Object.freeze(row('expense', '2025-02-10', 40))]);
    const original = JSON.stringify(source);
    const entry = Object.freeze(budget());
    for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal(status(entry, source, date('2025-02-15')).remaining, 60);
        assert.equal(status({ ...entry, amount: 200 }, source, date('2025-02-15')).remaining, 160);
        assert.equal(status({ ...entry, categoryId: 'rent' }, source, date('2025-02-15')).spent, 0);
    }
    assert.equal(JSON.stringify(source), original);
});

for (const [period, start, middle, selected, prior] of [
    [Period.MONTHLY, '2025-12-01', '2026-01-01', '2026-02-15', '2025-11-30'],
    [Period.QUARTERLY, '2025-10-01', '2026-01-01', '2026-05-15', '2025-09-30'],
    [Period.YEARLY, '2024-01-01', '2025-01-01', '2026-06-15', '2023-12-31']
]) {
    test(`${period} rollover carries only unused funds across consecutive periods and year boundaries`, () => {
        const entry = budget({ period, rollover: true, rolloverStartDate: start });
        const source = [row('before-start', prior, 9999), row('first-period', `${start}T23:59:59-12:00`, 40),
            row('second-period', middle, 30), row('selected-period', selected, 20)];
        const result = status(entry, source, date(selected));
        assert.deepEqual(plain(result), { spent: 20, remaining: 210, percentage: 20 / 230 * 100, available: 230, rolloverAmount: 130 });
        assert.equal(status({ ...entry, rollover: false }, source, date(selected)).remaining, 80);
        assert.equal(status(entry, source, date(start)).rolloverAmount, 0);
        assert.equal(status(entry, source, date(prior)).rolloverAmount, 0);
    });
}

test('empty consecutive periods accrue unused funds from the explicit start only', () => {
    const entry = budget({ rollover: true, rolloverStartDate: '2026-01-15' });
    assert.equal(status(entry, [], date('2026-01-01')).available, 100);
    assert.equal(status(entry, [], date('2026-04-15')).available, 400);
    assert.equal(status(entry, [], date('2025-12-31')).available, 100);
    assert.equal(status({ ...entry, amount: 0 }, [], date('2026-04-15')).available, 0);
});

test('overspending consumes accumulated unused funds without carrying debt', () => {
    const entry = budget({ rollover: true, rolloverStartDate: '2026-01-01' });
    const source = [row('january', '2026-01-15', 40), row('february', '2026-02-15', 200),
        row('march', '2026-03-15', 20)];
    assert.equal(status(entry, source, date('2026-02-15')).rolloverAmount, 60);
    assert.equal(status(entry, source, date('2026-02-15')).remaining, 0);
    assert.equal(status(entry, source, date('2026-03-15')).available, 100);
    assert.equal(status(entry, source, date('2026-03-15')).remaining, 80);
});

test('legacy rollover flags and invalid dates never infer historical funds from lastUpdated', () => {
    const source = [row('prior', '2020-01-01', 40), row('selected', '2026-10-02', 20)];
    for (const rolloverStartDate of [undefined, '', '2026-02-31', '0000-01-01', '2026-01-01T00:00:00Z', 42]) {
        const entry = budget({ rollover: true, rolloverStartDate, lastUpdated: '2020-01-01T00:00:00Z' });
        assert.equal(status(entry, source, date('2026-10-15')).available, 100);
    }
});

test('edited definitions reset from the chosen period rather than recalculating unknown earlier limits', () => {
    const source = Object.freeze([Object.freeze(row('january', '2026-01-15', 40)),
        Object.freeze(row('april', '2026-04-15', 20))]);
    const original = Object.freeze(budget({ rollover: true, rolloverStartDate: '2026-01-01' }));
    assert.equal(status(original, source, date('2026-04-15')).available, 360);
    const edited = { ...original, amount: 200, rolloverStartDate: '2026-04-01' };
    assert.equal(status(edited, source, date('2026-04-15')).available, 200);
    assert.equal(status(edited, source, date('2026-05-15')).available, 380);
    assert.equal(status(edited, source, date('2026-03-15')).rolloverAmount, 0);
    assert.equal(status({ ...edited, rollover: false }, source, date('2026-05-15')).available, 200);
    assert.deepEqual(plain(status(JSON.parse(JSON.stringify(edited)), source, date('2026-05-15'))), plain(status(edited, source, date('2026-05-15'))));
});

class Element {
    constructor(options = {}) {
        if (typeof options === 'string') options = { cls: options };
        this.children = [];
        this.classes = new Set((options.cls || '').split(' '));
        this.textContent = options.text || '';
        this.style = {};
    }
    createEl(tag, options) { const child = new Element(options); this.children.push(child); return child; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    appendChild(child) { this.children.push(child); }
    addClass(name) { this.classes.add(name); }
    setText(value) { this.textContent = value; }
    setAttribute() {}
    addEventListener() {}
    querySelector(selector) {
        return this.children.find(child => child.classes.has(selector.slice(1)))
            || this.children.map(child => child.querySelector(selector)).find(Boolean);
    }
}
const renderedCards = [];
let calculations = 0;
const { ExpensicaDashboardView } = load('src/dashboard-view.ts', {
    obsidian: { ItemView: class {}, Modal: class {} },
    './models': { ...models, calculateBudgetStatus(...args) { calculations++; return status(...args); } },
    'chart.js': { Tooltip: { positioners: {} } },
    './budget-cards': { renderBudgetCard(container, options) { renderedCards.push(options); } }
}, { document: { createElement: () => new Element(), createTextNode: text => new Element({ text }) } });

function view(source, entries, start, end = start) {
    return Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: { settings: { defaultCurrency: 'USD' }, getAllBudgets: () => entries,
            getAllTransactions: () => [...source], getCategoryById: id => ({ id, name: id }),
            getCategoryEmoji: () => '', getCategoryColor: () => '' },
        transactions: [], dateRange: { startDate: date(start), endDate: date(end) },
        formatBudgetCurrency: value => String(value)
    });
}

test('dashboard summary and details ignore filtered rows and use full periods anchored to the selected range end', () => {
    const source = [row('early', '2025-10-02', 40), row('late', '2025-10-31', 10),
        row('quarter-start', '2025-07-01', 15), row('year-start', '2025-01-01', 20)];
    const entries = [budget(), budget({ id: 'q', period: Period.QUARTERLY }), budget({ id: 'y', period: Period.YEARLY })];
    for (const start of ['2025-10-15', '2025-10-01', '2025-09-30']) {
        const instance = view(source, entries, start, '2025-10-15');
        for (const filtered of [[], source.slice(0, 1), source]) {
            instance.transactions = filtered;
            renderedCards.length = 0;
            const summary = new Element();
            instance.renderBudgetSummary(summary);
            instance.renderBudgetList(new Element());
            assert.equal(summary.querySelector('.expensica-budget').textContent, '300');
            assert.equal(summary.querySelector('.expensica-expense').textContent, '185');
            assert.equal(summary.querySelector('.expensica-budget-remaining').textContent, '115');
            assert.deepEqual(renderedCards.map(card => [card.spent, card.remaining]), [[50, 50], [50, 50], [85, 15]]);
        }
    }
});

test('summary remaining equals the sum of detail remaining when one category overspends', () => {
    const instance = view([row('over', '2025-10-02', 150)], [budget(), budget({ id: 'rent', categoryId: 'rent' })], '2025-10-15');
    const summary = new Element();
    instance.renderBudgetSummary(summary);
    renderedCards.length = 0;
    instance.renderBudgetList(new Element());
    assert.equal(Number(summary.querySelector('.expensica-budget-remaining').textContent),
        renderedCards.reduce((total, card) => total + card.remaining, 0));
});

test('rollover summary and cards use the same available funds, spending and remaining', () => {
    const source = [row('prior', '2025-09-15', 40), row('selected', '2025-10-02', 20)];
    const entry = budget({ rollover: true, rolloverStartDate: '2025-09-01' });
    const instance = view(source, [entry], '2025-10-15');
    const summary = new Element();
    instance.renderBudgetSummary(summary);
    renderedCards.length = 0;
    instance.renderBudgetList(new Element());
    assert.equal(summary.querySelector('.expensica-budget').textContent, '160');
    assert.equal(summary.querySelector('.expensica-expense').textContent, '20');
    assert.equal(summary.querySelector('.expensica-budget-remaining').textContent, '140');
    assert.equal(renderedCards[0].available, 160);
    assert.equal(renderedCards[0].remaining, 140);
    assert.equal(renderedCards[0].percentage, 12.5);
    const budgetCards = load('src/budget-cards.ts', { './models': models });
    const card = budgetCards.renderBudgetCard(new Element(), renderedCards[0]);
    assert.equal(card.querySelector('.expensica-budget-card-value').textContent, '$160.00');
    const legacy = view(source, [{ ...entry, rolloverStartDate: undefined }], '2025-10-15');
    renderedCards.length = 0;
    legacy.renderBudgetList(new Element());
    assert.equal(renderedCards[0].statusText, 'Set rollover start');
});

test('budget tab calculates each status once and reuses it for summary and detail cards', () => {
    const entries = [budget(), budget({ id: 'quarterly', period: Period.QUARTERLY })];
    const instance = view([row('spent', '2025-10-02', 40)], entries, '2025-10-15');
    calculations = 0;
    instance.renderBudgetTab(new Element());
    assert.equal(calculations, entries.length);
});

if (!process.env.EXPENSICA_BUDGET_TZ_CHILD) {
    test('budget boundaries and historical spending remain consistent across timezones', () => {
        for (const timezone of ['America/Denver', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
            const env = { ...process.env, TZ: timezone, EXPENSICA_BUDGET_TZ_CHILD: '1' };
            delete env.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=budget period boundaries|spending includes|rollover carries|empty consecutive|overspending consumes', __filename], {
                env, encoding: 'utf8', timeout: 20000
            });
            assert.equal(child.error, undefined, child.error?.message);
            assert.equal(child.status, 0, `${timezone}\n${child.stdout}\n${child.stderr}`);
        }
    });
}
