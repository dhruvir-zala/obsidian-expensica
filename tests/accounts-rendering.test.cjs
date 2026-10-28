const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const perf = require('node:perf_hooks').performance;

function load(file, dependencies = {}, source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')) {
    const exports = {};
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
    } }).outputText;
    vm.runInNewContext(code, { exports, Date, Intl, console, require: name => dependencies[name] || {} });
    return exports;
}
class Element {
    constructor(tag = 'div', options = {}) {
        if (typeof options === 'string') options = { cls: options };
        this.tag = tag; this.text = options.text || ''; this.classes = (options.cls || '').split(' ');
        this.attrs = { ...options.attr }; this.children = []; this.style = {}; this.listeners = {};
    }
    createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    addClass(name) { this.classes.push(name); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    setText(value) { this.text = value; }
}
const tree = element => ({ tag: element.tag, text: element.text, classes: element.classes, attrs: element.attrs,
    style: element.style, events: Object.keys(element.listeners), children: element.children.map(tree) });
let activeCounts, capture;
const opened = [];
class Modal {
    constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); this.containerEl = new Element(); }
    open() { opened.push(this); }
}
const obsidian = { Modal, ItemView: class {}, Plugin: class {}, PluginSettingTab: class {} };
const models = load('src/models.ts');
const sort = models.sortTransactionsByDateTimeDesc;
models.sortTransactionsByDateTimeDesc = (...args) => {
    if (activeCounts) activeCounts.sorts++;
    return sort(...args);
};
const accountCards = load('src/account-card.ts', { './models': models });
function dashboard(source) {
    return load('src/dashboard-view.ts', { './models': models, obsidian,
        'chart.js': { Tooltip: { positioners: {} } }, './modal-utils': { preventBackdropDismissal() {} },
        './account-card': { ...accountCards,
            renderAccountCard(container, options) { capture.cards.push(options); return accountCards.renderAccountCard(container, options); },
            renderCreateAccountCard(container, options) { capture.create.push(options); return accountCards.renderCreateAccountCard(container, options); }
        }
    }, source);
}
const current = dashboard();
const Plugin = load('main.ts', { './src/models': models, obsidian }).default;
const row = (id, fields = {}) => ({ id, date: '2026-10-15', time: '12:00:00', type: 'income', amount: 1.234,
    description: 'ENTRY', category: 'salary', account: 'chequing-cash', ...fields });
function fixture(count = 100, accountCount = 20) {
    const accounts = Array.from({ length: accountCount }, (_, i) => ({ id: `a${i}`, name: `Cash${i}`,
        type: i === 0 ? 'chequing' : i % 3 === 0 ? 'credit' : 'saving', isDefault: i === 0,
        createdAt: '2026-01-01', ...(i % 3 === 0 && i ? { creditLimit: 1000 + i } : {}) }));
    const source = Array.from({ length: count }, (_, i) => row(`20261015-120000-${i.toString(16).padStart(8, '0')}`,
        { account: models.formatAccountReference(accounts[i % accountCount].type, accounts[i % accountCount].name),
            type: i % 2 ? 'expense' : 'income' }));
    return { source, accounts };
}
function harness(module, source, accounts) {
    const counts = { sorts: 0, lookups: 0, comparisons: 0, accountReads: 0, ledgerReads: 0, writes: 0, refreshes: 0, layoutSaves: 0 };
    const p = new Plugin();
    p.settings = { defaultCurrency: 'USD', enableAccounts: true };
    p.transactionsData = { transactions: source, accounts: accounts.map(account => ({ ...account })), lastUpdated: 'original' };
    p.app = { vault: { adapter: { write: async () => { counts.writes++; } } },
        workspace: { requestSaveLayout() { counts.layoutSaves++; } } };
    p.refreshExpensicaViews = async () => { counts.refreshes++; };
    const find = p.findAccountByReference.bind(p), all = p.getAllTransactions.bind(p), getAccounts = p.getAccounts.bind(p);
    const view = Object.assign(Object.create(module.ExpensicaDashboardView.prototype), { plugin: p, app: p.app });
    const state = { cards: [], create: [] };
    function render(instrument = true) {
        for (const key of Object.keys(counts)) counts[key] = 0;
        const rows = p.transactionsData.accounts;
        if (instrument) Object.defineProperty(rows, 'find', { configurable: true, value: predicate =>
            Array.prototype.find.call(rows, (account, index, array) => {
                counts.comparisons++; return predicate(account, index, array);
            }) });
        else delete rows.find;
        p.findAccountByReference = instrument ? reference => { counts.lookups++; return find(reference); } : find;
        p.getAllTransactions = instrument ? () => { counts.ledgerReads++; return all(); } : all;
        p.getAccounts = instrument ? () => { counts.accountReads++; return getAccounts(); } : getAccounts;
        state.cards.length = state.create.length = 0;
        const root = new Element();
        capture = state; activeCounts = instrument ? counts : null;
        const start = perf.now();
        try { view.renderAccountsTab(root); }
        finally { activeCounts = null; capture = null; }
        const milliseconds = perf.now() - start;
        return { milliseconds, counts: { ...counts }, output: JSON.parse(JSON.stringify({
            cards: state.cards, create: state.create, tree: tree(root)
        })) };
    }
    return { p, view, render, state, counts };
}

