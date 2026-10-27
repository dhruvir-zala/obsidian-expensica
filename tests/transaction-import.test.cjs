const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const NOW = new Date('2026-10-22T18:34:56.789Z');
class FixedDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(NOW.getTime()); }
    static now() { return NOW.getTime(); }
}
const compiled = new Map();
function load(filename, dependencies = {}, globals = {}) {
    if (!compiled.has(filename)) {
        compiled.set(filename, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText);
    }
    const exports = {};
    vm.runInNewContext(compiled.get(filename), {
        exports, Date: FixedDate, crypto: require('node:crypto').webcrypto,
        console: { log() {}, warn() {}, error() {} }, ...globals,
        require(name) { return dependencies[name] || (name.endsWith('/modal-utils') ? load('src/modal-utils.ts') : {}); }
    });
    return exports;
}
const models = load('src/models.ts');
const importer = load('src/transaction-import.ts', { './models': models });
const row = (changes = {}) => ({ id: '20260410-113514-1234abcd', date: '2026-02-01', type: 'expense',
    amount: 10, description: 'ORIGINAL CASE AND SPACING', category: 'food', ...changes });
const legacyId = (instant = '2026-04-10T17:35:14.123Z', suffix = 'abcde') => new Date(instant).getTime().toString(36) + suffix;
const plain = value => JSON.parse(JSON.stringify(value));
const qaExample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/import-qa-envelope.json'), 'utf8'));

test('normalization strips obsolete legacyId values without changing valid IDs, fields, or nested metadata', () => {
    const base = { id: row().id, date: row().date, time: '11:35:14', type: 'expense', amount: 0.001,
        description: 'KEEP', category: 'food', account: 'other-default', notes: ' Keep exact notes ',
        metadata: { legacyId: 'Keep nested metadata', values: [1, 2] } };
    for (const legacyId of ['old-source', '', null, 3, { old: true }]) {
        const input = Object.freeze({ ...base, legacyId });
        const before = JSON.stringify(input);
        const result = importer.prepareTransactions([input], [], NOW);
        assert.deepEqual(plain(result.transactions[0]), base);
        assert.equal(Object.hasOwn(result.transactions[0], 'legacyId'), false);
        assert.equal(JSON.stringify(input), before);
        assert.equal(result.changed, 1);
        assert.equal(importer.formatTransactionCorrections(result.corrections).length, 0);
        const restart = importer.prepareTransactions(plain(result.transactions), [], new Date('2027-01-01T00:00:00Z'));
        assert.equal(restart.changed, 0);
        assert.equal(importer.formatTransactionCorrections(restart.corrections).length, 0);
    }
});

test('discarded legacyId aliases do not conflict with actual IDs or change modern IDs', () => {
    const first = '20260410-113514-00000001';
    const second = '20260410-113514-00000002';
    const input = [row({ id: first, time: '11:35:14', legacyId: second }),
        row({ id: second, time: '11:35:14', amount: 20, legacyId: second })];
    const result = importer.prepareTransactions(input, [], NOW, undefined, true);
    assert.deepEqual(Array.from(result.transactions, transaction => transaction.id), [first, second]);
    assert.ok(result.transactions.every(transaction => !Object.hasOwn(transaction, 'legacyId')));
    assert.equal(result.corrections.duplicateIdsRegenerated, 0);
    const existing = row({ id: first, time: '11:35:14', legacyId: second });
    assert.throws(() => importer.prepareTransactions([{ ...existing, legacyId: 'different metadata' }], [existing], NOW, undefined, true), /identical data/);
    const allowed = importer.prepareTransactions([row({ id: second, time: '11:35:14' })], [existing], NOW);
    assert.equal(allowed.transactions[0].id, second);
});

test('identical copies differing only in obsolete metadata are rejected before any ID allocation', () => {
    const guarded = load('src/transaction-import.ts', { './models': { ...models,
        generateId() { throw Error('must detect duplicate records before migration'); } } });
    for (const id of [row().id, legacyId(), 'alien-id']) {
        const first = row({ id, legacyId: 'old-one' });
        const second = { ...first, legacyId: { obsolete: true } };
        const input = [first, second];
        const before = JSON.stringify(input);
        assert.throws(() => guarded.prepareTransactions(input, [], NOW, undefined, true),
            /identical data in transactions\[0\] and transactions\[1\]/);
        assert.equal(JSON.stringify(input), before);
    }
});

test('import strips legacyId from current-ID records and keeps current-ID duplicate protection', async () => {
    for (const envelope of [false, true]) {
        const h = harness();
        const input = { id: '20260410-113514-87654321', date: row().date, time: '11:35:14', type: 'expense', amount: 0.001,
            description: 'KEEP', category: 'food', account: 'other-default', notes: 'Keep notes', legacyId: { obsolete: true } };
        const source = JSON.stringify(envelope ? { transactions: [input] } : [input]);
        h.files.set('source.json', source);
        await h.p.importTransactionsFromJSON('source.json');
        const { legacyId: discarded, ...expected } = input;
        assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.at(-1), expected);
        assert.equal(h.files.get('source.json'), source);
        assert.equal(h.writes.length, 1);
        await assert.rejects(h.p.importTransactionsFromJSON('source.json'), /duplicate transaction ID/);
        assert.equal(h.writes.length, 1);
    }
});

test('preparation uppercases descriptions without trimming whitespace, changing other values, or adding report counters', () => {
    const descriptions = ['  Mixed\tcase\nwords  ', 'caf\u00e9 stra\u00dfe', 'ALREADY UPPER', '123'];
    const input = descriptions.map((description, index) => Object.freeze(row({
        id: `20260410-113514-${String(index).padStart(8, '0')}`, time: '11:35:14', description,
        amount: 0.001, notes: 'Keep Case', metadata: { description: 'Do not change this' }
    })));
    const snapshot = plain(input);
    const result = importer.prepareTransactions(input, [], NOW);
    result.transactions.forEach((transaction, index) => assert.deepEqual(plain(transaction), {
        ...snapshot[index], description: descriptions[index].toUpperCase()
    }));
    assert.deepEqual(plain(input), snapshot);
    assert.ok(!importer.formatTransactionCorrections(result.corrections).some(line => /description|capital|uppercase/i.test(line)));
    const restart = importer.prepareTransactions(result.transactions, [], NOW);
    assert.equal(restart.changed, 0);
    assert.equal(importer.formatTransactionCorrections(restart.corrections).length, 0);
});

test('invalid batches never mutate descriptions while preparing uppercase conversion', () => {
    const input = [row({ description: 'keep original' }), row({ id: 'invalid', amount: -1 })];
    const original = plain(input);
    assert.throws(() => importer.prepareTransactions(input, [], NOW), /amount must/);
    assert.deepEqual(input, original);
});

test('envelope and array imports persist uppercase descriptions once without reporting capitalization', async () => {
    const input = [{ id: '20260410-113514-87654321', date: '2026-02-01', time: '11:35:14',
        type: 'expense', amount: 0.001, description: '  Keep\tspacing  ', category: 'food', account: 'other-default', notes: 'Keep notes' }];
    for (const payload of [input, { transactions: input, lastUpdated: 'source' }]) {
        const h = harness();
        const source = JSON.stringify(payload);
        h.files.set('source.json', source);
        await h.p.importTransactionsFromJSON('source.json');
        const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        assert.deepEqual(saved.at(-1), { ...input[0], description: '  KEEP\tSPACING  ' });
        assert.equal(h.files.get('source.json'), source);
        assert.deepEqual(h.writes, [h.p.transactionsFilePath]);
        assert.equal(h.notices[0], 'Imported 1 transaction. Changes saved.' + (Array.isArray(payload) ? ' Legacy array format converted: 1.' : ''));
        assert.equal(h.dialogs[0].contentEl.children.some(child => child.tag === 'ul'), Array.isArray(payload));
        assert.equal(importer.prepareTransactions([saved.at(-1)], [], NOW, h.p.getAccounts()).changed, 0);
    }
});

