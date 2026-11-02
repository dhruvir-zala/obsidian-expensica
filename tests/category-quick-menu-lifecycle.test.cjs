const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/category-quick-menu.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;

class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, capture = false) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push({ callback, capture });
    }
    removeEventListener(type, callback, capture = false) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.callback !== callback || entry.capture !== capture));
    }
    fire(type, properties = {}) {
        const event = { type, target: this, currentTarget: this, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...properties };
        for (const { callback } of [...(this.listeners.get(type) || [])]) callback(event);
        return event;
    }
    count() { return [...this.listeners.values()].reduce((count, entries) => count + entries.length, 0); }
}

function setup(t) {
    const effects = { focus: 0, select: 0, writes: 0, changes: [], releases: [], saves: [] }, modals = [];
    let nextFrame = 0;
    class Element extends Events {
        constructor(doc, tag = 'div', options = {}) {
            super(); if (typeof options === 'string') options = { cls: options };
            this.ownerDocument = doc; this.tag = tag; this.children = []; this.children.item = index => this.children[index];
            this.className = options.cls || ''; this.attrs = { ...options.attr }; this.style = { setProperty() {} }; this.value = '';
            this.rect = { left: 350, right: 380, top: 40, bottom: 60 };
        }
        get isConnected() { return this === this.ownerDocument.body || !!this.parentElement?.isConnected; }
        createEl(tag, options) { return this.appendChild(new Element(this.ownerDocument, tag, options)); }
        createDiv(options) { return this.createEl('div', options); }
        createSpan(options) { return this.createEl('span', options); }
        appendText() {}
        setAttribute(name, value) { this.attrs[name] = value; }
        getAttribute(name) { return this.attrs[name]; }
        addClass(name) { this.className += ` ${name}`; }
        matches(selector) { return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tag === selector; }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
        contains(element) { return element === this || this.children.some(child => child.contains(element)); }
        querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        appendChild(child) {
            child.remove(); this.children.push(child); child.parentElement = this;
            const adopt = node => { node.ownerDocument = this.ownerDocument; node.children.forEach(adopt); };
            adopt(child); this.ownerDocument.mutate(); return child;
        }
        empty() { effects.writes++; for (const child of [...this.children]) child.remove(); }
        remove() {
            if (!this.parentElement) return;
            const children = this.parentElement.children;
            children.splice(children.indexOf(this), 1); this.parentElement = null; this.ownerDocument.mutate();
        }
        getBoundingClientRect() { return this.rect; }
        scrollIntoView() {}
        focus() { effects.focus++; this.ownerDocument.activeElement = this; }
        select() { effects.select++; }
    }
    function document(width, height) {
        const doc = new Events(), win = new Events();
        doc.observers = new Set(); doc.body = new Element(doc); doc.activeElement = doc.body;
        doc.createElement = tag => new Element(doc, tag);
        doc.contains = element => doc.body.contains(element);
        doc.querySelector = selector => doc.body.querySelector(selector);
        doc.mutate = () => { for (const observer of doc.observers) observer.pending = true; };
        doc.flush = () => {
            for (const observer of [...doc.observers]) if (observer.pending) { observer.pending = false; observer.callback([]); }
        };
        win.innerWidth = width; win.innerHeight = height; win.frames = new Map();
        win.requestAnimationFrame = callback => { win.frames.set(++nextFrame, callback); return nextFrame; };
        win.cancelAnimationFrame = frame => win.frames.delete(frame);
        win.flush = () => { for (const [id, callback] of [...win.frames]) if (win.frames.delete(id)) callback(); };
        win.MutationObserver = class {
            constructor(callback) { this.callback = callback; }
            observe(target) { this.doc = target.ownerDocument || target; this.doc.observers.add(this); }
            disconnect() { this.doc?.observers.delete(this); this.pending = false; }
        };
        doc.defaultView = win;
        return doc;
    }
    const main = document(1280, 900), popout = document(400, 300);
    // Unrelated listeners must survive all menu cleanup.
    for (const doc of [main, popout]) { doc.addEventListener('mousedown', () => {}); doc.defaultView.addEventListener('resize', () => {}); }
    class Modal {
        constructor(app) {
            this.contentEl = app.doc.body.createDiv('modal-content'); this.modalEl = this.contentEl;
        }
        open() { modals.push(this); this.onOpen(); }
        close() { this.onClose(); this.contentEl.remove(); }
    }
    const categories = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }, { id: 'internal', name: 'Internal' }];
    const plugin = {
        app: { doc: main }, getCategories: () => categories.map(category => ({ ...category })), getCategoryEmoji: () => 'x',
        releaseSaveOperation: owner => effects.releases.push(owner), hasSaveFailure: () => false,
        runSaveOperation: async (owner, name, operation) => { effects.saves.push(operation); return operation(); },
        normalizeCategoryName: name => ({ name })
    };
    const exports = {};
    vm.runInNewContext(source, { exports, console, document: main, window: main.defaultView,
        createDiv: options => new Element(main, 'div', options), MutationObserver: main.defaultView.MutationObserver,
        require: name => ({ obsidian: { Modal }, './models': {
            appendSvgIcon() {}, CategoryType: { EXPENSE: 'expense', INCOME: 'income' }, INTERNAL_CATEGORY_ID: 'internal',
            ColorPalette: { colors: ['#123456'] }, getCommonCategoryEmojis: () => ['x']
        }, './notice': { showExpensicaNotice() {} } })[name] || {}
    });
    function origin(doc = main, modal = false) {
        const view = doc.body.createDiv(modal ? 'modal-content' : 'view');
        return { view, target: view.createEl('button') };
    }
    function open(target, options = {}) {
        exports.showCategoryQuickMenu(target, plugin, 'expense', id => { effects.changes.push(id); }, undefined, options);
        return main.querySelector('.expensica-category-quick-menu') || popout.querySelector('.expensica-category-quick-menu');
    }
    const input = menu => menu.querySelector('input');
    const option = menu => menu.querySelector('.expensica-category-quick-menu-item');
    t.after(() => { for (const doc of [main, popout]) doc.fire('mousedown', { target: doc.body }); });
    return { main, popout, plugin, effects, modals, origin, open, input, option, exports };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const modal of [false, true]) {
    test(`${modal ? 'modal' : 'view'} removal releases the menu, document/window listeners, observer and focus work`, t => {
        const h = setup(t), { view, target } = h.origin(h.main, modal), menu = h.open(target);
        view.remove(); h.main.flush();
        assert.equal(menu.isConnected, false);
        assert.equal(h.main.count(), 1);
        assert.equal(h.main.defaultView.count(), 1);
        assert.equal(h.main.defaultView.frames.size, 0);
        assert.equal(h.main.observers.size, 0);
        assert.equal(h.effects.releases.length, 1);
    });
}

test('repeated openings keep one menu and one set of listeners and dispose each old menu once', t => {
    const h = setup(t), { target } = h.origin();
    for (let i = 0; i < 30; i++) {
        const menu = h.open(target);
        assert.equal(h.main.body.querySelectorAll('.expensica-category-quick-menu').length, 1);
        assert.equal(h.main.count(), 4);
        assert.equal(h.main.defaultView.frames.size, 1);
        if (i > 0) assert.equal(h.effects.releases.length, i);
        assert.ok(menu.isConnected);
    }
    h.main.fire('mousedown', { target: h.main.body });
    assert.equal(h.effects.releases.length, 30);
    assert.equal(h.main.count(), 1);
    assert.equal(h.main.defaultView.count(), 1);
    assert.equal(h.main.observers.size, 0);
});

test('closing before the focus frame cancels it and already-queued callbacks remain harmless', t => {
    const h = setup(t), { target } = h.origin(), menu = h.open(target);
    const frame = [...h.main.defaultView.frames.values()][0];
    const outside = h.main.listeners.get('mousedown').at(-1).callback;
    h.main.fire('mousedown', { target: h.main.body });
    assert.equal(menu.isConnected, false);
    assert.equal(h.main.defaultView.frames.size, 0);
    const before = { ...h.effects };
    frame(); outside({ target: h.main.body });
    assert.equal(h.effects.focus, before.focus);
    assert.equal(h.effects.select, before.select);
    assert.equal(h.effects.releases.length, 1);
});

test('popouts own their menu DOM, viewport sizing, focus frames and listeners', t => {
    const h = setup(t), { target } = h.origin(h.popout), menu = h.open(target);
    assert.equal(menu.ownerDocument, h.popout);
    assert.equal(menu.parentElement, h.popout.body);
    assert.equal(h.main.count(), 1);
    assert.equal(h.main.defaultView.count(), 1);
    assert.equal(h.main.defaultView.frames.size, 0);
    assert.equal(h.popout.count(), 4);
    assert.equal(h.popout.defaultView.frames.size, 1);
    assert.equal(h.popout.observers.size, 1);
    assert.equal(menu.style.left, '108px');
    assert.equal(menu.style.width, '280px');
    assert.equal(menu.style.maxHeight, '276px');
    h.popout.defaultView.flush();
    assert.equal(h.popout.activeElement, h.input(menu));
});

