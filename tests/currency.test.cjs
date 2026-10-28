const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename, dependencies = {}, extraSource = '') {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') + extraSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, console,
        require: name => dependencies[name] || {} });
    return exports;
}
class Element {
    constructor(options = {}) {
        if (typeof options === 'string') options = { cls: options };
        this.children = []; this.classes = new Set((options.cls || '').split(' '));
        this.textContent = options.text || ''; this.style = {}; this.listeners = {};
    }
    createEl(tag, options) { const child = new Element(options); this.children.push(child); return child; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    addClass(value) { this.classes.add(value); }
    removeClass(value) { this.classes.delete(value); }
    toggleClass() {}
    setText(value) { this.textContent = value; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    empty() { this.children = []; }
    querySelector(selector) { return this.children.find(child => child.classes.has(selector.slice(1)))
        || this.children.map(child => child.querySelector(selector)).find(Boolean); }
}
const models = load('src/models.ts');
const obsidian = { Modal: class {}, ItemView: class {}, Plugin: class {}, PluginSettingTab: class {} };
const extra = '\nexport { formatRunningBalanceLabel };';
const dashboard = load('src/dashboard-view.ts', { './models': models, obsidian,
    'chart.js': { Tooltip: { positioners: {} } } }, extra + '\nexport { renderOverviewCurrencyValue };');
const transactions = load('src/transactions-view.ts', { './models': models, obsidian }, extra);
const calendar = load('src/visualizations/calendar-view.ts', { '../models': models }, extra);
const accounts = load('src/account-card.ts', { './models': models });
const budgets = load('src/budget-cards.ts', { './models': models });
const cards = load('src/transaction-card.ts', { './models': models,
    './time-selector-modal': { formatTimeForDisplay: () => '' } });
const notices = [];
const { default: Plugin, ExpensicaSettingTab } = load('main.ts', { obsidian, './src/models': models,
    './src/notice': { showExpensicaNotice: message => notices.push(message) } }, '\nexport { ExpensicaSettingTab };');

for (const [code, digits, expected] of [
    ['USD', 2, '$1.23'], ['CAD', 2, '$1.23'], ['JPY', 0, '¥1'], ['KWD', 3, 'د.ك\u00a01.234']
]) {
    test(`${code} narrow symbols and ${digits} ISO decimal places agree across exact displays`, () => {
        const amount = 1.234;
        assert.equal(models.formatCurrency(amount, code), expected);
        const p = { settings: { defaultCurrency: code }, getCategoryById: () => null,
            getCategoryEmoji: () => '', getTransactionAccountDisplay: () => ({ name: 'Cash' }) };
        for (const view of [dashboard, transactions, calendar]) {
            assert.equal(view.formatRunningBalanceLabel(p, amount), expected);
            assert.equal(view.formatRunningBalanceLabel(p, -amount, 'cash'), `Cash: ${models.formatCurrency(-amount, code)}`);
        }
        const root = new Element();
        dashboard.renderOverviewCurrencyValue(root, code, amount, 'amount');
        assert.equal(root.querySelector('.expensica-card-currency-amount').textContent, expected);
        accounts.renderAccountCard(root, { account: { name: 'Cash', type: 'chequing' },
            currencyCode: code, runningBalance: amount, lastTransactionDateLabel: 'Today' });
        assert.equal(root.querySelector('.expensica-account-card-balance').textContent, expected);
        budgets.renderBudgetCard(root, { budget: { id: 'budget', amount, period: 'monthly' }, categoryName: 'Food',
            categoryEmoji: '', currencyCode: code, spent: amount, remaining: amount, percentage: 50, periodLabel: 'monthly' });
        assert.equal(root.querySelector('.expensica-budget-card-value').textContent, expected);
        const entry = Object.freeze({ id: 'original', type: 'income', amount, date: '2026-10-15', description: 'ENTRY' });
        const before = JSON.stringify(entry);
        const card = cards.renderTransactionCard(root, { plugin: p, transaction: entry, runningBalanceLabel: expected });
        assert.equal(card.querySelector('.expensica-income').textContent, `+${expected}`);
        const list = Object.assign(Object.create(transactions.ExpensicaTransactionsView.prototype), { plugin: p });
        assert.equal(list.formatTransactionStatCurrency(amount), expected);
        const view = Object.assign(Object.create(dashboard.ExpensicaDashboardView.prototype), { plugin: p });
        assert.equal(view.formatCategoryCardCurrency(amount), expected);
        assert.equal(view.formatBudgetCurrency(amount), expected);
        assert.equal(JSON.stringify(entry), before);
    });
}

test('compact labels retain currency identity while full details retain currency precision', () => {
    for (const code of ['USD', 'CAD', 'JPY', 'KWD']) {
        const exact = models.formatCurrency(1234.567, code);
        const compact = models.formatCurrency(1234.567, code, true);
        assert.notEqual(compact, exact);
        assert.match(compact, /K/);
        if (code === 'CAD') assert.equal(compact, '$1.2K');
        if (code === 'KWD') {
            assert.ok(compact.includes('د.ك'));
            assert.ok(!compact.includes('KWD'));
        }
    }
    assert.equal(models.formatCurrency(-0.0000005, 'CAD'), '$0.00');
    assert.equal(models.formatCurrency(0.0000005, 'KWD'), 'د.ك\u00a00.000');
});

test('compact chart currency rounds whole units below K and preserves signed K/M thresholds', () => {
    for (const [value, expected] of [
        [0, '$0'], [0.49, '$0'], [0.5, '$1'], [12.34, '$12'], [12.5, '$13'],
        [999.49, '$999'], [999.5, '$1K'], [999.99, '$1K'], [1000, '$1K'],
        [1540.89, '$1.5K'], [1549.99, '$1.5K'], [1550, '$1.6K'],
        [999949, '$999.9K'], [999950, '$1M'], [1000000, '$1M'], [1540890, '$1.5M']
    ]) {
        for (const code of ['USD', 'CAD']) {
            assert.equal(models.formatCurrency(value, code, true), expected);
            assert.equal(models.formatCurrency(-value, code, true), expected === '$0' ? '$0' : `-${expected}`);
        }
    }
    assert.equal(models.formatCurrency(1540.89, 'CAD'), '$1,540.89');
    assert.equal(models.formatCurrency(1.234, 'KWD'), 'د.ك\u00a01.234');
    assert.equal(models.formatCurrency(1540.89, 'JPY'), '¥1,541');
});

test('input symbols use Intl currency parts, while exports retain their identifier policy', () => {
    for (const [code, symbol] of [['CAD', '$'], ['USD', '$'], ['JPY', '¥'], ['KWD', 'د.ك']]) {
        assert.equal(models.formatCurrency(0, code, false, { currencyOnly: true }), symbol);
    }
    assert.equal(models.formatCurrency(100, 'CAD'), '$100.00');
    assert.equal(models.formatCurrency(100, 'CAD', false, { currencyDisplay: 'symbol' }), 'CA$100.00');
    assert.equal(models.formatCurrency(0, 'invalid', false, { currencyOnly: true }), '¤');
});

test('settings retain full currency codes and names when amount symbols are narrow', () => {
    const tab = Object.assign(Object.create(ExpensicaSettingTab.prototype), { registerOutsideClick() {} });
    const root = new Element();
    let selected;
    tab.renderCurrencyDropdown(root, 'CAD', value => { selected = value; });
    assert.equal(root.querySelector('.expensica-select-text').textContent, 'CAD C$ - Canadian Dollar');
    const options = root.querySelector('.currency-options-container');
    const usd = options.children.find(option => option.textContent === 'USD $ - US Dollar');
    usd.listeners.click();
    assert.equal(selected, 'USD', 'selection persists the code alone');
    assert.equal(root.querySelector('.expensica-select-text').textContent, 'USD $ - US Dollar');
});

test('missing legacy currency defaults to USD; valid legacy codes persist without writing', async () => {
    for (const saved of [{}, { defaultCurrency: 'CAD' }, { defaultCurrency: 'JPY' }, { defaultCurrency: 'KWD' }]) {
        const p = new Plugin(); let writes = 0;
        p.loadData = async () => saved;
        p.saveData = async () => { writes++; };
        await p.loadSettings();
        assert.equal(p.settings.defaultCurrency, saved.defaultCurrency || 'USD');
        assert.equal(writes, 0);
    }
});

for (const invalid of ['CAD $', '$', 'cad', 'ZZZ', '', null, 42]) {
    test(`invalid saved currency ${JSON.stringify(invalid)} stays explicit until corrected`, async () => {
        const p = new Plugin(); const saved = { defaultCurrency: invalid }; let writes = 0, committed;
        p.loadData = async () => saved;
        p.saveData = async value => { writes++; committed = value; };
        const noticeStart = notices.length;
        await p.loadSettings();
        assert.equal(p.settings.defaultCurrency, invalid);
        assert.equal(saved.defaultCurrency, invalid);
        assert.equal(writes, 0);
        assert.match(notices[noticeStart], /saved currency is invalid/);
        assert.equal(models.formatCurrency(1.234, invalid), '1.234 (invalid currency)');
        await assert.rejects(p.saveSettings(false), /Choose a valid currency/);
        assert.equal(writes, 0);
        const tab = Object.assign(Object.create(ExpensicaSettingTab.prototype), { registerOutsideClick() {} });
        const root = new Element();
        tab.renderCurrencyDropdown(root, invalid, value => { p.settings.defaultCurrency = value; });
        assert.equal(root.querySelector('.expensica-select-text').textContent, 'Choose a valid currency');
        p.settings.defaultCurrency = 'CAD';
        await p.saveSettings(false);
        assert.equal(committed.defaultCurrency, 'CAD');
        assert.equal(writes, 1);
    });
}
