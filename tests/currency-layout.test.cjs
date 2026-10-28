const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const browser = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(candidate => candidate && fs.existsSync(candidate));

test('currency prefixes and numeric text do not overlap or overflow narrow/mobile form rows',
    { skip: !browser && 'Set CHROME_PATH to run the browser layout regression', timeout: 30000 }, () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'expensica-currency-layout-'));
        try {
            const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
            const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>${css}</style><style>
body { margin: 0; font-family: Arial, sans-serif; }
.expensica-modal { --expensica-font-size-sm: 14px; --expensica-gap-md: 12px;
  --background-modifier-border: #888; --expensica-radius-sm: 4px; --expensica-line-height-tight: 1.2; }
</style><main class="expensica-modal"></main><script>
const root = document.querySelector('main');
const failures = []; let checks = 0;
for (const width of [160, 240, 320, 400]) for (const symbol of ['$', '¥', 'KWD', 'CHF', 'د.ك']) {
  root.style.width = width + 'px';
  const row = document.createElement('div'); row.className = 'expensica-form-row';
  root.replaceChildren(row);
  for (const edited of [false, true]) {
    const group = document.createElement('div'); group.className = 'expensica-form-group'; row.append(group);
    const wrapper = document.createElement('div'); wrapper.className = 'expensica-currency-input'; group.append(wrapper);
    const prefix = document.createElement('span'); prefix.className = 'expensica-currency-symbol'; prefix.textContent = symbol;
    const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.min = '0'; input.value = '1.234';
    input.className = 'expensica-form-input' + (edited ? ' expensica-edit-field' : ''); wrapper.append(prefix, input);
  }
  for (const wrapper of row.querySelectorAll('.expensica-currency-input')) {
    const prefix = wrapper.children[0], input = wrapper.children[1];
    const p = prefix.getBoundingClientRect(), i = input.getBoundingClientRect(), w = wrapper.getBoundingClientRect();
    const style = getComputedStyle(input);
    const textLeft = i.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    checks++;
    if (p.right >= textLeft || i.width < 20 || w.right > row.getBoundingClientRect().right + 1 ||
        wrapper.scrollWidth > wrapper.clientWidth + 1 || !input.checkValidity()) {
      failures.push({ width, symbol, prefixRight: p.right, textLeft, inputWidth: i.width, overflow: wrapper.scrollWidth - wrapper.clientWidth });
    }
  }
}
document.documentElement.setAttribute('data-layout-result', encodeURIComponent(JSON.stringify({ checks, failures })));
</script>`;
            const file = path.join(temporary, 'layout.html');
            fs.writeFileSync(file, html);
            const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run',
                '--no-default-browser-check', '--disable-background-networking',
                `--user-data-dir=${path.join(temporary, 'profile')}`, '--window-size=320,800',
                '--dump-dom', pathToFileURL(file).href],
            { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            const encoded = result.stdout.match(/data-layout-result="([^"]+)"/);
            assert.ok(encoded, `browser must execute the layout assertions: ${result.stdout.slice(-1500)} ${result.stderr}`);
            const report = JSON.parse(decodeURIComponent(encoded[1]));
            assert.equal(report.checks, 40);
            assert.deepEqual(report.failures, []);
        } finally {
            const resolved = path.resolve(temporary);
            assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
            assert.ok(path.basename(resolved).startsWith('expensica-currency-layout-'));
            fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });
