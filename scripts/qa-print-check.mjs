// Regresyon testi: PDF/yazdırma çıktısı window.open OLMADAN çalışıyor mu?
//
// Electron (Windows sürümü) main.cjs içinde setWindowOpenHandler TÜM window.open
// çağrılarını reddeder. Eski kod `window.open("", "_blank")` kullandığı için
// masaüstü uygulamasında Cari Ekstre / Fatura / Hakediş PDF butonları SESSİZCE
// hiçbir şey yapmıyordu. Bu test window.open'ı null döndürecek şekilde stub'layıp
// printHtmlDocument()'in yine de yazdırmayı başlattığını doğrular.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'utils', 'printDocument.ts');

// printDocument.ts'i tarayicida calistirilabilir tek dosyaya paketle.
const bundled = await build({
  stdin: {
    contents: `import { printHtmlDocument } from ${JSON.stringify(entry)};\nwindow.printHtmlDocument = printHtmlDocument;`,
    resolveDir: path.join(here, '..'),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const bundleJs = bundled.outputFiles[0].text;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/bundle.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(bundleJs);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>print test</title></head><body><script src="/bundle.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
// Yerel makinede Playwright kendi tarayicisini bulur; CI/konteynerde QA_CHROMIUM ile yol verilebilir.
const launchOptions = process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();

await page.addInitScript(() => {
  // Electron'un setWindowOpenHandler('deny') davranışını taklit et.
  window.__openCalls = 0;
  window.open = function () { window.__openCalls++; return null; };
  window.__printCalls = 0;
  window.__printedHtml = '';
  // document.open()/write() iframe penceresinin özelliklerini sıfırlayabildiği
  // için print kancası kısa aralıklarla yeniden kurulur.
  const hook = (frame) => {
    const w = frame.contentWindow;
    if (!w || w.__hooked) return;
    try {
      w.__hooked = true;
      w.print = function () {
        window.__printCalls++;
        try { window.__printedHtml = frame.contentDocument.documentElement.outerHTML; } catch { /* ignore */ }
      };
    } catch { /* cross-origin değil, yok say */ }
  };
  window.setInterval(() => {
    document.querySelectorAll('iframe').forEach((f) => {
      try { if (f.contentWindow && !f.contentWindow.__hooked) hook(f); } catch { /* ignore */ }
      // document.open sonrası tekrar kur
      try { if (f.contentWindow && typeof f.contentWindow.print === 'function' && !f.contentWindow.__hooked) hook(f); } catch { /* ignore */ }
    });
  }, 15);
});

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.printHtmlDocument === 'function');

const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Cari Ekstre</title></head>
<body><h1 id="baslik">Tedarikçi Cari Ekstresi</h1><table><tr><td>Nakit ile ödeme</td><td>1.234,00 TL</td></tr></table></body></html>`;

const returned = await page.evaluate((doc) => window.printHtmlDocument(doc, { title: 'Cari Ekstre', fileName: 'cari-ekstre' }), html);
await page.waitForTimeout(1500);

const stats = await page.evaluate(() => ({
  openCalls: window.__openCalls,
  printCalls: window.__printCalls,
  containsHeading: window.__printedHtml.includes('Tedarikçi Cari Ekstresi'),
  containsRow: window.__printedHtml.includes('Nakit ile ödeme'),
  leftoverIframes: document.querySelectorAll('iframe').length,
}));

console.log(JSON.stringify({ returned, ...stats }, null, 2));

const ok = returned === true && stats.openCalls === 0 && stats.printCalls >= 1 && stats.containsHeading && stats.containsRow;
console.log(ok
  ? 'PASS  yazdırma window.open olmadan başlatıldı ve içerik doğru aktarıldı'
  : 'FAIL  yazdırma başlatılamadı ya da içerik aktarılamadı');

await browser.close();
server.close();
process.exit(ok ? 0 : 1);
