const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const RealChart = require('chart.js/auto');
const { BasicPlatform, Tooltip } = require('chart.js');
const { Component } = require('./fixtures/obsidian-component.cjs');

class Element {
    constructor(tag = 'div', options = {}) {
        if (typeof options === 'string') options = { cls: options };
        this.tag = tag; this.children = []; this.style = {}; this.classes = new Set((options.cls || '').split(' '));
        this.attrs = options.attr || {}; this.width = 400; this.height = 300;
    }
    get isConnected() { return this.root || !!this.parentElement?.isConnected; }
    get childElementCount() { return this.children.length; }
    get classList() { return { contains: name => this.classes.has(name) }; }
    addClass(name) { this.classes.add(name); }
    removeClass(name) { this.classes.delete(name); }
    toggleClass(name, value) { value ? this.addClass(name) : this.removeClass(name); }
    setText(text) { this.textContent = text; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    addEventListener() {}
    createEl(tag, options) {
        const child = new Element(tag, options);
        child.parentElement = this; this.children.push(child); return child;
    }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [
            ...((selector.startsWith('.') ? child.classes.has(selector.slice(1)) : child.tag === selector) ? [child] : []),
            ...child.querySelectorAll(selector)
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    remove() {
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
    }
    empty() { for (const child of [...this.children]) child.remove(); }
    getContext() {
        return this.context ||= new Proxy({ canvas: this, measureText: text => ({ width: String(text).length * 6 }), getLineDash: () => [] },
            { get: (target, property) => property in target ? target[property] : () => {} });
    }
}
const compiled = new Map();
function load(file, dependencies = {}, globals = {}) {
    if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText);
    const exports = {};
    vm.runInNewContext(compiled.get(file), { exports, Date, Intl, console, ...globals,
        require: name => dependencies[name] || {} });
    return exports;
}
const models = load('src/models.ts');
const keys = ['expensesChart', 'incomeExpenseChart', 'cumulativeExpensesChart'];
function setup(t) {
    const timers = new Map(), frames = new Map(), created = [];
    let nextId = 0;
    const body = new Element(); body.root = true;
    class ItemView extends Component {
        constructor() {
            super(); this.containerEl = body.createDiv();
            this.containerEl.createDiv(); this.containerEl.createDiv();
        }
        registerEvent() {}
    }
    class Chart extends RealChart {
        constructor(canvas, config) {
            super(canvas, { ...config, platform: BasicPlatform }); created.push(this);
        }
    }
    const window = {
        setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
        cancelAnimationFrame: id => frames.delete(id), removeEventListener() {}, addEventListener() {}
    };
    const { ExpensicaDashboardView, DashboardTab } = load('src/dashboard-view.ts', {
        './models': models, obsidian: { Component, ItemView, Modal: class {} },
        'chart.js/auto': { default: Chart }, 'chart.js': { Tooltip }, './categories-cards': { renderCategoryCards() {} }
    }, { window, document: { body }, performance: { now: () => 0 },
        getComputedStyle: () => ({ fontFamily: 'sans-serif', color: '#000', getPropertyValue: () => '' }) });
    const entries = [{ name: 'Food', amount: 12, color: '#888888' }];
    const plugin = { settings: { defaultCurrency: 'USD', enableBudgeting: true }, renderDataRecoveryWarning() {},
        getSharedDateRangeState: () => null };
    function view() {
        const instance = new ExpensicaDashboardView({}, plugin);
        Object.assign(instance, {
            app: { workspace: { on() {} } }, setupPaneResizeObserver() {}, setupThemeObserver() {},
            transactions: [{ type: 'expense', amount: 12 }],
            renderHeader(container) { container.createDiv('header'); },
            renderTabNavigation(container) { container.createDiv('expensica-tabs'); },
            renderAccountWarnings() {}, renderBudgetTab(container) { container.createDiv('budget'); },
            renderCategoryChartTypeSelector() {}, renderChartDateRangeButtons() {}, renderCategoryExpensesLegend() {},
            persistDashboardState() {}, rememberScrollPosition() {}, restoreScrollPosition() {},
            prepareChartCanvasSize() {}, updateCategoryChartLayout() {}, updateDashboardChartGridLayout() {},
            syncChartsAfterCategoryLayoutChange() {}, clearDashboardChartPanelHeights() {},
            clearCategoryChartMeasurements() {}, clearIncomeExpenseChartLayoutConstraints() {}, clearChartCanvasMeasurement() {},
            getCssPixelValue: () => 8, getChartAnimationOptions: () => false, getChartResizeDelay: () => 0,
            getTooltipBackgroundColor: () => '#fff', getTooltipTitleColor: () => '#000',
            getTooltipBodyColor: () => '#000', getTooltipBorderColor: () => '#888',
            adjustColor: color => color, getCurrentCategoryChartData: () => entries,
            getCategoriesTabData: () => entries, getUnusedCategoriesTabData: () => [],
            renderOverviewTab(container) {
                this.renderExpensesChart(container.createDiv('expensica-expenses-chart-container'));
                this.renderIncomeExpenseChart(container.createDiv('expensica-income-expense-chart-container'));
                this.renderCumulativeExpensesChart(container.createDiv('expensica-cumulative-expenses-chart-container'));
            },
            // Keep real Chart.js ownership/disposal while isolating financial calculations covered elsewhere.
            createIncomeExpenseChart(canvas) { this.incomeExpenseChart = new Chart(canvas, { type: 'line', data: { datasets: [] }, options: { responsive: false, animation: false } }); },
            createCumulativeExpensesChart(canvas) { this.cumulativeExpensesChart = new Chart(canvas, { type: 'line', data: { datasets: [] }, options: { responsive: false, animation: false } }); }
        });
        return instance;
    }
    function flush() {
        const pending = [...timers];
        for (const [id, { callback }] of pending) if (timers.delete(id)) callback();
    }
    t.after(() => { for (const chart of created) if (chart.ctx) chart.destroy(); });
    return { view, timers, frames, created, flush, DashboardTab, ExpensicaDashboardView };
}

test('rapid tab switching cancels obsolete initialization and only creates current charts', t => {
    const h = setup(t), view = h.view();
    for (let i = 0; i < 10; i++) {
        view.renderDashboard();
        assert.equal(h.timers.size, 3);
        view.switchDashboardTab(h.DashboardTab.CATEGORIES);
        assert.equal(h.timers.size, 1);
        view.switchDashboardTab(h.DashboardTab.BUDGET);
        assert.equal(h.timers.size, 0);
        view.switchDashboardTab(h.DashboardTab.OVERVIEW);
    }
    h.flush();
    assert.equal(h.created.length, 3);
    for (const key of keys) assert.ok(view[key].canvas.isConnected);
    view.switchDashboardTab(h.DashboardTab.BUDGET);
    for (const chart of h.created) assert.equal(RealChart.getChart(chart.id), undefined);
    for (const key of keys) assert.equal(view[key], null);
});

test('immediate close cancels timers even while canvases are still connected', async t => {
    const h = setup(t), view = h.view();
    view.renderDashboard();
    const callbacks = [...h.timers.values()].map(timer => timer.callback);
    await view.onClose();
    assert.equal(h.timers.size, 0);
    callbacks.forEach(callback => callback());
    assert.equal(h.created.length, 0);
    for (const key of keys) assert.equal(view[key], null);
    await view.onClose();
});

test('closing while initial data loads cannot render charts or attach observers afterward', async t => {
    const h = setup(t), view = h.view();
    let release, observers = 0;
    view.setupPaneResizeObserver = view.setupThemeObserver = () => { observers++; };
    view.loadTransactionsData = () => new Promise(resolve => { release = resolve; });
    const opening = view.onOpen();
    await view.onClose();
    release();
    await opening;
    assert.equal(h.timers.size, 0);
    assert.equal(view.containerEl.querySelectorAll('canvas').length, 0);
    assert.equal(observers, 0);
});

for (const [key, render, selector] of [
    ['expensesChart', 'renderExpensesChart', '.expensica-expenses-chart-container'],
    ['incomeExpenseChart', 'renderIncomeExpenseChart', '.expensica-income-expense-chart-container'],
    ['cumulativeExpensesChart', 'renderCumulativeExpensesChart', '.expensica-cumulative-expenses-chart-container']
]) {
    test(`${key} replacement disposes the existing instance before deferred and empty renders`, t => {
        const h = setup(t), view = h.view();
        view.renderDashboard(); h.flush();
        const old = view[key], others = keys.filter(candidate => candidate !== key).map(candidate => view[candidate]);
        const container = view.containerEl.querySelector(selector);
        container.empty(); view[render](container);
        assert.equal(old.ctx, null);
        assert.equal(RealChart.getChart(old.id), undefined);
        assert.equal(view[key], null);
        h.flush();
        const replacement = view[key];
        assert.ok(replacement.ctx);
        assert.ok(others.every(chart => chart.ctx));
        view.transactions = [];
        container.empty(); view[render](container);
        assert.equal(replacement.ctx, null);
        assert.equal(view[key], null);
        assert.equal([...h.timers.values()].filter(timer => timer.delay === 50).length, 0);
    });
}

test('stale callbacks cannot replace current charts, even after obsolete canvases are reattached', t => {
    const h = setup(t), view = h.view();
    view.renderDashboard();
    const stale = [...h.timers.values()].map(timer => timer.callback);
    const oldContent = [...view.containerEl.children[1].children];
    view.renderDashboard();
    for (const child of oldContent) { child.parentElement = view.containerEl; view.containerEl.children.push(child); }
    stale.forEach(callback => callback());
    assert.equal(h.created.length, 0);
    h.flush();
    const current = keys.map(key => view[key]);
    stale.forEach(callback => callback());
    assert.equal(h.created.length, 3);
    assert.deepEqual(keys.map(key => view[key]), current);
});

test('detached canvases are ignored when initialization becomes runnable', t => {
    const h = setup(t), view = h.view();
    view.renderDashboard();
    for (const canvas of view.containerEl.querySelectorAll('canvas')) canvas.remove();
    h.flush();
    assert.equal(h.created.length, 0);
    assert.equal(h.timers.size, 0);
});

test('connected canvases moved into another dashboard cannot initialize for their previous owner', t => {
    const h = setup(t), view = h.view(), other = h.view();
    view.renderDashboard();
    const canvas = view.containerEl.querySelector('canvas');
    canvas.remove(); canvas.parentElement = other.containerEl; other.containerEl.children.push(canvas);
    assert.ok(canvas.isConnected);
    h.flush();
    assert.equal(view.expensesChart, null);
    assert.equal(h.created.length, 2);
    assert.equal(other.expensesChart, null);
});

for (const refresh of ['refreshCategoryChartOnly', 'refreshIncomeExpenseChartOnly']) {
    test(`${refresh} cancels pending replacements without disposing sibling charts`, t => {
        const h = setup(t), view = h.view();
        view.renderDashboard(); h.flush();
        const key = refresh === 'refreshCategoryChartOnly' ? 'expensesChart' : 'incomeExpenseChart';
        const old = view[key], siblings = keys.filter(candidate => candidate !== key).map(candidate => view[candidate]);
        for (let i = 0; i < 10; i++) view[refresh]();
        assert.equal(old.ctx, null);
        assert.equal([...h.timers.values()].filter(timer => timer.delay === 50).length, 1);
        assert.ok(siblings.every(chart => chart.ctx));
        h.flush();
        assert.ok(view[key].ctx);
        assert.equal(h.created.length, 4);
    });
}

test('closing one dashboard preserves another dashboard timers and chart ownership', async t => {
    const h = setup(t), first = h.view(), second = h.view();
    first.renderDashboard(); second.renderDashboard();
    await first.onClose();
    assert.equal(h.timers.size, 3);
    h.flush();
    assert.equal(h.created.length, 3);
    const charts = keys.map(key => second[key]);
    second.renderDashboard(); h.flush();
    assert.ok(charts.every(chart => chart.ctx === null));
    await first.onClose();
    assert.ok(keys.every(key => second[key].ctx));
    await second.onClose();
    assert.ok(h.created.every(chart => chart.ctx === null));
});

test('tab disposal cancels income hover/toggle frames that retain destroyed charts', t => {
    const h = setup(t), view = h.view();
    view.renderDashboard(); h.flush();
    const chart = view.incomeExpenseChart;
    chart.data.datasets = [{ data: [12], hidden: true }]; chart.update('none');
    view.getIncomeExpenseChartAccounts = () => [];
    view.toggleIncomeExpenseDataset(chart, 0);
    view.replayIncomeExpenseDatasetAnimation(chart, 0);
    const pending = [view.incomeExpenseToggleAnimationFrame, view.incomeExpenseHoverAnimationFrame];
    assert.ok(pending.every(id => h.frames.has(id)));
    view.switchDashboardTab(h.DashboardTab.BUDGET);
    assert.ok(pending.every(id => !h.frames.has(id)));
    assert.equal(chart.ctx, null);
    assert.equal(view.incomeExpenseToggleAnimationFrame, null);
    assert.equal(view.incomeExpenseHoverAnimationFrame, null);
});
