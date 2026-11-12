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

test('real Chart.js dims future lines and bars to 20%, removes future cumulative fill and restores on leave',
    { skip: !browser && 'Set CHROME_PATH to run browser coverage', timeout: 30000 }, () => {
        const root = path.join(__dirname, '..');
        const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/dashboard-view.ts'), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText;
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-line-dimming-'));
        try {
            const html = `<!doctype html><meta charset="utf-8"><body><script>
${fs.readFileSync(path.join(root, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8')}
</script><script>
const module = { exports: {} };
new Function('module', 'exports', 'require', ${JSON.stringify(source)})(module, module.exports, name => {
 if (name === 'obsidian') return { ItemView: class {}, Modal: class {} };
 if (name === 'chart.js') return Chart;
 if (name === 'chart.js/helpers') return Chart.helpers;
 return {};
});
const view = Object.create(module.exports.ExpensicaDashboardView.prototype);
const failures = []; let checks = 0;
function check(value, label) { checks++; if (!value) failures.push(label); }
function samePixel(left, right) { return left.every((value, index) => Math.abs(value - right[index]) <= 2); }
for (const mixed of [false, true]) for (const count of [1, 2, 7, 12, 31]) {
 const canvas = document.body.appendChild(document.createElement('canvas'));
 canvas.width = 480; canvas.height = 260;
 const values = amount => Array(count).fill(amount);
 const datasets = [
  ...(mixed ? [
   { type: 'bar', label: 'Income', data: values(2), backgroundColor: 'rgba(0,160,0,0.7)', hoverBackgroundColor: 'rgba(0,160,0,0.7)' },
   { type: 'bar', label: 'Expenses', data: values(-2), backgroundColor: '#0000ff', hoverBackgroundColor: '#0000ff' }
  ] : []),
  { type: 'line', label: mixed ? 'Net' : 'Current', data: values(4), borderColor: '#ff0000',
    backgroundColor: 'rgba(255,0,0,0.12)', fill: !mixed },
  { type: 'line', label: mixed ? 'Account' : 'Comparison', data: values(8), borderColor: 'rgba(128,0,128,0.6)', fill: false },
  { type: 'line', label: 'Gaps', data: values(6).map((value, index) => index === 1 ? null : value), borderColor: '#008080', fill: false, spanGaps: false },
  { type: 'line', label: 'Hidden', data: values(9), borderColor: '#000000', hidden: true }
 ];
 const firstLine = mixed ? 2 : 0, context = mixed + '/' + count;
 const chart = new Chart(canvas, {
  type: mixed ? 'bar' : 'line', data: { labels: Array.from({length: count}, (_, index) => 'Date ' + index), datasets },
  plugins: [view.createChartHoverDimmingPlugin()],
  options: { responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 1,
   elements: { line: { borderWidth: 4, tension: 0.35 }, point: { radius: 0, hoverRadius: 0 } },
   scales: { x: { display: false, offset: mixed }, y: { display: false, min: -3, max: 10 } },
   plugins: { legend: { display: false }, tooltip: { enabled: false } }
  }
 });
 const ledger = JSON.stringify(chart.data), visibility = datasets.map((_, index) => chart.isDatasetVisible(index));
 const pixel = (position, value) => Array.from(chart.ctx.getImageData(Math.round(chart.scales.x.getPixelForValue(position)),
  Math.round(chart.scales.y.getPixelForValue(value)), 1, 1).data);
 const samples = [];
 for (let index = 0; index < count - 1; index++) for (const value of [4, 6, 8]) {
  samples.push({ index, value, rgba: pixel(index + 0.5, value) });
 }
 const fills = Array.from({length: Math.max(0, count - 1)}, (_, index) => pixel(index + 0.5, 1));
 const barPixels = mixed ? [0, 1].flatMap(datasetIndex => chart.getDatasetMeta(datasetIndex).data.map((bar, index) => {
  const x = Math.round(bar.x), y = Math.round(chart.scales.y.getPixelForValue(datasetIndex === 0 ? 1 : -1));
  return { x, y, index, datasetIndex, rgba: Array.from(chart.ctx.getImageData(x, y, 1, 1).data) };
 })) : [];
 check(barPixels.every(sample => sample.rgba[3] > 0), 'bar samples contain rendered income/expense pixels ' + context);
 // Capture the underlying fill to isolate stroke opacity from compositing.
 const lineColors = datasets.map((_, index) => chart.getDatasetMeta(index).dataset?.options.borderColor);
 for (let index = firstLine; index < datasets.length; index++) chart.getDatasetMeta(index).dataset.options.borderColor = 'transparent';
 chart.draw();
 samples.forEach(sample => { sample.underlay = pixel(sample.index + 0.5, sample.value); });
 for (let index = firstLine; index < datasets.length; index++) chart.getDatasetMeta(index).dataset.options.borderColor = lineColors[index];
 chart.draw();
 let updates = 0, draws = 0;
 const originalUpdate = chart.update.bind(chart), originalDraw = chart.draw.bind(chart);
 chart.update = (...args) => { updates++; return originalUpdate(...args); };
 chart.draw = () => { draws++; return originalDraw(); };
 for (const activeIndex of new Set([0, Math.floor(count / 2), count - 1])) {
  chart.setActiveElements([{ datasetIndex: mixed ? 0 : firstLine, index: activeIndex }]);
  const beforeDraws = draws; chart.draw();
  check(draws === beforeDraws + 1 && updates === 0, 'hover uses only the existing draw, no update/animation ' + context);
  for (const sample of samples) {
   const actual = pixel(sample.index + 0.5, sample.value), dimmed = sample.index >= activeIndex;
   if (sample.rgba[3] === 0) check(actual[3] === 0, 'line gaps remain empty ' + context);
   else {
    // Unpremultiplying low-alpha canvas pixels amplifies one-byte rounding.
    const rgbTolerance = Math.max(3, Math.ceil(255 / Math.max(1, actual[3])));
    check(actual.slice(0,3).every((value, index) => Math.abs(value - sample.rgba[index]) <= rgbTolerance),
     'original RGB retained ' + context + ' value=' + sample.value + ' actual=' + actual + ' original=' + sample.rgba);
    const expectedAlpha = dimmed ? (sample.rgba[3] - sample.underlay[3]) / (1 - sample.underlay[3] / 255) * 0.2 : sample.rgba[3];
    check(Math.abs(actual[3] - expectedAlpha) <= 3,
     'only segments after the active date use 20% of the original stroke alpha ' + context + '/' + activeIndex + '/' + sample.index
      + ' value=' + sample.value + ' alpha=' + actual[3] + ' expected=' + expectedAlpha + ' under=' + sample.underlay[3]);
   }
  }
  if (!mixed) fills.forEach((rgba, index) => check(index >= activeIndex ? pixel(index + 0.5, 1)[3] === 0
   : samePixel(pixel(index + 0.5, 1), rgba), 'cumulative fill appears only up to the active date ' + context));
  barPixels.forEach(sample => {
   const actual = Array.from(chart.ctx.getImageData(sample.x, sample.y, 1, 1).data);
   check(actual.slice(0, 3).every((value, index) => Math.abs(value - sample.rgba[index]) <= 4)
    && Math.abs(actual[3] - sample.rgba[3] * (sample.index > activeIndex ? 0.2 : 1)) <= 3,
    'only future bars dim, preserving the entire hovered bar and original RGB ' + context);
  });
  for (let index = firstLine; index < datasets.length; index++) {
   check(chart.getDatasetMeta(index).dataset.options.borderColor === datasets[index].borderColor, 'resolved line color restored after drawing ' + context);
  }
  check(JSON.stringify(chart.data) === ledger && datasets.every((_, index) => chart.isDatasetVisible(index) === visibility[index]),
   'dataset values, fills and hidden states are unchanged ' + context);
 }
 view.bindChartAreaTooltipClear(canvas, chart);
 canvas.dispatchEvent(new Event('mouseleave'));
 check(chart.getActiveElements().length === 0, 'existing mouse-leave handler clears the active date ' + context);
 samples.forEach(sample => check(samePixel(pixel(sample.index + 0.5, sample.value), sample.rgba), 'mouse leave restores every line ' + context));
 fills.forEach((rgba, index) => check(samePixel(pixel(index + 0.5, 1), rgba), 'mouse leave restores the full cumulative fill ' + context));
 barPixels.forEach(sample => {
  const bar = chart.getDatasetMeta(sample.datasetIndex).data[sample.index];
  const x = Math.round(bar.x), y = Math.round(chart.scales.y.getPixelForValue(sample.datasetIndex === 0 ? 1 : -1));
  const actual = Array.from(chart.ctx.getImageData(x, y, 1, 1).data);
  check(samePixel(actual, sample.rgba), 'mouse leave restores all bar colors and opacity ' + context
   + '/' + sample.index + ' actual=' + actual + ' original=' + sample.rgba);
 });
 chart.setActiveElements([]); chart.draw();
 samples.forEach(sample => check(samePixel(pixel(sample.index + 0.5, sample.value), sample.rgba), 'no active date retains full opacity ' + context));
 chart.destroy(); canvas.remove();
}
document.documentElement.setAttribute('data-dimming-result', encodeURIComponent(JSON.stringify({checks, failures})));
</script>`;
            const file = path.join(temporary, 'dimming.html');
            fs.writeFileSync(file, html);
            const run = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`,
                '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 5 * 1024 * 1024 });
            assert.equal(run.status, 0, run.error?.message || run.stderr);
            const encoded = run.stdout.match(/data-dimming-result="([^"]+)"/);
            assert.ok(encoded, run.stdout.slice(-1500));
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.equal(report.failures.length, 0, report.failures.slice(0, 8).join('\n'));
            assert.ok(report.checks > 200);
            console.log(`${report.checks} line dimming browser assertions passed`);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('expensica-line-dimming-'));
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