test('Accounts tab sorts once and reuses known metadata without account reference searches', () => {
    const { source, accounts } = fixture();
    source.forEach(Object.freeze); Object.freeze(source);
    const original = JSON.stringify({ source, accounts });
    const result = harness(current, source, accounts).render();
    assert.deepEqual(result.counts, { sorts: 1, lookups: 0, comparisons: 1, accountReads: 1,
        ledgerReads: 1, writes: 0, refreshes: 0, layoutSaves: 0 });
    assert.deepEqual(result.output.cards.map(card => card.account.id), [...accounts].sort(models.compareAccounts).map(account => account.id));
    assert.equal(result.output.create.length, 1);
    assert.equal(JSON.stringify({ source, accounts }), original);
});

test('account cards retain transfer/credit signs, activity dates, limits, colors, and currency precision', () => {
    const accounts = [{ id: 'cash', name: 'Cash', type: 'chequing', isDefault: true, color: '#123456' },
        { id: 'card', name: 'Card', type: 'credit', creditLimit: 100 }, { id: 'reserve', name: 'Reserve', type: 'saving' },
        { id: 'empty', name: 'Empty', type: 'credit', creditLimit: 0 }];
    const source = [row('opening', { date: '2026-10-14', amount: 100 }),
        row('expense', { type: 'expense', amount: 30 }), row('debt', { type: 'expense', account: 'credit-card', amount: 80 }),
        row('income', { account: 'credit-card', amount: 5 }),
        row('implicit', { account: undefined, amount: 2 }),
        row('payment', { type: 'internal', amount: 20, fromAccount: 'CHEQUING-CASH', toAccount: 'credit-card' }),
        row('save', { type: 'internal', amount: 15, fromAccount: 'chequing-cash', toAccount: 'saving-reserve' }),
        row('reserve-expense', { type: 'expense', account: 'saving-reserve', amount: 2.345 }),
        row('advance', { type: 'internal', date: '2026-10-16T23:00:00-12:00', amount: 3,
            fromAccount: 'credit-card', toAccount: 'chequing-cash' }),
        row('self', { type: 'internal', date: '2026-11-01', amount: 999, fromAccount: 'credit-card', toAccount: 'CREDIT-CARD' }),
        row('zero', { account: 'credit-empty', date: '2026-11-01', amount: 0 })];
    const original = JSON.stringify({ source, accounts });
    for (const currency of ['USD', 'CAD', 'JPY', 'KWD']) {
        const h = harness(current, source, accounts);
        h.p.settings.defaultCurrency = currency;
        const result = h.render(), cards = Object.fromEntries(result.output.cards.map(card => [card.account.id, card]));
        assert.equal(cards.cash.runningBalance, 40);
        assert.equal(cards.card.runningBalance, 58);
        assert.equal(cards.reserve.runningBalance, 15 - 2.345);
        assert.equal(cards.card.creditLimitLabel, models.formatCurrency(42, currency));
        assert.equal(cards.empty.creditLimitLabel, models.formatCurrency(0, currency));
        assert.equal(cards.empty.lastTransactionDateLabel, 'No transactions yet');
        assert.equal(cards.card.lastTransactionDateLabel, '16 October 2026');
        assert.equal(cards.cash.lastTransactionDateLabel, '16 October 2026');
        assert.equal(cards.cash.color, '#123456');
        assert.ok(JSON.stringify(result.output.tree).includes(models.formatCurrency(15 - 2.345, currency)));
        assert.equal(result.counts.lookups, 0);
        assert.equal(result.counts.writes + result.counts.refreshes + result.counts.layoutSaves, 0);
    }
    assert.equal(JSON.stringify({ source, accounts }), original);
});

test('empty ledgers and empty account collections preserve card/create-card behavior', () => {
    for (const accounts of [fixture(0, 3).accounts, []]) {
        const result = harness(current, [], accounts).render();
        assert.equal(result.output.cards.length, accounts.length);
        assert.ok(result.output.cards.every(card => card.runningBalance === 0 && card.lastTransactionDateLabel === 'No transactions yet'));
        assert.equal(result.output.create.length, 1);
        assert.equal(result.counts.lookups + result.counts.comparisons, 0);
    }
});

