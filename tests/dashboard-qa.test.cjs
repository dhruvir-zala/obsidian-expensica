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
    cloneNode(deep = false) {
        const copy = new Element(this.tag, { cls: [...this.classes].join(' '), text: this.textContent, attr: { ...this.attrs } });
        if (deep) this.children.forEach(child => copy.appendChild(child.cloneNode(true)));
        return copy;
    }
    set className(value) { this.classes = new Set(value.split(' ')); }
    setCssProps(properties) { Object.assign(this.style, properties); }
    setCssStyles(properties) { Object.assign(this.style, properties); }
    empty() { this.children = []; }
    addClass(name) { this.classes.add(name); }
    removeClass(name) { this.classes.delete(name); }
    hasClass(name) { return this.classes.has(name); }
    get classList() { return { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; }
    toggleClass(name, value) { value ? this.addClass(name) : this.removeClass(name); }
    setAttribute(key, value) { this.attrs[key] = value; }
    get ownerDocument() { return { addEventListener() {}, removeEventListener() {},
        createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') }; }
    getAttribute(key) { return this.attrs[key]; }
    removeAttribute(key) { delete this.attrs[key]; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(listener => listener !== fn); }
    dispatchEvent(event) { if (!event.target) Object.defineProperty(event, 'target', { value: this }); for (const fn of this.listeners[event.type] || []) fn(event); }
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
    getBoundingClientRect() { return { left: 12, bottom: 36 }; }
    get options() { return this.children.filter(child => child.tag === 'option'); }
    get childElementCount() { return this.children.length; }
    focus() { this.focused = true; }
    reportValidity() { return true; }
    setText(text) { this.textContent = text; }
    closest() { return null; }
    appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
    insertBefore(child, reference) { child.remove(); this.children.splice(this.children.indexOf(reference), 0, child); child.parentElement = this; return child; }
    contains(child) { return this === child || this.children.some(element => element.contains(child)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}

function load(filename, dependencies = {}, globals = {}, extraSource = '') {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extraSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, Event, console: { log() {}, error() {}, warn() {} }, ...globals,
        require(name) { return dependencies[name] || (name.endsWith('/financial-metrics') ? load('src/financial-metrics.ts', { './models': dependencies['./models'] || dependencies['../models'], obsidian: dependencies.obsidian }) : undefined) || (name.endsWith('/chart-tooltip') ? load('src/chart-tooltip.ts', { obsidian: dependencies.obsidian }) : undefined) || (name.endsWith('/account-calculations') ? load('src/account-calculations.ts', { './models': dependencies['./models'] || dependencies['../models'] }) : undefined) || (name.endsWith('/modal-utils') ? load('src/modal-utils.ts') : {}); }
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
    open() { this.containerEl.isConnected = true; shownModals.push(this); this.onOpen?.(); }
    close() { this.containerEl.isConnected = false; this.closed = true; this.onClose?.(); }
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
    draw() {}
    render() {}
    stop() {}
    destroy() {}
}
const animationFrames = [];
const chartTimers = [];
const transactionCards = [];
const calendars = [];
const balanceObservers = [];
const focusedTooltips = [];
const { ExpensicaDashboardView, TransactionModal, DateRangePickerModal, DateRangeType, BudgetModal, AccountEditorModal, AccountModal } = load('src/dashboard-view.ts', {
    obsidian: { Component, Modal, ItemView: Component, setIcon() {},
        displayTooltip(element, content, options) { focusedTooltips.push({ element, content,
            text: typeof content === 'string' ? content : modalText(content).trim(), options }); },
        setTooltip(element, text, options) { element.setAttribute('aria-label', text); element.tooltipOptions = options; } }, './models': models,
    'chart.js/auto': { default: Chart }, 'chart.js': { ...require('chart.js'), Tooltip: { positioners: {} } },
    './date-selector-modal': { DateSelectorModal, formatDateForDisplay: value => value },
    './time-selector-modal': { formatTimeForDisplay: value => value },
    './confirmation-modal': { ConfirmationModal },
    './notice': { showExpensicaNotice: message => notices.push(message) },
    './category-chip': { renderCategoryChip: (container, options) => container.createEl('button', { text: options.text }) },
    './account-card': accountCards,
    './transaction-card': { renderTransactionCard: (container, options) => transactionCards.push(options) },
    './dashboard-integration': { PremiumVisualizations: class {
        constructor(...args) { this.onEdit = args[5]; calendars.push(this); }
        render() {}
    } }
}, {
    ResizeObserver: class {
        constructor(callback) { this.callback = callback; this.elements = []; balanceObservers.push(this); }
        observe(element) { this.elements.push(element); }
        disconnect() { this.disconnected = true; }
    },
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
        cancelAnimationFrame() {},
        setTimeout: callback => { chartTimers.push(callback); return chartTimers.length; }
    }
}, '\nexport { BudgetModal, AccountModal };');

const { ExpensicaTransactionsView } = load('src/transactions-view.ts', {
    obsidian: { Modal }, './models': models,
    './dashboard-view': { ExpensicaDashboardView, TransactionModal, DateRangeType, EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
    './transaction-card': { renderTransactionCard: (container, options) => transactionCards.push(options) }
}, { window: { clearTimeout() {}, cancelAnimationFrame() {},
    requestAnimationFrame: fn => { animationFrames.push(fn); return animationFrames.length; } } });
class EmbeddedTransactionsView extends ExpensicaTransactionsView {
    renderTransactionStatsHeader() {}
    renderTransactionsBody() { this.restoreScrollPosition(); }
}

function flushEditorFrames() {
    for (const frame of animationFrames.splice(0)) frame();
}

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
        getCategoryEmoji: () => '',
        getCategoryColor: models.getCategoryColor
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

test('Cumulative Expenses and Transactions & Balances share the chart hover renderer', () => {
    const p = plugin();
    p.transactions = [{ id: 'expense', date: '2026-09-01', type: 'expense', amount: 25 }];
    const view = chartView(p);
    view.createCumulativeExpensesChart({});
    view.createIncomeExpenseChart({});
    for (const chart of [view.cumulativeExpensesChart, view.incomeExpenseChart]) {
        assert.equal(chart.config.plugins.length, 1);
        assert.equal(chart.config.plugins[0].id, 'expensicaChartHoverDimming');
        assert.equal(chart.config.options.interaction.mode, 'index');
    }
    assert.notEqual(view.cumulativeExpensesChart.config.plugins[0], view.incomeExpenseChart.config.plugins[0]);
});

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
        plugin: p, transactions: p.transactions,
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
const { default: PersistencePlugin, ImportModal, ExpensicaSettingTab } = load('main.ts', {
    obsidian: { Plugin: class {}, PluginSettingTab: class {}, Modal },
    './src/models': models, './src/data-recovery-modal': recoveryUI,
    './src/dashboard-view': { ExpensicaDashboardView, AccountEditorModal, EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
    './src/transactions-view': { ExpensicaTransactionsView: EmbeddedTransactionsView },
    './src/account-card': accountCards,
    './src/transaction-import': transactionPreparation,
    './src/notice': { showExpensicaNotice: message => notices.push(message) }
}, { crypto: require('node:crypto').webcrypto }, '\nexport { ImportModal, ExpensicaSettingTab };');

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

for (const editing of [false, true]) {
    for (const phase of ['loadTransactionsData', 'requestAllChartAnimations', 'renderDashboard']) {
        test(`committed account ${editing ? 'edit' : 'add'} closes the editor when ${phase} throws`, async () => {
            const h = recoveryHarness();
            const original = { id: 'wallet', name: 'Wallet', type: 'saving', createdAt: '2026-01-01' };
            if (editing) {
                h.p.transactionsData = h.p.normalizeTransactionsSnapshot({ ...h.p.transactionsData,
                    accounts: [...h.p.getAccounts(), original], transactions: [{ id: '20261015-120000-00000001', date: '2026-10-15',
                        time: '12:00:00', type: 'expense', amount: 10, description: 'ENTRY', category: 'food', account: 'saving-wallet' }] });
            }
            h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: h.p.getAccounts(), lastUpdated: 'initial' }));
            h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
            h.storage.fail = false;
            const error = new Error(`${phase} failed after account commit`);
            h.view[phase] = () => { throw error; };
            const editor = new AccountEditorModal(h.p.app, h.p, h.view, editing ? original : null);
            editor.open();
            editor.contentEl.querySelector('#account-name').value = 'Saved account';
            const form = editor.contentEl.querySelector('form');
            const noticeStart = notices.length, errorStart = presentationErrors.length, modalCount = shownModals.length;
            await form.listeners.submit[0]({ preventDefault() {} });
            const accounts = JSON.parse(h.files.get(h.p.accountsFilePath)).accounts;
            assert.equal(h.storage.writes, editing ? 2 : 1);
            assert.equal(accounts.length, 2);
            assert.equal(accounts.filter(account => account.name === 'Saved account').length, 1);
            if (editing) {
                assert.equal(accounts.find(account => account.name === 'Saved account').id, original.id);
                const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
                assert.equal(saved.account, models.formatAccountReference('saving', 'Saved account'));
                assert.equal(saved.id, '20261015-120000-00000001');
                assert.equal(saved.amount, 10);
            }
            assert.equal(editor.closed, true);
            assert.equal(editor.contentEl.children.length, 0);
            assert.equal(h.p.hasSaveFailure(editor), false);
            assert.equal(shownModals.length, modalCount, 'no recovery or warning dialog after a committed account save');
            assert.ok(presentationErrors.slice(errorStart).some(args => args.includes(error)));
            assert.ok(!notices.slice(noticeStart).some(message => /could not finish|input has been kept/.test(message)));
        });
    }
}

for (const [editing, failedDataset] of [[false, 'accounts'], [true, 'accounts'], [true, 'transactions']]) {
    test(`failed account ${editing ? 'edit' : 'add'} ${failedDataset} write retains the draft and Retry closes despite a render exception`, async () => {
        const h = recoveryHarness();
        const original = { id: 'wallet', name: 'Wallet', type: 'saving', createdAt: '2026-01-01' };
        if (editing) {
            h.p.transactionsData = h.p.normalizeTransactionsSnapshot({ ...h.p.transactionsData,
                accounts: [...h.p.getAccounts(), original], transactions: [{ id: '20261015-120000-00000001', date: '2026-10-15',
                    time: '12:00:00', type: 'expense', amount: 10, description: 'ENTRY', category: 'food', account: 'saving-wallet' }] });
        }
        h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: h.p.getAccounts(), lastUpdated: 'initial' }));
        h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions().map(models.orderTransactionFields), lastUpdated: 'initial' }));
        const files = [...h.files], memory = JSON.stringify(h.p.transactionsData);
        const write = h.p.app.vault.adapter.write;
        const failedPath = failedDataset === 'accounts' ? h.p.accountsFilePath : h.p.transactionsFilePath;
        let fail = true, renders = 0;
        h.storage.fail = false;
        h.p.app.vault.adapter.write = async (file, content) => {
            if (fail && file === failedPath) { h.storage.writes++; throw Error('Permission denied'); }
            await write(file, content);
        };
        const error = new Error('render failed after account retry committed');
        h.view.renderDashboard = () => { renders++; throw error; };
        const editor = new AccountEditorModal(h.p.app, h.p, h.view, editing ? original : null);
        editor.open();
        editor.contentEl.querySelector('#account-name').value = 'Retained draft';
        const form = editor.contentEl.querySelector('form');
        const noticeStart = notices.length, errorStart = presentationErrors.length;
        await form.listeners.submit[0]({ preventDefault() {} });
        assert.deepEqual([...h.files], files);
        assert.equal(JSON.stringify(h.p.transactionsData), memory);
        assert.ok(!editor.closed);
        assert.equal(editor.contentEl.querySelector('#account-name').value, 'Retained draft');
        assert.equal(h.p.hasSaveFailure(editor), true);
        assert.equal(renders, 0);
        assert.equal(presentationErrors.length, errorStart);
        const recovery = shownModals.at(-1);
        editor.contentEl.querySelector('#account-name').value = 'Recovered account';
        fail = false;
        await recovery.contentEl.querySelectorAll('button').find(button => button.textContent === 'Retry').listeners.click[0]();
        const accounts = JSON.parse(h.files.get(h.p.accountsFilePath)).accounts;
        assert.equal(h.storage.writes, !editing ? 2 : failedDataset === 'accounts' ? 3 : 5);
        assert.equal(accounts.length, 2);
        assert.equal(accounts.filter(account => account.name === 'Recovered account').length, 1);
        assert.equal(accounts.some(account => account.name === 'Retained draft'), false);
        if (editing) {
            assert.equal(accounts.find(account => account.name === 'Recovered account').id, original.id);
            const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[0];
            assert.equal(saved.account, models.formatAccountReference('saving', 'Recovered account'));
            assert.equal(saved.id, '20261015-120000-00000001');
            assert.equal(saved.amount, 10);
        }
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
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions().map(models.orderTransactionFields), lastUpdated: 'initial' }));
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts, lastUpdated: 'initial' }));
    h.view.transactions = []; // The dashboard's filtered rows must not determine credit debt.
    return { ...h, original };
}

for (const notes of ['Keep notes', '', ' New notes\nwith exact spacing ']) {
    test(`transaction editor preserves custom fields and legacyId through failed saves and retry with notes ${JSON.stringify(notes)}`, async () => {
        const h = creditEditHarness('expense', 0);
        const metadata = Object.freeze({ notes: ' Child notes\n ', id: 'nested', values: Object.freeze([{ notes: ['keep', 'order'] }, 0.001]) });
        const original = Object.freeze({ ...h.original, metadata, legacyId: { original: ['keep'] },
            categoryId: 'custom-category', accountId: 'custom-account' });
        h.p.transactionsData.transactions[1] = original;
        h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
        const memory = JSON.stringify(h.p.getAllTransactions());
        const bytes = [...h.files];
        const editor = new TransactionModal(h.p.app, h.p, h.view, original);
        editor.open();
        editor.contentEl.querySelector('#description').value = 'EDITED DESCRIPTION';
        editor.contentEl.querySelector('#notes').value = notes;
        const form = editor.contentEl.querySelector('form');
        const submit = () => form.listeners.submit[0]({ preventDefault() {}, target: form });
        await submit();
        assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
        assert.deepEqual([...h.files], bytes);
        assert.ok(!editor.closed);
        h.storage.fail = false;
        await submit();
        assert.equal(editor.closed, true);
        const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        const expected = { ...original, description: 'EDITED DESCRIPTION' };
        if (notes) expected.notes = notes;
        else delete expected.notes;
        assert.deepEqual(rows[1], expected);
        assert.equal(JSON.stringify(rows[1].metadata), JSON.stringify(metadata));
        assert.deepEqual(rows.map(row => row.id), ['20200101-120000-00000001', original.id]);
        assert.deepEqual(Object.keys(rows[1]), ['id', 'description', 'amount', 'type', 'date', 'time', 'category', 'account',
            ...(notes ? ['notes'] : []), 'metadata', 'legacyId', 'categoryId', 'accountId']);
        assert.equal(original.notes, 'Keep notes');
        assert.equal(h.storage.writes, 2);
    });
}

test('changing a transfer to an expense removes obsolete endpoints while preserving custom child notes', async () => {
    const h = creditEditHarness('internal', 0);
    h.storage.fail = false;
    const original = { ...h.original, children: [{ notes: ' Child text\n ', fromAccount: 'child-source', toAccount: 'child-destination' }], legacyId: 'keep' };
    h.p.transactionsData.transactions[1] = original;
    const editor = new TransactionModal(h.p.app, h.p, h.view, original);
    editor.open();
    editor.contentEl.querySelector('[data-transaction-type="expense"]').click();
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.equal(editor.closed, true);
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[1];
    assert.equal(saved.type, 'expense');
    assert.equal(saved.id, original.id);
    assert.equal(saved.amount, original.amount);
    assert.equal(saved.legacyId, original.legacyId);
    assert.equal(Object.hasOwn(saved, 'fromAccount'), false);
    assert.equal(Object.hasOwn(saved, 'toAccount'), false);
    assert.deepEqual(saved.children, original.children);
    assert.equal(original.fromAccount, 'chequing-cash');
    assert.equal(original.toAccount, 'credit-visa');
});

function creditWarningDashboard(h, tab = 'overview') {
    const root = new Element();
    const counts = { content: 0, summaries: 0, layouts: 0 };
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: h.p, app: h.p.app, containerEl: { children: [null, root] }, currentTab: tab, scrollTop: 0,
        renderDashboard: ExpensicaDashboardView.prototype.renderDashboard,
        consumeChartAnimationRequest() {}, clearSelectorListeners() {}, destroyCharts() {},
        persistDashboardState() { counts.layouts++; },
        isDashboardVisible: () => true, loadTransactionsData: async () => {},
        renderTabNavigation(container) {
            const tabs = container.createDiv('expensica-tabs');
            for (const name of ['overview', 'accounts', 'transactions', 'categories', 'budget']) {
                tabs.createEl('button', { cls: 'expensica-tab', attr: { 'data-expensica-tab': name } });
            }
            this.updateActiveTabButtons(container);
        },
        renderCashFlow() {},
        renderOverviewTab() { counts.content++; }, renderTransactionsTab() { counts.content++; },
        renderBudgetTab() { counts.content++; }, renderCategoriesTab() { counts.content++; },
        renderAccountsTab(...args) { counts.content++; return ExpensicaDashboardView.prototype.renderAccountsTab.apply(this, args); },
        getAccountSummaries(...args) { counts.summaries++; return ExpensicaDashboardView.prototype.getAccountSummaries.apply(this, args); }
    });
    view.renderDashboard();
    return { view, root, counts };
}