test('popout keyboard navigation reads its active element, wraps, filters and selects', async t => {
    const h = setup(t), { target } = h.origin(h.popout), menu = h.open(target);
    const input = h.input(menu); h.popout.defaultView.flush();
    const key = key => h.popout.fire('keydown', { key, target: h.popout.body });
    assert.ok(key('ArrowUp').prevented);
    assert.ok(key('ArrowDown').prevented);
    input.value = 'be'; input.fire('input');
    assert.equal(menu.querySelectorAll('.expensica-category-quick-menu-item').length, 1);
    assert.ok(key('Enter').prevented);
    await settle();
    assert.deepEqual(h.effects.changes, ['b']);
    assert.equal(menu.isConnected, false);
    assert.equal(h.popout.count(), 1);
});

test('popout outside clicks dismiss locally while menu/target clicks and other documents do not', t => {
    const h = setup(t), { target } = h.origin(h.popout), menu = h.open(target);
    h.main.fire('mousedown', { target: h.main.body });
    h.popout.fire('mousedown', { target });
    h.popout.fire('mousedown', { target: h.input(menu) });
    assert.ok(menu.isConnected);
    h.popout.fire('mousedown', { target: h.popout.body });
    assert.equal(menu.isConnected, false);
    assert.equal(h.popout.count(), 1);
});

test('a new menu in another document closes the previous menu without leaking its listeners', t => {
    const h = setup(t), first = h.open(h.origin().target), second = h.open(h.origin(h.popout).target);
    assert.equal(first.isConnected, false);
    assert.equal(second.ownerDocument, h.popout);
    assert.equal(h.main.count(), 1);
    assert.equal(h.main.defaultView.frames.size, 0);
    assert.equal(h.main.observers.size, 0);
    assert.equal(h.popout.count(), 4);
});

test('closed menu input, selection and New Category handlers cannot act on stale elements', async t => {
    const h = setup(t), { target } = h.origin(), menu = h.open(target);
    const input = h.input(menu), item = h.option(menu), create = menu.querySelector('.expensica-category-quick-menu-new-button');
    h.main.fire('keydown', { key: 'Escape', target: input });
    const writes = h.effects.writes;
    input.value = 'be'; input.fire('input'); item.fire('click'); create.fire('click');
    await settle();
    assert.equal(h.effects.writes, writes);
    assert.deepEqual(h.effects.changes, []);
    assert.equal(h.modals.length, 0);
});

test('target removal is guarded even before its mutation callback is delivered', async t => {
    const h = setup(t), { target } = h.origin(), menu = h.open(target);
    const input = h.input(menu), item = h.option(menu);
    target.remove();
    input.fire('input'); item.fire('click');
    await settle();
    assert.deepEqual(h.effects.changes, []);
    assert.equal(menu.isConnected, false);
    assert.equal(h.main.count(), 1);
});

test('a pending multi-select completion cannot rerender or focus after the origin is removed', async t => {
    const h = setup(t), { target } = h.origin();
    let release;
    h.exports.showCategoryQuickMenu(target, h.plugin, 'expense', () => new Promise(resolve => { release = resolve; }),
        undefined, { closeOnSelect: false, autoFocusSearch: false });
    const menu = h.main.querySelector('.expensica-category-quick-menu');
    h.option(menu).fire('click');
    target.remove();
    const before = { focus: h.effects.focus, writes: h.effects.writes };
    release(); await settle();
    assert.equal(h.effects.focus, before.focus);
    assert.equal(h.effects.writes, before.writes);
    assert.equal(menu.isConnected, false);
    assert.equal(h.main.count(), 1);
});

test('a queued save retry cannot invoke a category callback after menu disposal', async t => {
    const h = setup(t), { target } = h.origin();
    h.plugin.runSaveOperation = async (owner, name, operation) => { h.effects.saves.push(operation); return false; };
    const menu = h.open(target);
    h.option(menu).fire('click');
    h.main.fire('keydown', { key: 'Escape', target: h.input(menu) });
    await h.effects.saves[0]();
    assert.deepEqual(h.effects.changes, []);
});

test('a New Category completion cannot update a removed originating control', async t => {
    const h = setup(t), { target } = h.origin(), menu = h.open(target);
    menu.querySelector('.expensica-category-quick-menu-new-button').fire('click');
    target.remove();
    await h.modals[0].onSave('created');
    assert.deepEqual(h.effects.changes, []);
});

test('a removed option cannot select a category after search replaces the list', async t => {
    const h = setup(t), { target } = h.origin(), menu = h.open(target);
    const old = h.option(menu), input = h.input(menu);
    input.value = 'be'; input.fire('input');
    assert.equal(old.isConnected, false);
    old.fire('click'); await settle();
    assert.deepEqual(h.effects.changes, []);
    assert.ok(menu.isConnected);
});

