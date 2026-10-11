// !!! URETIM Supabase projesinde GECICI test kullanicisi/firmasi olusturur, dogrular ve SILER (yalnizca "zzqa<tag>" ekli kayitlar).
// Gercek musteri verisine dokunmaz. Calistirmadan once: web uygulamasi calisiyor olmali (QA_APP, varsayilan http://localhost:5173)
// ve `npx supabase login` yapilmis olmali (service_role anahtari CLI'dan bellege alinir, yazdirilmaz).
// Olusturur: 3 test kullanicisi (zzqa<tag>-a/-b/-new@example.test), 2 test firmasi ("ZZ QA <tag> A/B") + kurulum ekraniyla 1 firma ("ZZ QA <tag> NEW"),
//            bu firmalarda 1 test musterisi. Hicbir gercek firma/kullanici okunmaz veya degistirilmez.
// Siler:     yalnizca adi "ZZ QA <tag>" ile baslayan VE uyeleri sadece bu calistirmada olusturulan kullanicilar olan firmalar,
//            o firmalara bagli company_id satirlari, '<tag>-...@example.test' trial_grants kayitlari ve 3 test kullanicisi.
// Kullanim (Windows PowerShell):
//   npm run build
//   Start-Process powershell -ArgumentList '-NoExit','-Command','npx vite preview --port 4173 --strictPort'
//   $env:QA_APP = 'http://localhost:4173'; node scripts/qa-prod-isolated-smoke.mjs
// Ayrilmis test firmalari ile gercek UI -> Supabase dogrulamasi. Sifreler bellekte uretilir, yazdirilmaz.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { chromium } from "playwright";

