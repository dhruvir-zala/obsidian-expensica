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

test('Chart.js owns progressive entrances, cosmetic redraws do not restart them and teardown cancels them',
    { skip: !browser && 'Set CHROME_PATH to run browser coverage', timeout: 30000 }, () => {
        const root = path.join(__dirname, '..');
        const sources = Object.fromEntries(['models', 'dashboard-view'].map(name => [name,
            ts.transpileModule(fs.readFileSync(path.join(root, `src/${name}.ts`), 'utf8'), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
            }).outputText
        ]));
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-chart-entrance-'));
        try {
            const html = `<!doctype html><meta charset="utf-8"><body><script>
let clock = Date.now(), nextFrame = 0, timers = 0, reduced = false;
const frames = new Map(), nativeTimeout = window.setTimeout;
Date.now = () => clock;
Object.defineProperty(performance, 'now', { value: () => clock });
window.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
window.cancelAnimationFrame = id => frames.delete(id);
window.setTimeout = (...args) => { timers++; return nativeTimeout(...args); };
window.matchMedia = () => ({ matches: reduced });
function advance(ms) { clock += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(clock)); }
HTMLElement.prototype.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
</script><script>${fs.readFileSync(path.join(root, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8')}</script><script>
const sources = ${JSON.stringify(sources)}, modules = {};
function load(name) {
 if (name === 'obsidian') return { ItemView: class {}, Modal: class {} };
 if (name === 'chart.js') return Chart;
 if (name === 'chart.js/helpers') return Chart.helpers;
 const key = name.replace('./', '');
 if (!sources[key]) return {};
 if (!modules[key]) { modules[key] = {}; new Function('exports', 'require', sources[key])(modules[key], load); }
 return modules[key];
}
const { ExpensicaDashboardView } = load('dashboard-view');
const view = Object.assign(Object.create(ExpensicaDashboardView.prototype), { plugin: { settings: { defaultCurrency: 'USD' } } });
const failures = []; let checks = 0;
function check(value, message) { checks++; if (!value) failures.push(message); }
function create(kind, animate = true) {
 const wrapper = document.body.appendChild(document.createElement('div'));
 wrapper.style.cssText = 'position:relative;width:480px;height:260px';
 const canvas = wrapper.appendChild(document.createElement('canvas')); canvas.width = 480; canvas.height = 260;
 const mixed = kind === 'mixed', doughnut = kind === 'doughnut', values = value => Array(5).fill(value);
 const datasets = doughnut ? [{ data: [10,20,30], backgroundColor: ['red','green','blue'], hoverOffset: 15 }] : [
  ...(mixed ? [{ type: 'bar', data: values(3), backgroundColor: 'green' }, { type: 'bar', data: values(-2), backgroundColor: 'blue' }] : []),
  { type: 'line', data: values(5), borderColor: 'red', backgroundColor: 'rgba(255,0,0,0.2)', fill: !mixed },
  { type: 'line', data: values(8), borderColor: 'purple', fill: false }
 ];
 const animation = view.getChartAnimationOptions(animate);
 const chart = new Chart(canvas, { type: doughnut ? 'doughnut' : mixed ? 'bar' : 'line',
  data: { labels: doughnut ? ['A','B','C'] : ['A','B','C','D','E'], datasets },
  plugins: doughnut ? [view.createDoughnutCenterTextPlugin()] : [view.createChartHoverDimmingPlugin(animate ? view.getChartAnimationDuration() : 0)],
  options: { responsive: false, maintainAspectRatio: false, devicePixelRatio: 1, rotation: 0,
   animation: animation && { ...animation, ...(doughnut ? { animateRotate: true, animateScale: false } : {}) },
   transitions: { active: { animation: { duration: view.getChartAnimationDuration() } } },
   elements: { point: { radius: 0, hoverRadius: 4 }, line: { borderWidth: 4 } },
   ...(doughnut ? {} : { scales: { x: { display: false, offset: mixed }, y: { display: false, min: -3, max: 10 } } }),
   plugins: { legend: { display: false }, tooltip: { enabled: false } }
  }
 });
 const pixel = (fraction, value) => chart.ctx.getImageData(Math.round(chart.chartArea.left + chart.chartArea.width * fraction),
  Math.round(chart.scales.y.getPixelForValue(value)),1,1).data[3];
 return { chart, wrapper, canvas, pixel };
}
try {
 for (const kind of ['line','mixed']) {
  const { chart, wrapper, canvas, pixel } = create(kind), data = JSON.stringify(chart.data), firstLine = kind === 'mixed' ? 2 : 0;
  advance(100);
  check(pixel(0.2,5) > 0 && pixel(0.85,5) === 0, kind + ' reveals the line from the left');
  check(pixel(0.2,8) > 0 && pixel(0.85,8) === 0, kind + ' reveals comparison/account lines together');
  if (kind === 'line') check(pixel(0.2,1) > 0 && pixel(0.85,1) === 0, 'cumulative fill follows the line reveal');
  else {
   const y = chart.scales.y, zero = y.getPixelForValue(0);
   const income = chart.getDatasetMeta(0).data[0], expense = chart.getDatasetMeta(1).data[0];
   check(income.y < zero && income.y > y.getPixelForValue(3), 'income rises partway from zero');
   check(expense.y > zero && expense.y < y.getPixelForValue(-2), 'expenses descend partway from zero');
  }
  chart.setActiveElements([{ datasetIndex: firstLine, index: 1 }]); chart.draw(); advance(100);
  check(pixel(0.75,5) > 0, kind + ' hover does not restart the entrance');
  view.bindChartAreaTooltipClear(canvas, chart); canvas.dispatchEvent(new Event('mouseleave'));
  wrapper.style.width = '500px'; view.resizeChartToContainer(chart, true);
  check(Chart.animator.running(chart), kind + ' layout resizing preserves the running entrance');
  advance(650); advance(1);
  check(pixel(0.85,5) > 0 && pixel(0.85,8) > 0, kind + ' completes every line');
  check(chart.options.animation && chart.options.animation.duration === 0, kind + ' completion disables ordinary transitions while retaining hover animation support');
  const settledFrames = frames.size;
  chart.draw(); chart.update('none'); chart.draw();
  check(!Chart.animator.running(chart) && frames.size === settledFrames, kind + ' tooltip/focus/scroll redraws do not rearm entrances');
  check(JSON.stringify(chart.data) === data, kind + ' animation preserves dataset values and colors');
  if (kind === 'mixed') {
   view.incomeExpenseChart = chart;
   view.replayIncomeExpenseDatasetAnimation(chart, firstLine); advance(1); advance(100);
   const point = chart.getDatasetMeta(firstLine).data[0];
   check(Chart.animator.running(chart) && point.y > chart.scales.y.getPixelForValue(5)
    && point.y < chart.scales.y.getPixelForValue(0), 'legend hover replay retains its existing native y animation');
   check(chart.ctx.getImageData(Math.round(chart.chartArea.left + chart.chartArea.width * 0.85), Math.round(point.y),1,1).data[3] > 0,
    'legend replay does not restart the left-to-right entrance');
   advance(600); advance(1); view.incomeExpenseChart = null;
  }
  chart.destroy(); wrapper.remove(); advance(1);
 }
 const donut = create('doughnut'); advance(100);
 const arcs = donut.chart.getDatasetMeta(0).data, total = arcs.reduce((sum, arc) => sum + arc.circumference, 0);
 check(Math.abs(arcs[0].startAngle + Math.PI / 2) < 0.001, 'doughnut starts at twelve oclock');
 check(total > 0 && total < Math.PI * 2, 'doughnut progressively completes the circle clockwise');
 check(arcs.every((arc, index) => Math.abs(arc.circumference / total - [1/6,2/6,3/6][index]) < 0.001), 'doughnut proportions stay unchanged during entrance');
 advance(500); advance(1);
 check(Math.abs(arcs.reduce((sum, arc) => sum + arc.circumference, 0) - Math.PI * 2) < 0.001, 'doughnut completes the circle');
 donut.chart.destroy(); donut.wrapper.remove(); advance(1);
 // Fresh charts and cosmetic updates must retain native pointer and tooltip transitions.
 for (const animate of [false, true]) for (const kind of ['doughnut','line','mixed']) {
  const item = create(kind, animate), chart = item.chart;
  advance(650); advance(1);
  chart.options.plugins.tooltip.enabled = true; chart.update('none');
  const datasetIndex = kind === 'mixed' ? 2 : 0, element = chart.getDatasetMeta(datasetIndex).data[0];
  const point = kind === 'doughnut' ? element.getCenterPoint() : {x:element.x,y:element.y};
  const value = () => kind === 'doughnut' ? element.options.offset : element.options.radius;
  const target = kind === 'doughnut' ? 15 : 4, context = kind + '/' + animate;
  chart._eventHandler({type:'mousemove',x:point.x,y:point.y,native:{type:'mousemove'}});
  check(chart.getActiveElements().length > 0 && value() === 0 && Chart.animator.running(chart), context + ' first settled hover does not snap');
  advance(100);
  check(value() > 0 && value() < target, context + ' hover has an intermediate frame');
  check(chart.tooltip.opacity > 0 && chart.tooltip.opacity < 1, context + ' tooltip fades in');
  advance(650); advance(1);
  chart._eventHandler({type:'mouseout',x:null,y:null,native:{type:'mouseout'}});
  check(value() === target, context + ' pointer exit does not snap');
  advance(100); check(value() > 0 && value() < target, context + ' hover exit has an intermediate frame');
  advance(650); advance(1); check(value() === 0, context + ' hover exit settles');
  if (kind === 'doughnut') {
   view.activateCategorySlice(chart,0,{pointerType:'mouse'});
   check(value() === 0 && Chart.animator.running(chart), context + ' legend hover renders without overwriting its active transition');
   advance(100); check(value() > 0 && value() < target, context + ' legend hover interpolates');
   advance(650); advance(1); view.clearCategorySlice(chart);
   check(value() === target && Chart.animator.running(chart), context + ' legend exit animates');
   advance(650); advance(1);
  }
  view.cancelDoughnutLabelAnimation(); chart.destroy(); item.wrapper.remove(); advance(1);
 }
 // Toggling one chart's legend must preserve a sibling's in-flight entrance cleanup.
 const mixed = create('mixed'), siblingDonut = create('doughnut');
 view.incomeExpenseChart = mixed.chart; view.expensesChart = siblingDonut.chart;
 advance(100);
 const completion = mixed.chart.config.options.animation.onComplete;
 view.temporarilyEnableChartAnimations(siblingDonut.chart);
 siblingDonut.chart.toggleDataVisibility(0); siblingDonut.chart.update();
 check(mixed.chart.config.options.animation.onComplete === completion, 'legend changes preserve the sibling entrance callback');
 advance(650); advance(1);
 check(mixed.chart.config.options.datasets.line?.animations?.y?.duration !== 0, 'sibling entrance restores its temporary line settings');
 view.replayIncomeExpenseDatasetAnimation(mixed.chart,2); advance(1);
 const replayPoint = mixed.chart.getDatasetMeta(2).data[0], zero = mixed.chart.scales.y.getPixelForValue(0), targetY = mixed.chart.scales.y.getPixelForValue(5);
 check(replayPoint.y === zero, 'line replay after a sibling legend action starts at zero');
 advance(100); check(replayPoint.y > targetY && replayPoint.y < zero, 'line replay after a sibling legend action interpolates');
 advance(650); advance(1);
 mixed.chart.destroy(); siblingDonut.chart.destroy(); mixed.wrapper.remove(); siblingDonut.wrapper.remove();
 view.incomeExpenseChart = null; view.expensesChart = null; advance(1);
 const cancelled = create('line'); advance(100); const id = cancelled.chart.id;
 cancelled.chart.destroy(); cancelled.wrapper.remove(); advance(600); advance(1);
 check(!Chart.getChart(id) && !Chart.animator.running(cancelled.chart), 'destroy removes the native entrance animation');
 reduced = true;
 check(view.getChartAnimationDuration() === 0, 'reduced motion disables the existing animation duration');
 for (const kind of ['line','mixed','doughnut']) {
  const item = create(kind);
  check(!Chart.animator.running(item.chart), kind + ' reduced motion never schedules an entrance');
  if (kind !== 'doughnut') check(item.pixel(0.85,5) > 0, kind + ' reduced motion displays the complete line immediately');
  const datasetIndex = kind === 'mixed' ? 2 : 0;
  item.chart.setActiveElements([{datasetIndex,index:0}]); item.chart.render();
  check(!Chart.animator.running(item.chart), kind + ' reduced motion disables native hover transitions');
  if (kind === 'doughnut') {
   check(view.doughnutLabelAnimationFrame == null && view.doughnutLabelAnimationValue === view.doughnutLabelAnimationTarget, 'reduced motion donut counter finishes immediately without a frame');
   view.cancelDoughnutLabelAnimation();
  }
  item.chart.destroy(); item.wrapper.remove();
 }
 check(timers === 0, 'entrance and completion use no timers');
} catch (error) { failures.push(error.stack || String(error)); }
document.documentElement.setAttribute('data-entrance-result', encodeURIComponent(JSON.stringify({checks, failures})));
</script>`;
            const file = path.join(temporary, 'entrance.html'); fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`, '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 5 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-entrance-result="([^"]+)"/); assert.ok(encoded, result.stdout.slice(-1500));
            const report = JSON.parse(decodeURIComponent(encoded[1])); assert.deepEqual(report.failures, []);
            assert.ok(report.checks >= 30); console.log(`${report.checks} native entrance assertions passed`);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(temporary).startsWith('expensica-chart-entrance-'));
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
