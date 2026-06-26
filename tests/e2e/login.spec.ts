import { test, expect } from "@playwright/test";

// Public testler — kimlik bilgisi gerektirmez, her zaman çalışır.
test.describe("Login sayfası (public)", () => {
  test("login formu render ediliyor", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Giriş Yap" })).toBeVisible();
  });

  test("boş giriş denemesi login sayfasında kalır", async ({ page }) => {
    await page.goto("/#/login");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/#\/login/);
  });

  test("hatalı kimlik bilgisi login sayfasında kalır (içeri almaz)", async ({ page }) => {
    await page.goto("/#/login");
    await page.locator('input[type="email"]').fill("wrong@example.com");
    await page.locator('input[type="password"]').fill("wrongpass123");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/#\/login/);
  });

  test("oturumsuz korumalı route login'e yönlendirir", async ({ page }) => {
    await page.goto("/#/dashboard");
    await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
  });

  test("JS runtime hatası olmadan yükleniyor", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/#/login");
    await page.waitForTimeout(1500);
    expect(errors, `Sayfa JS hataları: ${errors.join(" | ")}`).toHaveLength(0);
  });
});
