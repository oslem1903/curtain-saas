// Apple demo hesabi icin gercek giris dogrulamasi (sir yazmaz, kaydetmez).
// Kullanim:  node scripts/verify-demo-login.mjs test0924064036@gmail.com
// Sifre gizli olarak terminalde sorulur; ortam degiskeni/dosya/log kullanilmaz.
import fs from "node:fs";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) { console.error("E-posta argumani gerekli."); process.exit(2); }

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URI;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error(".env.local icinde Supabase ayari yok."); process.exit(2); }

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

const password = await askHidden("Demo hesap sifresi (gorunmez): ");
const results = [];
const ok = (name, pass, extra = "") => { results.push(pass); console.log(`${pass ? "OK  " : "FAIL"} ${name}${extra ? " - " + extra : ""}`); };

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(label) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  ok(label, !error && !!data.session, error ? `${error.code || ""} ${error.message}` : "oturum acildi");
  return data?.session?.user ?? null;
}

const user = await signIn("1. e-posta+sifre ile giris");
if (!user) { console.log("\nGiris basarisiz; sonraki adimlar atlandi."); process.exit(1); }
ok("2. e-posta dogrulanmis", !!user.email_confirmed_at);

const ctx = await sb.rpc("get_current_auth_context");
const prof = Array.isArray(ctx.data) ? ctx.data[0] : ctx.data;
ok("3. profil/rol (get_current_auth_context)", !ctx.error && !!prof?.role, `rol=${prof?.role ?? "?"}, super_admin degil=${prof?.role !== "super_admin"}`);

const mem = await sb.from("company_members").select("company_id,role,is_active,companies(name,is_active,read_only,plan_status,is_pilot,pilot_until,trial_ends_at)").eq("user_id", user.id);
const rows = mem.data || [];
const apple = rows.find((r) => (Array.isArray(r.companies) ? r.companies[0] : r.companies)?.name === "Apple Test");
ok("4. Apple Test firma uyeligi", !mem.error && !!apple && apple.is_active !== false, `uyelik sayisi=${rows.length}, rol=${apple?.role ?? "?"}`);
const c = Array.isArray(apple?.companies) ? apple.companies[0] : apple?.companies;
ok("5. firma aktif, salt okunur degil, ozel erisim acik", !!c && c.is_active !== false && !c.read_only && c.is_pilot === true && !c.pilot_until, c ? `plan=${c.plan_status}` : "");

for (const [label, table] of [["6. Musteriler okunuyor", "customers"], ["7. Siparis/Teklifler okunuyor", "orders"]]) {
  const r = await sb.from(table).select("id", { count: "exact", head: true });
  ok(label, !r.error, r.error ? r.error.message : `kayit sayisi=${r.count}`);
}

const other = await sb.from("customers").select("company_id").neq("company_id", apple?.company_id ?? "00000000-0000-0000-0000-000000000000").limit(1);
ok("8. baska firmanin musterisi gorunmuyor (izolasyon)", !other.error && (other.data || []).length === 0);

const out = await sb.auth.signOut();
ok("9. cikis", !out.error);
await signIn("10. tekrar giris");
await sb.auth.signOut();

console.log(results.every(Boolean) ? "\nSONUC: tum kontroller gecti." : "\nSONUC: basarisiz kontrol var.");
process.exit(results.every(Boolean) ? 0 : 1);
