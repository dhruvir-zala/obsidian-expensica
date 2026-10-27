const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const perf = require('node:perf_hooks').performance;

function load(file, dependencies = {}, extra = '', source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')) {
    const exports = {};
    const compiled = ts.transpileModule(source + extra, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, console,
        require: name => dependencies[name] || {} });
    return exports;
}
const models = load('src/models.ts');
const sort = models.sortTransactionsByDateTimeDesc;
let activeCounts;
models.sortTransactionsByDateTimeDesc = (...args) => {
    if (activeCounts) { activeCounts.sorts++; activeCounts.sortedRows += args[0].length; }
    return sort(...args);
};
const obsidian = { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, ItemView: class {} };
const dashboard = load('src/dashboard-view.ts', { './models': models, obsidian,
    'chart.js': { Tooltip: { positioners: {} } } }, '\nexport { getRunningBalanceByTransactionIdForAccount };');
const Plugin = load('main.ts', { './src/models': models, obsidian }).default;
function renderer(source) {
    return load('src/transactions-view.ts', { './models': models, obsidian, './dashboard-view': dashboard },
        '\nexport { getRunningBalanceByTransactionIdForAccount };', source);
}
const current = renderer();
const entry = (id, fields = {}) => ({ id, date: '2026-10-15', time: '12:00:00', type: 'income', amount: 1.234,
    description: 'ENTRY', category: 'salary', account: 'chequing-cash', ...fields });
function fixture(count = 100, accountCount = 20) {
    const accounts = Array.from({ length: accountCount }, (_, i) => ({ id: `account-${i}`, name: `Cash${i}`,
        type: i === 0 ? 'chequing' : i % 3 === 0 ? 'credit' : 'saving', isDefault: i === 0, createdAt: '2026-01-01' }));
    const references = accounts.map(account => models.formatAccountReference(account.type, account.name));
    const source = Array.from({ length: count }, (_, i) => entry(`20261015-120000-${i.toString(16).padStart(8, '0')}`,
        { account: references[i % references.length], type: i % 2 ? 'expense' : 'income' }));
    return { accounts, source };
}
function harness(module, source, accounts, selectedAccountReferences = []) {
    const counts = { sorts: 0, sortedRows: 0, lookups: 0, ledgerReads: 0, writes: 0, refreshes: 0, layoutSaves: 0 };
    const p = new Plugin();
    p.settings = { enableAccounts: true, defaultCurrency: 'USD' };
    p.transactionsData = { transactions: source, accounts, lastUpdated: 'original' };
    p.app = { vault: { adapter: { write: async () => { counts.writes++; } } },
        workspace: { requestSaveLayout() { counts.layoutSaves++; } } };
    p.refreshExpensicaViews = async () => { counts.refreshes++; };
    const find = p.findAccountByReference.bind(p), all = p.getAllTransactions.bind(p);
    p.findAccountByReference = reference => { counts.lookups++; return find(reference); };
    p.getAllTransactions = () => { counts.ledgerReads++; return all(); };
    const cards = [], groups = [];
    const view = Object.assign(Object.create(module.ExpensicaTransactionsView.prototype), {
        plugin: p, transactions: sort(source, source), selectedAccountReferences,
        renderTransactionGroupTitle(container, title, level) { groups.push([title, level]); },
        renderTransactionCardWithEditHandler(container, row, first, second) { cards.push([row.id, first, second]); }
    });
    function render(visible, runningBalances) {
        for (const key of Object.keys(counts)) counts[key] = 0;
        cards.length = groups.length = 0;
        activeCounts = counts;
        const start = perf.now();
        try { view.renderTransactionsToContainer({}, visible, runningBalances); }
        finally { activeCounts = null; }
        return { milliseconds: perf.now() - start, counts: { ...counts }, cards: [...cards], groups: [...groups] };
    }
    return { p, view, counts, render };
}
function expectedCards(source, accounts, visible, currency = 'USD') {
    const h = harness(current, source, accounts), maps = new Map();
    h.p.settings.defaultCurrency = currency;
    const balances = reference => {
        if (!maps.has(reference)) maps.set(reference,
            dashboard.getRunningBalanceByTransactionIdForAccount(h.p, reference, source));
        return maps.get(reference);
    };
    return visible.map(row => {
        if (row.type === 'internal') {
            return [row.id, ...[row.fromAccount, row.toAccount].map(value => {
                const reference = h.p.normalizeTransactionAccountReference(value);
                return `${h.p.getTransactionAccountDisplay(reference).name}: ${models.formatCurrency(balances(reference)[row.id] ?? 0, currency)}`;
            })];
        }
        const reference = h.p.normalizeTransactionAccountReference(row.account);
        return [row.id, models.formatCurrency(balances(reference)[row.id] ?? 0, currency), undefined];
    });
}

test('a 20-account page sorts once and resolves account metadata once per balance calculation', () => {
    const { source, accounts } = fixture();
    source.forEach(Object.freeze); Object.freeze(source);
    const original = JSON.stringify({ source, accounts });
    const visible = sort(source, source).slice(0, 20);
    const result = harness(current, source, accounts).render(visible);
    assert.equal(result.counts.sorts, 1);
    assert.equal(result.counts.sortedRows, source.length);
    assert.equal(result.counts.ledgerReads, 1);
    assert.equal(result.counts.lookups, 20);
    assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
    assert.deepEqual(result.cards, expectedCards(source, accounts, visible));
    assert.equal(JSON.stringify({ source, accounts }), original);
});

