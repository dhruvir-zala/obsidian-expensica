const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = new Map();
function load(filename, dependencies = {}) {
    if (!compiled.has(filename)) {
        const extra = filename === 'main.ts' ? '\nexport { ImportModal };' : '';
        compiled.set(filename, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extra, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText);
    }
    const exports = {};
    vm.runInNewContext(compiled.get(filename), {
        exports, Date, crypto: require('node:crypto').webcrypto,
        console: { log() {}, warn() {}, error() {} },
        require(name) { return dependencies[name] || (name.endsWith('/modal-utils') ? load('src/modal-utils.ts') : {}); }
    });
    return exports;
}
const models = load('src/models.ts');
const transaction = { id: 't1', date: '2026-10-15', type: 'expense', amount: 10, description: 'ENTRY', category: 'food', account: 'saving-cash' };
const budget = { id: 'b1', categoryId: 'food', amount: 100, period: 'monthly', rollover: false, lastUpdated: 'initial' };

function setup() {
    const notices = [];
    const { default: Plugin, ImportModal } = load('main.ts', {
        obsidian: { Plugin: class {}, PluginSettingTab: class {}, Modal: class {
            constructor() { this.containerEl = { addEventListener() {} }; }
            open() {}
        } },
        './src/models': models,
        './src/dashboard-view': { EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
        './src/transaction-import': load('src/transaction-import.ts', { './models': models }),
        './src/notice': { showExpensicaNotice: message => notices.push(message) },
        './src/data-recovery-modal': { DataRecoveryModal: class { open() {} refresh() {} close() {} } }
    });
    const p = new Plugin();
    p.settings = { categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    p.transactionsData = p.normalizeTransactionsSnapshot({
        transactions: [{ ...transaction }],
        accounts: [{ ...models.DEFAULT_ACCOUNT }, { id: 'a1', name: 'Cash', type: 'saving', createdAt: '2026-01-01' }],
        lastUpdated: 'initial'
    });
    p.budgetData = { budgets: [{ ...budget }], lastUpdated: 'initial' };
    const files = new Map([
        [p.transactionsFilePath, JSON.stringify({ transactions: p.getAllTransactions(), lastUpdated: 'initial' })],
        [p.accountsFilePath, JSON.stringify({ accounts: p.getAccounts(), lastUpdated: 'initial' })],
        [p.budgetFilePath, JSON.stringify(p.budgetData)],
        ['import.json', JSON.stringify([{ ...transaction, id: 'imported', description: 'IMPORTED' }])]
    ]);
    const failures = new Set();
    let refreshes = 0;
    p.app = { vault: { adapter: {
        exists: async file => files.has(file),
        read: async file => files.get(file),
        write: async (file, text) => {
            if (failures.has(file)) throw new Error('disk full');
            files.set(file, text);
        }
    } }, workspace: { getLeavesOfType: () => [], layoutReady: true,
        getActiveViewOfType() { return this.activeLeaf?.view; },
        activeLeaf: { view: { getViewType: () => 'expensica-dashboard-view', containerEl: {} } } } };
    p.refreshExpensicaViews = async () => { refreshes++; };
    return { p, files, failures, notices, ImportModal, refreshes: () => refreshes,
        memory: () => JSON.stringify({ transactions: p.transactionsData, budgets: p.budgetData }) };
}

const operations = [
    ['transaction add', 'transactionsFilePath', p => p.addTransaction({ ...transaction, id: 't2' }), p => assert.equal(p.getAllTransactions().length, 2)],
    ['transaction edit', 'transactionsFilePath', p => p.updateTransaction({ ...transaction, amount: 25 }), p => assert.equal(p.getAllTransactions()[0].amount, 25)],
    ['transaction delete', 'transactionsFilePath', p => p.deleteTransaction('t1'), p => assert.equal(p.getAllTransactions().length, 0)],
    ['transaction import', 'transactionsFilePath', p => p.importTransactionsFromJSON('import.json'), p => assert.equal(p.getAllTransactions().filter(t => t.description === 'IMPORTED').length, 1)],
    ['account add', 'accountsFilePath', p => p.addAccount({ id: 'a2', name: 'New', type: 'saving', createdAt: '2026-01-01' }), p => assert.equal(p.getAccounts().length, 3)],
    ['account edit', 'accountsFilePath', p => p.updateAccount('saving-cash', { ...p.getAccounts().find(a => a.id === 'a1'), name: 'Wallet' }), p => assert.equal(p.getAccounts().find(a => a.id === 'a1').name, 'Wallet')],
    ['account delete', 'accountsFilePath', p => p.deleteAccount('saving-cash'), p => assert.equal(p.getAccounts().length, 1)],
    ['budget add', 'budgetFilePath', p => p.addBudget({ ...budget, id: 'b2' }), p => assert.equal(p.getAllBudgets().length, 2)],
    ['budget edit', 'budgetFilePath', p => p.updateBudget({ ...budget, amount: 150 }), p => assert.equal(p.getAllBudgets()[0].amount, 150)],
    ['budget delete', 'budgetFilePath', p => p.deleteBudget('b1'), p => assert.equal(p.getAllBudgets().length, 0)]
];

for (const [name, fileKey, mutate, verify] of operations) {
    test(`${name}: rejected writes preserve committed memory/disk and allow a clean retry`, async () => {
        const h = setup();
        const previousMemory = h.memory();
        const previousFiles = [...h.files];
        h.failures.add(h.p[fileKey]);
        await assert.rejects(mutate(h.p), /disk full/);
        assert.equal(h.memory(), previousMemory);
        assert.deepEqual([...h.files], previousFiles);
        assert.equal(h.refreshes(), 0);
        assert.ok(!h.notices.some(message => message.includes('Could not save')), 'storage failures propagate to the operation recovery UI');
        assert.ok(!h.notices.some(message => message.includes('successfully')));
        h.failures.clear();
        await mutate(h.p);
        verify(h.p);
    });
}

test('add, single edit and bulk edit reject self-transfers atomically before persistence', async () => {
    for (const toAccount of ['saving-cash', 'SAVING-CASH']) {
        const h = setup();
        const invalid = { ...transaction, type: 'internal', category: 'internal', fromAccount: 'saving-cash', toAccount };
        const before = h.memory();
        const files = [...h.files];
        for (const operation of [() => h.p.addTransaction({ ...invalid, id: 'new' }),
            () => h.p.updateTransaction(invalid), () => h.p.updateTransactions([transaction.id], invalid)]) {
            await assert.rejects(operation(), error => {
                assert.equal(error.name, 'TransactionValidationError');
                assert.match(error.message, /transfer accounts must differ/);
                assert.equal(h.p.saveErrors.has(error), false);
                return true;
            });
            assert.equal(h.memory(), before);
            assert.deepEqual([...h.files], files);
            assert.equal(h.refreshes(), 0);
        }
    }
});

test('unrelated saves retain historical self-transfers while valid endpoint edits remain P0-safe', async () => {
    const h = setup();
    const historical = { ...transaction, id: '20261015-120000-00000001', type: 'internal', category: 'internal',
        account: undefined, fromAccount: 'saving-cash', toAccount: 'saving-cash', time: '12:00:00', metadata: { keep: true } };
    h.p.transactionsData.transactions.push(historical);
    await h.p.addTransaction({ ...transaction, id: 'new' });
    assert.deepEqual(JSON.parse(JSON.stringify(h.p.getAllTransactions()[1])), JSON.parse(JSON.stringify(historical)));
    const before = h.memory();
    const files = [...h.files];
    h.failures.add(h.p.transactionsFilePath);
    const corrected = { ...historical, toAccount: 'other-default' };
    await assert.rejects(h.p.updateTransaction(corrected), /disk full/);
    assert.equal(h.memory(), before);
    assert.deepEqual([...h.files], files);
    h.failures.clear();
    await h.p.updateTransaction(corrected);
    assert.equal(h.p.getAllTransactions()[1].id, historical.id);
    assert.equal(h.p.getAllTransactions()[1].amount, historical.amount);
    assert.equal(h.p.getAllTransactions()[1].toAccount, 'other-default');
});

test('rollover setup and edits preserve committed metadata on failed saves and require an explicit restart period', async () => {
    const h = setup();
    const transactionBytes = h.files.get(h.p.transactionsFilePath);
    const transactionMemory = JSON.stringify(h.p.getAllTransactions());
    const original = h.memory();
    const files = [...h.files];
    const configured = { ...budget, rollover: true, rolloverStartDate: '2026-09-01' };
    h.failures.add(h.p.budgetFilePath);
    await assert.rejects(h.p.updateBudget(configured), /disk full/);
    assert.equal(h.memory(), original);
    assert.deepEqual([...h.files], files);
    h.failures.clear();
    await h.p.updateBudget(configured);
    const selected = models.parseLocalDate('2026-10-15');
    assert.equal(models.calculateBudgetStatus(h.p.getAllBudgets()[0], h.p.getAllTransactions(), selected).available, 200);
    const committed = h.files.get(h.p.budgetFilePath);
    await assert.rejects(h.p.updateBudget({ ...configured, amount: 300, rolloverStartDate: undefined }), /Choose a rollover start/);
    assert.equal(h.files.get(h.p.budgetFilePath), committed);
    await assert.rejects(h.p.updateBudget({ ...configured, rollover: false, rolloverStartDate: '2026-02-31' }), /Invalid rollover start/);
    await assert.rejects(h.p.addBudget({ ...budget, id: 'new', rollover: true }), /Choose a rollover start/);
    assert.equal(h.files.get(h.p.budgetFilePath), committed);
    await h.p.updateBudget({ ...configured, amount: 300, rolloverStartDate: '2026-10-01' });
    await h.p.loadBudgetData();
    assert.equal(models.calculateBudgetStatus(h.p.getAllBudgets()[0], h.p.getAllTransactions(), selected).available, 300);
    assert.equal(h.files.get(h.p.transactionsFilePath), transactionBytes);
    assert.equal(JSON.stringify(h.p.getAllTransactions()), transactionMemory);
    await h.p.updateBudget({ ...h.p.getAllBudgets()[0], rollover: false });
    assert.equal(h.p.getAllBudgets()[0].rolloverStartDate, undefined);
    await assert.rejects(h.p.updateBudget({ ...h.p.getAllBudgets()[0], rollover: true }), /Choose a rollover start/);
});

test('editing dates, times, amounts, and other fields never regenerates transaction IDs', async () => {
    for (const id of ['20261015-120000-1234abcd', 'old-transaction-id']) {
        const h = setup();
        h.p.transactionsData.transactions = [{ ...transaction, id, time: '12:00:00', notes: 'Keep notes', metadata: { keep: true } }];
        for (const patch of [{ date: '2025-12-31' }, { time: '23:59:59' }, { amount: 12.345 },
            { description: 'Edited description', notes: 'Edited notes' }]) {
            await h.p.updateTransaction({ ...h.p.getAllTransactions()[0], ...patch });
            assert.equal(h.p.getAllTransactions()[0].id, id);
            assert.equal(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0].id, id);
        }
        await h.p.updateTransactions([id], { id: 'attempted-replacement', date: '2027-01-01', time: '00:00:01' });
        const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
        assert.equal(saved.id, id);
        assert.equal(saved.amount, 12.345);
        assert.deepEqual(saved.metadata, { keep: true });
        assert.equal(saved.notes, 'Edited notes');
    }
});

test('writer preserves legacyId during safe edits with protected accounts and failed writes', async () => {
    const h = setup();
    const original = { ...h.p.getAllTransactions()[0], legacyId: 'old-source', notes: 'Keep until saved' };
    h.p.transactionsData.transactions = [original];
    const source = JSON.stringify({ transactions: [original], lastUpdated: 'original' });
    h.files.set(h.p.transactionsFilePath, source);
    h.p.protectDataset('accounts');
    h.failures.add(h.p.transactionsFilePath);
    await assert.rejects(h.p.updateTransaction({ ...original, notes: 'Saved note' }), /disk full/);
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.getAllTransactions()[0].legacyId, 'old-source');
    h.failures.clear();
    await h.p.updateTransaction({ ...original, notes: 'Saved note' });
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
    assert.equal(saved.legacyId, original.legacyId);
    assert.equal(h.p.getAllTransactions()[0].legacyId, original.legacyId);
    assert.equal(saved.id, original.id);
    assert.equal(saved.notes, 'Saved note');
    assert.equal(saved.amount, original.amount);
    assert.equal(h.p.isAccountDataProtected(), true);
});

