const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { Component } = require('./fixtures/obsidian-component.cjs');

class Document {
    constructor() { this.listeners = new Map(); this.body = new Element(this); this.body.root = true; }
    addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.onRemove?.(); this.listeners.get(type)?.delete(callback); }
    fire(target = this.body, type = 'click') {
        for (const callback of [...(this.listeners.get(type) || [])]) {
            if (this.listeners.get(type).has(callback)) callback({ type, target });
        }
    }
    count(type = 'click') { return this.listeners.get(type)?.size || 0; }
    createElementNS(namespace, tag) { return new Element(this, tag); }
    createTextNode(text) { return new Element(this, 'text', { text }); }
}
class Element {
    constructor(doc, tag = 'div', options = {}) {
        if (typeof options === 'string') options = { cls: options };
        this.ownerDocument = doc; this.tag = tag; this.children = []; this.listeners = new Map();
        this.classes = new Set((options.cls || '').split(' ')); this.attrs = { ...options.attr };
        this.textContent = options.text || ''; this.scrollTop = 0;
    }
    get isConnected() { return this.root || !!this.parentElement?.isConnected; }
    get childElementCount() { return this.children.length; }
    get classList() { return { contains: name => this.hasClass(name), add: name => this.addClass(name), remove: name => this.removeClass(name) }; }
    addClass(name) { this.classes.add(name); }
    removeClass(name) { this.classes.delete(name); }
    hasClass(name) { return this.classes.has(name); }
    toggleClass(name, active) { active ? this.addClass(name) : this.removeClass(name); }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    createEl(tag, options) { return this.appendChild(new Element(this.ownerDocument, tag, options)); }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
    }
    empty() { for (const child of [...this.children]) child.remove(); }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    matches(selector) { return selector.startsWith('.') ? this.hasClass(selector.slice(1)) : this.tag === selector; }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(callback);
    }
    async click() {
        const results = [];
        const event = { target: this, type: 'click' };
        for (let element = this; element; element = element.parentElement) {
            for (const callback of element.listeners.get('click') || []) results.push(callback(event));
        }
        this.ownerDocument.fire(this);
        await Promise.all(results);
    }
}

const compiled = new Map();
function load(filename, dependencies = {}, globals = {}) {
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText);
    const exports = {};
    vm.runInNewContext(compiled.get(filename), { exports, Date, Intl, console, ...globals,
        require: name => dependencies[name] || {}
    });
    return exports;
}
const models = load('src/models.ts');
function setup() {
    const doc = new Document();
    let unrelated = 0;
    const external = () => { unrelated++; };
    doc.addEventListener('click', external);
    doc.addEventListener('keydown', external);
    class ItemView extends Component {
        constructor() {
            super();
            this.containerEl = doc.body.createDiv();
            this.containerEl.createDiv(); this.containerEl.createDiv();
        }
    }
    const { ExpensicaDashboardView, DashboardTab } = load('src/dashboard-view.ts', {
        './models': models, obsidian: { Component, ItemView, Modal: class {}, setIcon() {} },
        'chart.js': { Tooltip: { positioners: {} } }
    }, { document: doc, window: { removeEventListener() {}, clearTimeout() {}, cancelAnimationFrame() {} } });
    const plugin = { settings: { enableAccounts: true, enableBudgeting: true }, renderDataRecoveryWarning() {} };
    function view() {
        const instance = new ExpensicaDashboardView({}, plugin);
        const counts = { saves: 0, changes: 0 };
        Object.assign(instance, {
            counts, consumeChartAnimationRequest() {}, rememberScrollPosition() {}, restoreScrollPosition() {},
            persistDashboardState() { counts.saves++; },
            clearDashboardChartPanelHeights() {}, clearCategoryChartMeasurements() {}, clearIncomeExpenseChartLayoutConstraints() {},
            renderExpensesChart(container) {
                this.renderCategoryChartTypeSelector(container, () => { counts.changes++; this.refreshCategoryChartOnly(); });
            },
            renderOverviewTab(container) { this.renderExpensesChart(container.createDiv('expensica-expenses-chart-container')); },
            renderCategoriesTab(container) {
                this.renderCategoryChartTypeSelector(container, () => { counts.changes++; this.refreshCurrentTabContent(); });
            },
            renderBudgetTab(container) { container.createDiv('budget-content'); },
            async applyDateRangeSelection(type) {
                this.dateRange = { ...this.dateRange, type, label: `Selected ${type}` };
                this.renderDashboard();
            }
        });
        instance.renderDashboard();
        return instance;
    }
    return { doc, view, DashboardTab, baseline: 1, unrelated: () => unrelated, external };
}
const root = view => view.containerEl.children[1];
const controls = view => ({
    date: root(view).querySelector('.shadcn-date-range-current'),
    dateMenu: root(view).querySelector('.shadcn-date-range-options'),
    category: root(view).querySelector('.expensica-chart-type-current'),
    categoryMenu: root(view).querySelector('.expensica-chart-type-options')
});