for (const reference of ['explicit', 'absent', 'empty', 'null']) {
    test(`the built-in default account shows its negative-balance advisory for ${reference} transaction references`, async () => {
        const h = recoveryHarness();
        h.storage.fail = false;
        const expense = { id: '20261015-120000-00000001', date: '2026-10-15', time: '12:00:00', type: 'expense',
            category: 'food', description: 'DEFAULT PURCHASE', amount: 75.125 };
        if (reference !== 'absent') expense.account = reference === 'explicit' ? 'other-default' : reference === 'empty' ? '' : null;
        h.p.transactionsData.transactions = [expense];
        const { view, root } = creditWarningDashboard(h);
        const warning = root.querySelector('.expensica-negative-balance-warning');
        assert.ok(warning, 'the built-in default has type other but must receive debit advisories');
        assert.equal(warning.querySelector('h3').textContent, 'Overdraft: Default');
        assert.ok(modalText(warning).includes(`Deficit: ${models.formatCurrency(75.125, 'USD')}.`));
        assert.equal(root.querySelector('.expensica-credit-limit-warning'), null);
        const modalCount = shownModals.length;
        warning.click();
        assert.equal(view.currentTab, 'overview');
        assert.equal(shownModals.length, modalCount + 1);
        const editor = shownModals.at(-1);
        assert.equal(editor.account.id, models.DEFAULT_ACCOUNT.id);
        assert.equal(editor.dashboardView, view);
        view.switchDashboardTab('accounts');
        assert.equal(modalText(root.querySelector('.expensica-account-card-warning')), 'Overdraft');
        editor.close();
        await h.p.addTransaction({ ...expense, id: '20261015-120000-00000002', type: 'income', category: 'salary' });
        await view.refreshData();
        assert.equal(root.querySelector('.expensica-negative-balance-warning'), null);
        assert.equal(root.querySelector('.expensica-account-card-warning'), null);
        assert.equal(h.storage.writes, 1);
    });
}

for (const type of ['other', 'saving']) {
    test(`a ${type} default retains its debit advisory through rename and restart without warning for non-default other accounts`, async () => {
        const h = recoveryHarness();
        h.storage.fail = false;
        const account = { id: 'daily', name: 'Daily', type, isDefault: true };
        const expense = { id: '20261015-120000-00000001', date: '2026-10-15', time: '12:00:00',
            description: 'PURCHASE', amount: 25, type: 'expense', category: 'food', account: models.formatAccountReference(type, account.name) };
        h.p.transactionsData = h.p.normalizeTransactionsSnapshot({ ...h.p.transactionsData,
            accounts: [{ ...models.DEFAULT_ACCOUNT, isDefault: false }, account],
            transactions: [expense, { ...expense, id: '20261015-120000-00000002', account: 'other-default', amount: 50 }] });
        h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: h.p.getAccounts(), lastUpdated: 'initial' }));
        const { view, root } = creditWarningDashboard(h, 'accounts');
        assert.equal(h.p.getDefaultAccount().id, account.id);
        assert.equal(root.querySelectorAll('.expensica-negative-balance-warning').length, 1);
        assert.equal(root.querySelectorAll('.expensica-account-card-warning').length, 1);
        assert.equal(root.querySelector('.expensica-negative-balance-warning').querySelector('h3').textContent, 'Overdraft: Daily');
        await h.p.updateAccount(expense.account, { ...account, name: 'Renamed Daily' });
        await view.refreshData();
        assert.equal(root.querySelector('.expensica-negative-balance-warning').querySelector('h3').textContent, 'Overdraft: Renamed Daily');
        const restarted = recoveryHarness();
        restarted.storage.fail = false;
        for (const [file, content] of h.files) restarted.files.set(file, content);
        await restarted.p.loadAccountsData();
        await restarted.p.loadTransactionsData();
        const fresh = creditWarningDashboard(restarted);
        const warning = fresh.root.querySelector('.expensica-negative-balance-warning');
        assert.ok(warning);
        const modalCount = shownModals.length;
        warning.click();
        assert.equal(fresh.view.currentTab, 'overview');
        assert.equal(shownModals.length, modalCount + 1);
        assert.equal(shownModals.at(-1).account.id, account.id);
        shownModals.at(-1).close();
        await restarted.p.addTransaction({ ...expense, id: '20261015-120000-00000003', type: 'income', category: 'salary',
            account: models.formatAccountReference(type, 'Renamed Daily') });
        await fresh.view.refreshData();
        assert.equal(fresh.root.querySelector('.expensica-negative-balance-warning'), null);
        assert.equal(fresh.root.querySelector('.expensica-account-card-warning'), null);
    });
}

for (const currency of ['USD', 'CAD', 'JPY', 'KWD']) {
    for (const balance of [-25.125, -0.001, 0, 25]) {
        test(`${currency} negative chequing balance ${balance} uses a non-blocking Dashboard advisory and short card label`, () => {
            const h = creditEditHarness();
            h.p.settings.defaultCurrency = currency;
            h.p.transactionsData.transactions = [{ ...h.original, account: 'chequing-cash', amount: Math.abs(balance),
                type: balance < 0 ? 'expense' : 'income' }];
            const memory = JSON.stringify(h.p.transactionsData), bytes = [...h.files];
            const { view, root, counts } = creditWarningDashboard(h, 'accounts');
            const warnings = root.querySelectorAll('.expensica-negative-balance-warning');
            assert.equal(warnings.length, balance < 0 ? 1 : 0);
            if (balance < 0) {
                const warning = warnings[0];
                assert.ok(warning.hasClass('expensica-recovery-card-warning'));
                assert.equal(warning.querySelector('h3').textContent, 'Overdraft: Cash');
                const details = `Balance: ${models.formatCurrency(balance, currency)}. Deficit: ${models.formatCurrency(-balance, currency)}.`;
                assert.ok(modalText(warning).includes(details));
                assert.ok(warning.getAttribute('aria-label').includes(details));
                assert.equal(warning.querySelectorAll('button').length, 0);
                assert.equal(warning.getAttribute('data-recovery-kind'), undefined);
                const label = root.querySelector('.expensica-account-card-warning');
                assert.equal(modalText(label), 'Overdraft');
                assert.equal(label.children.length, 0);
                assert.ok(!label.hasClass('expensica-recovery-card'));
                assert.doesNotMatch(modalText(root.querySelector('.expensica-account-card')), /Deficit:/);
            } else {
                assert.equal(root.querySelector('.expensica-account-card-warning'), null);
            }
            assert.equal(counts.summaries, 1, 'warnings and cards share the existing calculation pass');
            view.switchDashboardTab('overview');
            assert.equal(root.querySelectorAll('.expensica-negative-balance-warning').length, warnings.length);
            assert.equal(h.storage.writes, 0);
            assert.deepEqual([...h.files], bytes);
            assert.equal(JSON.stringify(h.p.transactionsData), memory);
        });
    }
}

test('negative-balance advisories reuse the existing zero cleanup for floating-point cancellation', () => {
    const h = creditEditHarness();
    h.p.transactionsData.transactions = [
        { ...h.original, id: 'opening', account: 'chequing-cash', type: 'income', amount: 0.3 },
        { ...h.original, id: 'first', account: 'chequing-cash', type: 'expense', amount: 0.1 },
        { ...h.original, id: 'second', account: 'chequing-cash', type: 'expense', amount: 0.2 }
    ];
    const before = JSON.stringify(h.p.transactionsData);
    const { root } = creditWarningDashboard(h, 'accounts');
    assert.ok(h.p.getAllTransactions().reduce((sum, row) => sum + (row.type === 'income' ? row.amount : -row.amount), 0) < 0);
    assert.equal(root.querySelector('.expensica-negative-balance-warning'), null);
    assert.equal(root.querySelector('.expensica-account-card-warning'), null);
    assert.equal(root.querySelector('.expensica-account-card-balance').textContent, models.formatCurrency(0, 'USD'));
    assert.equal(JSON.stringify(h.p.transactionsData), before);
});

for (const type of ['saving', 'other', 'credit']) {
    test(`negative ${type} balances do not acquire chequing warnings`, () => {
        const h = creditEditHarness();
        h.p.transactionsData.accounts.push({ id: 'excluded', name: 'Excluded', type });
        h.p.transactionsData.transactions = [{ ...h.original, account: models.formatAccountReference(type, 'Excluded'),
            amount: 50, type: type === 'credit' ? 'income' : 'expense' }];
        const { root } = creditWarningDashboard(h, 'accounts');
        assert.equal(root.querySelector('.expensica-negative-balance-warning'), null);
        assert.equal(root.querySelector('.expensica-account-card-warning'), null);
    });
}

for (const action of ['click', 'Enter', ' ']) {
    test(`mixed account advisories open the affected editor without switching tabs through ${JSON.stringify(action)}`, () => {
        const h = creditEditHarness('expense', 150);
        h.p.transactionsData.accounts.push({ id: 'joint', name: 'Joint', type: 'chequing' });
        h.p.transactionsData.transactions.push(
            { ...h.original, id: 'cash-expense', account: 'chequing-cash', amount: 12.5 },
            { ...h.original, id: 'joint-expense', account: 'chequing-joint', amount: 75 });
        const a = creditWarningDashboard(h), b = creditWarningDashboard(h, 'transactions');
        let expectedModals = shownModals.length;
        for (const name of ['Joint', 'Cash', 'Visa']) {
            const warning = a.root.querySelectorAll('.expensica-account-warning').find(card => modalText(card).includes(`: ${name}`));
            assert.ok(warning);
            assert.equal(warning.getAttribute('role'), 'button');
            assert.equal(warning.getAttribute('tabindex'), '0');
            if (action === 'click') warning.click();
            else {
                let prevented = false;
                warning.dispatchEvent({ type: 'keydown', key: action, preventDefault() { prevented = true; } });
                assert.ok(prevented);
            }
            assert.equal(shownModals.length, ++expectedModals);
            assert.equal(shownModals.at(-1).account.name, name);
            assert.equal(shownModals.at(-1).dashboardView, a.view);
            assert.equal(a.view.currentTab, 'overview');
            assert.equal(b.view.currentTab, 'transactions');
            assert.ok(a.root.querySelector('[data-expensica-tab="overview"]').hasClass('active'));
            a.root.querySelector('.expensica-negative-balance-warning').click();
            assert.equal(shownModals.length, expectedModals, 'an open editor prevents duplicate editors');
            shownModals.at(-1).close();
        }
        assert.equal(a.root.querySelectorAll('.expensica-negative-balance-warning').length, 2);
        assert.equal(a.root.querySelectorAll('.expensica-credit-limit-warning').length, 1);
        assert.match(modalText(a.root.querySelector('.expensica-credit-limit-warning')), /Outstanding debt: \$200\.00.*Credit limit: \$100\.00.*Exceeded by: \$100\.00/);
        assert.equal(a.counts.content, 1, 'editor activation does not rerender the dashboard');
        assert.equal(a.counts.layouts, 0);
        assert.equal(h.storage.writes, 0);
    });
}

for (const editing of [false, true]) {
    test(`transaction ${editing ? 'editing' : 'creation'} records a negative chequing balance and updates its advisory`, async () => {
        const h = creditEditHarness('expense', 0);
        h.p.transactionsData.transactions = editing ? [{ ...h.original, account: 'chequing-cash', amount: 10 }] : [];
        h.storage.fail = false;
        const { view, root } = creditWarningDashboard(h);
        view.requestAllChartAnimations = () => {};
        const editor = new TransactionModal(h.p.app, h.p, view, editing ? h.p.getAllTransactions()[0] : null);
        editor.open();
        editor.contentEl.querySelector('#description').value = 'ACTUAL PURCHASE';
        editor.contentEl.querySelector('#amount').value = '125';
        editor.contentEl.querySelector('[data-account-reference="chequing-cash"]').click();
        const form = editor.contentEl.querySelector('form');
        await form.listeners.submit[0]({ preventDefault() {}, target: form });
        const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].account, 'chequing-cash');
        assert.equal(rows[0].amount, 125);
        if (editing) assert.equal(rows[0].id, h.original.id);
        assert.ok(editor.closed);
        assert.ok(!h.p.hasSaveFailure(editor));
        assert.equal(h.storage.writes, 1);
        assert.match(modalText(root.querySelector('.expensica-negative-balance-warning')), /Balance: -\$125\.00.*Deficit: \$125\.00/);
        assert.equal(root.querySelectorAll('.expensica-recovery-card-save').length, 0);
    });
}

test('negative-balance advisories follow imports, edits, transfers, restarts and repeated dashboard refreshes', async () => {
    const h = creditEditHarness('expense', 0);
    const expense = { ...h.original, account: 'chequing-cash', amount: 25.125 };
    h.p.transactionsData.transactions = [expense];
    h.storage.fail = false;
    const { view, root } = creditWarningDashboard(h);
    const check = async (dashboard, balance) => {
        await dashboard.view.refreshData();
        const warnings = dashboard.root.querySelectorAll('.expensica-negative-balance-warning');
        assert.equal(warnings.length, balance < 0 ? 1 : 0);
        assert.equal(dashboard.root.querySelectorAll('.expensica-account-warnings').length, balance < 0 ? 1 : 0);
        if (balance < 0) assert.ok(modalText(warnings[0]).includes(`Deficit: ${models.formatCurrency(-balance, 'USD')}.`));
        assert.equal(dashboard.view.getAccountBalanceThroughDateTime('chequing-cash', new Date(2100, 0, 1)), balance);
    };
    await check({ view, root }, -25.125);
    await h.p.importTransactionsFromJSON({ name: 'expenses.json', text: async () => JSON.stringify({ transactions: [
        { ...expense, id: '20261015-120000-00000003', amount: 10.125, date: '2030-01-01' }
    ] }) });
    await check({ view, root }, -35.25);
    await h.p.updateTransaction({ ...expense, amount: 0 });
    await check({ view, root }, -10.125);
    await h.p.addTransaction({ ...expense, id: '20261015-120000-00000004', type: 'income', category: 'salary', amount: 10.125 });
    await check({ view, root }, 0);
    const transfer = { ...expense, id: '20261015-120000-00000005', type: 'internal', category: 'internal', account: undefined,
        fromAccount: 'chequing-cash', toAccount: 'credit-visa', amount: 50 };
    await h.p.addTransaction(transfer);
    await check({ view, root }, -50);
    h.p.transactionsData.transactions.push({ ...transfer, id: '20261015-120000-00000006', toAccount: 'CHEQUING-CASH', amount: 500 });
    await check({ view, root }, -50); // Historical self-transfers have no balance effect.
    await h.p.updateTransaction({ ...expense, amount: 0 }); // Serialize the historical fixture through the existing writer.
    const restarted = recoveryHarness();
    restarted.storage.fail = false;
    for (const [file, content] of h.files) restarted.files.set(file, content);
    await restarted.p.loadAccountsData();
    await restarted.p.loadTransactionsData();
    const fresh = creditWarningDashboard(restarted);
    await check(fresh, -50);
    await check(fresh, -50);
    await restarted.p.addTransaction({ ...transfer, id: '20261015-120000-00000007', fromAccount: 'credit-visa', toAccount: 'chequing-cash', amount: 75 });
    await check(fresh, 25);
});

test('negative balances stay advisory while a genuine failed write preserves its draft and existing Retry', async () => {
    const h = creditEditHarness('expense', 0);
    h.p.transactionsData.transactions = [{ ...h.original, account: 'chequing-cash', amount: 10 }];
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions().map(models.orderTransactionFields), lastUpdated: 'initial' }));
    h.view.renderAccountWarnings(h.container);
    const advisory = h.container.querySelector('.expensica-negative-balance-warning');
    assert.ok(advisory);
    const bytes = [...h.files], memory = JSON.stringify(h.p.getAllTransactions());
    const editor = new TransactionModal(h.p.app, h.p, h.view);
    editor.open();
    editor.contentEl.querySelector('#description').value = 'RETAINED PURCHASE';
    editor.contentEl.querySelector('#amount').value = '25';
    editor.contentEl.querySelector('[data-account-reference="chequing-cash"]').click();
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.deepEqual([...h.files], bytes);
    assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
    assert.ok(!editor.closed);
    assert.equal(editor.contentEl.querySelector('#amount').value, '25');
    assert.ok(h.p.hasSaveFailure(editor));
    assert.equal(h.container.querySelectorAll('.expensica-recovery-card-save').length, 1);
    assert.equal(advisory.querySelectorAll('button').length, 0);
    h.storage.fail = false;
    await shownModals.at(-1).contentEl.querySelectorAll('button').find(button => button.textContent === 'Retry').listeners.click[0]();
    assert.ok(editor.closed);
    assert.ok(!h.p.hasSaveFailure(editor));
    h.view.renderAccountWarnings(h.container);
    assert.match(modalText(h.container.querySelector('.expensica-negative-balance-warning')), /Deficit: \$35\.00/);
    assert.equal(h.storage.writes, 2);
    assert.equal(h.p.getAllTransactions().length, 2);
});

