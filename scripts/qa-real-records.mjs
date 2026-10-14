// QA firmasinda (E2E_A) GERCEK kayitlarla: montaj maliyeti, kismi/fazla odeme, avans, vade, salt okunur.
// Yalniz bu betigin olusturdugu kayitlari siler. Kisisel firma/musteri verisine dokunmaz.
//   node scripts/qa-real-records.mjs [temelUrl]
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const TR = (n) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n).split(String.fromCharCode(160)).join(' ');
const near = (a, b) => Math.abs(a - b) < 0.011;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept().catch(() => {}));
const nav = async (p) => { const same = page.url().endsWith('#' + p); await page.goto(`${BASE}/#${p}`); if (same) await page.reload(); await page.waitForTimeout(1200); await page.getByText(/Yükleniyor/).first().waitFor({ state: 'detached', timeout: 40000 }).catch(() => {}); await page.waitForTimeout(800); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const created = { orders: [], customers: [], appts: [], installers: [], suppliers: [] };

async function newOrder(label) {
  const name = `QA-REAL ${label} ${Date.now()}`;
  await nav('/measurements/new');
  await page.getByPlaceholder('Müşteri adı soyadı').fill(name);
  await page.getByLabel('Ürün Tipi').selectOption('tul');
  await page.getByLabel('En (cm)').fill('200');
  await page.getByLabel('Boy (cm)').fill('250');
  await page.getByLabel('Adet').fill('1');
  await page.getByLabel('Satış Fiyatı (₺/m)').fill('420');
  await page.getByLabel('Pile Tipi').selectOption('3');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL(/#\/quotes/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.locator('input[type="date"]').first().fill(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: /Siparişe Çevir/i }).first().click();
  await page.waitForTimeout(3000);
  const ids = await ev(async (n) => {
    const sb = window.supabase;
    const { data: c } = await sb.from('customers').select('id,company_id').eq('name', n).order('created_at', { ascending: false }).limit(1);
    const cid = c?.[0]?.id; if (!cid) return null;
    const { data: a } = await sb.from('appointments').select('id').eq('customer_id', cid);
    const { data: o } = await sb.from('orders').select('id,total_amount').eq('customer_id', cid).order('created_at', { ascending: false }).limit(1);
    return { customerId: cid, companyId: c[0].company_id, apptIds: (a || []).map((x) => x.id), orderId: o?.[0]?.id, total: Number(o?.[0]?.total_amount) };
  }, name);
  if (!ids?.orderId) throw new Error('siparis olusmadi');
  created.customers.push(ids.customerId); created.orders.push(ids.orderId); created.appts.push(...ids.apptIds);
  return { ...ids, name };
}

const waitBody = async (str) => { try { await page.waitForFunction((x) => document.body.innerText.split(String.fromCharCode(160)).join(' ').includes(x), str, { timeout: 15000 }); } catch { /* */ } };
const profitBox = async () => {
  const t = (await page.locator('body').innerText()).split(String.fromCharCode(160)).join(' ');
  const grab = (label) => { const m = t.match(new RegExp(label + '[^\\n]*\\n?\\s*([\\-₺\\d.,\\s]+)')); return m ? m[1].trim() : null; };
  return { t, net: grab('Net Kâr'), cost: grab('Toplam Maliyet') };
};

try {
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });

  // ---- SENARYO 1: dis montajci ----
  const o1 = await newOrder('dis');
  const sale = o1.total;
  console.log('siparis toplam:', sale);
  await nav(`/orders/${o1.orderId}`);
  let pb = await profitBox();
  rec('montajcisiz: Net Kar = satis (maliyet 0)', pb.t.includes(TR(sale)) && /net kâr/i.test(pb.t));

  const iname = `QA-REAL Montajci ${Date.now()}`;
  await page.getByRole('button', { name: /Yeni Montajcı Ekle/ }).click();
  await page.getByPlaceholder('Montajcı adı soyadı').fill(iname);
  await page.getByRole('button', { name: 'Ekle', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Montajcıyı (Ata|Değiştir)/ }).click();
  await page.waitForTimeout(1500);
  const inst = await ev(async (n) => { const { data } = await window.supabase.from('employees').select('id').eq('full_name', n).limit(1); return data?.[0]?.id; }, iname);
  created.installers.push(inst);
  await page.getByRole('button', { name: 'Montaja Hazır', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Montaj Tamamlandı/ }).click();
  await page.getByRole('button', { name: /Evet, Tamamla/ }).click();
  await page.waitForTimeout(3500);

  const job = await ev(async (oid) => { const { data } = await window.supabase.from('installation_jobs').select('id,status,company_id').eq('order_id', oid).limit(1); return data?.[0]; }, o1.orderId);
  rec('is tamamlandi', job?.status === 'completed');
  // hakedis 350
  const fee = await ev(async ({ cid, jid }) => { const { data, error } = await window.supabase.rpc('update_installer_job_fee', { p_company_id: cid, p_job_id: jid, p_price_type: 'manuel', p_unit_rate: 0, p_installer_fee: 350 }); return { data, error: error?.message }; }, { cid: o1.companyId, jid: job.id });
  rec('hakedis 350 kaydedildi', !fee.error && Number(fee.data?.total_earning) === 350, fee.error || '');
  await nav(`/orders/${o1.orderId}`);
  await waitBody(TR(sale - 350));
  await waitBody(TR(sale - 350));
  pb = await profitBox();
  rec(`dis montajci 350: Net Kar = ${TR(sale - 350)}`, pb.t.includes(TR(sale - 350)), '');
  rec('Montaj maliyeti satiri 350', pb.t.includes('₺350,00'));

  // montajciya kismi odeme 100: kar DEGISMEMELI
  const pay = await ev(async ({ cid, iid }) => { const { data, error } = await window.supabase.rpc('installer_record_payment', { p_company_id: cid, p_installer_id: iid, p_amount: 100, p_payment_method: 'cash', p_period_start: null, p_period_end: null, p_note: 'QA kismi', p_idempotency_key: crypto.randomUUID() }); return { error: error?.message, data }; }, { cid: o1.companyId, iid: inst });
  rec('montajciya 100 odeme kaydedildi', !pay.error, pay.error || '');
  await nav(`/orders/${o1.orderId}`);
  await waitBody(TR(sale - 350));
  pb = await profitBox();
  rec('odeme sonrasi Net Kar AYNI (maliyet ikinci kez artmadi)', pb.t.includes(TR(sale - 350)));

  // hakedis duzenle 500 -> kar sale-500, cift sayim yok
  const fee5 = await ev(async ({ cid, jid }) => { const { data, error } = await window.supabase.rpc('update_installer_job_fee', { p_company_id: cid, p_job_id: jid, p_price_type: 'manuel', p_unit_rate: 0, p_installer_fee: 500 }); return { data, error: error?.message }; }, { cid: o1.companyId, jid: job.id });
  console.log('fee500:', JSON.stringify(fee5));
  await nav(`/orders/${o1.orderId}`);
  await waitBody(TR(sale - 500));
  pb = await profitBox();
  console.log('M500:', pb.t.split(String.fromCharCode(10)).filter((l) => /Montaj maliyeti|Toplam maliyet|Net K/i.test(l)).join(' | '));
  rec(`hakedis 500'e duzenlenince Net Kar = ${TR(sale - 500)}`, pb.t.includes(TR(sale - 500)) && !pb.t.includes(TR(sale - 850)));
  await ev(async ({ cid, jid }) => window.supabase.rpc('update_installer_job_fee', { p_company_id: cid, p_job_id: jid, p_price_type: 'manuel', p_unit_rate: 0, p_installer_fee: 350 }), { cid: o1.companyId, jid: job.id });

  // tedarikci borcu 800 (vade ileri), odeme 300, QA'ya ozel tedarikci
  const sup = await ev(async (cid) => {
    const sb = window.supabase;
    const { data: s, error } = await sb.from('suppliers').insert([{ company_id: cid, name: `QA-REAL Tedarikci ${Date.now()}` }]).select('id').single();
    if (error) return { error: error.message };
    const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const e1 = await sb.from('supplier_transactions').insert([{ company_id: cid, supplier_id: s.id, transaction_type: 'debt', amount: 800, description: 'QA kumas', transaction_date: new Date().toISOString(), due_date: due }]);
    const e2 = await sb.from('supplier_transactions').insert([{ company_id: cid, supplier_id: s.id, transaction_type: 'payment', amount: 300, description: 'QA odeme', transaction_date: new Date().toISOString(), payment_method: 'cash' }]);
    return { id: s.id, e1: e1.error?.message, e2: e2.error?.message };
  }, o1.companyId);
  created.suppliers.push(sup.id);
  rec('QA tedarikci borc 800 / odeme 300 yazildi', sup.id && !sup.e1 && !sup.e2, JSON.stringify(sup));

  // musteri kismi tahsilat 1000 (UI)
  await nav(`/orders/${o1.orderId}`);
  await page.getByRole('button', { name: /Ödeme Ekle/ }).first().click({ timeout: 25000 });
  await page.getByPlaceholder('0,00').first().fill('1000');
  await page.getByPlaceholder('İsteğe bağlı').first().fill('QA kismi tahsilat');
  await page.getByRole('button', { name: 'Kaydet', exact: true }).last().click();
  await page.waitForTimeout(3000);

  // Collections toplamlari = cari bakiyeler
  await nav('/collections');
  await page.getByText('Müşterilerden alınacak toplam').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const db = await ev(async ({ oid, iid, sid }) => {
    const sb = window.supabase;
    const { data: o } = await sb.from('orders').select('total_amount,paid_amount,remaining_amount').eq('id', oid).single();
    const { data: er } = await sb.from('installer_earnings').select('total_earning').eq('installer_id', iid);
    const { data: tx } = await sb.from('installer_transactions').select('transaction_type,amount').eq('installer_id', iid);
    const earned = (er || []).reduce((a, r) => a + Number(r.total_earning), 0);
    const paid = (tx || []).filter((t) => t.transaction_type !== 'earning').reduce((a, t) => a + (t.transaction_type === 'payment' ? Number(t.amount) : -Number(t.amount)), 0);
    const { data: st } = await sb.from('supplier_transactions').select('transaction_type,amount').eq('supplier_id', sid);
    const sd = (st || []).filter((t) => t.transaction_type === 'debt').reduce((a, t) => a + Number(t.amount), 0);
    const sp = (st || []).filter((t) => ['payment', 'cancel', 'credit'].includes(t.transaction_type)).reduce((a, t) => a + Number(t.amount), 0);
    return { custRemaining: Number(o.remaining_amount ?? o.total_amount - o.paid_amount), instRemaining: Math.max(earned - paid, 0), supRemaining: Math.max(sd - sp, 0), earned, paid };
  }, { oid: o1.orderId, iid: inst, sid: sup.id });
  console.log('DB bakiyeleri:', JSON.stringify(db));
  const txt = (await page.locator('body').innerText()).split(String.fromCharCode(160)).join(' ');
  rec('musteri kalan (kismi tahsilat sonrasi) kartta/listede', txt.includes(TR(db.custRemaining)), TR(db.custRemaining));
  rec('tedarikci kalan 500 (800-300)', db.supRemaining === 500 && txt.includes(TR(500)));
  rec('montajci kalan 250 (350-100)', near(db.instRemaining, 250) && txt.includes(TR(250)));

  // ---- avans / fazla odeme: montajciya 400 daha (kalan 250 -> avans 150) ----
  const pay2 = await ev(async ({ cid, iid }) => { const { error } = await window.supabase.rpc('installer_record_payment', { p_company_id: cid, p_installer_id: iid, p_amount: 400, p_payment_method: 'cash', p_period_start: null, p_period_end: null, p_note: 'QA fazla', p_idempotency_key: crypto.randomUUID() }); return error?.message; }, { cid: o1.companyId, iid: inst });
  rec('fazla odeme (avans) kaydedildi', !pay2, pay2 || '');
  await nav('/collections');
  await page.getByText('Müşterilerden alınacak toplam').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Montajcı Borçları' }).click();
  await page.waitForTimeout(500);
  const t4 = await page.locator('body').innerText();
  console.log('MONTAJCI LISTE:', t4.split(String.fromCharCode(10)).filter((l) => /Montajc|kayıt|₺/.test(l)).slice(0, 25).join(' | '));
  rec('avans borc olarak GOSTERILMEZ (bu montajci listede yok)', !t4.includes(iname));

  // montaj maliyeti ikinci kez artmadi (odemeler sonrasi hala 350)
  await nav(`/orders/${o1.orderId}`);
  pb = await profitBox();
  rec('iki odeme sonrasi bile Net Kar degismedi', pb.t.includes(TR(sale - 350)));

  // ---- vade ekleme (musteri vadesiz kayit) ----
  await nav('/collections');
  await page.getByText('Müşterilerden alınacak toplam').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Müşteri Alacakları' }).click();
  const addDue = page.getByText('Vade tarihi ekle').first();
  if (await addDue.isVisible().catch(() => false)) {
    await addDue.click();
    const d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(d);
    await page.getByRole('button', { name: 'Kaydet', exact: true }).first().click();
    await page.waitForTimeout(2000);
    const after = await ev(async (oid) => { const { data } = await window.supabase.from('orders').select('payment_due_date,total_amount,paid_amount').eq('id', oid).single(); return data; }, o1.orderId);
    rec('vade kaydedildi, tutarlar degismedi', String(after.payment_due_date).startsWith(d) && Number(after.total_amount) === sale && Number(after.paid_amount) === 1000, JSON.stringify(after));
  } else {
    rec('vade ekleme (vadesiz musteri kaydi gorunmedi)', false);
  }

  // ---- SENARYO 2: Kendim yapiyorum ----
  const o2 = await newOrder('kendim');
  await nav(`/orders/${o2.orderId}`);
  await page.locator('select').filter({ has: page.locator('option[value="__self__"]') }).selectOption('__self__');
  await page.getByRole('button', { name: /Montajcıyı (Ata|Değiştir)/ }).click();
  await page.waitForTimeout(2000);
  const mode = await ev(async (oid) => { const { data } = await window.supabase.from('orders').select('installation_mode,assigned_staff_id').eq('id', oid).single(); return data; }, o2.orderId);
  rec('"Kendim yapıyorum" montaj isi olusmadan KALICI (installation_mode=self)', mode?.installation_mode === 'self' && !mode.assigned_staff_id, JSON.stringify(mode));
  await nav(`/orders/${o2.orderId}`);
  pb = await profitBox();
  await waitBody(TR(o2.total));
  pb = await profitBox();
  rec('Kendim yapiyorum: Net Kar = satis (montaj 0)', pb.t.includes(TR(o2.total)) && /kendim yapıyorum/i.test(pb.t));
  await page.getByRole('button', { name: 'Montaja Hazır', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Montaj Tamamlandı/ }).click();
  await page.getByRole('button', { name: /Evet, Tamamla/ }).click();
  await page.waitForTimeout(3500);
  const j2 = await ev(async (oid) => { const { data: j } = await window.supabase.from('installation_jobs').select('status,is_internal_installation').eq('order_id', oid).limit(1); const { data: e } = await window.supabase.from('installer_earnings').select('id').eq('order_id', oid); return { j: j?.[0], earn: (e || []).length }; }, o2.orderId);
  rec('kendim yapiyorum: is tamamlandi, hakedis/borc YOK', j2.j?.status === 'completed' && j2.j?.is_internal_installation === true && j2.earn === 0, JSON.stringify(j2));
  // secilmemis siparis (o1 benzeri yeni) "kendim" sayilmaz
  const o3 = await newOrder('secimsiz');
  await nav(`/orders/${o3.orderId}`);
  const m3 = await ev(async (oid) => { const { data } = await window.supabase.from('orders').select('installation_mode').eq('id', oid).single(); return data?.installation_mode; }, o3.orderId);
  rec('secilmemis siparis installation_mode=NULL (Kendim yapiyorum degil)', m3 === null);
  const dsh = null; void dsh;

  // ---- SALT OKUNUR: istemci tarafi (companies.read_only=true yanit yamasi) ----
  const ro = await ctx.newPage();
  // Sunucu "lisans suresi dolmus" donerse (company_subscription_access_allowed=false) istemci salt okunur olur
  await ro.route('**/rpc/company_subscription_access_allowed*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'false' }));
  await ro.goto(`${BASE}/#/collections`);
  await ro.getByText('Müşterilerden alınacak toplam').waitFor({ timeout: 40000 });
  await ro.waitForTimeout(1200);
  const roTxt = await ro.locator('body').innerText();
  const roAdd = (await ro.getByRole('button', { name: 'Tahsilat Ekle' }).count()) + (await ro.getByRole('button', { name: 'Ödeme Ekle' }).count());
  rec('salt okunur: liste ve toplamlar gorunur', /Net alacak/i.test(roTxt));
  console.log('RO sayilar:', roAdd, await ro.getByText('Vade tarihi ekle').count());
  rec('salt okunur: Tahsilat Ekle / Ödeme Ekle / vade ekleme YOK', roAdd === 0 && (await ro.getByText('Vade tarihi ekle').count()) === 0);
  await ro.close();
} catch (e) {
  fail++;
  console.log('HATA:', e.message);
} finally {
  // yalniz bu betigin olusturdugu kayitlari temizle
  await ev(async (c) => {
    const sb = window.supabase;
    try {
      for (const oid of c.orders) {
        await sb.from('installer_earnings').delete().eq('order_id', oid);
        await sb.from('installation_jobs').delete().eq('order_id', oid);
        await sb.from('payments').delete().eq('order_id', oid);
        await sb.from('income').delete().eq('order_id', oid);
        await sb.from('order_items').delete().eq('order_id', oid);
        await sb.from('orders').delete().eq('id', oid);
      }
      // income satirlari silinemez: siparisler silinemediyse IPTAL et (listelere girmez)
      for (const oid of c.orders) await sb.from('orders').update({ status: 'cancelled' }).eq('id', oid);
      for (const a of c.appts) await sb.from('appointments').delete().eq('id', a);
      for (const id of c.customers) await sb.from('customers').delete().eq('id', id);
      for (const id of c.installers) { await sb.from('installer_transactions').delete().eq('installer_id', id); await sb.from('installer_earnings').delete().eq('installer_id', id); await sb.from('employees').delete().eq('id', id); }
      for (const id of c.suppliers) { await sb.from('supplier_transactions').delete().eq('supplier_id', id); await sb.from('suppliers').delete().eq('id', id); }
    } catch { /* */ }
  }, created).catch(() => {});
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
