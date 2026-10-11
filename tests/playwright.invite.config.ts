import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: /invite-regression\.spec\.ts/,
  workers: 1, retries: 0, timeout: 30000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:5187", screenshot: "only-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5187 --strictPort",
    url: "http://127.0.0.1:5187", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:54329", VITE_SUPABASE_ANON_KEY: "local-test-only" },
  },
});