test('canonical ties, cloned subsets, transfers, aliases, self-transfers and credit signs retain their outputs', () => {
    const accounts = [{ id: 'cash', name: 'Cash', type: 'chequing', isDefault: true },
        { id: 'card', name: 'Card', type: 'credit' }, { id: 'reserve', name: 'Reserve', type: 'saving' }];
    const source = [entry('opening', { date: '2026-10-14', amount: 100 }),
        entry('equal-first', { type: 'expense', account: 'credit-card', amount: 12.345 }),
        entry('untimed-first', { time: undefined, account: 'saving-reserve', amount: 0.0000005 }),
        entry('payment', { type: 'internal', amount: 7.6543, account: undefined,
            fromAccount: 'CHEQUING-CASH', toAccount: 'credit-card' }),
        entry('equal-last', { account: undefined, amount: 0.0000005 }),
        entry('untimed-last', { time: undefined, type: 'expense', amount: 2 }),
        entry('self', { type: 'internal', fromAccount: 'credit-card', toAccount: 'CREDIT-CARD', amount: 999 })];
    const original = JSON.stringify(source);
    source.forEach(Object.freeze); Object.freeze(source);
    const visible = sort(source, source).filter(row => row.id !== 'opening').map(row => ({ ...row }));
    const h = harness(current, source, accounts);
    for (const currency of ['USD', 'CAD', 'JPY', 'KWD']) {
        h.p.settings.defaultCurrency = currency;
        const first = h.render(visible), second = h.render(visible);
        assert.deepEqual(first.cards, expectedCards(source, accounts, visible, currency));
        assert.deepEqual(first.cards, second.cards);
        assert.deepEqual(first.groups, second.groups);
        assert.equal(first.counts.sorts, 1);
        assert.equal(first.counts.writes + first.counts.refreshes + first.counts.layoutSaves, 0);
    }
    assert.equal(JSON.stringify(source), original);
});

test('caller-supplied balances are honored without sorting or resolving unused accounts', () => {
    const { source, accounts } = fixture(2, 1);
    const h = harness(current, source, accounts, ['chequing-cash0']);
    const supplied = Object.freeze({ [source[0].id]: 100.01, [source[1].id]: 200.02 });
    const result = h.render([source[1]], supplied);
    assert.deepEqual(result.cards, [[source[1].id, '$200.02', undefined]]);
    assert.equal(result.counts.sorts + result.counts.lookups + result.counts.ledgerReads, 0);
    assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
});

test('a later render reads changed ledger and account metadata instead of retaining a cache', () => {
    const { source, accounts } = fixture(1, 2);
    source[0].account = 'saving-cash1';
    const h = harness(current, source, accounts);
    assert.equal(h.render(source).cards[0][1], '$1.23');
    const updated = [{ ...source[0], account: 'credit-cash1', amount: 2.345 }];
    h.p.transactionsData = { ...h.p.transactionsData, transactions: updated,
        accounts: [accounts[0], { ...accounts[1], type: 'credit' }] };
    h.view.transactions = updated;
    const result = h.render(updated);
    assert.equal(result.cards[0][1], '-$2.35');
    assert.equal(result.counts.sorts, 1);
    assert.equal(result.counts.lookups, 1);
    assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
});

test('20,000 tiny amounts preserve raw accumulation while requiring one account lookup', () => {
    const { source, accounts } = fixture(20000, 1);
    for (const row of source) { row.type = 'income'; row.amount = 0.0000005; }
    const original = JSON.stringify(source);
    const h = harness(current, source, accounts);
    const result = h.render([source[0]]);
    assert.equal(result.cards[0][1], '$0.01');
    assert.equal(result.counts.sorts, 1);
    assert.equal(result.counts.lookups, 1);
    assert.equal(JSON.stringify(source), original);
});

if (process.env.EXPENSICA_RENDER_BASELINE) {
    test('benchmark original and current renderers against identical ledger snapshots', () => {
        const baseline = renderer(fs.readFileSync(process.env.EXPENSICA_RENDER_BASELINE, 'utf8'));
        const { source, accounts } = fixture(10000, 20);
        const original = JSON.stringify({ source, accounts });
        const visible = sort(source, source).slice(0, 20);
        const before = harness(baseline, source, accounts), after = harness(current, source, accounts);
        before.render(visible); after.render(visible);
        const timings = { before: [], after: [] };
        let a, b;
        for (let run = 0; run < 5; run++) {
            if (run % 2) { b = after.render(visible); a = before.render(visible); }
            else { a = before.render(visible); b = after.render(visible); }
            timings.before.push(a.milliseconds); timings.after.push(b.milliseconds);
            assert.deepEqual(b.cards, a.cards);
            assert.deepEqual(b.groups, a.groups);
            assert.equal(a.counts.writes + a.counts.refreshes + b.counts.writes + b.counts.refreshes, 0);
        }
        const median = values => +values.sort((a, b) => a - b)[2].toFixed(2);
        console.log(JSON.stringify({ rows: source.length, accounts: accounts.length, visible: visible.length, samples: 5,
            before: { medianMs: median(timings.before), counts: a.counts },
            after: { medianMs: median(timings.after), counts: b.counts }, identicalOutputs: true }));
        assert.equal(JSON.stringify({ source, accounts }), original);
    });
}
