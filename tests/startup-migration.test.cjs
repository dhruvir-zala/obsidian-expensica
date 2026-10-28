const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const compiled = new Map();
function load(filename, dependencies = {}, globals = {}) {
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText);
    const exports = {};
    vm.runInNewContext(compiled.get(filename), { exports, Date, crypto: require('node:crypto').webcrypto,
        console: { log() {}, error() {}, warn() {} }, ...globals,
        require(name) { return dependencies[name] || (name.endsWith('/modal-utils') ? load('src/modal-utils.ts') : {}); }
    });
    return exports;
}
const models = load('src/models.ts');
const { CalendarHeatmap } = load('src/visualizations/calendar-view.ts', { '../models': models });
const preparation = load('src/transaction-import.ts', { './models': models });
const cash = { id: 'cash', name: 'Cash', type: 'chequing', isDefault: true, createdAt: '2025-01-01' };
const card = { id: 'card', name: 'Card', type: 'credit', creditLimit: 500, createdAt: '2025-01-01' };
const row = (changes = {}) => ({ id: '20260410-113514-1234abcd', date: '2026-02-01', time: '11:35:14', amount: 10,
    type: 'expense', description: 'ORIGINAL CASE', category: 'food', account: 'chequing-cash', ...changes });
const legacyId = (suffix = 'abcde') => Date.parse('2026-04-10T17:35:14.123Z').toString(36) + suffix;
const plain = value => JSON.parse(JSON.stringify(value));
class Element {
    constructor(options = {}) { this.text = options.text || ''; this.children = []; this.listeners = {}; this.style = {}; }
    createEl(tag, options) { const child = new Element(options); child.tag = tag; this.children.push(child); return child; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    createSvg(tag, options) { return this.createEl(tag, options); }
    setCssProps(properties) { Object.assign(this.style ||= {}, properties); }
    setCssStyles(properties) { Object.assign(this.style ||= {}, properties); }
    addClass() {}
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    empty() { this.children = []; }
    find(text) { return this.children.find(child => child.text === text) || this.children.map(child => child.find(text)).find(Boolean); }
}
const text = element => [element.text, ...element.children.map(text)].join(' ');

function harness(files = new Map(), date = '2026-10-22T18:34:56.789Z') {
    const notices = [], dialogs = [], writes = [], reads = [];
    const events = new Map(), focusHandlers = [], layoutCallbacks = [];
    let focused = true;
    const document = { hasFocus: () => focused };
    const leaf = type => type === null ? null : ({ view: { getViewType: () => type, containerEl: { ownerDocument: document } } });
    class Clock extends Date {
        constructor(...args) { if (args.length) super(...args); else super(date); }
    }
    class Modal {
        constructor(app) { this.app = app; this.contentEl = new Element(); this.containerEl = new Element(); this.modalEl = new Element(); }
        open() { dialogs.push(this); this.onOpen(); }
        close() { this.onClose(); }
    }
    const obsidian = { Plugin: class {}, PluginSettingTab: class {}, Modal };
    const recovery = load('src/data-recovery-modal.ts', { obsidian });
    const Plugin = load('main.ts', { obsidian, './src/models': models,
        './src/dashboard-view': { EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
        './src/account-card': load('src/account-card.ts', { './models': models }),
        './src/transaction-import': preparation, './src/data-recovery-modal': recovery,
        './src/confirmation-modal': load('src/confirmation-modal.ts', { obsidian }),
        './src/notice': { showExpensicaNotice: message => notices.push(message) }
    }, { Date: Clock, window: {} }).default;
    const p = new Plugin();
    p.settings = { categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    // Exercise the real onload() ordering, with only host UI registration stubbed.
    p.loadData = async () => files.has('settings.json') ? JSON.parse(files.get('settings.json')) : p.settings;
    p.saveData = async data => p.app.vault.adapter.write('settings.json', JSON.stringify(data));
    p.addRibbonIcon = () => ({ addClass() {} });
    p.addCommand = p.registerView = () => {};
    p.addSettingTab = tab => { tab.display = () => {}; };
    p.registerEvent = () => {};
    p.registerDomEvent = (_target, name, callback) => { if (name === 'focus') focusHandlers.push(callback); };
    p.importTransactionsFromJSON = () => { throw Error('Startup must never reimport transactions'); };
    let failWrite = false;
    p.app = { vault: { createFolder: async () => {}, adapter: {
        exists: async file => file === p.dataFolderPath || files.has(file),
        read: async file => { reads.push(file); if (!files.has(file)) throw Error('Unavailable'); return files.get(file); },
        write: async (file, content) => { writes.push({ file, content }); if (failWrite) throw Error('disk full'); files.set(file, content); }
    } }, workspace: {
        getLeavesOfType: () => [], layoutReady: true,
        getActiveViewOfType() { return this.activeLeaf?.view; },
        activeLeaf: leaf('expensica-dashboard-view'),
        on(name, callback) { const callbacks = events.get(name) || []; callbacks.push(callback); events.set(name, callbacks); return {}; },
        onLayoutReady(callback) { if (this.layoutReady) callback(); else layoutCallbacks.push(callback); }
    } };
    p.refreshExpensicaViews = async () => {};
    return { p, notices, dialogs, writes, reads, files, failWrites(value) { failWrite = value; },
        activate(type = 'expensica-dashboard-view') {
            p.app.workspace.activeLeaf = leaf(type);
            for (const callback of events.get('active-leaf-change') || []) callback(p.app.workspace.activeLeaf);
        },
        focus(value) { focused = value; if (value) for (const callback of focusHandlers) callback(); },
        ready() { p.app.workspace.layoutReady = true; for (const callback of layoutCallbacks.splice(0)) callback(); },
        emit(name, ...args) { for (const callback of events.get(name) || []) callback(...args); },
        seed(transactions = [row()], accounts = [cash, card], extra = {}) {
            files.set(p.accountsFilePath, JSON.stringify({ accounts, lastUpdated: 'accounts' }));
            files.set(p.transactionsFilePath, JSON.stringify({ transactions, lastUpdated: 'transactions', ...extra }, null, 4));
            files.set(p.budgetFilePath, JSON.stringify({ budgets: [], lastUpdated: 'budgets' }));
        }
    };
}

function categoryHarness(id = 'salary', type = 'income', position = 'first') {
    const h = harness();
    const category = models.DEFAULT_CATEGORIES.find(category => category.id === id) || { id, name: 'Custom', type };
    const others = models.DEFAULT_CATEGORIES.filter(category => category.id !== id);
    h.p.settings.categories = position === 'first' ? [category, ...others] : [...others, category];
    h.p.settings.categoryEmojis = { [id]: 'custom emoji' };
    h.p.settings.categoryColors = { [id]: '#123456' };
    h.files.set('settings.json', JSON.stringify(h.p.settings));
    const transactions = [row({ type, category: id, notes: ' Preserve notes ', amount: 10.001, metadata: { keep: true } }),
        row({ id: '20260410-113514-00000001', category: 'groceries' })];
    h.seed(transactions);
    h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [
        { id: 'affected-1', categoryId: id, amount: 120, period: 'monthly' },
        { id: 'unrelated', categoryId: 'groceries', amount: 42, period: 'monthly' },
        { id: 'affected-2', categoryId: id, amount: 25, period: 'yearly' }
    ], lastUpdated: 'budgets' }));
    return h;
}

for (const [id, type, position] of [
    ['salary', 'income', 'first'], ['tax_returns', 'income', 'last'], ['custom-income', 'income', 'last'],
    ['food', 'expense', 'first'], ['taxes', 'expense', 'last'], ['custom-expense', 'expense', 'last']
]) {
    test(`category deletion: ${position} ${id} reassigns by transaction type, deletes only affected budgets, and restarts quietly`, async () => {
        const h = categoryHarness(id, type, position);
        await h.p.onload();
        const original = plain(h.p.getAllTransactions());
        const unrelatedBudget = plain(h.p.getAllBudgets()[1]);
        h.writes.length = h.notices.length = h.dialogs.length = 0;
        const pending = h.p.deleteCategory(id);
        const confirmation = h.dialogs[0];
        assert.equal(await confirmation.contentEl.find('Delete').listeners.click(), true);
        assert.equal(await pending, true);
        const expected = original.map((transaction, index) => index ? transaction : {
            ...transaction, category: type === 'income' ? 'other_income' : 'other_expense'
        });
        assert.deepEqual(plain(h.p.getAllTransactions()), expected);
        assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions, expected);
        assert.deepEqual(plain(h.p.getAllBudgets()), [unrelatedBudget]);
        assert.equal(h.p.getCategoryById(id), undefined);
        assert.equal(h.p.settings.categoryEmojis[id], undefined);
        assert.equal(h.p.settings.categoryColors[id], undefined);
        assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath, h.p.budgetFilePath, 'settings.json']);
        const committed = [...h.files];
        for (let index = 0; index < 2; index++) {
            const restart = harness(h.files);
            await restart.p.onload();
            assert.deepEqual([...restart.files], committed);
            assert.equal(restart.p.getCategoryById(id), undefined);
            assert.deepEqual(plain(restart.p.getAllTransactions()), expected);
            assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
        }
    });
}

test('category deletion: reassigns each affected record by its type even when the old category type differs', async () => {
    const h = categoryHarness();
    h.seed([row({ type: 'income', category: 'salary' }),
        row({ id: '20260410-113514-00000001', type: 'expense', category: 'salary' })]);
    await h.p.loadSettings();
    await h.p.loadAccountsData();
    h.p.transactionsData.transactions = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    const pending = h.p.deleteCategory('salary');
    await h.dialogs[0].contentEl.find('Delete').listeners.click();
    assert.equal(await pending, true);
    assert.deepEqual(plain(h.p.getAllTransactions()).map(transaction => transaction.category), ['other_income', 'other_expense']);
});

for (const id of ['other_income', 'other_expense']) {
    test(`category deletion: ${id} is protected and cannot be removed by legacy deletion settings`, async () => {
        const h = harness();
        h.seed();
        h.p.settings.categories = models.DEFAULT_CATEGORIES.filter(category => category.id !== id);
        h.p.settings.deletedDefaultCategoryIds = [id];
        await h.p.onload();
        const files = [...h.files];
        assert.ok(h.p.getCategoryById(id));
        assert.equal(await h.p.deleteCategory(id), false);
        assert.deepEqual([...h.files], files);
        assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
        assert.ok(!h.p.settings.deletedDefaultCategoryIds.includes(id));
    });
}

test('category deletion: cancelling changes nothing; deleting an unused category writes only settings', async () => {
    const h = harness();
    h.seed();
    await h.p.onload();
    const files = [...h.files];
    const pending = h.p.deleteCategory('salary');
    h.dialogs[0].close();
    assert.equal(await pending, false);
    assert.deepEqual([...h.files], files);
    assert.equal(h.writes.length, 0);
    const deletion = h.p.deleteCategory('salary');
    await h.dialogs[1].contentEl.find('Delete').listeners.click();
    assert.equal(await deletion, true);
    assert.deepEqual(h.writes.map(write => write.file), ['settings.json']);
});