test('closing New Category before its focus frame cancels and guards the pending focus', t => {
    const h = setup(t), menu = h.open(h.origin().target);
    menu.querySelector('.expensica-category-quick-menu-new-button').fire('click');
    const callbacks = [...h.main.defaultView.frames.values()];
    h.modals[0].close();
    assert.equal(h.main.defaultView.frames.size, 0);
    const before = h.effects.focus;
    callbacks.forEach(callback => callback());
    assert.equal(h.effects.focus, before);
});

test('New Category uses its own popout window for focus scheduling and cancellation', t => {
    const h = setup(t), menu = h.open(h.origin(h.popout).target);
    h.plugin.app.doc = h.popout;
    menu.querySelector('.expensica-category-quick-menu-new-button').fire('click');
    assert.equal(h.main.defaultView.frames.size, 0);
    assert.equal(h.popout.defaultView.frames.size, 1);
    h.modals[0].close();
    assert.equal(h.popout.defaultView.frames.size, 0);
});

test('closing a popout releases its menu even if the document nodes still appear connected', t => {
    const h = setup(t), { target } = h.origin(h.popout), menu = h.open(target);
    h.popout.defaultView.fire('unload');
    assert.equal(menu.isConnected, false);
    assert.equal(h.popout.count(), 1);
    assert.equal(h.popout.defaultView.count(), 1);
    assert.equal(h.popout.defaultView.frames.size, 0);
    assert.equal(h.popout.observers.size, 0);
});

test('detached targets do not open menus or disturb a currently active menu', t => {
    const h = setup(t), first = h.open(h.origin().target), { target } = h.origin();
    target.remove(); h.open(target);
    assert.ok(first.isConnected);
    assert.equal(h.main.body.querySelectorAll('.expensica-category-quick-menu').length, 1);
});

test('menus retain their modal host, left-side anchoring and disabled autofocus option', t => {
    const h = setup(t), { target, view } = h.origin(h.popout, true), menu = h.open(target, { preferredSide: 'left', autoFocusSearch: false });
    assert.equal(menu.parentElement, view);
    assert.equal(menu.className, 'expensica-category-quick-menu');
    assert.equal(menu.style.left, '62px');
    target.rect.left = 300; h.popout.defaultView.fire('resize');
    assert.equal(menu.style.left, '62px');
    assert.equal(h.main.defaultView.frames.size + h.popout.defaultView.frames.size, 0);
    h.popout.fire('keydown', { key: 'Escape', target });
    assert.equal(menu.isConnected, false);
});

test('single-select retains sorting, internal-category exclusion, selected state and callback behavior', async t => {
    const h = setup(t), { target } = h.origin();
    h.exports.showCategoryQuickMenu(target, h.plugin, 'expense', id => { h.effects.changes.push(id); }, 'b');
    const menu = h.main.querySelector('.expensica-category-quick-menu');
    const items = menu.querySelectorAll('.expensica-category-quick-menu-item');
    assert.equal(items.length, 2);
    assert.equal(items[0].attrs['aria-pressed'], 'false');
    assert.equal(items[1].attrs['aria-pressed'], 'true');
    assert.equal(items[1].attrs['aria-selected'], 'true');
    items[0].fire('click'); await settle();
    assert.deepEqual(h.effects.changes, ['a']);
    assert.equal(menu.isConnected, false);
});

test('multi-select preserves the menu and toggles the selected state without extra listeners', async t => {
    const h = setup(t), menu = h.open(h.origin().target, { closeOnSelect: false, selectedCategoryIds: ['a'] });
    const count = h.main.count();
    h.option(menu).fire('click'); await settle();
    assert.equal(h.option(menu).attrs['aria-pressed'], 'false');
    h.option(menu).fire('click'); await settle();
    assert.equal(h.option(menu).attrs['aria-pressed'], 'true');
    assert.deepEqual(h.effects.changes, ['a', 'a']);
    assert.ok(menu.isConnected);
    assert.equal(h.main.count(), count);
});

test('save recovery dialog clicks and keys remain protected while the originating menu is open', t => {
    const h = setup(t), menu = h.open(h.origin().target);
    h.plugin.hasSaveFailure = () => true;
    const recovery = h.main.body.createDiv('modal-container').createEl('button');
    h.main.fire('mousedown', { target: recovery });
    h.main.fire('keydown', { target: recovery, key: 'Escape' });
    assert.ok(menu.isConnected);
    h.main.fire('keydown', { target: h.input(menu), key: 'Escape' });
    assert.equal(menu.isConnected, false);
});