test('supplied QA envelope and legacy array both import without changing valid dates or explicit time', async () => {
    for (const payload of [qaExample, qaExample.transactions]) {
        const h = harness();
        h.files.set('qa.json', JSON.stringify(payload));
        await h.p.importTransactionsFromJSON('qa.json');
        const imported = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.slice(1);
        assert.equal(imported.length, 2);
        const expected = { ...qaExample.transactions[0] };
        delete expected.notes;
        assert.deepEqual(imported[0], expected);
        assert.ok(imported.every(transaction => !Object.hasOwn(transaction, 'notes')));
        assert.equal(imported[1].id, qaExample.transactions[1].id);
        assert.equal(imported[1].date, '2026-10-23');
        assert.equal(imported[1].time, '21:00:22');
        assert.equal(imported[1].category, 'other_expense');
        assert.equal(imported[1].amount, 124);
        const fields = Object.keys(imported[1]);
        assert.equal(fields.indexOf('time'), fields.indexOf('date') + 1);
        assert.deepEqual(h.writes, [h.p.transactionsFilePath]);
    }
});

test('envelope and array imports convert decimal-string amounts in one saved batch and report the exact count', async () => {
    const example = plain(qaExample);
    example.transactions[0].amount = '10';
    example.transactions[1].amount = '10.50';
    for (const payload of [example, example.transactions]) {
        const h = harness();
        const previous = plain(h.p.getAllTransactions());
        const source = JSON.stringify(payload);
        h.files.set('source.json', source);
        await h.p.importTransactionsFromJSON('source.json');
        const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
        const imported = saved.slice(previous.length);
        assert.deepEqual(saved.slice(0, previous.length), previous);
        assert.deepEqual(imported.map(transaction => transaction.amount), [10, 10.5]);
        assert.equal(imported.reduce((total, transaction) => total + transaction.amount, 0), 20.5);
        assert.deepEqual(imported.map(transaction => transaction.date), example.transactions.map(transaction => transaction.date));
        assert.equal(imported[0].time, example.transactions[0].time);
        assert.equal(h.files.get('source.json'), source);
        assert.deepEqual(h.writes, [h.p.transactionsFilePath]);
        assert.equal(h.dialogs.length, 1);
        const report = h.dialogs[0].contentEl.children.find(child => child.tag === 'ul').children.map(child => child.text);
        assert.ok(report.includes('Amounts converted from strings: 2'));
        assert.match(h.notices[0], /Amounts converted from strings: 2/);
        assert.equal(importer.prepareTransactions(imported, [], NOW, h.p.getAccounts()).changed, 0);
        const committed = h.files.get(h.p.transactionsFilePath);
        await assert.rejects(h.p.importTransactionsFromJSON('source.json'), /duplicate transaction ID/);
        assert.equal(h.files.get(h.p.transactionsFilePath), committed);
        assert.equal(h.writes.length, 1);
    }
});

test('invalid decimal batches do not partially import or create P0 persistence failures', async () => {
    for (const invalid of ['10,50', '9007199254740992', '0.10000000000000001']) {
        const h = harness();
        const input = plain(qaExample);
        input.transactions[0].amount = '10.50';
        input.transactions[1].amount = invalid;
        h.files.set('source.json', JSON.stringify(input));
        const before = JSON.stringify(h.p.transactionsData);
        const disk = h.files.get(h.p.transactionsFilePath);
        await assert.rejects(h.p.importTransactionsFromJSON('source.json'), error => {
            assert.equal(error.name, 'TransactionValidationError');
            assert.equal(error.index, 1);
            assert.equal(error.field, 'amount');
            assert.equal(h.p.saveErrors.has(error), false);
            return true;
        });
        assert.equal(JSON.stringify(h.p.transactionsData), before);
        assert.equal(h.files.get(h.p.transactionsFilePath), disk);
        assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
        assert.equal(h.p.protectedDatasets.size, 0);
    }
});

test('failed amount-conversion writes keep committed data and report conversions only after successful retry', async () => {
    const h = harness();
    const input = plain(qaExample);
    input.transactions[0].amount = '10.50';
    h.files.set('source.json', JSON.stringify(input));
    const before = JSON.stringify(h.p.transactionsData);
    const disk = h.files.get(h.p.transactionsFilePath);
    h.fail(true);
    await assert.rejects(h.p.importTransactionsFromJSON('source.json'), /disk full/);
    assert.equal(JSON.stringify(h.p.transactionsData), before);
    assert.equal(h.files.get(h.p.transactionsFilePath), disk);
    assert.equal(h.notices.length + h.dialogs.length, 0);
    h.fail(false);
    await h.p.importTransactionsFromJSON('source.json');
    assert.equal(h.p.getAllTransactions()[1].amount, 10.5);
    assert.equal(h.writes.length, 2);
    assert.equal(h.dialogs.length, 1);
    assert.match(h.notices[0], /Amounts converted from strings: 1/);
});

test('empty legacy categories use type-aware defaults and valid custom categories survive', () => {
    const input = [row({ id: 'expense', category: '' }), row({ id: 'income', type: 'income', category: null }),
        row({ id: 'missing', category: undefined }), row({ id: 'custom', category: 'custom-valid' })];
    assert.deepEqual(Array.from(importer.prepareTransactions(input, [], NOW).transactions, transaction => transaction.category),
        ['other_expense', 'other_income', 'other_expense', 'custom-valid']);
});

test('decimal-string amounts convert without currency rounding and existing numeric precision is preserved', () => {
    const values = ['10', '10.50', '0', '0.000', '0.001', '1.23456789', '0.0000001', '1.230000000000000000',
        '9007199254740991', 0, 1.23456789, 0.1 + 0.2, 1e-20, Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1];
    const input = values.map((amount, index) => ({ ...qaExample.transactions[0],
        id: `20261021-202211-${index.toString(36).padStart(8, '0')}`, amount, notes: 'Keep this note', metadata: { keep: index } }));
    const before = JSON.stringify(input);
    const result = importer.prepareTransactions(input, [], NOW, [models.DEFAULT_ACCOUNT]);
    const converted = values.filter(value => typeof value === 'string').length;
    assert.equal(JSON.stringify(input), before);
    assert.equal(result.changed, converted);
    assert.equal(result.corrections.amountsConvertedFromStrings, converted);
    assert.deepEqual(Array.from(importer.formatTransactionCorrections(result.corrections)), [`Amounts converted from strings: ${converted}`]);
    plain(result.transactions).forEach((transaction, index) => {
        assert.deepEqual(transaction, { ...input[index], amount: Number(values[index]) });
    });
    const restart = importer.prepareTransactions(plain(result.transactions), [], new Date('2027-01-01T00:00:00Z'), [models.DEFAULT_ACCOUNT]);
    assert.equal(restart.changed, 0);
    assert.equal(importer.formatTransactionCorrections(restart.corrections).length, 0);
});

test('ambiguous, nonfinite, out-of-range, and precision-losing amounts reject the complete batch', () => {
    const invalidAmounts = ['', ' ', ' 10', '10 ', '10\n', '01', '00.50', '+10', '-10', '-0', '.50', '10.',
        '10,50', '1,000', '1_000', '$10', '1e2', '1E-2', '0x10', '0b10', 'NaN', 'Infinity', '１２',
        '9007199254740992', '9'.repeat(400), '9007199254740990.5', '0.10000000000000001', '1.234567890123456789',
        `0.${'0'.repeat(400)}1`, null, true, false, {}, [], undefined, NaN, Infinity, -1];
    for (const amount of invalidAmounts) {
        const input = [row({ id: legacyId(), amount: '10.50' }), row({ amount })];
        const before = JSON.stringify(input);
        const guarded = load('src/transaction-import.ts', { './models': { ...models,
            generateId() { throw Error('must validate before allocating IDs'); } } });
        assert.throws(() => guarded.prepareTransactions(input, [], NOW), error => {
            assert.equal(error.name, 'TransactionValidationError', String(amount));
            assert.equal(error.index, 1);
            assert.equal(error.field, 'amount');
            assert.match(error.message, /^transactions\[1\]\.amount:/);
            return true;
        });
        assert.equal(JSON.stringify(input), before, String(amount));
        assert.equal(input[1].amount, amount);
    }
});