test('category deletion: internal definition can be removed without being restored on restart', async () => {
    const h = harness();
    h.seed();
    await h.p.onload();
    const pending = h.p.deleteCategory('internal');
    await h.dialogs[0].contentEl.find('Delete').listeners.click();
    assert.equal(await pending, true);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.p.getCategoryById('internal'), undefined);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

for (const failed of ['transactions', 'budgets', 'settings']) {
    test(`category deletion: failed ${failed} save retains the category and safely retries after restart`, async () => {
        const h = categoryHarness();
        await h.p.onload();
        const source = new Map(h.files);
        const original = plain(h.p.getAllTransactions());
        const originalBudgets = plain(h.p.getAllBudgets());
        const originalSettings = plain(h.p.settings);
        h.writes.length = h.dialogs.length = h.notices.length = 0;
        const write = h.p.app.vault.adapter.write;
        const failedPath = failed === 'transactions' ? h.p.transactionsFilePath : failed === 'budgets' ? h.p.budgetFilePath : 'settings.json';
        h.p.app.vault.adapter.write = async (file, content) => {
            if (file === failedPath) throw Error('disk full');
            await write(file, content);
        };
        const pending = h.p.deleteCategory('salary');
        const confirmation = h.dialogs[0];
        assert.equal(await confirmation.contentEl.find('Delete').listeners.click(), false);
        assert.ok(h.p.getCategoryById('salary'));
        assert.deepEqual(plain(h.p.settings), originalSettings);
        assert.equal(h.files.get('settings.json'), source.get('settings.json'));
        assert.equal(h.notices.some(message => /Changes saved|successfully/.test(message)), false);
        if (failed === 'transactions') {
            assert.deepEqual([...h.files], [...source]);
            assert.deepEqual(plain(h.p.getAllTransactions()), original);
        } else {
            assert.equal(h.p.getAllTransactions()[0].category, 'other_income');
        }
        if (failed !== 'settings') assert.deepEqual(plain(h.p.getAllBudgets()), originalBudgets);
        const restart = harness(h.files);
        await restart.p.onload();
        assert.ok(restart.p.getCategoryById('salary'));
        assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
        confirmation.close();
        assert.equal(await pending, false);
        const retry = restart.p.deleteCategory('salary');
        await restart.dialogs[0].contentEl.find('Delete').listeners.click();
        assert.equal(await retry, true);
        assert.equal(restart.p.getAllTransactions()[0].category, 'other_income');
        assert.deepEqual(plain(restart.p.getAllBudgets()).map(budget => budget.id), ['unrelated']);
        assert.equal(restart.p.getCategoryById('salary'), undefined);
        const final = harness(restart.files);
        await final.p.onload();
        assert.equal(final.writes.length + final.notices.length + final.dialogs.length, 0);
    });
}

test('category deletion: pending reassignment and queued additions cannot leave a deleted reference', async () => {
    const h = categoryHarness();
    await h.p.onload();
    const write = h.p.app.vault.adapter.write;
    let finish;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (file === h.p.transactionsFilePath && !finish) await new Promise(resolve => { finish = resolve; });
        await write(file, content);
    };
    const pending = h.p.deleteCategory('salary');
    const submitting = h.dialogs[0].contentEl.find('Delete').listeners.click();
    await new Promise(setImmediate);
    assert.ok(h.p.getCategoryById('salary'));
    assert.equal(h.p.getAllTransactions()[0].category, 'salary');
    const addition = h.p.addTransaction(row({ id: '20260410-113514-00000002', type: 'income', category: 'salary' }));
    finish();
    await submitting;
    assert.equal(await pending, true);
    await addition;
    assert.equal(h.p.getAllTransactions().filter(transaction => transaction.category === 'salary').length, 0);
    assert.equal(h.p.getAllTransactions().at(-1).category, 'other_income');
});

test('category deletion: the same confirmation retries a failed budget write without repeating committed reassignment', async () => {
    const h = categoryHarness();
    await h.p.onload();
    const write = h.p.app.vault.adapter.write;
    let fail = true;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (fail && file === h.p.budgetFilePath) throw Error('disk full');
        await write(file, content);
    };
    const pending = h.p.deleteCategory('salary');
    const confirmation = h.dialogs[0];
    assert.equal(await confirmation.contentEl.find('Delete').listeners.click(), false);
    const transactions = h.files.get(h.p.transactionsFilePath);
    assert.equal(h.p.getAllTransactions()[0].category, 'other_income');
    assert.ok(h.p.getCategoryById('salary'));
    fail = false;
    assert.equal(await confirmation.contentEl.find('Delete').listeners.click(), true);
    assert.equal(await pending, true);
    assert.equal(h.files.get(h.p.transactionsFilePath), transactions);
    assert.equal(h.writes.filter(write => write.file === h.p.transactionsFilePath).length, 1);
    assert.equal(h.p.getCategoryById('salary'), undefined);
});

for (const dataset of ['transactions', 'budgets']) {
    test(`category deletion: protected ${dataset} prevents every deletion write`, async () => {
        const h = categoryHarness();
        await h.p.onload();
        const source = [...h.files];
        h.p.protectDataset(dataset, Error('invalid source'));
        const dialogCount = h.dialogs.length;
        const pending = h.p.deleteCategory('salary');
        await h.dialogs[dialogCount].contentEl.find('Delete').listeners.click();
        assert.deepEqual([...h.files], source);
        assert.ok(h.p.getCategoryById('salary'));
        h.dialogs[dialogCount].close();
        assert.equal(await pending, false);
    });
}

test('category normalization: unknown, missing, and wrong-type categories follow transaction type on startup/import/save', async () => {
    const references = ['unknown', 'unknown_category', 'unknown category', 'deleted-custom', '', null, undefined];
    const input = ['income', 'expense'].flatMap(type => [...references, type === 'income' ? 'food' : 'salary'].map((category, index) => row({
        id: `20260410-113514-${type === 'income' ? 'a' : 'b'}${String(index).padStart(7, '0')}`, type, category
    })));
    const h = harness();
    h.seed(input);
    await h.p.onload();
    const expected = input.map(transaction => ({ ...transaction, category: transaction.type === 'income' ? 'other_income' : 'other_expense' }));
    assert.deepEqual(plain(h.p.getAllTransactions()), expected);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.match(h.notices[0], /Categories assigned: 16/);
    const source = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), source);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    for (const protectedAccounts of [false, true]) {
        if (protectedAccounts) h.p.protectDataset('accounts');
        for (const transaction of input) {
            assert.equal(h.p.normalizeTransactionForSave(transaction).category, transaction.type === 'income' ? 'other_income' : 'other_expense');
        }
    }
    const imported = harness();
    imported.seed([]);
    await imported.p.onload();
    imported.files.set('import.json', JSON.stringify({ transactions: input }));
    await Object.getPrototypeOf(imported.p).importTransactionsFromJSON.call(imported.p, 'import.json');
    assert.deepEqual(plain(imported.p.getAllTransactions()), expected);
});

