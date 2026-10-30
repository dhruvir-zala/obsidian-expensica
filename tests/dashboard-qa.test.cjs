const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { Component } = require('./fixtures/obsidian-component.cjs');

class Element {
    constructor(tag = 'div', options = {}) {
        if (typeof options === 'string') options = { cls: options };
        this.tag = tag;
        this.children = [];
        this.listeners = {};
        this.attrs = { ...options.attr };
        this.classes = new Set((options.cls || '').split(' '));
        this.style = { setProperty() {} };
        this.textContent = options.text || '';
        this.value = options.attr?.value || '';
        this.disabled = false;
    }
    createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); el.parentElement = this; return el; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    createSvg(tag, options) { return this.createEl(tag, options); }
    setCssProps(properties) { Object.assign(this.style, properties); }
    setCssStyles(properties) { Object.assign(this.style, properties); }
    empty() { this.children = []; }
    addClass(name) { this.classes.add(name); }
    removeClass(name) { this.classes.delete(name); }
    hasClass(name) { return this.classes.has(name); }
    get classList() { return { contains: name => this.classes.has(name) }; }
    toggleClass(name, value) { value ? this.addClass(name) : this.removeClass(name); }
    setAttribute(key, value) { this.attrs[key] = value; }
    get ownerDocument() { return { addEventListener() {}, removeEventListener() {} }; }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
    click() { if (!this.disabled) this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); }
    matches(selector) {
        if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
        if (selector.startsWith('#')) return this.attrs.id === selector.slice(1);
        const attr = selector.match(/^(\w+)?\[([^=]+)="([^"]*)"\]$/);
        if (attr) return (!attr[1] || this.tag === attr[1]) && this.attrs[attr[2]] === attr[3];
        return this.tag === selector;
    }
    querySelectorAll(selector) {
        const selectors = selector.split(',').map(value => value.trim());
        return this.children.flatMap(child => [
            ...(selectors.some(value => child.matches(value)) ? [child] : []),
            ...child.querySelectorAll(selector)
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get options() { return this.children.filter(child => child.tag === 'option'); }
    focus() { this.focused = true; }
    reportValidity() { return true; }
    setText(text) { this.textContent = text; }
    closest() { return null; }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}

function load(filename, dependencies = {}, globals = {}, extraSource = '') {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extraSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, Event, console: { log() {}, error() {}, warn() {} }, ...globals,
        require(name) { return dependencies[name] || (name.endsWith('/modal-utils') ? load('src/modal-utils.ts') : {}); }
    });
    return exports;
}

const models = load('src/models.ts');
const accountCards = load('src/account-card.ts', { './models': models });
const shownModals = [];
const notices = [];
const presentationErrors = [];
class Modal {
    constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); this.containerEl = new Element(); }
    open() { shownModals.push(this); this.onOpen?.(); }
    close() { this.closed = true; this.onClose?.(); }
}
class DateSelectorModal extends Modal {
    constructor(app, initialDate, onConfirm, onDismiss) {
        super(app);
        Object.assign(this, { initialDate, onConfirm, onDismiss });
    }
    confirm(date) { this.close(); this.onConfirm(date); }
    onClose() { this.onDismiss?.(); }
}
const { ConfirmationModal } = load('src/confirmation-modal.ts', { obsidian: { Modal } });
class Chart {
    constructor(canvas, config) { this.data = config.data; this.config = config; }
    isDatasetVisible(index) { return !this.data.datasets[index].hidden; }
    hide(index) { this.data.datasets[index].hidden = true; }
    setDatasetVisibility(index, visible) { this.data.datasets[index].hidden = !visible; }
    update() {}
    stop() {}
    destroy() {}
}
const animationFrames = [];
const chartTimers = [];
const { ExpensicaDashboardView, TransactionModal, DateRangePickerModal, DateRangeType, BudgetModal, AccountEditorModal, AccountModal } = load('src/dashboard-view.ts', {
    obsidian: { Component, Modal, ItemView: Component, setIcon() {} }, './models': models,
    'chart.js/auto': { default: Chart }, 'chart.js': { Tooltip: { positioners: {} } },
    './date-selector-modal': { DateSelectorModal, formatDateForDisplay: value => value },
    './time-selector-modal': { formatTimeForDisplay: value => value },
    './confirmation-modal': { ConfirmationModal },
    './notice': { showExpensicaNotice: message => notices.push(message) },
    './category-chip': { renderCategoryChip: (container, options) => container.createEl('button', { text: options.text }) },
    './account-card': accountCards
}, {
    crypto: require('node:crypto').webcrypto,
    console: { log() {}, warn() {}, error: (...args) => presentationErrors.push(args) },
    setTimeout: callback => { chartTimers.push(callback); return chartTimers.length; },
    document: { addEventListener() {}, removeEventListener() {}, createElement: tag => new Element(tag),
        createElementNS: (namespace, tag) => new Element(tag), createTextNode: text => new Element('text', { text }) },
    FormData: class {
        constructor(form) { this.fields = form.querySelectorAll('input, select, textarea'); }
        get(name) { return this.fields.find(field => field.attrs.name === name)?.value || ''; }
    },
    window: {
        requestAnimationFrame: fn => { animationFrames.push(fn); return animationFrames.length; },
        setTimeout: callback => { chartTimers.push(callback); return chartTimers.length; }
    }
}, '\nexport { BudgetModal, AccountModal };');

function plugin(accounts = [{ ...models.DEFAULT_ACCOUNT }], enableAccounts = true) {
    const reference = account => models.formatAccountReference(account.type, account.name);
    return {
        async runSaveOperation(owner, operation, action) { try { return await action(); } catch { return false; } },
        releaseSaveOperation() {},
        canEditData: () => true,
        canSaveTransaction: () => true,
        isAccountDataProtected: () => false,
        settings: { enableAccounts, defaultCurrency: 'USD', lastTransactionSelection: {} },
        transactions: [],
        getAccounts: () => accounts,
        getAllTransactions() { return this.transactions; },
        getDefaultAccount: () => accounts[0],
        normalizeTransactionAccountReference: value => value ? models.parseAccountReference(value).reference : reference(accounts[0]),
        findAccountByReference(value) { return accounts.find(account => reference(account) === this.normalizeTransactionAccountReference(value)) || null; },
        getTransactionAccountDisplay(value) { return this.findAccountByReference(value) || accounts[0]; },
        getCategories: type => models.DEFAULT_CATEGORIES.filter(category => !type || category.type === type),
        getCategoryById: id => models.DEFAULT_CATEGORIES.find(category => category.id === id),
        getCategoryEmoji: () => ''
    };
}

for (const enableAccounts of [true, false]) {
    test(`Expense and Income remain selectable with one account (accounts enabled: ${enableAccounts})`, () => {
        const p = plugin(undefined, enableAccounts);
        const modal = new TransactionModal({}, p, { getDefaultTransactionDate: () => new Date(2026, 9, 1) });
        modal.onOpen();
        const display = modal.contentEl.querySelector('[aria-label="Choose type"]');
        const select = modal.contentEl.querySelector('#transaction-type');
        assert.equal(display.disabled, false);
        assert.deepEqual(Array.from(select.options, option => option.value), ['expense', 'income']);
        display.click();
        const menu = modal.contentEl.querySelector('[data-transaction-type="income"]').parentElement;
        assert.equal(menu.hasClass('expensica-select-hidden'), false);
        modal.contentEl.querySelector('[data-transaction-type="income"]').click();
        assert.equal(select.value, 'income');
        assert.equal(modal.contentEl.querySelector('#category').value, 'other_income');
        display.click();
        modal.contentEl.querySelector('[data-transaction-type="expense"]').click();
        assert.equal(select.value, 'expense');
        assert.equal(modal.contentEl.querySelector('#category').value, 'other_expense');
    });
}

test('Internal transfers are offered only when accounts are enabled and at least two exist', () => {
    const accounts = [{ ...models.DEFAULT_ACCOUNT }, { id: 's', name: 'Savings', type: 'saving', createdAt: '2026-01-01' }];
    for (const enableAccounts of [true, false]) {
        const modal = new TransactionModal({}, plugin(accounts, enableAccounts), { getDefaultTransactionDate: () => new Date(2026, 9, 1) });
        modal.onOpen();
        assert.equal(!!modal.contentEl.querySelector('[data-transaction-type="internal"]'), enableAccounts);
    }
});

function chartView(p, visibility = {}) {
    return Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: p, transactions: p.transactions,
        dateRange: { type: DateRangeType.CUSTOM, startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 2) },
        incomeExpenseVisibility: { income: true, expenses: true, net: true, accounts: visibility },
        getThemeColor: (token, fallback) => fallback, getThemeColorWithAlpha: (token, fallback) => fallback,
        getChartBarRadius: () => 0, getChartHelperTextColor: () => '#888',
        getChartAnimationOptions: () => false, getChartResizeDelay: () => 0,
        prepareChartCanvasSize() {}, shouldShowChartAxes: () => false, shouldShowChartGrid: () => false,
        getGridColor: () => '#888', getTooltipBackgroundColor: () => '#fff', getTooltipTitleColor: () => '#000',
        getTooltipBodyColor: () => '#000', getTooltipBorderColor: () => '#888',
        bindChartAreaTooltipClear() {}, persistDashboardState() {}, temporarilyEnableChartAnimations() {},
        cancelIncomeExpenseToggleAnimation() {}, cancelIncomeExpenseHoverAnimation() {}
    });
}

for (const code of ['USD', 'CAD', 'JPY', 'KWD']) {
    test(`${code} chart ticks and tooltip amounts share compact formatting`, () => {
        const p = plugin();
        p.settings.defaultCurrency = code;
        p.transactions = [{ id: 'income', date: '2026-09-01', type: 'income', amount: 1234.567 }];
        const view = chartView(p);
        view.createIncomeExpenseChart({});
        const options = view.incomeExpenseChart.config.options;
        assert.equal(options.scales.y.ticks.callback(1234.567), models.formatCurrency(1234.567, code, true));
        const label = options.plugins.tooltip.callbacks.label;
        const chartData = JSON.stringify(view.incomeExpenseChart.data);
        const ledger = JSON.stringify(p.transactions);
        for (const value of [0, 0.49, 0.5, 999.49, 999.5, 1000, 1540.89, 1000000]) {
            for (const raw of [value, -value]) {
                assert.equal(label({ dataset: { label: 'Income' }, raw }), `Income: ${models.formatCurrency(raw, code, true)}`);
                assert.equal(label({ dataset: { label: 'Expenses' }, raw }), `Expenses: ${models.formatCurrency(Math.abs(raw), code, true)}`);
            }
        }
        assert.equal(JSON.stringify(view.incomeExpenseChart.data), chartData);
        assert.equal(JSON.stringify(p.transactions), ledger);
    });
}

for (const [method, field] of [['createCumulativeExpensesChart', 'cumulativeExpensesChart'],
    ['createWeeklyExpensesChart', 'expensesChart'], ['createMonthlyExpensesChart', 'expensesChart']]) {
    test(`${method} tooltips use the same compact signed amounts without changing chart data`, () => {
        const p = plugin();
        p.settings.defaultCurrency = 'CAD';
        p.transactions = [{ id: 'original', date: '2026-09-01', type: 'expense', amount: 1540.89 }];
        const original = JSON.stringify(p.transactions);
        const view = chartView(p);
        view.getTextColor = () => '#000';
        view[method]({});
        const chart = view[field];
        const before = JSON.stringify(chart.data);
        const label = chart.config.options.plugins.tooltip.callbacks.label;
        for (const raw of [0, 0.49, -0.49, 12.5, -12.5, 999.49, 999.5, 1000, 1540.89, -1540.89, 1000000]) {
            assert.equal(label({ dataset: { label: 'Expenses' }, raw }), `Expenses: ${models.formatCurrency(raw, 'CAD', true)}`);
        }
        assert.equal(JSON.stringify(chart.data), before);
        assert.equal(JSON.stringify(p.transactions), original);
    });
}

for (const amount of ['0', '0.0000005', '1.234']) {
    test(`transaction editor saves accepted precise amount ${amount} without currency-unit rounding`, async () => {
        const h = recoveryHarness();
        h.storage.fail = false;
        h.p.settings.defaultCurrency = 'KWD';
        const editor = new TransactionModal(h.p.app, h.p, h.view);
        editor.open();
        const input = editor.contentEl.querySelector('#amount');
        assert.equal(input.attrs.step, 'any');
        assert.equal(input.attrs.min, '0');
        assert.equal(editor.contentEl.querySelector('.expensica-currency-symbol').textContent, 'د.ك');
        input.value = amount;
        editor.contentEl.querySelector('#description').value = 'Precise amount';
        const form = editor.contentEl.querySelector('form');
        await form.listeners.submit[0]({ preventDefault() {}, target: form });
        assert.equal(editor.closed, true);
        assert.equal(h.p.getAllTransactions()[0].amount, Number(amount));
        assert.equal(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0].amount, Number(amount));
        assert.equal(h.p.settings.defaultCurrency, 'KWD');
    });
}

test('budget and both credit-limit editors permit existing accepted decimal precision', async () => {
    const h = recoveryHarness();
    h.storage.fail = false;
    h.p.settings.defaultCurrency = 'KWD';
    const budget = new BudgetModal(h.p.app, h.p, h.view);
    budget.open();
    assert.equal(budget.amountInput.attrs.step, 'any');
    assert.equal(budget.amountInput.attrs.min, '0');
    budget.categorySelect.value = 'food';
    budget.amountInput.value = '1.234';
    const form = budget.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.equal(h.p.getAllBudgets()[0].amount, 1.234);
    const credit = { id: 'credit', name: 'Card', type: 'credit', createdAt: '2026-01-01', creditLimit: 1.234 };
    h.p.transactionsData.accounts.push(credit);
    const editor = new AccountEditorModal(h.p.app, h.p, h.view, credit);
    editor.open();
    const limit = editor.contentEl.querySelector('#credit-limit');
    assert.equal(limit.attrs.step, 'any');
    assert.equal(limit.attrs.min, '0');
    assert.equal(limit.value, '1.234');
    const creator = new AccountModal(h.p.app, h.p, h.view);
    creator.open();
    assert.equal(creator.contentEl.querySelector('#credit-limit').attrs.step, 'any');
});

test('CAD amount, budget, and credit-limit inputs keep a separate narrow symbol beside the number field', () => {
    const h = recoveryHarness();
    h.p.settings.defaultCurrency = 'CAD';
    const credit = { id: 'card', name: 'Card', type: 'credit', createdAt: '2026-01-01', creditLimit: 1.234 };
    h.p.transactionsData.accounts.push(credit);
    for (const editor of [new TransactionModal(h.p.app, h.p, h.view),
        new BudgetModal(h.p.app, h.p, h.view), new AccountEditorModal(h.p.app, h.p, h.view, credit)]) {
        editor.open();
        const wrapper = editor.contentEl.querySelector('.expensica-currency-input');
        assert.equal(wrapper.children[0].textContent, '$');
        assert.equal(wrapper.children[1].tag, 'input');
        assert.equal(wrapper.children[1].attrs.step, 'any');
        assert.equal(wrapper.children[1].attrs.min, '0');
    }
});

test('calendar Today preserves dashboard nodes and charts when the date range is unchanged', async () => {
    const root = new Element();
    const header = root.createDiv('shadcn-header');
    const tabs = root.createDiv('expensica-tabs');
    const summary = root.createDiv('expensica-summary');
    const chartNode = root.createEl('canvas');
    const today = models.parseLocalDate(models.formatDate(new Date()));
    const range = { type: DateRangeType.THIS_MONTH,
        startDate: new Date(today.getFullYear(), today.getMonth(), 1),
        endDate: new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999) };
    const charts = [{}, {}, {}];
    const updates = [];
    let saves = 0;
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        containerEl: { children: [null, root] }, dateRange: range,
        currentDate: new Date(today.getFullYear(), today.getMonth() - 1, 1), selectedCalendarDate: null,
        cumulativeExpensesChart: charts[0], expensesChart: charts[1], incomeExpenseChart: charts[2],
        premiumVisualizations: { updateDate: (...args) => updates.push(args) },
        persistDashboardState() { saves++; },
        loadTransactionsData() { assert.fail('Today must not reload unchanged transaction filters'); },
        renderDashboard() { assert.fail('Today must not rebuild the dashboard'); },
        requestAllChartAnimations() { assert.fail('Today must not animate unrelated charts'); }
    });
    await view.handleCalendarTodayClick();
    assert.equal(view.dateRange, range);
    assert.equal(models.formatDate(view.currentDate), models.formatDate(today));
    assert.equal(models.formatDate(view.getDefaultTransactionDate()), models.formatDate(today));
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1], true);
    assert.equal(saves, 1);
    assert.deepEqual(root.children, [header, tabs, summary, chartNode]);
    assert.equal(view.cumulativeExpensesChart, charts[0]);
    assert.equal(view.expensesChart, charts[1]);
    assert.equal(view.incomeExpenseChart, charts[2]);
});

