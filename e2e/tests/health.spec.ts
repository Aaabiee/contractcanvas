import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3333';

test.describe('Health & API', () => {
  test('API health endpoint returns ok', async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('API returns 401 for protected routes without token', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/matters`);
    expect(res.status()).toBe(401);
  });

  test('API returns 404 for unknown routes', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/nonexistent`);
    expect(res.status()).toBe(404);
  });

  test('API auth rate limiter headers present', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'test@test.com', password: 'test' },
    });
    const headers = res.headers();
    expect(headers['ratelimit-limit'] || headers['x-ratelimit-limit']).toBeTruthy();
  });
});
