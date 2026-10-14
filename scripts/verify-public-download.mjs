// Herkese acik indirmeyi TEMIZ tarayicida (oturum/cerez/token yok) dogrular.
//   node scripts/verify-public-download.mjs [sayfaUrl] [beklenenSha256]
// - Sayfadaki tum PerdePRO-Setup baglantilari listelenir (surum tutarliligi).
// - "Windows için İndir" dugmesine tiklanir; inen dosya EXE mi (MZ imzasi), boyut ve SHA-256 kontrol edilir.
// - GitHub giris/2FA sayfasina yonlenme olursa BASARISIZ sayilir.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAGE = process.argv[2] || 'https://www.ozidijital.com/urunler/perdepro';
const EXPECT = (process.argv[3] || 'faaa415a17cdd071bdd8569cd24171ba406a7d28bf29b95355e8a14f76623551').toLowerCase();
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, storageState: undefined });
const page = await ctx.newPage();
const visited = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) visited.push(f.url()); });
await page.goto(PAGE, { waitUntil: 'networkidle' });

const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.href })).filter((a) => /PerdePRO-Setup|releases\/download/i.test(a.href)));
console.log('Sayfadaki indirme baglantilari:'); links.forEach((l) => console.log('  ' + l.text.slice(0, 30) + ' -> ' + l.href));
rec('indirme baglantisi var', links.length > 0);
rec('hepsi PerdePRO-Setup-<surum>.exe release baglantisi', links.length > 0 && links.every((l) => /v\d+\.\d+\.\d+-windows\/PerdePRO-Setup-\d+\.\d+\.\d+\.exe$/.test(l.href)));
rec('eski surum (1.0.15/1.0.16) baglantisi yok', !links.some((l) => /1\.0\.1[56]/.test(l.href)));

const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 120000 }),
  page.locator('a[href*="releases/download"]', { hasText: 'Windows için İndir' }).first().click(),
]);
const file = path.join(os.tmpdir(), 'perdepro-anon-' + Date.now() + '.exe');
await dl.saveAs(file);
const buf = fs.readFileSync(file);
const sha = createHash('sha256').update(buf).digest('hex');
rec('dosya adi PerdePRO-Setup-<surum>.exe', /^PerdePRO-Setup-\d+\.\d+\.\d+\.exe$/.test(dl.suggestedFilename()), dl.suggestedFilename());
rec('gercek EXE (MZ imzasi), HTML/giris sayfasi degil', buf[0] === 0x4d && buf[1] === 0x5a, `${buf.length} bayt`);
rec('boyut makul (>50 MB)', buf.length > 50 * 1024 * 1024);
rec('SHA-256 beklenenle ayni', sha === EXPECT, sha);
rec('GitHub giris/2FA sayfasina yonlenmedi', !visited.some((u) => /github\.com\/(login|sessions|two-factor)/.test(u)), visited.slice(-2).join(' > '));
fs.rmSync(file, { force: true });
await browser.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