test('repeated dashboard renders keep two current listeners and teardown returns to baseline', async () => {
    const h = setup();
    const view = h.view();
    for (let i = 0; i < 30; i++) {
        view.renderDashboard();
        assert.equal(h.doc.count(), h.baseline + 2);
        assert.equal(view.children.length, 2, 'obsolete child lifecycles are removed');
    }
    await view.onClose();
    await view.onClose();
    assert.equal(h.doc.count(), h.baseline);
    assert.equal(h.doc.count('keydown'), 1);
    assert.equal(view.children.length, 0);
    assert.equal(view.dateRangeSelectorComponent, null);
    assert.equal(view.categoryChartTypeSelectorComponent, null);
    h.doc.fire(); h.doc.fire(h.doc.body, 'keydown');
    assert.equal(h.unrelated(), 2);
});

test('obsolete controls no longer respond to document clicks after replacement', async () => {
    const h = setup();
    const view = h.view();
    const old = controls(view);
    await old.date.click(); await old.category.click();
    old.dateMenu.removeClass('shadcn-date-range-hidden');
    view.renderDashboard();
    assert.equal(old.date.isConnected, false);
    const current = controls(view);
    await current.date.click(); await current.category.click();
    h.doc.fire();
    assert.equal(current.dateMenu.hasClass('shadcn-date-range-hidden'), true);
    assert.equal(current.categoryMenu.hasClass('shadcn-date-range-hidden'), true);
    assert.equal(old.dateMenu.hasClass('shadcn-date-range-hidden'), false);
    assert.equal(old.categoryMenu.hasClass('shadcn-date-range-hidden'), false);
    await view.onClose();
});

test('date selector preserves toggle, inside click, outside dismissal and selection behavior', async () => {
    const h = setup();
    const view = h.view();
    const current = controls(view);
    await current.date.click();
    assert.equal(current.dateMenu.hasClass('shadcn-date-range-hidden'), false);
    h.doc.fire(current.date);
    assert.equal(current.dateMenu.hasClass('shadcn-date-range-hidden'), false);
    h.doc.fire();
    assert.equal(current.dateMenu.hasClass('shadcn-date-range-hidden'), true);
    await current.date.click();
    await current.dateMenu.querySelector('.shadcn-date-range-option').click();
    assert.equal(view.dateRange.type, 'today');
    assert.equal(controls(view).dateMenu.hasClass('shadcn-date-range-hidden'), true);
    assert.equal(h.doc.count(), h.baseline + 2);
    await view.onClose();
});

test('category selector closes unchanged options and refreshes changed options once', async () => {
    const h = setup();
    const view = h.view();
    let current = controls(view);
    await current.category.click();
    assert.equal(current.category.getAttribute('aria-expanded'), 'true');
    h.doc.fire(current.category);
    assert.equal(current.category.getAttribute('aria-expanded'), 'true');
    await current.categoryMenu.children[0].click();
    assert.equal(current.category.getAttribute('aria-expanded'), 'false');
    assert.equal(view.counts.changes, 0);
    assert.equal(view.counts.saves, 0);
    await current.category.click();
    await current.categoryMenu.children[1].click();
    assert.equal(view.categoryChartType, 'income');
    assert.equal(view.counts.changes, 1);
    assert.equal(view.counts.saves, 1);
    current = controls(view);
    await current.category.click();
    h.doc.fire();
    assert.equal(current.category.getAttribute('aria-expanded'), 'false');
    assert.equal(h.doc.count(), h.baseline + 2);
    await view.onClose();
});

