const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename, dependencies = {}, globals = {}) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(compiled, { exports, Date, Intl, Uint8Array,
        console: { error() {} }, ...globals,
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    });
    return exports;
}

const models = load('src/models.ts');
const row = (id, fields = {}) => ({ id, date: '2026-10-15', type: 'expense', amount: 12.345,
    description: id, category: 'food', ...fields });
const categories = [{ id: 'food', name: 'Food', type: 'expense' },
    { id: 'salary', name: 'Salary', type: 'income' }, { id: 'internal', name: 'Internal', type: 'expense' }];
const options = fields => ({ format: 'csv', filename: 'report', dateFrom: null, dateTo: null,
    includeExpenses: true, includeIncome: true, categories: null, ...fields });
const plain = value => JSON.parse(JSON.stringify(value));

function service(window = {}) {
    return load('src/export-service.ts', { './models': models }, { window }).ExportService;
}

function pdfFixture(failure, output = new Uint8Array([37, 80, 68, 70]).buffer) {
    const tables = [], texts = [];
    const error = new Error(`PDF ${failure} failed`);
    function check(stage) { if (stage === failure) throw error; }
    class PDF {
        constructor() { check('constructor'); this.lastAutoTable = { finalY: 60 }; }
        setFontSize() { return this; }
        setTextColor() { return this; }
        text(text) { check('text'); texts.push(text); return this; }
        autoTable(table) { check('table'); tables.push(plain(table)); }
        addPage() { check('page'); }
        output(type) { assert.equal(type, 'arraybuffer'); check('output'); return output; }
    }
    return { ExportService: service({ jspdf: { jsPDF: PDF } }), tables, texts, error };
}

// Parse records independently, including embedded CR/LF and doubled quotes.
function parseCSV(csv) {
    const records = [];
    let fields = [], field = '', quoted = false;
    for (let i = 1; i < csv.length; i++) {
        const character = csv[i];
        if (character === '"') {
            if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
            else quoted = !quoted;
        } else if (!quoted && (character === ',' || character === '\n')) {
            fields.push(field); field = '';
            if (character === '\n') { records.push(fields); fields = []; }
        } else field += character;
    }
    assert.equal(quoted, false);
    assert.equal(field, '');
    return records;
}

test('export type filters keep transfers independent of both existing toggles', () => {
    const ExportService = service();
    const rows = [row('expense'), row('income', { type: 'income', category: 'salary' }),
        row('transfer', { type: 'internal', category: 'internal' })];
    for (const includeExpenses of [true, false]) for (const includeIncome of [true, false]) {
        const result = ExportService.filterTransactions(rows, options({ includeExpenses, includeIncome }));
        assert.deepEqual(Array.from(result, entry => entry.id), [
            ...(includeExpenses ? ['expense'] : []), ...(includeIncome ? ['income'] : []), 'transfer'
        ]);
    }
});

test('transfers obey inclusive local date and category filters in every format', () => {
    const ExportService = service();
    const rows = [row('before', { date: '2026-09-30', type: 'internal', category: 'internal' }),
        row('start', { date: '2026-10-01T23:00:00Z', type: 'internal', category: 'internal' }),
        row('end', { date: '2026-10-31', type: 'internal', category: 'internal' }),
        row('after', { date: '2026-11-01', type: 'internal', category: 'internal' }), row('expense')];
    for (const format of ['csv', 'pdf', 'json']) {
        const range = options({ format, dateFrom: '2026-10-01', dateTo: '2026-10-31' });
        assert.deepEqual(Array.from(ExportService.filterTransactions(rows, range), entry => entry.id), ['start', 'end', 'expense']);
        assert.deepEqual(Array.from(ExportService.filterTransactions(rows, { ...range, categories: ['internal'] }), entry => entry.id), ['start', 'end']);
        assert.deepEqual(Array.from(ExportService.filterTransactions(rows, { ...range, categories: ['food'] }), entry => entry.id), ['expense']);
        assert.equal(ExportService.filterTransactions(rows, { ...range, categories: [] }).length, 3);
    }
});

test('CSV round trips quotes, commas, LF and CR in every text column without changing values or layout', () => {
    const ExportService = service();
    for (const text of ['plain', 'A "quoted" category', 'one,two', 'line one\nline two', 'one\rtwo', '"a,b"\r\nc']) {
        const csv = ExportService.generateCSV([row('entry', { description: text, notes: text })],
            [{ id: 'food', name: text, type: 'expense' }]);
        assert.equal(csv[0], '\ufeff');
        assert.deepEqual(parseCSV(csv), [['Date', 'Type', 'Category', 'Description', 'Amount', 'Notes'],
            ['2026-10-15', 'Expense', text, text, '12.345', text]]);
    }
    assert.equal(parseCSV(ExportService.generateCSV([row('entry')], categories))[1][5], '');
});

