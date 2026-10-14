const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename, dependencies = {}) {
    const sourcePath = path.join(__dirname, '../src', filename);
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, Date, require(name) {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    } }, { filename: sourcePath });
    return exports;
}

const models = load('models.ts');
const { AccountType, TransactionType: Type, formatAccountReference, parseAccountReference } = models;
const RangeType = {
    TODAY: 'today', THIS_WEEK: 'this_week', LAST_WEEK: 'last_week',
    THIS_MONTH: 'this_month', LAST_MONTH: 'last_month',
    THIS_YEAR: 'this_year', LAST_YEAR: 'last_year',
    ALL_TIME: 'all_time', CUSTOM: 'custom'
};
const { ExpensicaTransactionsView } = load('transactions-view.ts', {
    './models': models, obsidian: { Modal: class {} }, '../main': {}, './dashboard-view': { DateRangeType: RangeType },
    './confirmation-modal': {}, './notice': {}, './transaction-card': {},
    './category-chip': {}, './category-quick-menu': {}
});
const accounts = [
    { type: AccountType.CHEQUING, name: 'Debit' },
    { type: AccountType.SAVING, name: 'Savings' },
    { type: AccountType.CREDIT, name: 'Visa' }
];
const [debit, savings, visa] = accounts.map(account => formatAccountReference(account.type, account.name));
const normalize = reference => reference ? parseAccountReference(reference).reference : debit;
const plugin = {
    settings: { enableAccounts: true },
    getAccounts: () => accounts,
    getDefaultAccount: () => accounts[0],
    normalizeTransactionAccountReference: normalize,
    findAccountByReference: reference => accounts.find(account => formatAccountReference(account.type, account.name) === normalize(reference)) || null,
    getCategoryById: id => ['food', 'salary', 'internal'].includes(id) ? { id, name: id } : null,
    getCategoryEmoji: () => ''
};
function transaction(id, fields) {
    return { id, date: '2026-10-15', amount: 10, description: 'Entry', category: 'food', type: Type.EXPENSE, ...fields };
}
const transactions = [
    transaction('debit', { account: debit }),
    transaction('legacy', {}),
    transaction('savings', { account: savings }),
    transaction('visa', { account: visa }),
    transaction('savings-to-visa', { type: Type.INTERNAL, category: 'internal', fromAccount: savings, toAccount: visa }),
    transaction('debit-to-savings', { type: Type.INTERNAL, category: 'internal', fromAccount: debit, toAccount: savings }),
    transaction('visa-to-debit', { type: Type.INTERNAL, category: 'internal', fromAccount: visa, toAccount: debit }),
    transaction('stale-transfer-account', { type: Type.INTERNAL, category: 'internal', account: debit, fromAccount: savings, toAccount: visa }),
    transaction('stale-expense-endpoints', { account: visa, fromAccount: debit, toAccount: savings }),
    transaction('missing-transfer-endpoints', { type: Type.INTERNAL, category: 'internal' }),
    transaction('missing-transfer-source', { type: Type.INTERNAL, category: 'internal', toAccount: visa })
];
function view(overrides = {}) {
    return Object.assign(Object.create(ExpensicaTransactionsView.prototype), {
        plugin, transactions, filteredTransactions: [], selectedTransactionIds: new Set(),
        selectedAccountReferences: [], selectedTypeFilters: [], selectedCategoryIds: [], searchQuery: '',
        dateRange: { startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31) },
        pageSize: 20, currentPage: 1, totalPages: 1
    }, overrides);
}
function results(overrides) {
    const instance = view(overrides);
    instance.applyFilters();
    return Array.from(instance.filteredTransactions, transaction => transaction.id);
}

test('default account filter matches normal transactions and actual transfer endpoints only', () => {
    assert.deepEqual(results({ selectedAccountReferences: [debit] }), ['debit', 'legacy', 'debit-to-savings', 'visa-to-debit']);
});

test('account filters match either transfer endpoint and combine selected accounts without duplicates', () => {
    assert.deepEqual(results({ selectedAccountReferences: [savings] }), ['savings', 'savings-to-visa', 'debit-to-savings', 'stale-transfer-account']);
    assert.deepEqual(results({ selectedAccountReferences: [savings, visa] }), ['savings', 'visa', 'savings-to-visa', 'debit-to-savings', 'visa-to-debit', 'stale-transfer-account', 'stale-expense-endpoints', 'missing-transfer-source']);
});

