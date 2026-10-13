// QA test hesaplari (Git disi .env.e2e'den). Degerler ciktiya yazilmaz.
//
// Her QA kullanicisi kendi SABIT ve BIRBIRINDEN FARKLI curtain_saas_device_id'sini kullanir; boylece
// tekrarlanan testler firmanin cihaz limitini (max_devices) tuketmez ve gercek kullanicilarin cihaz
// kayitlarina dokunulmaz. Ayni id iki hesaba verilirse (env ile) betik durur.
import fs from 'node:fs';

const REF = 'ffhmzlcsgsgjonqqhgqq';
export const DEFAULT_DEVICE_IDS = { A: 'qa-device-tc1-admin', B: 'qa-device-tc2-admin' };

const parseEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
};

export function loadQaAccounts({ requireBoth = true } = {}) {
  const env = { ...parseEnv('.env.local'), ...parseEnv('.env.e2e'), ...process.env };
  const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URI;
  const anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !new URL(url).host.startsWith(REF + '.')) throw new Error(`YANLIS PROJE: .env.local ${REF} degil`);
  const accounts = {};
  for (const [k, n] of [['A', 1], ['B', 2]]) {
    const email = env[`E2E_${k}_EMAIL`];
    const password = env[`E2E_${k}_PASSWORD`];
    if (!email || !password) { if (requireBoth) throw new Error(`E2E_${k}_EMAIL/E2E_${k}_PASSWORD tanimli degil (.env.e2e)`); continue; }
    if (!new RegExp(`^perdepro-qa-tc${n}-[a-z0-9]+@example\\.test$`).test(email)) {
      throw new Error(`${k} hesabi beklenen QA hesabi degil; gercek hesapla calistirilmaz.`);
    }
    accounts[k] = { key: k, email, password, deviceId: env[`E2E_${k}_DEVICE_ID`] || DEFAULT_DEVICE_IDS[k] };
  }
  if (accounts.A && accounts.B && accounts.A.deviceId === accounts.B.deviceId) {
    throw new Error('A ve B ayni device id kullanamaz.');
  }
  return { url, anon, accounts };
}

export async function passwordLogin({ url, anon }, account) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`${account.key} girisi basarisiz (HTTP ${r.status})`);
  return { token: j.access_token, userId: j.user?.id };
}
