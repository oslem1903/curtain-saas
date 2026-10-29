import { test, expect, type Page } from "@playwright/test";
import { friendlyInviteJoinError } from "../../src/utils/inviteJoin";
import { getNativeAuthCallbackHash } from "../../src/utils/authRedirect";
import { isSpecialAccessActive, isTrialExpired } from "../../src/utils/trialLicense";
import { requiresNativeUpdate } from "../../src/utils/nativeUpdatePolicy";
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name !== "ios") return;
  await page.addInitScript(() => {
    Object.assign(window, { webkit: { messageHandlers: { bridge: { postMessage() {} } } } });
  });
});
const userId = "27000000-0000-0000-0000-000000000001";
const companyId = "27000000-0000-0000-0000-000000000101";
const email = "join@example.test";
const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 4102444800, role: "authenticated" })).toString('base64url')}.test`;
const user = { id: userId, email, aud: "authenticated", role: "authenticated", email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, identities: [{ id: userId }] };
const session = (metadata = {}) => ({ access_token: jwt, refresh_token: "local-refresh", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user: { ...user, user_metadata: metadata } });

test("used invite error directs existing users to sign-in or password reset", () => {
  expect(friendlyInviteJoinError({ message: "INVITE_USED" })).toBe("Bu davet daha önce kullanılmış. Mevcut hesabınızla giriş yapın veya şifrenizi sıfırlayın.");
});

test("native auth callback preserves Supabase query parameters", () => {
  expect(getNativeAuthCallbackHash("com.curtainsaas.app://auth/callback?token_hash=otp&type=signup"))
    .toBe("#/auth/callback?token_hash=otp&type=signup");
  expect(getNativeAuthCallbackHash("com.curtainsaas.app://auth/callback?access_token=at&refresh_token=rt&type=recovery"))
    .toBe("#/auth/callback?access_token=at&refresh_token=rt&type=recovery");
  expect(getNativeAuthCallbackHash("https://example.test/auth/callback")).toBeNull();
});

test("server-aligned access helpers expire exactly at the end instant", () => {
  const end = 1_800_000_000_000;
  const trial = { plan_status: "trial", trial_ends_at: new Date(end).toISOString() };
  expect(isTrialExpired(trial, end - 1)).toBe(false);
  expect(isTrialExpired(trial, end)).toBe(true);
  expect(isTrialExpired(trial, end + 1)).toBe(true);
  expect(isTrialExpired({ plan_status: "active", license_expires_at: new Date(end).toISOString() }, end)).toBe(true);
  const special = { ...trial, is_pilot: true, pilot_until: new Date(end).toISOString() };
  expect(isSpecialAccessActive(special, end - 1)).toBe(true);
  expect(isSpecialAccessActive(special, end)).toBe(false);
  expect(isTrialExpired({ ...trial, is_pilot: true, pilot_until: null }, end)).toBe(false);
});

test("hash-router email verification callback consumes the OTP query", async ({ page }) => {
  const state = await mockApi(page, { pending: true });
  await page.goto("/#/auth/callback?token_hash=one-time-code&type=signup");
  await expect(page).toHaveURL(/#\/field/, { timeout: 15000 });
  expect(state.authExchanges).toBe(1);
  expect(state.completions).toBeGreaterThan(0);
});

async function mockApi(page: Page, options: { pending?: boolean; metadata?: Record<string, unknown>; membershipError?: boolean; profileError?: boolean; completeError?: string; signedIn?: boolean; used?: boolean; slowMembership?: boolean; ready?: boolean; role?: string; memberRole?: string; unconfirmed?: boolean; claimable?: boolean } = {}) {
  const state = { member: !!options.ready, verified: !!options.signedIn, metadata: options.metadata ?? (options.pending ? { perdepro_invite: { code: "TEST-01" } } : {}), signup: null as Record<string, unknown> | null, completions: 0, accepts: 0, trialCalls: 0, trialCompaniesCreated: 0, membershipError: !!options.membershipError, memberQueries: 0, profileEmailQueries: 0, authExchanges: 0, claims: 0 };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:5187") return route.continue();
    // No live Supabase, email, analytics or external network from these tests.
    if (url.origin !== "http://127.0.0.1:54329") return route.abort();
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const path = url.pathname;
    if (path.endsWith("/app_platform_releases")) return respond(null);
    if (path.endsWith("/auth/v1/recover")) return respond({});
    if (path.endsWith("/auth/v1/resend")) return respond({});
    if (path.endsWith("/auth/v1/user")) return respond({ ...user, user_metadata: state.metadata });
    if (path.endsWith("/auth/v1/token")) {
      state.authExchanges++;
      if (options.unconfirmed && !state.verified) return respond({ code: "email_not_confirmed", message: "Email not confirmed" }, 400);
      return state.verified ? respond(session(state.metadata)) : respond({ code: "invalid_credentials", message: "Invalid login credentials" }, 400);
    }
    if (path.endsWith("/auth/v1/verify")) {
      state.authExchanges++;
      state.verified = true;
      return respond(session(state.metadata));
    }
    if (path.endsWith("/auth/v1/signup")) {
      state.signup = route.request().postDataJSON();
      state.metadata = (state.signup?.data ?? {}) as typeof state.metadata;
      return respond({ ...user, email_confirmed_at: null, user_metadata: state.metadata });
    }
    if (path.endsWith("/rpc/get_invite_by_email_code") || path.endsWith("/rpc/get_invite_by_token")) return respond([{ invite_id: "invite-1", company_id: companyId, company_name: "Test Perde", role: "installer", email, expires_at: "2099-01-01T00:00:00Z", used_at: options.used ? "2026-01-01T00:00:00Z" : null }]);
    if (path.endsWith("/rpc/complete_pending_invite_for_current_user")) {
      state.completions++;
      if (options.completeError) return respond({ message: options.completeError }, 400);
      state.member = true;
      return respond([{ accepted_company_id: companyId, accepted_role: "installer" }]);
    }
    if (/\/rpc\/accept_invite(_code)?_for_current_user$/.test(path)) {
      state.accepts++;
      state.member = true;
      return respond([{ accepted_company_id: companyId, accepted_role: "installer" }]);
    }
    if (path.endsWith("/rpc/claim_pending_invites_for_current_user")) {
      state.claims++;
      if (!options.claimable) return respond([]);
      state.member = true;
      return respond([{ accepted_company_id: companyId, accepted_role: "installer" }]);
    }
    if (path.endsWith("/rpc/get_current_auth_context")) return options.profileError ? respond({ code: "42501", message: "permission denied" }, 403) : respond([{ role: options.role || (state.member && state.trialCalls ? "admin" : "installer"), is_active: true }]);
    if (path.endsWith("/rpc/company_subscription_access_snapshot")) return respond({ access_allowed: state.member, access_kind: state.trialCalls ? "trial" : "paid", access_expires_at: state.trialCalls ? "2099-01-01T00:00:00Z" : null, server_time: "2026-10-08T00:00:00Z" });
    if (path.endsWith("/rpc/start_self_service_trial")) {
      state.trialCalls++;
      if (!state.member) state.trialCompaniesCreated++;
      state.member = true;
      return respond({ company_id: companyId, created: state.trialCompaniesCreated === 1, plan_status: "trial", trial_started_at: "2026-10-08T00:00:00Z", trial_ends_at: "2026-10-22T00:00:00Z" });
    }
    if (path.endsWith("/rpc/company_subscription_access_allowed")) return respond(state.member);
    if (path.endsWith("/company_members")) {
      state.memberQueries++;
      if (options.slowMembership) await new Promise(resolve => setTimeout(resolve, 7000));
      if (state.membershipError) return respond({ code: "PGRST000", message: "Connection failed" }, 503);
      return respond(state.member || options.slowMembership ? [{ company_id: companyId, role: options.memberRole || options.role || (state.trialCalls ? "admin" : "installer"), is_active: true, created_at: "2026-01-01", companies: { id: companyId, name: "Test Perde", onboarding_completed: true, is_active: true, plan_status: state.trialCalls ? "trial" : "active", trial_ends_at: state.trialCalls ? "2099-01-01T00:00:00Z" : null, subscription_plan: state.trialCalls ? "starter" : "pro", package_code: state.trialCalls ? "solo" : "pro", read_only: false, enabled_modules: state.trialCalls ? ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation", "collections"] : ["measurements", "orders", "customers", "appointments", "installation"] } }] : []);
    }
    if (path.endsWith("/profiles")) {
      if (url.searchParams.has("email")) state.profileEmailQueries++;
      return respond({ role: "installer", is_active: true, user_id: userId });
    }
    if (path.endsWith("/rpc/register_device_and_touch_login")) return respond("active");
    return respond([]);
  });
  if (options.ready || options.signedIn || options.pending || options.membershipError || options.profileError || options.slowMembership) {
    await page.addInitScript(value => localStorage.setItem("perdepro-auth", JSON.stringify(value)), session(state.metadata));
  }
  return state;
}
async function fillJoin(page: Page) {
  await page.getByPlaceholder("Ad soyad").fill("Test User");
  await page.getByPlaceholder("ABC-123").fill("TEST-01");
  await page.locator('input[type="email"]').fill(email);
  if (await page.locator('input[type="password"]').count()) await page.locator('input[type="password"]').fill("test-password-123");
}

test("new account waits for email; a fresh browser completes saved invite", async ({ page, context }) => {
  const state = await mockApi(page);
  await page.goto("/#/join"); await fillJoin(page);
  await page.getByRole("button", { name: "Kodu Onayla ve Şifreyi Belirle" }).click();
  await expect(page.getByRole("heading", { name: "E-postanızı doğrulayın" })).toBeVisible();
  expect(state.signup?.data).toEqual({ full_name: "Test User", perdepro_invite: { code: "TEST-01" } });
  expect(state.accepts).toBe(0); expect(state.member).toBe(false);
  await expect(page.getByText(/Supabase|SQL Editor|Teknik aşama/)).toHaveCount(0);
  const callback = await context.newPage();
  const confirmed = await mockApi(callback, { pending: true });
  await callback.goto(`/#access_token=${jwt}&refresh_token=local-refresh&type=signup`);
  await expect(callback).toHaveURL(/#\/field/, { timeout: 15000 });
  expect(confirmed.completions).toBeGreaterThan(0);
  expect(confirmed.member).toBe(true);
  expect(callback.url()).not.toContain("access_token");
});