test('ordinary and bulk writes order all transaction rows without changing custom fields, values or source order', async () => {
    const h = setup();
    const metadata = { notes: ' Child notes\n ', id: 'child', children: [{ time: 'keep', notes: ['a', 'b'] }] };
    const original = { customZ: metadata, ...transaction, time: '12:34:56', notes: ' Top notes\n ', legacyId: { source: ['keep'] }, categoryId: 'custom-category' };
    const before = JSON.stringify(original);
    h.p.transactionsData.transactions = [Object.freeze(original)];
    await h.p.addTransaction({ ...transaction, id: 'second' });
    let rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.deepEqual(rows.map(row => row.id), [original.id, 'second']);
    assert.deepEqual(rows[0], original);
    assert.deepEqual(Object.keys(rows[0]), ['id', 'description', 'amount', 'type', 'date', 'time', 'category', 'account', 'notes',
        'customZ', 'legacyId', 'categoryId']);
    await h.p.updateTransactions([original.id, 'second'], { description: 'BULK EDIT' });
    rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.deepEqual(rows[0], { ...original, description: 'BULK EDIT' });
    assert.equal(JSON.stringify(rows[0].customZ), JSON.stringify(metadata));
    assert.deepEqual(Object.keys(rows[1]), ['id', 'description', 'amount', 'type', 'date', 'category', 'account']);
    assert.equal(JSON.stringify(original), before);
});