test('switching tabs removes category listeners and preserves the header selector', async () => {
    const h = setup();
    const view = h.view();
    const date = controls(view).date;
    for (let i = 0; i < 15; i++) {
        view.switchDashboardTab(h.DashboardTab.BUDGET);
        assert.equal(h.doc.count(), h.baseline + 1);
        assert.equal(controls(view).date, date);
        view.switchDashboardTab(h.DashboardTab.CATEGORIES);
        assert.equal(h.doc.count(), h.baseline + 2);
    }
    await view.onClose();
    assert.equal(h.doc.count(), h.baseline);
});

test('partial category and tab renders replace only the category listener', async () => {
    const h = setup();
    const view = h.view();
    const date = controls(view).date;
    for (let i = 0; i < 20; i++) {
        view.refreshCategoryChartOnly();
        view.refreshCurrentTabContent();
        assert.equal(h.doc.count(), h.baseline + 2);
        assert.equal(controls(view).date, date);
        assert.equal(view.children.length, 2);
    }
    await view.onClose();
});

test('listeners are removed while old controls are still attached, before DOM replacement', async () => {
    const h = setup();
    const view = h.view();
    let old = controls(view), removals = 0;
    h.doc.onRemove = () => { removals++; assert.equal(old.date.isConnected, true); assert.equal(old.category.isConnected, true); };
    view.renderDashboard();
    assert.equal(removals, 2);
    old = controls(view);
    view.refreshCategoryChartOnly();
    assert.equal(removals, 3);
    old = controls(view);
    view.switchDashboardTab(h.DashboardTab.BUDGET);
    assert.equal(removals, 4);
    h.doc.onRemove = null;
    await view.onClose();
});

test('multiple dashboards dismiss independently and closing one leaves the other listeners intact', async () => {
    const h = setup();
    const first = h.view(), second = h.view();
    assert.equal(h.doc.count(), h.baseline + 4);
    const firstControls = controls(first), secondControls = controls(second);
    await firstControls.date.click();
    assert.equal(firstControls.dateMenu.hasClass('shadcn-date-range-hidden'), false);
    await secondControls.date.click();
    assert.equal(firstControls.dateMenu.hasClass('shadcn-date-range-hidden'), true);
    assert.equal(secondControls.dateMenu.hasClass('shadcn-date-range-hidden'), false);
    await first.onClose();
    assert.equal(h.doc.count(), h.baseline + 2);
    h.doc.fire();
    assert.equal(secondControls.dateMenu.hasClass('shadcn-date-range-hidden'), true);
    await second.onClose();
    assert.equal(h.doc.count(), h.baseline);
    assert.ok(h.doc.listeners.get('click').has(h.external));
});

test('selectors bind outside clicks to their own document, including popout documents', async () => {
    const h = setup();
    const view = h.view();
    const popout = new Document();
    const container = popout.body.createDiv();
    view.renderDateRangeSelector(container);
    view.renderCategoryChartTypeSelector(container, () => {});
    assert.equal(h.doc.count(), h.baseline);
    assert.equal(popout.count(), 2);
    const toggle = container.querySelector('.expensica-chart-type-current');
    await toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    h.doc.fire();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    popout.fire();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    await view.onClose();
    assert.equal(popout.count(), 0);
    assert.equal(h.doc.count(), h.baseline);
});

test('Obsidian component unload also releases listeners without a dashboard close callback', () => {
    const h = setup();
    const view = h.view();
    view.unload();
    assert.equal(h.doc.count(), h.baseline);
    assert.equal(view.children.length, 0);
});
