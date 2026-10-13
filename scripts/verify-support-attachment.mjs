// Destek eki baglama (attach_support_ticket_screenshot) sunucu dogrulamasi — canli, QA hesaplariyla, yalnizca REST/Storage.
//
//   node scripts/verify-support-attachment.mjs [--user B]
//
// B (veya --user ile secilen) firmasi aktif de olabilir, suresi bitmis de: ek baglama her ikisinde calismali.
// Diger QA hesabi (A) "baska firma" saldirgani olarak kullanilir. Genel UPDATE yetkisi ACIK OLMAMALIDIR.
// Temizlik: ek nesnesi silinir; talep satiri kullanici tarafindan silinemez -> "TICKET_ID=" ciktisi SQL ile temizlenir.
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OWNER = String(arg('--user', 'B')).toUpperCase();
const ATTACKER = OWNER === 'A' ? 'B' : 'A';
const ctx = loadQaAccounts();
const { token: tok } = await passwordLogin(ctx, ctx.accounts[OWNER]);
const { token: atok } = await passwordLogin(ctx, ctx.accounts[ATTACKER]);

let fail = 0;
const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const H = (t) => ({ apikey: ctx.anon, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const rest = (t, p, init = {}) => fetch(`${ctx.url}/rest/v1/${p}`, { ...init, headers: { ...H(t), Prefer: 'return=representation', ...(init.headers || {}) } });
const attach = async (t, ticketId, path) => {
  const r = await fetch(`${ctx.url}/rest/v1/rpc/attach_support_ticket_screenshot`, { method: 'POST', headers: H(t), body: JSON.stringify({ p_ticket_id: ticketId, p_path: path }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sHdr = (t) => ({ apikey: ctx.anon, Authorization: `Bearer ${t}` });

const me = await (await rest(tok, 'company_members?select=company_id,role&is_active=eq.true')).json();
const companyId = me?.[0]?.company_id;
const uid = (await (await fetch(`${ctx.url}/auth/v1/user`, { headers: H(tok) })).json()).id;
const snap = await (await fetch(`${ctx.url}/rest/v1/rpc/company_subscription_access_allowed`, { method: 'POST', headers: H(tok), body: JSON.stringify({ p_company_id: companyId }) })).json();
console.log(`Sahip: ${OWNER} | firma aboneligi aktif mi: ${snap} | saldirgan: ${ATTACKER}`);

// 1) Talep olustur (kullanici INSERT'u izinlidir)
const title = `QA Ek Testi ${Date.now().toString(36)}`;
const ins = await rest(tok, 'support_tickets', { method: 'POST', body: JSON.stringify({ company_id: companyId, user_id: uid, title, description: 'QA otomatik: ek baglama', category: 'other', priority: 'low', status: 'open' }) });
const ticket = (await ins.json().catch(() => []))?.[0];
check('destek talebi olusturulur', ins.status === 201 && !!ticket?.id, `HTTP ${ins.status}`);
if (!ticket?.id) { console.log('\nTalep olusmadi; durduruldu.'); process.exit(1); }
console.log(`TICKET_ID=${ticket.id}`);
const path = `${companyId}/${ticket.id}/screenshot.png`;

// 2) Dosyayi yukle (support-attachments, istisna: sure bitmis firma da yukleyebilir)
const up = await fetch(`${ctx.url}/storage/v1/object/support-attachments/${path}`, { method: 'POST', headers: { ...sHdr(tok), 'Content-Type': 'image/png' }, body: PNG });
check('ek dosyasi yuklenir', up.status === 200, `HTTP ${up.status}`);

// 3) Genel UPDATE hala KAPALI
const gen = await rest(tok, `support_tickets?id=eq.${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ screenshot_url: path }) });
const genRows = await gen.json().catch(() => []);
const afterGen = (await (await rest(tok, `support_tickets?select=screenshot_url&id=eq.${ticket.id}`)).json())[0];
check('genel UPDATE yetkisi YOK (dogrudan PATCH satiri degistirmez)', !afterGen?.screenshot_url && (!Array.isArray(genRows) || genRows.length === 0), `HTTP ${gen.status} rows=${Array.isArray(genRows) ? genRows.length : '?'}`);

// 4) Saldirgan / hatali istekler engellenir
const atkPatch = await rest(atok, `support_tickets?id=eq.${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ screenshot_url: path, title: 'ELE GECIRILDI' }) });
const atkRows = await atkPatch.json().catch(() => []);
const afterAtk = (await (await rest(tok, `support_tickets?select=title,screenshot_url&id=eq.${ticket.id}`)).json())[0];
check('baska firma dogrudan PATCH ile talebi DEGISTIREMEZ', afterAtk?.title === title && !afterAtk?.screenshot_url && (!Array.isArray(atkRows) || atkRows.length === 0), `HTTP ${atkPatch.status}`);
const a1 = await attach(atok, ticket.id, path);
check('baska firma kullanicisi talebe ek BAGLAYAMAZ', a1.status === 403 || a1.status === 401 || a1.status >= 400, `HTTP ${a1.status} ${a1.body?.code || ''}`);
const a2 = await attach(tok, '00000000-0000-4000-8000-000000000000', path);
check('var olmayan talep ile baska firmanin talebi AYNI hatayi verir (varlik sizmaz)', a2.status === a1.status && (a2.body?.code || '') === (a1.body?.code || ''), `HTTP ${a2.status}/${a1.status}`);
const otherCompanyPath = `${ctx.accounts[ATTACKER] ? '11111111-1111-4111-8111-111111111111' : 'x'}/${ticket.id}/screenshot.png`;
const a3 = await attach(tok, ticket.id, otherCompanyPath);
check('baska firma klasorune yol gosteren istek REDDEDILIR', a3.status >= 400, `HTTP ${a3.status} ${a3.body?.code || ''}`);
const a4 = await attach(tok, ticket.id, `${companyId}/00000000-0000-4000-8000-000000000000/screenshot.png`);
check('baska talebin yolunu gosteren istek REDDEDILIR', a4.status >= 400, `HTTP ${a4.status} ${a4.body?.code || ''}`);
const a5 = await attach(tok, ticket.id, `${companyId}/${ticket.id}/../screenshot.png`);
check('yol gezinme (../) REDDEDILIR', a5.status >= 400, `HTTP ${a5.status}`);
const a6 = await attach(tok, ticket.id, `${companyId}/${ticket.id}/screenshot.exe`);
check('izinsiz uzanti REDDEDILIR', a6.status >= 400, `HTTP ${a6.status}`);
const anon = await fetch(`${ctx.url}/rest/v1/rpc/attach_support_ticket_screenshot`, { method: 'POST', headers: { apikey: ctx.anon, Authorization: `Bearer ${ctx.anon}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_ticket_id: ticket.id, p_path: path }) });
check('anon cagiramaz', anon.status >= 400, `HTTP ${anon.status}`);
const still = (await (await rest(tok, `support_tickets?select=screenshot_url&id=eq.${ticket.id}`)).json())[0];
check('reddedilen denemelerden sonra talep DEGISMEDI', !still?.screenshot_url);

// 5) Olumlu: sahip ek baglar
const ok = await attach(tok, ticket.id, path);
check('sahip ekini talebe baglar', ok.status === 200 && ok.body?.ok === true, `HTTP ${ok.status}`);
const linked = (await (await rest(tok, `support_tickets?select=screenshot_url&id=eq.${ticket.id}`)).json())[0];
check('screenshot_url talepte dolu ve dogru yol', linked?.screenshot_url === path);

// 6) Ek acilabilir (imzali adres + indirme); baska firma acamaz
const sg = await fetch(`${ctx.url}/storage/v1/object/sign/support-attachments/${path}`, { method: 'POST', headers: H(tok), body: JSON.stringify({ expiresIn: 60 }) });
const sj = await sg.json().catch(() => ({}));
check('ek icin imzali adres alinir', sg.status === 200 && !!sj.signedURL, `HTTP ${sg.status}`);
if (sj.signedURL) check('ek indirilir', (await fetch(`${ctx.url}/storage/v1${sj.signedURL}`)).status === 200);
const sgA = await fetch(`${ctx.url}/storage/v1/object/sign/support-attachments/${path}`, { method: 'POST', headers: H(atok), body: JSON.stringify({ expiresIn: 60 }) });
check('baska firma ek icin imzali adres ALAMAZ', sgA.status >= 400, `HTTP ${sgA.status}`);

// 7) Temizlik: ek nesnesi (talep SQL ile)
const rm = await fetch(`${ctx.url}/storage/v1/object/support-attachments/${path}`, { method: 'DELETE', headers: sHdr(tok) });
check('ek nesnesi temizlendi', rm.status === 200, `HTTP ${rm.status}`);

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nGECTI');
process.exit(fail ? 1 : 0);
