// Tarayıcı tabanlı QA kontrolü (headless Chromium).
//   node scripts/qa-browser-check.mjs [baseUrl]
// - Konsol hatalarını toplar
// - Mobil (390x844) ve masaüstü (1440x900) genişliklerinde yatay taşma ölçer
// - Yatay kaydırılabilir şeritlerin (overflow-x-auto) gerçekten kaydırılabilir
//   olduğunu doğrular
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4173';
const routes = ['#/login', '#/register', '#/unauthorized', '#/locked'];
const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

// Yerel makinede Playwright kendi tarayicisini bulur; CI/konteynerde QA_CHROMIUM ile yol verilebilir.
const launchOptions = process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {};
const browser = await chromium.launch(launchOptions);
let failures = 0;

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const offenders = [];
      const limit = de.clientWidth + 1;
      document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > limit) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 90),
            right: Math.round(r.right),
          });
        }
      });
      const strips = Array.from(document.querySelectorAll('.overflow-x-auto')).map((el) => ({
        cls: String(el.className || '').slice(0, 70),
        scrollable: el.scrollWidth > el.clientWidth,
        overflowX: getComputedStyle(el).overflowX,
      }));
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        offenders: offenders.slice(0, 8),
        strips,
        bodyText: (document.body.innerText || '').slice(0, 120),
      };
    });

    const horizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 1;
    const badStrips = metrics.strips.filter((s) => s.scrollable && s.overflowX !== 'auto' && s.overflowX !== 'scroll');
    const ok = !horizontalOverflow && consoleErrors.length === 0 && badStrips.length === 0;
    if (!ok) failures++;

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${vp.name}  ${route}`);
    console.log(`      scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} strips=${metrics.strips.length}`);
    if (horizontalOverflow) console.log('      OVERFLOW offenders:', JSON.stringify(metrics.offenders));
    if (badStrips.length) console.log('      NON-SCROLLABLE STRIPS:', JSON.stringify(badStrips));
    if (consoleErrors.length) console.log('      CONSOLE:', consoleErrors.slice(0, 5));
    await page.close();
  }
  await context.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
