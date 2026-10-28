const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename, dependencies = {}) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, crypto: require('node:crypto').webcrypto,
        console: { log() {}, error() {}, warn() {} }, window: { requestAnimationFrame() {} },
        require: name => dependencies[name] || {}
    });
    return exports;
}
const models = load('src/models.ts');
const dashboard = load('src/dashboard-view.ts', { './models': models,
    obsidian: { Modal: class {}, ItemView: class {} }, 'chart.js': { Tooltip: { positioners: {} } }
});
const { default: Plugin } = load('main.ts', { './src/models': models, './src/dashboard-view': dashboard,
    './src/transaction-import': load('src/transaction-import.ts', { './models': models }),
    './src/notice': { showExpensicaNotice() {} },
    obsidian: { Plugin: class {}, PluginSettingTab: class {}, Modal: class {} }
});
const plain = value => JSON.parse(JSON.stringify(value));
const budget = { id: 'budget', categoryId: 'food', amount: 100, period: 'monthly', rollover: false };
const transaction = { id: '20261015-120000-00000001', date: '2026-10-15', time: '12:00:00',
    type: 'expense', category: 'food', amount: 10, description: 'ENTRY', account: 'other-default' };
const importSource = () => ({ name: 'import.json', text: async () => JSON.stringify({
    transactions: [{ ...transaction, id: '20261016-120000-00000002', date: '2026-10-16', amount: 25 }]
}) });

class Element {
    constructor(cls = '') { this.cls = cls; this.children = []; this.isConnected = true; this.visible = true; }
    get childElementCount() { return this.children.length; }
    get classList() { return { contains: cls => cls === this.cls }; }
    getBoundingClientRect() { return { width: this.visible ? 100 : 0, height: this.visible ? 100 : 0 }; }
    removeClass() {} toggleClass() {}
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    createDiv(cls) { const child = new Element(cls); child.parent = this; this.children.push(child); return child; }
}

function setup(tabs = ['budget', 'budget']) {
    const p = new Plugin();
    p.settings = { categories: models.DEFAULT_CATEGORIES, enableAccounts: true, enableBudgeting: true };
    p.transactionsData = { transactions: [{ ...transaction }], accounts: [{ ...models.DEFAULT_ACCOUNT }], lastUpdated: 'initial' };
    p.budgetData = { budgets: [{ ...budget }], lastUpdated: 'initial' };
    const files = new Map([[p.transactionsFilePath, JSON.stringify(p.transactionsData)],
        [p.budgetFilePath, JSON.stringify(p.budgetData)]]);
    const writes = [], summaries = [], views = [];
    const storage = { fail: false, gate: null };
    p.app = { vault: { adapter: {
        read: async file => files.get(file),
        write: async (file, content) => {
            if (storage.gate) await storage.gate();
            if (storage.fail) throw new Error('disk full');
            files.set(file, content); writes.push(file);
        }
    } }, workspace: { getLeavesOfType: () => views.map(view => ({ view })) } };
    p.showTransactionSummary = (...args) => summaries.push(args);
    p.renderDataRecoveryWarning = () => {};
    for (const tab of tabs) {
        const root = new Element();
        const header = root.createDiv('header');
        const buttons = root.createDiv('expensica-tabs');
        const effects = { loads: 0, full: 0, partial: 0, snapshots: [] };
        const record = function () {
            assert.deepEqual(JSON.parse(files.get(p.budgetFilePath)).budgets, plain(p.getAllBudgets()));
            assert.deepEqual(JSON.parse(files.get(p.transactionsFilePath)).transactions, plain(p.getAllTransactions()));
            effects.snapshots.push({ tab: this.currentTab, budgets: plain(p.getAllBudgets()), transactions: plain(this.transactions) });
            root.createDiv('content');
        };
        const view = Object.assign(Object.create(dashboard.ExpensicaDashboardView.prototype), {
            plugin: p, containerEl: { children: [null, root] }, currentTab: tab,
            currentDate: models.parseLocalDate('2026-10-15'), selectedCalendarDate: null,
            dateRange: { type: dashboard.DateRangeType.CUSTOM,
                startDate: models.parseLocalDate('2026-10-01'), endDate: models.parseLocalDate('2026-10-31') },
            effects, root, header, buttons, transactions: p.getAllTransactions(),
            async loadTransactionsData() {
                effects.loads++;
                await dashboard.ExpensicaDashboardView.prototype.loadTransactionsData.call(this);
            },
            renderDashboard() {
                effects.full++;
                this.pendingDataRefresh = null;
                this.renderCurrentTabContent(root);
            },
            refreshCurrentTabContent() {
                effects.partial++;
                dashboard.ExpensicaDashboardView.prototype.refreshCurrentTabContent.call(this);
            },
            renderOverviewTab: record, renderBudgetTab: record, renderTransactionsTab: record,
            renderAccountsTab: record, renderCategoriesTab: record,
            consumeChartAnimationRequest() {}, rememberScrollPosition() {}, restoreScrollPosition() {},
            updateActiveTabButtons() {}, persistDashboardState() {}, resizeChartsToContainers: () => false
        });
        views.push(view);
    }
    return { p, files, writes, storage, summaries, views };
}