test('calendar Today refreshes range-dependent content while retaining the header and tabs for a historical range', async () => {
    const root = new Element();
    const header = root.createDiv('shadcn-header');
    const label = header.createSpan({ cls: 'shadcn-date-range-text', text: 'Old range' });
    const oldOption = header.createDiv('shadcn-date-range-option shadcn-date-range-option-active');
    oldOption.textContent = 'Old range';
    const newOption = header.createDiv('shadcn-date-range-option');
    newOption.textContent = '1M';
    const action = header.createEl('button', { text: 'Transaction' });
    const tabs = root.createDiv('expensica-tabs');
    const oldBody = root.createDiv('old-content');
    const today = new Date();
    let loads = 0, saves = 0, renders = 0;
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        containerEl: { children: [null, root] }, currentTab: 'overview', plugin: {},
        dateRange: { type: DateRangeType.LAST_MONTH,
            startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
            endDate: new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999) },
        loadTransactionsData: async () => { loads++; }, persistDashboardState() { saves++; },
        requestAllChartAnimations() {}, consumeChartAnimationRequest() {},
        rememberScrollPosition() {}, restoreScrollPosition() {},
        renderCurrentTabContent(container) { renders++; container.createDiv('updated-content'); },
        renderDashboard() { assert.fail('Today must preserve the dashboard header and tabs'); }
    });
    await view.handleCalendarTodayClick();
    assert.equal(view.dateRange.type, DateRangeType.THIS_MONTH);
    assert.equal(models.formatDate(view.selectedCalendarDate), models.formatDate(today));
    assert.equal(loads, 1);
    assert.equal(saves, 1);
    assert.equal(renders, 1);
    assert.equal(root.children[0], header);
    assert.equal(root.children[1], tabs);
    assert.equal(header.querySelector('button'), action);
    assert.equal(label.textContent, view.dateRange.label);
    assert.equal(oldOption.hasClass('shadcn-date-range-option-active'), false);
    assert.equal(newOption.hasClass('shadcn-date-range-option-active'), true);
    assert.ok(!root.children.includes(oldBody));
    assert.ok(root.querySelector('.updated-content'));
});

test('single default account has correct balance data and draws visibly above coincident Net', () => {
    const p = plugin();
    p.transactions = [
        { id: 'i', date: '2026-08-31', type: 'income', amount: 100 },
        { id: 'e', date: '2026-09-01', type: 'expense', amount: 30 }
    ];
    const view = chartView(p);
    const legend = new Element();
    view.createIncomeExpenseChart({}, legend);
    const chart = view.incomeExpenseChart;
    const [income, expenses, net, account] = chart.data.datasets;
    assert.equal(account.label, 'Default');
    assert.equal(account.hidden, false);
    assert.deepEqual(Array.from(account.data), [70, 70]);
    assert.deepEqual(Array.from(net.data), [70, 70]);
    assert.ok(account.order < net.order, 'Chart.js draws the account after Net');
    assert.ok(net.borderWidth > account.borderWidth, 'the wider Net stroke remains visible underneath');
    assert.equal(legend.children[3].textContent, 'Default');
    legend.children[3].click();
    assert.equal(chart.isDatasetVisible(3), false);
    assert.equal(chart.isDatasetVisible(2), true);
    assert.equal(view.incomeExpenseVisibility.accounts['other-default'], false);
    view.createIncomeExpenseChart({}, legend);
    assert.equal(view.incomeExpenseChart.isDatasetVisible(3), false, 'explicit saved visibility is respected');
    legend.children[3].click();
    while (animationFrames.length) animationFrames.shift()();
    assert.equal(view.incomeExpenseChart.isDatasetVisible(3), true);
    assert.deepEqual(Array.from(view.incomeExpenseChart.data.datasets[3].data), [70, 70]);
    assert.equal(income.label, 'Income');
    assert.equal(expenses.label, 'Expenses');
});

test('default and credit chart balances preserve transfer signs with multiple accounts', () => {
    const p = plugin([{ ...models.DEFAULT_ACCOUNT }, { id: 'v', name: 'Visa', type: 'credit', createdAt: '2026-01-01' }]);
    p.transactions = [
        { id: 'i', date: '2026-08-31', type: 'income', amount: 100 },
        { id: 'e', date: '2026-09-01', type: 'expense', amount: 30, account: 'credit-visa' },
        { id: 't', date: '2026-09-02', type: 'internal', amount: 20, fromAccount: 'other-default', toAccount: 'credit-visa' }
    ];
    const view = chartView(p);
    view.createIncomeExpenseChart({});
    const data = view.incomeExpenseChart.data.datasets;
    assert.deepEqual(Array.from(data[3].data), [100, 80]);
    assert.deepEqual(Array.from(data[4].data), [-30, -10]);
    assert.deepEqual(Array.from(data[2].data), [70, 70]);
});

test('accounts disabled still includes the default balance and a single bucket has a visible point', () => {
    const p = plugin(undefined, false);
    p.transactions = [{ id: 'i', date: '2026-08-31', type: 'income', amount: 50 }];
    const view = chartView(p);
    view.getIncomeExpenseChartBuckets = () => [{ label: 'Day', start: new Date(2026, 8, 1), end: new Date(2026, 8, 1), income: 0, expenses: 0, net: 50, accountBalances: { 'other-default': 50 } }];
    view.createIncomeExpenseChart({});
    const account = view.incomeExpenseChart.data.datasets[3];
    assert.equal(account.hidden, false);
    assert.deepEqual(Array.from(account.data), [50]);
    assert.ok(account.pointRadius > 0);
});

test('a lone default-account balance stays visible when the range has earlier empty buckets', () => {
    const p = plugin();
    p.transactions = [{ id: 'first', date: '2026-09-02', type: 'income', amount: 50 }];
    const view = chartView(p);
    view.incomeExpenseVisibility = { income: false, expenses: false, net: false, accounts: {} };
    view.createIncomeExpenseChart({});
    const account = view.incomeExpenseChart.data.datasets[3];
    assert.deepEqual(Array.from(account.data), [null, 50]);
    assert.equal(account.hidden, false);
    assert.ok(account.pointRadius > 0, 'one real point needs a marker even when there are multiple buckets');
});

test('show and hover animations retain gaps around an isolated account balance', () => {
    const p = plugin();
    p.transactions = [{ id: 'first', date: '2026-09-02', type: 'income', amount: 50 }];
    const view = chartView(p, { 'other-default': false });
    view.createIncomeExpenseChart({});
    const chart = view.incomeExpenseChart;
    view.toggleIncomeExpenseDataset(chart, 3);
    assert.deepEqual(Array.from(chart.data.datasets[3].data), [null, 0]);
    while (animationFrames.length) animationFrames.shift()();
    assert.deepEqual(Array.from(chart.data.datasets[3].data), [null, 50]);
    view.replayIncomeExpenseDatasetAnimation(chart, 3);
    assert.deepEqual(Array.from(chart.data.datasets[3].data), [null, 0]);
    while (animationFrames.length) animationFrames.shift()();
    assert.deepEqual(Array.from(chart.data.datasets[3].data), [null, 50]);
    assert.equal(chart.isDatasetVisible(3), true);
});

test('Chart.js draws the isolated default-account point after animation settles', () => {
    const RealChart = require('chart.js/auto');
    const { BasicPlatform } = require('chart.js');
    const p = plugin();
    p.transactions = [{ id: 'first', date: '2026-09-02', type: 'income', amount: 50 }];
    const view = chartView(p);
    view.incomeExpenseVisibility = { income: false, expenses: false, net: false, accounts: {} };
    view.createIncomeExpenseChart({});
    const arcs = [];
    const canvas = { width: 640, height: 320 };
    const context = new Proxy({
        canvas,
        measureText: text => ({ width: String(text).length * 6 }),
        getLineDash: () => [],
        arc: (...args) => arcs.push(args)
    }, { get: (target, property) => property in target ? target[property] : () => {} });
    canvas.getContext = () => context;
    const chart = new RealChart(canvas, { ...view.incomeExpenseChart.config, platform: BasicPlatform });
    try {
        const meta = chart.getDatasetMeta(3);
        assert.equal(chart.isDatasetVisible(3), true);
        assert.equal(meta.data.filter(point => !point.skip).length, 1);
        const point = meta.data.find(point => !point.skip);
        assert.ok(point.options.radius > 0);
        assert.ok(arcs.some(([x, y, radius]) => x === point.x && y === point.y && radius > 0), 'the final balance actually paints a point');
    } finally {
        chart.destroy();
    }
});

function mutationView(p) {
    const effects = { loads: 0, renders: 0 };
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: p, transactions: p.transactions, selectedTransactionIds: new Set(),
        loadTransactionsData: async () => { effects.loads++; },
        renderDashboard: () => { effects.renders++; }, requestAllChartAnimations() {}
    });
    return { view, effects };
}

test('transaction editors display an optional notes input and omit blank notes from add and edit submissions', async () => {
    for (const editing of [false, true]) {
        for (const notes of ['', ' \t\n', ' Keep exact text \nline two ']) {
            const p = plugin();
            const original = { id: 't', date: '2026-09-01', time: '12:34:56', type: 'expense', amount: 10,
                category: 'food', description: 'Original', notes: 'An existing note' };
            p.transactions = editing ? [original] : [];
            p.saveSettings = async () => {};
            let submitted;
            p.addTransaction = p.updateTransaction = async transaction => { submitted = transaction; };
            const { view } = mutationView(p);
            const modal = new TransactionModal({}, p, view, editing ? original : null);
            modal.onOpen();
            const field = modal.contentEl.querySelector('#notes');
            assert.equal(field.value, editing ? original.notes : '');
            field.value = notes;
            modal.contentEl.querySelector('#description').value = 'Updated description';
            modal.contentEl.querySelector('#amount').value = '25';
            const form = modal.contentEl.querySelector('form');
            await form.listeners.submit[0]({ preventDefault() {}, target: form });
            assert.ok(submitted);
            assert.equal(Object.hasOwn(submitted, 'notes'), !!notes.trim());
            if (notes.trim()) assert.equal(submitted.notes, notes);
            assert.equal(modal.closed, true);
            assert.equal(original.notes, 'An existing note');
        }
    }
});

for (const editing of [false, true]) {
    test(`transaction editor preserves input on failed ${editing ? 'edit' : 'add'} and closes only after retry succeeds`, async () => {
        const p = plugin();
        const row = { id: 't', date: '2026-09-01', time: '12:34:56', type: 'expense', amount: 10, category: 'food', description: 'Original' };
        p.transactions = editing ? [row] : [];
        let fail = true;
        let saved = 0;
        p.saveSettings = async () => {};
        p.addTransaction = p.updateTransaction = async () => { if (fail) throw Error('disk full'); saved++; };
        const { view, effects } = mutationView(p);
        const modal = new TransactionModal({}, p, view, editing ? row : null);
        modal.onOpen();
        const form = modal.contentEl.querySelector('form');
        modal.contentEl.querySelector('#description').value = 'Unsaved input';
        modal.contentEl.querySelector('#amount').value = '25';
        const submit = () => form.listeners.submit[0]({ preventDefault() {}, target: form });
        const noticeStart = notices.length;
        await submit();
        assert.ok(!modal.closed);
        assert.equal(saved, 0);
        assert.equal(effects.loads, 0);
        assert.equal(effects.renders, 0);
        assert.equal(modal.contentEl.querySelector('#description').value, 'Unsaved input');
        assert.equal(form.querySelector('[type="submit"]').disabled, false);
        assert.ok(!notices.slice(noticeStart).some(message => message.includes('successfully')));
        fail = false;
        await submit();
        assert.equal(saved, 1);
        assert.equal(modal.closed, true);
        assert.equal(effects.renders, 1);
    });
}

test('transaction deletion leaves editor and confirmation open on failure, then closes after successful retry', async () => {
    const p = plugin();
    p.transactions = [{ id: 't', type: 'expense' }];
    let fail = true;
    p.deleteTransaction = async () => { if (fail) throw Error('disk full'); };
    const { view, effects } = mutationView(p);
    let editorClosed = 0;
    await view.deleteTransaction('t', undefined, () => { editorClosed++; });
    const confirmation = shownModals.at(-1);
    const button = confirmation.contentEl.querySelectorAll('button')[0];
    await button.listeners.click[0]();
    assert.ok(!confirmation.closed);
    assert.equal(editorClosed, 0);
    assert.equal(effects.renders, 0);
    fail = false;
    await button.listeners.click[0]();
    assert.equal(editorClosed, 1);
    assert.equal(confirmation.closed, true);
    assert.equal(effects.renders, 1);
});

test('account editor does not close or refresh after failed persistence', async () => {
    const p = plugin();
    let fail = true;
    let saves = 0;
    p.addAccount = async () => { if (fail) throw Error('disk full'); saves++; };
    const { view, effects } = mutationView(p);
    const modal = new AccountEditorModal({}, p, view);
    const draft = { id: 'new', name: 'Unsaved account', type: 'saving' };
    await p.runSaveOperation(modal, 'Add account', () => modal.persistAccount(draft));
    assert.ok(!modal.closed);
    assert.equal(effects.renders, 0);
    assert.equal(draft.name, 'Unsaved account');
    fail = false;
    await p.runSaveOperation(modal, 'Add account', () => modal.persistAccount(draft));
    assert.equal(saves, 1);
    assert.equal(modal.closed, true);
});

test('rollover editor requires an explicit start and retains it across unchanged saves, resetting on term edits', async () => {
    const p = plugin();
    const original = { id: 'b', categoryId: 'food', amount: 100, period: 'monthly', rollover: true, rolloverStartDate: '2026-09-01' };
    p.getAllBudgets = () => [original];
    p.getBudgetForCategory = () => original;
    const saved = [];
    p.updateBudget = async entry => saved.push(entry);
    const { view } = mutationView(p);
    const modal = new BudgetModal({}, p, view, original);
    modal.onOpen();
    modal.categorySelect.value = 'food';
    modal.amountInput.value = '100';
    modal.periodSelect.value = 'monthly';
    assert.equal(modal.rolloverStartInput.value, '');
    await modal.saveBudget();
    assert.equal(saved[0].rolloverStartDate, original.rolloverStartDate);
    for (const [field, value] of [['amountInput', '150'], ['periodSelect', 'quarterly'], ['categorySelect', 'rent']]) {
        modal[field].value = value;
        await assert.rejects(modal.saveBudget(), /Choose a rollover start/);
        modal.rolloverStartInput.value = '2026-10-01';
        await modal.saveBudget();
        assert.equal(saved.at(-1).rolloverStartDate, '2026-10-01');
        modal.rolloverStartInput.value = '';
        modal.amountInput.value = '100';
        modal.periodSelect.value = 'monthly';
        modal.categorySelect.value = 'food';
    }
    modal.isRollover = false;
    await modal.saveBudget();
    assert.equal(saved.at(-1).rolloverStartDate, undefined);
    assert.equal(original.amount, 100);
    assert.equal(original.rolloverStartDate, '2026-09-01');
    const button = modal.contentEl.querySelector('#budget-rollover-start');
    button.click();
    const picker = shownModals.at(-1);
    assert.ok(picker instanceof DateSelectorModal);
    assert.equal(picker.initialDate, '2026-09-01');
    modal.close();
    assert.equal(picker.closed, true);
});

