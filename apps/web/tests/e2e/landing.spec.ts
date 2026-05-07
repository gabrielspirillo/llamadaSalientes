import { expect, test } from '@playwright/test';

test('landing renders DentalVoice heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DentalVoice' })).toBeVisible();
});

test('health endpoint responds 200', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
});
