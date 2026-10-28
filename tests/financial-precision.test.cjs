const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename, dependencies = {}, extraSource = '') {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extraSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, console, require: name => dependencies[name] || {} });
    return exports;
}
const models = load('src/models.ts');
const cards = [];
const exposed = '\nexport { getRunningBalanceByTransactionIdForAccount, formatRunningBalanceLabel };';
const dashboard = load('src/dashboard-view.ts', {
    './models': models, obsidian: { Modal: class {}, ItemView: class {} },
    'chart.js': { Tooltip: { positioners: {} } },
    './account-card': { renderAccountCard(container, options) { cards.push(options); },
        renderCreateAccountCard() {}, getLastAccountTransaction: rows => rows[0] }
}, exposed + '\nexport { getAccountRunningBalance };');
const transactions = load('src/transactions-view.ts', { './models': models,
    './dashboard-view': dashboard, obsidian: { Modal: class {} } }, exposed);
const calendar = load('src/visualizations/calendar-view.ts', { '../models': models }, exposed);
const views = [dashboard, transactions, calendar];
const end = new Date(2026, 9, 31, 23, 59, 59, 999);
const row = (index, amount, type = 'income', account = 'chequing-cash', date = '2026-10-15') => ({
    id: `20261015-120000-${index.toString(16).padStart(8, '0')}`, date, time: '12:00:00',
    amount, type, account, description: 'ENTRY', category: type === 'income' ? 'salary' : 'food'
});
function plugin(source, type = 'chequing') {
    const account = { id: 'cash', type, name: 'Cash', isDefault: true, createdAt: '2026-01-01' };
    const reference = models.formatAccountReference(type, account.name);
    return {
        settings: { enableAccounts: true, defaultCurrency: 'USD' },
        getAllTransactions: () => [...source], getAccounts: () => [account],
        getTransactionAccountDisplay: () => account,
        normalizeTransactionAccountReference: value => value || reference,
        findAccountByReference: value => value === reference ? account : null
    };
}
function overview(p, source) {
    return Object.assign(Object.create(dashboard.ExpensicaDashboardView.prototype), {
        plugin: p, transactions: source,
        dateRange: { startDate: new Date(2026, 9, 1), endDate: end }
    });
}
function heatmap(p, source) {
    const instance = Object.assign(Object.create(calendar.CalendarHeatmap.prototype), {
        plugin: p, transactions: source.filter(row => row.date.startsWith('2026-10')),
        currentDate: new Date(2026, 9, 1), runningBalanceCache: new Map()
    });
    instance.prepareData();
    return instance;
}
function close(actual, expected) {
    assert.ok(Math.abs(actual - expected) < Math.max(1e-12, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);
}

for (const type of ['chequing', 'saving', 'credit']) for (const kind of ['income', 'expense']) {
    test(`20,000 sub-micro-unit ${kind} amounts retain one cent across ${type} account views`, () => {
        const reference = `${type}-cash`;
        const source = Array.from({ length: 20000 }, (_, i) => Object.freeze(row(i, 0.0000005, kind, reference)));
        Object.freeze(source);
        const original = JSON.stringify(source);
        const p = plugin(source, type);
        const amount = source.reduce((sum, row) => sum + row.amount, 0);
        close(amount, 0.01);
        const expected = (kind === 'income' ? 1 : -1) * (type === 'credit' ? -1 : 1) * amount;
        for (const view of views) {
            const balances = view.getRunningBalanceByTransactionIdForAccount(p, reference, source);
            assert.equal(balances[source[source.length - 1].id], Math.sign(expected) * 0.0000005);
            assert.equal(balances[source[0].id], expected);
            assert.equal(view.formatRunningBalanceLabel(p, balances[source[0].id]), expected < 0 ? '-$0.01' : '$0.01');
        }
        const instance = overview(p, source);
        assert.equal(dashboard.getAccountRunningBalance(p, reference, source), expected);
        assert.equal(instance.getDefaultAccountBalanceThrough(end), expected);
        assert.equal(instance.getAccountBalanceThroughDateTime(reference, end), expected);
        assert.equal(instance.getNetBalanceThrough(end), type === 'credit' ? -expected : expected);
        assert.equal(heatmap(p, source).calendarData[30].dayBalance, expected);
        cards.length = 0;
        instance.renderAccountsTab({ createDiv() { return this; } });
        assert.equal(cards[0].runningBalance, expected);
        const list = Object.assign(Object.create(transactions.ExpensicaTransactionsView.prototype), { filteredTransactions: source });
        assert.equal(list.getFilteredTransactionTotals()[kind === 'income' ? 'income' : 'expenses'], amount);
        assert.equal(models.TransactionAggregator[kind === 'income' ? 'getTotalIncome' : 'getTotalExpenses'](source), amount);
        assert.equal(JSON.stringify(source), original, 'calculations preserve every stored field, amount, ID, and source position');
    });
}

test('tiny partial balances remain raw and cancellation cleanup happens only when formatting', () => {
    const source = [row(1, 0.3), row(2, 0.2, 'expense'), row(3, 0.1, 'expense')];
    const original = JSON.stringify(source);
    const p = plugin(source);
    const chronological = [...source].reverse();
    const expected = chronological.reduce((sum, row) => sum + (row.type === 'income' ? row.amount : -row.amount), 0);
    assert.notEqual(expected, 0, 'fixture retains a negative floating-point cancellation residue');
    for (const view of views) {
        const balances = view.getRunningBalanceByTransactionIdForAccount(p, 'chequing-cash', source);
        assert.equal(balances[source[0].id], expected);
        assert.equal(view.formatRunningBalanceLabel(p, expected), '$0.00');
        assert.equal(view.formatRunningBalanceLabel(p, -0.0000005), '$0.00');
        assert.equal(view.formatRunningBalanceLabel(p, 0.0000005), '$0.00');
        assert.equal(view.formatRunningBalanceLabel(p, -0.000001), '-$0.00', 'preserve the existing cleanup threshold');
    }
    assert.equal(models.formatCurrency(expected, 'USD'), '$0.00');
    close(overview(p, source).getNetBalanceThrough(end), models.TransactionAggregator.getBalance(source));
    assert.equal(JSON.stringify(source), original);
    const tiny = [row(4, 0.0000011), row(5, 0.0000006, 'expense')];
    const tinyPlugin = plugin(tiny);
    for (const view of views) {
        assert.equal(view.getRunningBalanceByTransactionIdForAccount(tinyPlugin, 'chequing-cash', tiny)[tiny[0].id], 0.0000011 - 0.0000006);
    }
    assert.equal(dashboard.getAccountRunningBalance(tinyPlugin, 'chequing-cash', tiny), 0.0000011 - 0.0000006);
});

test('long cent sums retain raw values consistently and do not rewrite the ledger', () => {
    const source = Object.freeze(Array.from({ length: 100000 }, (_, i) => Object.freeze(row(i, 0.01))));
    const original = JSON.stringify(source);
    const p = plugin(source);
    const expected = models.TransactionAggregator.getTotalIncome(source);
    close(expected, 1000);
    for (const view of views) {
        const balance = view.getRunningBalanceByTransactionIdForAccount(p, 'chequing-cash', source)[source[0].id];
        assert.equal(balance, expected);
        assert.equal(view.formatRunningBalanceLabel(p, balance), '$1,000.00');
    }
    assert.equal(dashboard.getAccountRunningBalance(p, 'chequing-cash', source), expected);
    assert.equal(JSON.stringify(source), original);
});

for (const enableAccounts of [true, false]) {
    test(`chart buckets carry raw tiny balances across buckets (accounts enabled: ${enableAccounts})`, () => {
        const source = Array.from({ length: 20000 }, (_, i) => row(i, 0.0000005, 'expense', 'chequing-cash', i ? '2026-10-15' : '2026-09-30'));
        const original = JSON.stringify(source);
        const p = plugin(source);
        p.settings.enableAccounts = enableAccounts;
        const instance = overview(p, source);
        instance.dateRange.startDate = new Date(2026, 8, 30);
        const buckets = instance.getIncomeExpenseChartBuckets();
        assert.equal(buckets[0].accountBalances['chequing-cash'], -0.0000005);
        const last = buckets[buckets.length - 1];
        const expected = -models.TransactionAggregator.getTotalExpenses(source);
        assert.equal(last.accountBalances['chequing-cash'], expected);
        assert.equal(last.net, expected);
        close(buckets.reduce((sum, bucket) => sum + bucket.expenses, 0), -expected);
        const monthly = heatmap(p, source);
        assert.equal(monthly.calendarData[0].dayBalance, -0.0000005, 'calendar keeps the raw prior-month opening balance');
        assert.equal(monthly.calendarData[30].dayBalance, expected);
        assert.equal(JSON.stringify(source), original);
    });
}
