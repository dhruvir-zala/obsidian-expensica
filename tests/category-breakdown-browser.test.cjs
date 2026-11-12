const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const ts = require('typescript');

const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'
].find(candidate => candidate && fs.existsSync(candidate));

test('daily category segments isolate their shares and interactions; trends use amounts from 100%',
    { skip: !browser && 'Set CHROME_PATH for focused browser coverage', timeout: 30000 }, () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-category-segments-'));
        try {
            const root = path.join(__dirname, '..');
            const sources = Object.fromEntries(['models', 'chart-tooltip', 'financial-metrics', 'visualizations/calendar-view'].map(name => [name,
                ts.transpileModule(fs.readFileSync(path.join(root, 'src', name + '.ts'), 'utf8'), {
                    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
                }).outputText
            ]));
            const html = `<!doctype html><meta charset="utf-8"><style>${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}</style>
<style>body { margin: 0; font-family: Arial; --text-normal: #222; --text-muted: #666;
--background-primary: white; --background-secondary: #eee; --background-modifier-border: #aaa;
--background-modifier-hover: #ddd; --text-success: green; --text-error: red; --interactive-accent: purple; }</style><body><script>
let clock = 1000, nextFrame = 0, reducedMotion = false;
const frames = new Map();
Object.defineProperty(performance, 'now', { value: () => clock });
window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
window.cancelAnimationFrame = id => frames.delete(id);
window.matchMedia = () => ({ matches: reducedMotion });
function advance(ms) { clock += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(clock)); }
</script><script>${fs.readFileSync(path.join(root, 'node_modules/d3/dist/d3.min.js'), 'utf8')}</script><script>
const sources = ${JSON.stringify(sources)}, cache = {}, failures = []; let checks = 0;
function check(value, label) { checks++; if (!value) failures.push(label); }
HTMLElement.prototype.createEl = function(tag, options = {}) {
 const element = document.createElement(tag); this.append(element);
 if (typeof options === 'string') options = { cls: options };
 if (options.cls) element.className = options.cls;
 if (options.text !== undefined) element.textContent = options.text;
 for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
 return element;
};
HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
HTMLElement.prototype.createSvg = function(tag, options = {}) {
 const element = document.createElementNS('http://www.w3.org/2000/svg', tag); this.append(element);
 for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
 element.createSvg = HTMLElement.prototype.createSvg; return element;
};
const obsidian = {
 setTooltip(element, text, options) { element.setAttribute('aria-label', text); element.tooltipOptions = options; },
 displayTooltip(element, text, options) {
  element.tip?.remove(); element.tip = document.body.createDiv({ cls: 'tooltip ' + options.classes.join(' '), text });
  element.addEventListener('mouseleave', () => element.tip?.remove(), { once: true });
 }
};
function load(name) {
 if (name === 'obsidian') return obsidian;
 if (name === 'd3') return window.d3;
 const key = name.startsWith('../') ? name.slice(3) : name.startsWith('./') ? name.slice(2) : name;
 if (!sources[key]) return {};
 if (!cache[key]) { cache[key] = {}; new Function('exports', 'require', sources[key])(cache[key], load); }
 return cache[key];
}
try {
 const { CalendarHeatmap } = load('visualizations/calendar-view');
 const { renderTrend } = load('financial-metrics');
 const names = { food: 'Food', travel: 'Travel', salary: 'Salary', bonus: 'Bonus' };
 const colors = { food: '#123456', travel: '#345678', salary: '#56789a', bonus: '#789abc' };
 const host = document.body.createDiv(); host.style.width = '420px';
 const review = Object.assign(Object.create(CalendarHeatmap.prototype), {
  plugin: { settings: { defaultCurrency: 'USD' }, getCategoryById: id => ({ id, name: names[id] }), getCategoryColor: id => colors[id] }
 });
 const rows = [
  { type: 'expense', category: 'food', amount: 10 }, { type: 'expense', category: 'food', amount: 20 },
  { type: 'expense', category: 'travel', amount: 10 }, { type: 'income', category: 'salary', amount: 1000 },
  { type: 'income', category: 'bonus', amount: 1000 }, { type: 'internal', category: 'internal', amount: 9999 }
 ];
 const render = (data, settle = true) => {
  d3.select(host).selectAll('*').interrupt(); host.replaceChildren(); review.renderDailyCategoryBreakdown(host, data);
  if (settle) { advance(0); advance(500); }
 };
 render(rows, false);
 check(host.querySelector('.expensica-category-bar').style.clipPath === 'inset(-15% 100% -15% 0px)'
  && host.querySelector('.expensica-category-segment-percentage').textContent === '0%', 'day entry starts empty with zero percentages');
 advance(0); advance(225);
 check(host.querySelector('.expensica-category-segment-percentage').textContent === '65.63%'
  && parseFloat(host.querySelector('.expensica-category-bar').style.clipPath.split(' ')[1]) > 0
  && parseFloat(host.querySelector('.expensica-category-bar').style.clipPath.split(' ')[1]) < 10,
  'day entry fills left to right over 500ms while percentages use the donut 450ms cubic-out timing');
 advance(275);
 check(!host.querySelector('.expensica-category-bar').style.clipPath
  && host.querySelector('.expensica-category-segment-percentage').textContent === '75%', 'day entry finishes and releases clipping for enlargement');
 render(rows);
 const bars = Array.from(host.querySelectorAll('.expensica-category-bar'));
 check(bars.length === 2 && bars.map(bar => bar.dataset.transactionType).join() === 'expense,income', 'one bar per expense/income type, excluding internal');
 check(bars.map(bar => bar.textContent).join() === '75%25%,50%50%', 'bar interiors contain only category percentages');
 const segments = Array.from(host.querySelectorAll('.expensica-category-segment'));
 check(segments.map(segment => segment.getAttribute('aria-label')).join('|')
  === 'Food: $30.00 (75%)|Travel: $10.00 (25%)|Salary: $1,000.00 (50%)|Bonus: $1,000.00 (50%)', 'short category tooltips preserve totals and type-specific shares');
 check(segments.map(segment => getComputedStyle(segment).backgroundColor).join()
  === 'rgb(18, 52, 86),rgb(52, 86, 120),rgb(86, 120, 154),rgb(120, 154, 188)', 'each segment uses its category color');
 check(Math.abs(segments[0].getBoundingClientRect().width / bars[0].getBoundingClientRect().width - 0.75) < 0.01, 'segment width matches its share');
 const segment = segments[0];
 const originalHeight = segment.getBoundingClientRect().height, originalWidth = segment.getBoundingClientRect().width;
 const originalTextHeight = segment.firstElementChild.getBoundingClientRect().height;
 segment.dispatchEvent(new Event('mouseenter')); advance(0); advance(225);
 check(segment.textContent === '65.63%'
  && Math.abs(segment.getBoundingClientRect().height / originalHeight - (1 + 0.3 * (1 - Math.pow(0.55, 4)))) < 0.001,
  'hover matches the donut timing: percentage=' + segment.textContent + ', height ratio=' + segment.getBoundingClientRect().height / originalHeight);
 check(segment.firstElementChild.getBoundingClientRect().height === originalTextHeight, 'percentage text retains its height during enlargement');
 segment.dispatchEvent(new Event('mouseleave')); advance(0); advance(100);
 const contractingHeight = segment.getBoundingClientRect().height;
 check(contractingHeight > originalHeight && contractingHeight < originalHeight * 1.3, 'interrupted enlargement contracts without a height-unit jump');
 segment.dispatchEvent(new Event('mouseenter')); advance(0); advance(500);
 check(Math.abs(segment.getBoundingClientRect().height / originalHeight - 1.3) < 0.001
  && segment.getBoundingClientRect().width === originalWidth
  && segments.slice(1).every(other => other.getBoundingClientRect().height === originalHeight)
  && bars.every(bar => getComputedStyle(bar).transform === 'none'), 'enlargement finishes at 500ms without moving other segments or changing shares');
 segment.dispatchEvent(new Event('mouseleave')); advance(0); advance(500);
 check(Math.abs(segment.getBoundingClientRect().height - originalHeight) < 0.001, 'leaving smoothly restores the original size');
 for (const event of ['mouseenter', 'mouseleave', 'focus', 'blur', 'click']) segment.dispatchEvent(new Event(event));
 check(segment.getAttribute('aria-expanded') === 'true' && segment.tip.classList.contains('expensica-chart-tooltip')
  && segment.tip.textContent === 'Food: $30.00 (75%)' && !segment.hasAttribute('title')
  && segments.slice(1).every(other => other.getAttribute('aria-expanded') === 'false'), 'hover/focus/tap tooltips affect only the chosen category');
 advance(0); advance(500);
 check(segment.classList.contains('is-active') && Math.abs(segment.getBoundingClientRect().height / originalHeight - 1.3) < 0.001,
  'tap/click enlarges the selected segment using the same transition as hover');
 segment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); advance(0); advance(500);
 check(!segment.classList.contains('is-active'), 'Escape dismisses the tooltip and restores segment size');
 const swatches = Array.from(host.querySelectorAll('.expensica-chart-legend-swatch'));
 for (const [index, swatch] of swatches.entries()) {
  for (const event of ['mouseenter', 'mouseleave', 'focus', 'blur', 'click']) swatch.dispatchEvent(new Event(event));
  check(swatch.getAttribute('aria-label') === ['Expenses', 'Income'][index]
   && swatch.tip.textContent === ['Expenses', 'Income'][index] && swatch.tip.classList.contains('expensica-chart-tooltip')
   && !swatch.hasAttribute('title'), 'type swatches share accessible hover/focus/tap tooltips ' + index);
  swatch.dispatchEvent(new Event('mouseleave'));
 }
 render(rows.map(row => row.category === 'bonus' ? { ...row, amount: 99000 } : row));
 check(host.querySelector('[data-transaction-type="expense"]').textContent === '75%25%', 'income never changes expense category percentages');
 for (const type of ['expense', 'income']) {
  render(rows.filter(row => row.type === type));
  check(host.querySelectorAll('.expensica-category-bar').length === 1, 'single-type day renders one bar ' + type);
 }
 for (const data of [[], rows.filter(row => row.type === 'internal'), [{ type: 'expense', category: 'food', amount: 0 }]]) {
  render(data); check(host.children.length === 0, 'empty, internal-only and zero-total days create no empty category panel');
 }
 render(rows);
 for (const width of [120, 240, 500]) {
  host.style.width = width + 'px';
  check(host.scrollWidth <= host.clientWidth + 1, 'segmented bars fit narrow and wide widths ' + width);
 }
 reducedMotion = true; render(rows, false);
 const still = host.querySelector('.expensica-category-segment');
 check(still.textContent === '75%' && !host.querySelector('.expensica-category-bar').style.clipPath, 'reduced motion settles entry and percentages immediately');
 still.dispatchEvent(new Event('click'));
 check(still.textContent === '75%' && Math.abs(still.getBoundingClientRect().height / originalHeight - 1.3) < 0.001
  && !still.__transition && !still.firstElementChild.__transition, 'reduced motion enlarges immediately without queued shape or counter transitions');
 reducedMotion = false;
 const trendHost = document.body.createDiv();
 for (const [current, previous, expected] of [[19.99, 10, '99.9%'], [20, 10, '$10.00'], [0, 10, '$10.00'], [1000, 10, '$990.00'], [5, 0, '$5.00'], [5, 0.001, '$5.00'], [5, -5, '$10.00']]) {
  trendHost.replaceChildren();
  renderTrend(trendHost, current, previous, 'USD', 'Nov, 2026');
  check(trendHost.textContent === expected, 'shared trend boundary/fallback ' + [current, previous]);
 }
 const range = { startDate: new Date(2026, 10, 1), endDate: new Date(2026, 10, 2), label: 'Nov 1–2, 2026', transactions: [{ type: 'expense', amount: 20 }] };
 review.detailsContainer = trendHost; review.getReviewRange = () => range;
 trendHost.replaceChildren(); review.renderDailyReviewMetrics({ date: new Date(2026, 10, 2), transactions: [{ type: 'expense', amount: 20 }] });
 const pill = trendHost.querySelector('.expensica-cash-flow-comparison');
 check(pill.textContent === '$10.00' && !pill.getAttribute('aria-label').includes('%'), 'daily trends show an amount rather than a dash or an extreme percentage');
 review.detailsContainer = host;
 review.renderDailyReviewMetrics = review.renderDailyAccountBalances = () => {};
 let dailyViews = 0, releasedDailyViews = 0;
 review.plugin.renderDailyReviewTransactions = () => { dailyViews++; return () => { releasedDailyViews++; }; };
 review.showDayDetails({ date: new Date(2026, 10, 2), formattedDate: 'Nov 2, 2026', transactions: rows });
 const previousElements = Array.from(host.querySelectorAll('.expensica-category-bar, .expensica-category-segment, .expensica-category-segment-percentage'));
 advance(0); advance(100);
 review.showDayDetails({ date: new Date(2026, 10, 3), formattedDate: 'Nov 3, 2026', transactions: [rows[2], rows[3]] });
 check(dailyViews === 2 && releasedDailyViews === 1, 'changing days deactivates the previous daily transaction renderer');
 check(previousElements.every(element => !element.isConnected && !element.__transition)
  && host.querySelector('.expensica-category-bar').style.clipPath === 'inset(-15% 100% -15% 0px)'
  && Array.from(host.querySelectorAll('.expensica-category-segment-percentage')).every(label => label.textContent === '0%'),
  'changing days mid-animation cancels detached transitions and starts the new bars and counters from zero');
 advance(0); advance(500);
 check(Array.from(host.querySelectorAll('.expensica-category-segment-percentage')).every(label => label.textContent === '100%')
  && Array.from(host.querySelectorAll('.expensica-category-bar')).every(bar => !bar.style.clipPath), 'the selected day finishes with only its own category shares');
 render(rows, false); advance(0); advance(100);
 const closing = Array.from(host.querySelectorAll('.expensica-category-bar, .expensica-category-segment, .expensica-category-segment-percentage'));
 review.container = host;
 review.destroy();
 review.destroy();
 check(releasedDailyViews === dailyViews, 'calendar teardown releases its last daily renderer exactly once');
 host.remove();
 check(closing.every(element => !element.__transition), 'calendar teardown cancels every detached D3 transition immediately');
} catch (error) { failures.push(error.stack); }
document.documentElement.setAttribute('data-result', encodeURIComponent(JSON.stringify({ checks, failures })));
</script>`;
            const file = path.join(temporary, 'category.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`,
                '--window-size=1000,800', '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-result="([^"]+)"/);
            assert.ok(encoded, result.stdout.slice(-1500));
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.deepEqual(report.failures, []);
            console.log(`${report.checks} focused category/trend assertions passed`);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('expensica-category-segments-'));
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
