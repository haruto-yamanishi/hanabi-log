import { expect, type Page } from "@playwright/test";

/** Wait for hydration before filling server-rendered, controlled inputs. */
export async function openPage(page: Page, url: string) {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto(url);
    await expect(page.locator(".initial-loading")).toHaveCount(0, { timeout: 15000 });
    expect(errors).toEqual([]);
  } finally { page.off("pageerror", onError); }
}
