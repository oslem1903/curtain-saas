import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// .env.e2e dosyasını otomatik yükle (varsa) — ekstra bağımlılık yok.
// Not Defteri bazen .txt ekler; bu yüzden hem ".env.e2e" hem ".env.e2e.txt" denenir.
// Kimlik bilgileri yalnızca bu dosyadan/ortamdan gelir, repoya yazılmaz.
for (const candidate of [".env.e2e", ".env.e2e.txt"]) {
  const envFile = path.resolve(process.cwd(), candidate);
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val !== "" && !process.env[m[1]]) process.env[m[1]] = val;
  }
}

// Gerçek tarayıcı E2E testleri. localhost:5173'te çalışan dev server'ı kullanır
// (çalışmıyorsa otomatik başlatır). Authed testler login YAPMAZ — bir kez kaydedilen
// storageState (scripts/e2e-record-auth.mjs) tekrar kullanılır.
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";

const STATE_REL = "tests/e2e/.auth/state.json";
const STATE_ABS = path.resolve(process.cwd(), STATE_REL);
const HAS_STATE = fs.existsSync(STATE_ABS);
// storageState yalnızca dosya varsa set edilir; yoksa Playwright başlangıçta patlamasın.
const authedUse = HAS_STATE ? { storageState: STATE_REL } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Sadece list reporter — bazı Windows/OneDrive ortamlarında HTML reporter'ın
  // playwright-report klasörünü oluştururken EPERM almasını önler.
  reporter: [["list"]],
  timeout: 40_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Public (oturumsuz) — sadece login.spec.ts
    { name: "public-desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /login\.spec\.ts/ },
    { name: "public-mobile", use: { ...devices["Pixel 5"] }, testMatch: /login\.spec\.ts/ },
    // Authed (storageState ile) — *.authed.spec.ts
    { name: "auth-desktop", use: { ...devices["Desktop Chrome"], ...authedUse }, testMatch: /\.authed\.spec\.ts/ },
    { name: "auth-mobile", use: { ...devices["Pixel 5"], ...authedUse }, testMatch: /\.authed\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