test("existing verified account joins without signing up again", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true });
  await page.goto("/#/join"); await fillJoin(page);
  await page.getByRole("button", { name: "Kodu Onayla ve Katıl" }).click();
  await expect(page.getByRole("heading", { name: "Hesabınız hazır" })).toBeVisible();
  expect(state.signup).toBeNull(); expect(state.accepts).toBe(1);
  await expect(page).toHaveURL(/#\/field/);
});

test("active company membership role overrides the global profile role", async ({ page }) => {
  await mockApi(page, { ready: true, signedIn: true, role: "installer", memberRole: "admin" });
  await page.goto("/");
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 15000 });
});

test("consumed invite retry reaches idempotent server", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, used: true });
  await page.goto("/#/join"); await fillJoin(page);
  await page.getByRole("button", { name: "Kodu Onayla ve Katıl" }).click();
  await expect(page.getByRole("heading", { name: "Hesabınız hazır" })).toBeVisible();
  expect(state.accepts).toBe(1);
});

test("membership query failure is not reported as missing membership; retry navigates", async ({ page }) => {
  const state = await mockApi(page, { membershipError: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hesabınız kontrol edilemedi" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Bu kullanıcı herhangi bir firma üyeliğiyle eşleşmiyor.", { exact: false })).toHaveCount(0);
  state.membershipError = false; state.member = true;
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page).toHaveURL(/#\/field/, { timeout: 15000 });
});

