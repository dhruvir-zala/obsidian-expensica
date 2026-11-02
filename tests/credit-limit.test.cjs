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
    vm.runInNewContext(compiled, { exports, Date, Intl, console, require: name => dependencies[name] || (name.endsWith('/account-calculations') ? load('src/account-calculations.ts', { './models': dependencies['./models'] || dependencies['../models'] }) : undefined) || {} });
    return exports;
}
const models = load('src/models.ts');
const accountCalculations = load('src/account-calculations.ts', { './models': models });
const cash = 'chequing-cash', visa = 'credit-visa', master = 'credit-master';
const accounts = [{ id: 'cash', type: 'chequing', name: 'Cash', isDefault: true },
    { id: 'visa', type: 'credit', name: 'Visa', creditLimit: 100 },
    { id: 'master', type: 'credit', name: 'Master', creditLimit: 100 }];
const plugin = (defaultReference = cash, definitions = accounts, ledger = []) => ({
    getAllTransactions: () => ledger,
    normalizeTransactionAccountReference: reference => reference ? models.parseAccountReference(reference).reference : defaultReference,
    findAccountByReference: reference => definitions.find(account => models.formatAccountReference(account.type, account.name) === reference) || null
});
const row = (id, amount, account = visa, fields = {}) => ({ id, date: '2026-10-15', time: '12:00:00',
    type: 'expense', category: 'food', description: 'ENTRY', amount, account, ...fields });
const payment = (id, amount, account = visa) => row(id, amount, account, { type: 'income', category: 'salary' });
const transfer = (id, amount, fromAccount = cash, toAccount = visa) => row(id, amount, undefined,
    { type: 'internal', category: 'internal', account: undefined, fromAccount, toAccount });

const cases = [
    ['payment reassignment restores the original credit debt', [row('debt', 150), payment('edit', 50)], payment('edit', 50, cash), [150, 0]],
    ['an implicit default payment account removes the original credit effect', [row('debt', 150), payment('edit', 50)], { ...payment('edit', 50), account: undefined }, [150, 0]],
    ['transfer destination changes restore the removed destination debt', [row('debt', 150), transfer('edit', 50)], transfer('edit', 50, cash, master), [150, -50]],
    ['credit-to-credit transfers retain both signs', [row('debt', 150), row('master-debt', 80, master), transfer('edit', 50)], transfer('edit', 50, master, visa), [100, 130]],
    ['transfer source changes remove its previous effect', [row('debt', 150), transfer('edit', 50, visa, cash)], transfer('edit', 50, master, cash), [150, 50]],
    ['changing a payment to an expense retains actual debt', [row('debt', 150), payment('edit', 50)], row('edit', 50), [200, 0]],
    ['changing a transfer to an ordinary transaction removes its old payment', [row('debt', 150), transfer('edit', 50)], row('edit', 50, cash), [150, 0]],
    ['changing an ordinary payment to a transfer removes its original account effect', [row('debt', 150), payment('edit', 50)], transfer('edit', 50, cash, master), [150, -50]],
    ['reducing an expense retains remaining over-limit debt', [row('debt', 150), row('edit', 50)], row('edit', 25), [175, 0]],
    ['increasing a payment reduces over-limit debt', [row('debt', 250), payment('edit', 50)], payment('edit', 75), [175, 0]],
    ['reducing a payment records increased debt', [row('debt', 250), payment('edit', 50)], payment('edit', 25), [225, 0]],
    ['unchanged expenses retain debt', [row('debt', 150), row('edit', 50)], row('edit', 50), [200, 0]],
    ['metadata-only edits retain debt', [row('debt', 150), row('edit', 50)], row('edit', 50, visa, { description: 'EDITED', date: '2020-01-01' }), [200, 0]],
    ['changing an expense to income can return debt to the limit', [row('debt', 150), row('edit', 50)], payment('edit', 50), [100, 0]],
    ['moving an expense updates both credit accounts', [row('debt', 150), row('edit', 50), row('master-debt', 90, master)], row('edit', 25, master), [150, 115]],
    ['new expenses at the limit retain actual debt', [row('debt', 90)], row('new', 10), [100, 0]],
    ['new expenses above the limit retain actual debt', [row('debt', 90)], row('new', 10.01), [100.01, 0]],
    ['new payments reduce existing over-limit debt', [row('debt', 200)], payment('new', 5), [195, 0]],
    ['new transfers reduce existing over-limit debt', [row('debt', 200)], transfer('new', 5), [195, 0]],
    ['new expenses record debt above the limit', [row('debt', 200)], row('new', 5), [205, 0]],
    ['partial historical transfers never assign a missing endpoint to the default account', [row('debt', 150), transfer('edit', 50)], { ...transfer('edit', 50), toAccount: undefined }, [150, 0]]
];

for (const [name, ledger, updated, expected] of cases) {
    test(name, () => {
        const before = JSON.stringify({ ledger, updated });
        ledger.forEach(Object.freeze);
        Object.freeze(ledger);
        Object.freeze(updated);
        const projected = ledger.some(row => row.id === updated.id)
            ? ledger.map(row => row.id === updated.id ? updated : row) : [...ledger, updated];
        for (let attempt = 0; attempt < 3; attempt++) {
            for (const [index, reference] of [visa, master].entries()) {
                assert.equal(accountCalculations.getAccountRunningBalance(plugin(cash, accounts, projected), reference, projected), expected[index]);
            }
        }
        assert.equal(JSON.stringify({ ledger, updated }), before);
    });
}

test('implicit defaults, aliases and zero or absent limits do not alter shared financial calculations', () => {
    assert.equal(accountCalculations.getAccountTransactionAmount(plugin(visa), row('new', 1, undefined, { account: undefined }), visa), 1);
    assert.equal(accountCalculations.getAccountTransactionAmount(plugin(), row('new', 1, 'CREDIT-VISA'), visa), 1);
    for (const creditLimit of [0, 100, undefined]) {
        const definitions = accounts.map(account => ({ ...account, creditLimit }));
        assert.equal(accountCalculations.getAccountTransactionAmount(plugin(cash, definitions), row('new', 999), visa), 999);
    }
});

test('shared account balances include all ledger dates and current payment amounts', () => {
    const ledger = [row('old-debt', 80, visa, { date: '2020-01-01' }), row('future-debt', 70, visa, { date: '2030-01-01' }), payment('edit', 50)];
    assert.equal(accountCalculations.getAccountRunningBalance(plugin(), visa, ledger), 100);
    const latest = [row('debt', 250), payment('edit', 150)];
    assert.equal(accountCalculations.getAccountRunningBalance(plugin(), visa, latest), 100);
});

test('unrelated credit accounts and stale transfer fields do not affect ordinary debit transactions', () => {
    const ledger = [row('debt', 200), row('edit', 10, cash, { fromAccount: visa, toAccount: master })];
    assert.equal(accountCalculations.getAccountRunningBalance(plugin(), cash, ledger), -10);
    assert.equal(accountCalculations.getAccountTransactionAmount(plugin(cash, accounts.slice(0, 1)), payment('edit', 10, cash), cash), 10);
});