test('new rollover budgets use the chosen start rather than inferring history and validate before saving', async () => {
    const p = plugin();
    p.getAllBudgets = () => [];
    p.getBudgetForCategory = () => undefined;
    const saved = [];
    p.addBudget = async entry => saved.push(entry);
    const { view } = mutationView(p);
    const modal = new BudgetModal({}, p, view);
    modal.onOpen();
    modal.categorySelect.value = 'food';
    modal.amountInput.value = '100';
    modal.periodSelect.value = 'monthly';
    modal.rolloverToggle.click();
    assert.equal(modal.rolloverStartInput.disabled, false);
    const form = modal.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {} });
    assert.equal(saved.length, 0);
    assert.ok(!modal.closed);
    const button = modal.contentEl.querySelector('#budget-rollover-start');
    button.isConnected = true;
    const picker = shownModals.at(-1);
    assert.ok(picker instanceof DateSelectorModal);
    const count = shownModals.length;
    button.click();
    assert.equal(shownModals.length, count);
    picker.close();
    assert.equal(modal.rolloverStartInput.value, '');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.focused, true);
    await form.listeners.submit[0]({ preventDefault() {} });
    shownModals.at(-1).confirm('2026-09-01');
    assert.equal(modal.rolloverStartInput.value, '2026-09-01');
    assert.equal(button.getAttribute('aria-label'), 'Choose rollover start date, 2026-09-01');
    await form.listeners.submit[0]({ preventDefault() {} });
    assert.equal(saved[0].rolloverStartDate, '2026-09-01');
    assert.equal(modal.closed, true);
});

test('budget editor retains its controls after a failed save and supports retry', async () => {
    const p = plugin();
    p.getAllBudgets = () => [];
    p.getBudgetForCategory = () => undefined;
    let fail = true;
    p.addBudget = async () => { if (fail) throw Error('disk full'); };
    const { view, effects } = mutationView(p);
    const modal = new BudgetModal({}, p, view);
    modal.onOpen();
    modal.categorySelect.value = 'food';
    modal.amountInput.value = '125';
    const form = modal.contentEl.querySelector('form');
    const submit = () => form.listeners.submit[0]({ preventDefault() {} });
    await submit();
    assert.ok(!modal.closed);
    assert.equal(modal.amountInput.value, '125');
    assert.equal(effects.renders, 0);
    fail = false;
    await submit();
    assert.equal(modal.closed, true);
    assert.equal(effects.renders, 0, 'budget persistence owns cross-view refresh');
});

test('legacy account creation form remains open on write failure', async () => {
    const p = plugin();
    let fail = true;
    p.addAccount = async () => { if (fail) throw Error('disk full'); };
    const { view, effects } = mutationView(p);
    const modal = new AccountModal({}, p, view);
    modal.onOpen();
    modal.contentEl.querySelector('#account-name').value = 'Unsaved account';
    modal.contentEl.querySelector('#account-type').value = 'saving';
    const form = modal.contentEl.querySelector('form');
    const submit = () => form.listeners.submit[0]({ preventDefault() {} });
    await submit();
    assert.ok(!modal.closed);
    assert.equal(effects.renders, 0);
    assert.equal(modal.contentEl.querySelector('#account-name').value, 'Unsaved account');
    fail = false;
    await submit();
    assert.equal(modal.closed, true);
});

test('delete confirmation prevents duplicate submissions and dismissal while persistence is pending', async () => {
    let complete;
    let submissions = 0;
    const confirmation = new ConfirmationModal({}, 'Delete?', 'Confirm deletion', async confirmed => {
        if (!confirmed) return;
        submissions++;
        await new Promise(resolve => { complete = resolve; });
    });
    confirmation.open();
    const button = confirmation.contentEl.querySelectorAll('button')[0];
    const first = button.listeners.click[0]();
    await button.listeners.click[0]();
    confirmation.close();
    assert.equal(submissions, 1);
    assert.equal(button.disabled, true);
    assert.ok(!confirmation.closed);
    complete();
    await first;
    assert.equal(confirmation.closed, true);
});

test('failed budget deletion keeps its confirmation open and emits no success feedback', async () => {
    const p = plugin();
    p.getAllBudgets = () => [{ id: 'b', categoryId: 'food' }];
    let fail = true;
    p.deleteBudget = async () => { if (fail) throw Error('disk full'); };
    const { view, effects } = mutationView(p);
    let closedEditor = 0;
    const noticeStart = notices.length;
    await view.deleteBudget('b', () => { closedEditor++; });
    const confirmation = shownModals.at(-1);
    const button = confirmation.contentEl.querySelectorAll('button')[0];
    await button.listeners.click[0]();
    assert.equal(closedEditor, 0);
    assert.equal(effects.renders, 0);
    assert.ok(!notices.slice(noticeStart).some(message => message.includes('successfully')));
    fail = false;
    await button.listeners.click[0]();
    assert.equal(closedEditor, 1);
    assert.equal(effects.renders, 0, 'budget persistence owns cross-view refresh');
});

// Use the real persistence, controller, and recovery modal together at UI boundaries.
const recoveryUI = load('src/data-recovery-modal.ts', { obsidian: { Modal } });
const transactionPreparation = load('src/transaction-import.ts', { './models': models });
const { default: PersistencePlugin, ImportModal } = load('main.ts', {
    obsidian: { Plugin: class {}, PluginSettingTab: class {}, Modal },
    './src/models': models, './src/data-recovery-modal': recoveryUI,
    './src/dashboard-view': { ExpensicaDashboardView, AccountEditorModal, EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
    './src/account-card': accountCards,
    './src/transaction-import': transactionPreparation,
    './src/notice': { showExpensicaNotice: message => notices.push(message) }
}, { crypto: require('node:crypto').webcrypto }, '\nexport { ImportModal };');

function recoveryHarness() {
    const p = new PersistencePlugin();
    p.settings = { enableAccounts: true, defaultCurrency: 'USD', lastTransactionSelection: {},
        categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    p.transactionsData = p.normalizeTransactionsSnapshot({ transactions: [], accounts: [{ ...models.DEFAULT_ACCOUNT }], lastUpdated: 'initial' });
    p.budgetData = { budgets: [], lastUpdated: 'initial' };
    p.saveSettings = async () => {};
    const container = new Element();
    const files = new Map([
        [p.transactionsFilePath, JSON.stringify({ transactions: [], lastUpdated: 'initial' })],
        [p.accountsFilePath, JSON.stringify({ accounts: p.getAccounts(), lastUpdated: 'initial' })],
        [p.budgetFilePath, JSON.stringify(p.budgetData)]
    ]);
    const storage = { fail: true, writes: 0 };
    p.app = { vault: { adapter: {
        exists: async file => files.has(file),
        read: async file => files.get(file),
        write: async (file, text) => {
            storage.writes++;
            if (storage.fail) throw Error('Permission denied');
            files.set(file, text);
        }
    } }, workspace: { getLeavesOfType: () => [{ view: { containerEl: { children: [null, container] } } }], layoutReady: true,
        getActiveViewOfType() { return this.activeLeaf?.view; },
        activeLeaf: { view: { getViewType: () => 'expensica-dashboard-view', containerEl: {} } } } };
    p.refreshExpensicaViews = async () => {};
    const { view, effects } = mutationView(p);
    return { p, view, effects, container, files, storage };
}

for (const editing of [false, true]) {
    for (const phase of ['loadTransactionsData', 'requestAllChartAnimations', 'renderDashboard']) {
        test(`committed transaction ${editing ? 'edit' : 'add'} closes the editor when ${phase} throws`, async () => {
            const h = recoveryHarness();
            const original = { id: '20261015-120000-00000001', description: 'ORIGINAL', amount: 10, type: 'expense',
                date: '2026-10-15', time: '12:00:00', category: 'food', account: 'other-default' };
            if (editing) h.p.transactionsData.transactions = [original];
            h.storage.fail = false;
            const error = new Error(`${phase} failed after commit`);
            h.view[phase] = () => { throw error; };
            const editor = new TransactionModal(h.p.app, h.p, h.view, editing ? original : null);
            editor.open();
            editor.contentEl.querySelector('#description').value = 'SAVED TRANSACTION';
            editor.contentEl.querySelector('#amount').value = '25';
            const form = editor.contentEl.querySelector('form');
            const noticeStart = notices.length, errorStart = presentationErrors.length, modalCount = shownModals.length;
            await form.listeners.submit[0]({ preventDefault() {}, target: form });
            const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
            assert.equal(h.storage.writes, 1);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].description, 'SAVED TRANSACTION');
            assert.equal(rows[0].amount, 25);
            if (editing) assert.equal(rows[0].id, original.id);
            assert.equal(editor.closed, true);
            assert.equal(editor.contentEl.children.length, 0);
            assert.equal(h.p.hasSaveFailure(editor), false);
            assert.equal(shownModals.length, modalCount, 'no recovery or discard confirmation after a committed save');
            assert.ok(presentationErrors.slice(errorStart).some(args => args.includes(error)));
            assert.ok(!notices.slice(noticeStart).some(message => /could not finish|input has been kept/.test(message)));
            assert.ok(notices.slice(noticeStart).includes(`Transaction ${editing ? 'updated' : 'added'} successfully`));
        });
    }

    test(`failed transaction ${editing ? 'edit' : 'add'} retains its draft and recovery until retry commits despite a render exception`, async () => {
        const h = recoveryHarness();
        const original = { id: '20261015-120000-00000001', description: 'ORIGINAL', amount: 10, type: 'expense',
            date: '2026-10-15', time: '12:00:00', category: 'food', account: 'other-default' };
        if (editing) h.p.transactionsData.transactions = [original];
        h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
        const disk = h.files.get(h.p.transactionsFilePath), memory = JSON.stringify(h.p.getAllTransactions());
        const error = new Error('render failed after retry committed');
        let renders = 0;
        h.view.renderDashboard = () => { renders++; throw error; };
        const editor = new TransactionModal(h.p.app, h.p, h.view, editing ? original : null);
        editor.open();
        editor.contentEl.querySelector('#description').value = 'RETAINED DRAFT';
        editor.contentEl.querySelector('#amount').value = '25';
        const form = editor.contentEl.querySelector('form');
        const submit = () => form.listeners.submit[0]({ preventDefault() {}, target: form });
        const noticeStart = notices.length, errorStart = presentationErrors.length;
        await submit();
        assert.equal(h.files.get(h.p.transactionsFilePath), disk);
        assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
        assert.ok(!editor.closed);
        assert.equal(editor.contentEl.querySelector('#description').value, 'RETAINED DRAFT');
        assert.equal(editor.contentEl.querySelector('#amount').value, '25');
        assert.equal(form.querySelector('[type="submit"]').disabled, false);
        assert.equal(h.p.hasSaveFailure(editor), true);
        assert.equal(renders, 0);
        assert.equal(presentationErrors.length, errorStart);
        assert.ok(!notices.slice(noticeStart).some(message => /successfully/.test(message)));
        const recovery = shownModals.at(-1);
        h.storage.fail = false;
        await recovery.contentEl.querySelectorAll('button').find(button => button.textContent === 'Retry').listeners.click[0]();
        const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.equal(h.storage.writes, 2);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].description, 'RETAINED DRAFT');
        assert.equal(rows[0].amount, 25);
        if (editing) assert.equal(rows[0].id, original.id);
        assert.equal(editor.closed, true);
        assert.equal(editor.contentEl.children.length, 0);
        assert.equal(h.p.hasSaveFailure(editor), false);
        assert.equal(renders, 1);
        assert.ok(presentationErrors.slice(errorStart).some(args => args.includes(error)));
        assert.ok(!notices.slice(noticeStart).some(message => /could not finish|input has been kept/.test(message)));
    });
}

for (const operation of ['create', 'edit', 'delete']) {
    test(`budget ${operation} UI refreshes two dashboards once through durable persistence`, async () => {
        const h = recoveryHarness();
        const entry = { id: 'budget', categoryId: 'food', amount: 100, period: 'monthly', rollover: false };
        if (operation !== 'create') h.p.budgetData.budgets = [entry];
        h.files.set(h.p.budgetFilePath, JSON.stringify(h.p.budgetData));
        Object.assign(h.view, { currentTab: 'budget', containerEl: { children: [null, h.container] }, isDashboardVisible: () => true,
            refreshCurrentTabContent() { h.effects.renders++; } });
        let otherRenders = 0;
        const other = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
            currentTab: 'budget', containerEl: { children: [null, new Element()] }, isDashboardVisible: () => true,
            refreshCurrentTabContent() { otherRenders++; },
            loadTransactionsData() { assert.fail('budget notifications must not reload transaction filters'); }
        });
        h.p.app.workspace.getLeavesOfType = () => [{ view: h.view }, { view: other }];
        h.p.refreshExpensicaViews = PersistencePlugin.prototype.refreshExpensicaViews.bind(h.p);
        let submit, editor;
        if (operation === 'delete') {
            await h.view.deleteBudget(entry.id);
            editor = shownModals.at(-1);
            const button = editor.contentEl.querySelectorAll('button')[0];
            submit = () => button.listeners.click[0]();
        } else {
            editor = new BudgetModal(h.p.app, h.p, h.view, operation === 'edit' ? entry : null);
            editor.open();
            editor.categorySelect.value = 'food';
            editor.amountInput.value = '125';
            const form = editor.contentEl.querySelector('form');
            submit = () => form.listeners.submit[0]({ preventDefault() {} });
        }
        const before = h.files.get(h.p.budgetFilePath);
        await submit();
        assert.equal(h.files.get(h.p.budgetFilePath), before);
        assert.equal(h.effects.renders + otherRenders, 0);
        assert.ok(!editor.closed);
        h.storage.fail = false;
        await submit();
        assert.equal(h.effects.renders, 1);
        assert.equal(otherRenders, 1);
        assert.equal(h.effects.loads, 0);
        assert.equal(editor.closed, true);
        assert.equal(h.storage.writes, 2, 'one failed write and one successful retry');
        assert.equal(h.p.getAllBudgets().length, operation === 'delete' ? 0 : 1);
        if (operation !== 'delete') assert.equal(h.p.getAllBudgets()[0].amount, 125);
    });
}
const recoveryButton = (modal, text) => modal.contentEl.querySelectorAll('button').find(button => button.textContent === text);
const press = (modal, text) => recoveryButton(modal, text).listeners.click[0]();
const modalText = element => [element.textContent, ...element.children.map(modalText)].join(' ');

function creditEditHarness(type = 'income', debt = 150) {
    const h = recoveryHarness();
    const accounts = [
        { id: 'cash', name: 'Cash', type: 'chequing', isDefault: true, createdAt: '2026-01-01' },
        { id: 'visa', name: 'Visa', type: 'credit', creditLimit: 100, createdAt: '2026-01-01' },
        { id: 'master', name: 'Master', type: 'credit', creditLimit: 100, createdAt: '2026-01-01' }
    ];
    const original = { id: '20261015-120000-00000002', date: '2026-10-15', time: '12:00:00', amount: 50,
        type, description: 'ORIGINAL', category: type === 'internal' ? 'internal' : type === 'income' ? 'salary' : 'food',
        ...(type === 'internal' ? { fromAccount: 'chequing-cash', toAccount: 'credit-visa' } : { account: 'credit-visa' }),
        notes: 'Keep notes' };
    const base = { id: '20200101-120000-00000001', date: '2020-01-01', time: '12:00:00', amount: debt,
        type: 'expense', description: 'OLDER DEBT', category: 'food', account: 'credit-visa' };
    h.p.transactionsData = h.p.normalizeTransactionsSnapshot({ transactions: [base, original], accounts, lastUpdated: 'initial' });
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts, lastUpdated: 'initial' }));
    h.view.transactions = []; // The dashboard's filtered rows must not determine credit debt.
    return { ...h, original };
}

