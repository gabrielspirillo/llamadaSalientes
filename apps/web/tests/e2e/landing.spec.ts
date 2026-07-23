import { expect, test } from '@playwright/test';

// El root "/" ya no muestra landing pública: redirige a /sign-in para
// visitantes anónimos (la landing quedó deshabilitada, ver app/(marketing)/page.tsx).
test('root redirects anonymous visitors to sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', { name: /sign in to dentalvoice/i })).toBeVisible();
});

test('health endpoint responds 200', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
});