test('amount validation lists all invalid decimal values and account references without converting valid rows', () => {
    const input = [row({ id: 'first', amount: '10.50' }), row({ id: 'second', amount: '1,000' }),
        row({ id: 'third', amount: '9007199254740992' }), row({ id: 'fourth', amount: '0.10000000000000001' }),
        row({ id: 'fifth', amount: '0.001', account: 'saving-ghost' })];
    const before = JSON.stringify(input);
    assert.throws(() => importer.prepareTransactions(input, [], NOW, [models.DEFAULT_ACCOUNT]), error => {
        assert.deepEqual(Array.from(error.errors, issue => [issue.index, issue.field]), [[1, 'amount'], [2, 'amount'], [3, 'amount'], [4, 'account']]);
        assert.match(error.messages[0], /without leading zeros, signs, spaces, separators, or exponents/);
        assert.match(error.messages[1], /outside the supported range/);
        assert.match(error.messages[2], /lose precision/);
        return true;
    });
    assert.equal(JSON.stringify(input), before);
});

test('import validation reports a zero-based transaction index, field, and reason without storage errors', async () => {
    const h = harness();
    const input = plain(qaExample);
    input.transactions[1].amount = '124oops';
    h.files.set('qa.json', JSON.stringify(input));
    const before = JSON.stringify(h.p.transactionsData);
    await assert.rejects(h.p.importTransactionsFromJSON('qa.json'), error => {
        assert.ok(error instanceof importer.TransactionValidationError);
        assert.equal(error.index, 1);
        assert.equal(error.field, 'amount');
        assert.match(error.message, /^transactions\[1\]\.amount:.*nonnegative decimal string/);
        assert.equal(h.p.saveErrors.has(error), false);
        return true;
    });
    assert.equal(JSON.stringify(h.p.transactionsData), before);
    assert.equal(h.writes.length + h.dialogs.length + h.notices.length, 0);
    const owner = {};
    assert.equal(await h.p.runSaveOperation(owner, 'Import transactions', () => h.p.importTransactionsFromJSON('qa.json')), false);
    assert.equal(h.p.hasSaveFailure(owner), false);
    assert.equal(h.p.protectedDatasets.size, 0);
});

test('validation collects every field, duplicate, and account error throughout the complete batch', () => {
    const input = [row({ id: 'duplicate', date: '2026-02-31', amount: '10,00', time: '25:00:00', notes: 3, account: 'saving-ghost' }),
        row({ id: 'duplicate', type: 'internal', fromAccount: 'saving-missing', toAccount: 'saving-other' }),
        null, row({ id: 'last', description: 5 })];
    const before = JSON.stringify(input);
    assert.throws(() => importer.prepareTransactions(input, [], NOW, [models.DEFAULT_ACCOUNT]), error => {
        assert.ok(error instanceof importer.TransactionValidationError);
        assert.deepEqual(Array.from(error.errors, issue => [issue.index, issue.field]), [
            [0, 'amount'], [0, 'date'], [0, 'notes'], [0, 'time'], [0, 'account'],
            [1, 'id'], [1, 'fromAccount'], [1, 'toAccount'], [2, 'record'], [3, 'description']
        ]);
        assert.equal(error.messages.length, 10);
        assert.match(error.messages[9], /^transactions\[3\]\.description:/);
        return true;
    });
    assert.equal(JSON.stringify(input), before);
});

test('historical missing-account groups share canonical references and count transactions once across transfer fields', () => {
    const input = [row({ id: 'one', account: 'saving-Ghost' }), row({ id: 'two', account: 'saving-ghost' }),
        row({ id: 'three', type: 'internal', fromAccount: 'saving-ghost', toAccount: 'credit-lost' }),
        row({ id: 'four', type: 'internal', fromAccount: 'saving-ghost', toAccount: 'saving-Ghost' })];
    const before = JSON.stringify(input);
    assert.throws(() => importer.prepareTransactions(input, [], NOW, [models.DEFAULT_ACCOUNT], true, undefined, true), error => {
        assert.equal(error.canReconcileAccounts, true);
        assert.deepEqual(plain(error.missingAccounts), [
            { reference: 'saving-ghost', count: 4, locations: [{ index: 0, field: 'account' }, { index: 1, field: 'account' },
                { index: 2, field: 'fromAccount' }, { index: 3, field: 'fromAccount' }, { index: 3, field: 'toAccount' }] },
            { reference: 'credit-lost', count: 1, locations: [{ index: 2, field: 'toAccount' }] }
        ]);
        return true;
    });
    assert.equal(JSON.stringify(input), before);
    input[0].amount = 'invalid';
    assert.throws(() => importer.prepareTransactions(input, [], NOW, [models.DEFAULT_ACCOUNT], true), error => {
        assert.equal(error.canReconcileAccounts, false, 'other validation errors must block reconciliation');
        assert.equal(error.missingAccounts[0].count, 4);
        return true;
    });
});

test('invalid envelope metadata does not prevent scanning transaction fields and account references', () => {
    const content = JSON.stringify({ lastUpdated: 3, transactions: [row({ amount: '10,00', account: 'saving-ghost' })] });
    assert.throws(() => importer.parseTransactionImport(content, [row()], [models.DEFAULT_ACCOUNT]), error => {
        assert.deepEqual(Array.from(error.errors, issue => issue.field), ['lastUpdated', 'amount', 'id', 'account']);
        assert.match(error.messages[3], /unresolved account/);
        return true;
    });
});

test('malformed envelopes, metadata, and JSON are validation failures before mutation', async () => {
    for (const content of ['{broken', JSON.stringify({ transactions: {} }), JSON.stringify({ transactions: [], lastUpdated: 1 })]) {
        const h = harness();
        h.files.set('bad.json', content);
        await assert.rejects(h.p.importTransactionsFromJSON('bad.json'), error => {
            assert.ok(error instanceof importer.TransactionValidationError);
            assert.equal(h.p.saveErrors.has(error), false);
            return true;
        });
        assert.equal(h.writes.length + h.dialogs.length + h.notices.length, 0);
    }
    assert.equal(importer.parseTransactionImport('\uFEFF' + JSON.stringify(qaExample)).length, 2);
});

test('external selected files use the same atomic validation and never invent accounts', async () => {
    const h = harness();
    const source = { name: 'external.json', text: async () => JSON.stringify(qaExample) };
    await h.p.importTransactionsFromJSON(source);
    assert.equal(h.p.getAllTransactions().length, 3);
    const accounts = JSON.stringify(h.p.getAccounts());
    const bad = plain(qaExample);
    bad.transactions[0].id = 'new';
    bad.transactions[0].account = 'saving-ghost';
    bad.transactions = [bad.transactions[0]];
    await assert.rejects(h.p.importTransactionsFromJSON({ name: 'bad.json', text: async () => JSON.stringify(bad) }), /unresolved account/);
    assert.equal(JSON.stringify(h.p.getAccounts()), accounts);
    assert.equal(h.writes.length, 1);
});

test('migrated time immediately follows date while retaining unknown fields and stable restarts', () => {
    const input = row({ id: legacyId(), metadata: { keep: true } });
    const first = importer.prepareTransactions([input], [], NOW);
    const migrated = plain(first.transactions)[0];
    const keys = Object.keys(migrated);
    assert.equal(keys[keys.indexOf('date') + 1], 'time');
    assert.deepEqual(migrated.metadata, input.metadata);
    const second = importer.prepareTransactions([migrated], [], new Date('2027-01-01T00:00:00Z'));
    assert.equal(second.changed, 0);
    assert.equal(JSON.stringify(second.transactions), JSON.stringify(first.transactions));
});

test('opaque legacy IDs upgrade once without metadata, preserve valid fields, and use one fallback time', () => {
    const input = [row({ id: 'old-import-no-time-001', notes: 'Keep this', metadata: { custom: [1, 2] } }),
        row({ id: 'old-import-with-time-002', time: '23:59:58', legacyId: 'original-source-002' })];
    const before = JSON.stringify(input);
    const first = importer.prepareTransactions(input, [], NOW);
    assert.equal(JSON.stringify(input), before);
    assert.equal(first.corrections.alienIdsRegenerated, 2);
    assert.equal(first.corrections.timestampsGenerated, 1);
    assert.deepEqual(Array.from(importer.formatTransactionCorrections(first.corrections)), [
        'Alien IDs regenerated: 2', 'Time stamps generated: 1', 'Field order corrected: 1'
    ]);
    const output = plain(first.transactions);
    output.forEach((transaction, index) => {
        assert.match(transaction.id, /^\d{8}-\d{6}-[a-z0-9]{8}$/);
        assert.notEqual(transaction.id, input[index].id);
        for (const [field, value] of Object.entries(input[index])) {
            if (field !== 'id' && field !== 'legacyId') assert.deepEqual(transaction[field], value);
        }
        const fields = Object.keys(transaction);
        assert.equal(fields[fields.indexOf('date') + 1], 'time');
    });
    assert.equal(output[0].time, models.formatTime(NOW));
    assert.equal(output[0].legacyId, undefined);
    assert.equal(output[1].legacyId, undefined);
    const restart = importer.prepareTransactions(output, [], new Date('2027-01-01T00:00:00Z'));
    assert.equal(restart.changed, 0);
    assert.equal(restart.corrections.alienIdsRegenerated + restart.corrections.timestampsGenerated + restart.corrections.fieldOrderCorrected, 0);
    assert.equal(JSON.stringify(restart.transactions), JSON.stringify(first.transactions));
    const reimported = importer.prepareTransactions([input[0]], output, NOW).transactions[0];
    assert.ok(!output.some(transaction => transaction.id === reimported.id));
    assert.equal(reimported.legacyId, undefined);
});