test('legacy JSON export uses canonical top-level order without modifying the ledger', async () => {
    const h = setup();
    const original = { extra: { notes: 'keep', id: 'child' }, ...transaction, legacyId: 'keep' };
    h.p.transactionsData.transactions = [original];
    const memory = h.memory();
    const disk = h.files.get(h.p.transactionsFilePath);
    assert.equal(await h.p.exportTransactionsToJSON('export.json'), true);
    const output = JSON.parse(h.files.get('export.json'));
    assert.deepEqual(output, [original]);
    assert.deepEqual(Object.keys(output[0]), ['id', 'description', 'amount', 'type', 'date', 'category', 'account', 'extra', 'legacyId']);
    assert.equal(h.memory(), memory);
    assert.equal(h.files.get(h.p.transactionsFilePath), disk);
});

test('pending transaction writes do not publish an unsaved row', async () => {
    const h = setup();
    const previousMemory = h.memory();
    let complete;
    h.p.app.vault.adapter.write = (file, text) => new Promise(resolve => {
        complete = () => { h.files.set(file, text); resolve(); };
    });
    const pending = h.p.addTransaction({ ...transaction, id: 'pending' });
    assert.equal(h.memory(), previousMemory);
    assert.equal(h.refreshes(), 0);
    await new Promise(setImmediate);
    complete();
    await pending;
    assert.equal(h.p.getAllTransactions().length, 2);
    assert.equal(h.refreshes(), 1);
});

