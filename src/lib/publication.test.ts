import { describe, expect, it } from "vitest";
import { canRequestPublication, publicationCreateSchema, publicationActionSchema, transitionPublication, type PublicationRequest } from "./publication";
import type { CurrentUser } from "./types";
const author:CurrentUser={id:"author",slackUserId:"U_AUTHOR",displayName:"Author",role:"member",isActive:true};
const media:CurrentUser={...author,id:"media",role:"media",displayName:"Editor"};
const admin:CurrentUser={...author,id:"admin",role:"admin"};
const base:PublicationRequest={id:"r",reportId:"report",authorId:author.id,requesterId:media.id,authorName:"Author",requesterName:"Editor",title:"Title",reportVersion:1,sourceBody:"original",sourceMedia:[],channels:["note"],otherChannel:"",message:"",status:"pending",authorBody:"",correctionNote:"",draftBody:"",draftUrl:"",reviewNote:"",version:1,createdAt:"2026-10-24T00:00:00Z",updatedAt:"2026-10-24T00:00:00Z",history:[]};
describe("publication consent",()=>{
  it("keeps remarks separate from correction instructions throughout review", () => {
    const response = publicationActionSchema.parse({ action: "respond", version: 1, decision: "request_edit", note: "名前を伏せる", remarks: " 掲載名はハナビ " });
    const requested = transitionPublication(base, response, author);
    expect(requested.correctionNote).toBe("名前を伏せる");
    expect(requested.history.at(-1)?.remarks).toBe("掲載名はハナビ");
    const draft = transitionPublication(requested, { action: "submit_draft", version: 2, body: "改稿", url: "" }, media);
    const reviewed = transitionPublication(draft, publicationActionSchema.parse({ action: "review", version: 3, decision: "approve", remarks: "ハナビでお願いします" }), author);
    expect(reviewed.history.at(-1)?.remarks).toBe("ハナビでお願いします");
    expect(reviewed.history[0].remarks).toBe("掲載名はハナビ");
    expect(reviewed.reviewNote).toBe("");
    expect(publicationActionSchema.safeParse({ action: "review", version: 1, decision: "revise", remarks: "備考だけ" }).success).toBe(false);
    expect(publicationActionSchema.safeParse({ action: "respond", version: 1, decision: "original", remarks: "a".repeat(2001) }).success).toBe(false);
  });
  it("accepts a prepared draft without a URL and validates optional URLs", () => {
    const input = { channels: ["X"], reportVersion: 1, draftBody: " SNS投稿文 " };
    expect(publicationCreateSchema.parse(input).draftBody).toBe("SNS投稿文");
    expect(publicationCreateSchema.parse(input).draftUrl).toBe("");
    expect(publicationCreateSchema.safeParse({ ...input, draftUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(publicationCreateSchema.safeParse({ ...input, draftBody: " ", draftUrl: "https://example.com" }).success).toBe(false);
    expect(publicationCreateSchema.safeParse({ ...input, draftBody: "a".repeat(30001) }).success).toBe(false);
    expect(publicationActionSchema.parse({ action: "submit_draft", version: 1, body: "改稿" })).toMatchObject({ url: "" });
  });
  it("validates every selected channel and builds the initial review snapshot", () => {
    const input = { channels: ["X", "その他"], otherChannel: "広報誌", reportVersion: 1, channelDrafts: [
      { channel: "その他", body: "広報誌の文章", url: "https://example.com/preview" },
      { channel: "X", body: " Xの文章 " },
    ] };
    const parsed = publicationCreateSchema.parse(input);
    expect(parsed.draftBody).toBe("【X】\nXの文章\n\n【その他（広報誌）】\n広報誌の文章\n\n確認用URL：https://example.com/preview");
    expect(publicationCreateSchema.safeParse({ ...input, channelDrafts: [input.channelDrafts[0]] }).success).toBe(false);
    expect(publicationCreateSchema.safeParse({ ...input, channelDrafts: [input.channelDrafts[0], input.channelDrafts[0]] }).success).toBe(false);
    expect(publicationCreateSchema.safeParse({ ...input, channelDrafts: [input.channelDrafts[0], { channel: "X", body: " " }] }).success).toBe(false);
    expect(publicationCreateSchema.safeParse({ ...input, draftBody: "共通本文" }).success).toBe(false);
    expect(publicationCreateSchema.safeParse({ ...input, channelDrafts: [{ channel: "X", body: "a".repeat(30000) }, input.channelDrafts[0]] }).success).toBe(false);
    expect(publicationCreateSchema.parse({ channels: ["X"], reportVersion: 1, channelDrafts: [{ channel: "X", body: "" }] }).draftBody).toBe("");
  });
  it("allows media and admin to request, without granting members permission",()=>{
    expect(canRequestPublication(author)).toBe(false);expect(canRequestPublication(media)).toBe(true);expect(canRequestPublication(admin)).toBe(true);
  });
  it("requires an explicit destination and the name of other destinations",()=>{
    expect(publicationCreateSchema.safeParse({channels:[],reportVersion:1}).success).toBe(false);
    expect(publicationCreateSchema.safeParse({channels:["その他"],reportVersion:1}).success).toBe(false);
    expect(publicationCreateSchema.parse({channels:["note","note","X"],reportVersion:1}).channels).toEqual(["note","X"]);
  });
  it("only the author can give original consent, including when an admin is involved",()=>{
    const action={action:"respond" as const,version:1,decision:"original" as const,body:"",note:""};
    for(const actor of [media,admin])expect(()=>transitionPublication(base,action,actor)).toThrow("本人だけ");
    const result=transitionPublication(base,action,author);expect(result.status).toBe("approved");expect(result.sourceBody).toBe("original");
    expect(()=>transitionPublication(result,{...action,version:2},author)).toThrow("回答済み");
    expect(()=>transitionPublication(result,action,author)).toThrow("再読み込み");
  });
  it("requires author edits or correction instructions and rejects unsafe preview URLs",()=>{
    for(const decision of ["self_edit","request_edit"])expect(publicationActionSchema.safeParse({action:"respond",version:1,decision}).success).toBe(false);
    expect(publicationActionSchema.safeParse({action:"submit_draft",version:1,body:"text",url:"javascript:alert(1)"}).success).toBe(false);
    expect(publicationActionSchema.safeParse({action:"review",version:1,decision:"revise",note:" "}).success).toBe(false);
  });
  it.each(["self_edit","request_edit"] as const)("keeps %s conditional until the exact draft is approved",decision=>{
    let current=transitionPublication(base,{action:"respond",version:1,decision,body:"author version",note:"hide names"},author);
    expect(current.status).toBe("awaiting_draft");
    const draft={action:"submit_draft" as const,version:2,body:"edited",url:"https://note.com/preview"};
    expect(()=>transitionPublication(current,draft,{...media,id:"stranger"})).toThrow("依頼した");
    current=transitionPublication(current,draft,media);expect(current.status).toBe("awaiting_review");
    expect(()=>transitionPublication(current,{action:"review",version:3,decision:"approve",note:""},admin)).toThrow("本人だけ");
    current=transitionPublication(current,{action:"review",version:3,decision:"revise",note:"remove name"},author);
    current=transitionPublication(current,{...draft,version:4,body:"final version"},admin);
    current=transitionPublication(current,{action:"review",version:5,decision:"approve",note:"OK"},author);
    expect(current.status).toBe("approved");expect(current.draftBody).toBe("final version");expect(current.history).toHaveLength(5);
    expect(current.history[1].body).toBe("edited");expect(current.sourceBody).toBe("original");
    expect(()=>transitionPublication(current,{...draft,version:6},media)).toThrow("現在は");
  });
  it("records refusal without allowing a draft to be sent",()=>{
    const result=transitionPublication(base,{action:"respond",version:1,decision:"reject",note:"",body:""},author);
    expect(result.status).toBe("rejected");
    expect(()=>transitionPublication(result,{action:"submit_draft",version:2,body:"x",url:"https://example.com"},media)).toThrow("現在は");
  });
});