test('existing valid time moves immediately after date without a timestamp or ID migration', () => {
    for (const input of [
        { time: '23:59:58', ...row({ notes: 'Keep spacing ', metadata: { keep: true } }) },
        { ...row({ notes: 'Keep spacing ', metadata: { keep: true } }), time: '23:59:58' }
    ]) {
        const original = JSON.stringify(input);
        const result = importer.prepareTransactions([input], [], NOW);
        const output = plain(result.transactions)[0];
        assert.deepEqual(output, input);
        assert.equal(JSON.stringify(input), original);
        const keys = Object.keys(output);
        assert.equal(keys[keys.indexOf('date') + 1], 'time');
        assert.equal(result.changed, 1);
        assert.deepEqual(Array.from(importer.formatTransactionCorrections(result.corrections)), ['Field order corrected: 1']);
        assert.equal(importer.prepareTransactions([output], [], NOW).changed, 0);
    }
});

test('ordering migrated time preserves special JSON keys without changing object prototypes', () => {
    const input = row();
    Object.defineProperty(input, '__proto__', { value: { retain: 'metadata' }, enumerable: true });
    const output = plain(importer.prepareTransactions([input], [], NOW).transactions)[0];
    assert.ok(Object.hasOwn(output, '__proto__'));
    assert.deepEqual(output.__proto__, { retain: 'metadata' });
    assert.equal({}.retain, undefined);
});

test('both current suffix formats recover time without rewriting dates or IDs', () => {
    for (const id of ['20260410-113514-1234abcd', '20260410-113514-z9y8x7w6']) {
        const input = row({ id });
        const result = importer.prepareTransactions([input], [], NOW);
        assert.equal(result.transactions[0].id, id);
        assert.equal(result.transactions[0].date, input.date);
        assert.equal(result.transactions[0].time, '11:35:14');
        assert.equal(result.corrections.timestampsRecovered, 1);
        assert.equal(result.corrections.timestampsGenerated, 0);
        assert.equal(result.corrections.legacyIdsRegenerated + result.corrections.alienIdsRegenerated, 0);
        assert.equal(input.time, undefined);
    }
});

test('timestamp reports distinguish recovery from fallback even when the resulting local times match', () => {
    const clock = models.formatTime(NOW);
    const prefix = `${models.formatDate(NOW).replace(/-/g, '')}-${clock.replace(/:/g, '')}-`;
    const input = [row({ id: `${prefix}1234abcd` }), row({ id: legacyId(NOW.toISOString()) }),
        row({ id: 'alien-without-time' }), row({ id: `${prefix}2345bcde`, time: clock })];
    const before = JSON.stringify(input);
    const result = importer.prepareTransactions(input, [], NOW);
    assert.equal(JSON.stringify(input), before);
    assert.ok(result.transactions.every(transaction => transaction.time === clock));
    assert.equal(result.corrections.timestampsRecovered, 2);
    assert.equal(result.corrections.timestampsGenerated, 1);
    const lines = Array.from(importer.formatTransactionCorrections(result.corrections));
    assert.ok(lines.includes('Time stamps recovered from IDs: 2'));
    assert.ok(lines.includes('Time stamps generated: 1'));
    const restart = importer.prepareTransactions(plain(result.transactions), [], new Date('2027-01-01T00:00:00Z'));
    assert.equal(restart.changed, 0);
    assert.equal(restart.corrections.timestampsRecovered + restart.corrections.timestampsGenerated, 0);
    assert.equal(importer.formatTransactionCorrections(restart.corrections).length, 0);
});

test('legacy base36 epochs migrate to local creation IDs without metadata and preserve explicit values', () => {
    const id = legacyId();
    const input = row({ id, time: '23:59:58', notes: 'Keep this', account: 'saving-cash' });
    const result = importer.prepareTransactions([input], [], NOW);
    const migrated = result.transactions[0];
    const created = new Date('2026-04-10T17:35:14.123Z');
    const prefix = `${models.formatDate(created).replace(/-/g, '')}-${models.formatTime(created).replace(/:/g, '')}-`;
    assert.ok(migrated.id.startsWith(prefix));
    assert.match(migrated.id, /^\d{8}-\d{6}-[a-z0-9]{8}$/);
    assert.equal(migrated.legacyId, undefined);
    for (const key of ['date', 'time', 'description', 'category', 'amount', 'account', 'notes']) assert.equal(migrated[key], input[key]);
    assert.equal(input.id, id);
    assert.equal(input.legacyId, undefined);
});

test('epoch recovery uses local time across day boundaries and Denver DST folds', () => {
    for (const instant of ['2026-04-10T00:01:02.123Z', '2026-11-01T07:30:01.123Z', '2026-11-01T08:30:01.123Z']) {
        // Use a later import date so these historical epochs are not in the future.
        const result = importer.prepareTransactions([row({ id: legacyId(instant) })], [], new Date('2026-12-01T12:00:00Z'));
        assert.equal(result.transactions[0].time, models.formatTime(new Date(instant)));
        assert.equal(result.transactions[0].date, '2026-02-01');
    }
    const example = importer.prepareTransactions([row({ id: 'ma4uzdibabcde' })], [], NOW).transactions[0];
    assert.equal(example.time, models.formatTime(new Date('2025-05-01T04:22:17.123Z')));
});

test('short historical random suffixes still recover the full eight-character epoch', () => {
    for (const suffix of ['i', 'abc', 'abcde']) {
        const id = legacyId(undefined, suffix);
        const migrated = importer.prepareTransactions([row({ id })], [], NOW).transactions[0];
        assert.equal(migrated.legacyId, undefined);
        assert.equal(migrated.time, models.formatTime(new Date('2026-04-10T17:35:14.123Z')));
    }
});

test('opaque, malformed, and future IDs receive one local fallback time', () => {
    const ids = ['custom-id', '20260231-113514-1234abcd', '20260410-253514-1234abcd', 'zzzzzzzzabcde', 'ma4uzdib', '00000000abcde'];
    const result = importer.prepareTransactions(ids.map(id => row({ id })), [], NOW);
    assert.deepEqual(Array.from(result.transactions, transaction => transaction.time), ids.map(() => models.formatTime(NOW)));
    assert.equal(result.corrections.alienIdsRegenerated, ids.length);
    assert.ok(result.transactions.every(transaction => /^\d{8}-\d{6}-[a-z0-9]{8}$/.test(transaction.id)));
    assert.ok(result.transactions.every(transaction => !Object.hasOwn(transaction, 'legacyId')));
    assert.equal(new Set(result.transactions.map(transaction => transaction.id)).size, ids.length);
    assert.equal(result.corrections.timestampsGenerated, 6);
});

test('missing and null legacy optional fields are filled without replacing valid values', () => {
    const input = [row({ time: null, notes: null, account: null }), row({ id: 'explicit', time: '00:00:00', notes: '', account: 'saving-cash' })];
    const result = importer.prepareTransactions(input, [], NOW);
    assert.equal(result.transactions[0].time, '11:35:14');
    assert.equal(Object.hasOwn(result.transactions[0], 'notes'), false);
    assert.equal(result.transactions[1].time, '00:00:00');
    assert.equal(Object.hasOwn(result.transactions[1], 'notes'), false);
    assert.equal(result.transactions[1].account, 'saving-cash');
});