const REF = "ffhmzlcsgsgjonqqhgqq";
const BASE = "https://" + REF + ".supabase.co";
const APP = process.env.QA_APP || "http://localhost:5173";
const SA = "87197199-7661-4a96-af0f-89a72b87b29d"; // gercek super admin hesabi (sunucu tarafi RPC yetkisi)
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
const keys = JSON.parse((s => s.slice(s.indexOf("[")))(run("npx", ["supabase", "projects", "api-keys", "--project-ref", REF, "-o", "json"])));
const SERVICE = keys.find(k => k.id === "service_role").api_key;
const ANON = keys.find(k => k.id === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const results = [];
const rec = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); };

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
async function sql(q) {
  const f = path.join(os.tmpdir(), "qa_" + crypto.randomBytes(4).toString("hex") + ".sql");
  fs.writeFileSync(f, q);
  try {
    const out = run("npx", ["supabase", "db", "query", "--linked", "-o", "json", "-f", f]);
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return j.rows;
  } finally { fs.rmSync(f, { force: true }); }
}
const tag = "zzqa" + Date.now().toString(36);
const pw = () => "Qa!" + crypto.randomBytes(9).toString("base64url");
const users = {};
async function mkUser(key) {
  const email = `${tag}-${key}@example.test`;
  const password = pw();
  const r = await fetch(`${BASE}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "ZZ QA " + key } }) });
  const j = await r.json();
  if (!r.ok) throw new Error("create user failed " + r.status);
  users[key] = { id: j.id, email, password };
}
const created = { users: [], companies: [] };
let browser;
try {
  for (const k of ["a", "b", "new"]) { await mkUser(k); created.users.push(users[k].id); }
  // Firma A ve B: super-admin yetkisiyle (gercek RPC), tam modul seti
  const setup = `
    do $$ declare ca uuid; cb uuid; r jsonb; begin
      perform set_config('request.jwt.claim.sub','${SA}',true);
      insert into public.companies(name,owner_id,created_by,subscription_plan,package_code,enabled_modules,max_users,plan_status,subscription_status,trial_start,trial_end,trial_ends_at,trial_started_at,is_active,read_only,enabled_roles)
        values ('ZZ QA ${tag} A','${users.a.id}','${SA}','trial','enterprise',array['admin','orders','customers','appointments','measurements','suppliers','installation','collections','accounting','invoices','staff','reports','catalogs','products','branches'],5,'trial','trial',now(),now()+interval '7 days',now()+interval '7 days',now(),true,false,array['admin','accountant','installer','measurement']) returning id into ca;
      insert into public.companies(name,owner_id,created_by,subscription_plan,package_code,enabled_modules,max_users,plan_status,subscription_status,trial_start,trial_end,trial_ends_at,trial_started_at,is_active,read_only,enabled_roles)
        values ('ZZ QA ${tag} B','${users.b.id}','${SA}','trial','enterprise',array['admin','orders','customers'],5,'trial','trial',now(),now()+interval '7 days',now()+interval '7 days',now(),true,false,array['admin']) returning id into cb;
      r := public.super_admin_assign_user_to_company('${users.a.email}', ca, 'admin');
      r := public.super_admin_assign_user_to_company('${users.b.email}', cb, 'admin');
    end $$;`;
  await sql(setup);
  const comp = await sql(`select id,name from public.companies where name like 'ZZ QA ${tag}%' order by name`);
  const cA = comp.find(c => c.name.endsWith(" A")).id, cB = comp.find(c => c.name.endsWith(" B")).id;
  created.companies.push(cA, cB);
  rec("test firmalari ve yonetici uyelikleri olusturuldu", comp.length === 2);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + String(e).slice(0, 120)));
  page.on("response", r => { if (r.status() >= 400 && r.url().includes(REF) && !/\/auth\/v1\/(token|user)/.test(r.url())) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

  async function login(u) {
    await page.goto(APP + "/#/login");
    await page.locator('input[type="email"]').first().fill(u.email);
    await page.locator('input[type="password"]').first().fill(u.password);
    await page.getByRole("button", { name: /^Giriş Yap$/ }).click();
  }
  await login(users.a);
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 30000 });
  rec("web: e-posta/sifre ile giris, firma yuklendi", true, page.url().split("#")[1]);
  const meA = await page.evaluate(async () => { const s = JSON.parse(localStorage.getItem("perdepro-auth") || "null"); return s?.user?.email || null; });
  rec("oturum tarayicida saklandi", meA === users.a.email);
  await page.reload(); await page.waitForTimeout(2500);
  rec("sayfa yenilenince oturum korundu", !/#\/login/.test(page.url()), page.url().split("#")[1]);
  const newPage = await ctx.newPage(); await newPage.goto(APP + "/"); await newPage.waitForTimeout(3000);
  rec("yeni sekme/uygulama yeniden aciliste oturum korundu", !/#\/login/.test(newPage.url()), newPage.url().split("#")[1]);
  await newPage.close();

  // Veri ekleme (kullanici JWT'si ile, RLS yolu) ve izolasyon
  const tokenOf = async (u) => { const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) }); return (await r.json()).access_token; };
  const tA = await tokenOf(users.a), tB = await tokenOf(users.b);
  const api = (tok, path, init = {}) => fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  const insA = await api(tA, "customers", { method: "POST", body: JSON.stringify({ company_id: cA, name: "QA Musteri A", phone: "5550000001" }) });
  const insAj = await insA.json();
  rec("musteri olusturma (kullanici yetkisiyle)", insA.ok, `HTTP ${insA.status}`);
  const readB = await (await api(tB, `customers?company_id=eq.${cA}&select=id`)).json();
  rec("firma izolasyonu: B, A'nin musterisini goremiyor", Array.isArray(readB) && readB.length === 0);
  const crossIns = await api(tB, "customers", { method: "POST", body: JSON.stringify({ company_id: cA, name: "Sizinti" }) });
  rec("firma izolasyonu: B, A firmasina kayit ekleyemiyor", !crossIns.ok, `HTTP ${crossIns.status}`);
  const coB = await (await api(tB, `companies?id=eq.${cA}&select=id`)).json();
  rec("firma izolasyonu: B, A firma kaydini goremiyor", Array.isArray(coB) && coB.length === 0);

  // Moduller: sayfalar yuklenir mi (hata/konsol)
  const routes = ["customers", "orders", "quotes", "accounting", "collections", "income", "expenses", "reports", "suppliers", "installations", "staff", "invoices", "catalogs", "products", "settings", "appointments/new", "orders/new", "measurements/new"];
  const bad = [];
  for (const r of routes) {
    errors.length = 0;
    await page.goto(`${APP}/#/${r}`);
    await page.waitForTimeout(1800);
    const text = await page.locator("body").innerText().catch(() => "");
    const onLogin = /#\/login/.test(page.url());
    const boundary = /Bir şeyler ters gitti|Uygulama hatası|Beklenmeyen bir hata/i.test(text);
    const empty = text.trim().length < 30;
    if (onLogin || boundary || empty || errors.some(e => e.startsWith("pageerror"))) bad.push(`${r}${onLogin ? "(login)" : ""}${boundary ? "(hata ekrani)" : ""}${empty ? "(bos)" : ""}${errors.length ? " [" + errors.slice(0, 2).join("; ") + "]" : ""}`);
  }
  rec("modul sayfalari acilis kontrolu (18 rota)", bad.length === 0, bad.join(" | "));
  await page.goto(`${APP}/#/customers`); await page.waitForTimeout(2000);
  const seen = await page.locator("body").innerText();
  rec("UI: olusturulan musteri listede gorunuyor", /QA Musteri A/.test(seen));

  // Cikis ve tekrar giris
  await page.evaluate(async () => { await (window).supabase.auth.signOut(); });
  await page.goto(APP + "/#/dashboard"); await page.waitForTimeout(2500);
  rec("cikis sonrasi korumali sayfa login'e yonlendirir", /#\/login/.test(page.url()));
  await login(users.a);
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 30000 });
  rec("cikis sonrasi tekrar giris", true);

  // Sure bitimi: sunucuda sureyi gecmise al (super admin RPC), dogrudan API denemeleri
  await sql(`do $$ begin perform set_config('request.jwt.claim.sub','${SA}',true); perform public.super_admin_set_trial_end('${cA}'::uuid, now()-interval '1 minute', 'QA test'); end $$;`).catch(async () => {
    await sql(`do $$ begin perform set_config('request.jwt.claim.sub','${SA}',true); update public.companies set trial_ends_at=now()-interval '1 minute', trial_end=now()-interval '1 minute' where id='${cA}'; end $$;`);
  });
  const tA2 = await tokenOf(users.a);
  const insExp = await api(tA2, "customers", { method: "POST", body: JSON.stringify({ company_id: cA, name: "Sure sonrasi" }) });
  rec("sure bitti: dogrudan API ile yeni kayit REDDEDILDI", !insExp.ok, `HTTP ${insExp.status}`);
  const updExp = await api(tA2, `customers?company_id=eq.${cA}`, { method: "PATCH", body: JSON.stringify({ name: "Degisti" }) });
  const updRows = updExp.ok ? await updExp.json() : [];
  rec("sure bitti: dogrudan API ile guncelleme etkisiz", !updExp.ok || (Array.isArray(updRows) && updRows.length === 0), `HTTP ${updExp.status}`);
  const delExp = await api(tA2, `customers?company_id=eq.${cA}`, { method: "DELETE" });
  const delRows = delExp.ok ? await delExp.json() : [];
  rec("sure bitti: dogrudan API ile silme etkisiz", !delExp.ok || (Array.isArray(delRows) && delRows.length === 0), `HTTP ${delExp.status}`);
  const readExp = await (await api(tA2, `customers?company_id=eq.${cA}&select=name`)).json();
  rec("sure bitti: mevcut veri okunabiliyor ve degismedi", Array.isArray(readExp) && readExp.length === 1 && readExp[0].name === "QA Musteri A");
  const selfGrant = await api(tA2, `companies?id=eq.${cA}`, { method: "PATCH", body: JSON.stringify({ is_pilot: true, trial_ends_at: new Date(Date.now() + 864e5 * 30).toISOString() }) });
  const sg = await sql(`select is_pilot, trial_ends_at < now() as expired from public.companies where id='${cA}'`);
  rec("normal kullanici ozel erisim/sure veremedi", sg[0].is_pilot === false && sg[0].expired === true, `HTTP ${selfGrant.status}`);
  await page.goto(`${APP}/#/customers`); await page.reload(); await page.waitForTimeout(3500);
  const bodyExp = await page.locator("body").innerText();
  rec("UI: sure bitince salt-okunur uyari serisi + veri gorunur", /SALT-OKUNUR|salt-okunur|read-only/i.test(bodyExp) && /QA Musteri A/.test(bodyExp));

  // Yeni kullanici: kurulum ekrani -> firma + yonetici + 7 gun
  const page2 = await (await browser.newContext()).newPage();
  await page2.goto(APP + "/#/login");
  await page2.locator('input[type="email"]').first().fill(users.new.email);
  await page2.locator('input[type="password"]').first().fill(users.new.password);
  await page2.getByRole("button", { name: /^Giriş Yap$/ }).click();
  await page2.waitForURL(/#\/setup/, { timeout: 30000 });
  rec("firmasiz hesap bos ekrana degil kurulum ekranina yonlendirildi", true);
  await page2.locator('input[autocomplete="organization"]').fill(`ZZ QA ${tag} NEW`);
  await page2.getByRole("button", { name: /İşletmemi oluştur/ }).click();
  await page2.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 30000 });
  const nc = await sql(`select c.id, c.plan_status, c.trial_ends_at - c.trial_started_at as dur, m.role, p.role prole from public.companies c join public.company_members m on m.company_id=c.id join public.profiles p on p.user_id=m.user_id where m.user_id='${users.new.id}'`);
  created.companies.push(nc[0].id);
  rec("yeni kullanici: firma + admin uyeligi birlikte olustu", nc.length === 1 && nc[0].role === "admin" && nc[0].prole === "admin");
  rec("yeni kullanici: deneme suresi sunucuda 7 gun", /^7 days/.test(String(nc[0].dur)), String(nc[0].dur));
  const again = await sql(`select count(*)::int n from public.companies where owner_id='${users.new.id}'`);
  rec("mukerrer firma olusmadi", again[0].n === 1);
} catch (e) {
  rec("BETIK HATASI", false, String(e).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
  // Temizlik SINIRI: yalnizca bu calistirmanin etiketi (zzqa<tag>) ile baslayan firmalar/kullanicilar.
  // Silinecek her firma icin: adi 'ZZ QA <tag>' ile baslamali VE uyeleri yalnizca bu calistirmada olusturulan kullanicilar olmali.
  try {
    if (!/^zzqa[a-z0-9]{6,}$/.test(tag)) throw new Error("etiket beklenen bicimde degil; temizlik iptal");
    const uids = created.users.map(u => `'${u}'`).join(",") || "'00000000-0000-0000-0000-000000000000'";
    const cleanup = `
      do $$
      declare ids uuid[]; r record; n int;
      begin
        select coalesce(array_agg(c.id),'{}') into ids from public.companies c
          where c.name like 'ZZ QA ${tag}%'
            and not exists (select 1 from public.company_members m where m.company_id=c.id and m.user_id not in (${uids}));
        if cardinality(ids) > 0 then
          for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='r' and c.relname<>'companies'
                     and exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='company_id' and not a.attisdropped)
          loop
            execute format('delete from public.%I where company_id = any($1)', r.relname) using ids;
          end loop;
          delete from public.companies where id = any(ids);
        end if;
        delete from public.trial_grants where email_normalized like '${tag}-%@example.test';
      end $$;`;
    await sql(cleanup);
    for (const id of created.users) await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
    const left = await sql(`select (select count(*)::int from auth.users where email like '${tag}-%') users, (select count(*)::int from public.companies where name like 'ZZ QA ${tag}%') companies, (select count(*)::int from public.trial_grants where email_normalized like '${tag}-%') grants, (select count(*)::int from public.profiles where email like '${tag}-%') profiles`);
    console.log("temizlik sonrasi kalan test kaydi:", JSON.stringify(left[0]));
  } catch (e) { console.log("TEMIZLIK HATASI", String(e).slice(0, 300), "tag=" + tag); }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nOZET: ${results.length - failed}/${results.length} gecti, ${failed} basarisiz`);
}
