const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
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
const { sortTransactionsByDateTimeDesc: sort, getRunningBalanceByTransactionId: balances } = models;
const ids = rows => Array.from(rows, row => row.id);
const row = (id, time, fields = {}) => ({ id, date: '2026-10-15', time, amount: 10,
    type: 'expense', description: 'ENTRY', category: 'food', account: 'chequing-cash', ...fields });
const mixed = () => [row('evening', '17:00:00'), row('untimed-first'), row('morning', '09:00:00'),
    row('equal-first', '17:00:00'), row('untimed-last'), row('midnight', '00:00:00')];

test('mixed times sort by date descending, time descending, then untimed last', () => {
    const source = [row('older', '23:59:59', { date: '2026-10-14' }), ...mixed(),
        row('newer', undefined, { date: '2026-10-16' })];
    assert.deepEqual(ids(sort(source, source)), ['newer', 'evening', 'equal-first', 'morning',
        'midnight', 'untimed-last', 'untimed-first', 'older']);
});

test('canonical source order breaks ties for shuffled subsets and cloned rows', () => {
    const source = mixed();
    const shuffled = [source[3], source[1], source[4], source[0]].map(row => ({ ...row }));
    assert.deepEqual(ids(sort(shuffled, source)), ['evening', 'equal-first', 'untimed-last', 'untimed-first']);
    // Equal timed entries keep source order; untimed entries retain newest-insertion-first semantics.
    assert.deepEqual(ids(sort([source[3], source[0]], source)), ['evening', 'equal-first']);
    assert.deepEqual(ids(sort([source[4], source[1]], source)), ['untimed-last', 'untimed-first']);
});

test('explicit times override ID times and valid ID-derived times retain existing fallback rules', () => {
    const source = [
        row('20200101-230000-explicit', '01:00:00'),
        row('20200101-120000-recovered'),
        row('20200101-130000-invalid-explicit', 'invalid'),
        row('20200101-240000-invalid-id'),
        row('opaque-legacy-id'),
        row('20200101-140000-override', '18:00:00'),
        row('newer-date', '00:00:00', { date: '2026-10-16T23:45:00Z' })
    ];
    assert.deepEqual(ids(sort(source, source)), [source[6].id, source[5].id, source[2].id,
        source[1].id, source[0].id, source[4].id, source[3].id]);
});

test('repeated sorts and balance calculations are idempotent without mutating source data', () => {
    const source = mixed();
    const before = JSON.stringify(source);
    source.forEach(Object.freeze);
    Object.freeze(source);
    let sorted = sort(source, source);
    const expected = ids(sorted);
    const expectedBalances = { ...balances(source, source) };
    for (let attempt = 0; attempt < 5; attempt++) {
        sorted = sort(sorted, source);
        assert.deepEqual(ids(sorted), expected);
        assert.deepEqual({ ...balances(sorted, source) }, expectedBalances);
        assert.deepEqual(ids(sort([...sorted].reverse(), source)), expected);
    }
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(ids(sort([], source)), []);
    assert.deepEqual(ids(sort([source[1]], source)), [source[1].id]);
});

test('pair ordering is antisymmetric and transitive for all mixed timestamp triples', () => {
    const source = [...mixed(), row('older', '23:59:59', { date: '2026-10-14' }),
        row('20200101-090000-recovered')];
    const before = (a, b) => sort([a, b], source)[0].id === a.id;
    for (const a of source) for (const b of source) {
        if (a === b) continue;
        assert.notEqual(before(a, b), before(b, a), `${a.id}, ${b.id}`);
        for (const c of source) {
            if (c === a || c === b) continue;
            if (before(a, b) && before(b, c)) assert.equal(before(a, c), true, `${a.id}, ${b.id}, ${c.id}`);
        }
    }
});

test('every permutation produces the same total order', () => {
    const source = mixed().slice(0, 5);
    const expected = ['evening', 'equal-first', 'morning', 'untimed-last', 'untimed-first'];
    function check(prefix, remaining) {
        if (!remaining.length) return assert.deepEqual(ids(sort(prefix, source)), expected);
        remaining.forEach((row, index) => check([...prefix, row], remaining.filter((_, i) => i !== index)));
    }
    check([], source);
});