test('Dashboard warnings use P1 cards and amounts while account cards retain only the warning label', () => {
    const h = creditEditHarness('expense', 900);
    h.p.settings.defaultCurrency = 'CAD';
    h.p.getAccounts().find(account => account.id === 'visa').creditLimit = 750;
    h.p.transactionsData.transactions.push({ ...h.original, id: 'master-debt', account: 'credit-master', amount: 125 });
    const bytes = [...h.files], memory = JSON.stringify(h.p.transactionsData);
    const { root, counts } = creditWarningDashboard(h, 'accounts');
    const group = root.querySelector('.expensica-account-warnings');
    assert.ok(root.children.indexOf(group) < root.children.indexOf(root.querySelector('.expensica-tabs')));
    const warnings = group.querySelectorAll('.expensica-credit-limit-warning');
    assert.equal(warnings.length, 2);
    const visa = warnings.find(warning => modalText(warning).includes('Visa'));
    assert.ok(visa.hasClass('expensica-recovery-card'));
    assert.ok(visa.hasClass('expensica-recovery-card-warning'));
    assert.equal(visa.querySelector('.expensica-recovery-card-icon').getAttribute('aria-hidden'), 'true');
    const details = `Outstanding debt: ${models.formatCurrency(950, 'CAD')}. Credit limit: ${models.formatCurrency(750, 'CAD')}. Exceeded by: ${models.formatCurrency(200, 'CAD')}.`;
    assert.ok(modalText(visa).includes(details));
    assert.equal(visa.getAttribute('role'), 'button');
    assert.equal(visa.getAttribute('tabindex'), '0');
    assert.ok(visa.getAttribute('aria-label').startsWith('Edit account: Visa'));
    assert.ok(visa.getAttribute('aria-label').includes(details));
    assert.equal(visa.querySelectorAll('button').length, 0);
    assert.equal(visa.getAttribute('data-recovery-kind'), undefined);
    const labels = root.querySelectorAll('.expensica-account-card-warning');
    assert.equal(labels.length, 2);
    for (const label of labels) {
        assert.equal(modalText(label), 'Credit limit exceeded');
        assert.equal(label.children.length, 0);
        assert.ok(!label.hasClass('expensica-recovery-card'));
    }
    for (const card of root.querySelectorAll('.expensica-account-card')) {
        assert.doesNotMatch(modalText(card), /Outstanding debt:|Exceeded by:/);
    }
    assert.equal(counts.summaries, 1, 'warnings and cards share one balance pass');
    assert.equal(counts.content, 1);
    assert.deepEqual([...h.files], bytes);
    assert.equal(JSON.stringify(h.p.transactionsData), memory);
    assert.equal(h.storage.writes, 0);
});

for (const action of ['click', 'Enter', ' ']) {
    test(`Dashboard credit warning ${JSON.stringify(action)} opens its editor in the same dashboard`, () => {
        const h = creditEditHarness('expense', 150);
        h.p.transactionsData.transactions.push({ ...h.original, id: 'master-debt', account: 'credit-master', amount: 175 });
        const a = creditWarningDashboard(h), b = creditWarningDashboard(h, 'transactions');
        const start = shownModals.length; let expectedModals = start;
        a.root.querySelector('.expensica-credit-limit-warning').dispatchEvent({ type: 'keydown', key: 'Escape' });
        assert.equal(shownModals.length, start);
        for (const name of ['Master', 'Visa']) {
            const card = a.root.querySelectorAll('.expensica-credit-limit-warning').find(card => modalText(card).includes(name));
            let prevented = false;
            if (action === 'click') card.click();
            else card.dispatchEvent({ type: 'keydown', key: action, preventDefault() { prevented = true; } });
            assert.equal(prevented, action !== 'click');
            assert.equal(shownModals.length, ++expectedModals);
            assert.equal(shownModals.at(-1).account.name, name);
            assert.equal(shownModals.at(-1).dashboardView, a.view);
            assert.equal(a.view.currentTab, 'overview');
            assert.equal(b.view.currentTab, 'transactions');
            assert.ok(a.root.querySelector('[data-expensica-tab="overview"]').hasClass('active'));
            card.click(); // An already-open editor is reused.
            a.root.querySelectorAll('.expensica-credit-limit-warning')[0].click();
            a.view.renderDashboard();
            a.root.querySelectorAll('.expensica-credit-limit-warning')[0].click();
            assert.equal(shownModals.length, expectedModals);
            shownModals.at(-1).close();
        }
        assert.equal(a.counts.content, 3, 'one initial render and two requested dashboard renders');
        assert.equal(a.counts.layouts, 0, 'direct editing needs no tab navigation');
        assert.equal(h.storage.writes, 0);
    });
}

test('Dashboard refreshes replace advisories, resolve warnings, and ignore detached or deleted account targets', async () => {
    const h = creditEditHarness('expense', 150);
    h.storage.fail = false;
    const { view, root } = creditWarningDashboard(h);
    const old = root.querySelector('.expensica-credit-limit-warning');
    await view.refreshData();
    assert.equal(root.querySelectorAll('.expensica-account-warnings').length, 1);
    assert.equal(root.querySelectorAll('.expensica-credit-limit-warning').length, 1);
    const start = shownModals.length;
    old.click();
    assert.equal(shownModals.length, start);
    assert.equal(view.currentTab, 'overview', 'detached warnings do not navigate');
    const current = root.querySelector('.expensica-credit-limit-warning');
    const visa = h.p.getAccounts().find(account => account.id === 'visa');
    await h.p.updateAccount('credit-visa', { ...visa, name: 'Renamed Visa' });
    current.click();
    assert.equal(view.currentTab, 'overview');
    assert.equal(shownModals.length, start + 1);
    assert.equal(shownModals.at(-1).account.name, 'Renamed Visa');
    shownModals.at(-1).close();
    await view.refreshData();
    assert.match(modalText(root.querySelector('.expensica-credit-limit-warning')), /Renamed Visa/);
    await h.p.addTransaction({ ...h.original, id: '20261015-120000-00000009', account: models.formatAccountReference('credit', 'Renamed Visa'), type: 'income', category: 'salary', amount: 100 });
    await view.refreshData();
    assert.equal(root.querySelector('.expensica-account-warnings'), null, 'payment reaches the configured limit');
    await h.p.updateTransaction({ ...h.p.getAllTransactions().at(-1), amount: 50 });
    await view.refreshData();
    assert.equal(root.querySelectorAll('.expensica-credit-limit-warning').length, 1);
    const deleted = root.querySelector('.expensica-credit-limit-warning');
    await h.p.deleteAccount(models.formatAccountReference('credit', 'Renamed Visa'));
    const modalCount = shownModals.length;
    deleted.click();
    assert.equal(shownModals.length, modalCount);
    await view.refreshData();
    assert.equal(root.querySelector('.expensica-account-warnings'), null);
});

test('account warning accessibility follows type changes without unconditional credit descriptions', () => {
    const account = { id: 'a', name: 'Cash', type: 'credit', creditLimit: 10 };
    const p = plugin([account]);
    p.transactions = [{ id: 'debt', date: '2026-10-01', type: 'expense', amount: 25, account: 'credit-cash' }];
    const modal = new AccountEditorModal({}, p, null, account);
    modal.open();
    const warning = modal.contentEl.querySelector('#account-balance-warning');
    const input = modal.contentEl.querySelector('#credit-limit');
    assert.equal(input.getAttribute('aria-describedby'), 'account-balance-warning');
    assert.equal(warning.hidden, false);
    assert.match(warning.textContent, /Credit limit exceeded/);
    assert.ok(warning.hasClass('expensica-form-description'));
    assert.equal(modal.contentEl.querySelector('#credit-limit-description'), null);
    input.value = '50'; input.dispatchEvent({ type: 'input' });
    assert.equal(warning.hidden, true);
    assert.equal(input.getAttribute('aria-describedby'), undefined);
    modal.contentEl.querySelector('[data-account-type="saving"]').click();
    assert.equal(modal.contentEl.querySelector('#credit-limit'), null);
    assert.equal(warning.hidden, true);
    modal.contentEl.querySelector('[data-account-type="credit"]').click();
    assert.equal(modal.contentEl.querySelectorAll('#account-balance-warning').length, 1);
    modal.close();
});

for (const [limit, debt, expected] of [[100, 99, 0], [100, 100, 0], [100, 100.001, 1],
    [undefined, 200, 0], [0, 0.001, 1], [100, -25, 0]]) {
    test(`Dashboard advisory count ${expected} for limit ${limit} and debt ${debt}, with other account types excluded`, () => {
        const h = creditEditHarness('expense', debt);
        h.p.transactionsData.transactions = [{ ...h.original, amount: Math.abs(debt), type: debt < 0 ? 'income' : 'expense' },
            { ...h.original, id: 'cash-debt', account: 'chequing-cash', amount: 500 }];
        h.p.getAccounts().find(account => account.id === 'visa').creditLimit = limit;
        h.p.getAccounts().find(account => account.id === 'cash').creditLimit = 1;
        const { root, view, counts } = creditWarningDashboard(h);
        assert.equal(root.querySelectorAll('.expensica-credit-limit-warning').length, expected);
        view.switchDashboardTab('categories');
        assert.equal(root.querySelectorAll('.expensica-credit-limit-warning').length, expected);
        h.p.settings.enableAccounts = false;
        view.renderDashboard();
        assert.equal(root.querySelector('.expensica-account-warnings'), null);
        assert.equal(counts.content, 3);
        assert.equal(h.storage.writes, 0);
    });
}

for (const concurrent of [false, true]) {
    test(`credit-limit policy records two real purchases ${concurrent ? 'concurrently' : 'sequentially'} and shows actual excess debt`, async () => {
        const h = creditEditHarness('expense', 900);
        h.p.transactionsData.transactions = h.p.getAllTransactions().slice(0, 1);
        h.p.getAccounts().find(account => account.id === 'visa').creditLimit = 1000;
        h.storage.fail = false;
        const editors = [1, 2].map(index => {
            const editor = new TransactionModal(h.p.app, h.p, h.view);
            editor.open();
            editor.contentEl.querySelector('#description').value = `PURCHASE ${index}`;
            editor.contentEl.querySelector('#amount').value = '60';
            editor.contentEl.querySelector('[data-account-reference="credit-visa"]').click();
            return { editor, form: editor.contentEl.querySelector('form') };
        });
        const submit = ({ form }) => form.listeners.submit[0]({ preventDefault() {}, target: form });
        const noticeStart = notices.length;
        if (concurrent) {
            const write = h.p.app.vault.adapter.write;
            let release, entered;
            const writing = new Promise(resolve => { entered = resolve; });
            h.p.app.vault.adapter.write = async (file, content) => {
                if (!release) await new Promise(resolve => { release = resolve; entered(); });
                await write(file, content);
            };
            const first = submit(editors[0]);
            await writing;
            const second = submit(editors[1]);
            release();
            await Promise.all([first, second]);
        } else {
            await submit(editors[0]);
            await submit(editors[1]);
        }
        assert.ok(editors.every(({ editor }) => editor.closed));
        assert.equal(h.storage.writes, 2);
        const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.equal(rows.length, 3);
        assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 1020);
        assert.equal(new Set(rows.map(row => row.id)).size, 3);
        assert.equal(h.view.getAccountBalanceThroughDateTime('credit-visa', new Date(2100, 0, 1)), 1020);
        const root = new Element();
        h.view.renderAccountsTab(root);
        h.view.renderAccountWarnings(root);
        const warnings = root.querySelectorAll('.expensica-credit-limit-warning');
        assert.equal(warnings.length, 1);
        assert.match(modalText(warnings[0]), /Credit limit exceeded/);
        assert.match(modalText(warnings[0]), /Outstanding debt: \$1,020\.00/);
        assert.match(modalText(warnings[0]), /Credit limit: \$1,000\.00/);
        assert.match(modalText(warnings[0]), /Exceeded by: \$20\.00/);
        assert.equal(warnings[0].querySelectorAll('button').length, 0);
        assert.equal(warnings[0].getAttribute('data-recovery-kind'), undefined);
        assert.ok(editors.every(({ editor }) => !h.p.hasSaveFailure(editor)));
        h.p.renderDataRecoveryWarning(root);
        assert.equal(root.querySelector('.expensica-data-recovery-warning').hidden, true);
        assert.ok(!notices.slice(noticeStart).some(message => /exceeds the credit limit/.test(message)));
    });
}

for (const adding of [false, true]) {
    test(`concurrent credit ${adding ? 'addition and reassignment' : 'edits'} retain original and destination account effects`, async () => {
        const h = creditEditHarness('income', 950);
        const expense = { ...h.original, id: '20261015-120000-00000004', type: 'expense', category: 'food', amount: 60 };
        h.p.transactionsData.transactions.push({ ...expense, id: '20261015-120000-00000003', account: 'credit-master', amount: 990 });
        if (!adding) h.p.transactionsData.transactions.push(expense);
        h.p.getAccounts().filter(account => account.type === 'credit').forEach(account => { account.creditLimit = 1000; });
        h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
        h.storage.fail = false;
        const memory = JSON.stringify(h.p.getAllTransactions()), bytes = h.files.get(h.p.transactionsFilePath);
        const editors = [h.original, adding ? null : expense].map((transaction, index) => {
            const editor = new TransactionModal(h.p.app, h.p, h.view, transaction);
            editor.open();
            editor.contentEl.querySelector('[data-account-reference="credit-master"]').click();
            if (index === 1) {
                editor.contentEl.querySelector('#description').value = 'RECORDED PURCHASE';
                editor.contentEl.querySelector('#amount').value = '130';
            }
            return { editor, form: editor.contentEl.querySelector('form') };
        });
        const write = h.p.app.vault.adapter.write;
        let release, entered;
        const writing = new Promise(resolve => { entered = resolve; });
        h.p.app.vault.adapter.write = async (file, content) => {
            if (!release) await new Promise(resolve => { release = resolve; entered(); });
            await write(file, content);
        };
        const submit = ({ form }) => form.listeners.submit[0]({ preventDefault() {}, target: form });
        const first = submit(editors[0]);
        await writing;
        const second = submit(editors[1]);
        assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
        assert.equal(h.files.get(h.p.transactionsFilePath), bytes);
        release();
        await Promise.all([first, second]);
        const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.equal(h.storage.writes, 2);
        assert.equal(saved.length, 4);
        assert.equal(saved[1].id, h.original.id);
        assert.equal(saved[1].account, 'credit-master');
        assert.equal(saved[1].amount, 50);
        assert.equal(saved[3].amount, 130);
        if (!adding) assert.equal(saved[3].id, expense.id);
        assert.equal(new Set(saved.map(row => row.id)).size, 4);
        assert.equal(h.view.getAccountBalanceThroughDateTime('credit-visa', new Date(2100, 0, 1)), 950);
        assert.equal(h.view.getAccountBalanceThroughDateTime('credit-master', new Date(2100, 0, 1)), 1070);
        assert.ok(editors.every(({ editor }) => editor.closed && !h.p.hasSaveFailure(editor)));
        const root = new Element();
        h.view.renderAccountsTab(root);
        h.view.renderAccountWarnings(root);
        const warnings = root.querySelectorAll('.expensica-credit-limit-warning');
        assert.equal(warnings.length, 1);
        assert.match(modalText(warnings[0]), /Outstanding debt: \$1,070\.00.*Exceeded by: \$70\.00/);
        h.p.renderDataRecoveryWarning(root);
        assert.equal(root.querySelector('.expensica-data-recovery-warning').hidden, true);
    });
}

