import { test, expect, type BrowserContext } from "@playwright/test";
import type { BingoSnapshot, BingoAction } from "../src/lib/bingo";

function mockGame() {
  const state: BingoSnapshot = {
    serverTime: new Date().toISOString(), canHost: false,
    game: { status: "waiting", rule: "report-support", startedAt: null, cardCount: 2 },
    card: { cells: Array.from({ length: 25 }, (_, i) => i === 12 ? 0 : i % 5 * 15 + Math.floor(i / 5) + 1), reportCount: 3 },
    draws: [], winners: [], entries: [{ member_id: "one", display_name: "参加メンバー", qualified_at: "2026-10-30T01:00:00Z" }],
  };
  return state;
}
async function routeGame(context: BrowserContext, state: BingoSnapshot, canHost: boolean) {
  await context.route("**/api/bingo", async route => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON() as BingoAction;
      if (!canHost) return route.fulfill({ status: 403, json: { error: { message: "主催者のみ" } } });
      if (action.action === "start") { state.game.status = "live"; state.game.rule = action.rule; state.game.startedAt = new Date().toISOString(); }
      if (action.action === "draw") state.draws.push({ sequence: 1, number: 1, animationAt: new Date(Date.now() + 2000).toISOString(), revealAt: new Date(Date.now() + 6500).toISOString() });
      if (action.action === "finish") state.game.status = "finished";
    }
    await route.fulfill({ json: { ...state, canHost, serverTime: new Date().toISOString(), draws: state.draws.map(draw => ({ ...draw, number: Date.now() < Date.parse(draw.revealAt) ? null : draw.number })) } });
  });
}
test("badge opens a persistent 5×5 card with a free center", async ({ page, context }) => {
  const state = mockGame(); await routeGame(context, state, false);
  await page.goto("/calendar?bingo=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("cell")).toHaveCount(25);
  await expect(dialog.getByRole("cell", { name: "中央 FREE 開いています" })).toHaveAttribute("data-marked", "true");
  await expect(dialog.getByRole("button", { name: "ガラガラを回す" })).toHaveCount(0);
  await dialog.getByText("参加者 1人・ルール").click();
  await expect(dialog.getByText("参加メンバー", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "お土産Halloweenビンゴの参加者を見る" }).click();
  await expect(dialog).toBeVisible();
  await page.reload(); await expect(dialog.getByRole("cell")).toHaveCount(25);
});
test("host opens everyone's cards, both see the machine and the same number, reconnect preserves marks", async ({ page, context, browser }, info) => {
  test.setTimeout(60_000);
  const state = mockGame(); await routeGame(context, state, true);
  const participant = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch });
  try {
    await routeGame(participant, state, false);
    const guest = await participant.newPage();
    await page.goto("/calendar?bingo=1"); await guest.goto("/calendar");
    await expect(guest.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "全員の画面でビンゴを開始" }).click();
    await expect(guest.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "ガラガラを回す" }).click();
    for (const client of [page, guest]) await expect(client.getByTestId("bingo-machine")).toHaveAttribute("data-spinning", "true", { timeout: 6000 });
    await expect(guest.locator('[data-number="1"]')).toHaveAttribute("data-marked", "false");
    for (const client of [page, guest]) {
      await expect(client.getByTestId("bingo-number")).toHaveText("B 1", { timeout: 10_000 });
      await expect(client.locator('[data-number="1"]')).toHaveAttribute("data-marked", "true");
    }
    await guest.reload();
    await expect(guest.getByRole("dialog")).toBeVisible();
    await expect(guest.locator('[data-number="1"]')).toHaveAttribute("data-marked", "true");
    await guest.emulateMedia({ reducedMotion: "reduce" });
    expect(await guest.locator('[data-number="1"]').evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    await page.getByRole("dialog").evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/bingo-live-${info.project.name}.png`, fullPage: true });
  } finally { await participant.close(); }
});