test("profile permission failure is not hidden behind email fallback", async ({ page }) => {
  const state = await mockApi(page, { profileError: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hesabınız kontrol edilemedi" })).toBeVisible({ timeout: 15000 });
  expect(state.profileEmailQueries).toBe(0); expect(state.memberQueries).toBe(0);
});

test("expired pending invite has a useful error and does not create another company", async ({ page }) => {
  const state = await mockApi(page, { pending: true, completeError: "INVITE_EXPIRED" });
  await page.goto("/");
  await expect(page.getByText("Davetin süresi dolmuş.", { exact: false })).toBeVisible();
  expect(state.member).toBe(false);
  await expect(page.getByRole("button", { name: "Davet Kodu Gir" })).toHaveCount(0);
});

test("empty callback never claims that verification succeeded", async ({ page }) => {
  await mockApi(page); await page.goto("/#/auth/callback");
  await expect(page.getByRole("heading", { name: "Bağlantı doğrulanamadı" })).toBeVisible();
  await expect(page.getByText("Doğrulama oturumu bulunamadı.", { exact: false })).toBeVisible();
});

test("password recovery callback returns to the reset screen", async ({ page }) => {
  await mockApi(page, { ready: true, signedIn: true });
  await page.goto(`/#access_token=${jwt}&refresh_token=local-refresh&type=recovery`);
  await expect(page).toHaveURL(/#\/reset-password/, { timeout: 15000 });
});


test("confirmation button rechecks email and resumes without another signup", async ({ page }) => {
  const state = await mockApi(page, { unconfirmed: true });
  await page.goto("/#/join"); await fillJoin(page);
  await page.getByRole("button", { name: "Kodu Onayla ve Şifreyi Belirle" }).click();
  await expect(page.getByRole("heading", { name: "E-postanızı doğrulayın" })).toBeVisible();
  await page.getByRole("button", { name: "Doğruladım, devam et" }).click();
  await expect(page.getByRole("alert")).toContainText("Doğrulama henüz tamamlanmamış");
  state.verified = true;
  await page.getByRole("button", { name: "Doğruladım, devam et" }).click();
  await expect(page.getByRole("heading", { name: "Hesabınız hazır" })).toBeVisible();
  expect(state.signup).toBeNull();
  expect(state.accepts).toBe(1);
});

test("PKCE callback is exchanged only once under StrictMode", async ({ page }) => {
  const state = await mockApi(page, { pending: true, signedIn: true });
  await page.goto("/?code=test-code#/auth/callback");
  await expect(page).toHaveURL(/#\/field/, { timeout: 15000 });
  expect(state.authExchanges).toBe(1);
});

test("slow membership query never opens protected page on a timer", async ({ page }) => {
  await mockApi(page, { slowMembership: true });
  await page.goto("/#/field");
  await page.waitForTimeout(6500); // Regression: old 6.5 s watchdog granted ready.
  await expect(page.getByText("Lisans ve yetkiler kontrol ediliyor...")).toBeVisible();
  await expect(page).toHaveURL(/#\/field/, { timeout: 1000 });
  await expect(page.getByText("Yetki bulunamadı — herhangi bir firma üyeliğiyle eşleşmiyor.", { exact: false })).toHaveCount(0);
});

test("decorative rail order and print use width only", async ({ page }) => {
  await mockApi(page, { ready: true, role: "admin" });
  await page.goto("/#/orders/new");
  const type = page.locator('select').filter({ has: page.locator('option[value="dekoratif_ray"]') });
  await type.selectOption("dekoratif_ray");
  await page.getByPlaceholder("En", { exact: true }).fill("110");
  await page.getByPlaceholder("Adet", { exact: true }).fill("2");
  const grid = type.locator("..").locator("..");
  await grid.locator('input[type="number"]').last().fill("80");
  await expect(page.getByPlaceholder("Boy", { exact: true })).toHaveCount(0);
  await expect(page.getByText("110 cm → 125 cm • 1.25 mtül", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("₺200,00", { exact: true }).first()).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("110 cm → 125 cm • 1.25 mtül", { exact: true }).first()).toBeVisible();
});

test("self signup email callback activates one Solo company", async ({ page, context }) => {
  const state = await mockApi(page);
  await page.goto("/#/signup");
  await page.getByPlaceholder("Adınız Soyadınız").fill("New Test User");
  await page.getByPlaceholder("Örn. Yıldız Perde").fill("Solo Test Perde");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill("test-password-123");
  await page.getByRole("button", { name: "Hesabımı oluştur" }).click();
  await expect(page.getByRole("heading", { name: "E-postanızı doğrulayın" })).toBeVisible();
  expect(state.signup?.data).toMatchObject({ full_name: "New Test User", company_name: "Solo Test Perde", signup_intent: "self_trial" });

  const callback = await context.newPage();
  const activation = await mockApi(callback, { signedIn: true, metadata: state.metadata });
  await callback.goto(`/#access_token=${jwt}&refresh_token=local-refresh&type=signup`);
  await expect(callback).toHaveURL(/#\/dashboard/, { timeout: 15000 });
  expect(activation.trialCalls).toBe(1);
  expect(activation.trialCompaniesCreated).toBe(1);
  expect(activation.member).toBe(true);
  for (const route of ["customers", "measurements/new", "quotes", "orders/new"]) {
    await callback.goto(`/#/${route}`);
    await expect(callback).toHaveURL(new RegExp(`#/${route.replaceAll("/", "\\/")}$`));
  }
});

test("verified account without membership claims its pending invite without a code", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, claimable: true });
  await page.goto("/");
  await expect(page).toHaveURL(/#\/field/, { timeout: 15000 });
  expect(state.claims).toBe(1);
  expect(state.member).toBe(true);
  expect(state.trialCompaniesCreated).toBe(0);
});

test("account without membership or pending invite sees clear setup guidance, not a blank screen", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hesap kurulumu" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Davet kodum var" })).toHaveCount(0);
  expect(state.claims).toBe(1);
  expect(state.trialCompaniesCreated).toBe(0);
});