test('CSV and PDF label all three types explicitly, including transfers without a category definition', () => {
    const fixture = pdfFixture();
    const rows = [row('expense'), row('income', { type: 'income', category: 'salary' }),
        row('transfer', { type: 'internal', category: 'internal' })];
    for (const definitions of [categories, categories.filter(category => category.id !== 'internal')]) {
        const csv = parseCSV(fixture.ExportService.generateCSV(rows, definitions)).slice(1);
        assert.deepEqual(Object.fromEntries(csv.map(fields => [fields[3], fields[1]])),
            { expense: 'Expense', income: 'Income', transfer: 'Transfer' });
        fixture.ExportService.generatePDF(rows, definitions);
        const body = fixture.tables.at(-1).body;
        assert.deepEqual(Object.fromEntries(body.map(fields => [fields[1], fields[3]])),
            { expense: 'Expense', income: 'Income', transfer: 'Transfer' });
        assert.equal(body.find(fields => fields[1] === 'transfer')[2], 'Internal');
    }
});

const ledger = () => [
    row('oct-first', { date: '2026-10-01', time: '12:00:00' }),
    row('sept', { date: '2026-09-30' }),
    row('equal-first', { date: '2026-10-20', time: '17:00:00' }),
    row('prior-year', { date: '2025-12-31' }),
    row('morning', { date: '2026-10-20', time: '09:00:00' }),
    row('equal-second', { date: '2026-10-20', time: '17:00:00' }),
    row('untimed-first', { date: '2026-10-20' }),
    row('next-year', { date: '2027-01-01' }),
    row('untimed-last', { date: '2026-10-20' }),
    row('20260101-130000-recovered', { date: '2026-10-20' }),
    row('midnight', { date: '2026-10-20', time: '00:00:00' })
];
const expectedOrder = ['next-year', 'equal-first', 'equal-second', '20260101-130000-recovered',
    'morning', 'midnight', 'untimed-last', 'untimed-first', 'oct-first', 'sept', 'prior-year'];

test('CSV/PDF sort original rows across days, months and years with deterministic timestamp ties', () => {
    const fixture = pdfFixture();
    const source = ledger();
    const before = JSON.stringify(source);
    source.forEach(Object.freeze);
    Object.freeze(source);
    for (const input of [source, [...source].reverse().map(entry => ({ ...entry })), [...source.slice(4), ...source.slice(0, 4)]]) {
        const csv = fixture.ExportService.generateCSV(input, categories, source);
        assert.deepEqual(parseCSV(csv).slice(1).map(fields => fields[3]), expectedOrder);
        fixture.tables.length = 0;
        fixture.texts.length = 0;
        fixture.ExportService.generatePDF(input, categories, 'USD', source);
        assert.deepEqual(fixture.texts.slice(3), ['January 2027', 'October 2026', 'September 2026', 'December 2025']);
        assert.deepEqual(fixture.tables.flatMap(table => table.body.map(fields => fields[1])), expectedOrder);
        assert.deepEqual(fixture.tables[1].body.map(fields => fields[0]),
            ['Oct 20', 'Oct 20', 'Oct 20', 'Oct 20', 'Oct 20', 'Oct 20', 'Oct 20', 'Oct 1']);
        assert.deepEqual(fixture.tables[0].head, [['Date', 'Description', 'Category', 'Type', 'Amount']]);
    }
    assert.equal(JSON.stringify(source), before);
});

test('PDF retains currency formatting and amount magnitudes; CSV retains exact numeric values', () => {
    const fixture = pdfFixture();
    const rows = [row('negative', { amount: -1234567.125 }), row('tiny', { amount: 0.001 })];
    for (const currency of ['USD', 'CAD', 'INR', 'JPY', 'KWD']) {
        fixture.ExportService.generatePDF(rows, categories, currency);
        const amounts = Object.fromEntries(fixture.tables.at(-1).body.map(fields => [fields[1], fields[4]]));
        for (const entry of rows) assert.equal(amounts[entry.id], new Intl.NumberFormat('en-US', {
            style: 'currency', currency, currencyDisplay: 'symbol'
        }).format(Math.abs(entry.amount)));
    }
    const amounts = Object.fromEntries(parseCSV(fixture.ExportService.generateCSV(rows, categories)).slice(1)
        .map(fields => [fields[3], fields[4]]));
    assert.deepEqual(amounts, { tiny: '0.001', negative: '-1234567.125' });
});

test('missing or inaccessible PDF library throws', () => {
    assert.throws(() => service().generatePDF([], categories), /jsPDF is not available/);
    const error = new Error('library access failed');
    assert.throws(() => service({ get jspdf() { throw error; } }).generatePDF([], categories), value => value === error);
});

for (const stage of ['constructor', 'text', 'table', 'output']) {
    test(`PDF propagates ${stage} errors unchanged`, () => {
        const fixture = pdfFixture(stage);
        assert.throws(() => fixture.ExportService.generatePDF([row('entry')], categories), error => error === fixture.error);
        const modal = modalFixture(fixture.ExportService);
        modal.modal.exportOptions.format = 'pdf';
        modal.modal.performExport();
        assert.equal(modal.downloads.length, 0);
        assert.equal(modal.closes(), 0);
        assert.deepEqual(modal.notices, ['Export failed. Please check the console for errors.']);
    });
}