test('credit warnings follow imports, edits, transfers and fresh restarts without warning notifications', async () => {
    const h = creditEditHarness('expense', 900);
    h.p.transactionsData.transactions = h.p.getAllTransactions().slice(0, 1);
    h.p.getAccounts().find(account => account.id === 'visa').creditLimit = 1000;
    h.files.set(h.p.accountsFilePath, JSON.stringify({ accounts: h.p.getAccounts(), lastUpdated: 'initial' }));
    h.storage.fail = false;
    const purchase = { ...h.original, id: '20261015-120000-00000003', type: 'expense', category: 'food', account: 'credit-visa', amount: 120 };
    const check = (state, debt, excess) => {
        const root = new Element();
        state.view.renderAccountsTab(root);
        state.view.renderAccountWarnings(root);
        const warnings = root.querySelectorAll('.expensica-credit-limit-warning');
        assert.equal(warnings.length, excess > 0 ? 1 : 0);
        assert.equal(state.view.getAccountBalanceThroughDateTime('credit-visa', new Date(2100, 0, 1)), debt);
        if (excess > 0) assert.match(modalText(warnings[0]), new RegExp(`Exceeded by: \\$${excess}\\.00`));
    };
    const noticeStart = notices.length;
    await h.p.addTransaction(purchase);
    check(h, 1020, 20);
    const imported = { ...purchase, id: '20261015-120000-00000004', amount: 100, date: '2030-01-01' };
    await h.p.importTransactionsFromJSON({ name: 'real-purchase.json', text: async () => JSON.stringify({ transactions: [imported] }) });
    check(h, 1120, 120);
    await h.p.updateTransaction({ ...purchase, amount: 40 });
    check(h, 1040, 40);
    await h.p.addTransaction({ ...purchase, id: '20261015-120000-00000005', type: 'internal', category: 'internal', amount: 50,
        account: undefined, fromAccount: 'chequing-cash', toAccount: 'credit-visa' });
    check(h, 990, 0);
    const restarted = recoveryHarness();
    restarted.storage.fail = false;
    for (const [file, content] of h.files) restarted.files.set(file, content);
    await restarted.p.loadAccountsData();
    await restarted.p.loadTransactionsData();
    check(restarted, 990, 0);
    await restarted.p.addTransaction({ ...purchase, id: '20261015-120000-00000006', amount: 75 });
    check(restarted, 1065, 65);
    check(restarted, 1065, 65);
    const overLimitRestart = recoveryHarness();
    overLimitRestart.storage.fail = false;
    for (const [file, content] of restarted.files) overLimitRestart.files.set(file, content);
    await overLimitRestart.p.loadAccountsData();
    await overLimitRestart.p.loadTransactionsData();
    check(overLimitRestart, 1065, 65);
    const visa = overLimitRestart.p.getAccounts().find(account => account.id === 'visa');
    await overLimitRestart.p.updateAccount('credit-visa', { ...visa, creditLimit: 1200 });
    check(overLimitRestart, 1065, 0);
    assert.ok(!notices.slice(noticeStart).some(message => /exceeds the credit limit|Credit limit exceeded/.test(message)));
});

test('an over-limit purchase still retains its draft on a genuine write failure and saves on Retry', async () => {
    const h = creditEditHarness('expense', 200);
    h.view.renderAccountsTab(h.container);
    h.view.renderAccountWarnings(h.container);
    const advisory = h.container.querySelector('.expensica-credit-limit-warning');
    assert.match(modalText(advisory), /Exceeded by: \$150\.00/);
    const bytes = [...h.files], memory = JSON.stringify(h.p.getAllTransactions());
    const editor = new TransactionModal(h.p.app, h.p, h.view);
    editor.open();
    editor.contentEl.querySelector('#description').value = 'REAL PURCHASE';
    editor.contentEl.querySelector('#amount').value = '25';
    editor.contentEl.querySelector('[data-account-reference="credit-visa"]').click();
    const form = editor.contentEl.querySelector('form');
    await form.listeners.submit[0]({ preventDefault() {}, target: form });
    assert.equal(h.storage.writes, 1);
    assert.deepEqual([...h.files], bytes);
    assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
    assert.ok(!editor.closed);
    assert.equal(editor.contentEl.querySelector('#amount').value, '25');
    assert.equal(h.p.hasSaveFailure(editor), true);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, false);
    assert.equal(h.container.querySelectorAll('.expensica-recovery-card-save').length, 1);
    assert.match(modalText(advisory), /Exceeded by: \$150\.00/);
    assert.equal(advisory.querySelectorAll('button').length, 0);
    const recovery = shownModals.at(-1);
    h.storage.fail = false;
    await recovery.contentEl.querySelectorAll('button').find(button => button.textContent === 'Retry').listeners.click[0]();
    assert.equal(editor.closed, true);
    assert.equal(h.p.hasSaveFailure(editor), false);
    assert.equal(h.container.querySelector('.expensica-data-recovery-warning').hidden, true);
    assert.equal(h.storage.writes, 2);
    assert.equal(h.view.getAccountBalanceThroughDateTime('credit-visa', new Date(2100, 0, 1)), 275);
    const root = new Element();
    h.view.renderAccountsTab(root);
        h.view.renderAccountWarnings(root);
    assert.match(modalText(root.querySelector('.expensica-credit-limit-warning')), /Exceeded by: \$175\.00/);
});

for (const [name, type, selector] of [
    ['payment reassignment', 'income', '[data-account-reference="chequing-cash"]'],
    ['transfer endpoint change', 'internal', '[data-to-account-reference="credit-master"]'],
    ['transaction type change', 'income', '[data-transaction-type="expense"]']
]) {
    test(`credit-limit warnings allow ${name} to record the actual transaction`, async () => {
        const h = creditEditHarness(type);
        h.storage.fail = false;
        const editor = new TransactionModal(h.p.app, h.p, h.view, h.original);
        editor.open();
        editor.contentEl.querySelector(selector).click();
        const form = editor.contentEl.querySelector('form');
        const noticeStart = notices.length;
        await form.listeners.submit[0]({ preventDefault() {}, target: form });
        assert.equal(editor.closed, true);
        assert.equal(h.storage.writes, 1);
        const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.deepEqual(rows.map(row => row.id), ['20200101-120000-00000001', h.original.id]);
        assert.equal(rows[1].amount, 50);
        assert.equal(h.view.getAccountBalanceThroughDateTime('credit-visa', new Date(2100, 0, 1)), type === 'income' && name === 'transaction type change' ? 200 : 150);
        const root = new Element();
        h.view.renderAccountsTab(root);
        h.view.renderAccountWarnings(root);
        assert.equal(root.querySelectorAll('.expensica-credit-limit-warning').length, 1);
        assert.equal(h.effects.renders, 1);
        assert.equal(h.p.hasSaveFailure(editor), false);
        assert.ok(!notices.slice(noticeStart).some(message => /exceeds the credit limit/.test(message)));
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

test('account names stay neutral while icons and amounts preserve the account color', () => {
    const root = new Element();
    const account = { id: 'colored', name: 'Cash', type: 'saving', color: '#123456' };
    accountCards.renderAccountCard(root, { account, runningBalance: 0, lastTransactionDateLabel: 'Today',
        currencyCode: 'USD', color: account.color });
    assert.equal(root.querySelector('.expensica-account-card-name').style.color, undefined);
    assert.equal(root.querySelector('.expensica-account-card-icon').style.color, '#123456');
    assert.equal(root.querySelector('.expensica-account-card-balance').style.color, '#123456');
    assert.equal(root.querySelector('.expensica-category-color-preview'), null, 'account icons replace the redundant color swatch');
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
    assert.equal(option.querySelector('svg').attrs.stroke, 'currentColor');
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
        'Testing account with a long full name - Saving',
        'Existing account with a long full name - Saving'
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

test('Retry preserves the actual dashboard tabs and content nodes when recovery data is unchanged', async () => {
    const h = recoveryHarness();
    let tabRenders = 0, loads = 0;
    const dashboard = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: h.p, app: h.p.app, containerEl: { children: [null, h.container] }, currentTab: 'overview',
        dateRange: ExpensicaDashboardView.prototype.getDateRange(DateRangeType.THIS_MONTH),
        isDashboardVisible: () => true,
        consumeChartAnimationRequest() {}, rememberScrollPosition() {}, restoreScrollPosition() {},
        renderTabNavigation(container) { tabRenders++; ExpensicaDashboardView.prototype.renderTabNavigation.call(this, container); },
        renderCurrentTabContent(container) { container.createDiv({ cls: 'test-body', text: 'Unchanged content' }); },
        loadTransactionsData: async () => { loads++; }
    });
    h.p.app.workspace.getLeavesOfType = () => [{ view: dashboard }];
    h.p.refreshExpensicaViews = PersistencePlugin.prototype.refreshExpensicaViews.bind(h.p);
    dashboard.renderDashboard();
    const tabs = h.container.querySelector('.expensica-tabs');
    const body = h.container.querySelector('.test-body');
    const original = h.files.get(h.p.budgetFilePath);
    h.files.set(h.p.budgetFilePath, '{broken budget');
    await h.p.loadBudgetData();
    shownModals.at(-1).close();
    await h.container.querySelector('[data-recovery-kind="load"]').querySelector('button').listeners.click[0]();
    assert.equal(tabRenders, 1);
    assert.equal(loads, 0);
    assert.equal(h.container.querySelector('.expensica-tabs'), tabs);
    assert.equal(h.container.querySelector('.test-body'), body);
    shownModals.at(-1).close();
    const modalCount = shownModals.length;
    h.files.set(h.p.budgetFilePath, original);
    await h.container.querySelector('[data-recovery-kind="load"]').querySelector('button').listeners.click[0]();
    assert.equal(shownModals.length, modalCount);
    assert.equal(tabRenders, 1);
    assert.equal(h.container.querySelector('.expensica-tabs'), tabs);
    assert.equal(h.container.querySelector('.test-body'), body);
    h.files.set(h.p.budgetFilePath, JSON.stringify({ budgets: [{ id: 'b', categoryId: 'food', period: 'monthly', amount: 100 }] }));
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(tabRenders, 2, 'changed recovered data still refreshes the dashboard');
    assert.equal(loads, 1);
    assert.notEqual(h.container.querySelector('.expensica-tabs'), tabs);
    assert.equal(h.p.getAllBudgets()[0].amount, 100);
    assert.equal(await h.p.retryDataRecovery(), true);
    assert.equal(tabRenders, 2);
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
            currentDate: today, selectedCalendarDate: today,
            containerEl: { children: [null, root], contains: element => root.contains(element) },
            isDashboardVisible: () => true,
            renderChartDateRangeButtons() {},
            renderDashboard() {
                root.empty();
                this.plugin.renderDataRecoveryWarning(root);
                this.renderCumulativeExpensesChart(root);
                const canvas = root.querySelector('canvas');
                if (canvas) canvas.isConnected = true;
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

test('Overview retains its summaries and charts while transaction lists belong to the Transactions tab', () => {
    const root = new Element();
    const rendered = [];
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        renderSummary() { rendered.push('summary'); },
        renderCashFlow() { rendered.push('cash-flow'); },
        renderPremiumVisualizations() { rendered.push('calendar'); },
        renderExpensesChart() { rendered.push('categories'); },
        renderIncomeExpenseChart() { rendered.push('balances'); },
        plugin: { renderDashboardTransactionsTab(owner, container) {
            assert.equal(owner, view);
            assert.equal(container, root);
            rendered.push('transactions');
        } }
    });
    view.renderOverviewTab(root);
    assert.deepEqual(rendered, ['summary', 'cash-flow', 'balances', 'categories', 'calendar']);
    assert.equal(root.querySelector('.expensica-recent-transactions-section'), null);
    view.renderTransactionsTab(root);
    assert.equal(rendered.at(-1), 'transactions');
});

test('Overview creates one panel grid followed by Transactions & Balances, Categories and Heatmap in DOM order', () => {
    const root = new Element();
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        renderSummary(parent) { parent.createDiv('expensica-account-balances-container'); },
        renderCashFlow(parent) { parent.createDiv('expensica-cash-flow-container'); },
        renderIncomeExpenseChart() {}, renderExpensesChart() {},
        renderPremiumVisualizations(parent) { parent.createDiv('expensica-section'); }
    });
    view.renderOverviewTab(root);
    assert.ok(root.hasClass('expensica-overview'));
    assert.equal(root.children.length, 3);
    const [pair, charts, heatmap] = root.children;
    assert.ok(pair.hasClass('expensica-overview-panels'));
    assert.ok(pair.children[0].hasClass('expensica-account-balances-container'));
    assert.ok(pair.children[1].hasClass('expensica-cash-flow-container'));
    assert.ok(charts.hasClass('expensica-dashboard-grid'));
    assert.ok(charts.children[0].hasClass('expensica-income-expense-chart-container'));
    assert.ok(charts.children[1].hasClass('expensica-expenses-chart-container'));
    assert.ok(heatmap.hasClass('expensica-section'));
});

test('compact Transaction button follows the range menu and opens the existing modal', () => {
    const { view, root } = cashFlowHarness();
    view.selectedCalendarDate = new Date(2026, 10, 4);
    view.renderTabNavigation(root);
    const toolbar = root.children[0], create = toolbar.children[1];
    assert.ok(toolbar.hasClass('expensica-toolbar'));
    assert.ok(toolbar.children[0].hasClass('shadcn-date-range-container'));
    assert.ok(toolbar.children[0].querySelector('.expensica-global-date-range'));
    assert.ok(create.hasClass('expensica-create-transaction'));
    assert.equal(create.tag, 'button');
    assert.equal(modalText(create).trim(), 'Transaction');
    assert.equal(create.children[0].attrs['aria-hidden'], 'true');
    assert.equal(create.querySelector('.expensica-account-card-date'), null);
    assert.ok(root.children[1].hasClass('expensica-tabs'));
    create.click();
    const modal = shownModals.at(-1);
    assert.ok(modal instanceof TransactionModal);
    assert.equal(modal.editorHost, view);
    assert.equal(modal.contentEl.querySelector('input[name="date"]').value, '2026-11-04');
    modal.close();
});

function selectGlobalRange(view, root, type) {
    root.querySelector('.expensica-global-date-range').click();
    const index = view.getDateRangeOptions().findIndex(option => option.type === type);
    root.querySelector('.expensica-date-range-options').children[index].click();
}
function selectedRangeLabel(view, type = view.dateRange.type) {
    return view.getDateRangeOptions().find(option => option.type === type).label;
}

test('global range dropdown restores its calendar, chevron and anchored options with keyboard navigation', () => {
    const { view, root } = cashFlowHarness();
    view.renderDateRangeSelector(root);
    const button = root.querySelector('.expensica-global-date-range');
    const selector = root.querySelector('.shadcn-date-range-selector');
    const menu = root.querySelector('.expensica-date-range-options');
    assert.ok(button.hasClass('shadcn-date-range-current'));
    assert.equal(button.querySelectorAll('svg').length, 2);
    assert.ok(menu.hasClass('shadcn-date-range-options'));
    assert.ok(menu.hasClass('shadcn-date-range-hidden'));
    assert.deepEqual(menu.children.map(item => item.textContent), ['TD', '1W', 'LW', '1M', 'LM', '1Y', 'LY', 'All', 'Range']);
    assert.deepEqual(menu.children.filter(item => item.attrs['aria-checked'] === 'true').map(item => item.textContent), ['1M']);
    selector.dispatchEvent({ type: 'keydown', target: button, key: 'ArrowDown', preventDefault() {} });
    assert.ok(menu.children[3].focused);
    assert.equal(button.attrs['aria-expanded'], 'true');
    assert.ok(root.querySelector('.shadcn-date-range-icon').hasClass('dropdown-icon-open'));
    selector.dispatchEvent({ type: 'keydown', target: menu.children[3], key: 'ArrowDown', preventDefault() {} });
    assert.ok(menu.children[4].focused);
    selector.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(button.attrs['aria-expanded'], 'false');
    assert.ok(button.focused);
    assert.equal(view.dateRangeMenu, null);
    button.click(); view.clearSelectorListeners();
    assert.ok(menu.hasClass('shadcn-date-range-hidden'));
});

test('chart date buttons update the same range as the global menu', async () => {
    const { view, root, effects } = cashFlowHarness();
    view.renderDashboard();
    const range = root.querySelector('.expensica-chart-range-buttons');
    range.children[4].click();
    await new Promise(setImmediate);
    assert.equal(view.dateRange.type, DateRangeType.LAST_MONTH);
    assert.equal(modalText(root.querySelector('.expensica-global-date-range')).trim(), 'LM');
    assert.equal(effects.shared, 1);
    const row = root.querySelector('.expensica-chart-range-buttons');
    assert.equal(row.children.filter(button => button.hasClass('is-active'))[0].textContent, 'LM');
});

test('dashboard unload closes the active Obsidian range menu', () => {
    const { p, root } = cashFlowHarness();
    const view = new ExpensicaDashboardView({}, p);
    view.renderDateRangeSelector(root);
    const button = root.querySelector('.expensica-global-date-range');
    button.click();
    assert.equal(button.attrs['aria-expanded'], 'true');
    view.unload();
    assert.equal(view.dateRangeMenu, null);
    assert.equal(button.attrs['aria-expanded'], 'false');
});

test('navigation tabs retain accessible native buttons, decorative icons, active state and conditional tabs', () => {
    for (const enabled of [false, true]) {
        const root = new Element(), selected = [];
        const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
            plugin: { settings: { enableAccounts: enabled, enableBudgeting: enabled } },
            dateRange: ExpensicaDashboardView.prototype.getDateRange(DateRangeType.THIS_MONTH),
            currentTab: 'transactions', switchDashboardTab: tab => selected.push(tab)
        });
        view.renderTabNavigation(root);
        const tabs = root.querySelectorAll('.expensica-tab');
        assert.deepEqual(tabs.map(tab => tab.attrs['aria-label']), enabled
            ? ['Overview', 'Transactions', 'Accounts', 'Budgets', 'Categories']
            : ['Overview', 'Transactions', 'Categories']);
        for (const tab of tabs) {
            assert.equal(tab.tag, 'button');
            assert.equal(tab.attrs.type, 'button');
            assert.equal(tab.children[0].attrs['aria-hidden'], 'true');
            assert.equal(tab.querySelector('.expensica-tab-label').textContent, tab.attrs['aria-label']);
            assert.equal(tab.hasClass('active'), tab.attrs['data-expensica-tab'] === 'transactions');
            assert.equal(tab.attrs['aria-current'], tab.hasClass('active') ? 'page' : undefined);
            tab.click();
        }
        assert.deepEqual(selected, tabs.map(tab => tab.attrs['data-expensica-tab']));
    }
});