test("new user reaches signup from login and chooses their own password", async ({ page }) => {
  const state = await mockApi(page);
  await page.goto("/#/login");
  await page.getByRole("button", { name: "Kayıt ol", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kayıt ol", exact: true })).toBeVisible();
  await page.getByLabel("Ad Soyad", { exact: true }).fill("Yeni Kullanıcı");
  await page.getByLabel("İşletme adı", { exact: true }).fill("Yeni Perde");
  await page.getByLabel("E-posta", { exact: true }).fill("NEW@example.test");
  await page.getByLabel("Şifre", { exact: true }).fill("new-account-password-123");
  await page.getByRole("button", { name: "Hesabımı oluştur" }).click();
  await expect(page.getByRole("heading", { name: "E-postanızı doğrulayın" })).toBeVisible();
  expect(state.signup).toMatchObject({ email: "new@example.test", password: "new-account-password-123" });
  expect(state.trialCalls).toBe(0);
  await page.getByRole("button", { name: "Doğrulama e-postasını tekrar gönder" }).click();
  await expect(page.getByRole("status")).toContainText("tekrar gönderildi");
});

test("password reset guides unregistered users to signup without creating an account", async ({ page }) => {
  const state = await mockApi(page);
  await page.goto("/#/login");
  await page.getByLabel("Giriş e-posta adresi").fill(email);
  await page.getByRole("button", { name: "Şifremi unuttum" }).click();
  await expect(page.getByRole("status")).toContainText('"Kayıt ol" ile hesap açabilir');
  expect(state.signup).toBeNull();
  expect(state.trialCalls).toBe(0);
});

test("duplicate email stays on signup and offers sign in", async ({ page }) => {
  const state = await mockApi(page);
  await page.route("**/auth/v1/signup**", route => route.fulfill({ json: { ...user, identities: [] } }));
  await page.goto("/#/signup");
  await page.getByLabel("Ad Soyad", { exact: true }).fill("Test Kullanıcı");
  await page.getByLabel("İşletme adı", { exact: true }).fill("Test Perde");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Şifre", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Hesabımı oluştur" }).click();
  await expect(page.getByRole("alert")).toContainText("zaten bir hesap var");
  await expect(page.getByRole("button", { name: "Giriş ekranına git" })).toBeVisible();
  expect(state.trialCalls).toBe(0);
});