for (const [name, type, selector] of [
    ['payment reassignment', 'income', '[data-account-reference="chequing-cash"]'],
    ['transfer endpoint change', 'internal', '[data-to-account-reference="credit-master"]'],
    ['transaction type change', 'income', '[data-transaction-type="expense"]']
]) {
    test(`credit validation rejects ${name} before persistence and retains the editor draft`, async () => {
        const h = creditEditHarness(type);
        h.storage.fail = false;
        const bytes = [...h.files];
        const memory = JSON.stringify(h.p.getAllTransactions());
        const editor = new TransactionModal(h.p.app, h.p, h.view, h.original);
        editor.open();
        editor.contentEl.querySelector(selector).click();
        const form = editor.contentEl.querySelector('form');
        const noticeStart = notices.length;
        await form.listeners.submit[0]({ preventDefault() {}, target: form });
        assert.ok(!editor.closed);
        assert.equal(editor.contentEl.querySelector('#amount').value, '50');
        assert.equal(form.querySelector('[type="submit"]').disabled, false);
        assert.equal(h.storage.writes, 0);
        assert.deepEqual([...h.files], bytes);
        assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
        assert.equal(h.effects.renders, 0);
        assert.equal(h.p.hasSaveFailure(editor), false);
        assert.ok(notices.slice(noticeStart).some(message => /credit limit for Visa/.test(message)));
    });
}

test('historical self-transfer editors retain endpoints, reject unchanged self-transfers and save only explicit corrections', async () => {
    const h = creditEditHarness('internal');
    h.original.toAccount = h.original.fromAccount;
    h.p.transactionsData.transactions[1] = { ...h.original };
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
    const files = [...h.files];
    const editor = new TransactionModal(h.p.app, h.p, h.view, h.original);
    editor.open();
    assert.equal(editor.contentEl.querySelector('#from-account').value, 'chequing-cash');
    assert.equal(editor.contentEl.querySelector('#to-account').value, 'chequing-cash');
    const form = editor.contentEl.querySelector('form');
    const submit = () => form.listeners.submit[0]({ preventDefault() {}, target: form });
    const noticeStart = notices.length;
    await submit();
    assert.ok(!editor.closed);
    assert.equal(h.storage.writes, 0);
    assert.deepEqual([...h.files], files);
    assert.ok(notices.slice(noticeStart).some(message => /Transfer accounts must differ/.test(message)));
    assert.equal(h.p.hasSaveFailure(editor), false);
    editor.contentEl.querySelector('[data-to-account-reference="credit-visa"]').click();
    await submit();
    assert.equal(h.storage.writes, 1);
    assert.deepEqual([...h.files], files);
    assert.ok(!editor.closed);
    assert.equal(editor.contentEl.querySelector('#to-account').value, 'credit-visa');
    h.storage.fail = false;
    await submit();
    assert.equal(editor.closed, true);
    assert.equal(h.p.getAllTransactions()[1].toAccount, 'credit-visa');
    assert.equal(h.p.getAllTransactions()[1].id, h.original.id);
    assert.equal(h.p.getAllTransactions()[1].amount, 50);
});

test('transfer creation and endpoint selections keep different accounts and preserve valid transfer behavior', async () => {
    const h = creditEditHarness('internal');
    h.storage.fail = false;
    const editor = new TransactionModal(h.p.app, h.p, h.view, null, 'internal');
    editor.open();
    editor.contentEl.querySelector('#description').value = 'VALID TRANSFER';
    editor.contentEl.querySelector('#amount').value = '10';
    for (const selector of ['[data-to-account-reference="chequing-cash"]', '[data-from-account-reference="chequing-cash"]']) {
        editor.contentEl.querySelector(selector).click();
        assert.notEqual(editor.contentEl.querySelector('#from-account').value, editor.contentEl.querySelector('#to-account').value);
    }
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.equal(editor.closed, true);
    const saved = h.p.getAllTransactions().at(-1);
    assert.equal(saved.type, 'internal');
    assert.equal(saved.amount, 10);
    assert.notEqual(saved.fromAccount, saved.toAccount);
});

test('credit debt reduction remains allowed above the limit, with P0-safe failed saves and retry', async () => {
    const h = creditEditHarness('expense');
    const original = JSON.stringify(h.p.getAllTransactions());
    const bytes = [...h.files];
    const editor = new TransactionModal(h.p.app, h.p, h.view, h.original);
    editor.open();
    editor.contentEl.querySelector('#amount').value = '25';
    const form = editor.contentEl.querySelector('form');
    const submit = () => form.listeners.submit[0]({ preventDefault() {}, target: form });
    const noticeStart = notices.length;
    await submit();
    assert.equal(h.storage.writes, 1, 'the reducing edit reaches persistence');
    assert.ok(!editor.closed);
    assert.equal(editor.contentEl.querySelector('#amount').value, '25');
    assert.deepEqual([...h.files], bytes);
    assert.equal(JSON.stringify(h.p.getAllTransactions()), original);
    assert.equal(h.effects.renders, 0);
    assert.equal(h.p.hasSaveFailure(editor), true);
    assert.ok(!notices.slice(noticeStart).some(message => /credit limit/.test(message)));
    h.storage.fail = false;
    await submit();
    assert.equal(editor.closed, true);
    assert.equal(h.storage.writes, 2);
    const saved = h.p.getAllTransactions();
    assert.deepEqual(Array.from(saved, row => row.id), ['20200101-120000-00000001', h.original.id]);
    assert.equal(saved[0].amount, 150);
    assert.equal(saved[1].amount, 25);
    assert.equal(saved[1].notes, h.original.notes);
    assert.equal(saved[1].time, h.original.time);
    assert.equal(h.effects.renders, 1);
});

test('unchanged over-limit edits close quietly without a credit warning or persistence', async () => {
    const h = creditEditHarness('expense');
    h.storage.fail = false;
    const bytes = [...h.files];
    const editor = new TransactionModal(h.p.app, h.p, h.view, h.original);
    editor.open();
    const form = editor.contentEl.querySelector('form');
    const noticeStart = notices.length;
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.equal(editor.closed, true);
    assert.equal(h.storage.writes, 0);
    assert.deepEqual([...h.files], bytes);
    assert.ok(!notices.slice(noticeStart).some(message => /credit limit/.test(message)));
});

test('save recovery shows operation, file and error; Back preserves input and the card retries current input once', async () => {
    const h = recoveryHarness();
    const editor = new TransactionModal(h.p.app, h.p, h.view);
    editor.open();
    const form = editor.contentEl.querySelector('form');
    editor.contentEl.querySelector('#description').value = 'First draft';
    editor.contentEl.querySelector('#amount').value = '25';
    const submit = () => form.listeners.submit[0]({ preventDefault() {}, target: form });
    const noticesBefore = notices.length;
    await submit();
    const dialog = shownModals.at(-1);
    assert.match(modalText(dialog.contentEl), /Add transaction.*transactions\.json.*permissions/s);
    assert.doesNotMatch(modalText(dialog.contentEl), /Permission denied/, 'technical diagnostics stay in the console');
    assert.ok(!editor.closed);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.effects.renders, 0);
    assert.equal(notices.length, noticesBefore, 'save failure uses recovery, not a generic notice');
    const modalCount = shownModals.length;
    await submit();
    assert.equal(shownModals.length, modalCount, 'another failure refreshes the same dialog');
    await press(dialog, 'Back to Editor');
    assert.equal(editor.contentEl.querySelector('#description').value, 'First draft');
    const warning = h.container.querySelector('.expensica-data-recovery-warning');
    assert.equal(warning.hidden, false);
    assert.match(modalText(warning), /Add transaction is unsaved.*permissions/);
    editor.contentEl.querySelector('#description').value = 'Corrected draft';
    const retry = warning.querySelector('button').listeners.click[0];
    h.storage.fail = false;
    const pending = retry();
    await retry();
    await pending;
    assert.equal(editor.closed, true);
    assert.equal(shownModals.length, modalCount, 'inline recovery does not open another dialog');
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.p.getAllTransactions()[0].description, 'CORRECTED DRAFT');
    assert.equal(warning.hidden, true);
    assert.equal(h.effects.renders, 1);
});

test('cancelling an editor retains the file error until a verified write, without saving the cancelled draft', async () => {
    const h = recoveryHarness();
    const editor = new BudgetModal(h.p.app, h.p, h.view);
    editor.open();
    editor.categorySelect.value = 'food';
    editor.amountInput.value = '125';
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {} });
    const dialog = shownModals.at(-1);
    assert.match(modalText(dialog.contentEl), /Add budget.*permissions/s);
    dialog.close();
    assert.equal(h.p.hasSaveFailure(editor), true);
    const warning = h.container.querySelector('.expensica-data-recovery-warning');
    assert.equal(warning.hidden, false);
    editor.close();
    assert.equal(h.p.hasSaveFailure(editor), true);
    assert.equal(warning.hidden, false);
    assert.equal(h.p.getAllBudgets().length, 0);
    await h.p.retryDataRecovery();
    assert.equal(warning.hidden, false, 'successful reads do not prove that a failed write is fixed');
    await warning.querySelector('button').listeners.click[0]();
    assert.equal(warning.hidden, false, 'failed verification keeps the card');
    const reopened = shownModals.at(-1);
    assert.match(modalText(reopened.contentEl), /budgets\.json.*permissions/s);
    assert.match(modalText(reopened.contentEl), /Check the vault folder permissions, then retry/);
    await press(reopened, 'Back to Editor');
    const modalCount = shownModals.length;
    const bytes = h.files.get(h.p.budgetFilePath);
    h.storage.fail = false;
    await warning.querySelector('button').listeners.click[0]();
    assert.equal(h.p.hasSaveFailure(editor), false);
    assert.equal(warning.hidden, true);
    assert.equal(h.files.get(h.p.budgetFilePath), bytes);
    assert.equal(h.p.getAllBudgets().length, 0);
    assert.equal(shownModals.length, modalCount, 'successful verification does not reopen recovery');
});

test('failed save-card retries reopen current file details once and leave unrelated cards intact', async () => {
    const h = recoveryHarness();
    const first = {}, second = {};
    const row = { id: 'unsaved', date: '2026-09-01', time: '12:34:56', type: 'expense', amount: 5,
        description: 'Kept draft', category: 'food', account: 'other-default' };
    await h.p.runSaveOperation(first, 'Add transaction', () => h.p.addTransaction(row));
    shownModals.at(-1).close();
    await h.p.runSaveOperation(second, 'Add budget', () => h.p.addBudget({ id: 'b', categoryId: 'food', amount: 100, period: 'monthly' }));
    shownModals.at(-1).close();
    const count = shownModals.length;
    const write = h.p.app.vault.adapter.write;
    h.p.app.vault.adapter.write = async (file, content) => {
        if (h.storage.fail) { h.storage.writes++; throw Error('disk full'); }
        return write(file, content);
    };
    const card = h.container.querySelectorAll('[data-recovery-kind="save"]').find(card => /Add transaction/.test(modalText(card)));
    const retry = card.querySelector('button').listeners.click[0];
    await Promise.all([retry(), retry()]);
    assert.equal(shownModals.length, count + 1);
    const details = shownModals.at(-1);
    assert.match(modalText(details.contentEl), /Add transaction.*transactions\.json.*storage space/s);
    assert.match(modalText(details.contentEl), /Free some space, then retry/);
    assert.equal(h.p.hasSaveFailure(first), true);
    assert.equal(h.p.hasSaveFailure(second), true);
    await press(details, 'Back to Editor');
    h.storage.fail = false;
    const before = shownModals.length;
    const retryCard = h.container.querySelectorAll('[data-recovery-kind="save"]').find(card => /Add transaction/.test(modalText(card)));
    await retryCard.querySelector('button').listeners.click[0]();
    assert.equal(shownModals.length, before);
    assert.equal(h.p.hasSaveFailure(first), false);
    assert.equal(h.p.hasSaveFailure(second), true);
    assert.equal(h.container.querySelectorAll('[data-recovery-kind="save"]').length, 1);
    assert.match(modalText(h.container), /Add budget is unsaved/);
});

test('a closed import error card reopens concise file details on failure and resolves without replaying the import', async () => {
    const h = recoveryHarness();
    h.files.set('source.json', JSON.stringify([{ id: 'never-committed', date: '2026-09-01', type: 'expense', amount: 10,
        description: 'Discarded import', category: 'food' }]));
    const editor = new ImportModal(h.p.app, h.p);
    editor.open();
    editor.selectSource('source.json');
    await press(editor, 'Import');
    await press(shownModals.at(-1), 'Close');
    await press(editor, 'Close');
    const before = shownModals.length;
    await h.container.querySelector('[data-recovery-kind="save"]').querySelector('button').listeners.click[0]();
    assert.equal(shownModals.length, before + 1);
    const details = shownModals.at(-1);
    assert.match(modalText(details.contentEl), /Import could not be saved.*transactions\.json.*permissions/s);
    assert.match(modalText(details.contentEl), /Check the vault folder permissions, then retry/);
    assert.doesNotMatch(modalText(details.contentEl), /expensica-data|Operation:|previously completed/);
    await press(details, 'Close');
    h.storage.fail = false;
    const count = shownModals.length;
    const disk = h.files.get(h.p.transactionsFilePath);
    await h.container.querySelector('[data-recovery-kind="save"]').querySelector('button').listeners.click[0]();
    assert.equal(shownModals.length, count);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.files.get(h.p.transactionsFilePath), disk);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
});

const clickAccountAction = (modal, label) => {
    const card = modal.contentEl.querySelectorAll('.expensica-account-card').find(card =>
        card.querySelector('.expensica-account-card-name').textContent === label);
    assert.ok(card, 'missing account action: ' + label);
    card.listeners.click[0]();
};
const chooseAccount = (child, id) => {
    clickAccountAction(child, 'Link existing account');
    const option = child.contentEl.querySelector('[data-account-id="' + id + '"]');
    assert.ok(option, 'missing account destination: ' + id);
    option.click();
};
async function draftAccount(child, name = 'User Card', type = 'credit') {
    clickAccountAction(child, 'Create new account');
    const editor = shownModals.at(-1);
    assert.ok(editor instanceof AccountEditorModal);
    assert.equal(editor.contentEl.querySelector('#account-name').value, '');
    editor.contentEl.querySelector('#account-name').value = name;
    editor.contentEl.querySelector('[data-account-type="' + type + '"]').click();
    if (type === 'credit') editor.contentEl.querySelector('#credit-limit').value = '123.45';
    await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
    assert.equal(editor.closed, true);
    return editor;
}
async function reconciliationFixture(references = ['saving-missing', 'credit-missing']) {
    const h = recoveryHarness();
    const input = references.map((account, index) => ({ id: '20261021-202211-' + String(index).padStart(8, '0'),
        date: '2026-09-21', time: '12:34:56', type: 'expense', amount: 10 + index, description: 'Keep ' + index,
        category: 'food', account, notes: 'Keep note', metadata: { keep: true } }));
    const source = JSON.stringify({ transactions: input, lastUpdated: 'original' });
    h.files.set('source.json', source);
    const owner = await h.p.openAccountReconciliation('source.json');
    return { ...h, owner, input, source };
}

test('account names use the existing account color while Create Account keeps theme styling', () => {
    const root = new Element();
    const account = { id: 'colored', name: 'Cash', type: 'saving', color: '#123456' };
    accountCards.renderAccountCard(root, { account, runningBalance: 0, lastTransactionDateLabel: 'Today',
        currencyCode: 'USD', color: account.color });
    assert.equal(root.querySelector('.expensica-account-card-name').style.color, '#123456');
    const card = accountCards.renderCreateAccountCard(root, { onClick() {} });
    assert.equal(card.querySelector('.expensica-account-card-name').style.color, undefined);
    assert.ok(card.hasClass('expensica-account-card-create'));
});

