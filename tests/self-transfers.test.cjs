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
    vm.runInNewContext(compiled, { exports, Date, Intl, console, require: name => dependencies[name] || {} });
    return exports;
}
const models = load('src/models.ts');
const importer = load('src/transaction-import.ts', { './models': models });
const exposed = '\nexport { getAccountTransactionAmount, getRunningBalanceByTransactionIdForAccount };';
const dashboard = load('src/dashboard-view.ts', { './models': models, obsidian: { Modal: class {}, ItemView: class {} },
    'chart.js': { Tooltip: { positioners: {} } } }, exposed);
const transactions = load('src/transactions-view.ts', { './models': models, './dashboard-view': dashboard,
    obsidian: { Modal: class {} } }, exposed);
const calendar = load('src/visualizations/calendar-view.ts', { '../models': models }, exposed);
const accounts = [{ id: 'cash', type: 'chequing', name: 'Cash', isDefault: true },
    { id: 'card', type: 'credit', name: 'Card', creditLimit: 100 }, { id: 'savings', type: 'saving', name: 'Reserve' }];
const references = accounts.map(account => models.formatAccountReference(account.type, account.name));
const [cash, card, savings] = references;
const transfer = (fields = {}) => ({ id: '20261015-120000-00000001', date: '2026-10-15', time: '12:00:00',
    type: 'internal', description: 'TRANSFER', amount: 25, category: 'internal', fromAccount: cash, toAccount: card, ...fields });
function plugin(source) {
    return {
        getAllTransactions: () => [...source],
        normalizeTransactionAccountReference: reference => reference ? models.parseAccountReference(reference).reference : cash,
        findAccountByReference: reference => accounts.find(account => models.formatAccountReference(account.type, account.name) === reference) || null
    };
}

for (const reference of references) {
    test(`existing ${reference} self-transfers have zero account effects in every view, including aliases`, () => {
        for (const destination of [reference, reference.toUpperCase()]) {
            const entry = Object.freeze(transfer({ fromAccount: reference, toAccount: destination }));
            const source = Object.freeze([entry]);
            const before = JSON.stringify(source);
            for (const view of [dashboard, transactions, calendar]) for (const target of references) {
                assert.equal(view.getAccountTransactionAmount(plugin(source), entry, target), 0);
                assert.equal(view.getRunningBalanceByTransactionIdForAccount(plugin(source), target, source)[entry.id], 0);
            }
            assert.equal(JSON.stringify(source), before);
        }
    });
}

test('normal transfers preserve debit, savings and credit account signs across views', () => {
    for (const [fromAccount, toAccount, effects] of [
        [cash, savings, [-25, 0, 25]], [cash, card, [-25, -25, 0]],
        [card, cash, [25, 25, 0]], [card, savings, [0, 25, 25]]
    ]) {
        const entry = transfer({ fromAccount, toAccount });
        for (const view of [dashboard, transactions, calendar]) {
            assert.deepEqual(references.map(target => view.getAccountTransactionAmount(plugin([entry]), entry, target)), effects);
        }
    }
});

test('running balances retain historical self-transfer rows without changing income, spending or valid payments', () => {
    const source = [transfer({ id: 'income', date: '2026-09-30', type: 'income', account: cash, amount: 100 }),
        transfer({ id: 'expense', date: '2026-09-30', type: 'expense', account: card, amount: 80 }),
        transfer({ id: 'payment', date: '2026-10-10', amount: 20 }),
        ...references.map((reference, index) => transfer({ id: `self-${index}`, fromAccount: reference, toAccount: reference.toUpperCase() }))];
    const before = JSON.stringify(source);
    for (const [target, expected] of [[cash, 80], [card, 60], [savings, 0]]) {
        for (const view of [dashboard, transactions, calendar]) {
            const balances = view.getRunningBalanceByTransactionIdForAccount(plugin(source), target,
                models.sortTransactionsByDateTimeDesc(source, source));
            for (const entry of source.slice(3)) assert.equal(balances[entry.id], expected);
        }
    }
    assert.equal(models.TransactionAggregator.getTotalIncome(source), 100);
    assert.equal(models.TransactionAggregator.getTotalExpenses(source), 80);
    assert.equal(models.TransactionAggregator.getBalance(source), 20);
    assert.equal(JSON.stringify(source), before);
});

test('missing endpoints never resolve to the default account in transfer balances', () => {
    for (const view of [dashboard, transactions, calendar]) {
        const missing = transfer({ fromAccount: undefined, toAccount: undefined });
        assert.equal(view.getAccountTransactionAmount(plugin([missing]), missing, cash), 0);
        const partial = transfer({ fromAccount: undefined });
        assert.equal(view.getAccountTransactionAmount(plugin([partial]), partial, cash), 0);
        assert.equal(view.getAccountTransactionAmount(plugin([partial]), partial, card), -25);
    }
});

test('new imports reject canonical and alias self-transfers before legacy ID generation or mutation', () => {
    const guarded = load('src/transaction-import.ts', { './models': { ...models,
        generateId() { throw Error('must validate before generating IDs'); } } });
    for (const id of ['20261015-120000-00000001', 'legacy-import-id']) {
        for (const destination of [cash, cash.toUpperCase()]) {
            const entry = transfer({ id, toAccount: destination });
            for (const value of [[entry], { transactions: [entry], lastUpdated: 'unchanged' }]) {
                const content = JSON.stringify(value, null, 4);
                const rows = guarded.parseTransactionImport(content);
                assert.throws(() => guarded.prepareTransactions(rows, [], new Date(), undefined, true), /transfer accounts must differ/);
                assert.throws(() => guarded.prepareTransactions(rows, [], new Date(), accounts, true), /transfer accounts must differ/);
                assert.equal(JSON.stringify(value, null, 4), content);
            }
        }
    }
});

test('startup preparation retains normalized historical self-transfers while import preparation rejects them', () => {
    const entry = transfer({ toAccount: cash, metadata: { keep: true } });
    const source = [entry];
    const before = JSON.stringify(source);
    const prepared = importer.prepareTransactions(source, [], new Date(), accounts, true, models.DEFAULT_CATEGORIES, true);
    assert.equal(prepared.changed, 0);
    assert.equal(JSON.stringify(prepared.transactions), before);
    assert.equal(JSON.stringify(source), before);
    assert.throws(() => importer.prepareTransactions(source, [], new Date(), accounts, true, models.DEFAULT_CATEGORIES), /transfer accounts must differ/);
});