test("iOS update gate runs before login and can be remotely disabled", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "ios", "Native iOS policy only");
  await mockApi(page);
  let enabled = true;
  await page.route("**/rest/v1/app_platform_releases**", route => route.fulfill({ json: {
    platform: "ios", minimum_version: "1.0.23", store_url: "https://apps.apple.com/tr/app/perdepro/id1234567890", enabled,
  } }));
  await page.goto("/#/login");
  await expect(page.getByRole("heading", { name: "PerdePRO’yu güncelleyin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kayıt ol", exact: true })).toHaveCount(0);
  enabled = false;
  await page.getByRole("button", { name: "Tekrar kontrol et" }).click();
  await expect(page.getByRole("button", { name: "Kayıt ol", exact: true })).toBeVisible();
});

test("unavailable release metadata does not prevent signup", async ({ page }) => {
  await mockApi(page);
  await page.route("**/rest/v1/app_platform_releases**", route => route.fulfill({ status: 503, json: { message: "Offline" } }));
  await page.goto("/#/signup");
  await expect(page.getByRole("heading", { name: "Kayıt ol", exact: true })).toBeVisible();
});

test("required update validates platform, version and App Store destination", () => {
  const policy = { platform: "ios", enabled: true, minimum_version: "1.0.22", store_url: "https://apps.apple.com/tr/app/perdepro/id1234567890" };
  expect(requiresNativeUpdate(policy, "ios", "1.0.20")).toBe(true);
  expect(requiresNativeUpdate(policy, "ios", "1.0.22")).toBe(false);
  expect(requiresNativeUpdate(policy, "ios", "1.0.100")).toBe(false);
  expect(requiresNativeUpdate(policy, "android", "1.0.20")).toBe(false);
  expect(requiresNativeUpdate(policy, "web", "1.0.20")).toBe(false);
  expect(requiresNativeUpdate({ ...policy, enabled: false }, "ios", "1.0.20")).toBe(false);
  expect(requiresNativeUpdate({ ...policy, store_url: "https://example.test/id123" }, "ios", "1.0.20")).toBe(false);
  expect(requiresNativeUpdate({ ...policy, store_url: "https://apps.apple.com.evil.test/id123" }, "ios", "1.0.20")).toBe(false);
  expect(requiresNativeUpdate({ ...policy, minimum_version: "invalid" }, "ios", "1.0.20")).toBe(false);
});