class Element {
    constructor() { this.classList = new Set(); }
    createDiv() { return new Element(); }
    createEl() { return new Element(); }
    createSpan() { return new Element(); }
    addClass() {}
    setAttribute() {}
    querySelector() { return null; }
    empty() {}
}
const cards = [];
const transactionCards = { renderTransactionCard(container, options) {
    cards.push([options.transaction.id, options.runningBalanceLabel]);
    return new Element();
} };
const obsidian = { Modal: class {}, ItemView: class {} };
const dashboard = load('src/dashboard-view.ts', { './models': models, obsidian,
    'chart.js': { Tooltip: { positioners: {} } }, './transaction-card': transactionCards
}, '\nexport { getRunningBalanceByTransactionIdForAccount };');
const transactions = load('src/transactions-view.ts', { './models': models, obsidian,
    './dashboard-view': dashboard
}, '\nexport { getRunningBalanceByTransactionIdForAccount };');
const calendar = load('src/visualizations/calendar-view.ts', { '../models': models, '../transaction-card': transactionCards },
    '\nexport { getRunningBalanceByTransactionIdForAccount };');

function plugin(source) {
    return {
        settings: { enableAccounts: true, defaultCurrency: 'USD' },
        getAllTransactions: () => [...source],
        normalizeTransactionAccountReference: reference => reference || 'chequing-cash',
        findAccountByReference: reference => ({ type: reference === 'credit-card' ? 'credit' : 'chequing' })
    };
}

test('all view balance helpers agree after sorting, reversing, cloning and repeated calculations', () => {
    const source = [row('evening', '17:00:00', { amount: 7 }),
        row('untimed-first', undefined, { type: 'income', amount: 100 }),
        row('morning', '09:00:00', { amount: 5 }),
        row('equal', '17:00:00', { amount: 3 }),
        row('untimed-last', undefined, { amount: 2 }),
        row('transfer', '12:00:00', { type: 'internal', amount: 10, fromAccount: 'chequing-cash', toAccount: 'credit-card' }),
        row('card-expense', '13:00:00', { amount: 20, account: 'credit-card' })];
    const p = plugin(source);
    const expectedCash = { 'untimed-first': 100, 'untimed-last': 98, morning: 93,
        transfer: 83, 'card-expense': 83, equal: 80, evening: 73 };
    const expectedCard = { 'untimed-first': 0, 'untimed-last': 0, morning: 0,
        transfer: -10, 'card-expense': 10, equal: 10, evening: 10 };
    for (const view of [dashboard, transactions, calendar]) {
        for (const rows of [source, sort(source, source), [...source].reverse().map(row => ({ ...row }))]) {
            assert.deepEqual({ ...view.getRunningBalanceByTransactionIdForAccount(p, 'chequing-cash', rows) }, expectedCash);
            assert.deepEqual({ ...view.getRunningBalanceByTransactionIdForAccount(p, 'credit-card', rows) }, expectedCard);
        }
    }
});

test('dashboard, Transactions and calendar render the same order and balances on repeated renders', async () => {
    const source = [row('opening', '12:00:00', { date: '2026-10-14', type: 'income', amount: 100 }), ...mixed()];
    const original = JSON.stringify(source);
    const p = plugin(source);
    const visible = source.slice(1).reverse().map(row => ({ ...row }));
    const expected = [['evening', '$40.00'], ['equal-first', '$50.00'], ['morning', '$60.00'],
        ['midnight', '$70.00'], ['untimed-last', '$80.00'], ['untimed-first', '$90.00']];
    const overview = Object.assign(Object.create(dashboard.ExpensicaDashboardView.prototype), {
        plugin: p, transactions: visible, selectedTransactionIds: new Set(),
        renderViewAllTransactionsButton() {}, renderTransactionBulkFooter() {}, renderTransactionGroupTitle() {}
    });
    const list = Object.assign(Object.create(transactions.ExpensicaTransactionsView.prototype), {
        plugin: p, selectedAccountReferences: [], applyFilters() {}, renderTransactionGroupTitle() {},
        renderTransactionCardWithEditHandler(container, transaction, label) { cards.push([transaction.id, label]); }
    });
    const heatmap = Object.assign(Object.create(calendar.CalendarHeatmap.prototype), {
        plugin: p, transactions: visible, currentDate: new Date(2026, 9, 1),
        runningBalanceCache: new Map(), detailsContainer: new Element()
    });
    for (let attempt = 0; attempt < 2; attempt++) {
        cards.length = 0;
        overview.renderTransactions(new Element());
        assert.deepEqual(cards, expected);
        cards.length = 0;
        await list.loadTransactionsData();
        assert.deepEqual(ids(list.transactions), [...expected.map(([id]) => id), 'opening']);
        list.renderTransactionsToContainer(new Element(), list.transactions.filter(row => row.id !== 'opening'));
        assert.deepEqual(cards, expected);
        cards.length = 0;
        heatmap.prepareData();
        const day = heatmap.calendarData.find(day => day.dateKey === '2026-10-15');
        assert.equal(day.dayBalance, 40);
        heatmap.monthlyExpenseTotal = 0;
        heatmap.showDayDetails(day);
        assert.deepEqual(cards, expected);
    }
    assert.equal(JSON.stringify(source), original);
});