test('transaction creation omits blank notes and preserves non-empty notes without mutating the draft', async () => {
    for (const notes of [undefined, null, '', ' \t\n', ' Keep exact text \nline two ', '0']) {
        const h = setup();
        const draft = { ...transaction, id: 'new-with-optional-notes', notes };
        const before = JSON.stringify(draft);
        await h.p.addTransaction(draft);
        const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[1];
        assert.equal(JSON.stringify(draft), before);
        if (notes?.trim()) assert.equal(saved.notes, notes);
        else assert.equal(Object.hasOwn(saved, 'notes'), false);
        assert.equal(Object.hasOwn(h.p.getAllTransactions()[1], 'notes'), !!notes?.trim());
    }
});

test('clearing notes through edits or bulk edits removes the property and failed saves retain original notes', async () => {
    const h = setup();
    await h.p.updateTransaction({ ...transaction, notes: 'Keep until the edit is saved' });
    const memory = h.memory();
    const disk = h.files.get(h.p.transactionsFilePath);
    h.failures.add(h.p.transactionsFilePath);
    await assert.rejects(h.p.updateTransaction({ ...h.p.getAllTransactions()[0], notes: '' }), /disk full/);
    assert.equal(h.memory(), memory);
    assert.equal(h.files.get(h.p.transactionsFilePath), disk);
    h.failures.clear();
    await h.p.updateTransaction({ ...h.p.getAllTransactions()[0], notes: '' });
    assert.equal(Object.hasOwn(h.p.getAllTransactions()[0], 'notes'), false);
    assert.equal(Object.hasOwn(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0], 'notes'), false);
    await h.p.updateTransaction({ ...h.p.getAllTransactions()[0], notes: 'First note' });
    await h.p.addTransaction({ ...transaction, id: 'second', notes: 'Second note' });
    const write = h.p.app.vault.adapter.write;
    let writes = 0;
    h.p.app.vault.adapter.write = async (file, content) => { writes++; await write(file, content); };
    await h.p.updateTransactions(['t1', 'second'], { notes: ' \t\n' });
    assert.equal(writes, 1);
    assert.ok(h.p.getAllTransactions().every(transaction => !Object.hasOwn(transaction, 'notes')));
    assert.ok(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.every(transaction => !Object.hasOwn(transaction, 'notes')));
});

test('safe metadata edits with protected accounts still omit empty notes while preserving financial references', async () => {
    const h = setup();
    h.p.transactionsData.transactions[0].notes = '';
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
    const original = { ...h.p.getAllTransactions()[0] };
    const accounts = h.files.get(h.p.accountsFilePath);
    h.p.protectDataset('accounts');
    await h.p.updateTransaction({ ...original, description: 'Safe metadata edit' });
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
    assert.equal(Object.hasOwn(saved, 'notes'), false);
    assert.equal(saved.account, original.account);
    assert.equal(saved.amount, original.amount);
    assert.equal(saved.date, original.date);
    assert.equal(h.files.get(h.p.accountsFilePath), accounts);
    assert.equal(original.notes, '', 'normalization never mutates the source snapshot');
});

test('account edit restores the previous account file when transaction persistence fails', async () => {
    const h = setup();
    const before = h.memory();
    const oldAccounts = JSON.parse(h.files.get(h.p.accountsFilePath)).accounts;
    const oldAccountFile = h.files.get(h.p.accountsFilePath);
    const oldTransactions = h.files.get(h.p.transactionsFilePath);
    h.failures.add(h.p.transactionsFilePath);
    const update = () => h.p.updateAccount('saving-cash', { ...h.p.getAccounts().find(a => a.id === 'a1'), name: 'Wallet' });
    await assert.rejects(update(), /disk full/);
    assert.equal(h.memory(), before);
    assert.deepEqual(JSON.parse(h.files.get(h.p.accountsFilePath)).accounts, oldAccounts);
    assert.equal(h.files.get(h.p.accountsFilePath), oldAccountFile);
    assert.equal(h.files.get(h.p.transactionsFilePath), oldTransactions);
    assert.equal(h.refreshes(), 0);
    h.failures.clear();
    await update();
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-wallet');
    assert.equal(h.p.getAccounts().find(a => a.id === 'a1').name, 'Wallet');
});