test('import reconciliation keeps the initial dialog underneath, stages a user draft, and saves only after the final summary', async () => {
    const h = recoveryHarness();
    const input = { id: '20261021-202211-0123abcd', date: '2026-09-21', time: '12:34:56', type: 'expense', amount: '10.50',
        description: 'Preserve details', category: 'food', account: 'saving-missing', notes: 'Keep notes', metadata: { keep: true } };
    const source = JSON.stringify({ transactions: [input] });
    h.files.set('source.json', source);
    const importer = new ImportModal(h.p.app, h.p);
    importer.open();
    importer.selectSource('source.json');
    await press(importer, 'Import');
    await press(importer, 'Resolve accounts');
    const owner = shownModals.at(-1);
    assert.ok(modalText(owner.contentEl).includes('Link to an existing account or create a new one. Nothing is saved until confirmed.'));
    assert.deepEqual(owner.contentEl.querySelectorAll('button').map(button => button.textContent),
        ['For each reference', 'For all unknown accounts', 'Cancel']);
    await press(owner, 'For each reference');
    const child = owner.child;
    assert.equal(shownModals.at(-1), child);
    assert.equal(owner.closed, false);
    assert.equal(child.contentEl.querySelector('.expensica-recovery-modal-file').textContent, 'saving-missing: 1 transaction');
    assert.equal(recoveryButton(child, 'Next').disabled, true);
    assert.equal(child.contentEl.querySelectorAll('.expensica-account-card-create').length, 2);
    await draftAccount(child);
    const draft = Array.from(owner.drafts.values())[0];
    assert.equal(draft.type, 'credit');
    assert.equal(draft.creditLimit, 123.45);
    assert.ok(models.normalizePaletteColor(draft.color));
    assert.match(modalText(child.contentEl), /will be created/);
    assert.equal(owner.choices.size, 0, 'Next commits the step selection to temporary state');
    assert.equal(h.storage.writes, 0);
    assert.equal(h.p.getAccounts().length, 1);
    await press(child, 'Next');
    assert.match(modalText(child.contentEl), /New accounts to create: 1.*User Card.*Credit.*Existing accounts to link: 0/s);
    assert.equal(h.storage.writes, 0);
    const writes = [];
    const write = h.p.app.vault.adapter.write;
    h.p.app.vault.adapter.write = async (file, content) => { writes.push(file); return write(file, content); };
    h.storage.fail = false;
    await press(child, 'Confirm');
    assert.deepEqual(writes, [h.p.accountsFilePath, h.p.transactionsFilePath]);
    assert.equal(h.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions, [{ ...input, description: input.description.toUpperCase(), account: 'credit-user card', amount: 10.5 }]);
    assert.equal(h.files.get('source.json'), source);
    assert.equal(importer.closed, true);
    assert.equal(owner.closed, true);
    assert.equal(child.closed, true);
});

test('per-reference navigation shares stable drafts, preserves Back/Next choices, and creates each selected draft once', async () => {
    const h = await reconciliationFixture(['saving-a', 'saving-b', 'saving-c']);
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    await draftAccount(child, 'Shared savings', 'saving');
    const draft = Array.from(h.owner.drafts.values())[0];
    await press(child, 'Next');
    assert.match(modalText(child.contentEl), /Reference 2 of 3/);
    clickAccountAction(child, 'Link existing account');
    const option = child.contentEl.querySelector('[data-account-id="' + draft.id + '"]');
    assert.match(option.textContent, /Shared savings.*will be created/);
    assert.equal(option.style.color, draft.color);
    assert.ok(option.textContent.includes(models.getAccountEmoji(draft.type)));
    option.click();
    await press(child, 'Next');
    chooseAccount(child, h.p.getAccounts()[0].id);
    await press(child, 'Cancel');
    assert.match(modalText(child.contentEl), /Reference 2 of 3.*Selected:.*Shared savings/s);
    await press(child, 'Cancel');
    assert.match(modalText(child.contentEl), /Reference 1 of 3.*Selected:.*Shared savings/s);
    await press(child, 'Next');
    await press(child, 'Next');
    assert.match(modalText(child.contentEl), /Selected:.*Default/s);
    await press(child, 'Next');
    assert.match(modalText(child.contentEl), /New accounts to create: 1.*Existing accounts to link: 1/s);
    await press(child, 'Cancel');
    assert.match(modalText(child.contentEl), /Reference 3 of 3/);
    assert.equal(h.owner.drafts.get(draft.id).id, draft.id);
    assert.equal(h.storage.writes, 0);
    await press(child, 'Next');
    h.storage.fail = false;
    await press(child, 'Confirm');
    assert.equal(h.storage.writes, 2);
    assert.equal(h.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions,
        h.input.map((row, index) => ({ ...row, description: row.description.toUpperCase(), account: index < 2 ? 'saving-shared savings' : 'other-default' })));
});

test('draft editing preserves its ID and shared mappings; removing it invalidates every dependent selection', async () => {
    const h = await reconciliationFixture();
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    await draftAccount(child, 'Original draft', 'saving');
    const draft = Array.from(h.owner.drafts.values())[0];
    await press(child, 'Next');
    chooseAccount(child, draft.id);
    await press(child, 'Next');
    await press(child, 'Cancel');
    clickAccountAction(child, 'Link existing account');
    const row = child.contentEl.querySelector('[data-account-id="' + draft.id + '"]').parentElement;
    row.querySelectorAll('button').find(button => button.textContent === 'Edit').click();
    const editor = shownModals.at(-1);
    assert.ok(editor instanceof AccountEditorModal);
    assert.equal(recoveryButton(editor, 'Delete'), undefined, 'draft editors never delete persisted accounts');
    editor.contentEl.querySelector('#account-name').value = 'Renamed draft';
    await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
    assert.equal(h.owner.drafts.size, 1);
    assert.equal(h.owner.drafts.get(draft.id).name, 'Renamed draft');
    assert.deepEqual(Array.from(h.owner.choices.values()), [draft.id, draft.id]);
    assert.match(modalText(child.contentEl), /Renamed draft/);
    const updatedRow = child.contentEl.querySelector('[data-account-id="' + draft.id + '"]').parentElement;
    updatedRow.querySelectorAll('button').find(button => button.textContent === 'Remove').click();
    assert.equal(h.owner.drafts.size, 0);
    assert.equal(h.owner.choices.size, 0);
    assert.equal(recoveryButton(child, 'Next').disabled, true);
    await press(child, 'Cancel');
    assert.equal(recoveryButton(child, 'Next').disabled, true);
    assert.equal(h.storage.writes, 0);
});

for (const create of [false, true]) {
    test('bulk reconciliation maps every unresolved reference to one ' + (create ? 'draft' : 'existing account') + ' only after Confirm', async () => {
        const h = await reconciliationFixture(['saving-a', 'saving-b', 'saving-a']);
        const accountFile = h.files.get(h.p.accountsFilePath);
        await press(h.owner, 'For all unknown accounts');
        const child = h.owner.child;
        assert.match(modalText(child.contentEl), /all 2 unknown account references/);
        if (create) await draftAccount(child, 'Bulk account', 'saving');
        else chooseAccount(child, h.p.getAccounts()[0].id);
        const destination = create ? Array.from(h.owner.drafts.values())[0] : h.p.getAccounts()[0];
        assert.equal(h.owner.choices.size, 0);
        assert.equal(h.storage.writes, 0);
        await press(child, 'Cancel');
        assert.equal(child.closed, true);
        assert.equal(h.owner.closed, false);
        await press(h.owner, 'For all unknown accounts');
        const reopened = h.owner.child;
        assert.equal(recoveryButton(reopened, 'Confirm').disabled, false, 'bulk selection survives returning to the initial dialog');
        h.storage.fail = false;
        await press(reopened, 'Confirm');
        assert.equal(h.storage.writes, create ? 2 : 1);
        if (!create) assert.equal(h.files.get(h.p.accountsFilePath), accountFile);
        assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions,
            h.input.map(row => ({ ...row, description: row.description.toUpperCase(), account: models.formatAccountReference(destination.type, destination.name) })));
        assert.equal(h.p.getAccounts().filter(account => account.id === destination.id).length, 1);
    });
}

test('full cancellation discards drafts and mappings and closes the child editor without writing', async () => {
    const h = await reconciliationFixture();
    const before = Array.from(h.files);
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    await draftAccount(child, 'Cancelled', 'saving');
    await press(child, 'Next');
    clickAccountAction(child, 'Create new account');
    const editor = shownModals.at(-1);
    h.owner.close();
    assert.equal(child.closed, true);
    assert.equal(editor.closed, true);
    assert.equal(h.owner.drafts.size + h.owner.choices.size, 0);
    assert.equal(h.storage.writes, 0);
    assert.deepEqual(Array.from(h.files), before);
    assert.equal(h.p.getAccounts().length, 1);
});

test('a failed bulk second write preserves transactions, reports no success, and retries the shared draft once', async () => {
    const h = await reconciliationFixture();
    await press(h.owner, 'For all unknown accounts');
    const child = h.owner.child;
    await draftAccount(child, 'Retry account', 'saving');
    const draft = Array.from(h.owner.drafts.values())[0];
    const source = h.files.get(h.p.transactionsFilePath);
    const startNotices = notices.length;
    const write = h.p.app.vault.adapter.write;
    const writes = [];
    h.storage.fail = false;
    let fail = true;
    h.p.app.vault.adapter.write = async (file, content) => {
        writes.push(file);
        if (file === h.p.transactionsFilePath && fail) throw Error('disk full');
        return write(file, content);
    };
    await press(child, 'Confirm');
    assert.equal(h.files.get(h.p.transactionsFilePath), source);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.equal(notices.length, startNotices);
    assert.equal(h.owner.closed, false);
    assert.equal(h.p.hasSaveFailure(h.owner), true);
    fail = false;
    await press(shownModals.at(-1), 'Retry');
    assert.deepEqual(writes, [h.p.accountsFilePath, h.p.transactionsFilePath, h.p.transactionsFilePath]);
    assert.equal(h.p.getAccounts().filter(account => account.id === draft.id).length, 1);
    assert.equal(h.owner.closed, true);
    assert.equal(h.p.getAllTransactions().length, 2);
});

test('ordinary invalid imports still reject atomically without offering reconciliation', async () => {
    const h = recoveryHarness();
    h.files.set('source.json', JSON.stringify([{ id: '20261021-202211-0123abcd', date: '2026-09-21', time: '12:34:56',
        type: 'expense', amount: 'invalid', description: 'Keep', category: 'food', account: 'saving-missing' }]));
    const editor = new ImportModal(h.p.app, h.p);
    editor.open();
    editor.selectSource('source.json');
    await press(editor, 'Import');
    assert.equal(editor.contentEl.querySelectorAll('button').some(button => button.textContent === 'Resolve accounts'), false);
    assert.equal(h.storage.writes, 0);
});

test('returning to the initial step preserves drafts and selections; unused drafts are never persisted', async () => {
    const h = await reconciliationFixture(['saving-missing']);
    await press(h.owner, 'For each reference');
    const first = h.owner.child;
    await draftAccount(first, 'Unused draft', 'saving');
    const draft = Array.from(h.owner.drafts.values())[0];
    await press(first, 'Cancel');
    assert.equal(h.owner.closed, false);
    assert.equal(h.owner.choices.get('saving-missing'), draft.id);
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    assert.match(modalText(child.contentEl), /Selected:.*Unused draft.*will be created/);
    chooseAccount(child, h.p.getAccounts()[0].id);
    await press(child, 'Next');
    assert.match(modalText(child.contentEl), /New accounts to create: 0.*Existing accounts to link: 1/s);
    assert.equal(h.owner.drafts.size, 1);
    assert.equal(h.storage.writes, 0);
    h.storage.fail = false;
    await press(child, 'Confirm');
    assert.equal(h.storage.writes, 1);
    assert.equal(h.p.getAccounts().some(account => account.id === draft.id), false);
});

test('bulk reconciliation rejects self-transfers atomically before creating the selected draft', async () => {
    const h = recoveryHarness();
    const input = { id: '20261021-202211-0123abcd', date: '2026-09-21', time: '12:34:56', type: 'internal', amount: 10,
        description: 'Keep transfer', category: 'internal', fromAccount: 'saving-missing', toAccount: 'credit-missing' };
    h.files.set('source.json', JSON.stringify([input]));
    const original = Array.from(h.files);
    const owner = await h.p.openAccountReconciliation('source.json');
    await press(owner, 'For all unknown accounts');
    const child = owner.child;
    await draftAccount(child, 'Shared destination', 'saving');
    h.storage.fail = false;
    await press(child, 'Confirm');
    assert.match(modalText(child.contentEl), /transfer accounts must differ/);
    assert.deepEqual(Array.from(h.files), original);
    assert.equal(h.storage.writes, 0);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.p.hasSaveFailure(owner), false);
    assert.equal(owner.closed, false);
});

test('confirmation revalidates account definitions from disk before writing mappings', async () => {
    const h = await reconciliationFixture(['saving-missing']);
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    chooseAccount(child, h.p.getAccounts()[0].id);
    await press(child, 'Next');
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [] }));
    const currentFiles = Array.from(h.files);
    h.storage.fail = false;
    await press(child, 'Confirm');
    assert.match(modalText(child.contentEl), /account references changed/);
    assert.equal(h.p.hasSaveFailure(h.owner), false);
    assert.equal(h.storage.writes, 0);
    assert.deepEqual(Array.from(h.files), currentFiles);
});

test('account selection supports keyboard navigation and Escape without changing a destination', async () => {
    const h = await reconciliationFixture(['saving-missing']);
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    clickAccountAction(child, 'Link existing account');
    const menu = child.contentEl.querySelector('.expensica-select-options');
    const option = menu.querySelector('[role="menuitemradio"]');
    const key = value => menu.listeners.keydown[0]({ key: value, target: option, preventDefault() {}, stopPropagation() {} });
    key('ArrowDown');
    assert.equal(option.focused, true);
    key('Escape');
    assert.equal(child.contentEl.querySelector('.expensica-select-options'), null);
    assert.equal(child.contentEl.querySelectorAll('.expensica-account-card')[1].focused, true);
    assert.equal(recoveryButton(child, 'Next').disabled, true);
    assert.equal(h.owner.choices.size, 0);
    assert.equal(h.storage.writes, 0);
});

test('reconciliation summary displays full capitalized names and types for both new and linked accounts', async () => {
    const h = await reconciliationFixture();
    const existing = { id: 'existing', name: 'existing account with a long full name', type: 'saving', color: '#123456' };
    h.p.transactionsData.accounts = [existing];
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: [existing] }));
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    await draftAccount(child, 'testing account with a long full name', 'saving');
    await press(child, 'Next');
    chooseAccount(child, existing.id);
    await press(child, 'Next');
    assert.deepEqual(child.contentEl.querySelectorAll('li').map(item => item.textContent), [
        models.getAccountEmoji('saving') + ' Testing account with a long full name - Saving',
        models.getAccountEmoji('saving') + ' Existing account with a long full name - Saving'
    ]);
    assert.equal(h.p.getAccounts()[0].name, existing.name, 'display formatting does not change stored names');
    assert.equal(h.storage.writes, 0);
});

test('Cancel from the account list returns to the current reference actions before going back a reference', async () => {
    const h = await reconciliationFixture();
    await press(h.owner, 'For each reference');
    const child = h.owner.child;
    chooseAccount(child, h.p.getAccounts()[0].id);
    await press(child, 'Next');
    clickAccountAction(child, 'Link existing account');
    await press(child, 'Cancel');
    assert.equal(h.owner.child, child);
    assert.equal(child.closed, undefined);
    assert.match(modalText(child.contentEl), /Reference 2 of 2/);
    assert.equal(child.contentEl.querySelector('.expensica-select-options'), null);
    await press(child, 'Cancel');
    assert.match(modalText(child.contentEl), /Reference 1 of 2.*Selected:.*Default/s);
    clickAccountAction(child, 'Link existing account');
    await press(child, 'Cancel');
    assert.equal(h.owner.child, child);
    assert.match(modalText(child.contentEl), /Reference 1 of 2/);
    await press(child, 'Cancel');
    assert.equal(h.owner.child, null);
    assert.equal(h.owner.closed, false);
    assert.equal(h.storage.writes, 0);
});

test('failed deletion retries from recovery and reports success only after persistence', async () => {
    const h = recoveryHarness();
    h.p.budgetData.budgets = [{ id: 'b', categoryId: 'food', amount: 100, period: 'monthly' }];
    h.files.set(h.p.budgetFilePath, JSON.stringify(h.p.budgetData));
    let closedEditor = 0;
    const before = notices.length;
    await h.view.deleteBudget('b', () => { closedEditor++; });
    const confirmation = shownModals.at(-1);
    await press(confirmation, 'Delete');
    const recovery = shownModals.at(-1);
    assert.ok(!confirmation.closed);
    assert.equal(closedEditor, 0);
    assert.ok(!notices.slice(before).some(text => text.includes('successfully')));
    await press(recovery, 'Retry');
    assert.equal(shownModals.at(-1), recovery, 'a failed retry updates the existing recovery dialog');
    h.storage.fail = false;
    await press(recovery, 'Retry');
    assert.equal(confirmation.closed, true);
    assert.equal(recovery.closed, true);
    assert.equal(closedEditor, 1);
    assert.equal(h.p.getAllBudgets().length, 0);
    assert.equal(notices.slice(before).filter(text => text === 'Budget deleted successfully').length, 1);
});

