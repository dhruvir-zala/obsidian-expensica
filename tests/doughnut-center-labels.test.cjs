const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const RealChart = require('chart.js/auto');
const { BasicPlatform, Tooltip } = require('chart.js');

function load(file, dependencies = {}, globals = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(code, { exports, Date, Intl, console, ...globals,
        require: name => dependencies[name] || (name.endsWith('/account-calculations') ? load('src/account-calculations.ts', { './models': dependencies['./models'] || dependencies['../models'] }) : undefined) || {} });
    return exports;
}
const models = load('src/models.ts');

function harness(amounts = [25, 75], currency = 'USD', mini = false) {
    const frames = new Map(), paints = [];
    let now = 0, nextFrame = 0;
    const styles = {
        fontFamily: 'Test Font', color: '#123456',
        getPropertyValue: name => ({
            '--expensica-font-size-donut-current': mini ? '24px' : '32px',
            '--expensica-font-size-donut-amount-current': mini ? '12px' : '20px',
            '--expensica-donut-label-gap': '4px'
        })[name] || ''
    };
    class Chart extends RealChart {
        constructor(canvas, config) { super(canvas, { ...config, platform: BasicPlatform }); }
    }
    const { ExpensicaDashboardView } = load('src/dashboard-view.ts', {
        obsidian: { Component: class {}, ItemView: class {}, Modal: class {} },
        './models': models, 'chart.js': { Tooltip }, 'chart.js/auto': { default: Chart }
    }, {
        performance: { now: () => now }, getComputedStyle: () => styles,
        document: { body: { classList: { contains: () => false } } },
        window: {
            requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
            cancelAnimationFrame: id => frames.delete(id)
        }
    });
    const canvas = { width: mini ? 160 : 400, height: mini ? 160 : 310,
        parentElement: { classList: { contains: () => mini } } };
    const ctx = new Proxy({ canvas, measureText: text => ({ width: String(text).length * 6 }), getLineDash: () => [],
        fillText(text, x, y, maxWidth) { paints.push({ text, x, y, maxWidth, font: this.font, color: this.fillStyle }); }
    }, { get: (target, property) => property in target ? target[property] : () => {} });
    canvas.getContext = () => ctx;
    const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
        plugin: { settings: { defaultCurrency: currency } },
        prepareChartCanvasSize() {}, getCssPixelValue: () => 8, getChartAnimationOptions: () => false, getChartResizeDelay: () => 0,
        getChartAnimationDuration: () => 0, getTooltipBackgroundColor: () => '#fff',
        getTooltipTitleColor: () => '#000', getTooltipBodyColor: () => '#000', getTooltipBorderColor: () => '#888',
        adjustColor: color => color, updateDashboardChartGridLayout() {}, syncChartsAfterCategoryLayoutChange() {}
    });
    const entries = values => values.map((amount, i) => ({ name: 'Category ' + i, amount, color: '#888888' }));
    view.createCategoryExpensesChart(canvas, null, entries(amounts));
    function draw() { paints.length = 0; view.expensesChart.draw(); return paints.map(paint => paint.text); }
    function settle() {
        now += 500;
        const callbacks = [...frames.values()]; frames.clear();
        for (const callback of callbacks) callback(now);
        return draw();
    }
    return { view, canvas, frames, paints, entries, draw, settle, styles,
        get chart() { return view.expensesChart; },
        close() { view.destroyCharts(); }
    };
}

for (const mini of [false, true]) {
    test(`${mini ? 'mini' : 'dashboard'} doughnut initially paints the filtered total in the existing center style`, () => {
        const h = harness([10.25, 20.5], 'CAD', mini);
        try {
            assert.deepEqual(h.paints.map(paint => paint.text), ['100%', models.formatCurrency(30.75, 'CAD')]);
            const [percentage, amount] = h.paints;
            const area = h.chart.chartArea;
            assert.equal(percentage.x, (area.left + area.right) / 2);
            assert.equal(percentage.y, (area.top + area.bottom) / 2);
            assert.equal(amount.x, percentage.x);
            assert.equal(amount.y, percentage.y + (mini ? 22 : 30));
            assert.equal(percentage.font, `700 ${mini ? 24 : 32}px Test Font`);
            assert.equal(amount.font, `400 ${mini ? 12 : 20}px Test Font`);
            assert.equal(percentage.color, '#123456');
            assert.equal(amount.maxWidth, Math.max(0, h.chart.getDatasetMeta(0).data[0].innerRadius * 2 - 8));
            assert.deepEqual(Array.from(h.chart.data.datasets[0].data), [10.25, 20.5]);
        } finally { h.close(); }
    });
}