test('failed account compensation remains protected and Retry restores it before reloading', async () => {
    const h = setup();
    const originalWrite = h.p.app.vault.adapter.write;
    let accountWrites = 0;
    h.p.app.vault.adapter.write = async (file, text) => {
        if (file === h.p.transactionsFilePath || (file === h.p.accountsFilePath && ++accountWrites > 1)) {
            throw new Error('disk full');
        }
        await originalWrite(file, text);
    };
    await assert.rejects(h.p.updateAccount('saving-cash', { ...h.p.getAccounts().find(a => a.id === 'a1'), name: 'Wallet' }), /disk full/);
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-cash');
    assert.equal(h.p.getAccounts().find(a => a.id === 'a1').name, 'Cash');
    await assert.rejects(h.p.addTransaction({ ...transaction, id: 'blocked' }), /protected/);
    await assert.rejects(h.p.addAccount({ id: 'blocked', name: 'New', type: 'saving' }), /protected/);
    h.p.app.vault.adapter.write = originalWrite;
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(JSON.parse(h.files.get(h.p.accountsFilePath)).accounts.find(a => a.id === 'a1').name, 'Cash');
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-cash');
    await h.p.updateAccount('saving-cash', { ...h.p.getAccounts().find(a => a.id === 'a1'), name: 'Wallet' });
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-wallet');
});

test('budget add does not mutate the caller draft when persistence fails', async () => {
    const h = setup();
    const draft = { ...budget, id: '' };
    h.failures.add(h.p.budgetFilePath);
    await assert.rejects(h.p.addBudget(draft), /disk full/);
    assert.equal(draft.id, '');
    assert.equal(draft.lastUpdated, 'initial');
});

test('bulk rename commits all rows in one save and refresh, or retains all rows on failure', async () => {
    const h = setup();
    h.p.transactionsData.transactions.push({ ...transaction, id: 't2' }, { ...transaction, id: 't3' });
    const { ExpensicaTransactionsView } = load('src/transactions-view.ts', {
        obsidian: { Modal: class {} }, './models': models,
        './notice': { showExpensicaNotice: message => h.notices.push(message) }
    });
    const view = Object.assign(Object.create(ExpensicaTransactionsView.prototype), {
        plugin: h.p, transactions: h.p.getAllTransactions(), selectedTransactionIds: new Set(['t1', 't2', 't3']),
        loadTransactionsData: async () => { view.transactions = h.p.getAllTransactions(); },
        persistTransactionsState() {}, refreshTransactionsListOnly() {}
    });
    const originalWrite = h.p.app.vault.adapter.write;
    let writes = 0;
    h.p.app.vault.adapter.write = async (file, text) => {
        if (++writes === 1) throw Error('disk full');
        await originalWrite(file, text);
    };
    await assert.rejects(view.bulkRenameSelectedTransactions('Renamed'), /disk full/);
    assert.deepEqual(Array.from(h.p.getAllTransactions(), t => t.description), ['ENTRY', 'ENTRY', 'ENTRY']);
    assert.equal(h.refreshes(), 0);
    assert.ok(!h.notices.some(message => message.includes('successfully')));
    h.p.app.vault.adapter.write = async (file, text) => { writes++; await originalWrite(file, text); };
    await view.bulkRenameSelectedTransactions('Renamed');
    assert.deepEqual(Array.from(h.p.getAllTransactions(), t => t.description), ['RENAMED', 'RENAMED', 'RENAMED']);
    assert.equal(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.length, 3);
    assert.equal(writes, 2, 'one failed attempt and one successful batch');
    assert.equal(h.refreshes(), 1);
});

test('import dialog retains its file selection after a failed write and closes after retry', async () => {
    const h = setup();
    class Element {
        constructor(tag, options = {}) { this.tag = tag; this.text = options.text; this.style = {}; this.cls = typeof options === 'string' ? options : options.cls; this.children = []; this.listeners = {}; }
        createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
        createDiv(options) { return this.createEl('div', options); }
        createSpan(options) { return this.createEl('span', options); }
        createSvg(tag, options) { return this.createEl(tag, options); }
        setCssProps(properties) { Object.assign(this.style, properties); }
        setCssStyles(properties) { Object.assign(this.style, properties); }
        empty() { this.children = []; }
        setAttribute() {}
        querySelector(selector) { return this.find(el => el.cls === selector.slice(1)); }
        addClass() {}
        click() {}
        addEventListener(name, fn) { this.listeners[name] = fn; }
        find(predicate) { return this.children.find(predicate) || this.children.map(child => child.find(predicate)).find(Boolean); }
    }
    const modal = new h.ImportModal({}, h.p);
    modal.contentEl = new Element('div');
    let closes = 0;
    modal.close = () => { closes++; };
    modal.onOpen();
    const input = modal.contentEl.find(el => el.tag === 'input');
    const button = modal.contentEl.find(el => el.text === 'Import');
    modal.selectSource('import.json');
    h.failures.add(h.p.transactionsFilePath);
    await button.listeners.click();
    assert.equal(closes, 0);
    assert.equal(modal.source, 'import.json');
    assert.equal(button.disabled, false);
    h.failures.clear();
    await button.listeners.click();
    assert.equal(closes, 1);
    assert.equal(h.p.getAllTransactions().filter(row => row.description === 'IMPORTED').length, 1);
});

