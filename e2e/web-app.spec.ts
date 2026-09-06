import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPage } from "./navigation";

async function installEvent(page: import("@playwright/test").Page, outcome = "dismissed") {
  await page.evaluate((result) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.installPromptCalled = "true"; },
      userChoice: Promise.resolve({ outcome: result }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

test("下書き削除はキャンセルでき、確定後は一覧・詳細・編集から消える", async ({ page }) => {
  const title = `削除 E2E ${crypto.randomUUID()}`;
  await openPage(page, "/reports/new");
  await page.getByLabel("タイトル任意").fill(title);
  await page.getByLabel("活動領域必須").selectOption({ label: "ロボット" });
  await page.getByLabel("内容カテゴリ必須").selectOption({ label: "進捗" });
  await page.getByLabel("今日やったこと必須").fill("不要な下書きを整理する。");
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/[^/]+\/edit\?saved=1$/);
  const id = new URL(page.url()).pathname.split("/")[2];
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "下書きを削除", exact: true }).click();
  expect((await page.request.get(`/api/reports/${id}`)).status()).toBe(200);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "下書きを削除", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  expect((await page.request.get(`/api/reports/${id}`)).status()).toBe(404);
  await openPage(page, `/reports/${id}/edit`);
  await expect(page.getByText("日報が見つかりません", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "下書き保存", exact: true })).toHaveCount(0);
});

test("追加案内は遅延表示し、あとでを押すと再読み込み後も控える", async ({ page }) => {
  await openPage(page, "/");
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await installEvent(page);
  await expect(page.locator(".install-card")).toHaveCount(0);
  await expect(page.locator(".install-card")).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "あとで", exact: true }).click();
  await page.reload();
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await installEvent(page);
  await page.waitForTimeout(2500);
  await expect(page.locator(".install-card")).toHaveCount(0);
});

test("正式な追加確認を呼び出し、インストール後は案内を出さない", async ({ page }) => {
  await openPage(page, "/");
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await installEvent(page, "accepted");
  await page.getByRole("button", { name: "追加する", exact: true }).click({ timeout: 8000 });
  await expect(page.locator("html")).toHaveAttribute("data-install-prompt-called", "true");
  await expect(page.locator(".install-card")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hanabi-installed"))).toBe("true");
});

test("投稿中とstandalone起動中には追加案内を出さない", async ({ page }) => {
  await openPage(page, "/reports/new");
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await installEvent(page);
  await page.waitForTimeout(2500);
  await expect(page.locator(".install-card")).toHaveCount(0);
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await openPage(page, "/");
  await expect(page.locator(".initial-loading")).toHaveCount(0);
  await installEvent(page);
  await page.waitForTimeout(2500);
  await expect(page.locator(".install-card")).toHaveCount(0);
});

test("manifest・アイコンと公開オフライン画面のキャッシュを確認する", async ({ page }) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Hanabi LOG", display: "standalone", start_url: "/", scope: "/" });
  for (const size of [180, 192, 512]) {
    const icon = await page.request.get(`/app-icon?size=${size}`);
    expect(icon.headers()["content-type"]).toContain("image/png");
    const bytes = await icon.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  await openPage(page, "/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const privateCaches = await page.evaluate(async () => {
    const entries = await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)));
    return entries.flat().filter((path) => !["/offline.html", "/offline.js"].includes(path));
  });
  expect(privateCaches).toEqual([]);
});

test("Chromiumでオフライン画面から再接続後に復帰する", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "WebKitは別テストでソケット切断による通信障害を確認する");
  await openPage(page, "/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hanabi LOGに接続できません" })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "再読み込み", exact: true }).click();
  await expect(page.locator(".home-hero")).toBeVisible();
});

test("SafariではDock追加の手順を案内する", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "Safari系エンジンで確認");
  await openPage(page, "/");
  await page.getByRole("button", { name: "追加する", exact: true }).click({ timeout: 10000 });
  await expect(page.getByRole("heading", { name: "SafariでDockに追加できます" })).toBeVisible();
  await expect(page.getByText(/「ファイル」→「Dockに追加」/)).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator(".install-card")).toHaveCount(0);
});

test.describe("同期状態の更新", () => {
  test.use({ serviceWorkers: "block" });

test("同期中の詳細を表示したまま同期済みへ更新する", async ({ page }) => {
  const reports = await (await page.request.get("/api/reports")).json();
  const id = reports.reports[0].id;
  const report = await (await page.request.get(`/api/reports/${id}`)).json();
  let calls = 0;
  await page.route(`**/api/reports/${id}`, (route) => {
    calls += 1;
    return route.fulfill({ json: { ...report, integration: { reportId: id, slackStatus: calls > 1 ? "delivered" : "pending", notionStatus: calls > 1 ? "delivered" : "pending", updatedAt: report.updatedAt } } });
  });
  await openPage(page, `/reports/${id}`);
  const panel = page.getByRole("complementary", { name: "外部サービス同期状態" });
  await expect(panel.getByText("同期待ち", { exact: true })).toHaveCount(2);
  await expect(panel.getByText("同期済み", { exact: true })).toHaveCount(2, { timeout: 9000 });
  await expect(page.getByRole("heading", { name: report.title, exact: true })).toBeVisible();
});

});


test("WebKitで実際の接続切断時にオフライン画面へ移り復帰する", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "WebKitのsetOfflineはSWより前にナビゲーションを中断するため、接続を実際に切る");
  const assets = new Map(await Promise.all(["/sw.js", "/offline.html", "/offline.js"].map(async (path) => [path, await readFile(`public${path}`)] as const)));
  let reachable = true;
  const server = createServer((request, response) => {
    if (!reachable) { request.socket.destroy(); return; }
    const path = request.url ?? "/";
    const asset = assets.get(path);
    response.setHeader("Content-Type", path.endsWith(".js") ? "application/javascript" : "text/html; charset=utf-8");
    response.end(asset ?? '<h1>接続しました</h1><script>navigator.serviceWorker.register("/sw.js")</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local test server not started");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    reachable = false;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hanabi LOGに接続できません" })).toBeVisible();
    reachable = true;
    await page.getByRole("button", { name: "再読み込み", exact: true }).click();
    await expect(page.getByRole("heading", { name: "接続しました", exact: true })).toBeVisible();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
