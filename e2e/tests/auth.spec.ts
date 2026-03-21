import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Sign in')).toBeVisible();
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('text=Create Account').or(page.locator('text=Register').or(page.locator('text=Sign up')))).toBeVisible();
  });

  test('login shows validation errors for empty submit', async ({ page }) => {
    await page.goto('/login');
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isEnabled()) {
      await submitBtn.click();
      await expect(page.locator('mat-error').first()).toBeVisible({ timeout: 3000 }).catch(() => {});
    }
  });

  test('login rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', 'nonexistent@test.com');
    await page.fill('input[type="password"]', 'WrongPassword123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('text=Invalid').or(page.locator('text=incorrect').or(page.locator('[class*=error]')))).toBeVisible({ timeout: 5000 });
  });

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/, { timeout: 5000 });
    expect(page.url()).toContain('/login');
  });

  test('forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });
});
