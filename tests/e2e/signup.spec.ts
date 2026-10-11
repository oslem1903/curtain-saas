import { test, expect } from "@playwright/test";

const APP_ORIGIN = new URL(process.env.E2E_BASE_URL || "http://localhost:5173").origin;

// Public testler — form GÖNDERİLMEZ (canlı veritabanına kayıt açılmaz).
test.describe("Kodsuz kayıt ekranları (public)", () => {
  test("mevcut kullanıcı giriş yapar ve oturum yenilemede korunur", async ({ page }) => {
    const userId = "28000000-0000-0000-0000-000000000001";
    const companyId = "28000000-0000-0000-0000-000000000101";
    const user = { id: userId, email: "member@example.test", aud: "authenticated", role: "authenticated", email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, identities: [{ id: userId }] };
    const jwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, exp: 4102444800, role: "authenticated" })).toString("base64url")}.test`;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === APP_ORIGIN) return route.continue();
      const respond = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname.endsWith("/auth/v1/token")) return respond({ access_token: jwt, refresh_token: "local-refresh", expires_in: 3600, token_type: "bearer", user });
      if (url.pathname.endsWith("/auth/v1/user")) return respond(user);
      if (url.pathname.endsWith("/rpc/get_current_auth_context")) return respond([{ role: "admin", is_active: true }]);
      if (url.pathname.endsWith("/company_members")) return respond([{ company_id: companyId, role: "admin", is_active: true, created_at: "2026-01-01T00:00:00Z", companies: { id: companyId, name: "Member Test", is_active: true, plan_status: "active", subscription_plan: "pro", package_code: "pro", enabled_modules: ["admin", "customers", "measurements", "orders"] } }]);
      if (url.pathname.endsWith("/rpc/company_subscription_access_allowed")) return respond(true);
      if (url.pathname.endsWith("/rpc/register_device_and_touch_login")) return respond("ok");
      return route.abort();
    });
    await page.goto("/#/login");
    await page.getByPlaceholder("ornek@mail.com").fill(user.email);
    await page.getByPlaceholder("••••••").fill("test-password-123");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await expect(page).toHaveURL(/#\/dashboard/, { timeout: 15000 });
    await page.reload();
    await expect(page).toHaveURL(/#\/dashboard/, { timeout: 15000 });
  });

  test("şifre sıfırlama isteği mevcut hesabı açığa çıkarmaz", async ({ page }) => {
    let recoveryCalls = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === APP_ORIGIN) return route.continue();
      if (url.pathname.endsWith("/auth/v1/recover")) {
        recoveryCalls++;
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      return route.abort();
    });
    await page.goto("/#/login");
    await page.getByPlaceholder("ornek@mail.com").fill("member@example.test");
    await page.getByRole("button", { name: "Şifremi unuttum" }).click();
    await expect(page.getByText("Bu e-posta ile kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi.", { exact: false })).toBeVisible();
    expect(recoveryCalls).toBe(1);
  });

  test("giriş ekranında ana ve ikincil seçenekler var", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("button", { name: "Giriş Yap" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kayıt ol — 7 gün ücretsiz dene" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Davet kodum var" })).toBeVisible();
  });

  test("7 gün ücretsiz dene kayıt formunu açar", async ({ page }) => {
    await page.goto("/#/login");
    await page.getByRole("button", { name: "Kayıt ol — 7 gün ücretsiz dene" }).click();
    await expect(page).toHaveURL(/#\/signup/);
    await expect(page.getByPlaceholder("Adınız Soyadınız")).toBeVisible();
    await expect(page.getByPlaceholder("Örn. Yıldız Perde")).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("eksik bilgiyle kayıt isteği gönderilmez", async ({ page }) => {
    let signupCalls = 0;
    page.on("request", (req) => {
      if (req.url().includes("/auth/v1/signup")) signupCalls++;
    });
    await page.goto("/#/signup");
    await page.getByRole("button", { name: "Ücretsiz denemeyi başlat" }).click();
    await expect(page.getByText("Ad soyad girin.")).toBeVisible();
    expect(signupCalls).toBe(0);
  });

  test("kayıtlı e-posta yeni firma/deneme oluşturmaya çalışmaz", async ({ page }) => {
    let signupCalls = 0;
    let trialCalls = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === APP_ORIGIN) return route.continue();
      if (url.pathname.endsWith("/auth/v1/signup")) {
        signupCalls++;
        const request = route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "existing-user",
            email: request.email,
            identities: [],
            email_confirmed_at: null,
            user_metadata: request.data,
          }),
        });
      }
      if (url.pathname.endsWith("/rpc/start_self_service_trial")) {
        trialCalls++;
        return route.fulfill({ status: 500, body: "unexpected trial call" });
      }
      return route.abort();
    });
    await page.goto("/#/signup");
    await page.getByPlaceholder("Adınız Soyadınız").fill("Existing User");
    await page.getByPlaceholder("Örn. Yıldız Perde").fill("Existing Business");
    await page.locator('input[type="email"]').fill("existing@example.test");
    await page.locator('input[type="password"]').fill("test-password-123");
    await page.getByRole("button", { name: "Ücretsiz denemeyi başlat" }).click();
    expect(signupCalls).toBe(1);
    await expect(page.getByText("Bu e-posta ile zaten bir hesap var. Giriş yapın veya şifrenizi sıfırlayın.")).toBeVisible();
    expect(trialCalls).toBe(0);
  });

  test("davet kodum var mevcut kodla katıl ekranını açar", async ({ page }) => {
    await page.goto("/#/login");
    await page.getByRole("button", { name: "Davet kodum var" }).click();
    await expect(page).toHaveURL(/#\/join/);
    await expect(page.getByRole("heading", { name: "Davet kodum var" })).toBeVisible();
  });

  test("oturumsuz kurulum ekranı girişe yönlendirir", async ({ page }) => {
    await page.goto("/#/setup");
    await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
  });
});
