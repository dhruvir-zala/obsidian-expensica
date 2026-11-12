const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const ts = require('typescript');

const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'
].find(candidate => candidate && fs.existsSync(candidate));

test('Account Balances centers wrapped rows without scrolling at every width and keeps responsive panels',
    { skip: !browser && 'Set CHROME_PATH to run responsive coverage', timeout: 30000 }, () => {
        const root = path.join(__dirname, '..');
        const sources = Object.fromEntries(['models', 'account-calculations', 'account-card', 'chart-tooltip', 'financial-metrics', 'dashboard-view'].map(name => [
            `./${name}`, ts.transpileModule(fs.readFileSync(path.join(root, `src/${name}.ts`), 'utf8'), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
            }).outputText
        ]));
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-account-balances-'));
        try {
            const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>.expensica-chart-container { margin-block: 8px; }
.expensica-dashboard, .expensica-container, .expensica-dashboard-grid { gap: 32px; }</style>
<style>${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}</style>
<style>:root { --background-primary: white; --text-normal: #222;
--text-muted: #666; --background-modifier-border: #ddd; --background-modifier-hover: #eee;
--text-accent: blue; --text-success: green; --text-error: red; --text-on-accent: white; --interactive-accent-rgb: 80, 80, 240; }
body { margin: 0; font-family: Arial, sans-serif; }
main { box-sizing: border-box; } .expensica-dashboard { box-sizing: border-box; width: 100%; }
.workspace-leaf-content[data-type="expensica-dashboard-view"] .view-content { gap: 32px; }
.workspace-leaf-content[data-type="expensica-dashboard-view"] .expensica-dashboard-grid { gap: 32px; }
.workspace-leaf-content[data-type="expensica-dashboard-view"] .expensica-chart-container { margin-block: 8px; }
</style><body><main class="workspace-leaf-content" data-type="expensica-dashboard-view"><div class="view-content expensica-dashboard"></div></main><script>
Element.prototype.createEl = function(tag, options = {}) {
 if (typeof options === 'string') options = { cls: options };
 const child = tag === 'svg' || this instanceof SVGElement
  ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
 if (options.cls) child.setAttribute('class', options.cls);
 child.textContent = options.text || '';
 for (const [key, value] of Object.entries(options.attr || {})) child.setAttribute(key, value);
 this.append(child); return child;
};
Element.prototype.empty = function() { this.replaceChildren(); };
Element.prototype.hasClass = function(name) { return this.classList.contains(name); };
Element.prototype.createDiv = function(options) { return this.createEl('div', options); };
Element.prototype.createSpan = function(options) { return this.createEl('span', options); };
Element.prototype.createSvg = Element.prototype.createEl;
Element.prototype.addClass = function(name) { this.classList.add(name); };
Element.prototype.removeClass = function(name) { this.classList.remove(name); };
Element.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
Element.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
Element.prototype.setCssProps = function(styles) { for (const [key, value] of Object.entries(styles)) this.style.setProperty(key, value); };
const lifecycle = { exports: {} };
new Function('module', ${JSON.stringify(fs.readFileSync(path.join(__dirname, 'fixtures/obsidian-component.cjs'), 'utf8'))})(lifecycle);
const { Component } = lifecycle.exports;
const shownTooltips = [];
const obsidian = { Component, ItemView: Component, Modal: class {},
 setTooltip(element, text) { element.setAttribute('aria-label', text); },
 displayTooltip(element, content) { shownTooltips.push(content); }, setIcon(element, name) { element.createSvg('svg', { attr: { 'data-icon': name, 'aria-hidden': 'true', viewBox: '0 0 24 24' } }); } };
const sources = ${JSON.stringify(sources)}, modules = {};
function load(name) {
 if (name === 'obsidian') return obsidian;
 if (name === 'chart.js') return { Tooltip: { positioners: {} }, animator: { running: () => false } };
 if (!sources[name]) return {};
 if (!modules[name]) { modules[name] = {}; new Function('exports', 'require', sources[name])(modules[name], load); }
 return modules[name];
}
const models = load('./models'), { ExpensicaDashboardView } = load('./dashboard-view');
const host = document.querySelector('main'), dashboard = host.firstElementChild;
const failures = []; let checks = 0;
function check(value, message) { checks++; if (!value) failures.push(message); }
function render(count, currency, large = false) {
 const accounts = Array.from({ length: count }, (_, index) => ({ id: String(index),
  name: large ? 'Very long account name ' + 'Reserve'.repeat(8) + index : ['Cash', 'Savings', 'Visa', 'Default'][index % 4] + index,
  type: ['chequing', 'saving', 'credit', 'other'][index % 4], isDefault: index === 0 }));
 const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
  plugin: { settings: { enableAccounts: true, defaultCurrency: currency }, getAccounts: () => accounts,
   normalizeTransactionAccountReference: value => value || 'chequing-cash0', openTransactionsView() {},
   findAccountByReference: reference => accounts.find(account => models.formatAccountReference(account.type, account.name) === reference),
   getAllTransactions: () => accounts.map(account => ({ type: account.type === 'credit' ? 'expense' : 'income',
    amount: large ? 1234567890123.456 : 1234.56, account: models.formatAccountReference(account.type, account.name) })) },
  dateRange: { type: 'this_month', startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31) },
  scheduleChartInitialization() {},
  getDefaultAccountBalanceThrough: () => 100,
  getAccountBalanceThroughDateTime: () => large ? 1234567890123.456 : 1234.56,
  getPreviousPeriodComparisonRange: () => ({ range: { startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 30) }, label: 'September' }),
  getResolvedDateRangeLegendLabel: () => 'Sep, 2026'
 });
 dashboard.replaceChildren(); view.renderSummary(dashboard);
 return view;
}
function run() {
 for (const mobile of [false, true]) for (const currency of ['USD', 'CAD', 'JPY', 'KWD'])
 for (const large of [false, true]) for (const width of [240, 320, 375, 430, 768, 1200]) for (const count of [0, 1, 2, 3, 8]) {
  document.body.classList.toggle('is-mobile', mobile); host.style.width = width + 'px';
  const view = render(count, currency, large), context = [mobile, currency, large, width, count].join('/');
  const panel = dashboard.querySelector('.expensica-account-balances-panel');
  const row = dashboard.querySelector('.expensica-account-balances-row'), viewport = row.parentElement;
  const cards = Array.from(row.querySelectorAll('.expensica-overview-card-balance')), boxes = Array.from(row.children).map(card => card.getBoundingClientRect());
  const overflow = row.scrollWidth > row.clientWidth + 1;
  check(host.scrollWidth <= host.clientWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1, 'panel fits ' + context);
  check(getComputedStyle(row).display === 'grid' && getComputedStyle(row).overflowX === 'visible', 'accounts always wrap without scrolling ' + context);
  check(!viewport.querySelector('.expensica-account-balances-scroll-button'), 'no carousel buttons ' + context);
  check(boxes.every(box => Math.abs(box.height - boxes.find(other => other.top === box.top).height) < 1), 'row height follows content ' + context);
  const bounds = row.getBoundingClientRect();
  check(!overflow && row.scrollHeight <= row.clientHeight + 1, 'all accounts fit without clipping ' + context);
  check(boxes.every(box => box.left >= bounds.left && box.right <= bounds.right + 1 && box.bottom <= bounds.bottom + 1), 'every account is visible ' + context);
  for (const top of new Set(boxes.map(box => box.top))) {
   const line = boxes.filter(box => box.top === top);
   check(Math.abs(line[0].left - boxes[0].left) < 1, 'wrapped rows start in the first grid column ' + context);
   check(line.every((box, index) => Math.abs(box.left - boxes[index].left) < 1), 'account columns align from left to right ' + context);
   if (top === boxes[0].top) check(Math.abs(line[0].left + line.at(-1).right - bounds.left - bounds.right) < 2, 'account grid is centered as a group ' + context);
  }
  if (count > 1 && !large && currency === 'USD' && row.clientWidth >= 304) check(boxes[0].top === boxes[1].top, 'multiple columns when they fit ' + context);
  for (let i = 1; i < boxes.length; i++) if (boxes[i].top === boxes[i - 1].top) check(Math.abs(boxes[i].left - boxes[i - 1].right - 8) < 1, 'compact card spacing ' + context);
  for (const card of cards) {
   const accountIcon = card.querySelector('.expensica-card-title svg');
   check(getComputedStyle(accountIcon).width === '16px' && getComputedStyle(accountIcon).opacity === '1',
    'account SVG grows two token steps with full opacity ' + context);
   const title = card.querySelector('.expensica-card-title');
   check(accountIcon.parentElement.style.color && getComputedStyle(title).color === 'rgb(34, 34, 34)', 'account label stays neutral while its icon uses the account color ' + context);
   check(card.scrollWidth <= card.clientWidth + 1, 'card content fits ' + context);
   check(parseFloat(getComputedStyle(card).borderRadius) >= 8, 'rounded card ' + context);
   check(getComputedStyle(card.querySelector('.expensica-card-value')).fontSize === '20px', 'shared metric typography ' + context);
   check(getComputedStyle(card).aspectRatio === 'auto' && card.scrollHeight <= card.clientHeight + 1, 'card height follows content without clipping ' + context);
   const owed = card.querySelector('.expensica-account-balances-owed');
   if (owed) check(owed.getBoundingClientRect().height > 0
    && owed.getBoundingClientRect().bottom <= card.querySelector('.expensica-card-trend').getBoundingClientRect().top,
    'Owed remains fully visible above the trend ' + context);
  }
  const footer = dashboard.querySelector('.expensica-account-balances-footer'), stats = Array.from(footer.children);
  const statBoxes = stats.map(stat => stat.getBoundingClientRect());
  check(stats.length === 3, 'equal footer slots ' + context);
  check(footer.scrollWidth <= footer.clientWidth + 1 && stats.every(stat => stat.scrollWidth <= stat.clientWidth + 1), 'footer fits ' + context);
  check(stats[1].querySelector('.expensica-cash-flow-label').textContent.trim() === 'Debts:', 'Debts retain the middle ordering ' + context);
  for (const stat of stats) {
   const label = stat.querySelector('.expensica-cash-flow-label'), amount = stat.querySelector('.expensica-card-value'), pill = stat.querySelector('.expensica-card-trend');
   check(!label.querySelector('svg'), 'summary label has no SVG ' + context);
   check(getComputedStyle(label).opacity === '1' && getComputedStyle(amount).opacity === '1' && getComputedStyle(pill.lastElementChild).opacity === '1', 'summary text has full opacity ' + context);
   check(Math.abs(pill.getBoundingClientRect().top - stat.querySelector('.expensica-metric-total').getBoundingClientRect().bottom - 8) < 1, 'summary vertical gaps use exactly 8px ' + context);
   check(!stat.hasAttribute('title') && !stat.hasAttribute('aria-label'), 'summary has no card hover tooltip ' + context);
   check(stat.querySelectorAll('.expensica-account-balances-comparison').length === 1, 'summary has one compact trend pill ' + context);
   check(getComputedStyle(amount).fontSize === '12px' && getComputedStyle(amount).textOverflow !== 'ellipsis', 'amount uses Cash Flow sizing without clipping ' + context);
   check(label.parentElement === amount.parentElement && label.parentElement.classList.contains('expensica-metric-total'), 'label and amount share one line container ' + context);
  }
  view.unload();
 }
 document.body.classList.remove('is-mobile'); host.style.width = '768px';
 const semanticView = render(8, 'USD'), definitions = semanticView.plugin.getAccounts();
 const currentBalances = [200, 50, 200, 100, 200, 50, 50, 100.04];
 semanticView.plugin.getAllTransactions = () => definitions.map((account, index) => ({
  type: account.type === 'credit' ? 'expense' : 'income', amount: currentBalances[index],
  account: models.formatAccountReference(account.type, account.name)
 }));
 semanticView.getAccountBalanceThroughDateTime = (reference, date) => date.getMonth() === 8 ? 100
  : currentBalances[definitions.findIndex(account => models.formatAccountReference(account.type, account.name) === reference)];
 dashboard.replaceChildren(); semanticView.renderSummary(dashboard);
 const semanticCards = definitions.map(account => Array.from(dashboard.querySelectorAll('.expensica-overview-card-balance'))
  .find(card => card.querySelector('.expensica-card-title').textContent === account.name));
 const expectedColors = ['rgb(0, 128, 0)', 'rgb(255, 0, 0)', 'rgb(255, 0, 0)', null,
  'rgb(0, 128, 0)', 'rgb(255, 0, 0)', 'rgb(0, 128, 0)', 'rgb(0, 128, 0)'];
 semanticCards.forEach((card, index) => {
  const pill = card.querySelector('.expensica-account-balances-comparison'), svg = pill.querySelector('svg');
  check(getComputedStyle(card.querySelector('.expensica-card-value')).color === getComputedStyle(card.querySelector('.expensica-card-title svg')).color, 'amounts follow their account color ' + index);
  check(getComputedStyle(pill).backgroundColor === 'rgb(238, 238, 238)', 'account pill backgrounds are unchanged ' + index);
  if (expectedColors[index]) {
   check(getComputedStyle(pill.querySelector('.expensica-card-trend-indicator')).color === expectedColors[index], 'credit-aware SVG color ' + index);
   check(svg.querySelectorAll('polyline')[1].getAttribute('points') === (currentBalances[index] > 100
    ? '16 7 22 7 22 13' : '16 17 22 17 22 11'), 'up/down SVG matches numeric direction ' + index);
  } else check(!svg && pill.textContent === '0%', 'displayed zero trend has no icon ' + index);
 });
 semanticCards[2].querySelector('.expensica-card-trend').dispatchEvent(new Event('focus'));
 check(typeof shownTooltips.at(-1) === 'string' && shownTooltips.at(-1).startsWith('More than $100.00 from ' + semanticView.formatChartTooltipMonthTitle(new Date(2026, 8, 30)) + '.'), 'tooltip contains only compact change text');
 semanticCards[3].querySelector('.expensica-card-trend').dispatchEvent(new Event('focus'));
 check(shownTooltips.at(-1) === '0% ($0.00) from ' + semanticView.formatChartTooltipMonthTitle(new Date(2026, 8, 30)) + '.', 'unchanged tooltip contains only neutral text');
 let accountOpens = 0;
 semanticView.switchDashboardTab = () => check(false, 'account editing must not switch tabs');
 semanticView.openAccountEditor = () => { accountOpens++; };
 const interactiveCard = semanticCards[0], interactivePill = interactiveCard.querySelector('.expensica-card-trend');
 const beforeCardHover = shownTooltips.length;
 check(interactiveCard.getAttribute('aria-label').startsWith('Your ') && !interactiveCard.hasAttribute('title'), 'account balance tooltip uses accessible text without native title');
 interactiveCard.dispatchEvent(new Event('mouseenter'));
 check(shownTooltips.length === beforeCardHover + 1, 'account card hover shows its balance tooltip');
 interactivePill.dispatchEvent(new Event('mouseleave'));
 interactivePill.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
 interactivePill.focus(); interactivePill.click();
 check(interactivePill.getAttribute('aria-expanded') === 'true' && accountOpens === 0, 'first touch opens the independent trend tooltip despite focus-before-click');
 interactivePill.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })); interactivePill.click();
 check(interactivePill.getAttribute('aria-expanded') === 'false' && accountOpens === 0, 'second touch switches the trend tooltip off');
 for (const key of ['Enter', ' ', 'Escape']) {
  interactivePill.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  check(accountOpens === 0, 'trend keyboard events never open an account');
 }
 interactivePill.dispatchEvent(new Event('mouseenter')); interactivePill.click();
 check(interactivePill.getAttribute('aria-expanded') === 'false', 'click on a hover-visible tooltip switches it off');
 interactiveCard.click(); check(accountOpens === 1, 'ordinary account card click opens its editor');
 const infoButton = dashboard.querySelector('.expensica-account-balances-header button');
 infoButton.click(); check(infoButton.getAttribute('aria-expanded') === 'true', 'account info switches on');
 infoButton.click(); check(infoButton.getAttribute('aria-expanded') === 'false', 'account info switches off');
 semanticView.getTransactionsForDateRange = () => [{ type: 'income', amount: 100 }, { type: 'expense', amount: 100 }];
 for (const [income, expenses, colors] of [[200, 50, ['rgb(0, 128, 0)', 'rgb(255, 0, 0)', 'rgb(0, 128, 0)']],
  [100, 100, Array(3).fill('rgb(238, 238, 238)')]]) {
  const flowHost = host.createDiv();
  semanticView.transactions = [{ type: 'income', amount: income }, { type: 'expense', amount: expenses }];
  semanticView.renderCashFlow(flowHost);
  const info = flowHost.querySelector('.expensica-cash-flow-info');
  info.click(); check(info.getAttribute('aria-expanded') === 'true', 'Cash Flow info switches on');
  info.click(); check(info.getAttribute('aria-expanded') === 'false', 'Cash Flow info switches off');
  const pills = Array.from(flowHost.querySelectorAll('.expensica-cash-flow-comparison'));
  check(pills.every(pill => getComputedStyle(pill).backgroundColor === 'rgb(238, 238, 238)'), 'cash flow uses the account trend surface');
  check(pills.every((pill, index) => getComputedStyle(pill).color === getComputedStyle(pills[0]).color), 'cash flow text follows financial meaning');
  flowHost.remove();
 }
 semanticView.unload();
 for (const width of [240, 320, 375]) {
  host.style.width = width + 'px';
  const zeroView = render(1, 'USD', true);
  zeroView.getAccountBalanceThroughDateTime = (reference, date) => date.getMonth() === 8 ? 0 : 1234567890123.456;
  dashboard.replaceChildren(); zeroView.renderSummary(dashboard);
  for (const pill of dashboard.querySelectorAll('.expensica-account-balances-comparison')) {
   check(pill.scrollWidth <= pill.clientWidth + 1 && pill.parentElement.scrollWidth <= pill.parentElement.clientWidth + 1,
    'large zero-baseline currency changes wrap without clipping ' + width);
  }
  zeroView.unload();
 }
 document.body.classList.remove('is-mobile'); host.style.width = '320px';
 const inputView = render(8, 'USD'), inputRow = dashboard.querySelector('.expensica-account-balances-row');
 const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
 inputRow.dispatchEvent(wheel);
 check(!wheel.defaultPrevented && inputRow.scrollLeft === 0, 'account rows leave page scrolling untouched');
 let navigations = 0;
 inputView.switchDashboardTab = () => {}; inputView.openAccountEditor = () => { navigations++; };
 inputRow.firstElementChild.click(); check(navigations === 1, 'account clicks still open the editor');
 inputView.unload();
 dashboard.classList.add('expensica-suppress-motion');
 const populatedHeights = new Map();
 for (const mobile of [false, true]) for (const width of [240, 320, 600, 800, 871, 872, 873, 1024, 1200])
 for (const currency of ['USD', 'KWD']) for (const large of [false, true])
 for (const gap of [8, 24]) for (const empty of [false, true]) {
  document.body.classList.toggle('is-mobile', mobile); host.style.width = width + 'px';
  if (gap === 24) document.documentElement.style.setProperty('--expensica-panel-gap', '24px');
  else document.documentElement.style.removeProperty('--expensica-panel-gap');
  const view = render(8, currency, large); view.containerEl = host; const key = [mobile, width, currency, large, gap].join('/');
  const context = key + '/' + empty;
  Object.assign(view, {
   transactions: empty ? [] : [{ type: 'expense', amount: large ? 1234567890123.456 : 50 }],
   getTransactionsForDateRange: () => [{ type: 'income', amount: 100 }, { type: 'expense', amount: 50 }],
   renderPremiumVisualizations(container) {
    const section = container.createDiv('expensica-section');
    section.createDiv('expensica-premium-visualizations expensica-premium-viz-container expensica-chart-container').textContent = 'Calendar';
   },
   syncChartsAfterCategoryLayoutChange() {},
   resizeChartsToContainers() {}
  });
  dashboard.replaceChildren(); view.renderOverviewTab(dashboard);
  const pair = dashboard.querySelector('.expensica-overview-panels');
  const grid = dashboard.querySelector('.expensica-dashboard-grid');
  view.updateDashboardChartGridLayout(grid);
  const wrappers = Array.from(pair.children), panels = wrappers.map(wrapper => wrapper.firstElementChild);
  const boxes = panels.map(panel => panel.getBoundingClientRect());
  check(wrappers[0].classList.contains('expensica-account-balances-container')
   && wrappers[1].classList.contains('expensica-cash-flow-container'), 'top panels keep semantic DOM order ' + context);
  const dashboardStyle = getComputedStyle(dashboard);
  const availableWidth = dashboard.clientWidth - parseFloat(dashboardStyle.paddingLeft) - parseFloat(dashboardStyle.paddingRight);
  const wide = availableWidth >= 808;
  check(Math.abs(boxes[0].width - boxes[1].width) < 1, 'top panels always have equal column widths ' + context);
  if (wide) {
   check(Math.abs(boxes[0].top - boxes[1].top) < 1 && Math.abs(boxes[0].height - boxes[1].height) < 1,
    'wide panels share one row and equal heights ' + context);
   check(Math.abs(boxes[1].left - boxes[0].right - gap) < 1, 'wide panels have only the shared column gap ' + context);
   check(Math.abs(boxes[0].width * 2 + gap - pair.getBoundingClientRect().width) < 1, 'available width splits exactly 50/50 ' + context);

  } else {
   check(Math.abs(boxes[1].top - boxes[0].bottom - gap) < 1, 'narrow panels stack balances then Cash Flow ' + context);
   check(Math.abs(boxes[0].width - pair.getBoundingClientRect().width) < 1, 'stacked panels fill the available width ' + context);
  }
  if (!empty) populatedHeights.set(key, boxes.map(box => box.height));
  else if (!wide) {
   check(Math.abs(boxes[0].height - populatedHeights.get(key)[0]) < 1, 'stacked balance height stays independent of Cash Flow content ' + context);
   check(Math.abs(boxes[1].height - populatedHeights.get(key)[1]) > 1, 'stacked Cash Flow height follows its own content ' + context);
  }
  check(host.scrollWidth <= host.clientWidth + 1 && dashboard.scrollWidth <= dashboard.clientWidth + 1,
   'no Overview overflow at any container width ' + context);
  check(panels.every(panel => panel.scrollWidth <= panel.clientWidth + 1 && panel.scrollHeight <= panel.clientHeight + 1),
   'long amounts and panel contents remain contained ' + context);
  check(getComputedStyle(pair).overflow === 'visible', 'overview grid does not clip tooltips ' + context);
  const accountRow = panels[0].querySelector('.expensica-account-balances-row');
  const accountViewport = accountRow.parentElement;
  check(getComputedStyle(accountRow).display === 'grid' && getComputedStyle(accountRow).justifyContent === 'center', 'cards remain centered and wrapped in all layouts ' + context);
  check(accountRow.scrollWidth <= accountRow.clientWidth + 1 && getComputedStyle(accountRow).overflowX === 'visible', 'no account carousel at any width ' + context);
  const summary = panels[0].querySelector('.expensica-account-balances-footer');
  check(summary.nextElementSibling === accountViewport && Math.abs(accountViewport.getBoundingClientRect().top - summary.getBoundingClientRect().bottom - 8) < 1, 'summary metrics sit directly above cards with the existing gap token ' + context);
  check(getComputedStyle(panels[0]).paddingBottom === '8px', 'footer bottom inset stays unchanged ' + context);
  check(!accountViewport.querySelector('.expensica-account-balances-scroll-button'), 'no account overflow controls ' + context);
  const info = panels[0].querySelector('.expensica-account-balances-header button');
  check(info.getAttribute('aria-label') === 'Last recorded account balances independant from the date range.'
   && !info.hasAttribute('title'), 'balances info uses the requested Obsidian tooltip ' + context);
  const flow = panels[1], canvas = flow.querySelector('.expensica-canvas-container');
  const controls = flow.querySelectorAll('.expensica-chart-range-buttons');
  check(flow.querySelectorAll('.expensica-chart-header').length === 1 && controls.length === 1
   && canvas.parentElement === flow, 'Cash Flow internals stay intact ' + context);
  check(canvas.getBoundingClientRect().height > 0 && canvas.getBoundingClientRect().height <= 200,
   'embedded chart keeps responsive height ' + context);
  for (const metric of flow.querySelectorAll('.expensica-cash-flow-metric')) {
   const label = metric.querySelector('.expensica-cash-flow-label'), amount = metric.querySelector('.expensica-card-value'), pill = metric.querySelector('.expensica-card-trend');
   check(!label.querySelector('svg'), 'Cash Flow label has no SVG ' + context);
   check(getComputedStyle(amount).fontSize === '12px', 'Cash Flow amount moves explicitly from base to sm token ' + context);
   check(getComputedStyle(label).opacity === '1' && getComputedStyle(amount).opacity === '1' && getComputedStyle(pill.lastElementChild).opacity === '1', 'Cash Flow text has full opacity ' + context);
   check(Math.abs(pill.getBoundingClientRect().top - metric.querySelector('.expensica-metric-total').getBoundingClientRect().bottom - 8) < 1, 'Cash Flow label amount and trend have equal 8px gaps ' + context);
  }
  check(Array.from(grid.children).every((panel, index) => index === 0
   ? !panel.querySelector('.expensica-chart-range-buttons') : panel.querySelector('.expensica-chart-range-buttons')?.children.length === 9),
   'transactions uses the global dropdown and categories retains its range row ' + context);
  check(Array.from(dashboard.querySelectorAll('.expensica-chart-range-buttons')).every(row => (getComputedStyle(row).display === 'none') === (wide && !!row.closest('.expensica-dashboard-grid'))), 'chart range controls remain visible in wide and narrow views ' + context);
  const categoryButtons = grid.children[1].querySelector('.expensica-category-type-buttons');
  check(Array.from(categoryButtons.children).every(button => button.classList.contains('expensica-category-type-button') && !button.classList.contains('expensica-chart-range-button') && getComputedStyle(button).borderStyle === 'none'), 'category buttons have explicit compact styling ' + context);
  check(categoryButtons && categoryButtons.children[0].textContent === 'Income' && categoryButtons.children[1].textContent === 'Expenses'
   && getComputedStyle(categoryButtons).justifyContent === 'flex-end', 'category chart uses right-aligned Income/Expenses buttons ' + context);
  check(grid.children[0].classList.contains('expensica-income-expense-chart-container')
   && grid.children[1].classList.contains('expensica-expenses-chart-container'), 'Transactions & Balances precedes Categories ' + context);
  const calendar = dashboard.querySelector('.expensica-section');
  check(dashboard.lastElementChild === calendar && grid.getBoundingClientRect().top >= pair.getBoundingClientRect().bottom
   && calendar.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom, 'Heatmap follows both chart panels ' + context);
  const lowerBoxes = Array.from(grid.children).map(panel => panel.getBoundingClientRect());
  if (grid.classList.contains('is-narrow')) check(lowerBoxes[1].top >= lowerBoxes[0].bottom, 'narrow charts stack in requested order ' + context);
  else check(Math.abs(lowerBoxes[0].height - lowerBoxes[1].height) < 1, 'lower panels stretch to the tallest panel with native Grid ' + context);
  check(Array.from(grid.children).every(panel => !panel.style.height), 'no JavaScript panel heights ' + context);
  if (empty) check(getComputedStyle(grid.children[0].querySelector('.expensica-canvas-container')).minHeight === '0px',
   'empty Transactions chart has no stale populated minimum height ' + context);
  const sections = [pair, grid, calendar].map(section => section.getBoundingClientRect());
  for (let index = 1; index < sections.length; index++) check(Math.abs(sections[index].top - sections[index - 1].bottom - gap) < 1,
   'vertical section gaps remain token-driven ' + context);
  view.unload();
 }
 document.documentElement.style.removeProperty('--expensica-panel-gap');

 // Resizing the same DOM must retain state, restore individual controls and release shared heights.
 document.body.classList.remove('is-mobile'); host.style.width = '1200px';
 const transitionView = render(8, 'USD'); transitionView.containerEl = host;
 transitionView.transactions = [{ type: 'expense', amount: 50 }];
 transitionView.getTransactionsForDateRange = () => [];
 transitionView.syncChartsAfterCategoryLayoutChange = () => {};
 transitionView.renderPremiumVisualizations = container => container.createDiv({ cls: 'expensica-section', text: 'Independent heatmap month' });
 dashboard.replaceChildren(); transitionView.renderTabNavigation(dashboard); transitionView.renderOverviewTab(dashboard);
 const rangeState = transitionView.dateRange, currentDate = new Date(2026, 6, 1);
 transitionView.currentDate = currentDate;
 const rangeControl = dashboard.querySelector('.expensica-global-date-range');
 const transitionGrid = dashboard.querySelector('.expensica-dashboard-grid');
 const categoryLegend = transitionGrid.children[1].querySelector('.expensica-chart-html-legend');
 for (let i = 0; i < 20; i++) categoryLegend.createDiv({ text: 'Category ' + i });
 const transactionCanvas = transitionGrid.children[0].querySelector('canvas');
 const chart = { canvas: transactionCanvas, stop() {}, update() {}, resize(width, height) {
  transactionCanvas.width = width; transactionCanvas.height = height;
  transactionCanvas.style.width = width + 'px'; transactionCanvas.style.height = height + 'px';
 } };
 let narrowHeight;
 for (const width of [1200, 320, 1200, 320]) {
  host.style.width = width + 'px'; transitionView.updateDashboardChartGridLayout(transitionGrid);
  transitionView.resizeChartToContainer(chart, true);
  const panels = Array.from(transitionGrid.children), boxes = panels.map(panel => panel.getBoundingClientRect());
  if (width === 1200) check(Math.abs(boxes[0].height - boxes[1].height) < 1, 'long legend stretches both panels equally');
  else {
   check(boxes[0].height < boxes[1].height, 'stacked Transactions height is independent of the long category legend');
   if (narrowHeight) check(Math.abs(boxes[0].height - narrowHeight) < 1, 'repeated resize does not retain shared panel height');
   narrowHeight = boxes[0].height;
  }
  check(transitionView.dateRange === rangeState && transitionView.currentDate === currentDate, 'resize preserves range selection and independent heatmap month');
  check(dashboard.querySelector('.expensica-global-date-range') === rangeControl && getComputedStyle(rangeControl).display !== 'none', 'one global dropdown remains accessible across resizing');
 }
 transitionView.unload();

 for (const mobile of [false, true]) for (const enabled of [false, true]) for (const width of [176, 240, 320, 600, 1200]) {
  document.body.classList.toggle('is-mobile', mobile);
  host.style.width = width + 'px'; dashboard.replaceChildren();
  const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
   dateRange: { type: 'this_month', startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31) },
   currentTab: 'overview', plugin: { settings: { enableAccounts: enabled, enableBudgeting: enabled } }, switchDashboardTab() {}
  });
  view.renderTabNavigation(dashboard);
  const select = dashboard.querySelector('.expensica-global-date-range');
  check(select && select.tagName === 'BUTTON' && select.textContent === '1M' && select.parentElement.parentElement.nextElementSibling.classList.contains('expensica-create-transaction') && select.scrollWidth <= select.clientWidth + 1, 'compact Obsidian menu precedes Transaction action ' + width);
  const create = select.parentElement.parentElement.nextElementSibling, selectBox = select.getBoundingClientRect(), createBox = create.getBoundingClientRect();
  check(create.textContent === 'Transaction' && create.querySelector('svg[data-icon=plus]') && !create.querySelector('.expensica-account-card-date'), 'Transaction button has only its plus SVG and label');
  if (width >= 320) check(selectBox.top === createBox.top && selectBox.right <= createBox.left, 'range menu sits to the left of Transaction ' + width);
  const tabs = Array.from(dashboard.querySelectorAll('.expensica-tab'));
  check(host.scrollWidth <= host.clientWidth + 1, 'navigation fits narrow and wide containers ' + width);
  for (const tab of tabs) {
   const icon = tab.querySelector('svg'), label = tab.querySelector('.expensica-tab-label'), bounds = tab.getBoundingClientRect();
   check(icon && icon.parentElement.getAttribute('aria-hidden') === 'true' && tab.getAttribute('aria-label') === label.textContent,
    'all tabs have a decorative Obsidian SVG and accessible label');
   const labelBox = label.getBoundingClientRect(), iconBox = icon.getBoundingClientRect();
   check(labelBox.left >= bounds.left && labelBox.right <= bounds.right && labelBox.bottom <= bounds.bottom
    && iconBox.top >= bounds.top && iconBox.bottom <= bounds.bottom, 'tab text and SVG remain within the touch target ' + width);
   tab.focus(); check(document.activeElement === tab, 'native tab button remains keyboard focusable');
   if (width < 1200) {
    check(bounds.width >= 64 && bounds.height === 64 && getComputedStyle(label).fontSize === '12px', 'content-bound tabs retain the 64px minimum and height ' + width);
    check(Math.abs(iconBox.left + iconBox.right - bounds.left - bounds.right) < 1
     && Math.abs((iconBox.top + iconBox.bottom) / 2 - (bounds.top + labelBox.top) / 2) < 1, 'SVG is centered in the space above the label ' + width);
    check(Math.abs(bounds.width - Math.max(64, labelBox.width + 6)) < 1, 'tab width follows its label content ' + width);
    check(icon.getBoundingClientRect().bottom <= label.getBoundingClientRect().top, 'narrow labels appear underneath icons');
    check(getComputedStyle(icon).color === 'rgb(34, 34, 34)' && getComputedStyle(icon).width === '24px', 'narrow navigation icons use regular text color and one smaller size-token step: ' + width + '/' + label.textContent + '/' + getComputedStyle(icon).color + '/' + getComputedStyle(icon).width);
    check(getComputedStyle(label).fontWeight === '400', 'narrow tab labels use regular weight even when active');
    check(Math.abs(bounds.bottom - labelBox.bottom - 3) < 1, 'narrow tab labels align at the bottom inset');
    check(getComputedStyle(tab.parentElement).gap === '8px', 'narrow navigation reuses the desktop gap token');
   } else check(getComputedStyle(tab).flexDirection === 'row', 'desktop tabs retain horizontal labels');
  }
 }
}
try { run(); } catch (error) { failures.push(error.stack || String(error)); } finally {
 document.documentElement.setAttribute('data-balances-result', encodeURIComponent(JSON.stringify({ checks, failures })));
}
</script>`;
            const file = path.join(temporary, 'responsive.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`,
                '--window-size=1280,900', '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 6 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-balances-result="([^"]+)"/);
            assert.ok(encoded, result.stdout.slice(-1200));
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.deepEqual([...new Set(report.failures.map(message => message.replace(/ (?:true|false)\/.*$/, '')))], []);
            assert.ok(report.checks > 5000);
            console.log(`${report.checks} focused Account Balances browser assertions passed`);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('expensica-account-balances-'));
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
