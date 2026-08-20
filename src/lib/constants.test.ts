import { describe, expect, it } from "vitest";

import { ACTIVITY_AREAS } from "@/lib/constants";

describe("activity areas", () => {
  it("uses the current team names and specified order", () => {
    expect(ACTIVITY_AREAS).toEqual([
      "ロボット",
      "アワード",
      "アウトリーチ",
      "ブランディング",
      "ファンドレイジング",
      "事務局",
      "その他",
    ]);
    expect(ACTIVITY_AREAS).not.toContain("チーム運営");
    expect(ACTIVITY_AREAS).not.toContain("資金調達・スポンサー");
  });
});
