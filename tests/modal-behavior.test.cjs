const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Model capture and bubbling so the host's normal backdrop dismissal runs
// unless the dialog intercepts the event before it reaches that handler.
class Element {
    constructor(options = {}) { this.textContent = options.text || ''; this.children = []; this.listeners = []; this.style = {}; }
    createEl(tag, options) {
        const child = new Element(options); child.tag = tag; child.parent = this; this.children.push(child); return child;
    }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    addClass() {}
    setAttribute() {}
    empty() { this.children = []; }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    addEventListener(type, callback, capture = false) { this.listeners.push({ type, callback, capture }); }
    find(text) { return this.textContent === text ? this : this.children.map(child => child.find(text)).find(Boolean); }
    fire(type) {
        const route = [];
        for (let element = this; element; element = element.parent) route.push(element);
        const event = { type, target: this, stopped: false, stopImmediatePropagation() { this.stopped = true; } };
        const results = [];
        for (const [elements, capture] of [[route.slice().reverse(), true], [route, false]]) {
            for (const element of elements) for (const listener of element.listeners) {
                if (event.stopped) return results;
                if (listener.type === type && listener.capture === capture) results.push(listener.callback(event));
            }
        }
        return results;
    }
    click() { return this.fire('click'); }
}

class Modal {
    constructor(app) {
        this.app = app;
        this.containerEl = new Element();
        this.backdrop = this.containerEl.createDiv();
        this.modalEl = this.containerEl.createDiv();
        this.contentEl = this.modalEl.createDiv();
        this.closeCount = 0;
        this.backdrop.addEventListener('click', () => this.close());
        for (const type of ['mousedown', 'touchstart']) {
            this.containerEl.addEventListener(type, event => {
                if (!this.modalEl.contains(event.target)) this.close();
            });
        }
    }
    open() { this.opened = true; this.onOpen(); }
    close() { this.closeCount++; this.opened = false; this.onClose(); }
}

function load(filename, dependencies = {}, extra = '') {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extra, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, console: { error() {} },
        require(name) { return dependencies[name] || {}; }
    });
    return exports;
}
const utils = load('src/modal-utils.ts');
const models = load('src/models.ts');
const preparation = load('src/transaction-import.ts', { './models': models });
const obsidian = { Modal, Plugin: class {}, PluginSettingTab: class {} };
const { DataRecoveryModal } = load('src/data-recovery-modal.ts', { obsidian, './modal-utils': utils });
const { ImportModal, TransactionSummaryModal, AccountReconciliationModal } = load('main.ts', { obsidian,
    './src/modal-utils': utils, './src/transaction-import': preparation, './src/models': models,
    './src/account-card': load('src/account-card.ts', { './models': models })
}, '\nexport { ImportModal, TransactionSummaryModal, AccountReconciliationModal };');
const app = { vault: { adapter: {} } };
const reconciliation = () => new AccountReconciliationModal(app, { getAccounts: () => [], releaseSaveOperation() {} },
    new preparation.TransactionValidationError(0, 'account', 'unresolved', 'Choose an account',
        [{ index: 0, field: 'account', reason: 'unresolved', accountReference: 'saving-missing' }]), async () => {});

const dialogs = [
    ['P1 reconciliation choices', reconciliation, 'Cancel'],
    ['P1 reconciliation child step', () => { const owner = reconciliation(); owner.open(); owner.start('each'); return owner.child; }, 'Cancel'],
    ['P0 load recovery', () => new DataRecoveryModal(app, () => [{ name: 'Transactions', path: 'transactions.json' }],
        async () => false, () => {}), 'Close'],
    ['P1 missing-account validation', () => new DataRecoveryModal(app, () => [{ name: 'transactions', path: 'transactions.json' }],
        async () => false, () => {}, undefined, () => ({
            missingAccounts: [{ reference: 'saving-missing', count: 1, locations: [{ index: 0, field: 'account' }] }],
            resolve: async () => {}
        })), 'Not now'],
    ['P0 save recovery', () => new DataRecoveryModal(app, () => [], async () => false, () => {},
        () => ({ operation: 'Add transaction', error: 'Disk full', path: 'transactions.json' })), 'Back to Editor'],
    ['P1 startup report', () => new TransactionSummaryModal(app, 'Changes saved.', ['Duplicate IDs regenerated: 2']), 'OK'],
    ['P1 import report', () => new TransactionSummaryModal(app, 'Imported 2 transactions. Changes saved.', ['Alien IDs regenerated: 2']), 'OK'],
    ['P1 import validation', () => new ImportModal(app, {
        canEditData: () => true, releaseSaveOperation() {}, runSaveOperation: (_owner, _name, operation) => operation(),
        importTransactionsFromJSON: async () => { throw new preparation.TransactionValidationError(0, 'amount', 'expected a number'); }
    }), 'Close']
];

for (const [name, create, closeLabel] of dialogs) {
    test(`${name}: backdrop clicks and touches cannot dismiss the dialog; its action button can`, async () => {
        const modal = create();
        modal.open();
        if (modal instanceof ImportModal) {
            modal.selectSource('invalid.json');
            await Promise.all(modal.contentEl.find('Import').click());
            assert.ok(modal.contentEl.find('Import errors'));
        }
        const before = modal.contentEl.children.slice();
        for (const target of [modal.containerEl, modal.backdrop, modal.backdrop.createSpan()]) {
            for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
                target.fire(type);
                assert.equal(modal.opened, true, `${type} dismissed ${name}`);
                assert.equal(modal.closeCount, 0);
                assert.deepEqual(modal.contentEl.children, before);
            }
        }
        // Content interactions still reach their targets.
        let contentClicks = 0;
        modal.contentEl.addEventListener('click', () => contentClicks++);
        modal.contentEl.click();
        assert.equal(contentClicks, 1);
        await Promise.all(modal.contentEl.find(closeLabel).click());
        assert.equal(modal.opened, false);
        assert.equal(modal.closeCount, 1);
        const listenerCount = modal.containerEl.listeners.length;
        modal.open();
        assert.equal(modal.containerEl.listeners.length, listenerCount);
        modal.backdrop.click();
        assert.equal(modal.opened, true);
        await Promise.all(modal.contentEl.find(closeLabel).click());
        assert.equal(modal.closeCount, 2);
    });
}

test('the simulated host dismisses an ordinary unprotected modal on backdrop clicks', () => {
    const modal = new Modal(app);
    modal.onOpen = modal.onClose = () => {};
    modal.open();
    modal.backdrop.click();
    assert.equal(modal.opened, false);
    assert.equal(modal.closeCount, 1);
});
