const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const ts = require('typescript');

const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(candidate => candidate && fs.existsSync(candidate));

test('real DOM removal and separate windows retain quick-menu cleanup, positioning and theme styling',
    { skip: !browser && 'Set CHROME_PATH to run the browser regression', timeout: 30000 }, () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-quick-menu-'));
        try {
            const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/category-quick-menu.ts'), 'utf8'), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
            }).outputText;
            const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
            const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><body><script>
function install(win) {
  win.HTMLElement.prototype.empty = function() { this.replaceChildren(); };
  win.HTMLElement.prototype.addClass = function(name) { this.classList.add(name); };
  win.HTMLElement.prototype.createEl = function(tag, options = {}) {
    if (typeof options === 'string') options = { cls: options };
    const element = this.ownerDocument.createElement(tag);
    element.className = options.cls || ''; element.textContent = options.text || '';
    for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
    this.append(element); return element;
  };
  win.HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
  win.HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
}
function listeners(target) {
  const active = new Map(), add = target.addEventListener, remove = target.removeEventListener;
  target.addEventListener = function(type, callback, ...args) {
    if (!active.has(type)) active.set(type, new Set()); active.get(type).add(callback);
    return add.call(this, type, callback, ...args);
  };
  target.removeEventListener = function(type, callback, ...args) {
    active.get(type)?.delete(callback); return remove.call(this, type, callback, ...args);
  };
  return () => [...active.values()].reduce((count, entries) => count + entries.size, 0);
}
const require = name => name === 'obsidian' ? { Modal: class {} } : name === './models'
  ? { appendSvgIcon() {}, INTERNAL_CATEGORY_ID: 'internal' } : {};
const menu = (() => { const exports = {}; ${source}; return exports; })();
const failures = []; let checks = 0;
function check(condition, message) { checks++; if (!condition) failures.push(message); }
async function run() {
  install(window);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:400px;height:300px'; document.body.append(iframe);
  const popout = iframe.contentWindow; install(popout);
  popout.document.head.innerHTML = '<style>' + ${JSON.stringify(css)} + '</style>';
  const documents = [document, popout.document];
  const counts = documents.map(doc => ({ doc: listeners(doc), win: listeners(doc.defaultView) }));
  const plugin = { getCategories: () => [{ id: 'a', name: 'Alpha' }], getCategoryEmoji: () => 'x',
    hasSaveFailure: () => false, releaseSaveOperation() {} };
  for (const doc of documents) for (const modal of [false, true]) for (const dark of [false, true]) {
    const win = doc.defaultView, count = counts[documents.indexOf(doc)];
    doc.body.className = dark ? 'theme-dark' : 'theme-light';
    const color = dark ? 'rgb(12, 34, 56)' : 'rgb(230, 240, 250)';
    doc.body.style.setProperty('--background-primary', color);
    doc.body.style.setProperty('--background-modifier-border', '#888');
    for (let cycle = 0; cycle < 5; cycle++) {
      const origin = doc.body.createDiv(modal ? 'modal-content' : 'view');
      const target = origin.createEl('button'); target.textContent = 'Category';
      target.style.cssText = 'position:fixed;left:300px;top:40px;width:80px;height:20px';
      menu.showCategoryQuickMenu(target, plugin, 'expense', () => {});
      const element = doc.querySelector('.expensica-category-quick-menu');
      check(!!element && element.ownerDocument === doc, 'menu document ownership');
      if (!element) return;
      check(element.parentElement === (modal ? origin : doc.body), 'menu host');
      check(win.getComputedStyle(element).backgroundColor === color, 'theme background');
      check(element.getBoundingClientRect().right <= win.innerWidth - 11, 'viewport positioning');
      check(count.doc() === 3 && count.win() === 2, 'one set of document/window listeners');
      target.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
      check(element.isConnected, 'target interactions keep menu open');
      if (cycle % 2 === 0) origin.remove();
      else doc.body.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
      check(!element.isConnected, 'origin removal or outside click closes menu');
      check(count.doc() === 0 && count.win() === 0, 'all listeners disposed');
      origin.remove();
    }
  }
}
run().catch(error => failures.push(error.stack || String(error))).finally(() => {
  document.documentElement.setAttribute('data-quick-menu-result', encodeURIComponent(JSON.stringify({ checks, failures })));
});
</script>`;
            const file = path.join(temporary, 'menu.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run',
                '--no-default-browser-check', '--disable-background-networking',
                `--user-data-dir=${path.join(temporary, 'profile')}`, '--window-size=900,700',
                '--virtual-time-budget=1000', '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-quick-menu-result="([^"]+)"/);
            assert.ok(encoded, `browser must execute the lifecycle checks: ${result.stderr}`);
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.equal(report.failures.length, 0, JSON.stringify(report.failures.slice(0, 5)));
            assert.equal(report.checks, 320);
        } finally {
            const resolved = path.resolve(temporary);
            assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
            assert.ok(path.basename(resolved).startsWith('expensica-quick-menu-'));
            fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