test('Overview range controls share one state and refresh all filtered panels while keeping recorded balances', async () => {
    const { view, root, effects } = cashFlowHarness();
    const recorded = [];
    Object.assign(view, {
        renderPremiumVisualizations() {},
        renderCategoryChartTypeSelector(container) { container.createDiv('expensica-chart-header'); },
        renderDashboard() {
            root.empty(); this.renderTabNavigation(root); this.renderOverviewTab(root);
            recorded.push(this.transactions.map(transaction => transaction.id));
        }
    });
    view.renderDashboard();
    const footerText = () => root.querySelector('.expensica-account-balances-footer').querySelectorAll('.expensica-card-value').map(el => el.textContent).join('|');
    const balances = footerText();
    for (const type of [DateRangeType.LAST_MONTH, DateRangeType.ALL_TIME, DateRangeType.THIS_MONTH]) {
        const controls = root.querySelectorAll('.expensica-global-date-range');
        assert.equal(controls.length, 1);
        assert.equal(root.querySelectorAll('.expensica-chart-range-buttons').length, 2);
        selectGlobalRange(view, root, type);
        await new Promise(setImmediate);
        assert.equal(view.dateRange.type, type);
        assert.equal(modalText(root.querySelector('.expensica-global-date-range')).trim(), selectedRangeLabel(view, type));
        assert.equal(footerText(), balances, 'recorded balances never use the selected range');
        assert.deepEqual(recorded.at(-1), Array.from(view.getTransactionsForDateRange(view.dateRange), transaction => transaction.id));
    }
    assert.equal(recorded[2].length, view.plugin.transactions.length);
    assert.deepEqual(effects, { shared: 3, saves: 3, animations: 3, renders: 0 });
    view.unload();
});

test('one global range dropdown persists across every tab and selections refresh shared data once', async () => {
    const { view, root, p, effects } = cashFlowHarness();
    const seen = [];
    Object.assign(view, {
        containerEl: { children: [null, root] }, currentTab: 'overview',
        renderDashboard: ExpensicaDashboardView.prototype.renderDashboard,
        consumeChartAnimationRequest() {}, rememberScrollPosition() {}, restoreScrollPosition() {},
        renderAccountWarnings() {},
        renderOverviewTab(container) { this.renderSummary(container); this.renderCashFlow(container); },
        renderAccountsTab(container) { container.createDiv('accounts-test-content'); },
        renderBudgetTab(container) { container.createDiv('budget-test-content'); },
        renderCategoriesTab(container) { container.createDiv('categories-test-content'); }
    });
    p.renderDataRecoveryWarning = () => {};
    p.settings.enableBudgeting = true;
    p.renderDashboardTransactionsTab = owner => seen.push(owner.dateRange.type);
    view.renderDashboard();
    const ledger = JSON.stringify(p.transactions);
    const balanceAmounts = () => root.querySelectorAll('.expensica-overview-card-balance')
        .map(card => card.querySelector('.expensica-card-currency-amount').textContent);
    const latest = balanceAmounts();
    for (const [tab, range] of [['transactions', DateRangeType.LAST_MONTH], ['accounts', DateRangeType.THIS_WEEK],
        ['budget', DateRangeType.THIS_YEAR], ['categories', DateRangeType.ALL_TIME], ['overview', DateRangeType.THIS_MONTH]]) {
        const beforeSwitch = root.querySelector('.expensica-global-date-range');
        view.switchDashboardTab(tab);
        assert.equal(root.querySelector('.expensica-global-date-range'), beforeSwitch);
        assert.equal(modalText(beforeSwitch).trim(), selectedRangeLabel(view));
        assert.equal(beforeSwitch.parentElement.parentElement.parentElement.children[1], root.querySelector('.expensica-create-transaction'));
        const beforeSelection = effects.shared;
        selectGlobalRange(view, root, range);
        await new Promise(setImmediate);
        assert.equal(effects.shared, beforeSelection + 1);
        assert.equal(view.currentTab, tab);
        assert.equal(view.dateRange.type, range);
        assert.equal(root.querySelectorAll('.expensica-global-date-range').length, 1);
        assert.equal(modalText(root.querySelector('.expensica-global-date-range')).trim(), selectedRangeLabel(view, range));
        assert.equal(root.querySelectorAll('.expensica-chart-range-buttons').length, tab === 'overview' ? 1 : 0);
        assert.deepEqual(Array.from(view.transactions, row => row.id), Array.from(view.getTransactionsForDateRange(view.dateRange), row => row.id));
    }
    assert.ok(seen.includes(DateRangeType.LAST_MONTH));
    assert.deepEqual(balanceAmounts(), latest);
    await view.applySharedDateRangeState({ type: DateRangeType.CUSTOM, startDate: '2026-10-01', endDate: '2026-10-15',
        customStartDate: '2026-10-01', customEndDate: '2026-10-15', updatedAt: Date.now() });
    assert.equal(modalText(root.querySelector('.expensica-global-date-range')).trim(), 'Range');
    assert.equal(root.querySelector('.expensica-global-date-range').attrs['aria-description'], '2026-10-01 to 2026-10-15');
    assert.deepEqual(balanceAmounts(), latest);
    assert.equal(JSON.stringify(p.transactions), ledger);
    view.unload();
});

test('global custom range cancellation and repeated selections preserve the existing range', async () => {
    const { view, root, effects } = cashFlowHarness();
    view.renderDateRangeSelector(root);
    const select = root.querySelector('.expensica-global-date-range');
    selectGlobalRange(view, root, view.dateRange.type);
    await new Promise(setImmediate);
    assert.equal(effects.shared, 0);
    const range = view.dateRange;
    selectGlobalRange(view, root, DateRangeType.CUSTOM);
    shownModals.at(-1).close();
    assert.equal(modalText(select).trim(), selectedRangeLabel(view, range.type));
    assert.equal(view.dateRange, range);
    assert.equal(effects.shared, 0);
});

test('trend tooltips contain only change text and the comparison month and year', () => {
    const { view, root } = cashFlowHarness();
    view.renderCashFlow(root);
    const pill = root.querySelector('.expensica-cash-flow-comparison');
    assert.equal(pill.attrs['aria-label'], 'More than 50% ($50.00) from Sep, 2026.');
    pill.dispatchEvent({ type: 'focus' });
    assert.equal(focusedTooltips.at(-1).content, pill.attrs['aria-label']);
    assert.equal(typeof focusedTooltips.at(-1).content, 'string');
});

test('Settings retain Export Transactions and Import actions', () => {
    const calls = [], buttons = [];
    const settings = { plugin: {
        openExportModal() { calls.push('export'); },
        openImportModal() { calls.push('import'); }
    } };
    const setting = { addButton(callback) {
        const button = {
            buttonEl: new Element('button'),
            then(callback) { callback(this); return this; },
            setButtonText(text) { this.text = text; return this; },
            onClick(handler) { this.click = handler; return this; }
        };
        callback(button); buttons.push(button); return this;
    } };
    ExpensicaSettingTab.prototype.renderExportSetting.call(settings, setting);
    ExpensicaSettingTab.prototype.renderImportSetting.call(settings, setting);
    assert.deepEqual(buttons.map(button => button.text), ['Export Transactions', 'Import']);
    buttons.forEach(button => button.click());
    assert.deepEqual(calls, ['export', 'import']);
});

test('new and edited transaction title SVGs follow type changes while category emojis remain', () => {
    const p = plugin([{ ...models.DEFAULT_ACCOUNT }, { id: 's', name: 'Savings', type: 'saving' }]);
    p.getCategoryEmoji = () => '\u{1f354}';
    for (const editing of [false, true]) {
        const transaction = editing ? { id: 't', date: '2026-10-01', type: 'expense', amount: 1, category: 'food' } : null;
        const modal = new TransactionModal({}, p, {}, transaction);
        modal.onOpen();
        for (const [type, color] of [['income', 'var(--text-success)'], ['expense', 'var(--text-error)'], ['internal', 'var(--text-muted)']]) {
            modal.contentEl.querySelector(`[data-transaction-type="${type}"]`).click();
            const icon = modal.contentEl.querySelector('.expensica-modal-title-icon').querySelector('.expensica-ui-icon');
            assert.equal(icon.style.color, color);
            assert.equal(icon.querySelector('svg').attrs.stroke, 'currentColor');
            assert.equal(icon.querySelector('svg').attrs['aria-hidden'], 'true');
            assert.ok(modal.contentEl.querySelectorAll('.expensica-category-emoji').some(el => el.textContent === '\u{1f354}'));
        }
    }
});

test('account title SVGs retain account color through type and color edits', () => {
    for (const editing of [false, true]) {
        const p = plugin();
        const account = editing ? { id: 'a', name: 'Card', type: 'credit', color: models.ColorPalette.colors[0] } : null;
        const modal = new AccountEditorModal({}, p, null, account);
        modal.onOpen();
        const titleIcon = modal.contentEl.querySelector('.expensica-modal-title-icon');
        const initialColor = editing ? account.color.slice(0, 7) : models.getNextAccountColor(p.getAccounts());
        assert.equal(titleIcon.style.color, initialColor);
        modal.contentEl.querySelector('[data-account-type="saving"]').click();
        assert.equal(titleIcon.style.color, initialColor);
        assert.equal(titleIcon.querySelector('svg').attrs.stroke, 'currentColor');
        modal.contentEl.querySelector('#account-color').click();
        const palette = shownModals.at(-1);
        const swatch = palette.contentEl.querySelectorAll('button')[1];
        swatch.click();
        assert.equal(titleIcon.style.color, swatch.style.backgroundColor);
        assert.equal(modal.contentEl.querySelector('form').style['--expensica-account-icon-color'], titleIcon.style.color);
    }
});

test('budget cards and editor SVGs use category colors without changing category emoji parameters', () => {
    const p = plugin();
    p.getBudgetForCategory = () => null;
    p.getCategoryEmoji = () => '\u{1f354}';
    const budget = { id: 'b', categoryId: 'food', amount: 100, period: 'monthly' };
    const { renderBudgetCard } = load('src/budget-cards.ts', { './models': models });
    const color = p.getCategoryColor('food', 'Food');
    const card = renderBudgetCard(new Element(), { budget, categoryName: 'Food', categoryColor: color, currencyCode: 'USD',
        spent: 0, remaining: 100, percentage: 0, periodLabel: 'monthly', statusText: '', statusClass: '' });
    assert.equal(card.querySelector('.expensica-budget-card-icon').style.color, color);
    assert.equal(card.querySelector('svg').attrs.stroke, 'currentColor');
    for (const entry of [null, budget]) {
        const modal = new BudgetModal({}, p, {}, entry);
        modal.onOpen();
        const titleIcon = modal.contentEl.querySelector('.expensica-modal-title-icon');
        if (entry) assert.equal(titleIcon.style.color, color);
        const option = modal.categoryOptions.children[1];
        option.click();
        assert.equal(titleIcon.style.color, p.getCategoryColor(modal.selectedCategoryId, p.getCategoryById(modal.selectedCategoryId).name));
        assert.equal(p.getCategoryEmoji(modal.selectedCategoryId), '\u{1f354}');
    }
});

test('date-range title and empty budget summary render decorative SVGs with semantic colors', () => {
    const modal = new DateRangePickerModal({}, new Date(2026, 9, 1), new Date(2026, 9, 2), () => {});
    modal.onOpen();
    assert.equal(modal.contentEl.querySelector('.expensica-modal-title-icon').attrs['aria-hidden'], 'true');
    const root = new Element();
    ExpensicaDashboardView.prototype.renderBudgetSummary.call({ formatBudgetCurrency: String }, root, []);
    assert.deepEqual(root.querySelectorAll('.expensica-ui-icon').map(icon => icon.style.color),
        Array(3).fill('var(--text-muted)'));
});

function cashFlowHarness(income = 150, expenses = 60) {
    const p = plugin([{ id: 'cash', name: 'Cash', type: 'chequing', isDefault: true, color: '#123456' },
        { id: 'saving', name: 'Savings', type: 'saving', color: '#456789' }]);
    const row = (id, date, type, amount, fields = {}) => ({ id, date, type, amount, time: '12:00:00', account: 'chequing-cash', ...fields });
    p.transactions = [row('opening', '2020-01-01', 'income', 1000),
        row('prior-income', '2026-09-01', 'income', 100), row('prior-expense', '2026-09-30', 'expense', 40),
        row('income', '2026-10-01', 'income', income), row('expense', '2026-10-31', 'expense', expenses),
        row('transfer', '2026-10-15', 'internal', 25, { fromAccount: 'chequing-cash', toAccount: 'saving-savings' })];
    const effects = { shared: 0, saves: 0, animations: 0, renders: 0 };
    const root = new Element();
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        app: {}, plugin: p, currentDate: new Date(2026, 9, 15), selectedCalendarDate: null,
        dateRange: { type: DateRangeType.THIS_MONTH, startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31, 23, 59, 59, 999), label: '1M' },
        updateSharedDateRange: async () => { effects.shared++; },
        loadTransactionsData: async () => view.loadTransactionsForDateRange(),
        persistDashboardState: () => { effects.saves++; }, requestAllChartAnimations: () => { effects.animations++; },
        renderDashboard() { effects.renders++; root.empty(); this.renderDateRangeSelector(root); this.renderCashFlow(root); }
    });
    view.scheduleChartInitialization = () => {};
    view.loadTransactionsForDateRange();
    return { p, view, root, effects };
}

test('Cash Flow keeps its chart range row below cumulative expenses', () => {
    for (const empty of [false, true]) {
        const { view, root } = cashFlowHarness();
        if (empty) view.transactions = [];
        const scheduled = [];
        view.scheduleChartInitialization = (key, canvas) => scheduled.push({ key, canvas });
        view.renderCashFlow(root);
        const panel = root.querySelector('.expensica-cash-flow-panel');
        assert.equal(root.querySelectorAll('.expensica-chart-container').length, 1);
        assert.equal(panel.querySelectorAll('.expensica-chart-header').length, 1);
        assert.equal(modalText(panel.querySelector('.expensica-chart-title')).trim(), 'Cash Flow');
        assert.equal(root.querySelector('.expensica-cumulative-expenses-chart-container'), null);
        const metrics = panel.querySelector('.expensica-cash-flow-metrics');
        const canvas = panel.querySelector('.expensica-canvas-container');
        assert.equal(canvas.parentElement, panel);
        assert.ok(panel.children.indexOf(metrics) < panel.children.indexOf(canvas));
        assert.equal(panel.querySelector('.expensica-chart-range-buttons').children.length, 9);
        assert.equal(scheduled.length, empty ? 0 : 1);
        if (!empty) {
            assert.equal(scheduled[0].key, 'cumulativeExpensesChart');
            assert.equal(scheduled[0].canvas.parentElement, canvas);
        }
        panel.closest = () => panel;
        assert.equal(view.getChartScrollAnchorSelector(panel), '.expensica-cash-flow-panel');
    }
});

test('Account Balances shows the full recorded ledger independently of past, current and future date ranges', () => {
    const { p, view, root } = cashFlowHarness();
    p.getAccounts().push({ id: 'credit', name: 'Visa', type: 'credit' });
    p.transactions.push(
        { id: 'future-income', date: '2099-01-01', time: '12:00:00', type: 'income', amount: 200, account: 'chequing-cash' },
        { id: 'future-debt', date: '2099-01-02', time: '12:00:00', type: 'expense', amount: 80, account: 'credit-visa' },
        { id: 'future-payment', date: '2099-01-03', time: '12:00:00', type: 'internal', amount: 30,
            fromAccount: 'chequing-cash', toAccount: 'credit-visa' });
    const before = JSON.stringify(p.transactions);
    for (const year of [2019, 2026, 2100]) {
        view.dateRange = { type: DateRangeType.THIS_MONTH, startDate: new Date(year, 9, 1), endDate: new Date(year, 9, 31) };
        view.loadTransactionsForDateRange(); root.empty(); view.renderSummary(root);
        const cards = root.querySelectorAll('.expensica-overview-card-balance');
        assert.deepEqual(cards.map(card => card.querySelector('.expensica-card-currency-amount').textContent), ['$1,295.00', '$25.00', '$50.00']);
        assert.deepEqual(root.querySelector('.expensica-account-balances-footer').querySelectorAll('.expensica-card-value').map(el => el.textContent), ['$1,320.00', '$50.00', '$1,270.00']);
        assert.equal(root.querySelectorAll('.expensica-card-trend').length, 6, 'account and summary metrics share period comparisons');
        assert.equal(root.querySelector('.expensica-chart-range-buttons'), null);
        const info = root.querySelector('.expensica-account-balances-header').querySelector('button');
        assert.equal(info.attrs['aria-label'], 'Last recorded account balances independant from the date range.');
        assert.equal(info.attrs.title, undefined);
        assert.ok(info.hasClass('expensica-cash-flow-info'));
        assert.ok(cards[2].querySelector('.expensica-account-balances-owed'));
    }
    assert.equal(JSON.stringify(p.transactions), before);
    view.unload();
});