test('notes remain strictly optional, empty properties are removed, and non-empty text is preserved verbatim', () => {
    const values = [undefined, null, '', ' \t\n', ' Keep spacing \nsecond line ', '0'];
    const base = { ...qaExample.transactions[0] };
    delete base.notes;
    const input = [{ ...base, metadata: { notes: '' } }, ...values.map((notes, index) => ({ ...base,
        id: `20261021-202211-${(index + 1).toString(36).padStart(8, '0')}`, notes, metadata: { notes: '' } }))];
    const before = JSON.stringify(input);
    const result = importer.prepareTransactions(input, [], NOW, [models.DEFAULT_ACCOUNT]);
    assert.equal(JSON.stringify(input), before);
    assert.equal(Object.hasOwn(input[1], 'notes'), true, 'input is never mutated');
    assert.equal(result.changed, 3, 'only null, empty, and whitespace notes change serialized JSON');
    assert.ok(result.transactions.slice(0, 5).every(transaction => !Object.hasOwn(transaction, 'notes')));
    assert.deepEqual(Array.from(result.transactions.slice(5), transaction => transaction.notes), values.slice(4));
    assert.ok(result.transactions.every(transaction => transaction.metadata.notes === ''));
    assert.equal(Object.hasOwn(result.corrections, 'notesInitialized'), false);
    assert.equal(importer.formatTransactionCorrections(result.corrections).length, 0);
    const repeated = importer.prepareTransactions(plain(result.transactions), [], NOW, [models.DEFAULT_ACCOUNT]);
    assert.equal(repeated.changed, 0);
    assert.equal(importer.formatTransactionCorrections(repeated.corrections).length, 0);
});

test('missing and empty notes do not disguise identical same-ID records before migration', () => {
    const base = { ...qaExample.transactions[0], id: legacyId() };
    delete base.notes;
    for (const notes of [undefined, null, '', ' \t\n']) {
        const guarded = load('src/transaction-import.ts', { './models': { ...models,
            generateId() { throw Error('identical copies must be checked before migration'); } } });
        assert.throws(() => guarded.prepareTransactions([base, { ...base, notes }], [], NOW, undefined, true), error => {
            assert.equal(error.name, 'TransactionValidationError');
            assert.match(error.message, /identical data in transactions\[0\] and transactions\[1\]/);
            return true;
        });
    }
});

test('imports omit missing and empty notes without notes reports, preserving non-empty notes and the source file', async () => {
    const base = { ...qaExample.transactions[0] };
    delete base.notes;
    const input = [{ ...base }, ...[null, '', ' \t\n', ' Keep exact text \nline two '].map((notes, index) => ({ ...base,
        id: `20261021-202211-${(index + 1).toString(36).padStart(8, '0')}`, notes }))];
    for (const payload of [input, { transactions: input }]) {
        const h = harness();
        const source = JSON.stringify(payload);
        h.files.set('source.json', source);
        await h.p.importTransactionsFromJSON('source.json');
        const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.slice(1);
        assert.ok(output.slice(0, 4).every(transaction => !Object.hasOwn(transaction, 'notes')));
        assert.equal(output[4].notes, input[4].notes);
        assert.deepEqual(output.map(transaction => transaction.date), input.map(transaction => transaction.date));
        assert.equal(h.files.get('source.json'), source);
        assert.equal(h.writes.length, 1);
        assert.equal(h.dialogs[0].contentEl.children.some(child => child.tag === 'ul'), Array.isArray(payload));
        assert.equal(h.notices[0], 'Imported 5 transactions. Changes saved.' + (Array.isArray(payload) ? ' Legacy array format converted: 1.' : ''));
    }
});

test('valid dates, ISO strings, zero amounts, and optional metadata survive migration', () => {
    const dates = ['0001-01-01', '0099-12-31', '2024-02-29', '2026-10-15T12:30:59.123Z', '2026-10-15T12:30:59-06:00', '2026-10-15T12:30', '9999-12-31'];
    const result = importer.prepareTransactions(dates.map((date, index) => row({ id: `date-${index}`, date, amount: 0, metadata: { label: 'keep' } })), [], NOW);
    assert.deepEqual(Array.from(result.transactions, transaction => transaction.date), dates);
    assert.ok(result.transactions.every(transaction => transaction.amount === 0 && transaction.metadata.label === 'keep'));
});

const invalidRows = [
    ['null', null], ['array', []], ['primitive', 5],
    ['missing ID', row({ id: undefined })], ['empty ID', row({ id: ' ' })], ['numeric ID', row({ id: 42 })],
    ['missing date', row({ date: undefined })], ['numeric date', row({ date: 20261015 })],
    ['rolled date', row({ date: '2026-02-31' })], ['nonleap date', row({ date: '2026-02-29' })],
    ['year zero', row({ date: '0000-01-01' })], ['bad month', row({ date: '2026-13-01' })],
    ['bad day', row({ date: '2026-04-31T12:00:00Z' })], ['timestamp hour', row({ date: '2026-01-01T24:00:00Z' })],
    ['timestamp zone', row({ date: '2026-01-01T12:00:00+25:00' })], ['date trailing text', row({ date: '2026-01-01junk' })],
    ['ambiguous string amount', row({ amount: '10,00' })], ['negative amount', row({ amount: -1 })], ['missing amount', row({ amount: undefined })],
    ['null amount', row({ amount: null })], ['boolean amount', row({ amount: true })],
    ['infinite amount', row({ amount: Infinity })], ['NaN amount', row({ amount: NaN })],
    ['unknown type', row({ type: 'other' })], ['missing type', row({ type: undefined })],
    ['description type', row({ description: {} })], ['empty description', row({ description: '' })],
    ['category type', row({ category: 1 })], ['boolean category', row({ category: false })],
    ['time type', row({ time: 100 })], ['time range', row({ time: '25:00:00' })], ['time precision', row({ time: '12:30' })],
    ['notes type', row({ notes: {} })], ['account type', row({ account: [] })], ['endpoint type', row({ fromAccount: 1 })],
    ['missing transfer endpoints', row({ type: 'internal' })],
    ['self transfer', row({ type: 'internal', fromAccount: 'saving-cash', toAccount: 'saving-cash' })]
];
for (const [name, invalid] of invalidRows) {
    test(`complete validation rejects ${name} before allocating IDs or mutating input`, () => {
        let generated = 0;
        const guarded = load('src/transaction-import.ts', { './models': { ...models, generateId() { generated++; throw Error('must not generate'); } } });
        const input = [row({ id: legacyId() }), invalid];
        const before = JSON.stringify(input);
        assert.throws(() => guarded.prepareTransactions(input, [], NOW), /transactions\[1\]\./);
        assert.equal(generated, 0);
        assert.equal(JSON.stringify(input), before);
    });
}

test('duplicate transaction IDs present in the batch or ledger reject the complete batch', () => {
    const original = row({ id: legacyId() });
    const migrated = importer.prepareTransactions([original], [], NOW).transactions[0];
    for (const [batch, existing] of [
        [[row(), row()], []], [[row()], [row()]],
        [[original, original], []], [[original], [original]], [[migrated], [migrated]]
    ]) assert.throws(() => importer.prepareTransactions(batch, existing, NOW), /duplicate/);
});

test('identical records are found before ID allocation regardless of object key order or decimal amount representation', () => {
    for (const id of [row().id, legacyId(), 'alien-duplicate']) {
        for (const duplicateIndex of [0, 1]) {
            const first = plain(row({ id, amount: '10.50', time: undefined, notes: undefined,
                metadata: { tags: ['one', 'two'], detail: { first: 1, second: 2 } } }));
            const distinct = { ...first, description: 'A different transaction' };
            const duplicate = Object.fromEntries(Object.entries([first, distinct][duplicateIndex]).reverse());
            duplicate.amount = 10.5;
            duplicate.metadata = { detail: { second: 2, first: 1 }, tags: ['one', 'two'] };
            const input = [first, distinct, duplicate];
            const before = JSON.stringify(input);
            const guarded = load('src/transaction-import.ts', { './models': { ...models,
                generateId() { throw Error('must detect identical records before migration'); } } });
            assert.throws(() => guarded.prepareTransactions(input, [], NOW, undefined, true), error => {
                assert.equal(error.name, 'TransactionValidationError');
                assert.equal(error.index, 2);
                assert.equal(error.field, 'id');
                assert.ok(error.message.includes(`identical data in transactions[${duplicateIndex}] and transactions[2]`));
                assert.match(error.action, /Review both records/);
                return true;
            });
            assert.equal(JSON.stringify(input), before);
        }
    }
});

