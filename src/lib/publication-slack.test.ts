import { describe, expect, it } from "vitest";
import type { InputBlock } from "@slack/types";
import type { PublicationRequest } from "./publication";
import type { CurrentUser } from "./types";
import { publicationActionFromModal, publicationModal, publicationModalSchema, type SlackInputValues } from "./publication-slack";
const author: CurrentUser = { id: "author", slackUserId: "UAUTHOR", displayName: "Author", role: "member", isActive: true };
const base: PublicationRequest = { id: "10000000-0000-4000-8000-000000000001", reportId: "report", authorId: "author", requesterId: "media", authorName: "Author", requesterName: "Editor", title: "Title", reportVersion: 1, sourceBody: "original", sourceMedia: [], channels: ["note"], otherChannel: "", message: "", status: "pending", authorBody: "", correctionNote: "", draftBody: "", draftUrl: "", reviewNote: "", version: 1, createdAt: "", updatedAt: "", history: [] };
describe("publication Slack forms", () => {
  it("preserves all 30,000 characters, including emoji at input boundaries", () => {
    const body = ("a".repeat(2999) + "🔥").repeat(10).slice(0, 30000);
    const modal = publicationModal({ ...base, sourceBody: body }, author, "self_edit");
    const values: SlackInputValues = {};
    for (const block of modal.blocks.filter(block => block.type === "input") as InputBlock[]) {
      if (block.element.type !== "plain_text_input") continue;
      expect(block.element.initial_value!.length).toBeLessThanOrEqual(3000);
      values[block.block_id!] = { value: { value: block.element.initial_value } };
    }
    const result = publicationActionFromModal(publicationModalSchema.parse(JSON.parse(modal.private_metadata!)), values);
    expect(result).toMatchObject({ action: "respond", decision: "self_edit", body });
  });
  it("keeps field identifiers when adding continuation fields", () => {
    const initial = publicationModal(base, author, "self_edit");
    const more = publicationModal(base, author, "self_edit", 2);
    const ids = (modal: typeof more) => modal.blocks.filter(block => block.type === "input").map(block => block.block_id);
    expect(ids(initial)).toEqual(["body_0"]);
    expect(ids(more)).toEqual(["body_0", "body_1"]);
  });
  it("does not offer author decisions to an admin who did not write the report", () => {
    const modal = publicationModal(base, { ...author, id: "admin", role: "admin" }, "original");
    expect(modal.submit).toBeUndefined();
    expect(modal.blocks.some(block => block.type === "actions")).toBe(false);
  });
  it("shows current state when an old reply button is used", () => {
    const modal = publicationModal({ ...base, status: "approved", version: 2 }, author, "original");
    expect(modal.submit).toBeUndefined();
    expect(JSON.stringify(modal.blocks)).toContain("掲載許可済み");
  });
  it("validates URLs and requires correction instructions", () => {
    const metadata = { id: base.id, version: 2, intent: "submit_draft" as const, bodyParts: 1 };
    expect(() => publicationActionFromModal(metadata, { body_0: { value: { value: "draft" } }, url: { value: { value: "javascript:alert(1)" } } })).toThrow();
    expect(() => publicationActionFromModal({ ...metadata, intent: "request_edit" }, {})).toThrow();
  });
});