test('import recovery retains the source selection and imports once when Retry succeeds', async () => {
    const h = recoveryHarness();
    h.files.set('source.json', JSON.stringify([{ id: 'import', date: '2026-09-01', type: 'expense', amount: 10, description: 'Imported', category: 'food' }]));
    const editor = new ImportModal(h.p.app, h.p);
    editor.open();
    editor.selectSource('source.json');
    await press(editor, 'Import');
    const recovery = shownModals.at(-1);
    assert.match(modalText(recovery.contentEl), /Import could not be saved/);
    assert.equal(editor.source, 'source.json');
    assert.deepEqual(recovery.contentEl.querySelectorAll('button').map(button => button.textContent), ['Retry', 'Close']);
    assert.match(modalText(recovery.contentEl), /transactions\.json/);
    assert.doesNotMatch(modalText(recovery.contentEl), /expensica-data|Operation:|previously completed|unsaved input/);
    h.storage.fail = false;
    const retry = recoveryButton(recovery, 'Retry').listeners.click[0];
    await Promise.all([retry(), retry()]);
    assert.equal(editor.closed, true);
    assert.equal(h.p.getAllTransactions().filter(row => row.description === 'IMPORTED').length, 1);
});

test('Retry respects native validation and keeps the unresolved warning', async () => {
    const h = recoveryHarness();
    const editor = new BudgetModal(h.p.app, h.p, h.view);
    editor.open();
    editor.categorySelect.value = 'food';
    editor.amountInput.value = '125';
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {} });
    const recovery = shownModals.at(-1);
    form.reportValidity = () => false;
    const writes = h.storage.writes;
    h.storage.fail = false;
    await press(recovery, 'Retry');
    assert.equal(h.storage.writes, writes);
    assert.equal(h.p.hasSaveFailure(editor), true);
    assert.ok(!recovery.closed);
});

test('account editor recovery retries edited input and closes only after saving', async () => {
    const h = recoveryHarness();
    const editor = new AccountEditorModal(h.p.app, h.p, h.view);
    editor.open();
    const form = editor.contentEl.querySelector('form');
    const name = editor.contentEl.querySelector('#account-name');
    name.value = 'Draft account';
    await form.listeners.submit[0]({ preventDefault() {} });
    const recovery = shownModals.at(-1);
    assert.match(modalText(recovery.contentEl), /Add account.*accounts\.json.*permissions/s);
    await press(recovery, 'Back to Editor');
    name.value = 'Corrected account';
    h.storage.fail = false;
    await form.listeners.submit[0]({ preventDefault() {} });
    assert.equal(editor.closed, true);
    assert.equal(h.p.getAccounts().filter(account => account.name === 'Corrected account').length, 1);
    assert.equal(h.p.hasSaveFailure(editor), false);
});

test('independent failed editors share one recovery dialog and retain separate warnings', async () => {
    const h = recoveryHarness();
    const transactionOwner = {};
    const budgetOwner = {};
    const row = { id: 't', date: '2026-09-01', type: 'expense', amount: 10, description: 'A', category: 'food' };
    await h.p.runSaveOperation(transactionOwner, 'Add transaction', () => h.p.addTransaction(row));
    const firstDialog = shownModals.at(-1);
    const count = shownModals.length;
    await h.p.runSaveOperation(budgetOwner, 'Add budget', () => h.p.addBudget({ id: 'b', categoryId: 'food', amount: 100, period: 'monthly' }));
    assert.equal(shownModals.length, count);
    const warning = h.container.querySelector('.expensica-data-recovery-warning');
    assert.equal(warning.querySelectorAll('.expensica-recovery-card').length, 2);
    await press(firstDialog, 'Back to Editor');
    h.p.releaseSaveOperation(transactionOwner);
    assert.equal(warning.hidden, false);
    assert.equal(warning.querySelectorAll('.expensica-recovery-card').length, 2);
    h.storage.fail = false;
    await warning.querySelectorAll('.expensica-recovery-card').find(card => /Add budget/.test(modalText(card))).querySelector('button').listeners.click[0]();
    assert.equal(warning.hidden, false, 'the cancelled transaction still has an unverified write error');
    assert.equal(h.p.getAllBudgets().length, 1);
    assert.equal(h.p.getAllTransactions().length, 0);
    await warning.querySelector('button').listeners.click[0]();
    assert.equal(warning.hidden, true);
    assert.equal(h.p.getAllTransactions().length, 0);
});

test('save recovery preserves load protection and restores failed account rollback before retrying the edit', async () => {
    const h = recoveryHarness();
    const cash = { id: 'cash', name: 'Cash', type: 'saving', createdAt: '2026-01-01' };
    h.p.transactionsData.accounts.push(cash);
    h.p.transactionsData.transactions.push({ id: 't', date: '2026-09-01', type: 'expense', amount: 10, description: 'A', category: 'food', account: 'saving-cash' });
    const accountFile = JSON.stringify({ accounts: h.p.getAccounts(), lastUpdated: 'initial' });
    h.files.set(h.p.accountsFilePath, accountFile);
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
    let fail = true;
    let accountWrites = 0;
    h.p.app.vault.adapter.write = async (file, text) => {
        if (fail && (file === h.p.transactionsFilePath || (file === h.p.accountsFilePath && ++accountWrites > 1))) throw Error('Disk unavailable');
        h.files.set(file, text);
    };
    const owner = {};
    const action = () => h.p.updateAccount('saving-cash', { ...cash, name: 'Wallet' });
    await h.p.runSaveOperation(owner, 'Edit account', action);
    const loadRecovery = shownModals.at(-1);
    assert.match(modalText(loadRecovery.contentEl), /data could not be loaded/);
    assert.equal(h.p.hasSaveFailure(owner), true);
    await assert.rejects(h.p.saveAccountsData(), /protected/);
    assert.equal(shownModals.at(-1), loadRecovery, 'load protection takes precedence without another dialog');
    await press(loadRecovery, 'Close');
    const saveCard = h.container.querySelector('[data-recovery-kind="save"]');
    assert.match(modalText(saveCard), /Edit account/);
    fail = false;
    await saveCard.querySelector('button').listeners.click[0]();
    assert.equal(h.p.pendingAccountRollback, null);
    assert.equal(h.p.protectedDatasets.size, 0);
    assert.equal(h.p.hasSaveFailure(owner), false);
    assert.equal(h.p.getAccounts().find(account => account.id === 'cash').name, 'Wallet');
    assert.equal(h.p.getAllTransactions()[0].account, 'saving-wallet');
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
});

test('repeated native form submissions are prevented while the save is pending', async () => {
    const h = recoveryHarness();
    let complete;
    h.p.app.vault.adapter.write = (file, text) => new Promise(resolve => {
        complete = () => { h.files.set(file, text); resolve(); };
    });
    const editor = new TransactionModal(h.p.app, h.p, h.view);
    editor.open();
    editor.contentEl.querySelector('#description').value = 'Pending';
    editor.contentEl.querySelector('#amount').value = '25';
    const form = editor.contentEl.querySelector('form');
    let prevented = 0;
    const submit = () => form.listeners.submit[0]({ preventDefault() { prevented++; }, target: form });
    const first = submit();
    await submit();
    assert.equal(prevented, 2);
    await new Promise(setImmediate);
    complete();
    await first;
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.effects.renders, 1);
});

test('error cards persist across dialogs and rerenders, order load protection before save failures, and recover independently', async () => {
    const h = recoveryHarness();
    h.files.set(h.p.budgetFilePath, '{broken');
    await h.p.loadBudgetData();
    const loadDialog = shownModals.at(-1);
    const owner = {};
    const row = { id: 'retry', date: '2026-09-01', type: 'expense', amount: 5, description: 'Kept', category: 'food' };
    const save = () => h.p.runSaveOperation(owner, 'Add transaction', () => h.p.addTransaction(row));
    await save();
    await save();
    loadDialog.close();
    h.container.empty();
    h.p.renderDataRecoveryWarning(h.container);
    const cards = h.container.querySelectorAll('.expensica-recovery-card');
    assert.deepEqual(cards.map(card => card.getAttribute('data-recovery-kind')), ['load', 'save']);
    assert.equal(cards[0].querySelector('.expensica-recovery-card-icon').querySelector('svg')?.tag, 'svg');
    assert.doesNotMatch(modalText(h.container), /Unexpected token|Permission denied|SyntaxError/);
    assert.ok(!cards.flatMap(card => card.querySelectorAll('button')).some(button => /dismiss|close|hide/i.test(button.textContent)));
    h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [], lastUpdated: 'initial' }));
    await cards[0].querySelector('button').listeners.click[0]();
    assert.equal(h.p.protectedDatasets.size, 0);
    assert.equal(h.p.hasSaveFailure(owner), true);
    assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1);
    h.storage.fail = false;
    await h.container.querySelector('button').listeners.click[0]();
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
});

test('error card Retry rechecks all datasets and detects newly corrupted files', async () => {
    const h = recoveryHarness();
    h.files.set(h.p.budgetFilePath, '{broken');
    h.files.set(h.p.accountsFilePath, '{also broken');
    await h.p.loadBudgetData();
    await h.p.loadAccountsData();
    const cards = h.container.querySelectorAll('.expensica-recovery-card');
    assert.equal(cards.length, 2);
    h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [], lastUpdated: 'initial' }));
    h.files.set(h.p.transactionsFilePath, '{newly broken');
    await cards[0].querySelector('button').listeners.click[0]();
    assert.equal(h.p.protectedDatasets.has('budgets'), false);
    assert.equal(h.p.protectedDatasets.has('accounts'), true);
    assert.equal(h.p.protectedDatasets.has('transactions'), true);
    assert.equal(h.files.get(h.p.accountsFilePath), '{also broken');
    assert.equal(h.storage.writes, 0);
});

test('Retry preserves the actual dashboard header and content nodes when recovery data is unchanged', async () => {
    const h = recoveryHarness();
    let headerRenders = 0, loads = 0;
    const dashboard = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: h.p, app: h.p.app, containerEl: { children: [null, h.container] }, currentTab: 'overview',
        isDashboardVisible: () => true,
        consumeChartAnimationRequest() {}, rememberScrollPosition() {}, restoreScrollPosition() {},
        renderDateRangeSelector(container) { container.createEl('button', { text: 'Stored date range' }); },
        renderHeader(container) { headerRenders++; ExpensicaDashboardView.prototype.renderHeader.call(this, container); },
        renderTabNavigation() {}, renderCurrentTabContent(container) { container.createDiv({ cls: 'test-body', text: 'Unchanged content' }); },
        loadTransactionsData: async () => { loads++; }
    });
    h.p.app.workspace.getLeavesOfType = () => [{ view: dashboard }];
    h.p.refreshExpensicaViews = PersistencePlugin.prototype.refreshExpensicaViews.bind(h.p);
    dashboard.renderDashboard();
    const header = h.container.querySelector('.shadcn-header');
    const body = h.container.querySelector('.test-body');
    const original = h.files.get(h.p.budgetFilePath);
    h.files.set(h.p.budgetFilePath, '{broken budget');
    await h.p.loadBudgetData();
    shownModals.at(-1).close();
    await h.container.querySelector('[data-recovery-kind="load"]').querySelector('button').listeners.click[0]();
    assert.equal(headerRenders, 1);
    assert.equal(loads, 0);
    assert.equal(h.container.querySelector('.shadcn-header'), header);
    assert.equal(h.container.querySelector('.test-body'), body);
    shownModals.at(-1).close();
    const modalCount = shownModals.length;
    h.files.set(h.p.budgetFilePath, original);
    await h.container.querySelector('[data-recovery-kind="load"]').querySelector('button').listeners.click[0]();
    assert.equal(shownModals.length, modalCount);
    assert.equal(headerRenders, 1);
    assert.equal(h.container.querySelector('.shadcn-header'), header);
    assert.equal(h.container.querySelector('.test-body'), body);
    h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [{ id: 'b', categoryId: 'food', period: 'monthly', amount: 100 }] }));
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(headerRenders, 2, 'changed recovered data still refreshes the dashboard');
    assert.equal(loads, 1);
    assert.notEqual(h.container.querySelector('.shadcn-header'), header);
    assert.equal(h.p.getAllBudgets()[0].amount, 100);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(headerRenders, 2);
});

test('All Time cumulative charts include migrated historical expenses after recovery and subsequent imports', async () => {
    const h = recoveryHarness();
    const today = new Date();
    const historicalDate = models.formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 15));
    const earlierDate = models.formatDate(new Date(today.getFullYear(), today.getMonth() - 2, 15));
    const roots = [h.container, new Element()];
    const views = roots.map(root => {
        const view = chartView(h.p);
        Object.assign(view, {
            currentDate: today, selectedCalendarDate: today, containerEl: { children: [null, root] },
            isDashboardVisible: () => true,
            renderChartDateRangeButtons() {},
            renderDashboard() {
                root.empty();
                this.plugin.renderDataRecoveryWarning(root);
                this.renderCumulativeExpensesChart(root);
            }
        });
        view.dateRange = view.getDateRange(DateRangeType.ALL_TIME);
        return view;
    });
    h.p.app.workspace.getLeavesOfType = () => views.map(view => ({ view }));
    h.p.refreshExpensicaViews = PersistencePlugin.prototype.refreshExpensicaViews.bind(h.p);
    for (const view of views) {
        await view.loadTransactionsData();
        view.renderDashboard();
        assert.match(modalText(view.containerEl.children[1]), /No expenses found for this period/);
    }
    h.files.set(h.p.transactionsFilePath, '{broken');
    await h.p.loadTransactionsData();
    shownModals.at(-1).close();
    const input = { id: 'historical-no-time', date: historicalDate, amount: '10.50', type: 'expense',
        description: 'Recovered historical expense', category: 'food', account: 'other-default' };
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: [input] }));
    assert.equal(await h.p.retryDataRecovery(), false, 'failed migration writes must not publish expenses');
    for (const root of roots) assert.match(modalText(root), /No expenses found for this period/);
    assert.equal(h.p.getAllTransactions().length, 0);
    h.storage.fail = false;
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.p.getAllTransactions()[0].date, historicalDate);
    assert.equal(h.p.getAllTransactions()[0].amount, 10.5);
    for (const view of views) {
        assert.doesNotMatch(modalText(view.containerEl.children[1]), /No expenses found for this period/);
        assert.ok(view.containerEl.children[1].querySelector('#cumulative-expenses-chart'));
        assert.equal(view.transactions.length, 1);
        assert.equal(models.formatDate(view.dateRange.startDate), historicalDate);
        assert.equal(view.selectedCalendarDate, today, 'chart refresh must preserve calendar selection');
    }
    while (chartTimers.length) chartTimers.shift()();
    for (const view of views) assert.equal(view.cumulativeExpensesChart.data.datasets[1].data.at(-1), 10.5);
    await h.p.importTransactionsFromJSON({ name: 'earlier.json', text: async () => JSON.stringify([
        { ...input, id: 'earlier-no-time', date: earlierDate, amount: '2.25' }
    ]) });
    while (chartTimers.length) chartTimers.shift()();
    for (const view of views) {
        assert.equal(models.formatDate(view.dateRange.startDate), earlierDate);
        assert.equal(view.cumulativeExpensesChart.data.datasets[1].data.at(-1), 12.75);
        assert.equal(view.dateRange.type, DateRangeType.ALL_TIME);
    }
    const charts = views.map(view => view.cumulativeExpensesChart);
    const saved = h.files.get(h.p.transactionsFilePath);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(h.files.get(h.p.transactionsFilePath), saved);
    views.forEach((view, index) => assert.equal(view.cumulativeExpensesChart, charts[index], 'unchanged retry must preserve chart instances'));
});