test('distinct data under a shared ID still repairs, while different IDs with identical data remain legitimate', () => {
    for (const changes of [{ amount: 20 }, { description: 'Another transaction' }, { date: '2026-02-02' },
        { time: '22:33:44' }, { notes: 'Different notes' }, { metadata: { tags: ['two', 'one'] } }]) {
        const first = row({ time: '11:35:14', metadata: { tags: ['one', 'two'] } });
        const input = [first, { ...first, ...changes }];
        const result = importer.prepareTransactions(input, [], NOW, undefined, true);
        assert.equal(result.transactions.length, 2);
        assert.equal(result.transactions[0].id, first.id);
        assert.notEqual(result.transactions[1].id, first.id);
        assert.equal(result.corrections.duplicateIdsRegenerated, 1);
        for (const [field, value] of Object.entries(changes)) assert.deepEqual(plain(result.transactions)[1][field], field === 'description' ? value.toUpperCase() : value);
    }
    const first = row({ id: legacyId(), time: '11:35:14', metadata: { tags: ['one', 'two'] } });
    const input = [first, { ...first, id: legacyId(undefined, 'fghij') }];
    const result = importer.prepareTransactions(input, [], NOW, undefined, true);
    assert.equal(result.transactions.length, 2);
    assert.equal(new Set(result.transactions.map(transaction => transaction.id)).size, 2);
    assert.equal(result.corrections.duplicateIdsRegenerated, 0);
    assert.equal(result.corrections.legacyIdsRegenerated, 2);
    assert.ok(result.transactions.every(transaction => !Object.hasOwn(transaction, 'legacyId')));
});

test('imports reject identical copies atomically and identify the conflicting file indices', async () => {
    for (const envelope of [false, true]) {
        const h = harness();
        const first = { ...qaExample.transactions[0], id: legacyId(), time: undefined, amount: '10.50' };
        const input = [first, { ...first, description: 'Distinct collision' }, { ...first }];
        const source = JSON.stringify(envelope ? { transactions: input, lastUpdated: '2026-10-24' } : input);
        h.files.set('source.json', source);
        const memory = JSON.stringify(h.p.transactionsData);
        const disk = h.files.get(h.p.transactionsFilePath);
        await assert.rejects(h.p.importTransactionsFromJSON('source.json'), error => {
            assert.equal(error.name, 'TransactionValidationError');
            assert.equal(error.index, 2);
            assert.match(error.message, /identical data in transactions\[0\] and transactions\[2\]/);
            assert.equal(h.p.saveErrors.has(error), false);
            return true;
        });
        assert.equal(JSON.stringify(h.p.transactionsData), memory);
        assert.equal(h.files.get(h.p.transactionsFilePath), disk);
        assert.equal(h.files.get('source.json'), source);
        assert.equal(h.writes.length + h.notices.length + h.dialogs.length + h.p.protectedDatasets.size, 0);
    }
});

test('an identical imported record identifies its index and the conflicting existing ledger index', async () => {
    const h = harness();
    const identical = plain(h.p.getAllTransactions()[0]);
    h.files.set('source.json', JSON.stringify([qaExample.transactions[0], identical]));
    await assert.rejects(h.p.importTransactionsFromJSON('source.json'), error => {
        assert.match(error.message, /identical data in existing transactions\[0\] and transactions\[1\]/);
        return true;
    });
    assert.equal(h.p.getAllTransactions().length, 1);
    assert.equal(h.writes.length + h.notices.length + h.dialogs.length, 0);
});

test('imports safely repair distinct within-file ID collisions and retain source data and ordering', async () => {
    const h = harness();
    const first = { ...qaExample.transactions[0], notes: 'Keep notes' };
    const input = [first, { ...first, amount: 124, description: 'Distinct record' }];
    const source = JSON.stringify({ transactions: input });
    h.files.set('source.json', source);
    const existing = plain(h.p.getAllTransactions());
    await h.p.importTransactionsFromJSON('source.json');
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.deepEqual(saved.slice(0, 1), existing);
    assert.deepEqual(saved[1], input[0]);
    assert.notEqual(saved[2].id, input[1].id);
    assert.deepEqual({ ...saved[2], id: input[1].id }, { ...input[1], description: input[1].description.toUpperCase() });
    assert.equal(h.files.get('source.json'), source);
    assert.equal(h.writes.length, 1);
    assert.match(h.notices[0], /Duplicate IDs regenerated: 1/);
    const committed = h.files.get(h.p.transactionsFilePath);
    await assert.rejects(h.p.importTransactionsFromJSON('source.json'), /identical data in existing transactions\[1\] and transactions\[0\]/);
    assert.equal(h.files.get(h.p.transactionsFilePath), committed);
    assert.equal(h.writes.length, 1);
});

test('imports allow identical transaction data under different IDs', async () => {
    const h = harness();
    const first = { ...qaExample.transactions[0], notes: 'Keep notes' };
    const input = [first, { ...first, id: '20261021-202211-022e34fd' }];
    h.files.set('source.json', JSON.stringify(input));
    await h.p.importTransactionsFromJSON('source.json');
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.slice(1), input);
    assert.equal(h.writes.length, 1);
    assert.equal(h.notices[0], 'Imported 2 transactions. Changes saved. Legacy array format converted: 1.');
});

test('ID allocation reserves later rows and existing IDs, even with a repeated RNG result', () => {
    const candidate = '20260410-113514-00000000';
    const collisionImporter = load('src/transaction-import.ts', { './models': { ...models, generateId: () => candidate } });
    const result = collisionImporter.prepareTransactions([
        row({ id: legacyId() }), row({ id: candidate }), row({ id: legacyId(undefined, 'fghij') })
    ], [row({ id: '20260410-113514-00000001' })], NOW);
    assert.deepEqual(Array.from(result.transactions, transaction => transaction.id), [
        '20260410-113514-00000002', candidate, '20260410-113514-00000003'
    ]);
});

test('startup duplicate repair reserves actual IDs with repeated RNG and remains idempotent', () => {
    const candidate = '20260410-113514-00000000';
    const collisionImporter = load('src/transaction-import.ts', { './models': { ...models, generateId: () => candidate } });
    const input = [row({ id: candidate, time: '01:02:03' }), row({ id: candidate, time: '04:05:06' }),
        row({ id: '20260410-113514-00000001' }), row({ id: '20260410-113514-zzzzzzzz', legacyId: '20260410-113514-00000002' }),
        row({ id: candidate, time: '07:08:09' })];
    const before = JSON.stringify(input);
    assert.throws(() => collisionImporter.prepareTransactions(input, [], NOW), /duplicate/);
    const result = collisionImporter.prepareTransactions(input, [], NOW, undefined, true);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(Array.from(result.transactions, transaction => transaction.id), [candidate,
        '20260410-113514-00000002', '20260410-113514-00000001', '20260410-113514-zzzzzzzz', '20260410-113514-00000003']);
    assert.equal(result.corrections.duplicateIdsRegenerated, 2);
    assert.equal(result.transactions[1].time, '04:05:06');
    assert.equal(result.transactions[4].time, '07:08:09');
    const restart = collisionImporter.prepareTransactions(plain(result.transactions), [], NOW, undefined, true);
    assert.equal(restart.changed, 0);
    assert.ok(Object.values(restart.corrections).every(count => count === 0));
    assert.equal(importer.formatTransactionCorrections(restart.corrections).length, 0);
});

test('startup repair validates the whole batch before generating any replacement IDs', () => {
    const guarded = load('src/transaction-import.ts', { './models': { ...models,
        generateId() { throw Error('must not generate'); } } });
    for (const input of [[row(), row({ amount: '10,00' })],
        [row(), row({ id: 'second', date: '2026-02-31' })], [row(), row()]]) {
        assert.throws(() => guarded.prepareTransactions(input, [], NOW, undefined, true), error => error.name === 'TransactionValidationError');
    }
    assert.throws(() => guarded.prepareTransactions([row()], [row()], NOW, undefined, true), /duplicate/);
});

