const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { Component } = require('./fixtures/obsidian-component.cjs');

const compiled = new Map();
function load(filename, dependencies = {}, globals = {}) {
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText);
    const exports = {};
    vm.runInNewContext(compiled.get(filename), { exports, Date, Intl, console, ...globals,
        require: name => dependencies[name] || (name.endsWith('/account-calculations') ? load('src/account-calculations.ts', { './models': dependencies['./models'] || dependencies['../models'] }) : undefined) || {} });
    return exports;
}
const models = load('src/models.ts');

function setup() {
    let nextId = 0;
    const timers = new Map(), frames = new Map();
    const effects = { layout: 0, focus: 0, scroll: 0, detached: 0 };
    const clock = {
        setTimeout(callback) { const id = nextId++; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        pending: () => timers.size + frames.size,
        callbacks: () => [...timers.values(), ...frames.values()],
        flush() {
            for (const queue of [timers, frames]) for (const [id, callback] of [...queue]) {
                if (!queue.has(id)) continue;
                queue.delete(id); callback();
            }
        }
    };
    class Element {
        constructor(tag = 'div', options = {}) {
            if (typeof options === 'string') options = { cls: options };
            this.tag = tag; this.attrs = { ...options.attr }; this.classes = new Set((options.cls || '').split(' '));
            this.children = []; this.listeners = {}; this.textContent = options.text || ''; this._scrollTop = 0;
        }
        get isConnected() { return this.root || !!this.parentElement?.isConnected; }
        get childElementCount() { return this.children.length; }
        get classList() { return { contains: name => this.classes.has(name), toggle() {} }; }
        get scrollTop() { return this._scrollTop; }
        set scrollTop(value) { this.check(); effects.scroll++; this._scrollTop = value; }
        check() { if (!this.isConnected) effects.detached++; }
        createEl(tag, options) {
            this.check(); const child = new Element(tag, options); child.parentElement = this; this.children.push(child); return child;
        }
        createDiv(options) { return this.createEl('div', options); }
        createSpan(options) { return this.createEl('span', options); }
        addClass(name) { this.check(); this.classes.add(name); }
        removeClass(name) { this.check(); this.classes.delete(name); }
        toggleClass(name, active) { active ? this.addClass(name) : this.removeClass(name); }
        matches(selector) { return selector[0] === '.' ? this.classes.has(selector.slice(1))
            : selector[0] === '#' ? this.attrs.id === selector.slice(1) : this.tag === selector; }
        querySelectorAll(selector) {
            this.check(); return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
        emit(name) { for (const callback of this.listeners[name] || []) callback({ target: this, stopPropagation() {} }); }
        focus() { this.check(); effects.focus++; }
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
        empty() { this.check(); for (const child of [...this.children]) child.remove(); }
    }
    const document = { body: new Element() }; document.body.root = true;
    const app = { workspace: { requestSaveLayout() { effects.layout++; } } };
    class ItemView extends Component {
        constructor() { super(); this.app = app; this.containerEl = document.body.createDiv(); this.containerEl.createDiv(); this.containerEl.createDiv(); }
    }
    const obsidian = { Component, ItemView, Modal: class {}, Plugin: class {}, PluginSettingTab: class {} };
    const globals = { ...clock, window: { ...clock, removeEventListener() {} } };
    const dashboard = load('src/dashboard-view.ts', { './models': models, obsidian,
        'chart.js': { Tooltip: { positioners: {} } } }, globals);
    const { ExpensicaTransactionsView } = load('src/transactions-view.ts', { './models': models, obsidian,
        './dashboard-view': dashboard }, globals);
    class Renderer extends ExpensicaTransactionsView {
        constructor(...args) { super(...args); this.effects = { loads: 0, renders: 0 }; }
        loadTransactionsData(...args) { this.effects.loads++; return super.loadTransactionsData(...args); }
        renderTransactionStatsHeader() {}
        renderCategoryFilter() {}
        renderSelectedFilterChips() {}
        renderPagination(container) { container.createDiv('expensica-pagination'); }
        renderTransactionsList(container) { this.effects.renders++; container.createDiv('expensica-transactions-section'); }
    }
    const { default: Plugin } = load('main.ts', { './src/models': models, obsidian,
        './src/dashboard-view': dashboard, './src/transactions-view': { ExpensicaTransactionsView: Renderer } }, globals);
    const plugin = new Plugin();
    plugin.app = app;
    plugin.settings = { defaultCurrency: 'USD', enableAccounts: false, enableBudgeting: true,
        categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    plugin.transactionsData = { accounts: [models.DEFAULT_ACCOUNT], lastUpdated: 'original', transactions: ['COFFEE', 'RENT'].map((description, index) => ({
        id: `original-${index}`, date: models.formatDate(new Date()), time: '12:00:00', type: 'expense', amount: 1.234,
        description, category: 'food', account: 'other-default'
    })) };
    plugin.renderDataRecoveryWarning = () => {};
    function view() {
        const instance = new dashboard.ExpensicaDashboardView({}, plugin);
        Object.assign(instance, { currentTab: 'transactions', consumeChartAnimationRequest() {}, persistDashboardState() {},
            rememberScrollPosition() {}, restoreScrollPosition() {},
            renderHeader(container) { container.createDiv('header'); },
            renderTabNavigation(container) { container.createDiv('expensica-tabs'); },
            renderOverviewTab(container) { container.createDiv('overview'); }, updateActiveTabButtons() {}
        });
        instance.renderDashboard();
        return instance;
    }
    const renderer = view => plugin.dashboardTransactionsViews.get(view);
    const root = view => view.containerEl.children[1];
    function type(view, value) {
        const input = root(view).querySelector('#expensica-search-input');
        input.value = value; input.emit('input');
    }
    const snapshot = view => ({ ...effects, ...renderer(view).effects });
    return { view, renderer, root, type, clock, timers, frames, effects, snapshot, plugin };
}

test('rapid typing debounces once and preserves normal filtering, layout, rendering, and focus', () => {
    const h = setup(), view = h.view(), renderer = h.renderer(view);
    h.clock.flush();
    const before = h.snapshot(view), ledger = JSON.stringify(h.plugin.transactionsData);
    for (const query of ['c', 'co', 'coffee']) h.type(view, query);
    assert.equal(h.timers.size, 1);
    h.clock.flush();
    assert.deepEqual(Array.from(renderer.filteredTransactions, row => row.description), ['COFFEE']);
    assert.equal(renderer.effects.loads, before.loads + 1);
    assert.equal(renderer.effects.renders, before.renders + 1);
    assert.equal(h.effects.layout, before.layout + 1);
    assert.equal(h.effects.focus, before.focus + 1);
    assert.equal(h.effects.detached, 0);
    assert.equal(h.clock.pending(), 0);
    assert.equal(JSON.stringify(h.plugin.transactionsData), ledger);
});

test('tab removal cancels rapid searches before controls detach and inactive methods do no work', () => {
    const h = setup(), view = h.view(), renderer = h.renderer(view);
    h.clock.flush();
    for (const query of ['c', 'co', 'coffee']) h.type(view, query);
    const stale = h.clock.callbacks();
    view.switchDashboardTab('overview');
    assert.equal(renderer.embeddedContentEl, null);
    assert.equal(renderer.inputFocused, false);
    assert.equal(h.clock.pending(), 0);
    const before = h.snapshot(view);
    for (const callback of stale) callback();
    renderer.updateSearchResults(); renderer.persistTransactionsState(); renderer.refreshTransactionsListOnly(); renderer.restoreScrollPosition();
    h.clock.flush();
    assert.deepEqual(h.snapshot(view), before);
});

test('dashboard close cancels search, delayed focus, and scroll frames, even already-queued callbacks', async () => {
    const h = setup(), view = h.view(), renderer = h.renderer(view);
    renderer.inputFocused = true;
    renderer.renderDashboardTab(h.root(view), true);
    h.type(view, 'coffee');
    assert.equal(h.timers.size, 2);
    assert.equal(h.frames.size, 1);
    const stale = h.clock.callbacks();
    await view.onClose();
    view.containerEl.remove();
    assert.equal(renderer.embeddedContentEl, null);
    assert.equal(h.clock.pending(), 0);
    const before = h.snapshot(view);
    for (const callback of stale) callback();
    h.clock.flush();
    assert.deepEqual(h.snapshot(view), before);
});

for (const method of ['renderDashboard', 'refreshCurrentTabContent']) {
    test(`${method} deactivates search before replacing content in the same container`, () => {
        const h = setup(), view = h.view();
        h.clock.flush(); h.type(view, 'coffee');
        const stale = h.clock.callbacks();
        view[method](); h.clock.flush();
        const before = h.snapshot(view);
        for (const callback of stale) callback();
        assert.deepEqual(h.snapshot(view), before);
        assert.equal(h.renderer(view).searchQuery, 'coffee');
        assert.equal(h.clock.pending(), 0);
        assert.equal(view.cleanups.length, 1, 'parent cleanup is registered only once per renderer');
    });
}

test('reopening preserves filters and a stale callback cannot cancel or run a newer search', () => {
    const h = setup(), view = h.view(), renderer = h.renderer(view);
    h.clock.flush(); h.type(view, 'coffee');
    const stale = h.clock.callbacks();
    renderer.selectedTypeFilters = ['expense'];
    view.switchDashboardTab('overview'); view.switchDashboardTab('transactions');
    assert.equal(h.renderer(view), renderer);
    assert.equal(renderer.searchQuery, 'coffee');
    assert.deepEqual(Array.from(renderer.selectedTypeFilters), ['expense']);
    h.type(view, 'rent');
    const id = renderer._debounceTimeout, before = h.snapshot(view);
    for (const callback of stale) callback();
    assert.deepEqual(h.snapshot(view), before);
    assert.equal(renderer._debounceTimeout, id);
    h.clock.flush();
    assert.deepEqual(Array.from(renderer.filteredTransactions, row => row.description), ['RENT']);
    assert.equal(h.clock.pending(), 0);
});

test('repeated immediate opens/closes leave no callbacks or detached operations', async () => {
    const h = setup();
    for (let cycle = 0; cycle < 30; cycle++) {
        const view = h.view(), renderer = h.renderer(view);
        h.type(view, 'coffee');
        const stale = h.clock.callbacks();
        await view.onClose(); await view.onClose();
        view.containerEl.remove();
        assert.equal(renderer.embeddedContentEl, null);
        assert.equal(h.clock.pending(), 0);
        const before = h.snapshot(view);
        for (const callback of stale) callback();
        h.clock.flush();
        assert.deepEqual(h.snapshot(view), before);
    }
    assert.equal(h.effects.detached, 0);
    assert.equal(h.effects.layout, 0);
    assert.equal(h.effects.focus, 0);
});

test('closing one dashboard leaves another dashboard search independent and active', async () => {
    const h = setup(), first = h.view(), second = h.view();
    h.clock.flush(); h.type(first, 'coffee'); h.type(second, 'rent');
    await first.onClose(); first.containerEl.remove();
    assert.equal(h.timers.size, 1);
    const closed = { ...h.renderer(first).effects };
    h.clock.flush();
    assert.deepEqual(h.renderer(first).effects, closed);
    assert.deepEqual(Array.from(h.renderer(second).filteredTransactions, row => row.description), ['RENT']);
    assert.equal(h.effects.focus, 1);
    assert.equal(h.effects.layout, 1);
    assert.equal(h.effects.detached, 0);
    assert.equal(h.clock.pending(), 0);
});

test('parent component unload also deactivates its cached renderer', () => {
    const h = setup(), view = h.view();
    h.type(view, 'coffee');
    const stale = h.clock.callbacks();
    view.unload(); view.containerEl.remove();
    assert.equal(h.renderer(view).embeddedContentEl, null);
    assert.equal(h.clock.pending(), 0);
    const before = h.snapshot(view);
    for (const callback of stale) callback();
    h.clock.flush();
    assert.deepEqual(h.snapshot(view), before);
});