test('period comparisons use the immediately preceding equivalent calendar period including custom ranges', () => {
    const { view } = cashFlowHarness();
    for (const [type, start, end, previousStart, previousEnd] of [
        [DateRangeType.TODAY, '2026-01-01', '2026-01-01', '2025-12-31', '2025-12-31'],
        [DateRangeType.THIS_WEEK, '2026-01-04', '2026-01-10', '2025-12-28', '2026-01-03'],
        [DateRangeType.LAST_WEEK, '2026-03-08', '2026-03-14', '2026-03-01', '2026-03-07'],
        [DateRangeType.THIS_MONTH, '2024-03-01', '2024-03-31', '2024-02-01', '2024-02-29'],
        [DateRangeType.LAST_MONTH, '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31'],
        [DateRangeType.THIS_YEAR, '2025-01-01', '2025-12-31', '2024-01-01', '2024-12-31'],
        [DateRangeType.LAST_YEAR, '2024-01-01', '2024-12-31', '2023-01-01', '2023-12-31'],
        [DateRangeType.CUSTOM, '2026-03-07', '2026-03-09', '2026-03-04', '2026-03-06'],
        [DateRangeType.CUSTOM, '2024-02-28', '2024-03-01', '2024-02-25', '2024-02-27']
    ]) {
        view.dateRange = { type, startDate: models.parseLocalDate(start), endDate: models.parseLocalDate(end) };
        const { range } = view.getPreviousPeriodComparisonRange();
        assert.equal(models.formatDate(range.startDate), previousStart, type);
        assert.equal(models.formatDate(range.endDate), previousEnd, type);
        assert.equal(range.endDate.getHours(), 23);
        assert.equal(range.endDate.getMilliseconds(), 999);
    }
});

test('Accounts and summary trends compare selected closing positions while displaying the latest ledger', () => {
    const { view, root } = cashFlowHarness();
    view.plugin = plugin([{ id: 'cash', name: 'Cash', type: 'chequing', isDefault: true },
        { id: 'card', name: 'Card', type: 'credit' }]);
    view.plugin.transactions = [
        ['2025-12-01', 'income', 100, 'chequing-cash'], ['2025-12-02', 'expense', 50, 'credit-card'],
        ['2026-01-01', 'income', 100, 'chequing-cash'], ['2026-01-02', 'expense', 25, 'credit-card'],
        ['2030-01-01', 'income', 1000, 'chequing-cash'], ['2030-01-02', 'expense', 100, 'credit-card']
    ].map(([date, type, amount, account], index) => ({ id: String(index), date, type, amount, account }));
    view.dateRange = view.getDateRange(DateRangeType.CUSTOM, models.parseLocalDate('2026-01-01'), models.parseLocalDate('2026-01-31'));
    view.dateRange.type = DateRangeType.THIS_MONTH;
    view.renderSummary(root);
    const panel = root.querySelector('.expensica-account-balances-panel');
    assert.equal(panel.children[1].tag, 'div', 'summary appears directly below the panel header');
    assert.ok(panel.children[2].hasClass('expensica-account-balances-viewport'));
    assert.deepEqual(root.querySelector('.expensica-account-balances-footer').querySelectorAll('.expensica-card-value').map(el => el.textContent), ['$1,200.00', '$175.00', '$1,025.00']);
    const summaryPills = root.querySelector('.expensica-account-balances-footer').querySelectorAll('.expensica-card-trend');
    assert.deepEqual(summaryPills.map(pill => modalText(pill).trim()), ['$100.00', '50%', '$75.00']);
    assert.ok(summaryPills[1].hasClass('is-negative'), 'rising debt is negative news');
    assert.ok(summaryPills.every(pill => pill.attrs['aria-label'].endsWith('from Dec, 2025.')));
    assert.deepEqual(root.querySelectorAll('.expensica-overview-card-balance').map(card => modalText(card.querySelector('.expensica-card-trend')).trim()), ['$100.00', '50%']);
    view.unload();
});

test('account and summary zero baselines use finite currency changes rather than undefined percentages', () => {
    const { view, root } = cashFlowHarness();
    view.plugin = plugin([{ id: 'cash', name: 'Cash', type: 'chequing', isDefault: true }]);
    view.plugin.transactions = [{ id: 'new', date: '2026-10-01', type: 'income', amount: 100, account: 'chequing-cash' }];
    view.renderSummary(root);
    const pills = root.querySelectorAll('.expensica-card-trend');
    assert.deepEqual(pills.map(pill => modalText(pill).trim()), ['$100.00', '0%', '$100.00', '$100.00']);
    assert.ok(pills.every(pill => !/NaN|Infinity|100%/.test(pill.attrs['aria-label'])));
    assert.equal(pills[1].querySelector('svg'), null);
    view.unload();
});

test('account cards open the existing editor directly and retain the selected tab', () => {
    const { view, root, p } = cashFlowHarness();
    const navigation = [];
    view.switchDashboardTab = tab => { navigation.push(tab); view.currentTab = tab; };
    p.openTransactionsView = () => assert.fail('transaction search must not open');
    view.renderSummary(root);
    root.querySelector('.expensica-overview-card-balance').click();
    assert.deepEqual(navigation, []);
    assert.ok(view.accountEditorModal instanceof AccountEditorModal);
    assert.equal(view.accountEditorModal.account.id, 'cash');
    assert.equal(view.accountEditorModal.contentEl.querySelector('#account-name').value, 'Cash');
    view.accountEditorModal.close();
    view.unload();
});

test('account balance tooltips use latest balances and remaining credit, including credit balances and unset limits', () => {
    const { view, root } = cashFlowHarness();
    const cases = [
        [{ id: 'a', name: 'Cash', type: 'chequing' }, 50, 'Your Cash balance is $50.00'],
        [{ id: 'a', name: 'Visa', type: 'credit', creditLimit: 100 }, 25, 'Your Visa balance is $25.00, your remaining credit limit is $75.00'],
        [{ id: 'a', name: 'Visa', type: 'credit', creditLimit: 100 }, 125, 'Your Visa balance is $125.00, your remaining credit limit is $0.00'],
        [{ id: 'a', name: 'Visa', type: 'credit', creditLimit: 100 }, -25, 'Your Visa balance is -$25.00, your remaining credit limit is $100.00'],
        [{ id: 'a', name: 'Visa', type: 'credit' }, 25, 'Your Visa balance is $25.00, your remaining credit limit is not set']
    ];
    for (const [account, balance, expected] of cases) {
        const card = root.createDiv();
        view.setAccountBalanceTooltip(card, account, balance);
        assert.equal(card.attrs['aria-label'], expected);
        assert.equal(card.tooltipOptions.classes[0], 'expensica-chart-tooltip');
        card.dispatchEvent({ type: 'focus' });
        assert.equal(focusedTooltips.at(-1).text, expected);
        assert.equal(card.listeners.click, undefined, 'balance tooltip does not intercept account editing');
    }
});

test('Overview omits the add-account card while the Accounts tab keeps its create action', () => {
    const { view, root } = cashFlowHarness();
    view.renderTabNavigation(root); view.renderSummary(root);
    assert.equal(root.querySelector('.expensica-account-balance-create'), null);
    assert.equal(root.querySelector('.expensica-account-balances-row').querySelector('.expensica-account-card-create'), null);
    assert.ok(root.querySelectorAll('.expensica-tab').some(tab => tab.attrs['data-expensica-tab'] === 'accounts'));
    const accounts = new Element(); view.renderAccountsTab(accounts);
    assert.ok(accounts.querySelector('.expensica-account-card-create'));
});

test('account editor warnings appear only for overdrafts or exceeded credit limits and update with the limit', () => {
    for (const [type, balance, limit, expected] of [
        ['chequing', 25, undefined, ''], ['chequing', 0, undefined, ''], ['chequing', -25, undefined, 'Overdraft:'],
        ['credit', 25, 100, ''], ['credit', 100, 100, ''], ['credit', 125, 100, 'Credit limit exceeded'],
        ['credit', -25, 100, ''], ['credit', 25, undefined, ''], ['credit', 25, 0, 'Credit limit exceeded']
    ]) {
        const account = { id: 'a', name: 'Cash', type, creditLimit: limit };
        const p = plugin([account]);
        p.transactions = [{ id: 'balance', date: '2026-10-01', type: (type === 'credit') === (balance > 0) ? 'expense' : 'income',
            amount: Math.abs(balance), account: models.formatAccountReference(type, account.name) }];
        const modal = new AccountEditorModal({}, p, null, account);
        modal.open();
        const warning = modal.contentEl.querySelector('#account-balance-warning');
        assert.equal(warning.hidden, expected === '', `${type}/${balance}/${limit}`);
        assert.ok(warning.textContent.startsWith(expected));
        assert.ok(warning.hasClass('expensica-account-editor-warning'));
        assert.equal(modal.contentEl.querySelector('#account-overdraft-description'), null);
        assert.equal(modal.contentEl.querySelector('#credit-limit-description'), null);
        if (type === 'credit') {
            const input = modal.contentEl.querySelector('#credit-limit');
            input.value = '200'; input.dispatchEvent({ type: 'input' });
            assert.equal(warning.hidden, true);
            input.value = '0'; input.dispatchEvent({ type: 'input' });
            assert.equal(warning.hidden, balance <= 0);
            input.value = ''; input.dispatchEvent({ type: 'input' });
            assert.equal(warning.hidden, true);
        }
        modal.close();
    }
});

test('Overview category buttons switch only category chart state and retain the shared range', () => {
    const { view, root } = cashFlowHarness();
    view.categoryChartType = models.CategoryType.EXPENSE;
    const range = view.dateRange, changes = [];
    view.renderCategoryChartTypeSelector(root, () => changes.push(view.categoryChartType), { buttons: true });
    assert.equal(root.querySelector('.expensica-chart-type-current'), null);
    assert.equal(view.categoryChartTypeSelectorComponent, null, 'buttons require no outside-click listener');
    const buttons = root.querySelector('.expensica-category-type-buttons').children;
    assert.deepEqual(buttons.map(button => button.textContent), ['Income', 'Expenses']);
    assert.equal(buttons[1].attrs['aria-pressed'], 'true');
    buttons[1].click(); assert.deepEqual(changes, []);
    buttons[0].click(); assert.deepEqual(changes, ['income']);
    assert.equal(view.dateRange, range);
    root.empty(); view.renderCategoryChartTypeSelector(root, () => {}, { buttons: true });
    assert.equal(root.querySelector('.expensica-category-type-buttons').children[0].attrs['aria-pressed'], 'true');
});

test('embedded cumulative expenses keeps period data and comparison totals while abbreviating legend months', () => {
    const { p, view } = cashFlowHarness();
    const chart = Object.assign(chartView(p), { dateRange: view.dateRange, currentDate: view.currentDate, transactions: view.transactions });
    const legend = new Element();
    chart.createCumulativeExpensesChart(new Element('canvas'), legend);
    assert.deepEqual(legend.querySelectorAll('.expensica-cumulative-expenses-legend-label').map(el => el.textContent), ['Oct, 2026', 'Sep, 2026']);
    const datasets = chart.cumulativeExpensesChart.data.datasets;
    assert.equal(datasets[1].data.at(-1), 60);
    assert.equal(datasets[0].data.filter(value => value !== null).at(-1), 40);
});

for (const [income, expenses] of [[150, 60], [40, 60], [60, 60], [0, 0], [0.3, 0.2]]) {
    test(`Cash Flow uses range totals and excludes transfers: ${income} - ${expenses}`, () => {
        const { p, view, root } = cashFlowHarness(income, expenses);
        const before = JSON.stringify(p.transactions);
        view.renderCashFlow(root);
        const metrics = root.querySelectorAll('.expensica-cash-flow-metric');
        assert.deepEqual(metrics.map(item => item.querySelector('.expensica-cash-flow-label').textContent.trim()), ['Income:', 'Expenses:', 'Net Flow:']);
        assert.deepEqual(metrics.map(item => item.querySelector('.expensica-card-currency-amount').textContent),
            [income, expenses, income - expenses].map(value => models.formatCurrency(value, 'USD')));
        assert.ok(metrics[2].querySelector('.expensica-cash-flow-comparison'));
        const expectedColor = income === expenses ? 'var(--text-muted)' : income > expenses ? 'var(--text-success)' : 'var(--text-error)';
        assert.equal(metrics[2].style['--expensica-cash-flow-color'], expectedColor);
        assert.ok(metrics.every(item => !item.querySelector('.expensica-cash-flow-label').querySelector('svg')));
        const panel = root.querySelector('.expensica-cash-flow-panel');
        assert.ok(panel.hasClass('expensica-chart-container'));
        assert.equal(panel.querySelector('.expensica-chart-range-buttons').children.length, 9);
        assert.equal(JSON.stringify(p.transactions), before);
    });
}

test('summary metrics show label and amount above trends and clicks only toggle total tooltips', () => {
    const { view, root, p } = cashFlowHarness();
    p.openTransactionsView = () => assert.fail('metrics must not open transaction navigation');
    view.switchDashboardTab = () => assert.fail('metrics must not change tabs');
    view.renderSummary(root); view.renderCashFlow(root);
    const metrics = root.querySelectorAll('.expensica-cash-flow-metric');
    const expected = [
        'your total Assets is $1,150.00', 'your total Debts is $0.00', 'your total Net Balance is $1,150.00',
        'your total Income for Oct, 2026 is $150.00', 'your total Expenses for Oct, 2026 is $60.00',
        'your total Net Flow for Oct, 2026 is $90.00'
    ];
    metrics.forEach((metric, index) => {
        assert.equal(metric.children.length, 2);
        const [total, trend] = metric.children;
        assert.ok(total.hasClass('expensica-metric-total'));
        assert.ok(trend.hasClass('expensica-card-trend'));
        assert.ok(total.children[0].textContent.endsWith(': '));
        assert.ok(total.children[1].hasClass('expensica-card-value'));
        assert.equal(total.attrs['aria-label'], expected[index]);
        assert.equal(total.tooltipOptions.classes[0], 'expensica-chart-tooltip');
        assert.equal(trend.tooltipOptions.classes[0], 'expensica-chart-tooltip');
        assert.equal(metric.hasClass('expensica-overview-card-interactive'), false);
        total.click();
        assert.equal(focusedTooltips.at(-1).text, expected[index]);
        assert.equal(total.attrs['aria-expanded'], 'true');
        total.click();
        assert.equal(total.attrs['aria-expanded'], 'false');
        total.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {}, stopPropagation() {} });
        assert.equal(total.attrs['aria-expanded'], 'true');
        trend.click();
        assert.equal(focusedTooltips.at(-1).text, trend.attrs['aria-label']);
    });
});

test('Cash Flow comparisons reuse the previous period and keep its description in the tooltip', () => {
    const { view, root } = cashFlowHarness();
    view.renderCashFlow(root);
    const pills = root.querySelectorAll('.expensica-cash-flow-comparison');
    assert.equal(pills.length, 3);
    assert.deepEqual(pills.map(pill => modalText(pill).trim()), ['50%', '50%', '50%']);
    assert.deepEqual(pills.map(pill => pill.attrs['aria-label']), [
        'More than 50% ($50.00) from Sep, 2026.',
        'More than 50% ($20.00) from Sep, 2026.',
        'More than 50% ($30.00) from Sep, 2026.'
    ]);
    assert.ok(pills.every(pill => pill.attrs.title === undefined));
    assert.ok(pills.every(pill => pill.querySelectorAll('polyline').at(-1).attrs.points === '16 7 22 7 22 13'));
    view.dateRange = view.getDateRange(DateRangeType.ALL_TIME);
    view.loadTransactionsForDateRange(); root.empty(); view.renderCashFlow(root);
    assert.equal(root.querySelectorAll('.expensica-cash-flow-comparison').length, 0);
});

test('Cash Flow arrows follow numeric direction while expense colors reverse financial meaning', () => {
    for (const [income, expenses, state, percentage] of [[150, 60, 'is-positive', '50%'],
        [50, 20, 'is-negative', '50%'], [100, 40, 'is-neutral', '0%']]) {
        const { view, root } = cashFlowHarness(income, expenses);
        view.renderCashFlow(root);
        for (const [index, pill] of root.querySelectorAll('.expensica-cash-flow-comparison').entries()) {
            const meaning = index === 1 && state !== 'is-neutral' ? (state === 'is-positive' ? 'is-negative' : 'is-positive') : state;
            assert.ok(pill.hasClass(meaning));
            assert.equal(modalText(pill).trim(), percentage);
            const icon = pill.querySelector('svg');
            if (state === 'is-neutral') assert.equal(icon, null);
            else assert.equal(icon.querySelectorAll('polyline').at(-1).attrs.points,
                state === 'is-positive' ? '16 7 22 7 22 13' : '16 17 22 17 22 11');
        }
    }
});