test('blocked protected writes reject mutations without publishing them', async () => {
    const h = setup();
    h.p.protectDataset('transactions');
    const before = h.memory();
    await assert.rejects(h.p.addTransaction({ ...transaction, id: 'new' }), /protected/);
    assert.equal(h.memory(), before);
    assert.equal(h.refreshes(), 0);
});

function slowFirstWrite(h) {
    const writes = [];
    const completed = [];
    let active = 0;
    let maximum = 0;
    h.p.app.vault.adapter.write = async (file, content) => {
        const index = writes.length;
        writes.push({ file, content });
        maximum = Math.max(maximum, ++active);
        // An unsequenced second write would finish before the first.
        await new Promise(resolve => setTimeout(resolve, index === 0 ? 15 : 0));
        h.files.set(file, content);
        completed.push(index);
        active--;
    };
    return { writes, completed, maximum: () => maximum };
}

for (const dataset of ['transactions', 'accounts', 'budgets', 'settings']) {
    test(`${dataset}: slower old writes cannot overwrite newer queued mutations`, async () => {
        const h = setup();
        const storage = slowFirstWrite(h);
        let pending;
        if (dataset === 'transactions') {
            pending = [h.p.addTransaction({ ...transaction, id: 't2' }), h.p.addTransaction({ ...transaction, id: 't3' })];
        } else if (dataset === 'accounts') {
            pending = [h.p.addAccount({ id: 'a2', name: 'Second', type: 'saving' }), h.p.addAccount({ id: 'a3', name: 'Third', type: 'saving' })];
        } else if (dataset === 'budgets') {
            pending = [h.p.addBudget({ ...budget, id: 'b2' }), h.p.addBudget({ ...budget, id: 'b3' })];
        } else {
            h.p.saveData = data => h.p.app.vault.adapter.write('settings.json', JSON.stringify(data));
            h.p.settings.defaultCurrency = 'USD';
            h.p.settings.snapshot = { value: 1 };
            const first = h.p.saveSettings(false);
            h.p.settings.defaultCurrency = 'EUR';
            h.p.settings.snapshot.value = 2;
            pending = [first, h.p.saveSettings(false)];
        }
        await Promise.all(pending);
        assert.equal(storage.maximum(), 1);
        assert.deepEqual(storage.completed, [0, 1]);
        if (dataset === 'transactions') {
            assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.map(row => row.id), ['t1', 't2', 't3']);
        } else if (dataset === 'accounts') {
            const accounts = JSON.parse(h.files.get(h.p.accountsFilePath)).accounts;
            assert.ok(accounts.some(account => account.id === 'a2') && accounts.some(account => account.id === 'a3'));
        } else if (dataset === 'budgets') {
            assert.deepEqual(JSON.parse(h.files.get(h.p.budgetFilePath)).budgets.map(row => row.id), ['b1', 'b2', 'b3']);
        } else {
            assert.equal(JSON.parse(storage.writes[0].content).snapshot.value, 1, 'queued settings do not share mutable nested objects');
            assert.equal(JSON.parse(h.files.get('settings.json')).defaultCurrency, 'EUR');
            assert.equal(JSON.parse(h.files.get('settings.json')).snapshot.value, 2);
        }
    });
}

test('overlapping transaction add, edit and delete build from the latest committed state', async () => {
    const h = setup();
    const storage = slowFirstWrite(h);
    await Promise.all([
        h.p.addTransaction({ ...transaction, id: 't2' }),
        h.p.updateTransaction({ ...transaction, amount: 30 }),
        h.p.deleteTransaction('t1'),
        h.p.addTransaction({ ...transaction, id: 't3' }),
        h.p.updateTransaction({ ...transaction, id: 't2', amount: 25 })
    ]);
    assert.equal(storage.maximum(), 1);
    const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.deepEqual(rows.map(row => [row.id, row.amount]), [['t2', 25], ['t3', 10]]);
    assert.deepEqual(Array.from(h.p.getAllTransactions(), row => [row.id, row.amount]), rows.map(row => [row.id, row.amount]));
});

