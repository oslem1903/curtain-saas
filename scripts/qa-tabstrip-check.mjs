// Regresyon testi: mobilde yatay kaydırılabilir sekme şeritleri gerçekten
// kaydırılabiliyor mu?
//
// index.css içinde @media(max-width:640px) altında `.overflow-x-auto { overflow-x:
// visible !important }` kuralı vardı. html/body `overflow-x: clip` olduğu için bu,
// ekrandan taşan sekmelerin kırpılmasına ve parmakla ULAŞILAMAMASINA yol açıyordu
// (örn. Tahsilatlar ekranındaki Geciken / Bugün / Bu Hafta / Bu Ay / İleri /
// Tahsil Edilen sekmeleri). Bu test, Collections.tsx'teki gerçek markup'ı
// uygulamanın gerçek CSS'iyle render edip şeridin kaydırılabilirliğini ölçer.
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4173';
// Yerel makinede Playwright kendi tarayicisini bulur; CI/konteynerde QA_CHROMIUM ile yol verilebilir.
const launchOptions = process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {};

const TABS = ['Geciken', 'Bugün', 'Bu Hafta', 'Bu Ay', 'İleri Tarihli', 'Tahsil Edilen'];

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
const legacy = process.argv.includes('--legacy');
await page.evaluate((v) => { window.__QA_LEGACY_CSS__ = v; }, legacy);
if (legacy) console.log('MOD: eski CSS kuralı geri yüklendi (regresyon kontrolü)');

const result = await page.evaluate((tabs) => {
  const host = document.createElement('div');
  host.id = 'qa-tabstrip';
  // Gerçek sayfa genişliğini taklit et (Layout içindeki içerik sütunu).
  host.style.width = '390px';
  host.style.maxWidth = '100%';
  // "before" modunda eski CSS kuralı geri getirilir; testin gerçekten
  // regresyon yakaladığını doğrulamak için.
  if (window.__QA_LEGACY_CSS__) {
    const style = document.createElement('style');
    style.textContent = '@media (max-width: 640px){ .overflow-x-auto { overflow-x: visible !important; } }';
    document.head.appendChild(style);
  }
  host.innerHTML = `
    <div class="flex gap-2 overflow-x-auto pb-1">
      ${tabs.map((t) => `
        <button class="flex shrink-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left border-slate-200 bg-white">
          <span class="flex items-center gap-1.5 text-xs font-black text-slate-700">${t}</span>
          <span class="text-sm font-black text-slate-900">12.345,00 ₺</span>
        </button>`).join('')}
    </div>`;
  document.body.appendChild(host);
  const strip = host.querySelector('.overflow-x-auto');
  const cs = getComputedStyle(strip);
  const buttons = Array.from(strip.querySelectorAll('button'));
  strip.scrollLeft = 99999;
  const scrolled = strip.scrollLeft;
  const info = {
    overflowX: cs.overflowX,
    clientWidth: strip.clientWidth,
    scrollWidth: strip.scrollWidth,
    contentWiderThanViewport: strip.scrollWidth > strip.clientWidth,
    canScrollToEnd: scrolled > 0,
    lastTabReachable: (() => {
      const last = buttons[buttons.length - 1].getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return last.right <= stripRect.right + 1 && last.left >= stripRect.left - 1;
    })(),
    documentHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
  host.remove();
  return info;
}, TABS);

console.log(JSON.stringify(result, null, 2));

const ok =
  result.contentWiderThanViewport &&
  (result.overflowX === 'auto' || result.overflowX === 'scroll') &&
  result.canScrollToEnd &&
  result.lastTabReachable &&
  !result.documentHorizontalOverflow;

console.log(ok ? 'PASS  sekme şeridi mobilde kaydırılabilir ve son sekmeye ulaşılabiliyor'
               : 'FAIL  sekme şeridi mobilde kaydırılamıyor / son sekmeye ulaşılamıyor');

await browser.close();
process.exit(ok ? 0 : 1);
