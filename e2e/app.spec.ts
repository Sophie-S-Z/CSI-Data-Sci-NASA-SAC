import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Jump to a demo step by its button on the time track. */
async function step(page: Page, n: number, label: string) {
  await page.getByRole('button', { name: `Step ${n}: ${label}` }).click();
}

/** Open a view from the sidebar (desktop) or the More menu (phone). */
async function open(page: Page, name: string) {
  const link = page.getByRole('button', { name, exact: true }).first();
  if (await link.isVisible()) return link.click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
  const found = r.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}${n.any[0]?.message ? ` (${n.any[0].message})` : ''}`));
  expect(found).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Vigil/);
  await expect(page.getByRole('button', { name: 'Step 1: Solar flare' })).toBeVisible();
});

test('the Warning step opens the shelter procedure', async ({ page }) => {
  await step(page, 4, 'Warning');
  const start = page.getByRole('button', { name: /Start procedure SH-1/ }).first();
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByText('Mark as done').first()).toBeVisible();
});

test('the Leave shelter step shows a Caution, not a Warning', async ({ page }) => {
  await step(page, 6, 'Leave shelter');
  await expect(page.getByText('Caution. The Warning is over. You can leave the shelter.').first()).toBeAttached();
  await expect(page.getByRole('button', { name: 'Start procedure SH-1' })).toHaveCount(0);
});

test('the note reader ends a negation at a comma', async ({ page }) => {
  await open(page, 'Health check');
  await page.getByLabel('Note (optional)').fill('Not sleeping well, headache all day');
  await expect(page.getByRole('button', { name: 'Mark Headache' })).toBeVisible();
});

test('voice input shows the words as it hears them, then fills the field', async ({ page }) => {
  // A stand-in for the browser speech API: it hears speech, gives a partial result, then a final one.
  await page.addInitScript(() => {
    class FakeRecognition {
      onspeechstart?: () => void;
      onresult?: (e: unknown) => void;
      onend?: () => void;
      start() {
        const result = (transcript: string, isFinal: boolean) => ({ results: [Object.assign([{ transcript }], { isFinal })] });
        setTimeout(() => this.onspeechstart?.(), 50);
        setTimeout(() => this.onresult?.(result('headache since', false)), 100);
        setTimeout(() => this.onresult?.(result('headache since lunch', true)), 1500);
        setTimeout(() => this.onend?.(), 1600);
      }
      stop() { this.onend?.(); }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition });
  });
  await page.reload();
  await open(page, 'Health check');
  await page.getByRole('button', { name: 'Speak your note' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'headache since' })).toBeVisible();
  await expect(page.getByLabel('Note (optional)')).toHaveValue('headache since lunch');
  await expect(page.getByRole('status').filter({ hasText: 'headache since' })).toHaveCount(0);
});

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  test('Mission replay at the Warning', async ({ page }) => {
    await step(page, 4, 'Warning');
    await axe(page);
  });
  for (const view of ['Cabin radiation', 'Space weather', 'Ask AI', 'Health check', 'Body', 'Daily report', 'Limits explorer', 'Measured events', 'Research', 'Rules and sources']) {
    test(view, async ({ page }) => {
      if (['Measured events', 'Research', 'Rules and sources'].includes(view)) await page.getByRole('tab', { name: /Real/ }).first().click();
      if (view !== 'Measured events') await open(page, view);
      await expect(page.getByRole('heading', { level: 1, name: view })).toBeVisible();
      await axe(page);
    });
  }
});
