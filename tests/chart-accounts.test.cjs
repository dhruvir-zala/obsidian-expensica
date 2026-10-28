const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');

function load(file, dependencies = {}, source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')) {
    const exports = {};
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
    } }).outputText;
    vm.runInNewContext(code, { exports, Date, Intl, console, require: name => dependencies[name] || {} });
    return exports;
}
const obsidian = { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, ItemView: class {} };
const models = load('src/models.ts');
const Plugin = load('main.ts', { './src/models': models, obsidian }).default;
class Chart {
    constructor(canvas, config) { this.config = config; this.data = config.data; }
    destroy() {}
}
function dashboard(source) {
    return load('src/dashboard-view.ts', { obsidian, './models': models,
        'chart.js': { Tooltip: { positioners: {} } }, 'chart.js/auto': { default: Chart }
    }, (source ?? fs.readFileSync(path.join(__dirname, '../src/dashboard-view.ts'), 'utf8'))
        + '\nexport { getAccountTransactionAmount };');
}
const current = dashboard();
const row = (id, fields = {}) => ({ id, date: '2026-09-15', time: '12:00:00', type: 'income', amount: 1.234,
    description: 'ENTRY', category: 'salary', account: 'chequing-cash0', ...fields });
function fixture(count = 100, accountCount = 20) {
    const accounts = Array.from({ length: accountCount }, (_, i) => ({ id: `a${i}`, name: `Cash${i}`,
        type: i === 0 ? 'chequing' : i % 3 === 0 ? 'credit' : 'saving', isDefault: i === 0, createdAt: '2026-01-01' }));
    const source = Array.from({ length: count }, (_, i) => row(`20260915-120000-${i.toString(16).padStart(8, '0')}`,
        { account: models.formatAccountReference(accounts[i % accountCount].type, accounts[i % accountCount].name),
            type: i % 2 ? 'expense' : 'income' }));
    return { accounts, source };
}
const snapshot = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
function harness(module, source, accounts, enableAccounts = true) {
    const counts = { lookups: 0, comparisons: 0, accountReads: 0, ledgerReads: 0, writes: 0, refreshes: 0, layoutSaves: 0 };
    const p = new Plugin();
    p.settings = { enableAccounts, defaultCurrency: 'USD' };
    p.transactionsData = { transactions: source, accounts: accounts.map(account => ({ ...account })), lastUpdated: 'original' };
    p.app = { vault: { adapter: { write: async () => { counts.writes++; } } },
        workspace: { requestSaveLayout() { counts.layoutSaves++; } } };
    p.refreshExpensicaViews = async () => { counts.refreshes++; };
    const find = p.findAccountByReference.bind(p), all = p.getAllTransactions.bind(p), getAccounts = p.getAccounts.bind(p);
    const view = Object.assign(Object.create(module.ExpensicaDashboardView.prototype), {
        plugin: p, transactions: source,
        dateRange: { type: module.DateRangeType.CUSTOM, startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 30) },
        incomeExpenseVisibility: { income: true, expenses: true, net: true, accounts: {} },
        getThemeColor: (token, fallback) => fallback, getThemeColorWithAlpha: (token, fallback) => fallback,
        getChartBarRadius: () => 0, getChartHelperTextColor: () => '#888',
        getChartAnimationOptions: () => false, getChartResizeDelay: () => 0,
        prepareChartCanvasSize() {}, shouldShowChartAxes: () => false, shouldShowChartGrid: () => false,
        getGridColor: () => '#888', getTooltipBackgroundColor: () => '#fff', getTooltipTitleColor: () => '#000',
        getTooltipBodyColor: () => '#000', getTooltipBorderColor: () => '#888', bindChartAreaTooltipClear() {}
    });
    function run(method = 'buckets', instrument = true) {
        Object.keys(counts).forEach(key => { counts[key] = 0; });
        const rows = p.transactionsData.accounts;
        if (instrument) Object.defineProperty(rows, 'find', { configurable: true, value: predicate =>
            Array.prototype.find.call(rows, (account, index, array) => {
                counts.comparisons++; return predicate(account, index, array);
            }) });
        else delete rows.find;
        p.findAccountByReference = instrument ? reference => { counts.lookups++; return find(reference); } : find;
        p.getAllTransactions = instrument ? () => { counts.ledgerReads++; return all(); } : all;
        p.getAccounts = instrument ? () => { counts.accountReads++; return getAccounts(); } : getAccounts;
        const start = performance.now();
        const buckets = method === 'buckets' ? view.getIncomeExpenseChartBuckets() : view.createIncomeExpenseChart({});
        const milliseconds = performance.now() - start;
        return { milliseconds, counts: { ...counts }, output: snapshot(method === 'buckets' ? buckets : view.incomeExpenseChart?.config) };
    }
    return { p, view, run };
}

test('chart calculations reuse account metadata and full chart creation reads the ledger once', () => {
    const { source, accounts } = fixture(), original = JSON.stringify({ source, accounts });
    source.forEach(Object.freeze); Object.freeze(source);
    const h = harness(current, source, accounts);
    for (const method of ['buckets', 'chart']) {
        const result = h.run(method);
        assert.equal(result.counts.lookups, 0);
        assert.equal(result.counts.comparisons, method === 'buckets' ? 1 : 2);
        assert.equal(result.counts.accountReads, 1);
        assert.equal(result.counts.ledgerReads, 1);
        assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
    }
    assert.equal(JSON.stringify({ source, accounts }), original);
});

test('day/week/month/year buckets retain exact signs, transfers, opening balances, grouping, and local times', () => {
    const { accounts } = fixture(0, 3);
    accounts[2].type = 'credit';
    const source = [row('opening', { date: '2025-12-31', amount: 100 }),
        row('expense', { amount: 30, type: 'expense', account: 'credit-cash2' }),
        row('transfer', { type: 'internal', amount: 20, fromAccount: 'CHEQUING-CASH0', toAccount: 'credit-cash2' }),
        row('saving', { type: 'internal', amount: 15, fromAccount: 'chequing-cash0', toAccount: 'saving-cash1' }),
        row('self', { type: 'internal', amount: 999, fromAccount: 'credit-cash2', toAccount: 'CREDIT-CASH2' }),
        row('implicit', { account: null, amount: 0.0000005, time: '00:00:00' }),
        row('offset', { date: '2026-09-16T23:00:00-12:00', time: '23:59:59', amount: 2.345 }),
        row('boundary', { date: '2026-09-17', time: '00:00:00', amount: 8 }),
        row('unknown', { account: 'saving-deleted', type: 'expense', amount: 7 }),
        row('future', { date: '2027-01-01', amount: 500 })];
    const original = JSON.stringify({ source, accounts });
    for (const resolution of ['day', 'week', 'month', 'year']) {
        const h = harness(current, source, accounts);
        h.view.getIncomeExpenseChartResolution = () => resolution;
        const buckets = h.view.getIncomeExpenseChartBuckets();
        const sorted = source.slice().sort((a, b) => h.view.getTransactionDateTime(a) - h.view.getTransactionDateTime(b));
        const chartAccounts = h.view.getIncomeExpenseChartAccounts();
        for (const bucket of buckets) {
            let net = 0;
            for (const account of chartAccounts) {
                const expected = sorted.filter(row => h.view.getTransactionDateTime(row) <= bucket.end)
                    .reduce((sum, row) => sum + current.getAccountTransactionAmount(h.p, row, account.reference), 0);
                assert.equal(bucket.accountBalances[account.reference], expected);
                net += account.isCredit ? -expected : expected;
            }
            assert.equal(bucket.net, net);
            for (const [type, key] of [['income', 'income'], ['expense', 'expenses']]) {
                const expected = sorted.filter(row => row.type === type && h.view.getTransactionDateTime(row) >= bucket.start
                    && h.view.getTransactionDateTime(row) <= bucket.end).reduce((sum, row) => sum + row.amount, 0);
                assert.equal(bucket[key], expected);
            }
        }
    }
    assert.equal(JSON.stringify({ source, accounts }), original);
});

for (const type of ['chequing', 'credit']) for (const enableAccounts of [true, false]) {
    test(`legacy references and ${type} default preserve balances with accounts enabled=${enableAccounts}`, () => {
        const { accounts } = fixture(0, 2);
        accounts[0].type = type;
        const source = [row('implicit', { account: undefined, amount: 100 }), row('null', { account: null, amount: 2 }),
            row('empty', { account: '', type: 'expense', amount: 30 }),
            row('other', { account: 'saving-cash1', amount: 5 }),
            row('transfer', { type: 'internal', fromAccount: `${type}-cash0`, toAccount: 'saving-cash1', amount: 10 })];
        const h = harness(current, source, accounts, enableAccounts), result = h.run();
        const last = result.output.at(-1);
        assert.equal(last.accountBalances[`${type}-cash0`], type === 'credit' ? -62 : 62);
        assert.equal(last.net, 77);
        assert.equal(result.counts.lookups, enableAccounts ? 0 : 2);
        assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
    });
}