test('category normalization: failed startup correction retains source data and reports only after successful retry', async () => {
    const h = harness();
    const input = [row({ type: 'income', category: 'deleted-income', notes: 'Keep me', amount: 0.001 })];
    h.seed(input);
    const source = h.files.get(h.p.transactionsFilePath);
    h.failWrites(true);
    await h.p.onload();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.notices.length, 0);
    h.failWrites(false);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.deepEqual(plain(h.p.getAllTransactions()), [{ ...input[0], category: 'other_income' }]);
    assert.match(h.notices[0], /Categories assigned: 1/);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

for (const [label, accounts] of [
    ['Cash as the only default', [cash, card]],
    ['inactive built-in account first', [{ ...models.DEFAULT_ACCOUNT, isDefault: false }, cash, card]],
    ['inactive built-in account last', [cash, card, { ...models.DEFAULT_ACCOUNT, isDefault: false }]]
]) {
    test(`default-account: ${label} resolves missing, empty, and null references without changing explicit accounts`, async () => {
        const h = harness();
        const references = [undefined, '', null, 'chequing-cash', 'credit-card'];
        if (accounts.some(account => account.id === models.DEFAULT_ACCOUNT_ID)) references.push('other-default');
        const input = references.map((account, index) => row({ id: `20260410-113514-${String(index).padStart(8, '0')}`,
            account, amount: index + 0.001, notes: 'Keep notes', metadata: { keep: index } }));
        h.seed(input, accounts);
        const accountFile = h.files.get(h.p.accountsFilePath);
        await h.p.onload();
        assert.equal(h.p.getDefaultAccount().id, cash.id);
        const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.deepEqual(saved, input.map((transaction, index) => ({ ...transaction, account: index < 3 ? 'chequing-cash' : transaction.account })));
        assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
        assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
        assert.match(h.notices[0], /Accounts assigned: 3/);
        assert.deepEqual(h.reads.slice(0, 3), [h.p.accountsFilePath, h.p.transactionsFilePath, h.p.budgetFilePath]);
        const committed = h.files.get(h.p.transactionsFilePath);
        const restart = harness(h.files, '2027-01-01T00:00:00Z');
        await restart.p.onload();
        assert.equal(restart.p.getDefaultAccount().id, cash.id);
        assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
        assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    });
}

test('default-account: valid explicit references need no migration even when the real default differs from the built-in account', async () => {
    const h = harness();
    const input = [row({ account: 'credit-card' }), row({ id: '20260410-113514-00000001', account: 'other-default' })];
    h.seed(input, [{ ...models.DEFAULT_ACCOUNT, isDefault: false }, cash, card]);
    const source = h.files.get(h.p.transactionsFilePath);
    await h.p.onload();
    assert.equal(h.p.getDefaultAccount().id, cash.id);
    assert.deepEqual(plain(h.p.getAllTransactions()), input);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
});

test('default-account: startup waits for pending account reads before resolving or writing transactions', async () => {
    const h = harness();
    h.seed([row({ account: '' })]);
    const source = h.files.get(h.p.transactionsFilePath);
    const read = h.p.app.vault.adapter.read;
    const reads = [];
    let finish;
    h.p.app.vault.adapter.read = async file => {
        reads.push(file);
        if (file === h.p.accountsFilePath) await new Promise(resolve => { finish = resolve; });
        return read(file);
    };
    const loading = h.p.onload();
    await new Promise(setImmediate);
    assert.deepEqual(reads, [h.p.accountsFilePath]);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
    finish();
    await loading;
    assert.equal(h.p.getAllTransactions()[0].account, 'chequing-cash');
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
});

test('default-account: account read failures defer reference migration until real definitions recover', async () => {
    const h = harness();
    const input = [undefined, '', null, 'credit-card'].map((account, index) => row({
        id: `20260410-113514-${String(index).padStart(8, '0')}`, account, notes: 'Keep this' }));
    h.seed(input, [{ ...models.DEFAULT_ACCOUNT, isDefault: false }, cash, card]);
    const source = h.files.get(h.p.transactionsFilePath);
    const read = h.p.app.vault.adapter.read;
    h.p.app.vault.adapter.read = file => file === h.p.accountsFilePath ? Promise.reject(Error('Unavailable')) : read(file);
    await h.p.onload();
    assert.equal(h.p.isAccountDataProtected(), true);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.deepEqual(plain(h.p.getAllTransactions()), plain(input));
    assert.equal(h.writes.length + h.notices.length, 0);
    h.p.app.vault.adapter.read = read;
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.deepEqual(plain(h.p.getAllTransactions()), input.map((transaction, index) => ({
        ...transaction, account: index < 3 ? 'chequing-cash' : transaction.account
    })));
    assert.equal(h.p.getDefaultAccount().id, cash.id);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('startup removes only transaction legacyId metadata once, retaining IDs and financial data without reports', async () => {
    const h = harness();
    const input = [row({ legacyId: 'old-source', amount: 0.001, notes: ' Keep notes ', metadata: { legacyId: 'Keep nested metadata' } }),
        row({ id: '20260410-113514-00000001', legacyId: { obsolete: true }, amount: 0 })];
    h.seed(input, [cash, card], { metadata: { legacyId: 'Keep envelope metadata' } });
    h.activate('markdown');
    await h.p.onload();
    const committed = h.files.get(h.p.transactionsFilePath);
    const saved = JSON.parse(committed);
    assert.deepEqual(saved.transactions, input.map(({ legacyId, ...fields }) => fields));
    assert.deepEqual(saved.metadata, { legacyId: 'Keep envelope metadata' });
    assert.deepEqual(plain(h.p.getAllTransactions()), saved.transactions);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    h.activate();
    assert.equal(h.notices.length + h.dialogs.length, 0);
    await h.p.loadTransactionsData();
    assert.equal(h.writes.length, 1);
    const restart = harness(h.files, '2027-01-01T00:00:00Z');
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('modern IDs survive date/time edits, metadata edits, and a fresh startup unchanged', async () => {
    const h = harness();
    const original = row({ notes: 'Keep notes', metadata: { keep: true } });
    h.seed([original]);
    await h.p.onload();
    await h.p.updateTransaction({ ...original, date: '2032-01-02', time: '22:23:24', amount: 12.345 });
    await h.p.updateTransactions([original.id], { id: 'attempted-replacement', time: '00:00:01' });
    const committed = h.files.get(h.p.transactionsFilePath);
    assert.equal(h.p.getAllTransactions()[0].id, original.id);
    const restart = harness(h.files, '2027-01-01T00:00:00Z');
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.p.getAllTransactions()[0].id, original.id);
    assert.equal(restart.p.getAllTransactions()[0].date, '2032-01-02');
    assert.equal(restart.p.getAllTransactions()[0].time, '00:00:01');
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('failed metadata cleanup preserves the source and committed memory until P0 recovery succeeds', async () => {
    const h = harness();
    const original = row({ legacyId: 'old-source', notes: 'Keep this' });
    h.seed([original]);
    const source = h.files.get(h.p.transactionsFilePath);
    await h.p.loadAccountsData();
    const previous = row({ id: '20260410-113514-00000001', amount: 25 });
    h.p.transactionsData.transactions = [previous];
    h.failWrites(true);
    await h.p.loadTransactionsData();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.deepEqual(plain(h.p.getAllTransactions()), [previous]);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    h.failWrites(false);
    assert.equal(await h.p.retryDataRecovery(), true);
    const { legacyId: discarded, ...expected } = original;
    assert.deepEqual(plain(h.p.getAllTransactions()), [expected]);
    assert.equal(h.notices.length, 0);
    assert.equal(h.dialogs.length, 1, 'metadata cleanup opens no success report');
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

for (const input of [[], [row({ id: '20260410-113514-00000002', amount: 0.001, notes: ' Keep exact notes ' }),
    row({ id: '20260410-113514-00000001', amount: 0, notes: 'Second note', metadata: { keep: true } })]]) {
    test(`startup converts a valid ${input.length}-record root array once, preserving records and order`, async () => {
        const h = harness();
        h.seed();
        const source = JSON.stringify(input);
        h.files.set(h.p.transactionsFilePath, source);
        assert.equal(preparation.prepareTransactions(input, [], new Date('2026-10-22T18:34:56.789Z'), [cash, card], true).changed, 0);
        await h.p.onload();
        const committed = h.files.get(h.p.transactionsFilePath);
        const saved = JSON.parse(committed);
        assert.deepEqual(Object.keys(saved), ['transactions', 'lastUpdated']);
        assert.deepEqual(saved.transactions, input);
        assert.equal(saved.lastUpdated, '2026-10-22T18:34:56.789Z');
        assert.deepEqual(plain(h.p.getAllTransactions()), input);
        assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
        assert.equal(h.dialogs.length, 1);
        assert.deepEqual(h.dialogs[0].contentEl.children.find(child => child.tag === 'ul').children.map(child => child.text), ['Legacy array format converted: 1']);
        assert.match(h.notices[0], /Legacy array format converted: 1/);
        const restart = harness(h.files);
        await restart.p.onload();
        assert.equal(restart.files.get(h.p.transactionsFilePath), committed);
        assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    });
}

test('root arrays reuse legacy ID, time, amount, and collision migration in one transaction write', async () => {
    const h = harness();
    h.seed();
    const input = [row({ id: legacyId(), time: undefined, amount: '10.50', notes: 'First original note' }),
        row({ id: legacyId(), time: undefined, amount: 0.001, description: 'SECOND', notes: 'Second original note' })];
    h.files.set(h.p.transactionsFilePath, JSON.stringify(input));
    await h.p.onload();
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.equal(saved.length, 2);
    assert.equal(new Set(saved.map(transaction => transaction.id)).size, 2);
    assert.deepEqual(saved.map(transaction => transaction.amount), [10.5, 0.001]);
    assert.deepEqual(saved.map(transaction => transaction.date), input.map(transaction => transaction.date));
    assert.deepEqual(saved.map(transaction => transaction.notes), input.map(transaction => transaction.notes));
    assert.equal(saved[0].time, saved[1].time);
    assert.equal(h.writes.length, 1);
    for (const correction of ['Legacy array format converted: 1', 'Base36 legacy IDs regenerated: 1', 'Duplicate IDs regenerated: 1',
        'Amounts converted from strings: 1', 'Time stamps recovered from IDs: 2']) assert.ok(text(h.dialogs[0].contentEl).includes(correction));
});

test('malformed root arrays preserve all committed memory and source bytes on load, retry, and restart', async () => {
    for (const invalid of [[row(), null], [row(), row({ id: '20260410-113514-00000001', amount: -1 })],
        [row(), row()], [row(), []]]) {
        const h = harness();
        h.seed();
        await h.p.onload();
        const memory = plain(h.p.getAllTransactions());
        const source = JSON.stringify(invalid);
        h.files.set(h.p.transactionsFilePath, source);
        await h.p.loadTransactionsData();
        assert.equal(h.files.get(h.p.transactionsFilePath), source);
        assert.deepEqual(plain(h.p.getAllTransactions()), memory);
        assert.equal(h.p.protectedDatasets.has('transactions'), true);
        assert.match(h.p.loadFailureMessages.get('transactions'), /transactions\[1\]\./);
        assert.equal(await h.p.retryDataRecovery(), false);
        assert.equal(h.writes.length + h.notices.length, 0);
        const restart = harness(h.files);
        await restart.p.onload();
        assert.equal(restart.p.getAllTransactions().length, 0);
        assert.equal(restart.p.protectedDatasets.has('transactions'), true);
        assert.equal(restart.files.get(restart.p.transactionsFilePath), source);
        assert.equal(restart.writes.length + restart.notices.length, 0);
    }
});

test('root-array conversion failures use P0 recovery and report conversion only after a successful save', async () => {
    const h = harness();
    h.seed();
    const source = JSON.stringify([row({ notes: 'Keep me' })]);
    h.files.set(h.p.transactionsFilePath, source);
    h.failWrites(true);
    await h.p.onload();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    assert.doesNotMatch(text(h.dialogs[0].contentEl), /Legacy array format converted/);
    h.failWrites(false);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(Array.isArray(JSON.parse(h.files.get(h.p.transactionsFilePath))), false);
    assert.equal(h.p.getAllTransactions()[0].notes, 'Keep me');
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /Legacy array format converted: 1/);
    assert.equal(h.writes.length, 2, 'one failed attempt and one successful conversion');
});

test('pending array conversion publishes no transaction records or migration report before persistence', async () => {
    const h = harness();
    h.seed();
    const source = JSON.stringify([row()]);
    h.files.set(h.p.transactionsFilePath, source);
    const write = h.p.app.vault.adapter.write;
    let finish;
    h.p.app.vault.adapter.write = (file, content) => new Promise(resolve => {
        finish = async () => { await write(file, content); resolve(); };
    });
    const loading = h.p.onload();
    await new Promise(setImmediate);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.notices.length + h.dialogs.length, 0);
    await finish();
    await loading;
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /Legacy array format converted: 1/);
});

test('corrupt accounts defer raw-array validation/conversion until account recovery', async () => {
    const h = harness();
    h.seed();
    const source = JSON.stringify([row()]);
    h.files.set(h.p.transactionsFilePath, source);
    h.files.set(h.p.accountsFilePath, '{broken');
    await h.p.onload();
    assert.equal(h.p.protectedDatasets.has('accounts'), true);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length, 0);
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [cash, card] }));
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.match(h.notices[0], /Legacy array format converted: 1/);
});

test('startup reconciles missing accounts in a root array and saves one canonical envelope on confirmation', async () => {
    const h = harness();
    const original = row({ account: 'saving-missing', notes: 'Keep original notes' });
    h.seed();
    const source = JSON.stringify([original]);
    h.files.set(h.p.transactionsFilePath, source);
    await h.p.onload();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length, 0);
    assert.ok(h.dialogs[0].contentEl.find('Missing accounts'));
    const owner = await h.p.openAccountReconciliation();
    owner.choices.set('saving-missing', cash.id);
    assert.equal(await owner.confirm(), true);
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath));
    assert.deepEqual(saved.transactions, [{ ...original, account: 'chequing-cash' }]);
    assert.deepEqual(Object.keys(saved), ['transactions', 'lastUpdated']);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.match(h.notices[0], /Legacy array format converted: 1/);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('manual legacy-array import appends once to the canonical ledger and subsequent startup stays unchanged', async () => {
    const h = harness();
    h.seed([row()], [cash, card], { metadata: { keep: true } });
    await h.p.onload();
    const original = row({ id: '20260410-113514-00000001', notes: 'Imported note' });
    const source = JSON.stringify([original]);
    h.files.set('import.json', source);
    const importFile = Object.getPrototypeOf(h.p).importTransactionsFromJSON.bind(h.p);
    assert.equal(await importFile('import.json'), true);
    const committed = h.files.get(h.p.transactionsFilePath);
    const saved = JSON.parse(committed);
    assert.deepEqual(saved.transactions, [row(), original]);
    assert.deepEqual(saved.metadata, { keep: true });
    assert.equal(h.files.get('import.json'), source);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.match(h.notices[0], /Legacy array format converted: 1/);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('invalid root structures explain both supported JSON formats instead of generic structural errors', async () => {
    for (const value of [null, 42, {}, { transactions: {} }, 'transactions']) {
        const h = harness();
        h.seed();
        const source = JSON.stringify(value);
        h.files.set(h.p.transactionsFilePath, source);
        await h.p.onload();
        const message = h.p.loadFailureMessages.get('transactions');
        assert.match(message, /expected a JSON object containing a "transactions" array/);
        assert.match(message, /legacy root-level array of transaction objects/);
        assert.equal(h.files.get(h.p.transactionsFilePath), source);
        assert.equal(h.writes.length + h.notices.length, 0);
    }
});

for (const activeType of [null, 'markdown']) {
    for (const dataset of ['transactions', 'accounts', 'budgets', 'missing accounts']) {
        test(`startup defers ${dataset} recovery with ${activeType || 'no'} active view until Expensica receives focus`, async () => {
            const h = harness();
            h.seed(dataset === 'missing accounts' ? [row({ account: 'saving-missing' })] : [row()]);
            if (dataset !== 'missing accounts') {
                h.files.set(dataset === 'transactions' ? h.p.transactionsFilePath
                    : dataset === 'accounts' ? h.p.accountsFilePath : h.p.budgetFilePath, '{broken');
            }
            const originals = Array.from(h.files);
            h.activate(activeType);
            h.p.app.workspace.layoutReady = false;
            // A restored but inactive dashboard must not authorize a dialog.
            h.p.app.workspace.getLeavesOfType = () => [{ view: { containerEl: { children: [] } } }];
            await h.p.onload();
            h.ready();
            assert.equal(h.dialogs.length + h.notices.length + h.writes.length, 0);
            assert.ok(h.p.protectedDatasets.size > 0);
            const reads = h.reads.length;
            h.activate('markdown');
            assert.equal(h.dialogs.length, 0);
            h.activate();
            assert.equal(h.dialogs.length, 1);
            assert.ok(h.dialogs[0].contentEl.find(dataset === 'missing accounts' ? 'Missing accounts' : 'Expensica data could not be loaded'));
            assert.equal(h.reads.length, reads, 'focusing only displays stored validation results');
            h.focus(true);
            h.activate();
            assert.equal(h.dialogs.length, 1, 'focus events do not stack recovery dialogs');
            h.dialogs[0].close();
            h.activate('markdown');
            h.activate();
            assert.equal(h.dialogs.length, 1, 'dismissed errors remain on cards without repeatedly opening');
            assert.deepEqual(Array.from(h.files), originals);
            assert.equal(h.writes.length, 0);
        });
    }
}

test('focused startup waits for layout readiness and actual window focus before showing recovery', async () => {
    const h = harness();
    h.seed();
    h.files.set(h.p.transactionsFilePath, '{broken');
    h.p.app.workspace.layoutReady = false;
    h.focus(false);
    await h.p.onload();
    assert.equal(h.dialogs.length, 0);
    h.ready();
    h.activate();
    assert.equal(h.dialogs.length, 0, 'an active Expensica tab in an unfocused window is insufficient');
    h.focus(true);
    assert.equal(h.dialogs.length, 1);
    assert.ok(h.dialogs[0].contentEl.find('Expensica data could not be loaded'));
    assert.equal(h.writes.length, 0);
});

test('startup migrations persist in the background and report once when Expensica is focused', async () => {
    const h = harness();
    h.seed([row({ id: legacyId(), time: undefined, notes: 'Preserve me' })]);
    h.activate('markdown');
    await h.p.onload();
    assert.equal(h.writes.length, 1);
    assert.equal(h.dialogs.length + h.notices.length, 0);
    const committed = h.files.get(h.p.transactionsFilePath);
    assert.equal(JSON.parse(committed).transactions[0].notes, 'Preserve me');
    const reads = h.reads.length;
    h.activate();
    assert.equal(h.dialogs.length, 1);
    assert.equal(h.notices.length, 1);
    assert.ok(h.dialogs[0].contentEl.find('Base36 legacy IDs regenerated: 1'));
    assert.equal(h.reads.length, reads);
    h.activate('markdown');
    h.activate();
    assert.equal(h.dialogs.length, 1);
    assert.equal(h.writes.length, 1);
    const restart = harness(h.files);
    restart.activate('markdown');
    await restart.p.onload();
    restart.activate();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.dialogs.length + restart.notices.length, 0);
});

test('resolved background failures do not open stale dialogs on subsequent focus', async () => {
    const h = harness();
    h.seed();
    const valid = h.files.get(h.p.transactionsFilePath);
    h.files.set(h.p.transactionsFilePath, '{broken');
    h.activate('markdown');
    await h.p.onload();
    assert.equal(h.dialogs.length, 0);
    h.files.set(h.p.transactionsFilePath, valid);
    assert.equal(await h.p.retryDataRecovery(), true);
    h.activate();
    assert.equal(h.dialogs.length + h.notices.length + h.writes.length, 0);
    assert.equal(h.p.protectedDatasets.size, 0);
});

test('an in-flight save failure after leaving Expensica defers details and preserves the original data', async () => {
    const h = harness();
    h.seed();
    await h.p.onload();
    const original = h.files.get(h.p.transactionsFilePath);
    const memory = plain(h.p.getAllTransactions());
    let rejectWrite;
    h.p.app.vault.adapter.write = () => new Promise((_resolve, reject) => { rejectWrite = reject; });
    const owner = {};
    const save = h.p.runSaveOperation(owner, 'Add transaction', () => h.p.addTransaction(row({ id: '20260410-113514-00000001' })));
    await new Promise(setImmediate);
    h.activate('markdown');
    rejectWrite(Error('disk full'));
    assert.equal(await save, false);
    assert.equal(h.dialogs.length, 0);
    assert.equal(h.p.hasSaveFailure(owner), true);
    h.activate();
    assert.equal(h.dialogs.length, 1);
    assert.ok(h.dialogs[0].contentEl.find('Add transaction could not be saved'));
    assert.match(text(h.dialogs[0].contentEl), /not enough storage space/);
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.deepEqual(plain(h.p.getAllTransactions()), memory);
});

test('recovery and saved migration reports are deferred without stacking and are discarded on unload', async () => {
    const h = harness();
    h.seed([row({ id: legacyId(), time: undefined })]);
    h.files.set(h.p.budgetFilePath, '{broken');
    h.activate('markdown');
    await h.p.onload();
    assert.equal(h.dialogs.length + h.notices.length, 0);
    h.activate();
    assert.equal(h.dialogs.length, 1);
    assert.ok(h.dialogs[0].contentEl.find('Expensica data could not be loaded'));
    assert.equal(h.notices.length, 0, 'recovery takes precedence over a saved migration report');
    h.dialogs[0].close();
    assert.equal(h.dialogs.length, 2);
    assert.ok(h.dialogs[1].contentEl.find('Transaction data update'));
    assert.equal(h.notices.length, 1);

    const unloaded = harness();
    unloaded.seed([row({ id: legacyId(), time: undefined })]);
    unloaded.files.set(unloaded.p.budgetFilePath, '{broken');
    unloaded.activate('markdown');
    unloaded.p.app.workspace.layoutReady = false;
    await unloaded.p.onload();
    unloaded.p.onunload();
    unloaded.activate();
    unloaded.ready();
    unloaded.focus(true);
    assert.equal(unloaded.dialogs.length + unloaded.notices.length, 0);
});

test('failed background startup migration preserves the file and defers only recovery details', async () => {
    const h = harness();
    h.seed([row({ id: legacyId(), time: undefined })]);
    const original = h.files.get(h.p.transactionsFilePath);
    h.activate('markdown');
    h.failWrites(true);
    await h.p.onload();
    assert.equal(h.dialogs.length + h.notices.length, 0);
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    h.activate();
    assert.equal(h.dialogs.length, 1);
    assert.ok(h.dialogs[0].contentEl.find('Expensica data could not be loaded'));
    assert.equal(h.dialogs[0].contentEl.find('Transaction data update'), undefined);
    assert.equal(h.notices.length, 0);
});

test('deferred recovery respects the focused view document in an Obsidian popout', async () => {
    const h = harness();
    h.seed();
    h.files.set(h.p.transactionsFilePath, '{broken');
    h.activate('markdown');
    const focusHandlers = new Map();
    h.p.registerDomEvent = (target, name, callback) => { if (name === 'focus') focusHandlers.set(target, callback); };
    await h.p.onload();
    const popout = {};
    h.emit('window-open', {}, popout);
    let focused = false;
    h.p.app.workspace.activeLeaf = { view: { getViewType: () => 'expensica-dashboard-view',
        containerEl: { ownerDocument: { hasFocus: () => focused } } } };
    h.emit('active-leaf-change', h.p.app.workspace.activeLeaf);
    assert.equal(h.dialogs.length, 0);
    focused = true;
    focusHandlers.get(popout)();
    assert.equal(h.dialogs.length, 1);
    assert.equal(h.writes.length, 0);
});

test('startup persists capitalization silently once and subsequent restarts leave the file unchanged', async () => {
    const h = harness();
    const original = row({ description: '  Mixed\tcase\ntext  ', amount: 0.001, notes: 'Keep Original Case', metadata: { description: 'Keep this' } });
    h.seed([original], [cash, card], { metadata: 'Keep envelope' });
    const accountFile = h.files.get(h.p.accountsFilePath);
    await h.p.onload();
    const committed = h.files.get(h.p.transactionsFilePath);
    assert.deepEqual(JSON.parse(committed).transactions, [{ ...original, description: '  MIXED\tCASE\nTEXT  ' }]);
    assert.equal(JSON.parse(committed).metadata, 'Keep envelope');
    assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.equal(h.dialogs.length + h.notices.length, 0);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.dialogs.length + restart.notices.length, 0);
});