test('hover retains existing segment formatting and mouseout restores the visible total', () => {
    const h = harness([1.234, 2.468], 'KWD');
    try {
        h.chart.setActiveElements([{ datasetIndex: 0, index: 0 }]);
        h.draw();
        assert.deepEqual(h.settle(), ['33.33%', models.formatCurrency(1.234, 'KWD')]);
        h.chart._eventHandler({ type: 'mouseout', native: { type: 'mouseout' }, x: null, y: null });
        assert.equal(h.chart.getActiveElements().length, 0);
        assert.deepEqual(h.draw(), ['100%', models.formatCurrency(3.702, 'KWD')]);
        assert.equal(h.frames.size, 0);
    } finally { h.close(); }
});

test('leaving during hover animation cancels pending frames and restores totals immediately', () => {
    const h = harness();
    try {
        h.settle();
        h.chart.setActiveElements([{ datasetIndex: 0, index: 0 }]);
        h.draw();
        assert.equal(h.frames.size, 1);
        h.chart._eventHandler({ type: 'mouseout', native: { type: 'mouseout' }, x: null, y: null });
        assert.deepEqual(h.draw(), ['100%', '$100.00']);
        assert.equal(h.frames.size, 0);
    } finally { h.close(); }
});

for (const values of [[0], [0, 0], []]) {
    test(`zero/empty data ${JSON.stringify(values)} paints zero labels, including after a populated chart update`, () => {
        const h = harness(values.length ? values : [0], 'JPY');
        try {
            assert.deepEqual(h.draw(), ['0%', models.formatCurrency(0, 'JPY')]);
            h.chart.data.datasets[0].data = [25, 75];
            h.chart.update('none');
            assert.deepEqual(h.draw(), ['100%', models.formatCurrency(100, 'JPY')]);
            h.chart.data.datasets[0].data = values;
            h.chart.update('none');
            assert.deepEqual(h.draw(), ['0%', models.formatCurrency(0, 'JPY')]);
        } finally { h.close(); }
    });
}

test('visibility and date-range updates recalculate defaults and hovered percentages without changing amounts', () => {
    const h = harness([10, 30, 60]);
    try {
        h.chart.toggleDataVisibility(2); h.chart.update('none');
        assert.deepEqual(h.draw(), ['100%', '$40.00']);
        h.chart.setActiveElements([{ datasetIndex: 0, index: 1 }]); h.draw();
        assert.deepEqual(h.settle(), ['75%', '$30.00']);
        h.chart.data.datasets[0].data = [20, 30, 60]; h.chart.update('none');
        assert.deepEqual(h.settle(), ['60%', '$30.00']);
        h.chart.toggleDataVisibility(1); h.chart.update('none');
        assert.deepEqual(h.draw(), ['100%', '$20.00']);
        h.chart.toggleDataVisibility(0); h.chart.update('none');
        assert.deepEqual(h.draw(), ['0%', '$0.00']);
        assert.deepEqual(Array.from(h.chart.data.datasets[0].data), [20, 30, 60]);
    } finally { h.close(); }
});

test('chart replacement and tab cleanup cancel hover work and initialize the next chart total', () => {
    const h = harness();
    try {
        h.settle();
        h.chart.setActiveElements([{ datasetIndex: 0, index: 0 }]); h.draw();
        const old = h.chart;
        h.view.createCategoryExpensesChart(h.canvas, null, h.entries([4, 8]));
        assert.equal(old.ctx, null);
        assert.deepEqual(h.draw(), ['100%', '$12.00']);
        h.settle();
        h.chart.setActiveElements([{ datasetIndex: 0, index: 1 }]); h.draw();
        h.view.destroyCharts();
        assert.equal(h.frames.size, 0);
        h.view.createCategoryExpensesChart(h.canvas, null, h.entries([0]));
        assert.deepEqual(h.draw(), ['0%', '$0.00']);
    } finally { h.close(); }
});