const operations = [
    ['import', h => h.p.importTransactionsFromJSON(importSource()), 'transactionsFilePath'],
    ['budget create', h => h.p.addBudget({ ...budget, id: 'new', amount: 150 }), 'budgetFilePath'],
    ['budget edit', h => h.p.updateBudget({ ...budget, amount: 200 }), 'budgetFilePath'],
    ['budget delete', h => h.p.deleteBudget(budget.id), 'budgetFilePath']
];

for (const [name, mutate, pathKey] of operations) {
    test(`${name} refreshes both dashboards exactly once after its write completes`, async () => {
        const h = setup();
        let release, entered;
        const writing = new Promise(resolve => { entered = resolve; });
        h.storage.gate = () => { entered(); return new Promise(resolve => { release = resolve; }); };
        const before = plain({ transactions: h.p.transactionsData, budgets: h.p.budgetData });
        const pending = mutate(h);
        await writing;
        for (const view of h.views) assert.equal(view.effects.full + view.effects.partial + view.effects.loads, 0);
        assert.deepEqual(plain({ transactions: h.p.transactionsData, budgets: h.p.budgetData }), before);
        release();
        await pending;
        assert.deepEqual(h.writes, [h.p[pathKey]]);
        for (const view of h.views) {
            assert.equal(view.effects.full + view.effects.partial, 1);
            assert.equal(view.effects.snapshots.length, 1);
            assert.equal(view.effects.loads, name === 'import' ? 1 : 0);
            assert.equal(view.root.children[0], view.header);
            assert.equal(view.root.children[1], view.buttons);
        }
    });

    test(`${name} does not refresh on failed writes and refreshes once on retry`, async () => {
        const h = setup();
        const files = [...h.files];
        const memory = JSON.stringify({ transactions: h.p.transactionsData, budgets: h.p.budgetData });
        h.storage.fail = true;
        await assert.rejects(mutate(h), /disk full/);
        assert.deepEqual([...h.files], files);
        assert.equal(JSON.stringify({ transactions: h.p.transactionsData, budgets: h.p.budgetData }), memory);
        assert.equal(h.summaries.length, 0);
        for (const view of h.views) assert.equal(view.effects.full + view.effects.partial + view.effects.loads, 0);
        h.storage.fail = false;
        await mutate(h);
        assert.equal(h.writes.length, 1);
        for (const view of h.views) assert.equal(view.effects.full + view.effects.partial, 1);
    });

    test(`${name} defers a hidden dashboard render until activation without a second load`, async () => {
        const h = setup();
        const hidden = h.views[1];
        hidden.root.visible = false;
        await mutate(h);
        assert.equal(h.views[0].effects.full + h.views[0].effects.partial, 1);
        assert.equal(hidden.effects.full + hidden.effects.partial, 0);
        const loads = hidden.effects.loads;
        hidden.root.visible = true;
        hidden.handleWorkspaceVisibilityChange();
        assert.equal(hidden.effects.full + hidden.effects.partial, 1);
        assert.equal(hidden.effects.loads, loads);
        hidden.handleWorkspaceVisibilityChange();
        assert.equal(hidden.effects.full + hidden.effects.partial, 1);
    });
}

