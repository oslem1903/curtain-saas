import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: /(invite-regression|native-fixture-smoke)\.spec\.ts/,
  workers: 1, retries: 0, timeout: 30000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:5187", screenshot: "only-on-failure", serviceWorkers: "block",
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu"] } : undefined },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    { name: "ios", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5187 --strictPort",
    url: "http://127.0.0.1:5187", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:54329", VITE_SUPABASE_ANON_KEY: "local-test-only" },
  },
});