test('failed capitalization saves preserve original disk/memory and retry silently after successful persistence', async () => {
    const h = harness();
    h.seed([row({ description: 'Keep original until saved' })]);
    const original = h.files.get(h.p.transactionsFilePath);
    h.failWrites(true);
    await h.p.onload();
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    assert.ok(h.dialogs[0].contentEl.find('Expensica data could not be loaded'));
    h.failWrites(false);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0].description, 'KEEP ORIGINAL UNTIL SAVED');
    assert.equal(h.notices.length, 0);
    assert.equal(h.dialogs.length, 1, 'successful capitalization does not open a report');
});

test('startup rejects an invalid batch without persisting capitalization of its valid records', async () => {
    const h = harness();
    h.seed([row({ description: 'Keep original' }), row({ id: '20260410-113514-00000001', amount: -1 })]);
    const original = h.files.get(h.p.transactionsFilePath);
    await h.p.onload();
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.equal(h.writes.length, 0);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
});

test('onload reads accounts first, replaces the collection without reimporting, and migrates once', async () => {
    const h = harness();
    const input = [row({ id: legacyId(), time: undefined, account: undefined, notes: undefined, metadata: { keep: true } }),
        row({ id: '20260410-113514-z9y8x7w6', date: '2026-01-02T12:00:00-06:00', time: undefined, account: null }),
        row({ id: 'opaque', time: undefined, account: '' })];
    h.seed(input, [cash, card], { customMetadata: { keep: 'envelope' } });
    const accountFile = h.files.get(h.p.accountsFilePath);
    h.p.transactionsData.transactions = [row({ id: 'stale', account: 'saving-no-longer-present' })];
    await h.p.onload();
    assert.deepEqual(h.reads.slice(0, 3), [h.p.accountsFilePath, h.p.transactionsFilePath, h.p.budgetFilePath]);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath));
    assert.deepEqual(saved.customMetadata, { keep: 'envelope' });
    assert.equal(saved.transactions.length, input.length);
    assert.ok(saved.transactions.every(transaction => transaction.account === 'chequing-cash' && !Object.hasOwn(transaction, 'notes')));
    assert.equal(saved.transactions[0].time, models.formatTime(new Date('2026-04-10T17:35:14.123Z')));
    assert.equal(saved.transactions[0].legacyId, undefined);
    assert.deepEqual(saved.transactions[0].metadata, { keep: true });
    assert.equal(saved.transactions[1].time, '11:35:14');
    assert.equal(saved.transactions[2].time, models.formatTime(new Date('2026-10-22T18:34:56.789Z')));
    assert.deepEqual(saved.transactions.map(transaction => transaction.date), input.map(transaction => transaction.date));
    assert.deepEqual(saved.transactions.map(transaction => transaction.description), input.map(transaction => transaction.description));
    assert.deepEqual(plain(h.p.getAllTransactions()), saved.transactions);
    assert.equal(h.notices.length, 1);
    assert.equal(h.dialogs.length, 1);
    assert.ok(h.dialogs[0].contentEl.find('Transaction data update'));
    assert.ok(h.dialogs[0].contentEl.find('Time stamps recovered from IDs: 2'));
    assert.ok(h.dialogs[0].contentEl.find('Time stamps generated: 1'));
    assert.ok(h.dialogs[0].contentEl.find('Base36 legacy IDs regenerated: 1'));
    assert.ok(h.dialogs[0].contentEl.find('Alien IDs regenerated: 1'));
    assert.ok(h.dialogs[0].contentEl.find('Accounts assigned: 3'));
    assert.equal(h.dialogs[0].contentEl.find('Notes initialized: 1'), undefined);
    assert.equal(h.dialogs[0].contentEl.find('Duplicate IDs regenerated: 0'), undefined);
    assert.match(h.notices[0], /Time stamps recovered from IDs: 2; Time stamps generated: 1/);
});

test('repeated fresh restarts validate every time and never rewrite or announce unchanged transactions', async () => {
    const first = harness();
    first.seed([row({ id: legacyId(), time: undefined }), row({ id: 'opaque', time: undefined })]);
    await first.p.onload();
    const committed = first.files.get(first.p.transactionsFilePath);
    const expected = plain(first.p.getAllTransactions());
    for (const date of ['2026-10-23T00:00:00Z', '2027-01-01T23:59:59Z']) {
        const restarted = harness(first.files, date);
        await restarted.p.onload();
        assert.equal(restarted.files.get(restarted.p.transactionsFilePath), committed);
        assert.deepEqual(plain(restarted.p.getAllTransactions()), expected);
        assert.equal(restarted.writes.length + restarted.notices.length + restarted.dialogs.length, 0);
        assert.ok(restarted.reads.includes(restarted.p.transactionsFilePath));
    }
});

test('startup repairs the reported duplicate current ID, preserves distinct details and order, and reports only saved corrections', async () => {
    const h = harness();
    h.p.settings.categories = [...models.DEFAULT_CATEGORIES, { id: 'custom-category', name: 'Custom', type: 'expense' }];
    h.files.set('settings.json', JSON.stringify(h.p.settings));
    const id = '20261021-202211-022e34fc';
    const input = [row({ id, date: '2026-09-21', time: '20:21:00', amount: 5, description: 'EXPENSE 1 TEST',
        notes: 'Keep first', metadata: { nested: [1, 2] }, legacyId: 'first-original' }),
    row({ id, date: '2026-10-23', time: '21:00:22', amount: 124, description: 'FOODS',
        category: 'custom-category', notes: 'Keep second', legacyId: 'second-original' })];
    h.seed(input);
    await h.p.onload();
    assert.equal(h.p.protectedDatasets.size, 0);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.equal(output.length, input.length);
    assert.equal(output[0].id, id);
    assert.match(output[1].id, /^\d{8}-\d{6}-[a-z0-9]{8}$/);
    assert.notEqual(output[1].id, id);
    output.forEach((transaction, index) => {
        const { legacyId: discarded, ...original } = input[index];
        assert.deepEqual({ ...transaction, id }, original);
        assert.equal(Object.hasOwn(transaction, 'legacyId'), false);
    });
    assert.deepEqual(plain(h.p.getAllTransactions()), output);
    assert.equal(h.dialogs.length, 1);
    const content = h.dialogs[0].contentEl;
    assert.equal(content.children[0].text, 'Transaction data update');
    assert.deepEqual(content.children.find(element => element.tag === 'ul').children.map(element => element.text), ['Duplicate IDs regenerated: 1']);
    assert.ok(content.find('Existing transaction details were preserved. Changes saved.'));
    const buttons = content.children.find(element => element.children.some(child => child.tag === 'button')).children;
    assert.deepEqual(buttons.map(button => button.text), ['OK']);
    buttons[0].listeners.click();
    assert.equal(content.children.length, 0);
    const committed = h.files.get(h.p.transactionsFilePath);
    for (const date of ['2026-10-24T23:00:00Z', '2027-05-01T00:01:00Z']) {
        const restart = harness(h.files, date);
        await restart.p.onload();
        assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
        assert.deepEqual(plain(restart.p.getAllTransactions()), output);
        assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    }
});

