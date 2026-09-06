import { chromium } from "@playwright/test";

const baseURL = process.env.PERF_BASE_URL || "http://127.0.0.1:3008";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url())));
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.locator(".report-card").first().waitFor();
  await page.waitForTimeout(5000);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return { domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd), loadMs: Math.round(navigation.loadEventEnd) };
  });
  const list = await page.request.get(`${baseURL}/api/reports?limit=50`);
  const withIntegration = await page.request.get(`${baseURL}/api/reports?limit=50&includeIntegration=true`);
  const payload = await list.body();
  const legacyPayload = await withIntegration.body();
  const body = JSON.parse(payload.toString());
  const forbiddenFields = ["activityText", "learningText", "issueText", "nextActionText", "attachments", "relatedLinks", "integration", "likedBy"];
  if (body.reports.some((report) => forbiddenFields.some((key) => key in report))) throw new Error("Detail-only field in list");
  const detailPrefetches = requests.filter((url) => /^\/reports\/[0-9a-f-]{36}$/.test(url.pathname) && url.searchParams.has("_rsc")).length;
  if (detailPrefetches) throw new Error(`Unexpected detail prefetches: ${detailPrefetches}`);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await (await page.request.get(`${baseURL}/api/reports?limit=50`)).body();
    samples.push(Math.round((performance.now() - start) * 10) / 10);
  }
  console.log(JSON.stringify({
    ...metrics, totalRequests: requests.length, visibleCards: await page.locator(".report-card").count(),
    detailPrefetches, reports: body.reports.length,
    listBytes: payload.length, withIntegrationBytes: legacyPayload.length,
    payloadReductionPercent: Math.round((1 - payload.length / legacyPayload.length) * 1000) / 10,
    listRequestMs: samples,
  }, null, 2));
} finally { await browser.close(); }