test('All Time reloads recalculate both date boundaries without widening custom or monthly ranges', async () => {
    const p = plugin();
    p.getTransactionsForMonth = () => [];
    const today = new Date();
    const past = new Date(today.getFullYear(), today.getMonth() - 2, 15);
    const future = new Date(today.getFullYear(), today.getMonth() + 2, 15);
    const view = chartView(p);
    view.currentDate = today;
    view.dateRange = view.getDateRange(DateRangeType.ALL_TIME);
    p.transactions = [
        { id: 'past', date: models.formatDate(past), amount: 10, type: 'expense' },
        { id: 'future', date: models.formatDate(future), amount: 20, type: 'expense' }
    ];
    const source = JSON.stringify(p.transactions);
    await view.loadTransactionsData();
    assert.equal(models.formatDate(view.dateRange.startDate), models.formatDate(past));
    assert.equal(models.formatDate(view.dateRange.endDate), models.formatDate(future));
    assert.equal(view.dateRange.startDate.getHours(), 0);
    assert.equal(view.dateRange.endDate.getHours(), 23);
    assert.deepEqual(Array.from(view.transactions, transaction => transaction.id), ['past', 'future']);
    for (const range of [view.getDateRange(DateRangeType.THIS_MONTH), view.getDateRange(DateRangeType.CUSTOM,
        new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0))]) {
        view.dateRange = range;
        const bounds = JSON.stringify(range);
        await view.loadTransactionsData();
        assert.equal(JSON.stringify(view.dateRange), bounds);
        assert.equal(view.transactions.length, 0);
    }
    assert.equal(JSON.stringify(p.transactions), source);
});

test('known load errors appear before editing and recovery keeps existing unsaved inputs', async () => {
    const h = recoveryHarness();
    const existing = new TransactionModal(h.p.app, h.p, h.view);
    existing.open();
    existing.contentEl.querySelector('#description').value = 'Keep this draft';
    h.files.set(h.p.transactionsFilePath, '{broken');
    await h.p.loadTransactionsData();
    assert.equal(existing.contentEl.querySelector('#description').value, 'Keep this draft');
    assert.equal(existing.contentEl.querySelectorAll('.expensica-recovery-card').length, 0);
    const before = shownModals.length;
    const blocked = new TransactionModal(h.p.app, h.p, h.view);
    blocked.open();
    assert.equal(shownModals.length, before, 'reuses recovery instead of opening another editor');
    assert.equal(blocked.contentEl.querySelector('form'), null);
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: [], lastUpdated: 'initial' }));
    await h.p.retryDataRecovery();
    assert.equal(existing.contentEl.querySelector('#description').value, 'Keep this draft');
    assert.equal(existing.contentEl.querySelector('.expensica-data-recovery-warning'), null);
    blocked.open();
    assert.ok(blocked.contentEl.querySelector('form'));
});

test('known save errors stay only in the dashboard while another editor opens and closes', async () => {
    const h = recoveryHarness();
    const owner = {};
    await h.p.runSaveOperation(owner, 'Add transaction', () => h.p.addTransaction({ id: 't', date: '2026-09-01', type: 'expense', amount: 5, description: 'Kept', category: 'food' }));
    shownModals.at(-1).close();
    const editor = new BudgetModal(h.p.app, h.p, h.view);
    editor.open();
    assert.equal(editor.contentEl.querySelector('.expensica-data-recovery-warning'), null);
    assert.match(modalText(h.container), /Add transaction is unsaved/);
    editor.close();
    assert.equal(h.p.hasSaveFailure(owner), true);
    assert.equal(editor.contentEl.querySelector('.expensica-data-recovery-warning'), null);
    h.p.releaseSaveOperation(owner);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, false);
});

test('a dismissed recovery and a later unexpected error do not erase an unresolved save card', async () => {
    const h = recoveryHarness();
    const owner = {};
    await h.p.runSaveOperation(owner, 'Add budget', () => h.p.addBudget({ id: 'b', categoryId: 'food', amount: 50 }));
    shownModals.at(-1).close();
    const before = notices.length;
    await h.p.runSaveOperation(owner, 'Add budget', async () => { throw Error('View update failed'); });
    assert.equal(h.p.hasSaveFailure(owner), true);
    assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1);
    assert.doesNotMatch(notices.slice(before).join(' '), /View update failed|Error:/);
});

test('card and dialog recovery share one retry while a save is pending', async () => {
    const h = recoveryHarness();
    const editor = new BudgetModal(h.p.app, h.p, h.view);
    editor.open();
    editor.categorySelect.value = 'food';
    editor.amountInput.value = '50';
    await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
    const dialog = shownModals.at(-1);
    const inlineRetry = h.container.querySelector('button').listeners.click[0];
    let complete;
    let writes = 0;
    h.p.app.vault.adapter.write = (file, text) => new Promise(resolve => {
        writes++;
        complete = () => { h.files.set(file, text); resolve(); };
    });
    const pending = press(dialog, 'Retry');
    await inlineRetry();
    await new Promise(setImmediate);
    assert.equal(writes, 1);
    complete();
    await pending;
    assert.equal(h.p.getAllBudgets().length, 1);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
});

test('recovery cards use concise text, highlighted filenames and a single Retry action', async () => {
    const h = recoveryHarness();
    h.files.set(h.p.transactionsFilePath, '{broken');
    await h.p.loadTransactionsData();
    await h.p.runSaveOperation({}, 'Add budget', () => h.p.addBudget({ id: 'b', categoryId: 'food', amount: 50 }));
    const cards = h.container.querySelectorAll('.expensica-recovery-card');
    assert.deepEqual(cards.map(card => card.querySelector('h3').textContent), [
        'Saving transactions is blocked', 'Add budget is unsaved'
    ]);
    assert.deepEqual(cards.map(card => card.querySelector('p').children.map(span => span.textContent).join('')), [
        'The transactions.json contents are not valid. Restore a valid copy, then retry.',
        'The budgets.json could not be accessed. Check file permissions and if the vault has free space.'
    ]);
    for (const [index, card] of cards.entries()) {
        const file = card.querySelector('.expensica-recovery-card-file');
        assert.equal(file.textContent, index === 0 ? 'transactions.json' : 'budgets.json');
        assert.equal(file.getAttribute('title'), index === 0 ? h.p.transactionsFilePath : h.p.budgetFilePath);
        assert.deepEqual(card.querySelectorAll('button').map(button => button.textContent), ['Retry']);
        assert.equal(card.querySelectorAll('p').length, 1, 'no separate path or extra explanatory copy');
    }
});

test('unavailable accounts allow safe transaction editing while preserving account associations', async () => {
    const h = recoveryHarness();
    const row = { id: 'existing', date: '2026-09-01', type: 'expense', amount: 10, description: 'Original', category: 'other_expense' };
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: [row], lastUpdated: 'initial' }));
    h.files.set(h.p.accountsFilePath, '{invalid accounts');
    await h.p.loadAccountsData();
    await h.p.loadTransactionsData();
    const loadDialog = shownModals.at(-1);
    const editor = new TransactionModal(h.p.app, h.p, h.view, h.p.getAllTransactions()[0]);
    editor.open();
    assert.equal(loadDialog.closed, true, 'an unrelated protection dialog does not obstruct the safe editor');
    assert.ok(editor.contentEl.querySelector('form'));
    assert.equal(editor.contentEl.querySelector('.expensica-data-recovery-warning'), null);
    editor.contentEl.querySelector('#description').value = 'Kept edit';
    const form = editor.contentEl.querySelector('form');
    h.storage.fail = false;
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.equal(editor.closed, true);
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
    assert.equal(saved.description, 'KEPT EDIT');
    assert.equal(Object.hasOwn(saved, 'account'), false, 'an unknown default account is not invented');
    assert.equal(h.files.get(h.p.accountsFilePath), '{invalid accounts');
    assert.equal(h.p.protectedDatasets.has('accounts'), true);
});

test('account-dependent mutations remain blocked while safe non-credit edits and deletion stay independent', async () => {
    const h = recoveryHarness();
    const credit = { id: 'credit', date: '2026-09-01', type: 'expense', amount: 10, description: 'CARD', category: 'other_expense', account: 'credit-card' };
    const cash = { ...credit, id: 'cash', account: 'saving-cash', description: 'CASH' };
    h.p.transactionsData.transactions = [credit, cash];
    h.files.set(h.p.accountsFilePath, '{invalid accounts');
    await h.p.loadAccountsData();
    h.storage.fail = false;
    await h.p.updateTransaction({ ...credit, description: 'Metadata edit' });
    assert.equal(h.p.getAllTransactions()[0].description, 'METADATA EDIT');
    const before = h.files.get(h.p.transactionsFilePath);
    await assert.rejects(h.p.updateTransaction({ ...credit, amount: 20 }), /protected/);
    await assert.rejects(h.p.updateTransaction({ ...cash, account: 'saving-another' }), /protected/);
    await assert.rejects(h.p.addTransaction({ ...cash, id: 'new' }), /protected/);
    assert.equal(h.files.get(h.p.transactionsFilePath), before);
    await h.p.updateTransaction({ ...cash, amount: 25 });
    assert.equal(h.p.getAllTransactions().find(row => row.id === 'cash').amount, 25);
    await h.p.deleteTransaction('cash');
    assert.equal(h.p.getAllTransactions().length, 1);
});

test('warnings remain exclusively in the dashboard across transaction, account, budget and import windows', async () => {
    for (const kind of ['transaction', 'account', 'legacy account', 'budget', 'import']) {
        const h = recoveryHarness();
        const dataset = kind === 'budget' ? 'accounts' : 'budgets';
        h.p.protectDataset(dataset);
        const editor = kind === 'transaction' ? new TransactionModal(h.p.app, h.p, h.view)
            : kind === 'account' ? new AccountEditorModal(h.p.app, h.p, h.view)
            : kind === 'legacy account' ? new AccountModal(h.p.app, h.p, h.view)
            : kind === 'budget' ? new BudgetModal(h.p.app, h.p, h.view)
            : new ImportModal(h.p.app, h.p);
        editor.open();
        assert.equal(editor.contentEl.querySelectorAll('.expensica-recovery-card').length, 0, kind);
        assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1, kind);
        assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, false, kind);
        editor.close();
        assert.equal(h.p.protectedDatasets.has(dataset), true, kind);
        assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1, kind);
    }
});

test('save Retry revalidates previously healthy files but does not block a save on unrelated corruption', async () => {
    const h = recoveryHarness();
    const editor = new TransactionModal(h.p.app, h.p, h.view);
    editor.open();
    editor.contentEl.querySelector('#description').value = 'Unsaved draft';
    editor.contentEl.querySelector('#amount').value = '10';
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    const recovery = shownModals.at(-1);
    h.files.set(h.p.budgetFilePath, '{newly invalid budget');
    const reads = [];
    const read = h.p.app.vault.adapter.read;
    h.p.app.vault.adapter.read = async file => { reads.push(file); return read(file); };
    h.storage.fail = false;
    await press(recovery, 'Retry');
    assert.deepEqual(reads, [h.p.accountsFilePath, h.p.transactionsFilePath, h.p.budgetFilePath]);
    assert.equal(editor.closed, true);
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.p.protectedDatasets.has('budgets'), true);
    assert.equal(h.files.get(h.p.budgetFilePath), '{newly invalid budget');
    assert.match(modalText(h.container), /Saving budgets is blocked/);
});

test('Discard and dashboard rerenders keep the error without replaying the discarded transaction', async () => {
    const h = recoveryHarness();
    const editor = new TransactionModal(h.p.app, h.p, h.view);
    editor.open();
    editor.contentEl.querySelector('#description').value = 'Discard this draft';
    editor.contentEl.querySelector('#amount').value = '10';
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    await press(shownModals.at(-1), 'Back to Editor');
    await press(editor, 'Cancel');
    await press(shownModals.at(-1), 'Discard');
    assert.equal(editor.closed, true);
    assert.equal(h.p.hasSaveFailure(editor), true);
    h.container.empty();
    h.p.renderDataRecoveryWarning(h.container);
    assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1);
    const original = h.files.get(h.p.transactionsFilePath);
    await h.container.querySelector('button').listeners.click[0]();
    assert.equal(h.p.hasSaveFailure(editor), true, 'failed storage verification keeps the error');
    h.storage.fail = false;
    await h.container.querySelector('button').listeners.click[0]();
    assert.equal(h.files.get(h.p.transactionsFilePath), original);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
});

test('cancelled deletion keeps the storage error and Retry never deletes the retained record', async () => {
    const h = recoveryHarness();
    const budget = { id: 'b', categoryId: 'food', amount: 100, period: 'monthly' };
    h.p.budgetData.budgets = [budget];
    h.files.set(h.p.budgetFilePath, JSON.stringify(h.p.budgetData));
    await h.view.deleteBudget('b');
    const confirmation = shownModals.at(-1);
    await press(confirmation, 'Delete');
    await press(shownModals.at(-1), 'Back to Editor');
    await press(confirmation, 'Cancel');
    assert.equal(h.p.hasSaveFailure(confirmation), true);
    const original = h.files.get(h.p.budgetFilePath);
    h.storage.fail = false;
    await h.container.querySelector('button').listeners.click[0]();
    assert.equal(h.p.getAllBudgets().length, 1);
    assert.equal(h.files.get(h.p.budgetFilePath), original);
    assert.equal(h.p.hasSaveFailure(confirmation), false);
});

test('a write failure arriving after its editor closes still creates a persistent error', async () => {
    const h = recoveryHarness();
    const editor = new BudgetModal(h.p.app, h.p, h.view);
    editor.open();
    editor.categorySelect.value = 'food';
    editor.amountInput.value = '100';
    let rejectWrite;
    h.p.app.vault.adapter.write = () => new Promise((resolve, reject) => { rejectWrite = reject; });
    const pending = editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
    await new Promise(setImmediate);
    editor.close();
    const modals = shownModals.length;
    rejectWrite(Error('Disk full'));
    await pending;
    assert.equal(h.p.hasSaveFailure(editor), true);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, false);
    assert.equal(shownModals.length, modals, 'no recovery dialog tries to return to a closed editor');
    assert.equal(h.p.getAllBudgets().length, 0);
});

test('repeated editor cancellations show one file error and a later verified save resolves it', async () => {
    const h = recoveryHarness();
    for (let index = 0; index < 3; index++) {
        const editor = new BudgetModal(h.p.app, h.p, h.view);
        editor.open();
        editor.categorySelect.value = 'food';
        editor.amountInput.value = String(100 + index);
        await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
        await press(shownModals.at(-1), 'Back to Editor');
        await press(editor, 'Cancel');
        assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1);
    }
    await h.p.retryDataRecovery();
    assert.equal(h.container.querySelectorAll('.expensica-recovery-card').length, 1);
    h.storage.fail = false;
    await h.p.addBudget({ id: 'later', categoryId: 'food', amount: 20, period: 'monthly' });
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
    assert.deepEqual(Array.from(h.p.getAllBudgets(), budget => budget.id), ['later']);
});

test('closing a failed import preserves its read error until source validation succeeds, without importing', async () => {
    const h = recoveryHarness();
    const source = JSON.stringify({ transactions: [{ id: 'not-imported', date: '2026-09-01', type: 'expense', amount: 10, category: 'food', description: 'Discarded import' }] });
    h.files.set('source.json', source);
    const read = h.p.app.vault.adapter.read;
    let unavailable = true;
    h.p.app.vault.adapter.read = file => {
        if (file === 'source.json' && unavailable) throw Error('Permission denied');
        return read(file);
    };
    const editor = new ImportModal(h.p.app, h.p);
    editor.open();
    editor.selectSource('source.json');
    await press(editor, 'Import');
    await press(shownModals.at(-1), 'Close');
    await press(editor, 'Close');
    await h.container.querySelector('button').listeners.click[0]();
    assert.equal(h.p.hasSaveFailure(editor), true);
    unavailable = false;
    await h.container.querySelector('button').listeners.click[0]();
    assert.equal(h.p.hasSaveFailure(editor), false);
    assert.equal(h.p.getAllTransactions().length, 0);
    assert.equal(h.files.get('source.json'), source);
});

