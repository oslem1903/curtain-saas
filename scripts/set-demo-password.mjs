// Apple demo hesabinin sifresini Supabase Auth Admin API ile gunceller.
// - Yalnizca asagidaki tek kullaniciya dokunur; silmez, profil/uyelik degismez.
// - service_role anahtari Supabase CLI'dan (oturum acik hesapla) bellege alinir;
//   ekrana, dosyaya, loga yazilmaz.
// - Yeni sifre gizli sorulur; ekrana, dosyaya, loga yazilmaz.
// Kullanim:
//   node scripts/set-demo-password.mjs --check   (yalnizca yetki/kullanici kontrolu)
//   node scripts/set-demo-password.mjs           (sifreyi sorar ve gunceller)
import { execFileSync } from "node:child_process";
import readline from "node:readline";

const PROJECT_REF = "ffhmzlcsgsgjonqqhgqq";
const USER_ID = "b4f5d387-a087-4136-b0bd-aa5673d435fe";
const USER_EMAIL = "test0924064036@gmail.com";
const checkOnly = process.argv.includes("--check");

function loadServiceKey() {
  const out = execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
    { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  const keys = JSON.parse(out.slice(out.indexOf("[")));
  const key = keys.find((k) => k.id === "service_role")?.api_key;
  if (!key) throw new Error("service_role anahtari CLI hesabiyla alinamadi (yetki yok).");
  return key;
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

const base = `https://${PROJECT_REF}.supabase.co`;
const serviceKey = loadServiceKey();
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

const get = await fetch(`${base}/auth/v1/admin/users/${USER_ID}`, { headers });
if (!get.ok) { console.error(`Admin API kullanici okuma basarisiz: HTTP ${get.status}`); process.exit(1); }
const u = await get.json();
if (u.id !== USER_ID || String(u.email).toLowerCase() !== USER_EMAIL) {
  console.error("Kullanici kimligi/e-posta beklenenle eslesmiyor; islem iptal.");
  process.exit(1);
}
console.log(`Admin API erisimi OK. Hedef: ${u.email} (e-posta dogrulanmis: ${Boolean(u.email_confirmed_at)}, banli: ${Boolean(u.banned_until)})`);
if (checkOnly) { console.log("--check: degisiklik yapilmadi."); process.exit(0); }

const p1 = await askHidden("Yeni demo sifresi (en az 12 karakter, gorunmez): ");
const p2 = await askHidden("Yeni sifre (tekrar): ");
if (p1 !== p2) { console.error("Sifreler eslesmiyor; islem iptal."); process.exit(1); }
if (p1.length < 12) { console.error("Sifre en az 12 karakter olmali; islem iptal."); process.exit(1); }

const put = await fetch(`${base}/auth/v1/admin/users/${USER_ID}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ password: p1, email_confirm: true }),
});
if (!put.ok) { console.error(`Sifre guncelleme basarisiz: HTTP ${put.status}`); process.exit(1); }
console.log("Sifre guncellendi. Simdi dogrulama icin: node scripts/verify-demo-login.mjs " + USER_EMAIL);