test('a failed queued mutation rejects only its caller; subsequent writes and retry remain usable', async () => {
    const h = setup();
    const write = h.p.app.vault.adapter.write;
    let writes = 0;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (++writes === 1) throw Error('disk full');
        await write(file, content);
    };
    const results = await Promise.allSettled([
        h.p.addTransaction({ ...transaction, id: 'failed' }),
        h.p.addTransaction({ ...transaction, id: 'next' })
    ]);
    assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled']);
    assert.deepEqual(Array.from(h.p.getAllTransactions(), row => row.id), ['t1', 'next']);
    await h.p.addTransaction({ ...transaction, id: 'failed' });
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.map(row => row.id), ['t1', 'next', 'failed']);
});

test('settings failures do not poison the queue or prevent later dataset saves', async () => {
    const h = setup();
    let writes = 0;
    h.p.saveData = async data => {
        if (++writes === 1) throw Error('settings unavailable');
        h.files.set('settings.json', JSON.stringify(data));
    };
    h.p.settings.defaultCurrency = 'USD';
    const first = h.p.saveSettings(false);
    h.p.settings.defaultCurrency = 'EUR';
    const second = h.p.saveSettings(false);
    const results = await Promise.allSettled([first, second, h.p.addBudget({ ...budget, id: 'next' })]);
    assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'fulfilled']);
    assert.equal(JSON.parse(h.files.get('settings.json')).defaultCurrency, 'EUR');
    assert.equal(h.p.getAllBudgets().length, 2);
});

test('account renames and transaction edits/additions keep stable account identities in queue order', async () => {
    const h = setup();
    const account = { ...h.p.getAccounts().find(row => row.id === 'a1') };
    slowFirstWrite(h);
    await Promise.all([
        h.p.updateAccount('saving-cash', { ...account, name: 'Wallet' }),
        h.p.addTransaction({ ...transaction, id: 'new' }),
        h.p.updateTransaction({ ...transaction, amount: 15 }),
        h.p.updateAccount('saving-cash', { ...account, name: 'Pocket' })
    ]);
    assert.equal(h.p.getAccounts().find(row => row.id === 'a1').name, 'Pocket');
    assert.deepEqual(Array.from(h.p.getAllTransactions(), row => [row.id, row.account, row.amount]), [
        ['t1', 'saving-pocket', 15], ['new', 'saving-pocket', 10]
    ]);
    assert.ok(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.every(row => row.account === 'saving-pocket'));
});

test('account rollback finishes before later queued mutations and cannot erase their data', async () => {
    const h = setup();
    const before = h.files.get(h.p.accountsFilePath);
    const write = h.p.app.vault.adapter.write;
    const order = [];
    let accountWrites = 0;
    let transactionWrites = 0;
    let finishRollback;
    h.p.app.vault.adapter.write = async (file, content) => {
        order.push(file);
        if (file === h.p.transactionsFilePath && ++transactionWrites === 1) throw Error('transaction save failed');
        if (file === h.p.accountsFilePath && ++accountWrites === 2) await new Promise(resolve => { finishRollback = resolve; });
        await write(file, content);
    };
    const pending = Promise.allSettled([
        h.p.updateAccount('saving-cash', { ...h.p.getAccounts().find(row => row.id === 'a1'), name: 'Wallet' }),
        h.p.addTransaction({ ...transaction, id: 'next' }),
        h.p.addBudget({ ...budget, id: 'next' })
    ]);
    await new Promise(setImmediate);
    assert.deepEqual(order, [h.p.accountsFilePath, h.p.transactionsFilePath, h.p.accountsFilePath]);
    finishRollback();
    const results = await pending;
    assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'fulfilled']);
    assert.equal(h.files.get(h.p.accountsFilePath), before);
    assert.deepEqual(Array.from(h.p.getAllTransactions(), row => row.id), ['t1', 'next']);
    assert.ok(h.p.getAllTransactions().every(row => row.account === 'saving-cash'));
    assert.equal(h.p.getAllBudgets().length, 2);
});

test('recovery rechecks wait for pending writes and cannot restore an older snapshot over a later mutation', async () => {
    const h = setup();
    const write = h.p.app.vault.adapter.write;
    const read = h.p.app.vault.adapter.read;
    let writes = 0;
    let reads = 0;
    let finishFirst;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (++writes === 1) await new Promise(resolve => { finishFirst = resolve; });
        await write(file, content);
    };
    h.p.app.vault.adapter.read = async file => { reads++; return read(file); };
    const first = h.p.addTransaction({ ...transaction, id: 'first', description: 'FIRST' });
    const recovery = h.p.retryDataRecovery();
    const second = h.p.addTransaction({ ...transaction, id: 'second', description: 'SECOND' });
    await new Promise(setImmediate);
    assert.equal(reads, 0);
    finishFirst();
    await Promise.all([first, recovery, second]);
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.map(row => row.description), ['ENTRY', 'FIRST', 'SECOND']);
});