test('migration is idempotent for normalized exports without legacy metadata', () => {
    const first = importer.prepareTransactions([row({ id: legacyId() }), row({ id: 'opaque' })], [], NOW);
    const second = importer.prepareTransactions(plain(first.transactions), [], new Date('2027-01-01T00:00:00Z'));
    assert.deepEqual(plain(second.transactions), plain(first.transactions));
    assert.ok(Object.values(second.corrections).every(count => count === 0));
});

test('equal dates and recovered times retain JSON order through the shared sort and balance map', () => {
    const input = ['zzzzz', 'aaaaa', 'fffff'].map((suffix, index) => row({ id: legacyId(undefined, suffix), amount: index + 1 }));
    const migrated = importer.prepareTransactions(input, [], NOW).transactions;
    const sorted = models.sortTransactionsByDateTimeDesc(migrated, migrated);
    assert.deepEqual(Array.from(sorted, transaction => transaction.amount), input.map(transaction => transaction.amount));
    assert.deepEqual(Array.from(models.sortTransactionsByDateTimeDesc(sorted, migrated), transaction => transaction.id), Array.from(sorted, transaction => transaction.id));
    const balances = models.getRunningBalanceByTransactionId(migrated, migrated);
    assert.deepEqual(Object.keys(balances).sort(), Array.from(migrated, transaction => transaction.id).sort());
});

function harness() {
    const notices = [], dialogs = [], writes = [];
    class Element {
        constructor(options = {}) { this.text = options.text; this.children = []; this.listeners = {}; }
        createEl(tag, options) { const child = new Element(options); child.tag = tag; this.children.push(child); return child; }
        createDiv(options) { return this.createEl('div', options); }
        addClass() {}
        addEventListener(name, callback) { this.listeners[name] = callback; }
        empty() { this.children = []; }
    }
    class Modal {
        constructor(app) { this.app = app; this.contentEl = new Element(); this.containerEl = new Element(); this.modalEl = new Element(); }
        open() { dialogs.push(this); this.onOpen(); }
        close() { this.onClose(); }
    }
    const Plugin = load('main.ts', {
        obsidian: { Plugin: class {}, PluginSettingTab: class {}, Modal },
        './src/models': models, './src/transaction-import': importer,
        './src/dashboard-view': { EXPENSICA_VIEW_TYPE: 'expensica-dashboard-view' },
        './src/notice': { showExpensicaNotice: message => notices.push(message) },
        './src/data-recovery-modal': { DataRecoveryModal: class { open() {} refresh() {} close() {} } }
    }).default;
    const p = new Plugin();
    p.settings = { categories: models.DEFAULT_CATEGORIES, categoryEmojis: {}, categoryColors: {} };
    p.transactionsData = p.normalizeTransactionsSnapshot({ transactions: [row({ id: 'existing', time: '00:01:02' })],
        accounts: [{ ...models.DEFAULT_ACCOUNT }, { id: 'cash', type: 'saving', name: 'Cash', createdAt: '2026-01-01' }], lastUpdated: 'initial' });
    p.budgetData = { budgets: [], lastUpdated: 'initial' };
    const files = new Map([[p.transactionsFilePath, JSON.stringify({ transactions: p.getAllTransactions(), lastUpdated: 'initial' })]]);
    let fail = false, refreshes = 0;
    p.app = { vault: { adapter: {
        exists: async file => files.has(file), read: async file => { if (!files.has(file)) throw Error('read failed'); return files.get(file); },
        write: async (file, text) => { writes.push(file); if (fail) throw Error('disk full'); files.set(file, text); }
    } }, workspace: { getLeavesOfType: () => [], layoutReady: true,
        activeLeaf: { view: { getViewType: () => 'expensica-dashboard-view', containerEl: {} } } } };
    p.refreshExpensicaViews = async () => { refreshes++; };
    return { p, notices, dialogs, writes, files, fail(value) { fail = value; }, refreshes: () => refreshes };
}

test('import persists one normalized batch, preserves references, and shows the same summary once in both UI surfaces', async () => {
    const h = harness();
    const original = plain(h.p.getAllTransactions());
    const input = [row({ id: legacyId(), type: 'income', category: 'salary', account: 'saving-cash' }),
        row({ id: 'transfer', type: 'internal', category: 'internal', fromAccount: 'saving-cash', toAccount: 'other-default' }), row()];
    const source = JSON.stringify(input);
    h.files.set('source.json', source);
    await h.p.importTransactionsFromJSON('source.json');
    assert.deepEqual(h.writes, [h.p.transactionsFilePath]);
    assert.equal(h.files.get('source.json'), source);
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions;
    assert.deepEqual(saved.slice(0, 1), original);
    assert.equal(saved[1].account, 'saving-cash');
    assert.equal(saved[1].category, 'salary');
    assert.equal(saved[1].description, input[0].description);
    assert.equal(saved[2].fromAccount, 'saving-cash');
    assert.equal(saved[2].toAccount, 'other-default');
    assert.equal(saved[3].account, 'other-default');
    assert.ok(saved.slice(1).every(transaction => !Object.hasOwn(transaction, 'notes') && transaction.time));
    assert.deepEqual(plain(h.p.getAllTransactions()), saved);
    assert.equal(h.refreshes(), 1);
    assert.equal(h.notices.length, 1);
    assert.equal(h.dialogs.length, 1);
    const report = h.dialogs[0].contentEl;
    const summary = report.children.find(child => child.tag === 'p').text;
    const corrections = report.children.find(child => child.tag === 'ul').children.map(child => child.text);
    assert.equal(report.children.find(child => child.tag === 'h2').text, 'Transaction data update');
    assert.deepEqual(corrections, ['Legacy array format converted: 1', 'Base36 legacy IDs regenerated: 1', 'Alien IDs regenerated: 1',
        'Time stamps recovered from IDs: 2', 'Time stamps generated: 1', 'Accounts assigned: 1']);
    assert.equal(h.notices[0], `${summary} ${corrections.join('; ')}.`);
});

test('manual import upgrades the reported opaque ID and reports the saved migration once', async () => {
    const h = harness();
    const input = row({ id: 'old-import-no-time-001', account: 'other-default', notes: 'Keep notes' });
    const original = JSON.stringify({ transactions: [input], lastUpdated: '2026-10-21T12:00:00Z' });
    h.files.set('source.json', original);
    assert.equal(await h.p.importTransactionsFromJSON('source.json'), true);
    const migrated = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[1];
    assert.match(migrated.id, /^\d{8}-\d{6}-[a-z0-9]{8}$/);
    assert.equal(migrated.legacyId, undefined);
    assert.equal(migrated.date, input.date);
    assert.equal(migrated.time, models.formatTime(NOW));
    const fields = Object.keys(migrated);
    assert.equal(fields[fields.indexOf('date') + 1], 'time');
    assert.equal(h.files.get('source.json'), original);
    assert.equal(h.dialogs.length, 1);
    assert.match(h.notices[0], /Alien IDs regenerated: 1; Time stamps generated: 1/);
    h.files.set('normalized.json', JSON.stringify([migrated]));
    await assert.rejects(h.p.importTransactionsFromJSON('normalized.json'), /duplicate transaction ID/);
    assert.equal(h.writes.length, 1);
    assert.equal(h.dialogs.length + h.notices.length, 2);
});

test('import reports precise ID, account, category, notes, and field-order corrections after saving', async () => {
    const h = harness();
    h.p.settings.categories = [...models.DEFAULT_CATEGORIES, { id: 'custom', name: 'Custom', type: 'expense' }];
    const input = [row({ id: legacyId(), account: null, category: '', notes: null }),
        row({ id: 'alien-import', account: 'saving-Cash', category: 'custom', notes: 'Keep notes', time: '04:05:06' })];
    h.files.set('source.json', JSON.stringify({ transactions: input }));
    await h.p.importTransactionsFromJSON('source.json');
    const expected = ['Base36 legacy IDs regenerated: 1', 'Alien IDs regenerated: 1', 'Time stamps recovered from IDs: 1',
        'Accounts assigned: 1', 'Account references formatted: 1', 'Categories assigned: 1',
        'Field order corrected: 1'];
    const report = h.dialogs[0].contentEl;
    assert.equal(report.children[0].text, 'Transaction data update');
    assert.deepEqual(report.children.find(child => child.tag === 'ul').children.map(child => child.text), expected);
    assert.ok(h.notices[0].endsWith(`${expected.join('; ')}.`));
    assert.equal(h.writes.length, 1);
    const output = JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions.slice(1);
    assert.equal(output[1].category, 'custom');
    assert.equal(output[1].notes, 'Keep notes');
    assert.equal(output[1].time, '04:05:06');
    assert.deepEqual(output.map(transaction => transaction.date), input.map(transaction => transaction.date));
});