test('account-name search uses the same actual accounts as account filters', () => {
    assert.deepEqual(results({ searchQuery: 'debit' }), ['debit', 'legacy', 'debit-to-savings', 'visa-to-debit']);
    for (const [reference, query] of [[debit, 'dEbIt'], [savings, 'SAVINGS'], [visa, 'visa']]) {
        assert.deepEqual(results({ searchQuery: query }), results({ selectedAccountReferences: [reference] }));
    }
});

test('normalized references match while unrelated or missing transfer accounts never become the default', () => {
    const rows = [
        transaction('normalized', { type: Type.INTERNAL, fromAccount: savings.toUpperCase(), toAccount: visa.toUpperCase() }),
        transaction('unrelated', { account: 'other-unknown' }),
        transaction('missing', { type: Type.INTERNAL, account: debit })
    ];
    assert.deepEqual(results({ transactions: rows, selectedAccountReferences: [debit] }), []);
    assert.deepEqual(results({ transactions: rows, selectedAccountReferences: [savings] }), ['normalized']);
});

test('account, type, category, date and search filters intersect and clamp pagination', () => {
    const rows = [
        transaction('match', { type: Type.INTERNAL, category: 'internal', fromAccount: savings, toAccount: visa }),
        transaction('wrong-date', { date: '2026-09-30', type: Type.INTERNAL, category: 'internal', fromAccount: savings, toAccount: visa }),
        transaction('wrong-type', { account: savings }),
        transaction('wrong-destination', { type: Type.INTERNAL, category: 'internal', fromAccount: savings, toAccount: debit })
    ];
    const instance = view({ transactions: rows, selectedAccountReferences: [savings], selectedTypeFilters: [Type.INTERNAL], selectedCategoryIds: ['internal'], searchQuery: 'visa', currentPage: 5, pageSize: 1 });
    instance.applyFilters();
    assert.deepEqual(Array.from(instance.filteredTransactions, row => row.id), ['match']);
    assert.equal(instance.currentPage, 1);
    assert.equal(instance.totalPages, 1);
});

test('removed filter values are cleared and disabling accounts clears account filters', () => {
    const instance = view({ selectedAccountReferences: ['other-deleted'], selectedCategoryIds: ['deleted'], selectedTypeFilters: ['deleted'] });
    instance.applyFilters();
    assert.equal(instance.filteredTransactions.length, transactions.length);
    const disabled = view({ plugin: { ...plugin, settings: { enableAccounts: false } }, selectedAccountReferences: [debit] });
    disabled.applyFilters();
    assert.equal(disabled.selectedAccountReferences.length, 0);
    assert.equal(disabled.filteredTransactions.length, transactions.length);
});

test('navigation filters clear conflicts and keep the selected date range', () => {
    const rows = [
        transaction('income', { type: Type.INCOME, category: 'salary', account: debit }),
        transaction('expense', { account: debit }),
        transaction('transfer', { type: Type.INTERNAL, category: 'internal', fromAccount: debit, toAccount: savings }),
        transaction('outside-range', { type: Type.INCOME, category: 'salary', date: '2026-09-30', account: debit })
    ];
    const instance = view({
        transactions: rows,
        searchQuery: 'no match',
        selectedCategoryIds: ['food'],
        selectedTypeFilters: [Type.EXPENSE],
        selectedAccountReferences: [visa],
        currentPage: 4
    });
    instance.persistTransactionsState = () => {};

    instance.applyNavigationFilter({ type: Type.INCOME });
    assert.deepEqual(Array.from(instance.filteredTransactions, row => row.id), ['income']);
    assert.equal(instance.currentPage, 1);
    assert.equal(instance.searchQuery, '');
    assert.deepEqual(Array.from(instance.selectedCategoryIds), []);
    assert.deepEqual(Array.from(instance.selectedAccountReferences), []);

    instance.applyNavigationFilter({ type: Type.EXPENSE });
    assert.deepEqual(Array.from(instance.filteredTransactions, row => row.id), ['expense']);

    instance.applyNavigationFilter({ accountReference: debit });
    assert.deepEqual(Array.from(instance.filteredTransactions, row => row.id), ['income', 'expense', 'transfer']);
    assert.deepEqual(Array.from(instance.selectedTypeFilters), []);
    assert.deepEqual(Array.from(instance.selectedAccountReferences), [debit]);
    assert.equal(instance.dateRange.startDate.getMonth(), 9);

    instance.applyNavigationFilter({ categoryId: 'salary' });
    assert.deepEqual(Array.from(instance.filteredTransactions, row => row.id), ['income']);
    assert.deepEqual(Array.from(instance.selectedTypeFilters), []);
    assert.deepEqual(Array.from(instance.selectedAccountReferences), []);
    assert.deepEqual(Array.from(instance.selectedCategoryIds), ['salary']);
});

