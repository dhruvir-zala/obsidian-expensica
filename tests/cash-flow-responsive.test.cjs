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

test('two-line metrics keep typography and trend colors consistent and hide only wide lower-chart ranges',
    { skip: !browser && 'Set CHROME_PATH to run responsive coverage', timeout: 30000 }, () => {
        const root = path.join(__dirname, '..');
        const models = {};
        const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/models.ts'), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText;
        new Function('exports', 'require', compiled)(models, () => ({}));
        const fixtures = ['USD', 'CAD', 'JPY', 'KWD'].flatMap(currency => [false, true].map(large => ({
            currency, large,
            amounts: (large ? [123456789.12, 23456789.12, 100000000] : [1234.56, 617.28, 617.28])
                .map(value => models.formatCurrency(value, currency))
        })));
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-cash-flow-responsive-'));
        try {
            const html = `<!doctype html><meta charset="utf-8"><style>${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}</style>
<style>:root { --text-normal-rgb: 34, 34, 34; } body { margin: 0; font-family: Arial, sans-serif; --text-normal: #222; --text-muted: #666;
--text-normal-rgb: 34, 34, 34; --text-success: green; --text-error: red; --text-on-accent: white; }</style><body><main></main><script>
const fixtures = ${JSON.stringify(fixtures)}, host = document.querySelector('main'), failures = []; let checks = 0;
function check(value, label) { checks++; if (!value) failures.push(label); }
for (const mobile of [false, true]) for (const fixture of fixtures) for (const width of [160, 240, 280, 320, 360, 375, 390, 400, 430, 768, 1024]) {
 document.body.classList.toggle('is-mobile', mobile); host.style.width = width + 'px';
 host.innerHTML = '<div class="expensica-cash-flow-container"><section class="expensica-chart-container expensica-cash-flow-panel">'
  + '<h3 class="expensica-chart-title">Cash Flow</h3><div class="expensica-cash-flow-metrics">'
  + ['Income', 'Expenses', 'Net Flow'].map((label, index) => '<div class="expensica-cash-flow-metric" style="--expensica-cash-flow-color:var(--text-success)">'
   + '<div class="expensica-metric-total"><span class="expensica-cash-flow-label">' + label + ': </span>'
   + '<span class="expensica-card-value">' + fixture.amounts[index] + '</span></div>'
   + '<div class="expensica-card-trend expensica-cash-flow-comparison is-positive"><span class="expensica-card-trend-indicator is-positive"><svg viewBox="0 0 24 24"></svg></span><span>50%</span></div>'
   + '</div>').join('') + '</div></section></div>';
 const panel = host.querySelector('section'), group = host.querySelector('.expensica-cash-flow-metrics');
 const items = Array.from(group.children), boxes = items.map(item => item.getBoundingClientRect());
 const gap = parseFloat(getComputedStyle(group).columnGap), context = [mobile, fixture.currency, fixture.large, width].join('/');
 check(host.scrollWidth <= host.clientWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1, 'no panel overflow ' + context);
 check(gap >= 4 && gap <= 32, 'existing gap bounds preserved ' + context);
 const panelBounds = panel.getBoundingClientRect();
 for (const top of new Set(boxes.map(box => box.top))) {
  const row = boxes.filter(box => box.top === top);
  check(Math.abs(row[0].left + row[row.length - 1].right - panelBounds.left - panelBounds.right) < 1, 'row remains centered ' + context);
  for (let index = 1; index < row.length; index++) check(Math.abs(row[index].left - row[index - 1].right - gap) < 1, 'no extra space between metrics ' + context);
 }
 items.forEach((item, index) => {
  const amount = item.querySelector('.expensica-card-value'), label = item.querySelector('.expensica-cash-flow-label');
  check(getComputedStyle(label).fontSize === getComputedStyle(amount).fontSize && getComputedStyle(label).fontWeight === '400', 'regular labels match amount size ' + context);
  if (!fixture.large && width >= 240) check(Math.abs(label.getBoundingClientRect().top - amount.getBoundingClientRect().top) < 2, 'name and amount share the first line ' + context);
  check(amount.textContent === fixture.amounts[index] && getComputedStyle(amount).fontSize === '12px', 'format and font retained ' + context);
  check(item.scrollWidth <= item.clientWidth + 1 && amount.scrollWidth <= amount.clientWidth + 1, 'long amounts remain readable ' + context);
  const pill = item.querySelector('.expensica-cash-flow-comparison');
  check(item.children.length === 2 && Math.abs(pill.getBoundingClientRect().top - item.firstElementChild.getBoundingClientRect().bottom - 8) < 1, 'trend is the second row with an 8px gap ' + context);
  check(getComputedStyle(pill.lastElementChild).color === 'rgba(34, 34, 34, 0.5)' && getComputedStyle(pill.querySelector('svg')).color === 'rgb(0, 128, 0)', 'only trend SVG has a semantic color ' + context);
  check(pill.scrollWidth <= pill.clientWidth + 1, 'comparison fits slot ' + context);
 });
}
host.innerHTML = '<div class="expensica-dashboard expensica-overview">'
 + '<div class="expensica-cash-flow-panel"><button class="expensica-cash-flow-info"><svg></svg></button><div class="expensica-chart-range-buttons">Cash Flow ranges</div></div>'
 + '<div class="expensica-account-balances-row"><div class="expensica-card expensica-overview-card-balance"><h3 class="expensica-card-title">Account</h3><span class="expensica-card-value">$100.00</span></div></div>'
 + '<div class="expensica-dashboard-grid"><div class="expensica-chart-container expensica-income-expense-chart-container"></div>'
 + '<div class="expensica-chart-container expensica-expenses-chart-container"><div class="expensica-chart-range-buttons">Categories ranges</div></div></div></div>';
for (const width of [375, 1200, 375]) {
 host.style.width = width + 'px';
 const lowerRanges = host.querySelectorAll('.expensica-dashboard-grid .expensica-chart-range-buttons');
 check(Array.from(lowerRanges).every(row => (getComputedStyle(row).display === 'none') === (width === 1200)), 'lower-chart ranges hide only in wide view ' + width);
 check(getComputedStyle(host.querySelector('.expensica-cash-flow-panel .expensica-chart-range-buttons')).display !== 'none', 'Cash Flow range row stays visible ' + width);
 check(getComputedStyle(host.querySelector('.expensica-account-balances-row .expensica-card-value')).fontSize === '20px', 'balance card amount increases two tokens to xl ' + width);
 check(getComputedStyle(host.querySelector('.expensica-card-title')).fontWeight === '400', 'account metric label uses regular weight ' + width);
 check(getComputedStyle(host.querySelector('.expensica-cash-flow-info svg')).color === 'rgb(102, 102, 102)', 'info SVG uses muted text token ' + width);
}
document.documentElement.setAttribute('data-responsive-result', encodeURIComponent(JSON.stringify({ checks, failures })));
</script>`;
            const file = path.join(temporary, 'responsive.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`,
                '--window-size=1280,900', '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-responsive-result="([^"]+)"/);
            assert.ok(encoded, result.stdout.slice(-1200));
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.deepEqual(report.failures, []);
            assert.ok(report.checks > 1000);
            console.log(`${report.checks} focused responsive assertions passed`);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('expensica-cash-flow-responsive-'));
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