test('budget mutations skip unrelated tabs, which read fresh budgets when switched to Budget', async () => {
    const h = setup(['overview', 'transactions', 'accounts', 'categories']);
    await h.p.addBudget({ ...budget, id: 'new' });
    await h.p.updateBudget({ ...budget, amount: 225 });
    await h.p.deleteBudget('new');
    for (const view of h.views) {
        assert.equal(view.effects.loads + view.effects.full + view.effects.partial, 0);
        view.switchDashboardTab(dashboard.DashboardTab.BUDGET);
        assert.equal(view.effects.snapshots.length, 1);
        assert.equal(view.effects.snapshots[0].budgets[0].amount, 225);
        assert.equal(view.pendingDataRefresh, null);
        view.handleWorkspaceVisibilityChange();
        assert.equal(view.effects.snapshots.length, 1);
    }
});

test('imports refresh each dashboard tab, including Transactions and budget spending data', async () => {
    const h = setup(['overview', 'transactions', 'accounts', 'categories', 'budget']);
    await h.p.importTransactionsFromJSON(importSource());
    for (const view of h.views) {
        assert.equal(view.effects.loads, 1);
        assert.equal(view.effects.snapshots.length, 1);
        assert.equal(view.effects.snapshots[0].transactions.length, 2);
        assert.equal(view.effects.snapshots[0].transactions.reduce((total, row) => total + row.amount, 0), 35);
    }
    assert.equal(h.summaries.length, 1);
});

test('multiple hidden budget/import updates render only the latest state on activation', async () => {
    const h = setup();
    const hidden = h.views[1];
    hidden.root.visible = false;
    await h.p.updateBudget({ ...budget, amount: 150 });
    await h.p.importTransactionsFromJSON(importSource());
    await h.p.updateBudget({ ...budget, amount: 250 });
    assert.equal(hidden.effects.snapshots.length, 0);
    hidden.pendingThemeRefresh = true;
    hidden.root.visible = true;
    hidden.handleWorkspaceVisibilityChange();
    assert.equal(hidden.effects.snapshots.length, 1);
    assert.equal(hidden.effects.snapshots[0].transactions.length, 2);
    assert.equal(hidden.effects.snapshots[0].budgets[0].amount, 250);
    hidden.handleWorkspaceVisibilityChange();
    assert.equal(hidden.effects.snapshots.length, 1);
    assert.equal(h.writes.length, 3);
});

test('a broken dashboard cannot prevent refresh of other dashboards or reject a committed mutation', async () => {
    for (const [, mutate] of operations) {
        const h = setup();
        h.views[0].renderDashboard = () => { throw new Error('render failed'); };
        h.views[0].refreshCurrentTabContent = () => { throw new Error('render failed'); };
        await mutate(h);
        assert.equal(h.writes.length, 1);
        assert.equal(h.views[1].effects.snapshots.length, 1);
    }
});

test('missing budgets and empty canonical imports perform no writes or refreshes', async () => {
    const h = setup();
    await h.p.updateBudget({ ...budget, id: 'missing' });
    await h.p.deleteBudget('missing');
    await h.p.importTransactionsFromJSON({ name: 'empty.json', text: async () => '{"transactions":[]}' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.summaries.length, 0);
    for (const view of h.views) assert.equal(view.effects.full + view.effects.partial + view.effects.loads, 0);
});

test('protected data rejects imports and budgets before notifying views', async () => {
    for (const [name, mutate] of operations) {
        const h = setup();
        h.p.protectedDatasets.add(name === 'import' ? 'transactions' : 'budgets');
        await assert.rejects(mutate(h), /protected/);
        assert.equal(h.writes.length, 0);
        for (const view of h.views) assert.equal(view.effects.snapshots.length, 0);
    }
});

test('an import summary failure cannot prevent committed data from reaching both dashboards', async () => {
    const h = setup();
    h.p.showTransactionSummary = () => { throw new Error('summary failed'); };
    assert.equal(await h.p.importTransactionsFromJSON(importSource()), true);
    assert.equal(h.writes.length, 1);
    for (const view of h.views) assert.equal(view.effects.snapshots.length, 1);
});
