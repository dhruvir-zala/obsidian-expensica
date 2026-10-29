const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const ts = require('typescript');

const browser = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(candidate => candidate && fs.existsSync(candidate));

test('chart legend rows retain theme spacing across desktop, mobile, and account counts',
    { skip: !browser && 'Set CHROME_PATH to run the browser layout regression', timeout: 30000 }, () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-legend-layout-'));
        try {
            const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
            }).outputText;
            const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
            const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>${css}</style><style>
body { margin: 0; font-family: Arial, sans-serif; }
button { font-family: inherit; }
</style><main></main><script>
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
HTMLElement.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
HTMLElement.prototype.setCssProps = function(props) {
  for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
};
HTMLElement.prototype.setCssStyles = function(props) { Object.assign(this.style, props); };
HTMLElement.prototype.createEl = function(tag, options = {}) {
  if (typeof options === 'string') options = { cls: options };
  const node = document.createElement(tag);
  node.className = options.cls || ''; node.textContent = options.text || '';
  for (const [name, value] of Object.entries(options.attr || {})) node.setAttribute(name, value);
  this.append(node); return node;
};
HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
const dependencies = {
  obsidian: { Component: class {}, ItemView: class {}, Modal: class {} },
  'chart.js': { Tooltip: { positioners: {} } }
};
const require = name => dependencies[name] || {};
dependencies['./category-chip'] = (() => { const exports = {}; ${compile('src/category-chip.ts')}; return exports; })();
const dashboard = (() => { const exports = {}; ${compile('src/dashboard-view.ts')}; return exports; })();
const view = Object.create(dashboard.ExpensicaDashboardView.prototype);
const chart = { isDatasetVisible: index => index !== 1, getDataVisibility: index => index !== 1 };
const root = document.querySelector('main'), failures = []; let checks = 0;
function check(condition, context) { checks++; if (!condition) failures.push(context); }
for (const mobile of [false, true]) for (const dark of [false, true])
for (const width of [240, 320, 400, 800]) for (const accounts of [0, 1, 5]) {
  document.body.className = (mobile ? 'is-mobile ' : '') + (dark ? 'theme-dark' : 'theme-light');
  const small = dark ? 6 : 4, medium = dark ? 12 : 8;
  document.documentElement.style.setProperty('--size-2-2', small + 'px');
  document.documentElement.style.setProperty('--size-4-2', medium + 'px');
  root.setCssProps({ width: width + 'px', '--text-normal': dark ? '#eee' : '#222',
    '--background-secondary': dark ? '#222' : '#eee', '--background-modifier-border': '#888' });
  root.empty();
  const categories = root.createDiv('expensica-chart-html-legend');
  const income = root.createDiv('expensica-chart-html-legend expensica-income-expense-legend');
  const cumulative = root.createDiv('expensica-chart-html-legend expensica-cumulative-expenses-legend');
  const items = ['Income', 'Expenses', 'Net', ...Array.from({ length: accounts }, (_, i) => 'Account ' + i)]
    .map((label, datasetIndex) => ({ label, datasetIndex, color: '#3498db' }));
  view.renderCategoryExpensesLegend(categories, chart, items.map(item => ({ name: item.label, color: item.color, amount: 1 })));
  view.renderIncomeExpenseLegend(income, chart, items);
  view.renderCumulativeExpensesLegend(cumulative, items);
  for (const legend of [categories, income, cumulative]) {
    const context = { mobile, dark, width, accounts, legend: legend.className };
    const style = getComputedStyle(legend), buttons = [...legend.children];
    check(style.display === 'grid' && parseFloat(style.rowGap) === small && parseFloat(style.columnGap) === medium,
      { ...context, rowGap: style.rowGap, columnGap: style.columnGap });
    check(buttons.length === items.length && legend.scrollWidth <= legend.clientWidth + 1, context);
    const rects = buttons.map(button => button.getBoundingClientRect());
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i], rect = rects[i], buttonStyle = getComputedStyle(button);
      const left = rects.slice(0, i).filter(other => Math.abs(other.top - rect.top) < 0.5).at(-1);
      const previous = rects.find((other, j) => j < i && Math.abs(other.left - rect.left) < 0.5);
      check(rect.width > 0 && rect.width <= 130.5 && buttonStyle.marginTop === '0px' && buttonStyle.marginBottom === '0px', context);
      if (left) check(Math.abs(rect.left - left.right - medium) < 0.5, { ...context, index: i, gap: rect.left - left.right });
      if (previous) {
        const above = rects.slice(0, i).filter(other => Math.abs(other.left - rect.left) < 0.5).at(-1);
        check(Math.abs(rect.top - above.bottom - small) < 0.5, { ...context, index: i, gap: rect.top - above.bottom });
      }
    }
  }
  check(income.children[1].classList.contains('is-hidden') && getComputedStyle(income.children[0]).backgroundColor ===
    (dark ? 'rgb(34, 34, 34)' : 'rgb(238, 238, 238)'), { mobile, dark, width, accounts, state: 'theme and visibility' });
}
document.documentElement.setAttribute('data-layout-result', encodeURIComponent(JSON.stringify({ checks, failures })));
</script>`;
            const file = path.join(temporary, 'layout.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run',
                '--no-default-browser-check', '--disable-background-networking',
                `--user-data-dir=${path.join(temporary, 'profile')}`, '--window-size=800,900',
                '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-layout-result="([^"]+)"/);
            assert.ok(encoded, `browser must execute the layout assertions: ${result.stderr}`);
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.ok(report.checks > 500, 'must exercise actual rendered legends across all layouts');
            assert.equal(report.failures.length, 0, JSON.stringify(report.failures.slice(0, 3)));
        } finally {
            const resolved = path.resolve(temporary);
            assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
            assert.ok(path.basename(resolved).startsWith('expensica-legend-layout-'));
            fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
