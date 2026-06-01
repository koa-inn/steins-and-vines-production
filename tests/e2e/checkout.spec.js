// @ts-check
const { test, expect } = require('@playwright/test');

// Pre-seed the ferment cart so the checkout page doesn't redirect away
const SEEDED_CART = JSON.stringify([
  {
    name: 'Test Wine Kit', brand: 'E2E', qty: 1,
    item_type: 'kit', price: '29.99', time: '4',
    sku: 'TEST-001', unit: '', zoho_item_id: ''
  }
]);

test.describe('Checkout / reservation page', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the cart before page load so the redirect guard is satisfied
    await page.addInitScript((cart) => {
      localStorage.setItem('sv-cart-ferment', cart);
    }, SEEDED_CART);

    await page.goto('/reservation.html?cart=ferment');
  });

  test('page loads without redirect', async ({ page }) => {
    // Should stay on reservation.html (not redirect to products.html)
    await expect(page).toHaveURL(/reservation\.html/);
  });

  test('checkout stepper is visible', async ({ page }) => {
    await expect(page.locator('.checkout-stepper, #checkout-stepper')).toBeVisible();
  });

  test('step 1 (Review Items) is active on load', async ({ page }) => {
    const step1 = page.locator('.stepper-step').first();
    await expect(step1).toHaveClass(/stepper-step--active/);
  });

  test('reserved item appears in review section', async ({ page }) => {
    await expect(page.locator('[id*="reservation-items"], .reservation-items, #reservation-section').first())
      .toBeAttached({ timeout: 10000 });
    // The item name should appear somewhere on the page
    await expect(page.locator('body')).toContainText('Test Wine Kit', { timeout: 10000 });
  });

  test('contact form fields present', async ({ page }) => {
    await expect(page.locator('#res-name')).toBeAttached();
    await expect(page.locator('#res-email')).toBeAttached();
    await expect(page.locator('#res-phone')).toBeAttached();
  });

  // The reservation page validates on submit via validateCheckoutForm(), which
  // surfaces errors in the #form-error-announce aria-live region — not inline
  // per-field. (Inline blur validation lives on the contact page, not here.)
  test('email validation — invalid email is rejected', async ({ page }) => {
    await page.fill('#res-name', 'Test User');
    await page.fill('#res-email', 'notanemail');
    await page.fill('#res-phone', '(604) 555-1234');
    // Invoke the real validator directly so we don't trigger the payment flow.
    const valid = await page.evaluate(() => validateCheckoutForm());
    expect(valid).toBe(false);
    await expect(page.locator('#form-error-announce')).toContainText(/email/i, { timeout: 3000 });
  });

  test('email validation — valid email passes', async ({ page }) => {
    await page.fill('#res-name', 'Test User');
    await page.fill('#res-email', 'valid@example.com');
    await page.fill('#res-phone', '(604) 555-1234');
    const valid = await page.evaluate(() => validateCheckoutForm());
    expect(valid).toBe(true);
    await expect(page.locator('#form-error-announce')).not.toContainText(/email/i);
  });

  test('phone formats automatically on input', async ({ page }) => {
    const phoneInput = page.locator('#res-phone');
    await phoneInput.fill('6045551234');
    // The input handler reformats as (604) 555-1234
    await expect(phoneInput).toHaveValue('(604) 555-1234', { timeout: 2000 });
  });
});