test('Account balance trends invert credit colors while preserving numeric direction and Owed labels', () => {
    const { view, root } = cashFlowHarness();
    const fixtures = [
        ['Cash', 'chequing', 100, 200, 'is-positive', 'up', '$100.00'],
        ['Reserve', 'saving', 100, 50, 'is-negative', 'down', '50%'],
        ['Visa', 'credit', 100, 200, 'is-negative', 'up', '$100.00'],
        ['Payment', 'credit', 100, 50, 'is-positive', 'down', '50%'],
        ['Flat', 'other', 100, 100, 'is-neutral', null, '0%'],
        ['Empty', 'credit', 0, 0, 'is-neutral', null, '0%'],
        ['Tiny', 'saving', 100, 100.04, 'is-positive', 'up', '$0.04'],
        ['Prepaid', 'credit', 10, -20, 'is-positive', 'down', '$30.00'],
        ['Credit reserve', 'credit', -100, -50, 'is-negative', 'up', '$50.00'],
        ['Overdrawn', 'chequing', -100, -50, 'is-positive', 'up', '$50.00'],
        ['Crossing', 'chequing', -100, 20, 'is-positive', 'up', '$120.00']
    ];
    const accounts = fixtures.map(([name, type], index) => ({ id: String(index), name, type, isDefault: index === 0 }));
    view.plugin = plugin(accounts);
    view.plugin.transactions = fixtures.map(([, type, , amount], index) => ({
        id: String(index), date: '2026-10-01', amount: Math.abs(amount),
        type: (type === 'credit' ? amount > 0 : amount < 0) ? 'expense' : 'income',
        account: models.formatAccountReference(accounts[index].type, accounts[index].name)
    }));
    view.getDefaultAccountBalanceThrough = () => 0;
    view.getAccountBalanceThroughDateTime = (reference, date) => {
        const index = accounts.findIndex(account => models.formatAccountReference(account.type, account.name) === reference);
        return fixtures[index][date.getMonth() === 8 ? 2 : 3];
    };
    view.renderSummary(root);
    root.querySelectorAll('.expensica-overview-card-balance').forEach(card => {
        const [, type, , amount, state, direction, percentage] = fixtures.find(([name]) => name === modalText(card.querySelector('.expensica-card-title')).trim());
        const pill = card.querySelector('.expensica-account-balances-comparison');
        assert.ok(pill.hasClass(state));
        assert.equal(modalText(pill).trim(), percentage);
        const icon = pill.querySelector('svg');
        if (!direction) assert.equal(icon, null);
        else {
            assert.ok(pill.querySelector('.expensica-card-trend-indicator').hasClass(state));
            assert.equal(icon.querySelectorAll('polyline').at(-1).attrs.points,
                direction === 'up' ? '16 7 22 7 22 13' : '16 17 22 17 22 11');
        }
        assert.equal(!!card.querySelector('.expensica-account-balances-owed'), type === 'credit' && amount > 0);
    });
    view.unload();
});

test('Cash Flow supports zero-baseline comparisons without Infinity or NaN', () => {
    const { view, p, root } = cashFlowHarness();
    p.transactions = p.transactions.filter(row => row.date.startsWith('2026-10'));
    view.renderCashFlow(root);
    assert.deepEqual(root.querySelectorAll('.expensica-cash-flow-comparison').map(pill => modalText(pill).trim()), ['$150.00', '$60.00', '$90.00']);
});

for (const [previous, current, expected] of [[0, 0, '0%'], [0, 25, '$25.00'], [0, -25, '$25.00'],
    [-100, -50, '$50.00'], [-100, -150, '$50.00'], [-100, 25, '$125.00'], [0.0000005, 25, '$25.00'],
    [0.001, 25, '$25.00'], [50, -25, '$75.00'], [50, 0, '$50.00'], [50, 25, '50%'], [50, 50, '0%'],
    [100, 100.04, '$0.04'], [0, 0.0000001, '1e-7 USD']]) {
    test(`Net Flow presents ${previous} to ${current} as ${expected} with accessible comparison details`, () => {
        const { view, p, root } = cashFlowHarness(Math.max(0, current), Math.max(0, -current));
        p.transactions = p.transactions.filter(row => !row.date.startsWith('2026-09'));
        p.transactions.push({ id: 'prior-net', date: '2026-09-15', time: '12:00:00',
            type: previous >= 0 ? 'income' : 'expense', amount: Math.abs(previous), account: 'chequing-cash' });
        const before = JSON.stringify(p.transactions);
        view.renderCashFlow(root);
        const pill = root.querySelectorAll('.expensica-cash-flow-comparison')[2];
        const delta = current - previous;
        assert.equal(modalText(pill).trim(), expected);
        assert.doesNotMatch(modalText(pill) + pill.attrs['aria-label'], /Infinity|NaN|good|bad/i);
        assert.match(pill.attrs['aria-label'], /from Sep, 2026\.$/);
        assert.ok(pill.attrs['aria-label'].startsWith(delta === 0 ? '0%' : delta > 0 ? 'More than' : 'Less than'));
        if (delta !== 0) {
            assert.ok(pill.hasClass(delta > 0 ? 'is-positive' : 'is-negative'));
            assert.equal(pill.querySelectorAll('polyline').at(-1).attrs.points,
                delta > 0 ? '16 7 22 7 22 13' : '16 17 22 17 22 11');
        } else {
            assert.ok(pill.hasClass('is-neutral'));
            assert.equal(pill.querySelector('svg'), null);
        }
        for (const type of ['mouseenter', 'focus', 'click']) {
            pill.dispatchEvent({ type, stopPropagation() {} });
            assert.equal(focusedTooltips.at(-1).text, pill.attrs['aria-label']);
            assert.equal(focusedTooltips.at(-1).options.classes[0], 'expensica-chart-tooltip');
            pill.dispatchEvent({ type: 'mouseleave' });
        }
        assert.equal(JSON.stringify(p.transactions), before);
    });
}

test('Cash Flow range controls use the existing shared selection and custom-range handlers', async () => {
    const h = cashFlowHarness();
    h.view.renderDateRangeSelector(h.root);
    h.view.renderCashFlow(h.root);
    const before = JSON.stringify(h.p.transactions);
    for (const type of [DateRangeType.TODAY, DateRangeType.THIS_WEEK, DateRangeType.LAST_WEEK, DateRangeType.THIS_MONTH,
        DateRangeType.LAST_MONTH, DateRangeType.THIS_YEAR, DateRangeType.LAST_YEAR, DateRangeType.ALL_TIME]) {
        selectGlobalRange(h.view, h.root, type);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(h.view.dateRange.type, type);
        const rows = h.view.getTransactionsForDateRange(h.view.dateRange);
        const expected = models.TransactionAggregator.getTotalIncome(rows) - models.TransactionAggregator.getTotalExpenses(rows);
        assert.equal(h.root.querySelectorAll('.expensica-card-currency-amount')[2].textContent, models.formatCurrency(expected, 'USD'));
        assert.equal(h.root.querySelectorAll('.expensica-global-date-range').length, 1);
        assert.equal(modalText(h.root.querySelector('.expensica-global-date-range')).trim(), selectedRangeLabel(h.view, type));
    }
    selectGlobalRange(h.view, h.root, DateRangeType.CUSTOM);
    const modal = shownModals.at(-1);
    assert.ok(modal instanceof DateRangePickerModal);
    await modal.onConfirm(new Date(2026, 9, 1), new Date(2026, 9, 31));
    assert.equal(h.view.dateRange.type, DateRangeType.CUSTOM);
    assert.equal(h.root.querySelectorAll('.expensica-card-currency-amount')[2].textContent, '$90.00');
    assert.deepEqual(h.effects, { shared: 9, saves: 9, animations: 9, renders: 9 });
    assert.equal(JSON.stringify(h.p.transactions), before);
});

test('Cash Flow leaves account balance values, colors, comparisons and links unchanged', () => {
    const { p, view, root } = cashFlowHarness();
    const before = JSON.stringify(p.transactions);
    view.renderSummary(root);
    const snapshot = modalText(root);
    const cards = root.querySelectorAll('.expensica-overview-card-balance');
    assert.deepEqual(cards.map(card => card.querySelector('.expensica-card-currency-amount').textContent), ['$1,125.00', '$25.00']);
    assert.deepEqual(cards.map(card => card.querySelector('.expensica-card-value').style.color), ['#123456', '#456789']);
    assert.ok(cards.every(card => card.querySelector('.expensica-card-trend').attrs['aria-label'].includes('from Sep, 2026')));
    assert.ok(cards.every(card => card.attrs.role === 'button' && card.attrs.tabindex === '0'));
    view.renderCashFlow(new Element());
    const after = new Element(); view.renderSummary(after);
    assert.equal(modalText(after), snapshot);
    assert.equal(JSON.stringify(p.transactions), before);
});

test('Overview account cards use shared debit, saving and credit ordering, oldest first', () => {
    const { view, root } = cashFlowHarness();
    const accounts = [
        { id: 'default', name: 'Default', type: 'other', isDefault: true, createdAt: '2026-06-01T00:00:00Z' },
        { id: 'credit-new', name: 'New Credit', type: 'credit', createdAt: '2026-02-01T00:00:00Z' },
        { id: 'saving-new', name: 'New Saving', type: 'saving', createdAt: '2026-03-01T00:00:00Z' },
        { id: 'debit-new', name: 'New Debit', type: 'chequing', createdAt: '2026-01-02T00:00:00Z' },
        { id: 'credit-old', name: 'Old Credit', type: 'credit', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'other', name: 'Other', type: 'other', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'saving-old', name: 'Old Saving', type: 'saving', createdAt: '2025-12-31T00:00:00Z' },
        { id: 'debit-old', name: 'Old Debit', type: 'chequing', createdAt: '2026-01-01T00:00:00Z' }
    ];
    view.plugin = plugin(accounts);
    view.plugin.transactionsData = { accounts };
    view.plugin.getAccounts = PersistencePlugin.prototype.getAccounts;
    const before = JSON.stringify(accounts);
    view.renderSummary(root);
    assert.deepEqual(root.querySelectorAll('.expensica-card-title').map(title => modalText(title).trim()),
        ['Old Debit', 'New Debit', 'Old Saving', 'New Saving', 'Old Credit', 'New Credit', 'Other', 'Default']);
    assert.equal(JSON.stringify(accounts), before);
    view.unload();
});

test('Account Balances renders debit, saving, credit and default icons, compact trends and account edit actions', () => {
    const { view, root } = cashFlowHarness();
    const accounts = [
        { id: 'cash', name: 'Cash', type: 'chequing', color: '#123456' },
        { id: 'save', name: 'Reserve', type: 'saving', color: '#345678' },
        { id: 'card', name: 'Visa', type: 'credit', color: '#567890' },
        { id: 'default', name: 'Default', type: 'other', isDefault: true, color: '#789012' }
    ];
    view.plugin = plugin(accounts);
    const opened = [];
    view.plugin.openTransactionsView = () => assert.fail('account card must not open transaction search');
    view.switchDashboardTab = () => assert.fail('account editing must not switch tabs');
    view.openAccountEditor = id => opened.push(id);
    view.plugin.transactions = accounts.flatMap(account => ['2026-09-01', '2026-10-01'].map((date, index) => ({
        id: account.id + index, date, type: 'income', amount: 100, account: `${account.type}-${account.name.toLowerCase()}`
    })));
    const before = JSON.stringify(view.plugin.transactions);
    view.renderSummary(root);
    const panel = root.querySelector('.expensica-account-balances-panel');
    assert.equal(modalText(panel.querySelector('.expensica-chart-title')).trim(), 'Accounts & Balances');
    assert.equal(panel.querySelector('.expensica-chart-range-buttons'), null);
    const cards = panel.querySelectorAll('.expensica-overview-card-balance');
    cards.forEach((card, index) => {
        const title = card.querySelector('.expensica-card-title');
        assert.equal(modalText(title).trim(), accounts[index].name);
        assert.equal(title.style.color, undefined);
        assert.equal(title.querySelector('.expensica-ui-icon').style.color, accounts[index].color);
        const expectedIcon = new Element();
        models.renderUiIcon(expectedIcon, models.getAccountIcon(accounts[index].type), '', accounts[index].color);
        const shapes = svg => svg.children.map(child => ({ tag: child.tag, attrs: child.attrs }));
        assert.deepEqual(shapes(title.querySelector('svg')), shapes(expectedIcon.querySelector('svg')), 'uses the existing account SVG');
        const amount = card.querySelector('.expensica-card-value');
        assert.equal(modalText(amount).trim(), index === 2 ? '-$200.00' : '$200.00');
        assert.equal(amount.style.color, accounts[index].color);
        const pill = card.querySelector('.expensica-card-trend');
        assert.deepEqual(card.children, [title, amount, pill]);
        assert.equal(modalText(pill).trim(), '$100.00');
        assert.match(pill.attrs['aria-label'], /from Sep, 2026\.$/);
        assert.equal(pill.attrs.title, undefined);
        assert.ok(pill.querySelector('.expensica-card-trend-indicator').hasClass('is-positive'), 'falling credit debt is good news');
        assert.equal(card.attrs.tabindex, '0');
        assert.ok(card.attrs['aria-label'].startsWith(`Your ${accounts[index].name} balance is `));
        assert.equal(card.attrs['aria-description'], 'Edit account');
        const beforeFocus = focusedTooltips.length;
        card.dispatchEvent({ type: 'focus' });
        assert.equal(focusedTooltips.length, beforeFocus + 1, 'account tooltip is keyboard accessible');
        pill.dispatchEvent({ type: 'focus' });
        assert.equal(focusedTooltips.at(-1).text, pill.attrs['aria-label']);
        assert.equal(focusedTooltips.at(-1).options.classes[0], 'expensica-chart-tooltip');
        card.click();
        for (const key of ['Enter', ' ']) card.dispatchEvent({ type: 'keydown', key, preventDefault() {} });
        assert.deepEqual(opened.slice(-3), Array(3).fill(accounts[index].id));
    });
    assert.equal(JSON.stringify(view.plugin.transactions), before);
    view.unload();
});

test('Account Balances footer uses signed positions including overdrafts and credit prepayments', () => {
    const { view, root } = cashFlowHarness();
    const accounts = [
        { id: 'cash', name: 'Cash', type: 'chequing', isDefault: true },
        { id: 'save', name: 'Reserve', type: 'saving' },
        { id: 'card', name: 'Visa', type: 'credit' },
        { id: 'prepaid', name: 'Prepaid', type: 'credit' }
    ];
    view.plugin = plugin(accounts);
    view.plugin.transactions = accounts.map((account, index) => ({ id: account.id, date: '2026-10-01',
        account: `${account.type}-${account.name.toLowerCase()}`, type: ['expense', 'income', 'expense', 'income'][index],
        amount: [25, 150, 60, 10][index] }));
    for (const currency of ['USD', 'CAD', 'JPY', 'KWD']) {
        view.plugin.settings.defaultCurrency = currency;
        root.empty(); view.renderSummary(root);
        const footer = root.querySelector('.expensica-account-balances-footer');
        assert.deepEqual(footer.querySelectorAll('.expensica-cash-flow-label').map(el => modalText(el).trim()), ['Assets:', 'Debts:', 'Net Balance:']);
        assert.deepEqual(footer.querySelectorAll('.expensica-card-value').map(el => el.textContent), [160, 85, 75].map(value => models.formatCurrency(value, currency)));
        assert.equal(view.getNetBalanceThrough(view.dateRange.endDate), 75);
        assert.equal(root.querySelectorAll('.expensica-overview-card-balance').flatMap(card => card.querySelectorAll('.expensica-card-trend-indicator')).filter(icon => icon.hasClass('is-negative')).length, 2);
    }
    view.unload();
});

test('Account Balances supports disabled accounts, empty accounts and periods without comparisons', () => {
    const { p, view, root } = cashFlowHarness();
    p.settings.enableAccounts = false;
    view.getPreviousPeriodComparisonRange = () => null;
    view.renderSummary(root);
    assert.equal(root.querySelectorAll('.expensica-overview-card-balance').length, 1);
    assert.equal(modalText(root.querySelector('.expensica-card-title')).trim(), 'Running Balance');
    assert.equal(root.querySelector('.expensica-card-trend'), null);
    assert.deepEqual(root.querySelector('.expensica-account-balances-footer').querySelectorAll('.expensica-card-value').map(el => el.textContent), ['$1,125.00', '$0.00', '$1,125.00']);
    p.settings.enableAccounts = true;
    p.getAccounts = () => [];
    root.empty(); view.renderSummary(root);
    assert.equal(root.querySelectorAll('.expensica-overview-card-balance').length, 0);
    assert.deepEqual(root.querySelector('.expensica-account-balances-footer').querySelectorAll('.expensica-card-value').map(el => el.textContent), ['$0.00', '$0.00', '$0.00']);
    view.unload();
});

