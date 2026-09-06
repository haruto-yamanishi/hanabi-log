import { expect, type Page } from "@playwright/test";

/** Wait for hydration before filling server-rendered, controlled inputs. */
export async function openPage(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator(".initial-loading")).toHaveCount(0, { timeout: 15000 });
}