test('startup preserves unresolved identical copies, reports both indices, and recovers only after explicit source correction', async () => {
    for (const id of [row().id, legacyId(), 'alien-duplicate']) {
        const h = harness();
        const first = row({ id, amount: '10.50', time: undefined, notes: undefined, metadata: { keep: ['one', 'two'] } });
        h.seed([first, { ...first, amount: '11.50' }, { ...first }], [cash, card], { customMetadata: 'Keep envelope' });
        const source = h.files.get(h.p.transactionsFilePath);
        const accountFile = h.files.get(h.p.accountsFilePath);
        await h.p.onload();
        assert.equal(h.p.protectedDatasets.has('transactions'), true);
        assert.equal(h.p.getAllTransactions().length, 0);
        assert.equal(h.files.get(h.p.transactionsFilePath), source);
        assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
        assert.equal(h.writes.length + h.notices.length, 0);
        assert.equal(h.dialogs.length, 1);
        assert.match(text(h.dialogs[0].contentEl), /identical data in transactions\[0\] and transactions\[2\]/);
        assert.match(text(h.dialogs[0].contentEl), /Review both records/);
        assert.equal(await h.p.retryDataRecovery(), false);
        assert.equal(h.files.get(h.p.transactionsFilePath), source);
        assert.equal(h.writes.length + h.notices.length, 0);
        const restart = harness(h.files, '2027-01-01T00:00:00Z');
        await restart.p.onload();
        assert.equal(restart.p.protectedDatasets.has('transactions'), true);
        assert.equal(restart.files.get(restart.p.transactionsFilePath), source);
        assert.equal(restart.writes.length + restart.notices.length, 0);
        assert.match(text(restart.dialogs[0].contentEl), /identical data in transactions\[0\] and transactions\[2\]/);
        // Simulate the user's explicit review/removal of the unintended copy.
        const reviewed = JSON.parse(source);
        reviewed.transactions.pop();
        h.files.set(h.p.transactionsFilePath, JSON.stringify(reviewed));
        assert.equal(await h.p.retryDataRecovery(), true);
        const output = JSON.parse(h.files.get(h.p.transactionsFilePath));
        assert.equal(output.customMetadata, 'Keep envelope');
        assert.equal(output.transactions.length, 2);
        assert.deepEqual(output.transactions.map(transaction => transaction.amount), [10.5, 11.5]);
        assert.equal(new Set(output.transactions.map(transaction => transaction.id)).size, 2);
        assert.deepEqual(output.transactions.map(transaction => transaction.date), [first.date, first.date]);
        assert.deepEqual(output.transactions.map(transaction => transaction.metadata), [first.metadata, first.metadata]);
        assert.equal(h.writes.length, 1);
        assert.match(h.notices[0], /Duplicate IDs regenerated: 1/);
        const committed = h.files.get(h.p.transactionsFilePath);
        const recoveredRestart = harness(h.files);
        await recoveredRestart.p.onload();
        assert.equal(recoveredRestart.files.get(recoveredRestart.p.transactionsFilePath), committed);
        assert.equal(recoveredRestart.writes.length + recoveredRestart.notices.length + recoveredRestart.dialogs.length, 0);
    }
});

test('failed reloads with identical copies retain the committed in-memory ledger as well as the source file', async () => {
    const h = harness();
    h.seed([row()]);
    await h.p.onload();
    const memory = JSON.stringify(h.p.transactionsData);
    h.seed([row({ amount: '10.50', time: undefined }), row({ amount: '10.50', time: undefined })]);
    const source = h.files.get(h.p.transactionsFilePath);
    await h.p.loadTransactionsData();
    assert.equal(JSON.stringify(h.p.transactionsData), memory);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.writes.length + h.notices.length, 0);
    await assert.rejects(h.p.saveTransactionsData(), /protected/);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
});

test('startup allows identical transaction data with different IDs without dropping, combining, or rewriting records', async () => {
    for (const ids of [[row().id, '20260410-113514-00000001'], [legacyId(), legacyId('fghij')]]) {
        const h = harness();
        const input = ids.map(id => row({ id, metadata: { keep: ['one', 'two'] } }));
        h.seed(input);
        const source = h.files.get(h.p.transactionsFilePath);
        await h.p.onload();
        const output = plain(h.p.getAllTransactions());
        assert.equal(output.length, 2);
        assert.equal(new Set(output.map(transaction => transaction.id)).size, 2);
        output.forEach((transaction, index) => {
            assert.deepEqual({ ...transaction, id: input[index].id }, input[index]);
        });
        if (ids[0] === row().id) {
            assert.equal(h.files.get(h.p.transactionsFilePath), source);
            assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
        } else {
            assert.equal(h.writes.length, 1);
            assert.match(h.notices[0], /Base36 legacy IDs regenerated: 2/);
        }
        const committed = h.files.get(h.p.transactionsFilePath);
        const restart = harness(h.files);
        await restart.p.onload();
        assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
        assert.deepEqual(plain(restart.p.getAllTransactions()), output);
        assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    }
});

test('duplicate legacy records and missing times migrate together with accurate counts and stable ties', async () => {
    const h = harness();
    const input = [row({ id: legacyId(), time: undefined, description: 'First' }),
        row({ id: legacyId(), time: undefined, description: 'Second' }),
        row({ id: '20261021-202211-022e34fc', time: undefined }),
        row({ id: '20261021-202211-022e34fc', time: undefined, description: 'Distinct current-ID collision' }),
        row({ id: 'opaque', time: undefined }), row({ id: 'opaque', time: undefined, description: 'Distinct alien-ID collision' })];
    h.seed(input);
    await h.p.onload();
    const output = plain(h.p.getAllTransactions());
    assert.equal(output.length, input.length);
    assert.equal(new Set(output.map(transaction => transaction.id)).size, input.length);
    assert.equal(output[0].legacyId, undefined);
    assert.equal(output[1].legacyId, undefined);
    assert.equal(output[0].time, models.formatTime(new Date('2026-04-10T17:35:14.123Z')));
    assert.equal(output[1].time, output[0].time);
    assert.equal(output[2].time, '20:22:11');
    assert.equal(output[3].time, output[2].time);
    assert.equal(output[4].time, models.formatTime(new Date('2026-10-22T18:34:56.789Z')));
    assert.equal(output[5].time, output[4].time);
    assert.deepEqual(output.map(transaction => transaction.description), input.map(transaction => transaction.description.toUpperCase()));
    assert.deepEqual(Array.from(models.sortTransactionsByDateTimeDesc(output.slice(0, 2), output), transaction => transaction.description), ['FIRST', 'SECOND']);
    assert.match(h.notices[0], /Base36 legacy IDs regenerated: 1; Alien IDs regenerated: 1; Duplicate IDs regenerated: 3; Time stamps recovered from IDs: 4; Time stamps generated: 2/);
    assert.equal(h.writes.length, 1);
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files, '2027-01-02T12:00:00Z');
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.deepEqual(plain(restart.p.getAllTransactions()), output);
    assert.equal(restart.writes.length + restart.dialogs.length + restart.notices.length, 0);
});

test('already normalized records retain unknown fields, ISO dates, file formatting, and timestamps', async () => {
    const h = harness();
    const input = [row({ amount: 0, time: '00:00:00', date: '0099-12-31', metadata: { keep: 3 } }),
        row({ id: '20261015-123456-1234abcd', date: '2026-10-15T12:34:56.123Z', time: '23:59:59', notes: 'Mixed Case' })];
    h.seed(input, [cash, card], { unknown: [1, 2] });
    const original = h.files.get(h.p.transactionsFilePath);
    await h.p.onload();
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.deepEqual(plain(h.p.getAllTransactions()), input);
    assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
});

test('missing optional fields alone are migrated once without rewriting valid IDs or times', async () => {
    const h = harness();
    h.seed([row({ notes: undefined, account: undefined })]);
    await h.p.onload();
    const migrated = h.p.getAllTransactions()[0];
    assert.equal(migrated.id, row().id);
    assert.equal(migrated.time, row().time);
    assert.equal(Object.hasOwn(migrated, 'notes'), false);
    assert.equal(migrated.account, 'chequing-cash');
    assert.equal(h.writes.length, 1);
    await h.p.loadTransactionsData();
    assert.equal(h.writes.length, 1);
    assert.equal(h.notices.length, 1);
});