test('selection is limited to transactions on the displayed page', () => {
    const rows = [
        transaction('first', { type: Type.INCOME, category: 'salary' }),
        transaction('second', {}),
        transaction('third', {})
    ];
    const instance = view({
        transactions: rows,
        pageSize: 1,
        selectedTransactionIds: new Set(['first', 'second', 'missing'])
    });
    instance.persistTransactionsState = () => {};
    instance.refreshTransactionsListOnly = () => {};

    instance.applyFilters(true);
    assert.deepEqual(Array.from(instance.selectedTransactionIds), ['first']);

    instance.setCurrentPage(2);
    assert.deepEqual(Array.from(instance.selectedTransactionIds), []);

    instance.selectedTransactionIds.add('second');
    instance.applyNavigationFilter({ type: Type.INCOME });
    assert.deepEqual(Array.from(instance.selectedTransactionIds), []);
});

test('saved preset date bounds are preserved when opening Transactions', () => {
    const instance = view();
    instance.applySharedDateRangeStateValues({
        type: RangeType.LAST_MONTH,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        customStartDate: null,
        customEndDate: null,
        updatedAt: 1
    });
    assert.equal(instance.dateRange.startDate.getFullYear(), 2026);
    assert.equal(instance.dateRange.startDate.getMonth(), 7);
    assert.equal(instance.dateRange.endDate.getMonth(), 7);
    assert.equal(instance.dateRange.endDate.getDate(), 31);
    assert.equal(instance.dateRange.endDate.getHours(), 23);
});

test('transaction shares use date-period totals and all active filters independently', () => {
    const rows = [
        transaction('expense-debit', { account: debit, amount: 20, description: 'Groceries' }),
        transaction('expense-savings', { account: savings, amount: 30 }),
        transaction('income-debit', { type: Type.INCOME, category: 'salary', account: debit, amount: 40 }),
        transaction('income-visa', { type: Type.INCOME, category: 'salary', account: visa, amount: 60 }),
        transaction('transfer', { type: Type.INTERNAL, category: 'internal', fromAccount: savings, toAccount: visa, amount: 1000 }),
        transaction('other-month-expense', { date: '2026-09-15', amount: 1000 }),
        transaction('other-month-income', { date: '2026-09-15', type: Type.INCOME, category: 'salary', amount: 1000 })
    ];
    const instance = view({ transactions: rows });
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: 100, income: 100 });

    instance.selectedAccountReferences = [debit];
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: 40, income: 40 });

    instance.selectedTypeFilters = [Type.EXPENSE, Type.INCOME];
    instance.selectedCategoryIds = ['food'];
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: 40, income: null });

    instance.selectedCategoryIds = [];
    instance.searchQuery = 'Groceries';
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: 40, income: null });

    instance.selectedTypeFilters = [Type.INCOME];
    instance.searchQuery = '';
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: null, income: 40 });

    instance.selectedTypeFilters = [Type.INTERNAL];
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: null, income: null });

    instance.selectedTypeFilters = [Type.EXPENSE, Type.INCOME];
    instance.dateRange = { startDate: new Date(2026, 10, 1), endDate: new Date(2026, 10, 30) };
    instance.applyFilters();
    assert.deepEqual({ ...instance.getTransactionShares() }, { spending: null, income: null });

    const roundedToZero = view({
        transactions: [transaction('tiny', { account: debit, amount: 0.01 }), transaction('large', { account: savings, amount: 100 })],
        selectedAccountReferences: [debit]
    });
    roundedToZero.applyFilters();
    assert.deepEqual({ ...roundedToZero.getTransactionShares() }, { spending: null, income: null });
});