const deletionReceipt = { id: "29000000-0000-0000-0000-000000000001", receipt_secret: "29000000-0000-0000-0000-000000000002", status: "pending", requested_at: "2026-10-29T09:00:00Z", due_at: "2026-11-05T09:00:00Z", completed_at: null, completion_note: null };

test("account deletion requires explicit confirmation and only queues the caller", async ({ page }) => {
  await mockApi(page, { signedIn: true });
  let calls = 0; let body: unknown;
  await page.route("**/rest/v1/rpc/request_my_account_deletion", async route => {
    calls++; body = route.request().postDataJSON();
    await route.fulfill({ json: deletionReceipt });
  });
  await page.goto("/#/account/delete");
  const submit = page.getByRole("button", { name: "Kalıcı silme talebini gönder" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Silme onayı").fill("SİL");
  await expect(submit).toBeDisabled();
  await page.getByRole("checkbox").check();
  await submit.click();
  await expect(page.getByRole("status")).toContainText("Hesabınız henüz silinmedi");
  expect(calls).toBe(1);
  expect(body).toEqual({ p_confirm: "HESABIMI SIL" });
  await page.reload();
  await expect(page.getByRole("button", { name: "Talebin durumunu kontrol et" })).toBeVisible();
  expect(calls).toBe(1);
});

test("account deletion backend failure never claims success", async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.route("**/rest/v1/rpc/request_my_account_deletion", route => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await page.goto("/#/account/delete");
  await page.getByLabel("Silme onayı").fill("SİL");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Kalıcı silme talebini gönder" }).click();
  await expect(page.getByRole("alert")).toContainText("kaydedilemedi");
  await expect(page.getByRole("button", { name: "Talebin durumunu kontrol et" })).toHaveCount(0);
});

test("deletion completion remains trackable without an Auth account", async ({ page }) => {
  await mockApi(page);
  await page.route("**/rest/v1/rpc/get_account_deletion_receipt", route => route.fulfill({ json: { ...deletionReceipt, status: "completed", completed_at: "2026-10-30T09:00:00Z", completion_note: "Kişisel veriler silindi. Saklanan kayıt yok." } }));
  await page.goto("/#/account/delete");
  await page.getByLabel("Takip kodu", { exact: true }).fill(`${deletionReceipt.id}:${deletionReceipt.receipt_secret}`);
  await page.getByRole("button", { name: "Talebimi bul" }).click();
  await expect(page.getByRole("status")).toContainText("kalıcı silme işlemi tamamlandı");
  await expect(page.getByText("Kişisel veriler silindi. Saklanan kayıt yok.", { exact: false })).toBeVisible();
});

test("account deletion is accessible from settings and account setup", async ({ page }) => {
  await mockApi(page, { ready: true, role: "admin" });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Hesabımı sil", exact: true }).click();
  await expect(page).toHaveURL(/#\/account\/delete$/);
  await expect(page.getByRole("heading", { name: "Hesabımı sil" })).toBeVisible();
});