test('startup removes empty notes once without reports, preserves non-empty notes, and leaves clean restarts unchanged', async () => {
    const h = harness();
    const input = [row({ metadata: { notes: '' } }), ...[null, '', ' \t\n', ' Keep exact text \nline two '].map((notes, index) =>
        row({ id: `20260410-113514-${(index + 1).toString(36).padStart(8, '0')}`, notes }))];
    h.seed(input);
    await h.p.onload();
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.ok(output.slice(0, 4).every(transaction => !Object.hasOwn(transaction, 'notes')));
    assert.equal(output[4].notes, input[4].notes);
    assert.deepEqual(output[0].metadata, { notes: '' });
    input.forEach((transaction, index) => {
        const expected = { ...transaction };
        if (!expected.notes?.trim()) delete expected.notes;
        assert.deepEqual(output[index], expected);
    });
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.equal(h.notices.length + h.dialogs.length, 0);
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files, '2027-01-01T00:00:00Z');
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('startup does not rewrite or announce records whose notes are absent or non-empty', async () => {
    const h = harness();
    h.seed([row(), row({ id: '20260410-113514-00000001', notes: ' Keep exact text \nline two ' })]);
    const source = h.files.get(h.p.transactionsFilePath);
    await h.p.onload();
    await h.p.loadTransactionsData();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
});

test('failed empty-notes cleanup preserves the file and committed memory and uses P0 recovery', async () => {
    const h = harness();
    h.seed([row({ notes: '' })]);
    await h.p.loadAccountsData();
    const before = JSON.stringify(h.p.transactionsData);
    const source = h.files.get(h.p.transactionsFilePath);
    h.failWrites(true);
    await h.p.loadTransactionsData();
    assert.equal(JSON.stringify(h.p.transactionsData), before);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    assert.equal(h.dialogs.length, 1);
    h.failWrites(false);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(Object.hasOwn(h.p.getAllTransactions()[0], 'notes'), false);
    assert.equal(h.writes.length, 2);
    assert.equal(h.notices.length, 0);
    assert.equal(h.dialogs.length, 1, 'no migration report for notes-only cleanup');
    const committed = h.files.get(h.p.transactionsFilePath);
    await h.p.loadTransactionsData();
    assert.equal(h.files.get(h.p.transactionsFilePath), committed);
    assert.equal(h.writes.length, 2);
});

test('startup converts decimal-string amounts once, preserves fields and precision, and reports only saved conversions', async () => {
    const h = harness();
    const input = [row({ amount: '10', metadata: { keep: [1, 2] } }),
        row({ id: '20260410-113514-00000001', amount: '10.50', type: 'income', category: 'salary' }),
        row({ id: '20260410-113514-00000002', amount: '0.001', type: 'internal', category: 'internal',
            fromAccount: 'chequing-cash', toAccount: 'credit-card' }),
        row({ id: '20260410-113514-00000003', amount: 1.23456789 })];
    h.seed(input);
    const accounts = h.files.get(h.p.accountsFilePath);
    await h.p.onload();
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.deepEqual(output, input.map(transaction => ({ ...transaction, amount: Number(transaction.amount) })));
    assert.equal(h.files.get(h.p.accountsFilePath), accounts);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.deepEqual(plain(h.p.getAllTransactions()), output);
    assert.equal(h.dialogs.length, 1);
    assert.deepEqual(h.dialogs[0].contentEl.children.find(element => element.tag === 'ul').children.map(element => element.text),
        ['Amounts converted from strings: 3']);
    assert.match(h.notices[0], /Amounts converted from strings: 3/);
    await Promise.all([h.p.loadTransactionsData(), h.p.loadTransactionsData()]);
    assert.equal(h.writes.length, 1);
    const committed = h.files.get(h.p.transactionsFilePath);
    for (const date of ['2026-10-24T00:00:00Z', '2027-01-01T00:00:00Z']) {
        const restart = harness(h.files, date);
        await restart.p.onload();
        assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
        assert.deepEqual(plain(restart.p.getAllTransactions()), output);
        assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    }
});

test('startup never converts valid amount rows when any amount or account in the batch is invalid', async () => {
    for (const changes of [{ amount: '10,50' }, { amount: '9007199254740992' }, { amount: '0.10000000000000001' },
        { amount: '10.50', account: 'saving-ghost' }]) {
        const h = harness();
        h.seed([row({ amount: '10.50' }), row({ id: '20260410-113514-00000001', ...changes })]);
        const source = h.files.get(h.p.transactionsFilePath);
        await h.p.onload();
        assert.equal(h.files.get(h.p.transactionsFilePath), source);
        assert.equal(h.p.protectedDatasets.has('transactions'), true);
        assert.equal(h.p.getAllTransactions().length, 0);
        assert.equal(h.writes.length + h.notices.length, 0);
        assert.equal(h.dialogs.length, 1);
        assert.match(h.p.loadFailureMessages.get('transactions'), /transactions\[1\]\.(amount|account):/);
        if (changes.account) assert.ok(h.dialogs[0].contentEl.find('Resolve accounts'));
        else assert.match(text(h.dialogs[0].contentEl), /transactions\[1\]\.amount:/);
    }
});

test('corrupt accounts prevent publishing raw string amounts; account recovery converts and saves once', async () => {
    const h = harness();
    h.seed([row({ amount: '10.50' })]);
    const source = h.files.get(h.p.transactionsFilePath);
    h.files.set(h.p.accountsFilePath, '{broken accounts');
    await h.p.onload();
    assert.equal(h.p.protectedDatasets.has('accounts'), true);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length, 0);
    assert.match(text(h.dialogs[0].contentEl), /amount conversion is waiting for valid accounts/);
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [cash, card] }));
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.p.getAllTransactions()[0].amount, 10.5);
    assert.equal(h.writes.length, 1);
    assert.match(h.notices[0], /Amounts converted from strings: 1/);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('opaque legacy IDs upgrade and report actual corrections once while preserving existing times and details', async () => {
    const h = harness();
    const lateTime = (transaction) => {
        const { time, ...fields } = transaction;
        return { ...fields, time };
    };
    const input = [row({ id: 'old-import-no-time-001', time: undefined, metadata: { keep: [1, 2] } }),
        lateTime(row({ id: 'old-import-with-time-002', time: '01:02:03', notes: 'Keep this' })),
        lateTime(row({ time: '23:59:58', amount: 0 }))];
    h.seed(input);
    await h.p.onload();
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.equal(output.length, input.length);
    output.forEach((transaction, index) => {
        for (const [field, value] of Object.entries(input[index])) {
            if (field !== 'id' && value !== undefined) assert.deepEqual(transaction[field], value);
        }
        const fields = Object.keys(transaction);
        assert.equal(fields[fields.indexOf('date') + 1], 'time');
    });
    assert.equal(new Set(output.map(transaction => transaction.id)).size, 3);
    assert.ok(output.every(transaction => /^\d{8}-\d{6}-[a-z0-9]{8}$/.test(transaction.id)));
    assert.equal(output[0].legacyId, undefined);
    assert.equal(output[1].legacyId, undefined);
    assert.equal(output[2].id, input[2].id);
    assert.equal(output[0].time, models.formatTime(new Date('2026-10-22T18:34:56.789Z')));
    assert.deepEqual(plain(h.p.getAllTransactions()), output);
    assert.equal(h.writes.length, 1);
    assert.equal(h.dialogs.length, 1);
    const report = h.dialogs[0].contentEl;
    assert.ok(report.find('Transaction data update'));
    assert.deepEqual(report.children.find(element => element.tag === 'ul').children.map(element => element.text), [
        'Alien IDs regenerated: 2', 'Time stamps generated: 1', 'Field order corrected: 2'
    ]);
    assert.match(h.notices[0], /Alien IDs regenerated: 2; Time stamps generated: 1; Field order corrected: 2/);
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files, '2027-01-01T00:00:00Z');
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.deepEqual(plain(restart.p.getAllTransactions()), output);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('startup reports field-order-only correction without claiming IDs or timestamps changed', async () => {
    const h = harness();
    const { time, ...rest } = row();
    const input = { time, ...rest };
    h.seed([input]);
    await h.p.onload();
    const migrated = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
    assert.deepEqual(migrated, input);
    const fields = Object.keys(migrated);
    assert.equal(fields[fields.indexOf('date') + 1], 'time');
    const report = h.dialogs[0].contentEl;
    assert.deepEqual(report.children.find(element => element.tag === 'ul').children.map(element => element.text), ['Field order corrected: 1']);
    assert.match(h.notices[0], /Field order corrected: 1\./);
    assert.equal(h.writes.length, 1);
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
});

test('previously filled old-import-no-time-001 upgrades its ID without reporting another timestamp addition', async () => {
    const h = harness();
    const input = row({ id: 'old-import-no-time-001', time: '17:18:19', metadata: { keep: true } });
    h.seed([input]);
    await h.p.onload();
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
    assert.match(output.id, /^\d{8}-\d{6}-[a-z0-9]{8}$/);
    assert.equal(output.legacyId, undefined);
    assert.deepEqual({ ...output, id: input.id }, input);
    const report = h.dialogs[0].contentEl;
    assert.deepEqual(report.children.find(element => element.tag === 'ul').children.map(element => element.text), ['Alien IDs regenerated: 1']);
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /Alien IDs regenerated: 1\./);
    assert.equal(h.writes.length, 1);
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files, '2027-01-01T00:00:00Z');
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.dialogs.length + restart.notices.length, 0);
});

test('startup reports exact disjoint ID types and each assigned or formatted JSON field', async () => {
    const h = harness();
    const lateTime = ({ time, ...fields }) => ({ ...fields, time });
    const input = [row({ id: legacyId(), time: undefined, account: undefined, category: '', notes: undefined }),
        lateTime(row({ id: legacyId(), description: 'Repeated legacy record' })),
        lateTime(row({ id: legacyId('fghij'), account: 'chequing-Cash' })),
        row({ id: 'alien-one', time: undefined, account: '' }),
        row({ id: 'alien-one', description: 'Repeated alien record' }),
        lateTime(row({ id: 'alien-two' }))];
    h.seed(input);
    await h.p.onload();
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.equal(output.length, input.length);
    assert.equal(new Set(output.map(transaction => transaction.id)).size, input.length);
    assert.equal(h.writes.length, 1);
    assert.equal(h.dialogs.length, 1);
    const expected = ['Base36 legacy IDs regenerated: 2', 'Alien IDs regenerated: 2', 'Duplicate IDs regenerated: 2',
        'Time stamps recovered from IDs: 1', 'Time stamps generated: 1', 'Accounts assigned: 2', 'Account references formatted: 1', 'Categories assigned: 1',
        'Field order corrected: 3'];
    const content = h.dialogs[0].contentEl;
    assert.equal(content.children[0].text, 'Transaction data update');
    assert.deepEqual(content.children.find(element => element.tag === 'ul').children.map(element => element.text), expected);
    assert.ok(h.notices[0].endsWith(`${expected.join('; ')}.`));
    assert.deepEqual(output.map(transaction => transaction.description), input.map(transaction => transaction.description.toUpperCase()));
    assert.deepEqual(output.map(transaction => transaction.date), input.map(transaction => transaction.date));
    assert.deepEqual(output.map(transaction => transaction.amount), input.map(transaction => transaction.amount));
    output.forEach((transaction, index) => {
        if (input[index].time) assert.equal(transaction.time, input[index].time);
        const fields = Object.keys(transaction);
        assert.equal(fields[fields.indexOf('date') + 1], 'time');
    });
    const committed = h.files.get(h.p.transactionsFilePath);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.files.get(restart.p.transactionsFilePath), committed);
    assert.equal(restart.writes.length + restart.dialogs.length + restart.notices.length, 0);
});

const invalidCases = [
    ['empty ID', [row({ id: '' })], /id: expected a non-empty string/],
    ['non-string ID', [row({ id: 123 })], /id: expected a non-empty string/],
    ['null ID', [row({ id: null })], /id: expected a non-empty string/],
    ['invalid batch with duplicate IDs', [row(), row({ amount: -1, account: 'saving-ghost' })], /amount must/],
    ['invalid date', [row({ date: '2026-02-31' })], /invalid calendar date/],
    ['invalid amount', [row({ amount: -1 })], /amount must/],
    ['invalid type', [row({ type: 'unknown' })], /unsupported transaction type/],
    ['unresolved account', [row({ account: 'saving-ghost' })], /unresolved account "saving-ghost"/],
    ['removed default reference', [row({ account: 'other-default' })], /unresolved account/],
    ['invalid account type', [row({ account: 'unknown-cash' })], /unresolved account/],
    ['unresolved transfer source', [row({ type: 'internal', fromAccount: 'saving-ghost', toAccount: 'credit-card' })], /unresolved fromAccount/],
    ['unresolved transfer destination', [row({ type: 'internal', fromAccount: 'chequing-cash', toAccount: 'saving-ghost' })], /unresolved toAccount/],
    ['missing transfer endpoint', [row({ type: 'internal', fromAccount: 'chequing-cash' })], /transfer accounts are required/]
];
for (const [name, transactions, pattern] of invalidCases) {
    test(`startup protects ${name}, keeps every source row, and gives actionable recovery`, async () => {
        const h = harness();
        h.seed(transactions);
        const original = h.files.get(h.p.transactionsFilePath);
        await h.p.loadAccountsData();
        const accounts = JSON.stringify(h.p.transactionsData.accounts);
        const memory = JSON.stringify(h.p.transactionsData);
        await h.p.loadTransactionsData();
        assert.equal(h.p.protectedDatasets.has('transactions'), true);
        assert.equal(h.files.get(h.p.transactionsFilePath), original);
        assert.equal(JSON.stringify(h.p.transactionsData), memory);
        assert.equal(JSON.stringify(h.p.transactionsData.accounts), accounts);
        assert.equal(h.writes.length + h.notices.length, 0);
        assert.equal(h.dialogs.length, 1);
        assert.match(h.p.loadFailureMessages.get('transactions'), pattern);
        if (h.p.missingAccountError) {
            assert.ok(h.dialogs[0].contentEl.find('Resolve accounts'));
            assert.ok(h.dialogs[0].contentEl.find('Transaction saving is paused to protect your data.'));
        } else {
            assert.match(text(h.dialogs[0].contentEl), pattern);
            assert.match(text(h.dialogs[0].contentEl), /transactions.json/);
            assert.match(text(h.dialogs[0].contentEl), /then Retry/);
        }
        await assert.rejects(h.p.addTransaction(row({ id: 'blocked' })), /protected/);
        assert.equal(h.files.get(h.p.transactionsFilePath), original);
    });
}

test('empty account collections never synthesize a default or resolve missing references to a ghost', async () => {
    const h = harness();
    h.seed([row({ account: undefined })], []);
    await h.p.onload();
    assert.equal(h.p.getAccounts().length, 0);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.writes.length, 0);
    assert.match(h.p.loadFailureMessages.get('transactions'), /unresolved account/);
    assert.ok(h.dialogs[0].contentEl.find('Unassigned account: 1 affected transaction'));
    assert.ok(h.dialogs[0].contentEl.find('Resolve accounts'));
    const empty = harness();
    empty.seed([], []);
    await empty.p.onload();
    assert.equal(empty.p.getAccounts().length, 0);
    assert.equal(empty.writes.length + empty.notices.length + empty.dialogs.length, 0);
});

test('missing account files initialize only legitimate defaults and preserve unresolved transactions', async () => {
    const h = harness();
    h.seed([row()]);
    const original = h.files.get(h.p.transactionsFilePath);
    h.files.delete(h.p.accountsFilePath);
    await h.p.onload();
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.accountsFilePath]);
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.ok(!h.p.getAccounts().some(account => account.name === 'Cash'));
});