test('chart series retain gaps, zero/self-transfer activity exclusion, colors, visibility, and currency tooltips', () => {
    const { accounts } = fixture(0, 3); accounts[2].type = 'credit';
    const source = [row('zero', { date: '2026-09-01', amount: 0 }),
        row('self', { date: '2026-09-01', type: 'internal', fromAccount: 'credit-cash2', toAccount: 'CREDIT-CASH2', amount: 9 }),
        row('first', { date: '2026-09-02', amount: 10 }), row('same-time', { date: '2026-09-02', type: 'expense', amount: 3 }),
        row('credit', { date: '2026-09-03', type: 'expense', account: 'credit-cash2', amount: 2.345 })];
    const original = JSON.stringify(source);
    for (const currency of ['CAD', 'JPY', 'KWD']) {
        const h = harness(current, source, accounts);
        h.p.settings.defaultCurrency = currency;
        h.view.incomeExpenseVisibility.accounts['credit-cash2'] = false;
        const { output } = h.run('chart'), data = output.data.datasets;
        assert.deepEqual(data[3].data.slice(0, 3), [null, 7, 7]);
        const credit = data.find(dataset => dataset.label === 'Cash2');
        assert.deepEqual(credit.data.slice(0, 3), [null, null, -2.345]);
        assert.equal(credit.hidden, true);
        const callbacks = h.view.incomeExpenseChart.config.options.plugins.tooltip.callbacks;
        assert.equal(callbacks.label({ dataset: credit, raw: -1540.89 }), `Cash2: ${models.formatCurrency(1540.89, currency, true)}`);
    }
    assert.equal(JSON.stringify(source), original);
});

test('tiny amounts stay raw, cancellation is unchanged, and later calculations use fresh ledger/account state', () => {
    const { source, accounts } = fixture(20000, 1);
    source.forEach(row => { row.amount = 0.0000005; row.type = 'income'; Object.freeze(row); }); Object.freeze(source);
    const original = JSON.stringify(source), h = harness(current, source, accounts);
    const expected = source.reduce((sum, row) => sum + row.amount, 0);
    assert.equal(h.run().output.at(-1).net, expected);
    assert.equal(models.formatCurrency(expected, 'CAD'), '$0.01');
    assert.equal(JSON.stringify(source), original);
    h.p.transactionsData = { transactions: [row('a', { amount: 0.3, account: 'credit-cash0' }),
        row('b', { amount: 0.2, type: 'expense', account: 'credit-cash0' }),
        row('c', { amount: 0.1, type: 'expense', account: 'credit-cash0' })],
        accounts: [{ ...accounts[0], type: 'credit' }], lastUpdated: 'new' };
    h.view.transactions = h.p.transactionsData.transactions;
    const last = h.run().output.at(-1), raw = 0.3 - 0.2 - 0.1;
    assert.equal(last.net, raw);
    assert.equal(last.accountBalances['credit-cash0'], -raw);
});

test('empty ledgers, no accounts, and future-only ranges produce no writes or refreshes', () => {
    for (const accounts of [fixture(0, 2).accounts, []]) {
        const h = harness(current, [], accounts);
        assert.ok(h.run().output.every(bucket => bucket.net === 0));
        h.view.dateRange = { ...h.view.dateRange, startDate: new Date(2099, 0, 1), endDate: new Date(2099, 0, 2) };
        assert.deepEqual(h.run().output, []);
        const result = h.run('chart');
        assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
        assert.equal(result.counts.ledgerReads, 0);
    }
    const { source, accounts } = fixture(100, 20), h = harness(current, source, accounts);
    h.view.dateRange = { ...h.view.dateRange, startDate: new Date(2099, 0, 1), endDate: new Date(2099, 0, 2) };
    assert.equal(h.run('chart').counts.ledgerReads, 0);
});

if (process.env.EXPENSICA_CHART_BASELINE) {
    test('benchmark original and optimized chart calculations with identical outputs', () => {
        const before = dashboard(fs.readFileSync(process.env.EXPENSICA_CHART_BASELINE, 'utf8'));
        const { source, accounts } = fixture(10000, 20), original = JSON.stringify({ source, accounts });
        const measurements = {};
        for (const method of ['buckets', 'chart']) {
            const a = harness(before, source, accounts), b = harness(current, source, accounts);
            a.view.dateRange.startDate = b.view.dateRange.startDate = new Date(2026, 8, 15);
            a.view.dateRange.endDate = b.view.dateRange.endDate = new Date(2026, 8, 15);
            const old = a.run(method), updated = b.run(method);
            assert.deepEqual(updated.output, old.output);
            a.run(method, false); b.run(method, false);
            const times = { before: [], after: [] };
            for (let i = 0; i < 5; i++) {
                let first, second;
                if (i % 2) { second = b.run(method, false); first = a.run(method, false); }
                else { first = a.run(method, false); second = b.run(method, false); }
                times.before.push(first.milliseconds); times.after.push(second.milliseconds);
                assert.deepEqual(second.output, first.output);
            }
            const median = values => +values.sort((a, b) => a - b)[2].toFixed(2);
            measurements[method] = { before: { medianMs: median(times.before), counts: old.counts },
                after: { medianMs: median(times.after), counts: updated.counts } };
        }
        assert.equal(JSON.stringify({ source, accounts }), original);
        console.log(JSON.stringify({ rows: 10000, accounts: 20, samples: 5, identicalOutputs: true, measurements }));
    });
}