test('normalized imports report inserted records without inventing migrations; empty imports show no update report', async () => {
    const h = harness();
    const input = { id: row().id, date: row().date, time: '12:34:56', type: 'expense', amount: 10,
        description: 'UNCHANGED DETAILS', category: 'food', account: 'other-default' };
    h.files.set('source.json', JSON.stringify({ transactions: [input] }));
    await h.p.importTransactionsFromJSON('source.json');
    assert.deepEqual(JSON.parse(h.files.get(h.p.transactionsFilePath)).transactions[1], input);
    assert.equal(h.dialogs[0].contentEl.children.some(child => child.tag === 'ul'), false);
    assert.equal(h.notices[0], 'Imported 1 transaction. Changes saved.');
    const before = h.files.get(h.p.transactionsFilePath);
    h.files.set('empty.json', '{"transactions":[]}');
    await h.p.importTransactionsFromJSON('empty.json');
    assert.equal(h.files.get(h.p.transactionsFilePath), before);
    assert.equal(h.writes.length, 1);
    assert.equal(h.dialogs.length + h.notices.length, 2);
});

test('empty legacy-array import still saves a canonical envelope once and reports the format conversion', async () => {
    const h = harness();
    h.p.transactionsData.transactions = [];
    h.files.set(h.p.transactionsFilePath, JSON.stringify({ transactions: [], lastUpdated: 'original' }));
    h.files.set('legacy.json', '[]');
    await h.p.importTransactionsFromJSON('legacy.json');
    const saved = JSON.parse(h.files.get(h.p.transactionsFilePath));
    assert.deepEqual(saved.transactions, []);
    assert.equal(typeof saved.lastUpdated, 'string');
    assert.deepEqual(h.writes, [h.p.transactionsFilePath]);
    assert.equal(h.files.get('legacy.json'), '[]');
    assert.deepEqual(h.dialogs[0].contentEl.children.find(child => child.tag === 'ul').children.map(child => child.text), ['Legacy array format converted: 1']);
    assert.match(h.notices[0], /Legacy array format converted: 1/);
    h.files.set('canonical.json', '{"transactions":[]}');
    await h.p.importTransactionsFromJSON('canonical.json');
    assert.equal(h.writes.length, 1);
    assert.equal(h.notices.length, 1);
});

test('legacy self-transfer imports reject entire batches without rewriting the source or committed ledger', async () => {
    for (const id of [legacyId(), 'old-import-transfer']) for (const envelope of [false, true]) {
        const h = harness();
        const input = [row({ id: 'valid-new-row' }), row({ id, type: 'internal', category: 'internal', amount: 25,
            fromAccount: 'saving-cash', toAccount: 'SAVING-CASH' })];
        h.files.set('legacy.json', JSON.stringify(envelope ? { transactions: input } : input, null, 4));
        const files = [...h.files];
        const memory = JSON.stringify(h.p.transactionsData);
        await assert.rejects(h.p.importTransactionsFromJSON('legacy.json'), /transfer accounts must differ/);
        assert.deepEqual([...h.files], files);
        assert.equal(JSON.stringify(h.p.transactionsData), memory);
        assert.equal(h.writes.length + h.notices.length + h.dialogs.length + h.refreshes() + h.p.protectedDatasets.size, 0);
    }
});

test('invalid batches and duplicate IDs never write, refresh, publish memory, or show success', async () => {
    const invalid = [null, {}, [row({ id: 'new' }), row({ amount: '10,00' })], [row(), row()], [row({ id: 'existing' })],
        [row({ type: 'internal', fromAccount: 'saving-cash', toAccount: 'saving-Cash' })]];
    for (const input of invalid) {
        const h = harness();
        const before = JSON.stringify(h.p.transactionsData);
        const disk = h.files.get(h.p.transactionsFilePath);
        h.files.set('source.json', JSON.stringify(input));
        await assert.rejects(h.p.importTransactionsFromJSON('source.json'));
        assert.equal(JSON.stringify(h.p.transactionsData), before);
        assert.equal(h.files.get(h.p.transactionsFilePath), disk);
        assert.equal(h.writes.length, 0);
        assert.equal(h.notices.length + h.dialogs.length + h.refreshes(), 0);
    }
});

test('failed migrated writes retry cleanly; current IDs remain protected and original legacy files can be reimported', async () => {
    const h = harness();
    const source = JSON.stringify([row({ id: legacyId() })]);
    h.files.set('source.json', source);
    const before = JSON.stringify(h.p.transactionsData);
    const disk = h.files.get(h.p.transactionsFilePath);
    h.fail(true);
    await assert.rejects(h.p.importTransactionsFromJSON('source.json'), /disk full/);
    assert.equal(JSON.stringify(h.p.transactionsData), before);
    assert.equal(h.files.get(h.p.transactionsFilePath), disk);
    assert.equal(h.notices.length + h.dialogs.length + h.refreshes(), 0);
    h.fail(false);
    await h.p.importTransactionsFromJSON('source.json');
    const committed = h.files.get(h.p.transactionsFilePath);
    const reloaded = JSON.parse(committed).transactions;
    h.p.transactionsData.transactions = reloaded;
    h.files.set('normalized.json', JSON.stringify(reloaded.slice(1)));
    await assert.rejects(h.p.importTransactionsFromJSON('normalized.json'), /duplicate transaction ID/);
    assert.equal(h.files.get(h.p.transactionsFilePath), committed);
    assert.equal(h.writes.length, 2);
    assert.equal(h.notices.length, 1);
    assert.equal(await h.p.importTransactionsFromJSON('source.json'), true);
    assert.equal(h.p.getAllTransactions().length, 3);
    assert.equal(new Set(h.p.getAllTransactions().map(transaction => transaction.id)).size, 3);
    assert.equal(h.writes.length, 3);
    assert.equal(h.notices.length, 2);
    assert.ok(h.p.getAllTransactions().every(transaction => !Object.hasOwn(transaction, 'legacyId')));
});

test('protected datasets block imports before reads or writes', async () => {
    for (const dataset of ['accounts', 'transactions']) {
        const h = harness();
        h.p.protectDataset(dataset);
        const noticesBefore = h.notices.length;
        await assert.rejects(h.p.importTransactionsFromJSON('missing.json'), /protected/);
        assert.equal(h.writes.length + h.dialogs.length, 0);
        assert.ok(h.notices.slice(noticesBefore).every(message => message.includes('blocked')));
    }
});

test('a queued current-ID duplicate import rejects without poisoning later writes', async () => {
    const h = harness();
    h.files.set('source.json', JSON.stringify([row({ id: legacyId() })]));
    h.files.set('duplicate.json', JSON.stringify([row({ id: 'existing' })]));
    const results = await Promise.allSettled([h.p.importTransactionsFromJSON('source.json'), h.p.importTransactionsFromJSON('duplicate.json'),
        h.p.addTransaction(row({ id: 'later' }))]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
    assert.equal(h.p.getAllTransactions().length, 3);
    assert.equal(h.writes.length, 2);
});

test('UI failures after persistence do not offer a duplicate-producing import retry', async () => {
    const h = harness();
    h.files.set('source.json', JSON.stringify([row()]));
    h.p.refreshExpensicaViews = async () => { throw Error('render failed'); };
    assert.equal(await h.p.importTransactionsFromJSON('source.json'), true);
    assert.equal(h.writes.length, 1);
    assert.equal(h.p.getAllTransactions().length, 2);
});

if (!process.env.EXPENSICA_IMPORT_TZ_CHILD) {
    test('migration, fallback, and date validation work in Denver, Kiritimati, and Honolulu', () => {
        for (const timezone of ['America/Denver', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
            const environment = { ...process.env, TZ: timezone, EXPENSICA_IMPORT_TZ_CHILD: '1' };
            delete environment.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=epoch recovery|fallback time|valid dates|idempotent', __filename], {
                env: environment, encoding: 'utf8', timeout: 20000
            });
            assert.equal(child.error, undefined, child.error?.message);
            assert.equal(child.status, 0, `${timezone}\n${child.stdout}\n${child.stderr}`);
        }
    });
}
