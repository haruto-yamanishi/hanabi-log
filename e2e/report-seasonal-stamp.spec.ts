import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("report-date stamp survives the season and excludes other dates", async ({ page, request }, info) => {
  const list = await (await request.get("/api/reports?status=published&limit=1")).json();
  const id = list.reports[0].id;
  let reportDate = "2026-10-30";
  await page.route(`**/api/reports/${id}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), reportDate } });
  });
  await page.clock.setFixedTime(new Date("2026-11-15T03:00:00Z"));
  await page.goto(`/reports/${id}`);
  await expect(page.getByRole("img", { name: "ハロウィン期間の日報" })).toBeVisible();
  await expect(page.locator(".seasonal-root")).toHaveAttribute("data-halloween", "false");
  await expect(page.locator(".halloween-scene--brand")).toHaveCount(0);
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await mkdir("artifacts/halloween", { recursive: true });
  await page.screenshot({ path: `artifacts/halloween/${info.project.name}-permanent-stamp.png`, animations: "disabled", fullPage: true });
  reportDate = "2026-11-01";
  await page.reload();
  await expect(page.locator(".report-article")).toBeVisible();
  await expect(page.locator(".report-seasonal-stamp")).toHaveCount(0);
  await page.goto(`/reports/${id}?halloween=on`);
  await expect(page.locator(".seasonal-root")).toHaveAttribute("data-halloween", "true");
  await expect(page.locator(".report-article")).toBeVisible();
  await expect(page.locator(".report-seasonal-stamp")).toHaveCount(0);
});
