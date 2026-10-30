import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const directory = "artifacts/halloween";
test("seasonal scenes respect navigation, hit areas and reduced motion", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /hydration|didn't match/i.test(message.text())) errors.push(message.text()); });
  await mkdir(directory, { recursive: true });
  await page.clock.install({ time: new Date() });
  await page.goto("/?halloween=on");
  await page.clock.runFor(250);
  if (await page.locator(".initial-loading").isVisible()) {
    await page.screenshot({ animations: "disabled", path: `${directory}/${info.project.name}-loading.png` });
  }
  await page.clock.runFor(1400);
  await expect(page.locator(".halloween-scene--hero")).toBeVisible();
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await expect(page.locator(".report-card--skeleton")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `${directory}/${info.project.name}-home.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".home-hero__action")).toBeVisible();
  await page.locator(".home-hero__action").click();
  await expect(page).toHaveURL(/reports\/new/);
  await page.goto("/calendar?halloween=on");
  await page.clock.runFor(1600);
  await expect(page.locator(".halloween-scene--header")).toBeVisible();
  await page.screenshot({ animations: "disabled", path: `${directory}/${info.project.name}-calendar.png`, fullPage: true });
  if (info.project.name === "desktop") {
    await page.getByRole("button", {name:"メニューを閉じる",exact:true}).click();
    await page.screenshot({ animations: "disabled", path: `${directory}/desktop-collapsed.png` });
    await page.getByRole("link", {name:"Hanabi Log ホーム",exact:true}).click();
    await expect(page).toHaveURL("/");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator(".halloween-wing").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await page.goto("/?halloween=off");
  await page.clock.runFor(1600);
  await expect(page.locator(".halloween-scene")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: `${directory}/${info.project.name}-normal.png` });
  await page.goto("/?bingo=1&halloween=on");
  await page.clock.runFor(1600);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.getByRole("dialog").evaluate(el => getComputedStyle(el).borderRadius)).toBe("2px");
  await page.screenshot({ animations: "disabled", path: `${directory}/${info.project.name}-bingo.png` });
  expect(errors).toEqual([]);
});
test("theme expires at JST midnight on an open page", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-31T14:59:55Z") });
  await page.goto("/archive");
  await page.clock.runFor(1200);
  await expect(page.locator(".halloween-scene--header")).toBeVisible();
  await page.clock.runFor(6000);
  await expect(page.locator(".halloween-scene")).toHaveCount(0);
});