test('failed startup migration preserves memory and disk until one successful recovery write', async () => {
    const h = harness();
    h.seed([row({ id: legacyId(), time: undefined, notes: undefined }), row({ id: legacyId(), amount: '124.50' })]);
    await h.p.loadAccountsData();
    const before = JSON.stringify(h.p.transactionsData);
    const disk = h.files.get(h.p.transactionsFilePath);
    h.failWrites(true);
    await h.p.loadTransactionsData();
    assert.equal(JSON.stringify(h.p.transactionsData), before);
    assert.equal(h.files.get(h.p.transactionsFilePath), disk);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    assert.match(text(h.dialogs[0].contentEl), /storage space/);
    h.failWrites(false);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.p.getAllTransactions().length, 2);
    assert.equal(new Set(h.p.getAllTransactions().map(transaction => transaction.id)).size, 2);
    assert.equal(h.p.getAllTransactions()[0].legacyId, undefined);
    assert.equal(h.p.getAllTransactions()[1].amount, 124.5);
    assert.match(h.notices[0], /Amounts converted from strings: 1/);
    assert.equal(h.writes.length, 2);
    assert.equal(h.notices.length, 1);
    await h.p.loadTransactionsData();
    assert.equal(h.writes.length, 2);
});

test('pending migration writes never publish unsaved IDs or fields', async () => {
    const h = harness();
    h.seed([row({ id: legacyId(), time: undefined }), row({ id: legacyId(), amount: '124.50' })]);
    await h.p.loadAccountsData();
    const before = JSON.stringify(h.p.transactionsData);
    const write = h.p.app.vault.adapter.write;
    let complete;
    h.p.app.vault.adapter.write = (file, content) => new Promise(resolve => {
        complete = async () => { await write(file, content); resolve(); };
    });
    const pending = h.p.loadTransactionsData();
    await new Promise(setImmediate);
    assert.equal(JSON.stringify(h.p.transactionsData), before);
    assert.equal(h.notices.length + h.dialogs.length, 0);
    await complete();
    await pending;
    assert.equal(h.p.getAllTransactions()[0].legacyId, undefined);
    assert.equal(h.writes.length, 1);
});

test('corrupt accounts defer migrations, preserve legacy records, and recover before reference validation', async () => {
    const h = harness();
    const originalRow = row({ id: legacyId(), time: undefined, account: undefined, notes: undefined });
    h.seed([originalRow]);
    const source = h.files.get(h.p.transactionsFilePath);
    h.files.set(h.p.accountsFilePath, '{broken accounts');
    await h.p.onload();
    assert.deepEqual(plain(h.p.getAllTransactions()), plain([originalRow]));
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length, 0);
    assert.equal(h.p.protectedDatasets.has('accounts'), true);
    assert.equal(h.p.protectedDatasets.has('transactions'), false, 'P0 safe metadata edits remain available');
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [cash, card] }));
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.p.getAllTransactions()[0].legacyId, undefined);
    assert.equal(h.p.getAllTransactions()[0].account, 'chequing-cash');
    assert.equal(h.writes.length, 1);
});

test('restoring an unresolved account validates the original ledger instead of dropping its transaction', async () => {
    const h = harness();
    h.seed([row({ account: 'saving-restored' })]);
    await h.p.onload();
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [cash, { ...cash, id: 'restored', name: 'Restored', type: 'saving', isDefault: false }] }));
    const source = h.files.get(h.p.transactionsFilePath);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-restored');
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length, 0);
});

test('startup reconciliation stages choices, cancels without writes, and links existing accounts in one transaction write', async () => {
    const h = harness();
    const input = [row({ account: 'saving-missing', notes: 'Keep notes', metadata: { keep: true } }),
        row({ id: '20260410-113514-00000001', type: 'internal', fromAccount: 'saving-missing', toAccount: 'credit-card' })];
    h.seed(input, [cash, card], { metadata: { keep: 'envelope' } });
    const source = h.files.get(h.p.transactionsFilePath);
    const accountFile = h.files.get(h.p.accountsFilePath);
    await h.p.onload();
    assert.ok(h.dialogs[0].contentEl.find('Resolve accounts'));
    const cancelled = await h.p.openAccountReconciliation();
    assert.ok(cancelled.contentEl.find('For each reference'));
    assert.ok(cancelled.contentEl.find('For all unknown accounts'));
    cancelled.choices.set('saving-missing', cash.id);
    assert.equal(h.writes.length, 0);
    cancelled.close();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    const modal = await h.p.openAccountReconciliation();
    modal.choices.set('saving-missing', cash.id);
    await modal.confirm();
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath));
    assert.deepEqual(saved.metadata, { keep: 'envelope' });
    assert.deepEqual(saved.transactions, [ { ...input[0], account: 'chequing-cash' },
        { ...input[1], fromAccount: 'chequing-cash' } ]);
    assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.equal(h.p.protectedDatasets.has('transactions'), false);
    assert.match(h.notices[0], /Account references linked: 2/);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.writes.length + restart.notices.length + restart.dialogs.length, 0);
    assert.deepEqual(plain(restart.p.getAllTransactions()), saved.transactions);
});

test('failed account creation writes preserve both files and confirmed Retry creates the account only once', async () => {
    const h = harness();
    h.seed([row({ account: 'saving-missing' })]);
    await h.p.onload();
    const source = h.files.get(h.p.transactionsFilePath);
    const accounts = h.files.get(h.p.accountsFilePath);
    const modal = await h.p.openAccountReconciliation();
    const draft = { id: 'draft-savings', name: 'User Savings', type: 'saving', createdAt: '2026-10-24' };
    modal.drafts.set(draft.id, draft);
    modal.choices.set('saving-missing', draft.id);
    assert.equal(h.writes.length, 0);
    h.failWrites(true);
    await modal.confirm();
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.files.get(h.p.accountsFilePath), accounts);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.getAccounts().some(account => account.id === draft.id), false);
    assert.equal(h.p.hasSaveFailure(modal), true);
    h.failWrites(false);
    await h.dialogs.at(-1).contentEl.find('Retry').listeners.click();
    assert.deepEqual(h.writes.map(write => write.file), [h.p.accountsFilePath, h.p.accountsFilePath, h.p.transactionsFilePath]);
    assert.equal(h.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-user savings');
    assert.equal(h.p.hasSaveFailure(modal), false);
});

test('a failed second write keeps original references and saved accounts; live Retry writes only transactions', async () => {
    const h = harness();
    const original = row({ account: 'saving-missing', notes: 'Keep note', metadata: { keep: true } });
    h.seed([original]);
    await h.p.onload();
    const source = h.files.get(h.p.transactionsFilePath);
    const modal = await h.p.openAccountReconciliation();
    const draft = { id: 'draft-card', name: 'User Card', type: 'credit', creditLimit: 1250.25, createdAt: '2026-10-24' };
    modal.drafts.set(draft.id, draft);
    modal.choices.set('saving-missing', draft.id);
    const write = h.p.app.vault.adapter.write;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (file === h.p.transactionsFilePath) { h.writes.push({ file, content }); throw Error('disk full'); }
        return write(file, content);
    };
    await modal.confirm();
    const savedAccounts = h.files.get(h.p.accountsFilePath);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(JSON.parse(source).transactions[0].account, 'saving-missing');
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.getAccounts().find(account => account.id === draft.id).creditLimit, 1250.25);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    h.p.app.vault.adapter.write = write;
    await h.dialogs.at(-1).contentEl.find('Retry').listeners.click();
    assert.equal(h.files.get(h.p.accountsFilePath), savedAccounts);
    assert.deepEqual(h.writes.map(write => write.file), [h.p.accountsFilePath, h.p.transactionsFilePath, h.p.transactionsFilePath]);
    assert.deepEqual(plain(h.p.getAllTransactions()), [{ ...original, account: 'credit-user card' }]);
    assert.equal(h.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.equal(h.p.protectedDatasets.has('transactions'), false);
});

test('restart after a failed second save detects original unresolved references and links the already saved account', async () => {
    const h = harness();
    const original = row({ account: 'saving-missing' });
    h.seed([original]);
    await h.p.onload();
    const source = h.files.get(h.p.transactionsFilePath);
    const modal = await h.p.openAccountReconciliation();
    const draft = { id: 'draft-savings', name: 'User Savings', type: 'saving', createdAt: '2026-10-24' };
    modal.drafts.set(draft.id, draft);
    modal.choices.set('saving-missing', draft.id);
    const write = h.p.app.vault.adapter.write;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (file === h.p.transactionsFilePath) throw Error('disk full');
        return write(file, content);
    };
    await modal.confirm();
    const savedAccounts = h.files.get(h.p.accountsFilePath);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.equal(restart.p.protectedDatasets.has('transactions'), true);
    assert.ok(restart.dialogs[0].contentEl.find('Resolve accounts'));
    assert.equal(restart.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.equal(restart.writes.length, 0);
    const retry = await restart.p.openAccountReconciliation();
    retry.choices.set('saving-missing', draft.id);
    await retry.confirm();
    assert.deepEqual(restart.writes.map(write => write.file), [restart.p.transactionsFilePath]);
    assert.equal(restart.files.get(restart.p.accountsFilePath), savedAccounts);
    assert.deepEqual(plain(restart.p.getAllTransactions()), [{ ...original, account: 'saving-user savings' }]);
    const secondRestart = harness(h.files);
    await secondRestart.p.onload();
    assert.equal(secondRestart.writes.length + secondRestart.notices.length + secondRestart.dialogs.length, 0);
});

test('pending reconciliation writes expose no updated transaction references before persistence completes', async () => {
    const h = harness();
    h.seed([row({ account: 'saving-missing' })]);
    await h.p.onload();
    const source = h.files.get(h.p.transactionsFilePath);
    const modal = await h.p.openAccountReconciliation();
    modal.choices.set('saving-missing', cash.id);
    const write = h.p.app.vault.adapter.write;
    let finish;
    h.p.app.vault.adapter.write = (file, content) => new Promise(resolve => {
        finish = async () => { await write(file, content); resolve(); };
    });
    const pending = modal.confirm();
    await new Promise(setImmediate);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.notices.length, 0);
    await finish();
    await pending;
    assert.equal(h.p.getAllTransactions()[0].account, 'chequing-cash');
    assert.equal(h.p.protectedDatasets.has('transactions'), false);
});

test('reconciliation rejects stale source files and does not persist unselected account drafts', async () => {
    const h = harness();
    h.seed([row({ account: 'saving-missing' })]);
    await h.p.onload();
    const accounts = h.files.get(h.p.accountsFilePath);
    const modal = await h.p.openAccountReconciliation();
    modal.choices.set('saving-missing', cash.id);
    const changed = JSON.stringify({ transactions: [row({ account: 'saving-missing', amount: 25 })], metadata: 'external edit' });
    h.files.set(h.p.transactionsFilePath, changed);
    await modal.confirm();
    assert.equal(h.files.get(h.p.transactionsFilePath), changed);
    assert.equal(h.files.get(h.p.accountsFilePath), accounts);
    assert.equal(h.writes.length, 0);
    modal.close();
    const fresh = await h.p.openAccountReconciliation();
    fresh.drafts.set('unused-draft', { id: 'unused-draft', name: 'Unused account', type: 'saving', createdAt: '2026-10-24' });
    fresh.choices.set('saving-missing', cash.id);
    await fresh.confirm();
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
    assert.equal(h.files.get(h.p.accountsFilePath), accounts);
    assert.equal(h.p.getAccounts().some(account => account.id === 'unused-draft'), false);
    assert.equal(h.p.getAllTransactions()[0].amount, 25);
    assert.equal(JSON.parse(h.files.get(h.p.transactionsFilePath)).metadata, 'external edit');
});

test('reconciliation rejects duplicate account definitions and self-transfers before saving anything', async () => {
    for (const duplicateDraft of [false, true]) {
        const h = harness();
        h.seed([row({ type: 'internal', fromAccount: 'saving-missing', toAccount: 'credit-card' })]);
        await h.p.onload();
        const source = h.files.get(h.p.transactionsFilePath);
        const accounts = h.files.get(h.p.accountsFilePath);
        const modal = await h.p.openAccountReconciliation();
        if (duplicateDraft) {
            modal.drafts.set('duplicate-card', { ...card, id: 'duplicate-card' });
            modal.choices.set('saving-missing', 'duplicate-card');
        } else modal.choices.set('saving-missing', card.id);
        await modal.confirm();
        assert.equal(h.writes.length, 0);
        assert.equal(h.files.get(h.p.transactionsFilePath), source);
        assert.equal(h.files.get(h.p.accountsFilePath), accounts);
        assert.equal(h.p.getAllTransactions().length, 0);
        assert.equal(h.p.hasSaveFailure(modal), false, 'validation failures are not storage failures');
        assert.equal(h.p.protectedDatasets.has('transactions'), true);
    }
});