test('default saves use current queued state and dataset saves preserve the other committed collections', async () => {
    const h = setup();
    const old = h.p.transactionsData;
    slowFirstWrite(h);
    await Promise.all([
        h.p.addTransaction({ ...transaction, id: 'new' }),
        h.p.saveAccountsData({ ...old, accounts: [...old.accounts, { id: 'extra', name: 'Extra', type: 'saving' }] }),
        h.p.saveTransactionsData()
    ]);
    assert.equal(h.p.getAllTransactions().length, 2);
    assert.ok(h.p.getAccounts().some(account => account.id === 'extra'));
    assert.equal(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.length, 2);
    assert.ok(JSON.parse(h.files.get(h.p.accountsFilePath)).accounts.some(account => account.id === 'extra'));
});

test('overlapping bulk patches and deletes save and refresh once per batch without losing unrelated changes', async () => {
    const h = setup();
    h.p.transactionsData.transactions.push({ ...transaction, id: 't2' }, { ...transaction, id: 't3' });
    const storage = slowFirstWrite(h);
    await Promise.all([
        h.p.updateTransactions(['t1', 't2'], { description: 'Renamed' }),
        h.p.updateTransactions(['t1', 't2'], { notes: 'Kept note' }),
        h.p.deleteTransactions(['t2', 't3'])
    ]);
    assert.equal(storage.writes.length, 3);
    assert.equal(h.refreshes(), 3);
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.p.getAllTransactions()[0].description, 'RENAMED');
    assert.equal(h.p.getAllTransactions()[0].notes, 'Kept note');
});

test('cancelled save verification is serialized with a new write and never restores the discarded draft', async () => {
    const h = setup();
    const owner = {};
    h.failures.add(h.p.transactionsFilePath);
    await h.p.runSaveOperation(owner, 'Add transaction', () => h.p.addTransaction({ ...transaction, id: 'discarded' }));
    h.p.releaseSaveOperation(owner);
    h.failures.clear();
    slowFirstWrite(h);
    await Promise.all([h.p.retrySaveRecovery(owner), h.p.addTransaction({ ...transaction, id: 'new', description: 'NEW' })]);
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.map(row => row.description), ['ENTRY', 'NEW']);
    assert.equal(h.p.hasSaveFailure(owner), false);
});

test('queued account deletion follows the account identity after a preceding rename', async () => {
    const h = setup();
    slowFirstWrite(h);
    await Promise.all([
        h.p.updateAccount('saving-cash', { ...h.p.getAccounts().find(row => row.id === 'a1'), name: 'Wallet' }),
        h.p.deleteAccount('saving-cash')
    ]);
    assert.ok(!h.p.getAccounts().some(row => row.id === 'a1'));
    assert.ok(!JSON.parse(h.files.get(h.p.accountsFilePath)).accounts.some(row => row.id === 'a1'));
});

test('overlapping imports, additions and budget edits retain all successful mutations', async () => {
    const h = setup();
    slowFirstWrite(h);
    await Promise.all([
        h.p.importTransactionsFromJSON('import.json'),
        h.p.addTransaction({ ...transaction, id: 'new', description: 'NEW' }),
        h.p.addBudget({ ...budget, id: 'b2' }),
        h.p.updateBudget({ ...budget, amount: 200 }),
        h.p.deleteBudget('b2')
    ]);
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.map(row => row.description), ['ENTRY', 'IMPORTED', 'NEW']);
    assert.deepEqual(JSON.parse(h.files.get(h.p.budgetFilePath)).budgets.map(row => [row.id, row.amount]), [['b1', 200]]);
});

test('dashboard bulk rename persists once and refreshes its source once', async () => {
    const h = setup();
    h.p.transactionsData.transactions.push({ ...transaction, id: 't2' }, { ...transaction, id: 't3' });
    const { ExpensicaDashboardView } = load('src/dashboard-view.ts', {
        obsidian: { ItemView: class {}, Modal: class {} }, './models': models,
        'chart.js': { Tooltip: { positioners: {} } },
        './notice': { showExpensicaNotice: message => h.notices.push(message) }
    });
    let renders = 0;
    let loads = 0;
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: h.p, transactions: h.p.getAllTransactions(), selectedTransactionIds: new Set(['t1', 't2', 't3']),
        loadTransactionsData: async () => { loads++; view.transactions = h.p.getAllTransactions(); },
        requestAllChartAnimations() {}, renderDashboard() { renders++; }
    });
    const storage = slowFirstWrite(h);
    await view.bulkRenameSelectedTransactions('Renamed');
    assert.equal(storage.writes.length, 1);
    assert.equal(h.refreshes(), 1);
    assert.equal(loads, 1);
    assert.equal(renders, 1);
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.map(row => row.description), ['RENAMED', 'RENAMED', 'RENAMED']);
});