test('Account Balances footer omits label SVGs and preserves semantic value colors', () => {
    for (const [assets, debts] of [[0, 0], [100, 0], [0, 100], [100, 100], [50, 75], [150, 25]]) {
        const { view, root } = cashFlowHarness();
        view.plugin = plugin([{ id: 'cash', name: 'Cash', type: 'chequing', isDefault: true },
            { id: 'card', name: 'Card', type: 'credit' }]);
        view.plugin.transactions = [
            { id: 'assets', date: '2026-10-01', type: 'income', amount: assets, account: 'chequing-cash' },
            { id: 'debts', date: '2026-10-01', type: 'expense', amount: debts, account: 'credit-card' }
        ];
        view.renderSummary(root);
        const stats = root.querySelector('.expensica-account-balances-footer').children;
        assert.deepEqual(stats.map(stat => modalText(stat.querySelector('.expensica-cash-flow-label')).trim()), ['Assets:', 'Debts:', 'Net Balance:']);
        const net = assets - debts;
        assert.deepEqual(stats.map(stat => stat.style['--expensica-cash-flow-color']), [
            'var(--text-success)', debts > 0 ? 'var(--text-error)' : 'var(--text-normal)',
            net === 0 ? 'var(--text-normal)' : net > 0 ? 'var(--text-success)' : 'var(--text-error)'
        ]);
        for (const stat of stats) {
            assert.equal(stat.querySelector('.expensica-cash-flow-label').querySelector('svg'), null);
            assert.ok(stat.hasClass('expensica-cash-flow-metric'));
            assert.ok(stat.querySelector('.expensica-cash-flow-label').hasClass('expensica-cash-flow-label'));
            assert.ok(stat.querySelector('.expensica-card-value').hasClass('expensica-card-value'));
            assert.ok(stat.querySelector('.expensica-account-balances-comparison'));
            assert.equal(stat.querySelectorAll('.expensica-card-trend').length, 1);
            assert.ok(stat.children[0].hasClass('expensica-metric-total'));
            assert.ok(stat.children[1].hasClass('expensica-card-trend'));
        }
        view.unload();
    }
});

test('account rows render every account without carousel controls or scroll interception', () => {
    const { view, root } = cashFlowHarness();
    view.renderSummary(root);
    const row = root.querySelector('.expensica-account-balances-row');
    assert.equal(row.children.length, view.plugin.getAccounts().length);
    assert.equal(row.attrs.role, 'region');
    assert.equal(row.attrs.tabindex, undefined);
    assert.equal(root.querySelector('.expensica-account-balances-scroll-button'), null);
    assert.deepEqual(Object.keys(row.listeners), []);
    view.unload();
});

test('Overview places current Account Balances before the combined Cash Flow panel and removes both on tab switches', () => {
    const { view, p } = cashFlowHarness();
    p.getAccounts = () => [];
    Object.assign(view, { renderAccountWarnings() {}, renderPremiumVisualizations() {}, renderExpensesChart() {},
        renderIncomeExpenseChart() {}, renderTransactionsTab() {}, renderAccountsTab() {}, renderBudgetTab() {}, renderCategoriesTab() {},
        updateDashboardChartGridLayout() {}, resizeChartsToContainers() {},
        consumeChartAnimationRequest() {}, clearSelectorListeners() {}, destroyCharts() {},
        rememberScrollPosition() {}, restoreScrollPosition() {} });
    const root = new Element(); root.createDiv('expensica-tabs');
    view.containerEl = { children: [null, root] };
    view.currentTab = 'overview'; view.renderCurrentTabContent(root);
    for (const tab of ['overview', 'transactions', 'accounts', 'budget', 'categories', 'overview']) {
        view.switchDashboardTab(tab);
        assert.equal(root.querySelectorAll('.expensica-cash-flow-panel').length, tab === 'overview' ? 1 : 0, tab);
        assert.equal(root.querySelectorAll('.expensica-account-balances-panel').length, tab === 'overview' ? 1 : 0, tab);
        if (tab === 'overview') {
            const pair = root.querySelector('.expensica-overview-panels');
            assert.equal(root.children[1], pair);
            assert.ok(pair.children[0].hasClass('expensica-account-balances-container'));
            assert.ok(pair.children[1].hasClass('expensica-cash-flow-container'));
            assert.ok(root.hasClass('expensica-overview'));
        } else {
            assert.equal(root.hasClass('expensica-overview'), false);
        }
    }
    view.unload();
});

test('Cash Flow and Categories retain nine synchronized ranges; Transactions uses the global range in populated and empty states', () => {
    const { view } = cashFlowHarness();
    Object.assign(view, { destroyCharts() {}, scheduleChartInitialization() {}, syncChartsAfterCategoryLayoutChange() {},
        renderCategoryChartTypeSelector(container) { container.createDiv('expensica-chart-header'); } });
    for (const empty of [false, true]) {
        if (empty) view.transactions = [];
        for (const method of ['renderCashFlow', 'renderExpensesChart', 'renderIncomeExpenseChart']) {
            const root = new Element(); view[method](root);
            const row = root.querySelector('.expensica-chart-range-buttons');
            if (method === 'renderIncomeExpenseChart') { assert.equal(row, null); continue; }
            assert.equal(row.children.length, 9);
            assert.deepEqual(row.children.map(button => button.textContent), ['TD', '1W', 'LW', '1M', 'LM', '1Y', 'LY', 'All', 'Range']);
            assert.deepEqual(row.children.filter(button => button.hasClass('is-active')).map(button => button.textContent), ['1M']);
        }
    }
});


async function editorOwnershipHarness(entry = 'transactions') {
    animationFrames.length = 0;
    chartTimers.length = 0;
    const h = recoveryHarness();
    h.storage.fail = false;
    const original = { id: '20261015-120000-00000001', date: '2026-10-15', time: '12:00:00',
        type: 'expense', category: 'food', amount: 10, description: 'ORIGINAL', account: 'other-default',
        notes: 'Keep notes', custom: { preserved: true } };
    h.p.transactionsData.transactions = [original, ...[2, 3].map(i => ({ ...original,
        id: `20261015-120000-0000000${i}`, description: `ORIGINAL ${i}` }))];
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: h.p.getAllTransactions(), lastUpdated: 'initial' }));
    await h.p.loadAccountsData();
    await h.p.loadTransactionsData();
    await h.p.loadBudgetData();
    h.storage.writes = 0;
    h.p.renderDataRecoveryWarning = () => {};
    h.p.refreshExpensicaViews = PersistencePlugin.prototype.refreshExpensicaViews;
    h.p.app.workspace.requestSaveLayout = () => {};
    function makeView(tab, month) {
        const { view, effects } = mutationView(h.p);
        Object.assign(view, { app: h.p.app, currentTab: tab,
            containerEl: { children: [null, new Element()] },
            currentDate: new Date(2026, month, 15), selectedCalendarDate: new Date(2026, month, 15),
            dateRange: { type: DateRangeType.CUSTOM, startDate: new Date(2026, month, 1), endDate: new Date(2026, month + 1, 0) },
            isDashboardVisible: () => true,
            async loadTransactionsData() {
                effects.loads++;
                await ExpensicaDashboardView.prototype.loadTransactionsData.call(this);
            },
            renderDashboard() {
                effects.renders++;
                if (this.currentTab === 'transactions') h.p.renderDashboardTransactionsTab(this, content());
            }
        });
        view.loadTransactionsForDateRange();
        return { view, effects };
    }
    const other = makeView('overview', 8);
    const owner = makeView(entry === 'transactions' ? 'transactions' : 'overview', 9);
    h.p.app.workspace.getLeavesOfType = () => [other, owner].map(({ view }) => ({ view }));
    function content() { return Object.assign(new Element(), { isConnected: true, scrollTop: 0 }); }
    h.p.renderDashboardTransactionsTab(owner.view, content());
    const renderer = h.p.dashboardTransactionsViews.get(owner.view);
    renderer.dateRange = { ...owner.view.dateRange };
    renderer.searchQuery = 'original';
    renderer.selectedTypeFilters = ['expense'];
    renderer.selectedCategoryIds = ['food'];
    renderer.selectedAccountReferences = ['other-default'];
    renderer.pageSize = 1;
    renderer.currentPage = 2;
    renderer.selectedTransactionIds.add(original.id);
    renderer.embeddedContentEl.scrollTop = 144;
    renderer.loadTransactionsData(false);
    flushEditorFrames();
    renderer.embeddedContentEl.scrollTop = 144;
    const openEditor = () => {
        if (entry === 'transactions') {
            renderer.renderTransactionCardWithEditHandler(new Element(), original, '$10');
            transactionCards.at(-1).onEdit(original);
        } else if (entry === 'calendar') {
            owner.view.renderPremiumVisualizations(new Element());
            calendars.at(-1).onEdit(original);
        } else {
            h.p.renderDailyReviewTransactions(content(), owner.view.selectedCalendarDate,
                transaction => owner.view.openTransactionModal(transaction));
            transactionCards.findLast(card => card.transaction.id === original.id).onEdit(original);
        }
        return shownModals.at(-1);
    };
    return { ...h, original, other, owner, renderer, openEditor };
}

for (const entry of ['daily review', 'transactions', 'calendar']) {
    for (const operation of ['add', 'edit', 'delete']) {
        test(`${entry} transaction ${operation} belongs to its containing dashboard and refreshes each dashboard once`, async () => {
            const h = await editorOwnershipHarness(entry);
            const editor = operation === 'add' ? new TransactionModal(h.p.app, h.p, h.owner.view) : h.openEditor();
            if (operation === 'add') {
                editor.open();
                assert.equal(editor.contentEl.querySelector('[name="date"]').value, '2026-10-15');
            }
            assert.equal(editor.editorHost || editor.dashboardView, h.owner.view);
            if (operation === 'delete') {
                await press(editor, 'Delete');
                assert.ok(!editor.closed);
                await press(shownModals.at(-1), 'Delete');
            } else {
                editor.contentEl.querySelector('#description').value = 'ORIGINAL EDITED';
                editor.contentEl.querySelector('#amount').value = '25';
                await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
            }
            flushEditorFrames();
            assert.equal(editor.closed, true);
            assert.equal(h.p.hasSaveFailure(editor), false);
            assert.equal(h.storage.writes, 1);
            for (const { effects } of [h.owner, h.other]) assert.deepEqual(effects, { loads: 1, renders: 1 });
            const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
            assert.equal(rows.length, operation === 'add' ? 4 : operation === 'delete' ? 2 : 3);
            if (operation === 'edit') {
                const saved = rows.find(row => row.id === h.original.id);
                assert.equal(saved.description, 'ORIGINAL EDITED');
                assert.equal(saved.notes, 'Keep notes');
                assert.deepEqual(saved.custom, { preserved: true });
            }
            assert.equal(h.owner.view.currentTab, entry === 'transactions' ? 'transactions' : 'overview');
            assert.equal(h.owner.view.selectedCalendarDate.getDate(), 15);
            assert.equal(h.other.view.selectedCalendarDate.getMonth(), 8);
            assert.equal(h.renderer.searchQuery, 'original');
            assert.deepEqual(Array.from(h.renderer.selectedCategoryIds), ['food']);
            assert.deepEqual(Array.from(h.renderer.selectedTypeFilters), ['expense']);
            assert.deepEqual(Array.from(h.renderer.selectedAccountReferences), ['other-default']);
            assert.equal(h.renderer.currentPage, 2);
            assert.equal(h.renderer.pageSize, 1);
            assert.equal(h.renderer.embeddedContentEl.scrollTop, 144);
            assert.equal(h.p.dashboardTransactionsViews.get(h.owner.view), h.renderer);
        });
    }
}

for (const operation of ['add', 'edit', 'delete']) {
    test(`transaction ${operation} keeps its editor, P0 recovery and source ownership after a failed save`, async () => {
        const h = await editorOwnershipHarness();
        const editor = operation === 'add' ? new TransactionModal(h.p.app, h.p, h.owner.view) : h.openEditor();
        if (operation === 'add') editor.open();
        h.storage.fail = true;
        const before = h.files.get(h.p.transactionsFilePath), memory = JSON.stringify(h.p.getAllTransactions());
        let saveOwner = editor;
        if (operation === 'delete') {
            await press(editor, 'Delete');
            saveOwner = shownModals.at(-1);
            await press(saveOwner, 'Delete');
        } else {
            editor.contentEl.querySelector('#description').value = 'ORIGINAL DRAFT';
            editor.contentEl.querySelector('#amount').value = '25';
            await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
        }
        assert.equal(h.files.get(h.p.transactionsFilePath), before);
        assert.equal(JSON.stringify(h.p.getAllTransactions()), memory);
        assert.ok(!editor.closed);
        assert.equal(h.p.hasSaveFailure(saveOwner), true);
        for (const { effects } of [h.owner, h.other]) assert.deepEqual(effects, { loads: 0, renders: 0 });
        if (operation !== 'delete') {
            assert.equal(editor.contentEl.querySelector('#description').value, 'ORIGINAL DRAFT');
            assert.equal(editor.contentEl.querySelector('#notes').value, operation === 'edit' ? 'Keep notes' : '');
            editor.contentEl.querySelector('#description').value = 'ORIGINAL RETRIED';
        }
        h.storage.fail = false;
        await press(shownModals.at(-1), 'Retry');
        assert.equal(editor.closed, true);
        assert.equal(h.p.hasSaveFailure(saveOwner), false);
        for (const { effects } of [h.owner, h.other]) assert.deepEqual(effects, { loads: 1, renders: 1 });
        const rows = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.equal(rows.length, operation === 'add' ? 4 : operation === 'delete' ? 2 : 3);
        if (operation !== 'delete') assert.ok(rows.some(row => row.description === 'ORIGINAL RETRIED'));
    });
}

test('transaction editor accepts a narrow host and keeps delete callbacks in their existing order', async () => {
    const h = await editorOwnershipHarness();
    const calls = [];
    const host = {
        getDefaultTransactionDate: () => new Date(2026, 9, 22),
        addTransaction: transaction => h.owner.view.addTransaction(transaction),
        updateTransaction: transaction => h.owner.view.updateTransaction(transaction),
        deleteTransaction: (id, onDeleted, onConfirmed) => h.owner.view.deleteTransaction(id,
            () => { calls.push('deleted'); onDeleted(); },
            () => { calls.push('confirmed'); onConfirmed(); })
    };
    const editor = new TransactionModal(h.p.app, h.p, host, h.original);
    editor.open();
    await press(editor, 'Delete');
    await press(shownModals.at(-1), 'Delete');
    assert.deepEqual(calls, ['confirmed', 'deleted']);
    assert.equal(editor.closed, true);
});


test('an open transaction editor retains its owner when dashboards reorder and its source tab changes', async () => {
    const h = await editorOwnershipHarness();
    const editor = h.openEditor();
    h.p.app.workspace.getLeavesOfType = () => [h.owner, h.other].map(({ view }) => ({ view }));
    h.owner.view.currentTab = 'overview';
    editor.contentEl.querySelector('#description').value = 'ORIGINAL AFTER NAVIGATION';
    await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
    assert.equal(editor.closed, true);
    assert.equal(h.owner.view.currentTab, 'overview');
    for (const { effects } of [h.owner, h.other]) assert.deepEqual(effects, { loads: 1, renders: 1 });
    assert.equal(h.p.getAllTransactions()[0].description, 'ORIGINAL AFTER NAVIGATION');
    assert.equal(h.renderer.searchQuery, 'original');
    assert.equal(h.renderer.currentPage, 2);
});

test('a sibling dashboard refresh exception does not turn a committed transaction edit into recovery', async () => {
    const h = await editorOwnershipHarness();
    const editor = h.openEditor();
    h.other.view.renderDashboard = () => { throw new Error('Sibling render failed'); };
    editor.contentEl.querySelector('#description').value = 'ORIGINAL COMMITTED';
    const count = shownModals.length;
    await editor.contentEl.querySelector('form').listeners.submit[0]({ preventDefault() {} });
    assert.equal(editor.closed, true);
    assert.equal(h.storage.writes, 1);
    assert.equal(h.p.hasSaveFailure(editor), false);
    assert.equal(shownModals.length, count);
    assert.deepEqual(h.owner.effects, { loads: 1, renders: 1 });
});

test('cancelling transaction deletion keeps its source editor and performs no write or refresh', async () => {
    const h = await editorOwnershipHarness();
    const editor = h.openEditor();
    await press(editor, 'Delete');
    await press(shownModals.at(-1), 'Cancel');
    assert.ok(!editor.closed);
    assert.equal(h.storage.writes, 0);
    assert.equal(h.p.getAllTransactions().length, 3);
    for (const { effects } of [h.owner, h.other]) assert.deepEqual(effects, { loads: 0, renders: 0 });
});