test('later renders use fresh account definitions and ledger data without retaining cached results', () => {
    const { accounts, source } = fixture(1, 2);
    source[0].account = 'saving-cash1';
    const h = harness(current, source, accounts);
    assert.equal(h.render().output.cards.find(card => card.account.id === 'a1').runningBalance, 1.234);
    h.p.transactionsData = { ...h.p.transactionsData, transactions: [{ ...source[0], account: 'credit-cash1', amount: 2.345 }],
        accounts: [accounts[0], { ...accounts[1], type: 'credit', creditLimit: 10 }] };
    h.p.settings.defaultCurrency = 'KWD';
    const result = h.render(), card = result.output.cards.find(card => card.account.id === 'a1');
    assert.equal(card.runningBalance, -2.345);
    assert.equal(card.creditLimitLabel, models.formatCurrency(10, 'KWD'));
    assert.equal(result.counts.lookups + result.counts.writes + result.counts.refreshes, 0);
    assert.equal(result.counts.comparisons, 1);
});

test('tiny amounts and final cancellation cleanup retain exact ledger data', () => {
    const { accounts, source } = fixture(20000, 1);
    for (const row of source) { row.amount = 0.0000005; row.type = 'income'; Object.freeze(row); }
    Object.freeze(source);
    const original = JSON.stringify(source), h = harness(current, source, accounts);
    const result = h.render();
    assert.equal(result.output.cards[0].runningBalance, source.reduce((sum, row) => sum + row.amount, 0));
    assert.ok(JSON.stringify(result.output.tree).includes('$0.01'));
    assert.equal(JSON.stringify(source), original);
    h.p.transactionsData.transactions = [row('a', { amount: 0.1, account: 'chequing-cash0' }),
        row('b', { amount: 0.2, account: 'chequing-cash0' }), row('c', { amount: 0.3, type: 'expense', account: 'chequing-cash0' })];
    assert.equal(h.render().output.cards[0].runningBalance, 0);
});

test('missing, null, and empty legacy account references share one default-account resolution', () => {
    const { accounts, source } = fixture(100, 20);
    source.forEach((row, index) => {
        row.type = 'income'; row.amount = 0.01;
        if (index % 3 === 0) delete row.account;
        else row.account = index % 3 === 1 ? null : '';
    });
    const original = JSON.stringify(source), result = harness(current, source, accounts).render();
    assert.equal(result.output.cards[0].runningBalance, source.reduce((sum, row) => sum + row.amount, 0));
    assert.ok(result.output.cards.slice(1).every(card => card.runningBalance === 0));
    assert.equal(result.counts.lookups, 0);
    assert.equal(result.counts.comparisons, 1);
    assert.equal(JSON.stringify(source), original);
});

test('account and create cards preserve their editor callbacks without writes or refreshes', () => {
    const { source, accounts } = fixture(1, 1), h = harness(current, source, accounts);
    h.render();
    const start = opened.length;
    h.state.cards[0].onClick(); h.state.create[0].onClick();
    assert.equal(opened.length, start + 2);
    assert.equal(opened[start].account.id, accounts[0].id);
    assert.equal(opened[start + 1].account, null);
    assert.equal(opened[start].dashboardView, h.view);
    assert.equal(h.counts.writes + h.counts.refreshes + h.counts.layoutSaves, 0);
});

if (process.env.EXPENSICA_ACCOUNTS_BASELINE) {
    test('benchmark old and optimized Accounts tabs with identical output and separately measured operation counts', () => {
        const before = dashboard(fs.readFileSync(process.env.EXPENSICA_ACCOUNTS_BASELINE, 'utf8'));
        const { source, accounts } = fixture(10000, 20), original = JSON.stringify({ source, accounts });
        const a = harness(before, source, accounts), b = harness(current, source, accounts);
        const beforeCounts = a.render(), afterCounts = b.render();
        assert.deepEqual(afterCounts.output, beforeCounts.output);
        a.render(false); b.render(false);
        const samples = { before: [], after: [] };
        for (let i = 0; i < 5; i++) {
            let first, second;
            if (i % 2) { second = b.render(false); first = a.render(false); }
            else { first = a.render(false); second = b.render(false); }
            samples.before.push(first.milliseconds); samples.after.push(second.milliseconds);
            assert.deepEqual(second.output, first.output);
            assert.equal(first.counts.writes + first.counts.refreshes + second.counts.writes + second.counts.refreshes, 0);
        }
        const median = values => +values.sort((a, b) => a - b)[2].toFixed(2);
        console.log(JSON.stringify({ rows: source.length, accounts: accounts.length, samples: 5,
            before: { medianMs: median(samples.before), counts: beforeCounts.counts },
            after: { medianMs: median(samples.after), counts: afterCounts.counts }, identicalOutputs: true }));
        assert.equal(JSON.stringify({ source, accounts }), original);
    });
}
