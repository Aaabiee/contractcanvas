import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3333';

test.describe('Security Headers & OWASP', () => {
  test('API returns security headers', async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    const h = res.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBeTruthy();
  });

  test('CORS blocks unauthorized origins', async ({ request }) => {
    const res = await request.get(`${API_URL}/health`, {
      headers: { Origin: 'https://evil.com' },
    });
    const allowOrigin = res.headers()['access-control-allow-origin'];
    expect(allowOrigin).not.toBe('https://evil.com');
  });

  test('API does not expose stack traces in production-style errors', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/matters/nonexistent-id`, {
      headers: { Authorization: 'Bearer invalidtoken' },
    });
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
    expect(body.stack).toBeUndefined();
  });

  test('login does not reveal whether email exists', async ({ request }) => {
    const res1 = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'nonexistent@test.com', password: 'wrong' },
    });
    const res2 = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'also-nonexistent@test.com', password: 'wrong' },
    });
    expect(res1.status()).toBe(res2.status());
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.error).toBe(body2.error);
  });

  test('password reset does not reveal whether email exists', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/forgot-password`, {
      data: { email: 'nonexistent@nowhere.com' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('protected routes reject requests without auth', async ({ request }) => {
    const protectedRoutes = [
      '/api/matters',
      '/api/contracts',
      '/api/tasks',
      '/api/documents',
      '/api/notifications',
      '/api/users/me',
    ];

    for (const route of protectedRoutes) {
      const res = await request.get(`${API_URL}${route}`);
      expect(res.status()).toBe(401);
    }
  });
});
