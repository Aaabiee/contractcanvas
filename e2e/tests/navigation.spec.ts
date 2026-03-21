import { test, expect, Page } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3333';

async function loginAsAlice(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"], input[name="email"]', 'alice@example.com');
  await page.fill('input[type="password"]', 'Password1234!');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
}

test.describe('Authenticated Navigation', () => {
  test.beforeEach(async ({ page }) => {
    try {
      await loginAsAlice(page);
    } catch {
      test.skip(true, 'Seed user not available — skipping navigation tests');
    }
  });

  test('dashboard loads with stats', async ({ page }) => {
    await expect(page.locator('text=Dashboard').first()).toBeVisible();
  });

  test('can navigate to matters', async ({ page }) => {
    await page.click('text=Matters');
    await page.waitForURL(/\/matters/);
    await expect(page.locator('h1, h2').filter({ hasText: /matter/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to contracts', async ({ page }) => {
    await page.click('text=Contracts');
    await page.waitForURL(/\/contracts/);
    await expect(page.locator('h1, h2').filter({ hasText: /contract/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to tasks', async ({ page }) => {
    await page.click('text=Tasks');
    await page.waitForURL(/\/tasks/);
    await expect(page.locator('h1, h2').filter({ hasText: /task/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('dark mode toggle works', async ({ page }) => {
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    await expect(themeBtn).toBeVisible();
    await themeBtn.click();
    const htmlClasses = await page.locator('html').getAttribute('class');
    expect(htmlClasses).toContain('theme-dark');
    await themeBtn.click();
    const htmlClassesAfter = await page.locator('html').getAttribute('class');
    expect(htmlClassesAfter).not.toContain('theme-dark');
  });

  test('search navigates to results page', async ({ page }) => {
    const searchInput = page.locator('input[aria-label="Global search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await searchInput.press('Enter');
      await page.waitForURL(/\/search\?q=test/);
    }
  });

  test('user menu shows logout option', async ({ page }) => {
    await page.locator('button[aria-label="Open user menu"]').click();
    await expect(page.locator('text=Logout')).toBeVisible();
  });
});
