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

test('both consumers share the real calendar grid, interactions, colors and responsive layout',
    { skip: !browser && 'Set CHROME_PATH to run calendar browser coverage', timeout: 30000 }, () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-shared-calendar-'));
        try {
            const root = path.join(__dirname, '..');
            const files = ['models', 'calendar-ui', 'date-selector-modal', 'account-calculations',
                'visualizations/calendar-view', 'dashboard-integration', 'dashboard-view', 'chart-tooltip', 'financial-metrics',
                'transaction-card', 'time-selector-modal', 'category-chip', 'transactions-view'];
            const sources = Object.fromEntries(files.map(file => [file, ts.transpileModule(
                fs.readFileSync(path.join(root, 'src', file + '.ts'), 'utf8'), {
                    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
                }).outputText]));
            const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
            const d3 = fs.readFileSync(path.join(root, 'node_modules/d3/dist/d3.min.js'), 'utf8');
            const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>
:root { --text-normal-rgb: 34, 34, 34; --background-primary: white; --background-modifier-border: #aaa; }
body { margin: 0; font-family: Arial, sans-serif; --text-normal: #222; --text-muted: #666;
 --text-faint: #888; --text-on-accent: white; --interactive-accent: #705dcf;
 --background-primary: white; --background-secondary: #eee; --background-modifier-border: #aaa;
 --background-modifier-hover: #ddd; --text-success: green; }
button { box-sizing: border-box; font-family: inherit; }
</style><body><script>${d3}</script><script>
const sources = ${JSON.stringify(sources)}, cache = {}, failures = [], notices = []; let checks = 0;
function check(condition, label) { checks++; if (!condition) failures.push(label); }
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.removeClass = function(...names) { this.classList.remove(...names); };
HTMLElement.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
HTMLElement.prototype.hasClass = function(name) { return this.classList.contains(name); };
HTMLElement.prototype.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
HTMLElement.prototype.createEl = function(tag, options = {}) {
 const element = document.createElement(tag); this.append(element);
 if (typeof options === 'string') options = { cls: options };
 if (options.cls) element.className = options.cls;
 if (options.text !== undefined) element.textContent = options.text;
 for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
 return element;
};
HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
HTMLElement.prototype.appendText = function(text) { this.append(document.createTextNode(text)); };
HTMLElement.prototype.createSvg = function(tag, options = {}) {
 const element = document.createElementNS('http://www.w3.org/2000/svg', tag); this.append(element);
 for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
 element.createSvg = HTMLElement.prototype.createSvg; return element;
};
const obsidian = {
 ItemView: class {},
 displayTooltip(element, content, options) {
  element.testTooltip?.remove();
  element.tooltipOptions = options;
  element.testTooltip = document.body.createDiv({ cls: 'tooltip ' + options.classes.join(' ') });
  if (typeof content === 'string') element.testTooltip.textContent = content;
  else element.testTooltip.append(content);
  element.addEventListener('mouseleave', () => element.testTooltip?.remove(), { once: true });
 },
 setTooltip(element, text, options) {
  element.setAttribute('aria-label', text); element.tooltipOptions = options;
  element.addEventListener('mouseenter', () => {
   element.testTooltip?.remove();
   element.testTooltip = document.body.createDiv({ cls: 'tooltip ' + options.classes.join(' '), text });
  });
  element.addEventListener('mouseleave', () => element.testTooltip?.remove());
 },
 setIcon(parent) { parent.createSvg('svg', { attr: { viewBox: '0 0 24 24' } }); },
 Modal: class {
  constructor() { this.modalEl = document.body.createDiv('modal'); this.contentEl = this.modalEl.createDiv('modal-content'); }
  close() { this.onClose(); this.modalEl.remove(); }
 }
};
function load(name) {
 if (cache[name]) return cache[name];
 if (!sources[name]) return {};
 const exports = {}; cache[name] = exports;
 new Function('exports', 'require', sources[name])(exports, dependency => {
  if (dependency === 'obsidian') return obsidian;
  if (dependency === 'd3') return window.d3;
  if (dependency === 'chart.js') return { Tooltip: { positioners: {} } };
  if (dependency.endsWith('/notice')) return { showExpensicaNotice: text => notices.push(text) };
  return load(dependency.slice(dependency.startsWith('../') ? 3 : 2));
 }); return exports;
}
try {
 const models = load('models'), shared = load('calendar-ui');
 const { DateSelectorModal } = load('date-selector-modal');
 const { PremiumVisualizations } = load('dashboard-integration');
 const events = [];
 const picker = new DateSelectorModal({}, '2024-02-29', value => events.push(value), () => events.push('dismiss'));
 picker.onOpen();
 const query = selector => picker.contentEl.querySelector(selector);
 const buttonAppearance = button => {
  const style = getComputedStyle(button), icon = getComputedStyle(button.querySelector('svg'));
  return JSON.stringify(['width', 'height', 'display', 'padding', 'border', 'borderRadius', 'backgroundColor', 'color', 'boxShadow']
   .map(property => style[property]).concat([icon.width, icon.height, icon.color]));
 };
 const pickerButtonAppearance = buttonAppearance(query('.expensica-calendar-navigation-button'));
 const standalone = document.body.createEl('button', { cls: 'expensica-calendar-navigation-button' });
 obsidian.setIcon(standalone);
 check(buttonAppearance(standalone) === pickerButtonAppearance, 'navigation button style works outside either consumer: ' + buttonAppearance(standalone) + ' vs ' + pickerButtonAppearance);
 standalone.disabled = true;
 check(getComputedStyle(standalone).opacity === '0.5' && getComputedStyle(standalone).cursor === 'default', 'standalone disabled style');
 standalone.remove();
 check(query('.expensica-date-selector-days').children.length === 42, 'picker has six weeks');
 check(query('[data-date="2024-02-29"]').getAttribute('aria-pressed') === 'true', 'picker leap selection');
 check(getComputedStyle(query('.expensica-date-selector-days')).gap === '0px', 'picker zero gap');
 check(getComputedStyle(query('[data-date]')).borderRadius === '50%', 'picker circles');
 check(getComputedStyle(query('[data-date]')).fontSize === '14px', 'picker typography');
 check(Math.abs(query('.expensica-date-selector-calendar').getBoundingClientRect().width - 304) < 1, 'picker original grid width');
 query('.expensica-date-selector-next').click();
 check(query('.expensica-date-selector-month').textContent === 'March', 'picker next month');
 check(picker.selectedDate === '2024-02-29', 'navigation does not select');
 query('.expensica-date-selector-previous').click();
 query('[data-date="2024-02-29"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
 check(document.activeElement.dataset.date === '2024-03-01', 'keyboard crosses leap month');
 query('[data-date="2024-03-01"]').click();
 query('.expensica-date-selector-year').click();
 check(!query('.expensica-date-selector-years').hidden, 'picker year selection opens');
 query('[data-year="2025"]').click();
 check(picker.viewYear === 2025 && picker.selectedDate === '2024-03-01', 'year navigation preserves selection');
 query('.expensica-date-selector-edit').click();
 const input = query('input'); input.value = '2025-02-29'; input.dispatchEvent(new Event('input'));
 query('.expensica-form-footer button:last-child').click();
 check(events.length === 0 && input.getAttribute('aria-invalid') === 'true', 'invalid edit blocks OK');
 input.value = '2024-02-29'; input.dispatchEvent(new Event('input'));
 input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
 check(document.activeElement.dataset.date === '2024-02-29', 'Enter returns to selected day');
 query('.expensica-form-footer button:last-child').click();
 check(JSON.stringify(events) === JSON.stringify(['dismiss', '2024-02-29']), 'OK confirms once after dismissal');
 const cancelled = new DateSelectorModal({}, '2024-02-29', () => events.push('unexpected'));
 cancelled.onOpen(); cancelled.contentEl.querySelector('[data-date="2024-02-01"]').click();
 cancelled.contentEl.querySelector('.expensica-form-footer button').click();
 check(!events.includes('unexpected'), 'Cancel discards selection');

 const rows = [
  { id: 'prior', date: '2024-01-31', type: 'income', amount: 100 },
  { id: 'expense1', date: '2024-02-10', type: 'expense', amount: 10 },
  { id: 'expense2', date: '2024-02-10', type: 'expense', amount: 5 },
  { id: 'income', date: '2024-02-10', type: 'income', amount: 25 },
  { id: 'cash-income', date: '2024-02-12', type: 'income', amount: 5 },
  { id: 'saving-income', date: '2024-02-12', type: 'income', amount: 7, account: 'saving-savings' },
  { id: 'repeat-cash-income', date: '2024-02-12', type: 'income', amount: 3 },
  { id: 'transfer-on-income-day', date: '2024-02-12', type: 'internal', amount: 9, fromAccount: 'chequing-cash', toAccount: 'credit-card' },
  { id: 'transfer-only', date: '2024-02-13', type: 'internal', amount: 2, fromAccount: 'chequing-cash', toAccount: 'saving-savings' },
  { id: 'default-income', date: '2024-02-14', type: 'income', amount: 4, account: undefined },
  { id: 'same-color-saving', date: '2024-02-15', type: 'income', amount: 1, account: 'saving-savings' },
  { id: 'same-color-credit', date: '2024-02-15', type: 'income', amount: 1, account: 'credit-card' },
  { id: 'leap', date: '2024-02-29', type: 'expense', amount: 30 }
 ].map(row => ({ time: '12:00:00', category: 'food', description: 'Entry', account: 'chequing-cash', ...row }));
 const before = JSON.stringify(rows), selections = [], edits = [];
 const accounts = [
  { id: 'cash', name: 'Cash', type: 'chequing', color: '#123456' },
  { id: 'savings', name: 'Savings', type: 'saving', color: '#456789' },
  { id: 'card', name: 'Card', type: 'credit', color: '#456789' }
 ];
 const plugin = {
  app: { workspace: { requestSaveLayout() {} } },
  settings: { defaultCurrency: 'USD', enableAccounts: false, calendarColorScheme: models.ColorScheme.RED, showWeekNumbers: false,
   timeFormat: '24', showTransactionCategoryLabels: true },
  getAllTransactions: () => rows,
  getTransactionsForMonth: (year, month) => rows.filter(row => {
   const date = models.parseLocalDate(row.date); return date.getFullYear() === year && date.getMonth() === month;
  }),
  normalizeTransactionAccountReference: value => value || 'chequing-cash',
  getAccounts: () => accounts,
  findAccountByReference: reference => accounts.find(account => models.formatAccountReference(account.type, account.name) === reference),
  getTransactionAccountDisplay(reference) { return this.findAccountByReference(reference) || accounts[0]; },
  getCategoryById: () => ({ id: 'food', name: 'Food' }), getCategoryColor: () => '#ff0000', getCategoryEmoji: () => '',
  renderDailyReviewTransactions(container, date, onEdit) {
   this.dailyRenderer = new (load('transactions-view').ExpensicaTransactionsView)(this.app, this);
   this.dailyRenderer.renderDailyReview(container, date, onEdit);
  }
 };
 const overview = document.body.createDiv('expensica-overview');
 const host = overview.createDiv(); host.style.width = '1024px';
 host.style.setProperty('--expensica-bg-primary', 'var(--background-primary)');
 let reviewRange;
 const integration = new PremiumVisualizations(host, plugin, shared.calendarDate(2024, 1, 29), null, date => selections.push(models.formatDate(date)), transaction => edits.push(transaction.id), () => reviewRange);
 integration.render(); const heatmap = integration.calendarHeatmap;
 const day = value => host.querySelector('[data-date="' + value + '"]');
 check(!host.classList.contains('expensica-chart-container') && heatmap.calendarContainer.parentElement === heatmap.detailsContainer.parentElement
  && [heatmap.calendarContainer, heatmap.detailsContainer].every(panel => panel.classList.contains('expensica-chart-container')),
  'calendar and daily review are separate standard sibling panels');
 const standardPanel = document.body.createDiv('expensica-chart-container');
 for (const property of ['backgroundColor', 'border', 'borderRadius', 'boxShadow', 'paddingTop']) {
  for (const panel of [heatmap.calendarContainer, heatmap.detailsContainer])
   check(getComputedStyle(panel)[property] === getComputedStyle(standardPanel)[property], 'calendar panels share standard ' + property);
 }
 standardPanel.remove();
 host.style.setProperty('--expensica-text-tertiary', 'rgb(81, 82, 83)');
 check(getComputedStyle(day('2024-02-10').querySelector('.expensica-heatmap-amount')).color === 'rgb(81, 82, 83)', 'daily spending follows tertiary text token');
 host.style.removeProperty('--expensica-text-tertiary');
 check(host.querySelector('.expensica-date-selector-days').children.length === 42, 'heatmap shares six-week grid');
 check(!host.querySelector('.expensica-date-selector-calendar svg'), 'no SVG day grid');
 check(!host.querySelector('[title]'), 'heatmap has no system-native tooltips');
 check(!day('2024-02-10').tooltipOptions && !day('2024-02-10').hasAttribute('aria-label')
  && day('2024-02-10').getAttribute('aria-description').includes('2024'), 'heatmap day has accessible date description without tooltip');
 day('2024-02-10').dispatchEvent(new Event('mouseenter'));
 check(!day('2024-02-10').testTooltip, 'hovering a heatmap day creates no tooltip');
 check(host.querySelector('.expensica-date-selector-previous').tooltipOptions.classes.includes('expensica-chart-tooltip'), 'calendar navigation tooltip retained');
 const baseHeatColor = getComputedStyle(day('2024-02-10')).backgroundColor;
 const hoverTest = document.head.appendChild(document.createElement('style'));
 hoverTest.textContent = Array.from(document.styleSheets[0].cssRules)
  .filter(rule => rule.selectorText?.includes(':hover'))
  .map(rule => rule.cssText.replaceAll(':hover', '.test-hover')).join(' ');
 day('2024-02-10').classList.add('test-hover');
 check(getComputedStyle(day('2024-02-10')).backgroundColor === baseHeatColor
  && getComputedStyle(day('2024-02-10')).backgroundImage.startsWith('linear-gradient('), 'day hover overlays without replacing heat color');
 day('2024-02-10').classList.remove('test-hover'); hoverTest.remove();
 check(day('2024-02-29') && !day('2024-02-30'), 'heatmap leap day');
 check(day('2024-02-10').querySelector('.expensica-heatmap-amount').textContent === '$15', 'spending below date');
 check(!day('2024-02-01').querySelector('.expensica-heatmap-amount'), 'empty days have no amount');
 const incomeDots = date => day(date).querySelectorAll('.expensica-heatmap-income-dot');
 check(incomeDots('2024-02-10').length === 1, 'one income dot for receiving account');
 const firstDot = incomeDots('2024-02-10')[0];
 check(getComputedStyle(firstDot).backgroundColor === 'rgb(18, 52, 86)', 'income dot uses receiving account color');
 const incomeDotSize = parseFloat(getComputedStyle(heatmap.calendarContainer).getPropertyValue('--expensica-heatmap-income-dot-size'));
 check(firstDot.getBoundingClientRect().width === incomeDotSize && firstDot.getBoundingClientRect().height === incomeDotSize
  && getComputedStyle(firstDot).borderRadius === '50%', 'income dot retains current size token');
 const stack = day('2024-02-12').querySelector('.expensica-heatmap-income-dots');
 check(stack.children.length === 2, 'deduplicate receiving accounts and exclude internal transfers');
 check(getComputedStyle(stack).top === '2px' && getComputedStyle(stack).right === '2px', 'income starting position preserved');
 check(getComputedStyle(stack).gap === '2px' && getComputedStyle(stack).flexDirection === 'column', 'income dots stack with xs gap');
 check(getComputedStyle(stack.children[0]).backgroundColor === 'rgb(18, 52, 86)'
  && getComputedStyle(stack.children[1]).backgroundColor === 'rgb(69, 103, 137)', 'each stacked dot has its account color');
 check(Math.abs(stack.children[1].getBoundingClientRect().top - stack.children[0].getBoundingClientRect().bottom - 2) < 1,
  'stack flows downward from original top edge');
 check(incomeDots('2024-02-13').length === 0 && incomeDots('2024-02-01').length === 0, 'internal-only and empty days have no income dots');
 check(incomeDots('2024-02-14').length === 1 && getComputedStyle(incomeDots('2024-02-14')[0]).backgroundColor === 'rgb(18, 52, 86)',
  'missing account reference resolves default account color');
 check(incomeDots('2024-02-15').length === 2, 'distinct accounts keep distinct dots even with identical colors');
 heatmap.calendarContainer.style.setProperty('--expensica-heatmap-income-dot-size', '12px');
 check(firstDot.getBoundingClientRect().width === 12 && firstDot.getBoundingClientRect().height === 12, 'income dot size follows token');
 heatmap.calendarContainer.style.removeProperty('--expensica-heatmap-income-dot-size');
 check(getComputedStyle(stack).pointerEvents === 'none' && stack.getAttribute('aria-hidden') === 'true', 'decorative income dots do not intercept day selection');
 check(heatmap.monthlyExpenseTotal === 45 && heatmap.maxAmount === 30, 'expense totals exclude income');
 check(heatmap.calendarData[9].dayBalance === 110, 'running balance retained');
 day('2024-02-10').click(); day('2024-02-10').click();
 check(selections.join() === '2024-02-10', 'selection callback once');
 check(day('2024-02-10').getAttribute('aria-pressed') === 'true', 'heatmap selected day');
 check(heatmap.detailsContainer.querySelector('h2').textContent === 'Saturday, February 10, 2024',
  'daily review title follows calendar selection');
 const dailyTransactions = heatmap.detailsContainer.querySelector('.expensica-transactions');
 check(dailyTransactions.querySelectorAll('[data-transaction-id]').length === 3
  && heatmap.detailsContainer.querySelector('.expensica-transactions-title').textContent === 'Transactions'
  && heatmap.detailsContainer.querySelector('.expensica-transactions-title svg'), 'daily list includes all types under the Transactions SVG header');
 check(!dailyTransactions.querySelector('.expensica-percentage, .expensica-calendar-transaction-item, .expensica-transaction-animate'),
  'daily transaction cards have no custom expense percentage or calendar decorations');
 const firstTransaction = dailyTransactions.querySelector('[data-transaction-id]');
 firstTransaction.click(); firstTransaction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
 check(edits.length === 2 && edits.every(id => id === firstTransaction.dataset.transactionId), 'shared transaction card handles click and keyboard edits once');
 const referenceList = document.body.createDiv('expensica-transactions');
 referenceList.style.width = dailyTransactions.getBoundingClientRect().width + 'px';
 const referenceCard = load('transaction-card').renderTransactionCard(referenceList, {
  plugin, transaction: rows.find(row => row.id === firstTransaction.dataset.transactionId),
  runningBalanceLabel: firstTransaction.querySelector('.expensica-transaction-balance-label').textContent,
  onEdit() {}, onCategoryChange() {}, selectable: true
 });
 check(firstTransaction.outerHTML === referenceCard.outerHTML, 'daily transaction card DOM matches the standard Transactions-tab component');
 check(['display', 'paddingTop', 'paddingLeft', 'borderRadius', 'backgroundColor'].every(property =>
  getComputedStyle(firstTransaction)[property] === getComputedStyle(referenceCard)[property]), 'daily cards retain the standard transaction styling');
 const referenceRadius = getComputedStyle(referenceCard).borderRadius;
 referenceList.remove();
 const selectionEdits = edits.length;
 firstTransaction.querySelector('.expensica-transaction-selector').click();
 check(firstTransaction.classList.contains('is-selected') && edits.length === selectionEdits
  && heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-count').textContent === '1 selected',
  'daily checkbox selects a transaction without opening its editor and exposes the shared bulk footer');
 heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-select-all-btn').click();
 check(heatmap.detailsContainer.querySelectorAll('.expensica-transaction.is-selected').length === 3
  && heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-category-btn').disabled
  && heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-rename')
  && heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-delete'),
  'daily Select All selects only that day and exposes shared rename/delete with the mixed-type category guard');
 check(Array.from(heatmap.detailsContainer.querySelectorAll('.expensica-transaction-bulk-footer button')).every(button =>
  !button.hasAttribute('title') && button.tooltipOptions?.classes.includes('expensica-chart-tooltip')),
  'daily bulk controls use the same Expensica tooltip registration');
 heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-clear').click();
 check(!heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-footer')
  && !heatmap.detailsContainer.querySelector('.expensica-transaction.is-selected'), 'clearing daily bulk selection restores unselected shared cards');
 check(getComputedStyle(dailyTransactions).borderRadius === '0px'
  && [dailyTransactions.firstElementChild, dailyTransactions.lastElementChild].every(card => getComputedStyle(card).borderRadius === referenceRadius),
  'the daily list wrapper cannot clip the first and last card corners into different curves');
 firstTransaction.querySelector('.expensica-transaction-selector').click();
 day('2024-02-12').click();
 check(!heatmap.detailsContainer.querySelector('.expensica-transaction-bulk-footer')
  && !heatmap.detailsContainer.querySelector('.expensica-transaction.is-selected'), 'changing review day clears the prior day selection and footer');
 day('2024-02-10').click();
 const wasMobile = document.body.classList.contains('is-mobile');
 for (const mobile of [false, true]) {
  document.body.classList.toggle('is-mobile', mobile);
  const overviewClearance = document.body.createDiv('expensica-dashboard expensica-overview');
  const transactionsClearance = document.body.createDiv('expensica-dashboard expensica-dashboard-transactions-tab');
  check(getComputedStyle(overviewClearance).paddingBottom === '128px'
   && getComputedStyle(overviewClearance).paddingBottom === getComputedStyle(transactionsClearance).paddingBottom,
   'Overview and Transactions reserve equal footer space across platforms ' + mobile);
  overviewClearance.remove(); transactionsClearance.remove();
 }
 document.body.classList.toggle('is-mobile', wasMobile);
 const dashboardHost = document.body.createDiv('expensica-dashboard expensica-overview');
 dashboardHost.style.width = '500px';
 const reviewDashboard = Object.assign(Object.create(load('dashboard-view').ExpensicaDashboardView.prototype), {
  plugin, currentDate: shared.calendarDate(2024, 1, 10), selectedCalendarDate: shared.calendarDate(2024, 1, 10),
  dateRange: { type: 'this_month', startDate: shared.calendarDate(2024, 1, 1), endDate: shared.calendarDate(2024, 1, 29), label: '1M' }
 });
 reviewDashboard.renderPremiumVisualizations(dashboardHost);
 dashboardHost.querySelector('.expensica-transaction-selector').click();
 const dailyFooter = dashboardHost.querySelector('.expensica-transaction-bulk-footer').getBoundingClientRect();
 check(getComputedStyle(dashboardHost.firstElementChild).transform === 'none'
  && dailyFooter.bottom <= window.innerHeight && Math.abs(dailyFooter.left + dailyFooter.width / 2 - document.documentElement.clientWidth / 2) < 1,
  'daily bulk footer stays anchored to the viewport instead of a transformed calendar wrapper ' + JSON.stringify({
   transform: getComputedStyle(dashboardHost.firstElementChild).transform, footer: dailyFooter.toJSON(), width: window.innerWidth, height: window.innerHeight
  }));
 dashboardHost.remove();
 const reviewMetrics = Array.from(heatmap.detailsContainer.querySelectorAll('.expensica-cash-flow-metric'));
 check(reviewMetrics.map(item => item.querySelector('.expensica-card-value').textContent).join() === '$25.00,$15.00',
  'daily review shows income and expenses, excluding transfers');
 check(heatmap.detailsContainer.children[1].classList.contains('expensica-daily-review-metrics'), 'metrics immediately follow the review header');
 const expenseTrend = reviewMetrics[1].querySelector('.expensica-cash-flow-comparison');
 check(expenseTrend.textContent === '$13.45' && expenseTrend.classList.contains('is-negative')
  && reviewMetrics[0].querySelector('.expensica-cash-flow-comparison').classList.contains('is-positive'),
  'monthly daily averages preserve income and expense meanings');
 check(expenseTrend.getAttribute('aria-label') === 'Above daily average by $13.45 of Feb. The Feb average is $1.55.',
  'tooltip describes the date range difference and share using the requested concise wording');
 for (const event of ['mouseenter', 'mouseleave', 'focus', 'blur', 'click']) expenseTrend.dispatchEvent(new Event(event, { bubbles: true }));
 check(expenseTrend.getAttribute('aria-expanded') === 'true' && expenseTrend.testTooltip.classList.contains('expensica-chart-tooltip')
  && expenseTrend.testTooltip.textContent === expenseTrend.getAttribute('aria-label') && !expenseTrend.testTooltip.querySelector('svg'),
  'daily trend reuses hover, focus, and tap tooltips without navigation or tooltip icons');
 expenseTrend.dispatchEvent(new Event('mouseleave'));
 reviewRange = { startDate: shared.calendarDate(2024, 1, 9), endDate: shared.calendarDate(2024, 1, 10), label: 'Feb 9–10, 2024',
  transactions: rows.filter(row => row.date >= '2024-02-09' && row.date <= '2024-02-10') };
 integration.updateDate(shared.calendarDate(2024, 1, 29));
 check(heatmap.detailsContainer.querySelectorAll('.expensica-cash-flow-comparison')[1].getAttribute('aria-label')
  === 'Above daily average by $7.50 of Feb 9–10, 2024. The Feb 9–10, 2024 average is $7.50.',
  'selected custom range supplies both totals and inclusive calendar days');
 check(heatmap.detailsContainer.querySelector('.expensica-daily-account-card .expensica-card-value').textContent === '$110.00',
  'daily account closing balances include opening history outside the selected dashboard range');
 host.querySelector('.expensica-date-selector-next').click();
 check(host.querySelector('.expensica-date-selector-month').textContent === 'March'
  && heatmap.getReviewRange().label === 'Feb 9–10, 2024'
  && !heatmap.detailsContainer.querySelector('.expensica-daily-review-metrics'),
  'independent calendar navigation preserves the selected comparison range');
 reviewRange = undefined;
 integration.updateDate(shared.calendarDate(2024, 1, 29));
 const selectedDay = heatmap.calendarData[9];
 const getCategory = plugin.getCategoryById;
 plugin.getCategoryById = id => ({ id, name: id === 'travel' ? 'Travel' : 'Food' });
 heatmap.showDayDetails({ ...selectedDay, transactions: selectedDay.transactions.map(row => row.id === 'expense2' ? { ...row, category: 'travel' } : row) });
 const detailsRow = heatmap.detailsContainer.querySelector('.expensica-daily-review-details');
 const accountPanel = detailsRow.querySelector('.expensica-daily-account-balances');
 const breakdown = detailsRow.children[1];
 check([accountPanel, breakdown].every(panel => getComputedStyle(panel).backgroundColor === 'rgba(0, 0, 0, 0)'
  && getComputedStyle(panel).boxShadow === 'none' && getComputedStyle(panel).padding === '0px'),
  'running balances and category breakdown have no background wrappers');
 check(detailsRow.previousElementSibling.classList.contains('expensica-daily-review-metrics')
  && accountPanel === detailsRow.firstElementChild && breakdown.classList.contains('expensica-category-breakdown')
  && !heatmap.detailsContainer.querySelector('.expensica-calendar-summary'), 'account balances and categories share a layout directly after metrics');
 check(Math.abs(detailsRow.getBoundingClientRect().top - detailsRow.previousElementSibling.getBoundingClientRect().bottom - 16) < 1,
  'daily detail panels use the standard 16px spacing after metrics');
 for (const width of [240, 400, 1024, 1800]) {
  overview.style.width = width + 'px'; host.style.width = width + 'px'; integration.resize();
  const first = accountPanel.getBoundingClientRect(), second = breakdown.getBoundingClientRect();
  check(width <= 1024 ? second.top >= first.bottom + 7 : Math.abs(first.top - second.top) < 1,
   'account balances and categories share a row when they fit and wrap when needed ' + width);
  check([accountPanel, breakdown].every(panel => panel.scrollWidth <= panel.clientWidth + 1), 'daily detail panels contain all amounts ' + width);
  const card = accountPanel.querySelector('.expensica-daily-account-card');
  const children = Array.from(card.children, child => child.getBoundingClientRect());
  check(children.length === 3 && children.every(rect => Math.abs(rect.top + rect.height / 2 - children[0].top - children[0].height / 2) < 1)
   && !card.querySelector('.expensica-card-trend'), 'daily account cards show icon, account and balance on one line without trends ' + width);
  check(card.scrollWidth <= card.clientWidth + 1 && card.querySelector('.expensica-card-value').scrollWidth <= card.querySelector('.expensica-card-value').clientWidth + 1,
   'daily account cards keep their entire balance visible ' + width);
 }
 overview.style.removeProperty('width'); host.style.width = '1024px'; integration.resize();
 plugin.settings.enableAccounts = true;
 const accountBalances = date => {
  heatmap.showDayDetails(heatmap.calendarData.find(day => models.formatDate(day.date) === date));
  return Array.from(heatmap.detailsContainer.querySelectorAll('.expensica-daily-account-card'), card => card.querySelector('.expensica-card-value').textContent);
 };
 check(accountBalances('2024-02-10').join() === '$110.00,$0.00,$0.00', 'daily cards close after every transaction on the selected date and exclude future records');
 check(accountBalances('2024-02-12').join() === '$109.00,$7.00,-$9.00', 'daily cards respect transfer directions and credit balances');
 check(heatmap.detailsContainer.querySelectorAll('.expensica-transactions [data-transaction-id]').length === 4
  && !heatmap.detailsContainer.querySelector('.expensica-calendar-empty-message'), 'income and transfer days render every transaction without an expense-only empty state');
 const transfer = heatmap.detailsContainer.querySelector('[data-transaction-id="transfer-on-income-day"]');
 check(Array.from(transfer.querySelectorAll('.expensica-transaction-balance-label'), label => label.textContent).join()
  === 'Cash: $101.00,Card: -$9.00', 'shared transfer cards show both endpoint running balances at their canonical transaction position');
 check(accountBalances('2024-02-13').join() === '$107.00,$9.00,-$9.00', 'daily cards include transfer-only days');
 check(heatmap.detailsContainer.querySelector('[data-transaction-id="transfer-only"]')
  && !heatmap.detailsContainer.querySelector('.expensica-calendar-empty-message'), 'transfer-only days render the standard transaction card');
 check(accountBalances('2024-02-11').join() === '$110.00,$0.00,$0.00', 'daily cards carry account balances through inactive days');
 check(accountBalances('2024-02-01').join() === '$100.00,$0.00,$0.00', 'daily cards carry previous-month opening balances');
 heatmap.showDayDetails({ ...selectedDay, date: shared.calendarDate(2024, 0, 30), formattedDate: 'January 30, 2024', transactions: [] });
 check(Array.from(heatmap.detailsContainer.querySelectorAll('.expensica-daily-account-card .expensica-card-value'), value => value.textContent).join()
  === '$0.00,$0.00,$0.00', 'daily cards show zero before the first recorded transaction');
 accountBalances('2024-02-01');
 const dailyCard = heatmap.detailsContainer.querySelector('.expensica-daily-account-card');
 for (const event of ['mouseenter', 'mouseleave', 'focus', 'blur', 'click']) dailyCard.dispatchEvent(new Event(event, { bubbles: true }));
 check(dailyCard.getAttribute('aria-label') === "Cash's running balance as of Feb 1, 2024"
  && dailyCard.getAttribute('aria-expanded') === 'true' && dailyCard.testTooltip.classList.contains('expensica-chart-tooltip'),
  'daily account cards reuse hover, focus and tap tooltips for the selected date');
 dailyCard.dispatchEvent(new Event('mouseleave'));
 for (const width of [240, 1024]) {
  host.style.width = width + 'px'; integration.resize();
  const cards = Array.from(heatmap.detailsContainer.querySelectorAll('.expensica-daily-account-card'));
  const boxes = cards.map(card => card.getBoundingClientRect());
  check(width === 240 ? boxes.every((box, i) => i === 0 || box.top > boxes[i - 1].top)
   : boxes[0].top === boxes[1].top && boxes[2].top > boxes[0].top && boxes[2].left === boxes[0].left,
   'daily account cards wrap into at most two columns and start new rows on the left ' + width);
  check(cards.every(card => getComputedStyle(card).paddingTop === '6px' && getComputedStyle(card).paddingBottom === '6px'
   && getComputedStyle(card.querySelector('.expensica-card-value')).fontSize === getComputedStyle(card.querySelector('.expensica-card-title')).fontSize
   && card.scrollWidth <= card.clientWidth + 1), 'daily cards share label/amount size and 6px vertical padding without overflow ' + width);
 }
 host.style.width = '1024px'; integration.resize();
 plugin.settings.enableAccounts = false;
 plugin.getCategoryById = getCategory;
 heatmap.showDayDetails(selectedDay);
 const categoryBars = heatmap.detailsContainer.querySelectorAll('.expensica-category-bar');
 check(Array.from(categoryBars, bar => bar.dataset.transactionType).join() === 'expense,income'
  && Array.from(categoryBars).every(bar => bar.querySelector('.expensica-category-segment')),
  'daily review integrates one segmented category bar per expense/income type');
 for (const [current, total, expected] of [
  [0, 0, '0%'], [0.0000005, 29, ''], [-0.0000005, 29, ''], [10, 0, '$10.00'], [0.2, 0.29, '$0.19'],
  [1, -29, '$2.00'], [5, 145, '0%'], [5, 290, '50%']
 ]) {
  const detailHost = document.body.createDiv();
  const amounts = value => ['income', 'expense'].map(type => ({ type, amount: value }));
  const review = Object.assign(Object.create(Object.getPrototypeOf(heatmap)), {
   plugin, detailsContainer: detailHost, transactions: amounts(total), currentDate: shared.calendarDate(2024, 1, 10)
  });
  review.renderDailyReviewMetrics({ date: shared.calendarDate(2024, 1, 10), formattedDate: 'February 10, 2024', transactions: amounts(current) });
  const pills = detailHost.querySelectorAll('.expensica-cash-flow-comparison');
  if (Math.abs(current) < 0.000001) {
   check(pills.length === 0 && !detailHost.querySelector('.expensica-daily-review-metrics'), 'zero and effectively zero daily totals leave no metric rows');
   detailHost.remove(); continue;
  }
  const above = current > total / 29, neutral = current === total / 29;
  check(Array.from(pills).every(pill => pill.textContent === expected && !/NaN|Infinity|all time/.test(pill.getAttribute('aria-label'))),
   'monthly comparison safely handles zero, tiny, negative, unchanged and ordinary averages ' + [current, total]);
  check(pills[0].classList.contains(neutral ? 'is-neutral' : above ? 'is-positive' : 'is-negative')
   && pills[1].classList.contains(neutral ? 'is-neutral' : above ? 'is-negative' : 'is-positive'),
   'income and expenses preserve financial trend colors ' + [current, total]);
  detailHost.remove();
 }
 day('2024-02-12').click();
 check(heatmap.detailsContainer.querySelectorAll('.expensica-cash-flow-metric').length === 1
  && heatmap.detailsContainer.querySelector('.expensica-cash-flow-label').textContent === 'Income: ', 'income-only days omit the zero expense metric');
 day('2024-02-29').click();
 check(heatmap.detailsContainer.querySelectorAll('.expensica-cash-flow-metric').length === 1
  && heatmap.detailsContainer.querySelector('.expensica-cash-flow-label').textContent === 'Expenses: ', 'expense-only days omit the zero income metric');
 const chartDateView = Object.create(load('dashboard-view').ExpensicaDashboardView.prototype);
 for (const [month, shortName] of ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].entries()) {
  const date = shared.calendarDate(2024, month, 10), last = shared.calendarDate(2024, month + 1, 0);
  const detailHost = document.body.createDiv();
  const review = Object.assign(Object.create(Object.getPrototypeOf(heatmap)), {
   plugin, detailsContainer: detailHost, currentDate: date, allTransactions: rows, runningBalanceCache: new Map(),
   transactions: ['income', 'expense'].map(type => ({ type, amount: last.getDate() * 2 }))
  });
  const day = { date, transactions: ['income', 'expense'].map(type => ({ type, amount: 4 })) };
  review.renderDailyReviewMetrics(day); review.renderDailyAccountBalances(detailHost, day);
  const fullName = date.toLocaleDateString('en-US', { month: 'long' });
  const labels = Array.from(detailHost.querySelectorAll('[aria-label]'), element => element.getAttribute('aria-label'));
  check(labels.length === 5 && labels.every(label => label.includes(shortName) && (fullName.length === 3 || !label.includes(fullName))),
   'all daily metric, trend and account tooltip dates use abbreviated months ' + shortName);
  const chartDates = [chartDateView.formatChartTooltipDayTitle(date), chartDateView.formatChartTooltipMonthTitle(date),
   chartDateView.formatChartTooltipRangeTitle(date, shared.calendarDate(2024, month + 1, 10)),
   chartDateView.getResolvedDateRangeLegendLabel({ type: 'this_month', startDate: shared.calendarDate(2024, month, 1), endDate: last })];
  check(chartDates.every(label => label.includes(shortName) && (fullName.length === 3 || !label.includes(fullName))),
   'Overview chart tooltips and Cash Flow/account comparison labels use abbreviated months ' + shortName);
  detailHost.remove();
 }
 day('2024-02-01').click();
 check(host.querySelector('.expensica-calendar-empty-message').textContent === 'No transactions recorded for this day', 'empty-day details');
 check(!host.querySelector('.expensica-calendar-summary'), 'empty day has no summary');
 check(!heatmap.detailsContainer.querySelector('.expensica-daily-review-metrics')
  && heatmap.detailsContainer.querySelector('.expensica-daily-account-balances'), 'empty days omit zero metrics and retain account balances');
 check(host.querySelector('.expensica-heatmap-legend').textContent.includes('$30.00'), 'legend maximum');
 const legendBar = host.querySelector('.expensica-heatmap-gradient');
 const legendSize = legendBar.getBoundingClientRect();
 const legendLabels = host.querySelector('.expensica-heatmap-legend').textContent;
 for (const dark of [false, true]) {
  document.body.classList.toggle('theme-dark', dark);
  document.body.style.setProperty('--background-primary', dark ? '#1e1e1e' : '#ffffff');
  document.body.style.setProperty('--background-modifier-border', dark ? 'rgba(255, 255, 255, 0.15)' : '#aaaaaa');
  const style = getComputedStyle(legendBar), bounds = legendBar.getBoundingClientRect();
  check(style.backgroundImage.startsWith('linear-gradient(to right, rgba(255, 82, 82, 0) 0%'), 'legend minimum remains transparent, dark=' + dark);
  check(style.backgroundColor === getComputedStyle(host.querySelector('.expensica-heatmap')).backgroundColor, 'neutral legend track matches panel, dark=' + dark);
  check(style.backgroundClip === 'padding-box', 'gradient cannot tint rounded border, dark=' + dark);
  check(style.borderRadius === '6px' && bounds.width === legendSize.width && bounds.height === legendSize.height,
   'legend radius and sizing preserved, dark=' + dark);
  check(host.querySelector('.expensica-heatmap-legend').textContent === legendLabels, 'legend labels preserved, dark=' + dark);
  check(legendBar.children.length === 0 && ['none', 'normal'].includes(getComputedStyle(legendBar, '::before').content)
   && ['none', 'normal'].includes(getComputedStyle(legendBar, '::after').content), 'no overlay paints legend edge, dark=' + dark);
  check(legendBar.scrollWidth <= legendBar.clientWidth && legendBar.scrollHeight <= legendBar.clientHeight,
   'legend has no overflowing content, dark=' + dark);
 }
 document.body.classList.remove('theme-dark');
 document.body.style.removeProperty('--background-primary');
 document.body.style.removeProperty('--background-modifier-border');
 for (const [scheme, color] of [[models.ColorScheme.RED, '#FF5252'], [models.ColorScheme.BLUE, '#0066CC'],
  [models.ColorScheme.GREEN, '#38A169'], [models.ColorScheme.PURPLE, '#805AD5'], [models.ColorScheme.ORANGE, '#ED8936'],
  [models.ColorScheme.TEAL, '#38B2AC'], [models.ColorScheme.COLORBLIND_FRIENDLY, '#FFBF00'], [models.ColorScheme.CUSTOM, '#123456']]) {
  plugin.settings.calendarColorScheme = scheme; plugin.settings.customCalendarColor = '#123456';
  const scale = heatmap.getColorScale(30);
  check(d3.rgb(scale(30)).formatHex() === color.toLowerCase(), 'color mapping ' + scheme);
  check(d3.rgb(scale(0)).opacity === 0 && d3.rgb(scale(15)).opacity === 0.5, 'linear intensity ' + scheme);
 }
 host.querySelector('.expensica-date-selector-next').click();
 check(host.querySelector('.expensica-date-selector-month').textContent === 'March', 'heatmap navigation next');
 check(host.querySelector('.expensica-calendar-empty-message'), 'empty month details');
 check(!heatmap.detailsContainer.querySelector('.expensica-daily-review-metrics'), 'empty months omit zero daily metrics');
 host.querySelector('.expensica-date-selector-previous').click();
 check(host.querySelector('.expensica-date-selector-month').textContent === 'February', 'heatmap navigation previous');
 check(day('2024-02-01').getAttribute('aria-pressed') === 'true', 'selection survives navigation');
 day('2024-02-10').click();

 for (const mobile of [false, true]) for (const weeks of [false, true]) for (const width of [240, 280, 320, 400, 768, 1024]) {
  document.body.classList.toggle('is-mobile', mobile); host.style.width = width + 'px';
  plugin.settings.showWeekNumbers = weeks;
  heatmap.updateMonth(shared.calendarDate(2024, 1, 29), plugin.getTransactionsForMonth(2024, 1));
  const grid = host.querySelector('.expensica-date-selector-days');
  const weekdays = host.querySelector('.expensica-date-selector-weekdays');
  const panel = host.querySelector('.expensica-calendar-grid-container');
  const nav = host.querySelector('.expensica-date-selector-navigation');
  const legend = host.querySelector('.expensica-heatmap-legend');
  const bounds = panel.getBoundingClientRect(), label = nav.children[1].getBoundingClientRect();
  const availableWidth = heatmap.container.getBoundingClientRect().width;
  const context = [mobile, weeks, width].join('/');
  check(!host.querySelector('[title]'), 'heatmap keeps native tooltips removed after month rerenders ' + context);
  check(grid.children.length === (weeks ? 48 : 42), 'week columns ' + context);
  for (const [emptyDate, spendingDate] of [['2024-02-09', '2024-02-10'], ['2024-02-28', '2024-02-29']]) {
   const emptyNumber = day(emptyDate).querySelector('.expensica-heatmap-day-content > span').getBoundingClientRect();
   const spendingNumber = day(spendingDate).querySelector('.expensica-heatmap-day-content > span').getBoundingClientRect();
   check(Math.abs(emptyNumber.top - spendingNumber.top) < 1, 'calendar dates align with and without amounts ' + context);
  }
  check(getComputedStyle(grid).gap === '4px' && getComputedStyle(weekdays).gap === '4px', 'current heatmap day gaps preserved ' + context);
  const naturalWidth = weeks ? 401 : 373;
  const besideCalendar = availableWidth >= naturalWidth * 2 + 16;
  const expectedWidth = besideCalendar ? (availableWidth - 16) / 2 : availableWidth;
  check(Math.abs(bounds.width - expectedWidth) < 1, 'calendar uses half the row beside review or the full row alone ' + context);
  const details = heatmap.detailsContainer.getBoundingClientRect();
  const metricBoxes = Array.from(heatmap.detailsContainer.querySelectorAll('.expensica-cash-flow-metric'), metric => metric.getBoundingClientRect());
  check(metricBoxes.length === 2 && Math.abs(metricBoxes[0].top - metricBoxes[1].top) < 1
   && Math.abs(metricBoxes[0].width - metricBoxes[1].width) < 1,
   'daily metrics remain in two equal columns on the same row ' + context);
  check(Math.abs(metricBoxes[0].left + metricBoxes[1].right
   - (details.left * 2 + heatmap.detailsContainer.clientLeft * 2 + heatmap.detailsContainer.clientWidth)) < 1,
   'daily metric columns remain centered inside their panel ' + context);
  check(heatmap.detailsContainer.style.height === '' && getComputedStyle(heatmap.detailsContainer).overflowY === 'visible'
   && heatmap.detailsContainer.scrollHeight <= heatmap.detailsContainer.clientHeight + 1
   && (details.top > bounds.bottom || Math.abs(details.height - bounds.height) < 1),
   'natural content height sets the shared row height without clipping daily review ' + context);
  check(!besideCalendar ? details.top > bounds.bottom : Math.abs(details.top - bounds.top) < 1,
   'daily details wrap below calendar only when space requires it ' + context);
  check(Math.abs(details.width - bounds.width) < 1,
   'calendar and daily review divide the available row equally ' + context);
  check(getComputedStyle(panel).paddingLeft === '16px' && getComputedStyle(panel).paddingRight === '16px', 'current heatmap inset preserved ' + context);
  check(getComputedStyle(host.querySelector('.expensica-calendar-details-container')).paddingLeft === '16px', 'details retain original inset ' + context);
  check(buttonAppearance(nav.children[0]) === pickerButtonAppearance && buttonAppearance(nav.children[2]) === pickerButtonAppearance,
   'heatmap shares picker navigation button appearance ' + context);
  const bar = host.querySelector('.expensica-heatmap-gradient').getBoundingClientRect();
  const legendBounds = legend.getBoundingClientRect(), gridBounds = grid.getBoundingClientRect();
  check(Math.abs(bar.width - Math.min(220, gridBounds.width)) < 1, 'compact intensity bar ' + context);
  check(Math.abs((legendBounds.left + legendBounds.right) - (gridBounds.left + gridBounds.right)) < 1, 'centered intensity legend ' + context);
  check(panel.scrollWidth <= panel.clientWidth + 1 && host.scrollWidth <= host.clientWidth + 1, 'no horizontal overflow ' + context
   + ' ' + [panel.scrollWidth, panel.clientWidth, host.scrollWidth, host.clientWidth].join('/'));
  check(nav.children[0].getBoundingClientRect().right <= label.left && label.right <= nav.children[2].getBoundingClientRect().left, 'navigation flanks label ' + context);
  for (const button of grid.querySelectorAll('button')) {
   check(!button.closest('[title], [aria-label]'), 'calendar day has no direct or inherited hover tooltip ' + context);
   const rect = button.getBoundingClientRect(), date = models.parseLocalDate(button.dataset.date);
   const weekday = weekdays.children[date.getDay() + (weeks ? 1 : 0)].getBoundingClientRect();
   check(Math.abs(rect.left - weekday.left) < 1 && Math.abs(rect.width - weekday.width) < 1, 'weekday alignment ' + button.dataset.date + ' ' + context);
   check(button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1, 'unclipped day ' + button.dataset.date + ' ' + context + ' ' + [button.scrollWidth, button.clientWidth, button.scrollHeight, button.clientHeight, getComputedStyle(button).minHeight].join('/'));
   check(getComputedStyle(button).borderRadius === '6px', 'rounded squares ' + context);
   if (availableWidth >= naturalWidth) check(Math.abs(rect.width - 45) < 1 && Math.abs(rect.height - 45) < 1, 'current 45px square day preserved ' + context);
   else check(rect.width <= 45 && rect.height >= rect.width - 1, 'day adapts to narrow pane ' + context);
  }
 }
 day('2024-02-10').click();
 const dailyList = heatmap.detailsContainer.querySelector('.expensica-transactions');
 for (let i = 0; i < 30; i++) dailyList.append(dailyList.firstElementChild.cloneNode(true));
 let longReviewHeight = 0;
 for (const width of [1024, 320, 1024]) {
  host.style.width = width + 'px'; integration.resize();
  heatmap.detailsContainer.scrollTop = 100;
  const reviewBounds = heatmap.detailsContainer.getBoundingClientRect();
  check(heatmap.detailsContainer.scrollTop === 0 && heatmap.detailsContainer.scrollHeight <= heatmap.detailsContainer.clientHeight + 1
   && dailyList.firstElementChild.getBoundingClientRect().top >= reviewBounds.top
   && dailyList.lastElementChild.getBoundingClientRect().bottom <= reviewBounds.bottom,
   'long daily review exposes all transactions without an internal vertical viewport at width ' + width);
  if (width === 1024) {
   longReviewHeight = reviewBounds.height;
   check(Math.abs(reviewBounds.height - heatmap.calendarContainer.getBoundingClientRect().height) < 1,
    'the taller review sets both adjacent panel heights');
  }
 }
 for (const card of [dailyList.firstElementChild, dailyList.lastElementChild]) {
  card.scrollIntoView({ block: 'center', behavior: 'instant' });
  const box = card.getBoundingClientRect();
  const visible = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  check(visible && card.contains(visible), 'first and last transactions are visible without overlapping content');
 }
 window.scrollTo(0, 0);
 day('2024-02-01').click();
 host.style.width = '1024px';
 check(heatmap.detailsContainer.getBoundingClientRect().height < longReviewHeight
  && Math.abs(heatmap.detailsContainer.getBoundingClientRect().height - heatmap.calendarContainer.getBoundingClientRect().height) < 1,
  'changing to a shorter day releases old height and lets the calendar set the row height');
 const tokenPanel = host.querySelector('.expensica-heatmap');
 tokenPanel.style.setProperty('--expensica-heatmap-day-size', '48px');
 tokenPanel.style.setProperty('--expensica-gap-sm', '10px');
 const tokenDay = day('2024-02-10').getBoundingClientRect();
 check(Math.abs(tokenDay.width - 48) < 1 && Math.abs(tokenDay.height - 48) < 1, 'day dimensions follow overridden size token');
 check(getComputedStyle(host.querySelector('.expensica-date-selector-days')).gap === '10px', 'day gap follows spacing token');
 tokenPanel.style.removeProperty('--expensica-heatmap-day-size');
 tokenPanel.style.removeProperty('--expensica-gap-sm');
 for (const currency of ['USD', 'CAD', 'KWD']) for (const amount of [0.49, 999.5, 1000000, 1e20]) {
  host.style.width = '240px'; plugin.settings.defaultCurrency = currency;
  heatmap.calendarData[9].totalAmount = amount;
  heatmap.maxAmount = amount;
  heatmap.renderCalendar(); heatmap.resize();
  const button = day('2024-02-10'), amountEl = button.querySelector('.expensica-heatmap-amount');
  check(amountEl.textContent === models.formatCurrency(amount, currency, true), 'compact amount ' + currency + '/' + amount);
  check(button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1,
   'long currency fits narrow day ' + currency + '/' + amount);
 }
 check(JSON.stringify(rows) === before, 'transactions unchanged');

 const { ExpensicaDashboardView, DateRangeType } = load('dashboard-view');
 const flowRows = [
  { id: 'old-income', date: '2026-09-01', type: 'income', amount: 246913578.246 },
  { id: 'old-expense', date: '2026-09-30', type: 'expense', amount: 9135.78 },
  { id: 'income', date: '2026-10-01', type: 'income', amount: 123456789.123 },
  { id: 'expense', date: '2026-10-31', type: 'expense', amount: 4567.89 }
 ];
 const flow = Object.assign(Object.create(ExpensicaDashboardView.prototype), {
  plugin: { settings: { defaultCurrency: 'USD' }, getAllTransactions: () => flowRows },
  transactions: flowRows.slice(2),
  dateRange: { type: DateRangeType.THIS_MONTH, startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 31, 23, 59, 59, 999) }
 });
 const flowHost = document.body.createDiv();
 Object.assign(flow, { destroyCharts() {}, scheduleChartInitialization() {}, syncChartsAfterCategoryLayoutChange() {},
  renderCategoryChartTypeSelector(container) { models.renderPanelTitle(container.createDiv('expensica-chart-header'), 'Categories', 'tag'); } });
 const placementHost = document.body.createDiv();
 for (const mobile of [false, true]) for (const width of [340, 360, 380, 400, 420, 440, 480, 768, 1024]) for (const empty of [false, true]) {
  document.body.classList.toggle('is-mobile', mobile);
  placementHost.style.width = width + 'px'; placementHost.empty();
  const saved = flow.transactions; if (empty) flow.transactions = [];
  const rows = [];
  flow.renderDateRangeSelector(placementHost);
  flow.renderCashFlow(placementHost);
  rows.push(placementHost.querySelector('.expensica-cash-flow-panel'));
  for (const method of ['renderExpensesChart', 'renderIncomeExpenseChart']) {
   const panel = placementHost.createDiv('expensica-chart-container'); flow[method](panel); rows.push(panel);
  }
  const select = placementHost.querySelector('.expensica-global-date-range');
  check(placementHost.querySelectorAll('.expensica-global-date-range').length === 1 && select.tagName === 'BUTTON' && select.textContent === '1M',
   'one global dropdown supplies all chart ranges');
  check(select.getBoundingClientRect().width <= placementHost.getBoundingClientRect().width,
   'compact range dropdown fits narrow panels');
  for (const [index, panel] of rows.entries()) check(index === 2
   ? !panel.querySelector('.expensica-chart-range-buttons')
   : panel.querySelector('.expensica-chart-range-buttons')?.children.length === 9,
   'cash flow and categories retain ranges; transactions uses the global dropdown');
  flow.transactions = saved;
 }
 placementHost.remove();
 for (const dark of [false, true]) for (const mobile of [false, true]) for (const currency of ['USD', 'KWD']) {
  document.body.classList.toggle('is-mobile', mobile);
  document.body.classList.toggle('theme-dark', dark);
  document.body.style.setProperty('--text-success', dark ? '#6aba8b' : '#198754');
  document.body.style.setProperty('--text-error', dark ? '#ff8585' : '#c63c3c');
  document.body.style.setProperty('--background-secondary', dark ? '#262626' : '#eeeeee');
  document.body.style.setProperty('--text-muted', dark ? '#bbbbbb' : '#666666');
  document.body.style.setProperty('--text-normal', dark ? '#eeeeee' : '#222222');
  document.documentElement.style.setProperty('--background-primary', dark ? '#1e1e1e' : '#ffffff');
  flow.plugin.settings.defaultCurrency = currency;
  for (const width of [160, 240, 280, 320, 400, 768, 1024, 3200]) {
   flowHost.style.width = width + 'px'; flowHost.empty(); flow.renderCashFlow(flowHost);
   const panel = flowHost.querySelector('.expensica-cash-flow-panel');
   const items = Array.from(panel.querySelectorAll('.expensica-cash-flow-metric'));
   const context = [dark, mobile, currency, width].join('/');
   check(items.length === 3 && panel.lastElementChild.classList.contains('expensica-chart-range-buttons'), 'cash flow metrics above range controls ' + context);
   check(panel.querySelectorAll('.expensica-global-date-range').length === 0, 'cash flow reuses all range controls ' + context);
   check(!panel.querySelector('[title]') && items.every(item => item.querySelector('.expensica-metric-total').tooltipOptions.classes.includes('expensica-chart-tooltip')),
    'cash flow metric tooltips use chart styling without native titles ' + context);
   check(flowHost.scrollWidth <= flowHost.clientWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1, 'cash flow has no horizontal overflow ' + context);
   const positions = items.map(item => item.getBoundingClientRect());
   if (width >= 768) check(positions.every(rect => rect.top === positions[0].top), 'cash flow metrics horizontal on wide panels ' + context);
   check(getComputedStyle(panel.querySelector('.expensica-cash-flow-metrics')).justifyContent === 'center', 'cash flow metric group centered ' + context);
   const columnGap = parseFloat(getComputedStyle(panel.querySelector('.expensica-cash-flow-metrics')).columnGap);
   check(columnGap === 8, 'cash flow responsive column gap stays within spacing tokens ' + context);
   if (width <= 400) check(columnGap === 8, 'cash flow gap reaches sm token in narrow panels ' + context);
   if (width === 3200) check(columnGap === 8, 'cash flow gap stops at 2xl token ' + context);
   check(getComputedStyle(panel).paddingLeft === '8px' && getComputedStyle(panel).paddingRight === '8px',
    'cash flow uses standard horizontal panel inset for range-row consistency ' + context);
   const firstRow = positions.filter(rect => Math.abs(rect.top - positions[0].top) < 1);
   const panelBounds = panel.getBoundingClientRect();
   check(Math.abs((firstRow[0].left + firstRow[firstRow.length - 1].right) - (panelBounds.left + panelBounds.right)) < 1,
    'metric group stays centered in wide and narrow panels ' + context);
   for (let index = 1; index < firstRow.length; index++) {
    const visibleGap = firstRow[index].left - firstRow[index - 1].right;
    check(Math.abs(visibleGap - columnGap) < 1 && visibleGap <= 32, 'visible metric gap never exceeds 2xl token ' + context);
   }
   for (const [index, item] of items.entries()) {
    const label = item.querySelector('.expensica-cash-flow-label');
    const amount = item.querySelector('.expensica-card-value');
    check(item.scrollWidth <= item.clientWidth + 1 && amount.scrollWidth <= amount.clientWidth + 1
     && getComputedStyle(amount).fontSize === '12px', 'cash flow amount uses font token two steps smaller ' + context);
    check(getComputedStyle(label).color === (dark ? 'rgb(238, 238, 238)' : 'rgb(34, 34, 34)'),
     'cash flow labels use regular text color ' + context);
    check(!label.querySelector('svg') && getComputedStyle(label).fontSize === '12px', 'metric labels retain xs typography without SVGs ' + context);
    check(getComputedStyle(label).opacity === '1' && getComputedStyle(amount).opacity === '1', 'metric text uses full opacity ' + context);
    const center = element => { const rect = element.getBoundingClientRect(); return (rect.left + rect.right) / 2; };
    check(Math.abs(center(item.querySelector('.expensica-metric-total')) - center(item)) < 1, 'cash flow labels and amounts centered ' + context);
    const pill = item.querySelector('.expensica-cash-flow-comparison');
    if (pill) {
     check(pill.textContent.trim() === '50%' && pill.getAttribute('aria-label').endsWith('from ' + new Date(2026, 8, 30).toLocaleDateString(undefined, { month: 'short' }) + ', 2026.')
      && !pill.hasAttribute('title'), 'Obsidian tooltip retained without duplicate system tooltip ' + context);
     pill.dispatchEvent(new Event('mouseenter'));
     check(pill.testTooltip.classList.contains('expensica-chart-tooltip') && !pill.testTooltip.querySelector('svg') && pill.testTooltip.textContent === pill.getAttribute('aria-label'), 'cash flow uses shared SVG chart tooltip ' + context);
     check(getComputedStyle(pill).backgroundColor === 'rgb(221, 221, 221)', 'comparison pill uses a subtle theme surface ' + context);
     const meaningColor = index === 1 ? (dark ? 'rgb(106, 186, 139)' : 'rgb(25, 135, 84)') : (dark ? 'rgb(255, 133, 133)' : 'rgb(198, 60, 60)');
     check(getComputedStyle(pill.querySelector('svg')).color === meaningColor && getComputedStyle(pill).color !== meaningColor, 'trend arrow and text use financial meaning ' + context);
     check(getComputedStyle(pill.lastElementChild).opacity === '1', 'trend text uses full opacity ' + context);
     pill.dispatchEvent(new Event('mouseleave'));
     check(pill.getBoundingClientRect().top >= amount.getBoundingClientRect().bottom
      && Math.abs(center(pill) - center(item)) < 1, 'trend pill centered below amount ' + context);
    }
   }
   check(items.every(item => item.querySelector('.expensica-cash-flow-comparison')), 'all cash flow metrics include comparisons ' + context);
   check(items.every(item => item.children.length === 2), 'metrics use total and trend rows ' + context);
   const pill = items[0].querySelector('.expensica-cash-flow-comparison');
   pill.dispatchEvent(new Event('mouseenter'));
   const tip = pill.testTooltip, tooltipStyle = getComputedStyle(tip);
   check(tooltipStyle.backgroundColor === (dark ? 'rgb(38, 38, 38)' : 'rgb(238, 238, 238)')
    && tooltipStyle.color === (dark ? 'rgb(187, 187, 187)' : 'rgb(102, 102, 102)')
    && tooltipStyle.borderWidth === '1px' && tooltipStyle.fontSize === '12px', 'tooltip follows chart theme styling ' + context);
   pill.dispatchEvent(new Event('mouseleave'));
  }
 }
} catch (error) { failures.push(error.stack); }
document.documentElement.setAttribute('data-calendar-result', encodeURIComponent(JSON.stringify({ checks, failures })));
</script>`;
            const file = path.join(temporary, 'calendar.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`,
                '--window-size=1280,900', '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 8 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-calendar-result="([^"]+)"/);
            assert.ok(encoded, result.stdout.slice(-2000));
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.deepEqual(report.failures, []);
            assert.ok(report.checks > 2000, `${report.checks} browser assertions`);
            console.log(`${report.checks} calendar browser assertions passed`);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('expensica-shared-calendar-'));
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