test('PDF rejects empty or absent output', () => {
    for (const output of [new ArrayBuffer(0), null]) {
        assert.throws(() => pdfFixture(null, output).ExportService.generatePDF([], categories), /empty document/);
    }
});

function modalFixture(ExportService, source = ledger()) {
    const notices = [], downloads = [];
    let closes = 0;
    const { ExportModal } = load('src/export-modal.ts', {
        obsidian: { Modal: class {} }, './models': models, './export-service': { ExportService },
        './notice': { showExpensicaNotice: message => notices.push(message) }
    }, { document: { getElementById: () => ({ checked: true }) } });
    const plugin = { getAllTransactions: () => source, settings: { categories, defaultCurrency: 'USD' } };
    const modal = new ExportModal({}, plugin);
    modal.exportOptions = options();
    modal.downloadFile = (...args) => downloads.push(args);
    modal.close = () => { closes++; };
    return { modal, notices, downloads, closes: () => closes };
}

test('performExport reports PDF failures without downloading or closing and permits retry', () => {
    const window = {};
    const fixture = modalFixture(service(window));
    fixture.modal.exportOptions.format = 'pdf';
    fixture.modal.performExport();
    assert.deepEqual(fixture.notices, ['Export failed. Please check the console for errors.']);
    assert.equal(fixture.downloads.length, 0);
    assert.equal(fixture.closes(), 0);
    window.jspdf = { jsPDF: class {
        setFontSize() {} setTextColor() {} text() {} autoTable() { this.lastAutoTable = { finalY: 60 }; }
        output() { return new Uint8Array([37, 80, 68, 70]).buffer; }
    } };
    fixture.modal.performExport();
    assert.equal(fixture.downloads.length, 1);
    assert.equal(fixture.downloads[0][1], 'report.pdf');
    assert.equal(fixture.downloads[0][2], 'application/pdf');
    assert.equal(fixture.closes(), 1);
    assert.equal(fixture.notices.at(-1), 'Export completed successfully!');
});

test('performExport also rejects an empty PDF returned by a generator', () => {
    const fixture = modalFixture({ filterTransactions: rows => rows, generatePDF: () => new Uint8Array() });
    fixture.modal.exportOptions.format = 'pdf';
    fixture.modal.performExport();
    assert.equal(fixture.downloads.length, 0);
    assert.equal(fixture.closes(), 0);
    assert.deepEqual(fixture.notices, ['Export failed. Please check the console for errors.']);
});

test('performExport retains canonical tie ordering through filters without mutating the ledger', () => {
    const pdf = pdfFixture();
    const source = ledger();
    const before = JSON.stringify(source);
    for (const format of ['csv', 'pdf']) {
        const fixture = modalFixture(pdf.ExportService, source);
        fixture.modal.exportOptions = options({ format, dateFrom: '2026-10-20', dateTo: '2026-10-20' });
        fixture.modal.performExport();
        const expected = expectedOrder.slice(1, 8);
        const actual = format === 'csv' ? parseCSV(fixture.downloads[0][0]).slice(1).map(fields => fields[3])
            : pdf.tables.at(-1).body.map(fields => fields[1]);
        assert.deepEqual(actual, expected);
        assert.equal(fixture.closes(), 1);
    }
    assert.equal(JSON.stringify(source), before);
});

test('JSON exports retain original data and order; empty CSV retains its header', () => {
    const ExportService = service();
    const source = ledger();
    assert.deepEqual(JSON.parse(ExportService.generateJSON(source)), source);
    assert.deepEqual(parseCSV(ExportService.generateCSV([], categories)),
        [['Date', 'Type', 'Category', 'Description', 'Amount', 'Notes']]);
});

test('PDF groups accepted ISO dates by stored local day across year boundaries', () => {
    const fixture = pdfFixture();
    const rows = [row('old', { date: '2025-12-31T23:59:59-12:00' }),
        row('new', { date: '2026-01-01T00:00:00+14:00' })];
    fixture.ExportService.generatePDF(rows, categories);
    assert.deepEqual(fixture.texts.slice(3), ['January 2026', 'December 2025']);
    assert.deepEqual(fixture.tables.map(table => table.body[0].slice(0, 2)), [['Jan 1', 'new'], ['Dec 31', 'old']]);
    assert.deepEqual(parseCSV(fixture.ExportService.generateCSV(rows, categories)).slice(1).map(fields => fields[3]), ['new', 'old']);
});

test('PDF generates a real nonempty document with bundled jsPDF and autotable', () => {
    const { jsPDF } = require('jspdf');
    require('jspdf-autotable');
    const ExportService = service({ jspdf: { jsPDF } });
    for (const rows of [[], ledger()]) {
        const result = ExportService.generatePDF(rows, categories);
        assert.ok(result.byteLength > 0);
        assert.equal(Buffer.from(result.slice(0, 5)).toString(), '%PDF-');
    }
});
