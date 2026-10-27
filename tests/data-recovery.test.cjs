const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

class Element {
    constructor(options = {}) { this.text = options.text; this.cls = typeof options === 'string' ? options : options.cls; this.children = []; this.listeners = {}; }
    createEl(tag, options) { const child = new Element(options); child.tag = tag; this.children.push(child); return child; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    setAttribute() {}
    querySelector(selector) {
        return this.children.find(child => child.cls === selector.slice(1))
            || this.children.map(child => child.querySelector(selector)).find(Boolean);
    }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    empty() { this.children = []; }
    addClass() {}
    find(text) { return this.children.find(child => child.text === text) || this.children.map(child => child.find(text)).find(Boolean); }
}
const modalText = element => [element.text, ...element.children.map(modalText)].join(' ');

function setup() {
    const dialogs = [];
    const notices = [];
    class Modal {
        constructor(app) { this.app = app; this.contentEl = new Element(); this.containerEl = new Element(); this.modalEl = new Element(); }
        open() { dialogs.push(this); this.onOpen(); }
        close() { this.onClose(); }
    }
    const obsidian = { Plugin: class {}, PluginSettingTab: class {}, Modal };
    function load(filename, dependencies = {}) {
        const exports = {};
        const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText;
        vm.runInNewContext(compiled, {
            exports, Date, console: { log() {}, error() {}, warn() {} },
            require(name) { return dependencies[name] || (name.endsWith('/modal-utils') ? load('src/modal-utils.ts') : {}); }
        });
        return exports;
    }
    const models = load('src/models.ts');
    const recovery = load('src/data-recovery-modal.ts', { obsidian });
    const Plugin = load('main.ts', {
        obsidian, './src/models': models, './src/data-recovery-modal': recovery,
        './src/dashboard-view': { EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
        './src/transaction-import': load('src/transaction-import.ts', { './models': models }),
        './src/notice': { showExpensicaNotice: message => notices.push(message) }
    }).default;
    const files = new Map();
    const writes = [];
    let readError = false;
    let existsError = false;
    const plugin = new Plugin();
    files.set(plugin.transactionsFilePath, JSON.stringify({ transactions: [], lastUpdated: 'initial' }));
    files.set(plugin.accountsFilePath, JSON.stringify({ accounts: [models.DEFAULT_ACCOUNT], lastUpdated: 'initial' }));
    files.set(plugin.budgetFilePath, JSON.stringify({ budgets: [], lastUpdated: 'initial' }));
    plugin.settings = { categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    plugin.app = {
        vault: { adapter: {
            exists: async file => { if (existsError) throw Error('Unavailable'); return files.has(file); },
            read: async file => { if (readError) throw Error('Unavailable'); return files.get(file); },
            write: async (file, content) => { writes.push(file); files.set(file, content); }
        } },
        workspace: { getLeavesOfType: () => [], layoutReady: true,
            activeLeaf: { view: { getViewType: () => 'expensica-dashboard-view', containerEl: {} } } }
    };
    return { plugin, files, writes, dialogs, notices, models,
        failReads(value) { readError = value; }, failExists(value) { existsError = value; } };
}

const transaction = { id: '20261015-120000-1234abcd', date: '2026-10-15', time: '12:00:00', type: 'expense', amount: 10, description: 'ENTRY', category: 'food', account: 'other-default' };
const datasets = [
    { name: 'transactions', file: 'transactionsFilePath', load: 'loadTransactionsData', save: 'saveTransactionsData', valid: { transactions: [transaction] } },
    { name: 'accounts', file: 'accountsFilePath', load: 'loadAccountsData', save: 'saveAccountsData', valid: { accounts: [{ name: 'Legacy cash' }] } },
    { name: 'budgets', file: 'budgetFilePath', load: 'loadBudgetData', save: 'saveBudgetData', valid: { budgets: [{ id: 'b', categoryId: 'food', amount: 100, period: 'monthly', rollover: false }] } }
];

test('P1 missing-account warning groups references, counts distinct transactions, and keeps dashboard protection after Not now', async () => {
    const h = setup();
    await h.plugin.loadAccountsData();
    const rows = [
        { ...transaction, account: 'saving-missing' },
        { ...transaction, id: '20261015-120000-00000001', type: 'internal', fromAccount: 'saving-missing', toAccount: 'credit-missing' },
        { ...transaction, id: '20261015-120000-00000002', account: 'credit-missing' }
    ];
    const source = JSON.stringify({ transactions: rows });
    h.files.set(h.plugin.transactionsFilePath, source);
    const view = new Element();
    h.plugin.app.workspace.getLeavesOfType = () => [{ view: { containerEl: { children: [null, view] } } }];
    await h.plugin.loadTransactionsData();
    const dialog = h.dialogs[0];
    assert.equal(dialog.contentEl.find('Missing accounts').cls, 'expensica-recovery-modal-warning');
    const rendered = modalText(dialog.contentEl);
    for (const reference of ['saving-missing', 'credit-missing']) {
        assert.equal(dialog.contentEl.find(`${reference}: 2 affected transactions`).cls, 'expensica-recovery-modal-file');
        assert.equal(rendered.split(reference).length - 1, 1);
    }
    const headingIndex = dialog.contentEl.children.indexOf(dialog.contentEl.find('Missing accounts'));
    assert.equal(dialog.contentEl.children[headingIndex + 1].text, '3 transactions reference an account that Expensica cannot find:');
    assert.ok(dialog.contentEl.find('Resolve accounts by editing transactions.json, linking to an existing account, or creating a new one.'));
    assert.ok(dialog.contentEl.find('Transaction saving is paused to protect your data.'));
    assert.doesNotMatch(rendered, /could not be loaded|Restore valid copies|transactions\[/);
    const buttons = dialog.contentEl.children.find(child => child.cls === 'modal-button-container').children;
    assert.deepEqual(buttons.map(button => button.text), ['Resolve accounts', 'Retry', 'Not now']);
    assert.deepEqual(buttons.filter(button => button.cls === 'mod-cta').map(button => button.text), ['Resolve accounts']);
    let resolutions = 0;
    h.plugin.openAccountReconciliation = async () => { resolutions++; };
    await dialog.contentEl.find('Resolve accounts').listeners.click();
    assert.equal(resolutions, 1);
    await dialog.contentEl.find('Retry').listeners.click();
    assert.ok(dialog.contentEl.find('Missing accounts'));
    dialog.contentEl.find('Not now').listeners.click();
    assert.equal(dialog.contentEl.children.length, 0);
    assert.equal(h.plugin.protectedDatasets.has('transactions'), true);
    assert.equal(view.querySelector('.expensica-data-recovery-warning').hidden, false);
    assert.equal(h.files.get(h.plugin.transactionsFilePath), source);
    assert.equal(h.writes.length, 0);
    const dashboardWarning = view.querySelector('.expensica-data-recovery-warning');
    const card = dashboardWarning.children[0];
    assert.equal(card.cls, 'expensica-recovery-card expensica-recovery-card-warning');
    assert.ok(card.find('Missing accounts'));
    assert.equal(card.find('Retry'), undefined);
    assert.doesNotMatch(modalText(card), /contents are not valid|Saving transactions is blocked/);
    const description = card.children[0].children.find(child => child.tag === 'p');
    assert.equal(description.children.map(child => child.text).join(''), "Several accounts in transactions.json are missing or don't exist.");
    assert.equal(card.find('transactions.json').cls, 'expensica-recovery-card-file');
    // More only reopens the existing recovery UI; it must not reload data or refresh charts.
    h.plugin.app.vault.adapter.read = async () => { assert.fail('More must not reload files'); };
    h.plugin.refreshExpensicaViews = async () => { assert.fail('More must not refresh views'); };
    await card.find('More').listeners.click();
    assert.equal(h.dialogs.length, 2);
    assert.ok(h.dialogs[1].contentEl.find('Missing accounts'));
    assert.deepEqual(h.dialogs[1].contentEl.children.find(child => child.cls === 'modal-button-container').children.map(button => button.text),
        ['Resolve accounts', 'Retry', 'Not now']);
    await card.find('More').listeners.click();
    assert.equal(h.dialogs.length, 2, 'More reuses an already open recovery dialog');
    assert.equal(h.plugin.protectedDatasets.has('transactions'), true);
    assert.equal(h.files.get(h.plugin.transactionsFilePath), source);
    assert.equal(h.writes.length, 0);
});

for (const count of [7, 8, 10]) {
    test(`P1 missing-account list shows at most seven of ${count} grouped accounts`, async () => {
        const h = setup();
        await h.plugin.loadAccountsData();
        const rows = Array.from({ length: count }, (_, index) => ({
            ...transaction, id: `20261015-120000-${String(index).padStart(8, '0')}`, account: `saving-missing-${index}`
        }));
        rows.push({ ...rows[0], id: '20261015-120000-ffffffff' });
        h.files.set(h.plugin.transactionsFilePath, JSON.stringify({ transactions: rows }));
        await h.plugin.loadTransactionsData();
        const content = h.dialogs[0].contentEl;
        assert.ok(content.find('Missing accounts'));
        assert.ok(content.find(`${count + 1} transactions reference an account that Expensica cannot find:`));
        assert.ok(content.find('saving-missing-0: 2 affected transactions'));
        const list = content.children.find(child => child.tag === 'ul');
        assert.equal(list.children.length, count > 7 ? 9 : 7);
        assert.equal(Boolean(content.find('...')), count > 7);
        if (count > 7) {
            assert.ok(content.find(`and ${count - 7} more`));
            assert.equal(content.find('saving-missing-7: 1 affected transaction'), undefined);
        }
        assert.equal(h.writes.length, 0);
    });
}

test('P1 warning Retry clears resolved protection quietly without saving or opening reconciliation', async () => {
    const h = setup();
    await h.plugin.loadAccountsData();
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify({ transactions: [{ ...transaction, account: 'saving-missing' }] }));
    await h.plugin.loadTransactionsData();
    const dialog = h.dialogs[0];
    assert.ok(dialog.contentEl.find('Resolve accounts'));
    assert.ok(dialog.contentEl.find('1 transaction references an account that Expensica cannot find:'));
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify({ transactions: [transaction] }));
    await dialog.contentEl.find('Retry').listeners.click();
    assert.equal(dialog.contentEl.children.length, 0);
    assert.equal(h.plugin.protectedDatasets.size, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.dialogs.length, 1);
});

test('critical failures retain red recovery instructions alongside a separate P1 warning', async () => {
    const h = setup();
    await h.plugin.loadAccountsData();
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify({ transactions: [{ ...transaction, account: 'saving-missing' }] }));
    await h.plugin.loadTransactionsData();
    h.files.set(h.plugin.budgetFilePath, '{broken');
    await h.plugin.loadBudgetData();
    const dialog = h.dialogs[0];
    assert.equal(dialog.contentEl.find('Expensica data could not be loaded').cls, 'expensica-recovery-modal-title');
    assert.equal(dialog.contentEl.find('Missing accounts').cls, 'expensica-recovery-modal-warning');
    assert.match(modalText(dialog.contentEl), /budgets\.json.*Restore valid copies/s);
    assert.doesNotMatch(modalText(dialog.contentEl), /transactions\[0\]/);
    assert.equal(h.writes.length, 0);
    // An account-file failure prevents reconciliation until the definitions recover.
    h.files.set(h.plugin.accountsFilePath, '{broken');
    await h.plugin.loadAccountsData();
    assert.equal(dialog.contentEl.find('Resolve accounts'), undefined);
    assert.equal(dialog.contentEl.find('Missing accounts'), undefined);
    assert.ok(dialog.contentEl.find('Close'));
    assert.equal(dialog.contentEl.find('Retry').cls, 'mod-cta');
});

test('P1 warning uses the Obsidian warning token and critical recovery retains the error token', () => {
    const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    assert.match(styles, /\.expensica-recovery-modal-warning\s*\{\s*color: var\(--text-warning\)/);
    assert.match(styles, /\.expensica-recovery-card-warning\s*\{\s*border-color: var\(--text-warning\);\s*background: var\(--expensica-warning-light\)/);
    assert.match(styles, /\.expensica-recovery-card-warning \.expensica-recovery-card-heading h3,\s*\.expensica-recovery-modal-warning/);
    for (const selector of ['expensica-recovery-card-file', 'expensica-recovery-modal-file']) {
        assert.match(styles, new RegExp(`\\.${selector}\\s*\\{\\s*color: var\\(--interactive-accent\\);\\s*font-style: italic;`));
    }
    assert.match(styles, /\.expensica-recovery-modal-title\s*\{\s*color: var\(--expensica-error\)/);
});

for (const dataset of datasets) {
    test(`${dataset.name}: only a missing file initializes defaults`, async () => {
        const h = setup();
        h.files.delete(h.plugin[dataset.file]);
        await h.plugin[dataset.load]();
        assert.equal(h.writes.length, 1);
        assert.ok(h.files.has(h.plugin[dataset.file]));
        assert.equal(h.dialogs.length, 0);
    });

    for (const content of ['{broken', 'null', '[]', '{}', JSON.stringify({ [dataset.name]: {} }), JSON.stringify({ [dataset.name]: [null] })]) {
        if (dataset.name === 'transactions' && content === '[]') continue;
        test(`${dataset.name}: protects invalid data ${content}`, async () => {
            const h = setup();
            const file = h.plugin[dataset.file];
            h.files.set(file, content);
            await h.plugin[dataset.load]();
            await assert.rejects(h.plugin[dataset.save](), /protected/);
            assert.equal(h.files.get(file), content);
            assert.equal(h.writes.length, 0);
            assert.equal(h.dialogs.length, 1);
        });
    }

    test(`${dataset.name}: Close retains protection; Retry reloads disk before enabling writes`, async () => {
        const h = setup();
        const file = h.plugin[dataset.file];
        h.files.set(file, JSON.stringify(dataset.valid));
        h.failReads(true);
        await h.plugin[dataset.load]();
        const dialog = h.dialogs[0];
        assert.ok(dialog);
        dialog.contentEl.find('Close').listeners.click();
        await assert.rejects(h.plugin[dataset.save](), /protected/);
        assert.equal(h.writes.length, 0);
        assert.equal(h.dialogs.length, 2, 'a blocked save makes recovery available again');
        // Further failures reuse the open recovery dialog.
        await h.plugin[dataset.load]();
        assert.equal(h.dialogs.length, 2);
        const retryDialog = h.dialogs.at(-1);
        await retryDialog.contentEl.find('Retry').listeners.click();
        assert.equal(h.writes.length, 0);
        h.failReads(false);
        await retryDialog.contentEl.find('Retry').listeners.click();
        await h.plugin[dataset.save]();
        assert.ok(h.writes.includes(file));
        assert.equal(JSON.parse(h.files.get(file))[dataset.name].length, 1);
    });

    test(`${dataset.name}: existence errors never initialize a file`, async () => {
        const h = setup();
        h.failExists(true);
        await h.plugin[dataset.load]();
        await assert.rejects(h.plugin[dataset.save](), /protected/);
        assert.equal(h.writes.length, 0);
        assert.equal(h.dialogs.length, 1);
    });

    test(`${dataset.name}: failed reload preserves loaded data and recovery replaces unsaved state`, async () => {
        const h = setup();
        const file = h.plugin[dataset.file];
        const collection = () => dataset.name === 'budgets'
            ? h.plugin.budgetData.budgets : h.plugin.transactionsData[dataset.name];
        h.files.set(file, JSON.stringify(dataset.valid));
        await h.plugin[dataset.load]();
        const before = JSON.stringify(collection());
        h.writes.length = 0;
        h.files.set(file, '{broken');
        await h.plugin[dataset.load]();
        assert.equal(JSON.stringify(collection()), before);
        collection().push({ id: 'unsaved' });
        await assert.rejects(h.plugin[dataset.save](), /protected/);
        assert.equal(h.writes.length, 0);
        h.files.set(file, JSON.stringify(dataset.valid));
        await h.dialogs[0].contentEl.find('Retry').listeners.click();
        assert.equal(collection().length, 1);
        assert.notEqual(collection()[0].id, 'unsaved');
        assert.equal(h.dialogs[0].contentEl.children.length, 0);
        await h.plugin[dataset.save]();
        assert.ok(h.writes.includes(file));
    });
}

test('multiple failures share one dialog and recover independently', async () => {
    const h = setup();
    for (const d of datasets) h.files.set(h.plugin[d.file], '{broken');
    for (const d of datasets) await h.plugin[d.load]();
    await h.plugin.loadTransactionsData();
    assert.equal(h.dialogs.length, 1);
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify(datasets[0].valid));
    await h.dialogs[0].contentEl.find('Retry').listeners.click();
    await h.plugin.saveTransactionsData();
    await assert.rejects(h.plugin.saveAccountsData(), /protected/);
    await assert.rejects(h.plugin.saveBudgetData(), /protected/);
    assert.deepEqual(h.writes, [h.plugin.transactionsFilePath]);
});

test('valid legacy optional fields and empty collections remain loadable', async () => {
    const h = setup();
    for (const d of datasets) {
        h.files.set(h.plugin[d.file], JSON.stringify(d.valid));
        await h.plugin[d.load]();
    }
    assert.equal(h.dialogs.length, 0);
    for (const d of datasets) {
        h.files.set(h.plugin[d.file], JSON.stringify({ [d.name]: [] }));
        await h.plugin[d.load]();
    }
    assert.equal(h.dialogs.length, 0);
});

test('record validation blocks unsafe field types without changing the source file', async () => {
    for (const [dataset, entry] of [
        [datasets[0], { ...transaction, amount: '10,00' }],
        [datasets[0], { ...transaction, description: {} }],
        [datasets[1], { name: { invalid: true } }],
        [datasets[1], { name: 'Cash', color: 10 }],
        [datasets[2], { ...datasets[2].valid.budgets[0], amount: '100' }]
    ]) {
        const h = setup();
        const file = h.plugin[dataset.file];
        const original = JSON.stringify({ [dataset.name]: [entry] });
        h.files.set(file, original);
        await h.plugin[dataset.load]();
        await assert.rejects(h.plugin[dataset.save](), /protected/);
        assert.equal(h.files.get(file), original);
        assert.equal(h.writes.length, 0);
        assert.equal(h.dialogs.length, 1);
    }
});

test('Retry ignores repeated clicks and Close during a read keeps the dialog dismissed', async () => {
    const h = setup();
    h.files.set(h.plugin.transactionsFilePath, '{broken');
    await h.plugin.loadTransactionsData();
    const dialog = h.dialogs[0];
    let finishRead;
    let reads = 0;
    h.plugin.app.vault.adapter.read = file => {
        if (file !== h.plugin.transactionsFilePath) return Promise.resolve(h.files.get(file));
        reads++;
        return new Promise(resolve => { finishRead = resolve; });
    };
    const retry = dialog.contentEl.find('Retry').listeners.click;
    const pending = retry();
    await new Promise(setImmediate);
    await retry();
    assert.equal(reads, 1);
    dialog.contentEl.find('Close').listeners.click();
    finishRead('{broken');
    await pending;
    assert.equal(h.writes.length, 0);
    assert.equal(h.dialogs.length, 1);
    assert.equal(dialog.contentEl.children.length, 0);
    await assert.rejects(h.plugin.saveTransactionsData(), /protected/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.dialogs.length, 2, 'an explicit save attempt can reopen recovery');
});

test('unload dismisses the recovery dialog', async () => {
    const h = setup();
    h.files.set(h.plugin.budgetFilePath, '{broken');
    await h.plugin.loadBudgetData();
    h.plugin.onunload();
    assert.equal(h.dialogs[0].contentEl.children.length, 0);
});

test('dashboard keeps recovery warnings after Close and exposes Retry without duplicating warnings in settings', async () => {
    const h = setup();
    const view = new Element();
    const settings = new Element();
    h.plugin.app.workspace.getLeavesOfType = () => [{ view: { containerEl: { children: [null, view] } } }];
    h.plugin.settingTab = { containerEl: settings };
    const file = h.plugin.transactionsFilePath;
    h.files.set(file, '{broken');
    await h.plugin.loadTransactionsData();
    h.dialogs[0].contentEl.find('Close').listeners.click();
    const warning = root => root.querySelector('.expensica-data-recovery-warning');
    assert.equal(warning(view).hidden, false);
    assert.equal(warning(settings), undefined);
    assert.ok(warning(view).find('Saving transactions is blocked'));
    h.plugin.refreshExpensicaViews = async () => {};
    await warning(view).find('Retry').listeners.click();
    assert.equal(warning(view).hidden, false);
    assert.equal(warning(settings), undefined);
    assert.equal(h.dialogs.length, 2, 'a failed card Retry reopens the detailed recovery dialog');
    assert.match(modalText(h.dialogs[1].contentEl), /transactions\.json/);
    assert.match(modalText(h.dialogs[1].contentEl), /invalid JSON syntax.*Fix the JSON syntax, then Retry/s);
    h.dialogs[1].close();
    h.files.set(file, JSON.stringify(datasets[0].valid));
    await warning(view).find('Retry').listeners.click();
    assert.equal(warning(view).hidden, true);
    assert.equal(warning(settings), undefined);
    assert.equal(h.plugin.transactionsData.transactions[0].id, transaction.id);
    assert.equal(h.dialogs.length, 2, 'successful card Retry opens no recovery dialog');
});

test('failed load-card retries show current details for each dataset without duplicate dialogs', async () => {
    for (const dataset of datasets) {
        const h = setup();
        await h.plugin.loadAccountsData();
        await h.plugin.loadTransactionsData();
        await h.plugin.loadBudgetData();
        const file = h.plugin[dataset.file];
        const original = h.files.get(file);
        h.files.set(file, '{broken');
        await h.plugin[dataset.load]();
        h.dialogs[0].close();
        const view = new Element();
        h.plugin.app.workspace.getLeavesOfType = () => [{ view: { containerEl: { children: [null, view] } } }];
        let refreshes = 0;
        h.plugin.refreshExpensicaViews = async () => { refreshes++; };
        h.plugin.renderDataRecoveryWarning(view);
        const retry = view.find('Retry').listeners.click;
        await Promise.all([retry(), retry()]);
        assert.equal(refreshes, 0, 'unchanged failed recovery must not rebuild the dashboard');
        assert.equal(h.dialogs.length, 2);
        assert.ok(modalText(h.dialogs[1].contentEl).includes(file));
        assert.match(modalText(h.dialogs[1].contentEl), /Restore valid copies of the files, then retry/);
        assert.equal(h.plugin.protectedDatasets.has(dataset.name), true);
        h.dialogs[1].close();
        h.files.set(file, original);
        await view.find('Retry').listeners.click();
        assert.equal(h.dialogs.length, 2);
        assert.equal(view.querySelector('.expensica-data-recovery-warning').hidden, true);
        assert.equal(h.plugin.protectedDatasets.size, 0);
        assert.equal(refreshes, 0, 'recovered protection alone needs only a card update');
    }
});

test('a recovered card disappears quietly while unrelated unresolved datasets remain recoverable', async () => {
    const h = setup();
    await h.plugin.loadAccountsData();
    const originalTransactions = h.files.get(h.plugin.transactionsFilePath);
    const originalBudgets = h.files.get(h.plugin.budgetFilePath);
    h.files.set(h.plugin.transactionsFilePath, '{broken transactions');
    h.files.set(h.plugin.budgetFilePath, '{broken budgets');
    await h.plugin.loadTransactionsData();
    await h.plugin.loadBudgetData();
    h.dialogs[0].close();
    const view = new Element();
    h.plugin.app.workspace.getLeavesOfType = () => [{ view: { containerEl: { children: [null, view] } } }];
    h.plugin.refreshExpensicaViews = async () => {};
    h.plugin.renderDataRecoveryWarning(view);
    h.files.set(h.plugin.transactionsFilePath, originalTransactions);
    let warning = view.querySelector('.expensica-data-recovery-warning');
    await warning.children.find(card => card.find('Saving transactions is blocked')).find('Retry').listeners.click();
    assert.equal(h.dialogs.length, 1, 'the clicked card recovered even though budgets remain unresolved');
    warning = view.querySelector('.expensica-data-recovery-warning');
    assert.equal(warning.find('Saving transactions is blocked'), undefined);
    assert.ok(warning.find('Saving budgets is blocked'));
    await warning.find('Retry').listeners.click();
    assert.equal(h.dialogs.length, 2);
    assert.match(modalText(h.dialogs[1].contentEl), /budgets\.json/);
    assert.doesNotMatch(modalText(h.dialogs[1].contentEl), /transactions\.json/);
    h.dialogs[1].close();
    h.files.set(h.plugin.budgetFilePath, originalBudgets);
    await view.find('Retry').listeners.click();
    assert.equal(h.dialogs.length, 2);
    assert.equal(view.querySelector('.expensica-data-recovery-warning').hidden, true);
});

test('recovery refreshes views only for changed transactions, accounts, or budgets, ignoring file timestamps', async () => {
    const h = setup();
    await h.plugin.loadAccountsData();
    await h.plugin.loadTransactionsData();
    await h.plugin.loadBudgetData();
    let refreshes = 0;
    h.plugin.refreshExpensicaViews = async () => { refreshes++; };
    for (const dataset of datasets) {
        const file = h.plugin[dataset.file];
        const contents = JSON.parse(h.files.get(file));
        contents.lastUpdated = 'changed timestamp only';
        h.files.set(file, JSON.stringify(contents));
    }
    assert.equal(await h.plugin.retryDataRecovery(), true);
    assert.equal(refreshes, 0);
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify({ transactions: [transaction] }));
    assert.equal(await h.plugin.retryDataRecovery(), true);
    assert.equal(refreshes, 1);
    h.files.set(h.plugin.budgetFilePath, JSON.stringify(datasets[2].valid));
    assert.equal(await h.plugin.retryDataRecovery(), true);
    assert.equal(refreshes, 2);
    const accounts = { accounts: h.plugin.getAccounts().map(account => ({ ...account, color: '#112233' })) };
    h.files.set(h.plugin.accountsFilePath, JSON.stringify(accounts));
    assert.equal(await h.plugin.retryDataRecovery(), true);
    assert.equal(refreshes, 3);
    assert.equal(await h.plugin.retryDataRecovery(), true);
    assert.equal(refreshes, 3);
});

test('persistent warnings track partial recovery and appear in newly rendered views', async () => {
    const h = setup();
    h.files.set(h.plugin.transactionsFilePath, '{broken');
    h.files.set(h.plugin.budgetFilePath, '{broken');
    await h.plugin.loadTransactionsData();
    await h.plugin.loadBudgetData();
    h.dialogs[0].close();
    const view = new Element();
    h.plugin.app.workspace.getLeavesOfType = () => [{ view: { containerEl: { children: [null, view] } } }];
    h.plugin.refreshExpensicaViews = async () => {};
    h.plugin.renderDataRecoveryWarning(view);
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify(datasets[0].valid));
    await h.plugin.retryDataRecovery();
    const warning = view.querySelector('.expensica-data-recovery-warning');
    assert.equal(warning.hidden, false);
    assert.ok(warning.find('Saving budgets is blocked'));
    assert.ok(!warning.find('Saving transactions is blocked'));
});

test('recovery requests from multiple entry points share one pending reload', async () => {
    const h = setup();
    h.files.set(h.plugin.budgetFilePath, '{broken');
    await h.plugin.loadBudgetData();
    let resolveRead;
    let reads = 0;
    h.plugin.app.vault.adapter.read = file => {
        if (file !== h.plugin.budgetFilePath) return Promise.resolve(h.files.get(file));
        reads++;
        return new Promise(resolve => { resolveRead = resolve; });
    };
    const first = h.plugin.retryDataRecovery();
    const second = h.plugin.retryDataRecovery();
    assert.equal(first, second);
    await new Promise(setImmediate);
    resolveRead(JSON.stringify(datasets[2].valid));
    assert.equal(await first, true);
    assert.equal(reads, 1);
    assert.equal(h.dialogs[0].contentEl.children.length, 0);
});

test('every Retry checks all three files, detects newly corrupt data, and clears only recovered datasets', async () => {
    const h = setup();
    const read = h.plugin.app.vault.adapter.read;
    const reads = [];
    h.plugin.app.vault.adapter.read = async file => { reads.push(file); return read(file); };
    h.files.set(h.plugin.budgetFilePath, '{invalid budgets');
    await h.plugin.loadBudgetData();
    h.files.set(h.plugin.transactionsFilePath, '{newly invalid transactions');
    reads.length = 0;
    assert.equal(await h.plugin.retryDataRecovery(), false);
    assert.deepEqual(reads, [h.plugin.accountsFilePath, h.plugin.transactionsFilePath, h.plugin.budgetFilePath]);
    assert.deepEqual([...h.plugin.protectedDatasets].sort(), ['budgets', 'transactions']);
    h.files.set(h.plugin.budgetFilePath, JSON.stringify({ budgets: [], lastUpdated: 'repaired' }));
    h.files.set(h.plugin.accountsFilePath, '{newly invalid accounts');
    reads.length = 0;
    assert.equal(await h.plugin.retryDataRecovery(), false);
    assert.deepEqual(reads, [h.plugin.accountsFilePath, h.plugin.transactionsFilePath, h.plugin.budgetFilePath]);
    assert.deepEqual([...h.plugin.protectedDatasets].sort(), ['accounts', 'transactions']);
    assert.equal(h.files.get(h.plugin.accountsFilePath), '{newly invalid accounts');
    assert.equal(h.files.get(h.plugin.transactionsFilePath), '{newly invalid transactions');
    assert.equal(h.writes.length, 0);
    h.files.set(h.plugin.accountsFilePath, JSON.stringify({ accounts: [h.models.DEFAULT_ACCOUNT] }));
    h.files.set(h.plugin.transactionsFilePath, JSON.stringify({ transactions: [], lastUpdated: 'repaired' }));
    assert.equal(await h.plugin.retryDataRecovery(), true);
    assert.equal(h.plugin.protectedDatasets.size, 0);
});

test('a failed account rollback still rechecks all files without publishing un-restored account data', async () => {
    const h = setup();
    const previousAccounts = JSON.stringify(h.plugin.getAccounts());
    h.plugin.pendingAccountRollback = JSON.stringify({ accounts: h.plugin.getAccounts() });
    h.plugin.protectDataset('accounts');
    h.plugin.protectDataset('transactions');
    h.files.set(h.plugin.accountsFilePath, JSON.stringify({ accounts: [{ id: 'changed', name: 'Un-restored account', type: 'saving' }] }));
    h.files.set(h.plugin.budgetFilePath, '{newly broken budget');
    h.plugin.app.vault.adapter.write = async () => { throw Error('Unavailable'); };
    assert.equal(await h.plugin.retryDataRecovery(), false);
    assert.equal(JSON.stringify(h.plugin.getAccounts()), previousAccounts);
    assert.deepEqual([...h.plugin.protectedDatasets].sort(), ['accounts', 'budgets', 'transactions']);
    assert.notEqual(h.plugin.pendingAccountRollback, null);
    assert.equal(h.files.get(h.plugin.budgetFilePath), '{newly broken budget');
});
