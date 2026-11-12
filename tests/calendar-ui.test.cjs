const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

function load(file, dependencies = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(code, { exports, Date, Intl, require: name => dependencies[name] || {} });
    return exports;
}
const models = load('models');
const calendar = load('calendar-ui', { './models': models });

test('shared calendar enumerates local dates through leap years, boundaries and DST', () => {
    for (const [year, month, count] of [[2024, 1, 29], [2100, 1, 28], [1, 0, 31], [99, 11, 31],
        [9999, 11, 31], [2026, 2, 31], [2026, 10, 30], [2018, 10, 30]]) {
        const cells = [], selected = [], decorated = [];
        const days = {
            empty() { cells.length = 0; }, setAttribute() {},
            createSpan(options) { cells.push({ tag: 'span', ...options }); },
            createEl(tag, options) {
                const cell = { tag, ...options, attrs: {}, events: {},
                    setAttribute(key, value) { this.attrs[key] = value; }, toggleClass() {},
                    addEventListener(key, callback) { this.events[key] = callback; } };
                cells.push(cell); return cell;
            }
        };
        const monthKey = String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0');
        calendar.renderCalendarDays(days, year, month, {
            selectedDate: monthKey + '-01', today: monthKey + '-01', showWeekNumbers: true,
            onSelect: value => selected.push(value),
            decorateDay(button, date) { decorated.push(date); }
        });
        assert.equal(cells.length, 48);
        const buttons = cells.filter(cell => cell.tag === 'button');
        assert.equal(buttons.length, count);
        for (let day = 1; day <= count; day++) {
            const key = monthKey + '-' + String(day).padStart(2, '0');
            assert.equal(buttons[day - 1].attrs['data-date'], key);
            assert.equal(models.formatDate(decorated[day - 1]), key);
            assert.equal(decorated[day - 1].getHours(), 12);
        }
        buttons[0].events.click(); buttons.at(-1).events.click();
        assert.deepEqual(selected, [monthKey + '-01', monthKey + '-' + count]);
        assert.equal(buttons[0].attrs['aria-current'], 'date');
        assert.equal(buttons[0].attrs['aria-pressed'], 'true');
        assert.equal(buttons[1].attrs['aria-pressed'], 'false');
    }
});

test('local ISO weeks remain correct at year boundaries and after DST changes', () => {
    for (const [date, week] of [['2021-01-01', 53], ['2021-01-04', 1], ['2024-12-30', 1],
        ['2026-03-08', 10], ['2026-03-09', 11], ['2026-11-01', 44], ['2026-11-02', 45]]) {
        assert.equal(calendar.calendarWeekNumber(models.parseLocalDate(date, 12)), week, date);
    }
});

if (!process.env.EXPENSICA_SHARED_TZ_CHILD) {
    test('shared local calendar passes in DST and extreme-offset device timezones', () => {
        for (const TZ of ['America/Denver', 'America/Sao_Paulo', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
            const env = { ...process.env, TZ, EXPENSICA_SHARED_TZ_CHILD: '1' };
            delete env.NODE_TEST_CONTEXT;
            const child = spawnSync(process.execPath, ['--test', __filename], { env, encoding: 'utf8', timeout: 15000 });
            assert.equal(child.status, 0, `${TZ}: ${child.stdout}\n${child.stderr}`);
        }
    });
}