function pickerHarness({ desktop = true, bridge = 'remote', canceled = false, selection } = {}) {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/import-qa-envelope.json'), 'utf8');
    const storage = { content: fixture, fail: false, fileReads: 0, writes: 0 };
    const options = [];
    class Adapter { getBasePath() { return path.resolve('test-vault'); } }
    const dialog = { async showOpenDialog(option) {
        options.push(option);
        if (selection) return selection();
        return { canceled, filePaths: canceled ? [] : [path.resolve('external', 'example.json')] };
    } };
    const dependencies = {
        obsidian: { Plugin: class {}, PluginSettingTab: class {}, Modal,
            FileSystemAdapter: Adapter, Platform: { isDesktopApp: desktop } },
        './src/models': models, './src/transaction-import': transactionPreparation,
        './src/dashboard-view': { EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
        './src/data-recovery-modal': recoveryUI,
        './src/notice': { showExpensicaNotice: message => notices.push(message) },
        path,
        fs: { promises: { readFile: async () => { storage.fileReads++; return storage.content; } } }
    };
    Object.defineProperty(dependencies, '@electron/remote', { get() {
        if (bridge !== 'remote') throw Error('No remote bridge');
        return { dialog };
    } });
    Object.defineProperty(dependencies, 'electron', { get() {
        if (bridge !== 'legacy') throw Error('No electron bridge');
        return { remote: { dialog } };
    } });
    const { default: Plugin } = load('main.ts', dependencies);
    const p = new Plugin();
    p.settings = { categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    p.transactionsData = p.normalizeTransactionsSnapshot({ transactions: [], accounts: [{ ...models.DEFAULT_ACCOUNT }], lastUpdated: 'initial' });
    p.budgetData = { budgets: [], lastUpdated: 'initial' };
    const files = new Map([
        [p.transactionsFilePath, JSON.stringify({ transactions: [], lastUpdated: 'initial' })],
        [p.accountsFilePath, JSON.stringify({ accounts: p.getAccounts() })],
        [p.budgetFilePath, JSON.stringify(p.budgetData)]
    ]);
    p.app = { vault: { adapter: Object.assign(new Adapter(), {
        exists: async file => files.has(file), read: async file => files.get(file),
        write: async (file, content) => { storage.writes++; if (storage.fail) throw Error('Permission denied'); files.set(file, content); }
    }) }, workspace: { getLeavesOfType: () => [], layoutReady: true,
        getActiveViewOfType() { return this.activeLeaf?.view; },
        activeLeaf: { view: { getViewType: () => 'expensica-dashboard-view', containerEl: {} } } } };
    p.refreshExpensicaViews = async () => {};
    const start = shownModals.length;
    return { p, storage, files, fixture, options,
        async open() { p.openImportModal(); await new Promise(setImmediate); return shownModals[start]; } };
}

test('desktop import opens JSON explorer in expensica-data and imports the supplied envelope from outside the vault', async () => {
    const h = pickerHarness();
    const editor = await h.open();
    assert.equal(h.options.length, 1);
    assert.equal(h.options[0].defaultPath, path.join(h.p.app.vault.adapter.getBasePath(), 'expensica-data'));
    assert.deepEqual(Array.from(h.options[0].filters[0].extensions), ['json']);
    assert.deepEqual(Array.from(h.options[0].properties), ['openFile']);
    assert.equal(h.storage.fileReads + h.storage.writes, 0, 'selection does not mutate or read the file before Import');
    assert.match(modalText(editor.contentEl), /example.json/);
    assert.doesNotMatch(modalText(editor.contentEl), /external[\\/]|Enter the path/);
    assert.equal(editor.contentEl.querySelector('input').attrs.type, 'file');
    assert.equal(editor.contentEl.querySelector('input').attrs.accept, '.json,application/json');
    await press(editor, 'Import');
    assert.equal(editor.closed, true);
    assert.equal(h.storage.fileReads, 1);
    assert.equal(h.storage.writes, 1);
    assert.equal(h.p.getAllTransactions()[1].time, '21:00:22');
    assert.equal(h.p.getAllTransactions()[1].category, 'other_expense');
});

test('desktop legacy bridge and unsupported-native fallback remain usable without dependencies', async () => {
    const legacy = pickerHarness({ bridge: 'legacy' });
    const editor = await legacy.open();
    assert.equal(legacy.options.length, 1);
    assert.equal(editor.importButton.disabled, false);
    const fallback = pickerHarness({ bridge: 'unavailable' });
    const browser = await fallback.open();
    assert.equal(fallback.options.length, 0);
    browser.fileInput.files = [{ name: 'fallback.json', text: async () => fallback.fixture }];
    browser.fileInput.listeners.change[0]();
    await press(browser, 'Import');
    assert.equal(browser.closed, true);
    assert.equal(fallback.storage.writes, 1);
});

test('mobile input selects JSON without requiring Electron or manual paths', async () => {
    const h = pickerHarness({ desktop: false, bridge: 'unavailable' });
    const editor = await h.open();
    assert.equal(h.options.length, 0);
    assert.equal(editor.importButton.disabled, true);
    editor.fileInput.files = [{ name: 'mobile.json', text: async () => h.fixture }];
    editor.fileInput.listeners.change[0]();
    await press(editor, 'Import');
    assert.equal(editor.closed, true);
    assert.equal(h.p.getAllTransactions().length, 2);
    assert.equal(h.storage.writes, 1);
});

test('picker cancellation and closure while native selection is pending never import', async () => {
    const h = pickerHarness({ canceled: true });
    const editor = await h.open();
    assert.equal(editor.importButton.disabled, true);
    await press(editor, 'Close');
    assert.equal(h.storage.writes + h.storage.fileReads, 0);
    let finish;
    const pending = pickerHarness({ selection: () => new Promise(resolve => { finish = resolve; }) });
    const selected = await pending.open();
    await press(selected, 'Close');
    finish({ canceled: false, filePaths: [path.resolve('late.json')] });
    await new Promise(setImmediate);
    assert.equal(selected.source, null, 'late native selections cannot revive a closed import');
    assert.equal(pending.storage.writes + pending.storage.fileReads, 0);
});

test('validation stays in the import dialog with precise correction and Retry, without P0 recovery', async () => {
    const h = pickerHarness();
    const payload = JSON.parse(h.fixture);
    payload.transactions[1].amount = '124oops';
    h.storage.content = JSON.stringify(payload);
    const editor = await h.open();
    const count = shownModals.length;
    await press(editor, 'Import');
    assert.equal(editor.closed, undefined);
    assert.equal(shownModals.length, count);
    assert.match(modalText(editor.contentEl), /transactions\[1\]\.amount:.*nonnegative decimal string/);
    assert.match(modalText(editor.contentEl), /Correct the JSON file, then Retry/);
    assert.doesNotMatch(modalText(editor.contentEl), /Operation:|Unsaved|expensica-data|previously completed/);
    assert.equal(editor.messageEl.style.color, 'var(--text-error)');
    assert.deepEqual(editor.contentEl.querySelectorAll('button').filter(button => !button.hidden).map(button => button.textContent), ['Close', 'Retry']);
    assert.equal(h.p.hasSaveFailure(editor), false);
    assert.equal(h.p.protectedDatasets.size, 0);
    assert.equal(h.storage.writes, 0);
    assert.equal(h.p.getAllTransactions().length, 0);
    h.storage.content = h.fixture;
    await press(editor, 'Retry');
    assert.equal(editor.closed, true);
    assert.equal(h.storage.writes, 1);
});

test('import error lists show seven entries at most, with ellipsis and the exact remaining count', async () => {
    for (const count of [1, 7, 8, 142]) {
        const h = pickerHarness();
        const template = JSON.parse(h.fixture).transactions[0];
        const payload = { transactions: Array.from({ length: count }, (_, index) => ({ ...template, id: `bad-${index}`, amount: 'invalid' })) };
        h.storage.content = JSON.stringify(payload);
        const editor = await h.open();
        await press(editor, 'Import');
        const entries = editor.errorsEl.querySelectorAll('li');
        assert.equal(entries.length, Math.min(count, 7));
        entries.forEach((entry, index) => assert.ok(entry.textContent.startsWith(`transactions[${index}].amount:`)));
        assert.deepEqual(editor.errorsEl.querySelectorAll('p').map(paragraph => paragraph.textContent), count > 7
            ? ['...', `${count - 7} more ${count === 8 ? 'error' : 'errors'}.`] : []);
        assert.equal(h.storage.writes, 0);
        assert.equal(h.p.getAllTransactions().length, 0);
        assert.equal(h.p.hasSaveFailure(editor), false);
        if (count === 142) {
            assert.match(modalText(editor.errorsEl), /135 more errors\./);
            assert.doesNotMatch(modalText(editor.errorsEl), /transactions\[7\]/);
            payload.transactions.forEach(transaction => { transaction.amount = 1; });
            h.storage.content = JSON.stringify(payload);
            await press(editor, 'Retry');
            assert.equal(editor.closed, true);
            assert.equal(h.storage.writes, 1);
            assert.equal(h.p.getAllTransactions().length, 142);
        }
    }
});

test('mobile validation Retry selects a fresh file instead of replaying the rejected File snapshot', async () => {
    const h = pickerHarness({ desktop: false });
    const editor = await h.open();
    editor.fileInput.files = [{ name: 'bad.json', text: async () => '{bad' }];
    editor.fileInput.listeners.change[0]();
    await press(editor, 'Import');
    assert.equal(h.storage.writes, 0);
    let picks = 0;
    editor.fileInput.click = () => { picks++; };
    await press(editor, 'Retry');
    assert.equal(picks, 1);
    editor.fileInput.files = [{ name: 'fixed.json', text: async () => h.fixture }];
    editor.fileInput.listeners.change[0]();
    assert.equal(editor.errorsEl.hidden, true);
    assert.equal(editor.errorsEl.children.length, 0);
    await press(editor, 'Import');
    assert.equal(h.storage.writes, 1);
});

test('real persistence failures keep P0 recovery and retry the selected file exactly once', async () => {
    const h = pickerHarness();
    h.storage.fail = true;
    const editor = await h.open();
    await press(editor, 'Import');
    const recovery = shownModals.at(-1);
    assert.ok(h.p.hasSaveFailure(editor));
    assert.match(modalText(recovery.contentEl), /Import could not be saved.*permissions/);
    assert.doesNotMatch(modalText(recovery.contentEl), /expensica-data|Operation:|unsaved input|previously completed/);
    assert.deepEqual(recovery.contentEl.querySelectorAll('button').map(button => button.textContent), ['Retry', 'Close']);
    assert.equal(h.p.getAllTransactions().length, 0);
    h.storage.fail = false;
    const retry = recoveryButton(recovery, 'Retry').listeners.click[0];
    await Promise.all([retry(), retry()]);
    assert.equal(h.p.getAllTransactions().length, 2);
    assert.equal(h.storage.writes, 2, 'one failed and one successful write');
    assert.equal(editor.closed, true);
});

test('Range start and end fields open the existing custom calendar and retain confirmed dates', () => {
    const modal = new DateRangePickerModal({}, models.parseLocalDate('2026-03-07'), models.parseLocalDate('2026-03-09'), () => {});
    modal.open();
    assert.equal(modal.contentEl.querySelectorAll('input').some(input => input.attrs.type === 'date'), false);
    for (const [id, initial, selected] of [
        ['start-date', '2026-03-07', '2026-03-08'], ['end-date', '2026-03-09', '2026-11-01']
    ]) {
        const button = modal.contentEl.querySelector('#' + id);
        const input = modal.contentEl.querySelector(`input[name="${id}"]`);
        assert.equal(button.tag, 'button');
        assert.equal(button.attrs['aria-haspopup'], 'dialog');
        assert.equal(input.attrs.type, 'hidden');
        button.isConnected = true;
        button.click();
        const picker = shownModals.at(-1);
        assert.ok(picker instanceof DateSelectorModal);
        assert.equal(picker.initialDate, initial);
        assert.equal(button.attrs['aria-expanded'], 'true');
        const count = shownModals.length;
        button.click();
        assert.equal(shownModals.length, count);
        picker.confirm(selected);
        assert.equal(input.value, selected);
        assert.equal(button.querySelector('.expensica-date-field-label').textContent, selected);
        assert.equal(button.attrs['aria-expanded'], 'false');
        assert.equal(button.focused, true);
        button.click();
        assert.equal(shownModals.at(-1).initialDate, selected);
        shownModals.at(-1).close();
    }
    modal.close();
});

test('cancelling a Range calendar preserves dates and closing Range closes its child picker', () => {
    const selected = [];
    const modal = new DateRangePickerModal({}, models.parseLocalDate('2026-10-01'), models.parseLocalDate('2026-10-15'),
        (...dates) => selected.push(dates));
    modal.open();
    const button = modal.contentEl.querySelector('#start-date');
    const input = modal.contentEl.querySelector('input[name="start-date"]');
    button.click();
    shownModals.at(-1).close();
    assert.equal(input.value, '2026-10-01');
    assert.equal(button.attrs['aria-expanded'], 'false');
    button.click();
    const picker = shownModals.at(-1);
    modal.contentEl.querySelectorAll('button').find(button => button.textContent === 'Cancel').click();
    assert.equal(picker.closed, true);
    picker.onConfirm('2026-10-05');
    assert.equal(input.value, '2026-10-01', 'a stale child callback must not change a dismissed range');
    assert.deepEqual(selected, []);
});

test('Range retains date ordering validation and accepts a single local calendar day', () => {
    const selected = [];
    const modal = new DateRangePickerModal({}, models.parseLocalDate('2026-03-09'), models.parseLocalDate('2026-03-07'),
        (...dates) => selected.push(dates));
    modal.open();
    const apply = modal.contentEl.querySelectorAll('button').find(button => button.textContent === 'Apply');
    apply.click();
    assert.equal(selected.length, 0);
    assert.equal(notices.at(-1), 'Start date cannot be after end date');
    assert.ok(!modal.closed);
    modal.contentEl.querySelector('#start-date').click();
    shownModals.at(-1).confirm('2026-03-07');
    apply.click();
    assert.equal(selected.length, 1);
    assert.equal(modal.closed, true);
    for (const date of selected[0]) {
        assert.equal(models.formatDate(date), '2026-03-07');
        assert.equal(date.getHours(), 0);
    }
});

test('Range selections update the shared dashboard filter and preserve inclusive end-of-day bounds', async () => {
    const effects = [];
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        app: {}, customStartDate: models.parseLocalDate('2026-03-01'), customEndDate: models.parseLocalDate('2026-03-31'),
        updateSharedDateRange: async () => effects.push('share'), loadTransactionsData: async () => effects.push('load'),
        persistDashboardState: () => effects.push('persist'), requestAllChartAnimations: () => effects.push('animate'),
        renderDashboard: () => effects.push('render')
    });
    await view.applyDateRangeSelection(DateRangeType.CUSTOM);
    const modal = shownModals.at(-1);
    assert.ok(modal instanceof DateRangePickerModal);
    for (const [id, date] of [['start-date', '2026-03-07'], ['end-date', '2026-03-09']]) {
        modal.contentEl.querySelector('#' + id).click();
        shownModals.at(-1).confirm(date);
    }
    modal.contentEl.querySelectorAll('button').find(button => button.textContent === 'Apply').click();
    await new Promise(setImmediate);
    assert.deepEqual(effects, ['share', 'load', 'persist', 'animate', 'render']);
    assert.equal(view.dateRange.type, DateRangeType.CUSTOM);
    assert.equal(models.formatDate(view.dateRange.startDate), '2026-03-07');
    assert.equal(models.formatDate(view.dateRange.endDate), '2026-03-09');
    assert.equal(view.dateRange.endDate.getHours(), 23);
    assert.equal(view.dateRange.endDate.getMilliseconds(), 999);
});

test('dashboard Import follows Export and invokes the shared picker entry point', async () => {
    const h = pickerHarness();
    const container = new Element();
    const view = { app: h.p.app, plugin: h.p, renderDateRangeSelector() {} };
    ExpensicaDashboardView.prototype.renderHeader.call(view, container);
    const buttons = container.querySelectorAll('button');
    assert.deepEqual(buttons.map(button => modalText(button).trim().replace(/\s+/g, ' ')), ['Transaction', 'Export', 'Import']);
    assert.equal(buttons[2].attrs['aria-label'], 'Import transactions');
    const count = shownModals.length;
    buttons[2].click();
    await new Promise(setImmediate);
    assert.equal(shownModals.length, count + 1);
    assert.equal(h.options.length, 1);
});
