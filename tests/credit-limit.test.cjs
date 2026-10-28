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
const { getCreditLimitExceededAccount: exceeded } = load('src/dashboard-view.ts', {
    './models': models, obsidian: { Modal: class {}, ItemView: class {} },
    'chart.js': { Tooltip: { positioners: {} } }
}, '\nexport { getCreditLimitExceededAccount };');
const cash = 'chequing-cash', visa = 'credit-visa', master = 'credit-master';
const accounts = [{ id: 'cash', type: 'chequing', name: 'Cash', isDefault: true },
    { id: 'visa', type: 'credit', name: 'Visa', creditLimit: 100 },
    { id: 'master', type: 'credit', name: 'Master', creditLimit: 100 }];
const plugin = (defaultReference = cash, definitions = accounts) => ({
    normalizeTransactionAccountReference: reference => reference ? models.parseAccountReference(reference).reference : defaultReference,
    findAccountByReference: reference => definitions.find(account => models.formatAccountReference(account.type, account.name) === reference) || null
});
const row = (id, amount, account = visa, fields = {}) => ({ id, date: '2026-10-15', time: '12:00:00',
    type: 'expense', category: 'food', description: 'ENTRY', amount, account, ...fields });
const payment = (id, amount, account = visa) => row(id, amount, account, { type: 'income', category: 'salary' });
const transfer = (id, amount, fromAccount = cash, toAccount = visa) => row(id, amount, undefined,
    { type: 'internal', category: 'internal', account: undefined, fromAccount, toAccount });

const cases = [
    ['payment reassignment checks the original credit account', [row('debt', 150), payment('edit', 50)], payment('edit', 50, cash), 'visa'],
    ['removing an explicit payment account checks the original credit account', [row('debt', 150), payment('edit', 50)], { ...payment('edit', 50), account: undefined }, 'visa'],
    ['transfer destination changes check the removed destination', [row('debt', 150), transfer('edit', 50)], transfer('edit', 50, cash, master), 'visa'],
    ['transfer source changes check new credit debt', [row('debt', 150), row('master-debt', 80, master), transfer('edit', 50)], transfer('edit', 50, master, visa), 'master'],
    ['transfer source removal checks its old credit effect', [row('debt', 150), transfer('edit', 50, visa, cash)], transfer('edit', 50, master, cash), null],
    ['changing a payment to an expense accounts for both effects', [row('debt', 150), payment('edit', 50)], row('edit', 50), 'visa'],
    ['changing a transfer to an ordinary transaction removes the old payment', [row('debt', 150), transfer('edit', 50)], row('edit', 50, cash), 'visa'],
    ['changing an ordinary payment to a transfer removes its original account effect', [row('debt', 150), payment('edit', 50)], transfer('edit', 50, cash, master), 'visa'],
    ['reducing an expense is allowed while debt remains over the limit', [row('debt', 150), row('edit', 50)], row('edit', 25), null],
    ['increasing a payment is allowed while debt remains over the limit', [row('debt', 250), payment('edit', 50)], payment('edit', 75), null],
    ['reducing a payment worsens existing over-limit debt', [row('debt', 250), payment('edit', 50)], payment('edit', 25), 'visa'],
    ['unchanged expenses do not worsen existing over-limit debt', [row('debt', 150), row('edit', 50)], row('edit', 50), null],
    ['metadata-only edits do not worsen existing over-limit debt', [row('debt', 150), row('edit', 50)], row('edit', 50, visa, { description: 'EDITED', date: '2020-01-01' }), null],
    ['changing an expense to income may bring debt back to the limit', [row('debt', 150), row('edit', 50)], payment('edit', 50), null],
    ['moving an expense may reduce one over-limit account but exceed another', [row('debt', 150), row('edit', 50), row('master-debt', 90, master)], row('edit', 25, master), 'master'],
    ['new expenses at the exact limit remain valid', [row('debt', 90)], row('new', 10), null],
    ['new expenses above the limit remain rejected', [row('debt', 90)], row('new', 10.01), 'visa'],
    ['new payments may reduce existing over-limit debt', [row('debt', 200)], payment('new', 5), null],
    ['new transfers may reduce existing over-limit debt', [row('debt', 200)], transfer('new', 5), null],
    ['new expenses worsening over-limit debt remain rejected', [row('debt', 200)], row('new', 5), 'visa'],
    ['removing a transfer endpoint still checks the removed account', [row('debt', 150), transfer('edit', 50)], { ...transfer('edit', 50), toAccount: undefined }, 'visa']
];

for (const [name, ledger, updated, rejected] of cases) {
    test(name, () => {
        const before = JSON.stringify({ ledger, updated });
        ledger.forEach(Object.freeze);
        Object.freeze(ledger);
        Object.freeze(updated);
        for (let attempt = 0; attempt < 3; attempt++) {
            assert.equal(exceeded(plugin(), updated, ledger)?.id || null, rejected);
        }
        assert.equal(JSON.stringify({ ledger, updated }), before);
    });
}

test('implicit default credit accounts, normalized references and zero or absent limits use existing account rules', () => {
    assert.equal(exceeded(plugin(visa), row('new', 1, undefined, { account: undefined }), [row('debt', 100)])?.id, 'visa');
    assert.equal(exceeded(plugin(), row('new', 1, 'CREDIT-VISA'), [row('debt', 100)])?.id, 'visa');
    assert.equal(exceeded(plugin(cash, accounts.map(account => ({ ...account, creditLimit: 0 }))), row('new', 1), [])?.id, 'visa');
    assert.equal(exceeded(plugin(cash, accounts.map(account => ({ ...account, creditLimit: undefined }))), row('new', 999), []), null);
});

test('validation uses all ledger dates and the latest committed original rather than an editor snapshot', () => {
    const ledger = [row('old-debt', 80, visa, { date: '2020-01-01' }), row('future-debt', 70, visa, { date: '2030-01-01' }), payment('edit', 50)];
    assert.equal(exceeded(plugin(), payment('edit', 50, cash), ledger)?.id, 'visa');
    const latest = [row('debt', 250), payment('edit', 150)];
    assert.equal(exceeded(plugin(), payment('edit', 100), latest)?.id, 'visa');
});

test('unrelated over-limit credit accounts and stale fields do not block valid debit edits', () => {
    const ledger = [row('debt', 200), row('edit', 10, cash, { fromAccount: visa, toAccount: master })];
    assert.equal(exceeded(plugin(), row('edit', 20, cash, { fromAccount: visa, toAccount: master }), ledger), null);
    assert.equal(exceeded(plugin(cash, accounts.slice(0, 1)), payment('edit', 10, cash), [payment('edit', 10)]), null);
});