test('duplicate IDs stay protected while accounts are corrupt and migrate only after account recovery', async () => {
    const h = harness();
    h.seed([row(), row({ amount: 124 })]);
    const source = h.files.get(h.p.transactionsFilePath);
    h.files.set(h.p.accountsFilePath, '{broken accounts');
    await h.p.onload();
    assert.equal(h.p.protectedDatasets.has('accounts'), true);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.writes.length + h.notices.length, 0);
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [cash, card] }));
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.p.getAllTransactions().length, 2);
    assert.equal(h.writes.length, 1);
    assert.match(h.notices[0], /Duplicate IDs regenerated: 1/);
});

test('account reloads never normalize or discard existing transaction fields before validation', async () => {
    const h = harness();
    h.seed([]);
    h.p.transactionsData.transactions = [row({ category: 'legacy-custom', fromAccount: 'retained-field', time: undefined })];
    const original = JSON.stringify(h.p.getAllTransactions());
    await h.p.loadAccountsData();
    assert.equal(JSON.stringify(h.p.getAllTransactions()), original);
});

test('manual import and startup use identical preparation and account-reference validation', async () => {
    const input = [row({ account: undefined, time: undefined, notes: undefined }),
        row({ id: '20260410-113514-00000001', type: 'internal', category: 'internal', fromAccount: 'chequing-Cash', toAccount: 'credit-card' })];
    const startup = harness();
    startup.seed(input);
    await startup.p.onload();
    const manual = harness();
    manual.seed([]);
    await manual.p.onload();
    manual.files.set('import.json', JSON.stringify(input));
    // Call the prototype because the startup harness prohibits accidental reimports.
    const importFile = Object.getPrototypeOf(manual.p).importTransactionsFromJSON.bind(manual.p);
    assert.equal(await importFile('import.json'), true);
    assert.deepEqual(plain(manual.p.getAllTransactions()), plain(startup.p.getAllTransactions()));
    manual.files.set('bad.json', JSON.stringify([row({ id: 'new', account: 'saving-ghost' })]));
    const writes = manual.writes.length;
    await assert.rejects(importFile('bad.json'), /unresolved account/);
    assert.equal(manual.writes.length, writes);
});

test('historical self-transfers load neutrally and restart without changing source bytes or records', async () => {
    for (const reference of ['chequing-cash', 'credit-card']) {
        const h = harness();
        const input = [row({ id: '20260930-120000-00000001', date: '2026-09-30', type: 'income', category: 'salary', amount: 100 }),
            row({ id: '20261015-120000-00000001', date: '2026-10-15T23:00:00Z', type: 'internal', category: 'internal',
                amount: 25, fromAccount: reference, toAccount: reference, metadata: { retained: true } }),
            row({ id: '20261016-120000-00000001', date: '2026-10-16', type: 'internal', category: 'internal',
                amount: 20, fromAccount: 'chequing-cash', toAccount: 'credit-card' })];
        h.seed(input);
        const bytes = [...h.files];
        for (const instance of [h, harness(h.files)]) {
            await instance.p.onload();
            assert.equal(instance.p.protectedDatasets.has('transactions'), false);
            assert.deepEqual(plain(instance.p.getAllTransactions()), input);
            const calendar = Object.assign(Object.create(CalendarHeatmap.prototype), {
                plugin: instance.p, currentDate: new Date(2026, 9, 1), runningBalanceCache: new Map(),
                transactions: instance.p.getTransactionsForMonth(2026, 9)
            });
            calendar.prepareData();
            assert.equal(calendar.calendarData[14].dayBalance, 100);
            assert.equal(calendar.calendarData[15].dayBalance, 80);
            assert.equal(calendar.getRunningBalanceMap('credit-card')[input[1].id], 0);
            assert.equal(calendar.monthlyExpenseTotal, 0);
            assert.deepEqual([...instance.files], bytes);
            assert.equal(instance.writes.length + instance.notices.length + instance.dialogs.length, 0);
        }
    }
});

test('reconciliation preserves an existing self-transfer while resolving another transaction', async () => {
    const h = harness();
    const historical = row({ type: 'internal', category: 'internal', fromAccount: 'chequing-cash', toAccount: 'chequing-cash', amount: 25 });
    h.seed([historical, row({ id: '20260410-113514-00000001', account: 'saving-missing' })]);
    await h.p.onload();
    const owner = await h.p.openAccountReconciliation();
    owner.choices.set('saving-missing', cash.id);
    await owner.confirm();
    assert.equal(h.p.protectedDatasets.has('transactions'), false);
    assert.deepEqual(plain(h.p.getAllTransactions()[0]), historical);
    assert.equal(h.p.getAllTransactions()[1].account, 'chequing-cash');
    assert.deepEqual(h.writes.map(write => write.file), [h.p.transactionsFilePath]);
});

test('explicit rollover setup and legacy unconfigured budgets restart quietly with identical budget and transaction files', async () => {
    for (const configured of [false, true]) {
        const h = harness();
        h.seed([row({ id: '20260915-120000-00000001', date: '2026-09-15T23:59:59-12:00', amount: 40 }),
            row({ id: '20261002-120000-00000001', date: '2026-10-02', amount: 20 })]);
        const entry = { id: 'budget', categoryId: 'food', amount: 100, period: 'monthly', rollover: true,
            lastUpdated: '2020-01-01T00:00:00Z', ...(configured ? { rolloverStartDate: '2026-09-01' } : {}) };
        h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [entry], lastUpdated: 'unchanged' }, null, 4));
        const bytes = [...h.files];
        for (const instance of [h, harness(h.files)]) {
            await instance.p.onload();
            const budget = instance.p.getAllBudgets()[0];
            for (let attempt = 0; attempt < 3; attempt++) {
                const result = models.calculateBudgetStatus(budget, instance.p.getAllTransactions(), models.parseLocalDate('2026-10-15'));
                assert.equal(result.available, configured ? 160 : 100);
                assert.equal(result.remaining, configured ? 140 : 80);
                assert.equal(models.calculateBudgetStatus(budget, instance.p.getAllTransactions(), models.parseLocalDate('2026-11-15')).available,
                    configured ? 240 : 100);
            }
            assert.deepEqual(plain(budget), entry);
            assert.deepEqual([...instance.files], bytes);
            assert.equal(instance.writes.length + instance.notices.length + instance.dialogs.length, 0);
        }
    }
});

test('invalid rollover metadata protects the budget dataset without rewriting recoverable files', async () => {
    for (const start of ['2026-02-31', 'invalid', 42, {}, '0000-01-01']) {
        const h = harness();
        h.seed();
        h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [{ id: 'b', categoryId: 'food', amount: 100,
            period: 'monthly', rollover: true, rolloverStartDate: start }] }));
        const bytes = [...h.files];
        await h.p.onload();
        assert.equal(h.p.protectedDatasets.has('budgets'), true);
        assert.deepEqual([...h.files], bytes);
        assert.equal(h.writes.length, 0);
        await assert.rejects(h.p.addBudget({ id: 'new', categoryId: 'food', amount: 100, period: 'monthly' }), /protected/);
        assert.deepEqual([...h.files], bytes);
    }
});

test('calendar opening balances and ISO grouping preserve source bytes and restart without writes', async () => {
    const h = harness();
    const input = [
        row({ id: '20260930-235959-00000001', date: '2026-09-30T23:59:59-12:00', time: '23:59:59',
            type: 'income', category: 'salary', amount: 100, metadata: { retained: true } }),
        row({ id: '20261020-000000-00000001', date: '2026-10-20T00:00:00+14:00', time: '00:00:00', amount: 20 }),
        row({ id: '20261201-120000-00000001', date: '2026-12-01', amount: 999 })
    ];
    h.seed(input);
    const bytes = h.files.get(h.p.transactionsFilePath);
    for (const instance of [h, harness(h.files)]) {
        await instance.p.onload();
        const reads = instance.reads.length;
        for (const month of [9, 10, 9]) {
            const calendar = Object.assign(Object.create(CalendarHeatmap.prototype), {
                plugin: instance.p, currentDate: new Date(2026, month, 1), runningBalanceCache: new Map(),
                transactions: instance.p.getTransactionsForMonth(2026, month)
            });
            calendar.prepareData();
            if (month === 9) {
                assert.deepEqual(Array.from(calendar.calendarData, day => day.dayBalance), [...Array(19).fill(100), ...Array(12).fill(80)]);
                assert.deepEqual(Array.from(calendar.calendarData[19].transactions, row => row.id), [input[1].id]);
            } else {
                assert.deepEqual(Array.from(calendar.calendarData, day => day.dayBalance), Array(30).fill(80));
            }
            calendar.prepareData();
            assert.equal(calendar.calendarData[calendar.calendarData.length - 1].dayBalance, 80);
        }
        assert.deepEqual(plain(instance.p.getAllTransactions()), input);
        assert.equal(instance.files.get(instance.p.transactionsFilePath), bytes);
        assert.equal(instance.reads.length, reads, 'calendar preparation must not access files');
        assert.equal(instance.writes.length + instance.notices.length + instance.dialogs.length, 0);
    }
});

test('display sorting and running balances preserve transaction file bytes, ledger order and IDs across restarts', async () => {
    const h = harness();
    const input = [
        row({ id: '20260410-170000-ffffffff', time: '17:00:00', amount: 7 }),
        row({ id: '20260410-090000-00000001', time: '09:00:00', amount: 5 }),
        row({ id: '20260410-170000-00000000', time: '17:00:00', amount: 3 })
    ];
    h.seed(input);
    const bytes = h.files.get(h.p.transactionsFilePath);
    const expectedOrder = [input[0].id, input[2].id, input[1].id];
    for (const instance of [h, harness(h.files)]) {
        await instance.p.onload();
        const ledger = instance.p.getAllTransactions();
        let display = [...ledger].reverse().map(transaction => ({ ...transaction }));
        for (let attempt = 0; attempt < 3; attempt++) {
            display = models.sortTransactionsByDateTimeDesc(display, ledger);
            assert.deepEqual(Array.from(display, transaction => transaction.id), expectedOrder);
            assert.deepEqual({ ...models.getRunningBalanceByTransactionId(display, ledger) }, {
                [input[1].id]: -5, [input[2].id]: -8, [input[0].id]: -15
            });
        }
        assert.deepEqual(plain(instance.p.getAllTransactions()), input);
        assert.equal(instance.files.get(instance.p.transactionsFilePath), bytes);
        assert.equal(instance.writes.length + instance.notices.length + instance.dialogs.length, 0);
    }
});

test('equal timestamps preserve source order across startup migration and fresh restart', async () => {
    const h = harness();
    h.seed(['zzzzz', 'aaaaa', 'fffff'].map((suffix, index) => row({ id: legacyId(suffix), time: undefined, amount: index + 1 })));
    await h.p.onload();
    const expected = Array.from(h.p.getAllTransactions(), transaction => transaction.id);
    assert.deepEqual(Array.from(h.p.getAllTransactions(), transaction => transaction.amount), [1, 2, 3]);
    const ledger = h.p.getAllTransactions();
    assert.deepEqual(Array.from(models.sortTransactionsByDateTimeDesc(ledger, ledger), transaction => transaction.id), expected);
    const restart = harness(h.files);
    await restart.p.onload();
    assert.deepEqual(Array.from(restart.p.getAllTransactions(), transaction => transaction.id), expected);
    assert.equal(restart.writes.length + restart.notices.length, 0);
});

if (!process.env.EXPENSICA_STARTUP_TZ_CHILD) {
    test('startup migration and idempotent restarts work in Denver, Kiritimati, and Honolulu', () => {
        for (const timezone of ['America/Denver', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
            const environment = { ...process.env, TZ: timezone, EXPENSICA_STARTUP_TZ_CHILD: '1' };
            delete environment.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=onload reads|fresh restarts|equal timestamps|reported duplicate|duplicate legacy records|opaque legacy IDs|field-order-only', __filename], {
                env: environment, encoding: 'utf8', timeout: 20000
            });
            assert.equal(child.error, undefined, child.error?.message);
            assert.equal(child.status, 0, `${timezone}\n${child.stdout}\n${child.stderr}`);
        }
    });
}
