"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ACTIVITY_AREAS, CONTENT_CATEGORIES, THEME_TAGS, type ThemeTag } from "@/lib/constants";
import { todayInJst } from "@/lib/text";
import type { Attachment, RelatedLink, Report, ReportInput } from "@/lib/types";
import { apiRequest, ClientApiError, makeIdempotencyKey } from "@/components/api-client";
import { AlertIcon, ArrowLeftIcon, CheckIcon, ImageIcon, LinkIcon, PlusIcon, XIcon } from "@/components/icons";
import { SyncStatusPanel } from "@/components/sync-status";

interface FormValues {
  reportDate: string;
  title: string;
  summary: string;
  activityArea: string;
  contentCategory: string;
  activityText: string;
  learningText: string;
  issueText: string;
  nextActionText: string;
  themeTags: ThemeTag[];
  relatedLinks: RelatedLink[];
  attachments: Attachment[];
}

interface UploadResponse {
  storagePath: string;
  signedUrl: string;
  token?: string;
}

function initialValues(report?: Report): FormValues {
  return {
    reportDate: report?.reportDate || todayInJst(),
    title: report?.title || "",
    summary: report?.summary || "",
    activityArea: report?.activityArea || "",
    contentCategory: report?.contentCategory || "",
    activityText: report?.activityText || "",
    learningText: report?.learningText || "",
    issueText: report?.issueText || "",
    nextActionText: report?.nextActionText || "",
    themeTags: report?.themeTags || [],
    relatedLinks: report?.relatedLinks || [],
    attachments: report?.attachments || [],
  };
}

function normalizeFields(fields?: Record<string, string>): Record<string, string> {
  if (!fields) return {};
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key.replace(/^report\./, ""), value]));
}

function inputPayload(values: FormValues): ReportInput {
  return {
    reportDate: values.reportDate,
    title: values.title.trim(),
    summary: values.summary.trim(),
    activityArea: values.activityArea as ReportInput["activityArea"],
    contentCategory: values.contentCategory as ReportInput["contentCategory"],
    activityText: values.activityText.trim(),
    learningText: values.learningText.trim(),
    issueText: values.issueText.trim(),
    nextActionText: values.nextActionText.trim(),
    themeTags: values.themeTags,
    relatedLinks: values.relatedLinks.map((link, index) => ({ ...link, label: link.label.trim(), url: link.url.trim(), sortOrder: index })),
    attachments: values.attachments.map((attachment, index) => ({ ...attachment, sortOrder: index })),
  };
}

export function ReportForm({
  report: initialReport,
  initialNotice,
}: {
  report?: Report;
  initialNotice?: string;
}) {
  const router = useRouter();
  const [report, setReport] = useState(initialReport);
  const [values, setValues] = useState<FormValues>(() => initialValues(initialReport));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const createKey = useRef(makeIdempotencyKey("create-report"));
  const publishKey = useRef(makeIdempotencyKey("publish-report"));

  const isPublished = report?.status === "published";
  const isArchived = report?.status === "archived";
  const totalImageSize = useMemo(() => values.attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0), [values.attachments]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: "" }));
  }

  function toggleTag(tag: ThemeTag) {
    if (values.themeTags.includes(tag)) {
      update("themeTags", values.themeTags.filter((item) => item !== tag));
    } else if (values.themeTags.length < 5) {
      update("themeTags", [...values.themeTags, tag]);
    }
  }

  function addLink() {
    if (values.relatedLinks.length >= 5) return;
    update("relatedLinks", [...values.relatedLinks, { label: "", url: "", sortOrder: values.relatedLinks.length }]);
  }

  function updateLink(index: number, field: "label" | "url", value: string) {
    update("relatedLinks", values.relatedLinks.map((link, linkIndex) => linkIndex === index ? { ...link, [field]: value } : link));
  }

  function removeLink(index: number) {
    update("relatedLinks", values.relatedLinks.filter((_, linkIndex) => linkIndex !== index));
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setGlobalError(null);

    const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (invalid) {
      setErrors((current) => ({ ...current, attachments: "JPEG、PNG、WebP形式の画像を選んでください" }));
      return;
    }
    if (files.some((file) => file.size > 5 * 1024 * 1024)) {
      setErrors((current) => ({ ...current, attachments: "画像は1件5MiB以内にしてください" }));
      return;
    }
    if (totalImageSize + files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) {
      setErrors((current) => ({ ...current, attachments: "画像は合計10MiB以内にしてください" }));
      return;
    }

    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of files) {
        const signed = await apiRequest<UploadResponse>("/api/uploads", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
        });
        const uploadResponse = await fetch(signed.signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!uploadResponse.ok) throw new Error(`${file.name}をアップロードできませんでした`);
        uploaded.push({
          storagePath: signed.storagePath,
          filename: file.name,
          mimeType: file.type as Attachment["mimeType"],
          sizeBytes: file.size,
          altText: "",
          sortOrder: values.attachments.length + uploaded.length,
        });
      }
      update("attachments", [...values.attachments, ...uploaded]);
      setErrors((current) => ({ ...current, attachments: "" }));
    } catch (cause) {
      setErrors((current) => ({ ...current, attachments: cause instanceof Error ? cause.message : "画像をアップロードできませんでした" }));
    } finally {
      setUploading(false);
    }
  }

  function updateAttachmentAlt(index: number, altText: string) {
    update("attachments", values.attachments.map((attachment, attachmentIndex) => attachmentIndex === index ? { ...attachment, altText } : attachment));
  }

  function removeAttachment(index: number) {
    update("attachments", values.attachments.filter((_, attachmentIndex) => attachmentIndex !== index));
  }

  function basicClientValidation(): Record<string, string> {
    const next: Record<string, string> = {};
    if (Array.from(values.title.trim()).length > 60) next.title = "60文字以内で入力してください";
    if (!values.activityArea) next.activityArea = "活動領域を選択してください";
    if (!values.contentCategory) next.contentCategory = "内容カテゴリを選択してください";
    if (!values.activityText.trim()) next.activityText = "今日やったことを入力してください";
    if (values.reportDate > todayInJst()) next.reportDate = "未来の日付は選べません";
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === "publish" ? "publish" : "draft";
    const validationErrors = basicClientValidation();
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      setGlobalError("入力が必要な項目があります。内容を確認してください。");
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    setBusy(intent);
    setGlobalError(null);
    setNotice(null);
    setErrors({});
    try {
      const payload = inputPayload(values);
      const saved = report
        ? await apiRequest<Report>(`/api/reports/${report.id}`, {
            method: "PATCH",
            body: JSON.stringify({ version: report.version, report: payload }),
          })
        : await apiRequest<Report>("/api/reports", {
            method: "POST",
            headers: { "Idempotency-Key": createKey.current },
            body: JSON.stringify(payload),
          });

      let finalReport = saved;
      if (intent === "publish" && saved.status !== "published") {
        finalReport = await apiRequest<Report>(`/api/reports/${saved.id}/publish`, {
          method: "POST",
          headers: { "Idempotency-Key": publishKey.current },
        });
      }
      setReport(finalReport);
      if (intent === "publish" || finalReport.status === "published") {
        router.push(`/reports/${finalReport.id}?${intent === "publish" ? "published=1" : "updated=1"}`);
      } else {
        setNotice("下書きを保存しました。外部サービスには配信されていません。");
        createKey.current = makeIdempotencyKey("create-report");
        router.replace(`/reports/${finalReport.id}/edit?saved=1`);
      }
    } catch (cause) {
      if (cause instanceof ClientApiError) {
        setErrors(normalizeFields(cause.fields));
        setGlobalError(cause.code === "VERSION_CONFLICT" ? "別の場所で日報が更新されました。入力内容をコピーしてから、ページを再読み込みしてください。" : cause.message);
      } else {
        setGlobalError(cause instanceof Error ? cause.message : "日報を保存できませんでした");
      }
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  const inputError = (name: keyof FormValues) => errors[name] ? `${name}-error` : undefined;

  return (
    <form className="report-form" noValidate onSubmit={submit}>
      <header className="form-header">
        <div>
          <Link className="back-link" href={report ? `/reports/${report.id}` : "/"}><ArrowLeftIcon />戻る</Link>
          <h1>{report ? "日報を編集" : "今日を記録する"}</h1>
          <p>{report ? "変更した内容は、公開済みなら同じSlack投稿とNotionページへ反映されます。" : "必須項目は4つ。まずは今日やったことを短く残しましょう。"}</p>
        </div>
        {report ? <span className={`status-badge status-badge--${report.status}`}>{report.status === "draft" ? "下書き" : report.status === "published" ? "公開済み" : "アーカイブ"}</span> : null}
      </header>

      {notice ? <div aria-live="polite" className="notice-banner"><CheckIcon />{notice}</div> : null}
      {globalError ? (
        <div className="error-summary" ref={errorSummaryRef} role="alert" tabIndex={-1}>
          <AlertIcon /><div><strong>保存できませんでした</strong><p>{globalError}</p>{Object.values(errors).filter(Boolean).length ? <ul>{Object.values(errors).filter(Boolean).map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul> : null}</div>
        </div>
      ) : null}
      {isArchived ? <div className="archived-banner"><AlertIcon /><p><strong>この日報はアーカイブされています</strong><span>編集するにはAdminが公開状態へ復元する必要があります。</span></p></div> : null}

      <div className="form-layout">
        <div className="form-main">
          <section aria-labelledby="required-heading" className="form-card form-card--required">
            <div className="form-section-heading"><span>01</span><div><h2 id="required-heading">まず、今日の活動</h2><p>チームが一覧で見つけやすい情報です。</p></div></div>
            <div className="field">
              <div className="field__label"><label htmlFor="title">タイトル<span className="optional-mark">任意</span></label><span className={values.title.length > 60 ? "counter counter--error" : "counter"}>{Array.from(values.title).length} / 60</span></div>
              <input aria-describedby={inputError("title") || "title-help"} aria-invalid={Boolean(errors.title)} autoComplete="off" id="title" maxLength={60} onChange={(event) => update("title", event.target.value)} placeholder="例：駆動系のギア比を見直した" value={values.title} />
              {errors.title ? <p className="field-error" id="title-error">{errors.title}</p> : <p className="field-help" id="title-help">空欄なら「あなたの名前の雑多な日報」で保存します。</p>}
            </div>
            <div className="field-grid field-grid--three">
              <div className="field">
                <label htmlFor="reportDate">日付<span className="required-mark">必須</span></label>
                <input aria-describedby={inputError("reportDate")} aria-invalid={Boolean(errors.reportDate)} id="reportDate" max={todayInJst()} onChange={(event) => update("reportDate", event.target.value)} required type="date" value={values.reportDate} />
                {errors.reportDate ? <p className="field-error" id="reportDate-error">{errors.reportDate}</p> : null}
              </div>
              <div className="field">
                <label htmlFor="activityArea">活動領域<span className="required-mark">必須</span></label>
                <select aria-describedby={inputError("activityArea")} aria-invalid={Boolean(errors.activityArea)} id="activityArea" onChange={(event) => update("activityArea", event.target.value)} value={values.activityArea}>
                  <option value="">選択してください</option>
                  {ACTIVITY_AREAS.map((area) => <option key={area}>{area}</option>)}
                </select>
                {errors.activityArea ? <p className="field-error" id="activityArea-error">{errors.activityArea}</p> : null}
              </div>
              <div className="field">
                <label htmlFor="contentCategory">内容カテゴリ<span className="required-mark">必須</span></label>
                <select aria-describedby={inputError("contentCategory")} aria-invalid={Boolean(errors.contentCategory)} id="contentCategory" onChange={(event) => update("contentCategory", event.target.value)} value={values.contentCategory}>
                  <option value="">選択してください</option>
                  {CONTENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                </select>
                {errors.contentCategory ? <p className="field-error" id="contentCategory-error">{errors.contentCategory}</p> : null}
              </div>
            </div>
            <div className="field">
              <div className="field__label"><label htmlFor="activityText">今日やったこと<span className="required-mark">必須</span></label><span className="counter">{values.activityText.length.toLocaleString()} / 10,000</span></div>
              <textarea aria-describedby={inputError("activityText")} aria-invalid={Boolean(errors.activityText)} id="activityText" maxLength={10000} onChange={(event) => update("activityText", event.target.value)} placeholder="作業したこと、話したこと、決めたことをそのまま書いてOKです。" rows={8} value={values.activityText} />
              {errors.activityText ? <p className="field-error" id="activityText-error">{errors.activityText}</p> : <p className="field-help">箇条書きでも大丈夫です。未入力の要約には、この文章の先頭100文字が使われます。</p>}
            </div>
          </section>

          <section aria-labelledby="detail-heading" className="form-card">
            <div className="form-section-heading"><span>02</span><div><h2 id="detail-heading">もう少し詳しく残す</h2><p>任意項目。未来のメンバーが判断を再現しやすくなります。</p></div></div>
            <div className="field">
              <div className="field__label"><label htmlFor="summary">要約<span className="optional-mark">任意</span></label><span className="counter">{values.summary.length} / 100</span></div>
              <textarea id="summary" maxLength={100} onChange={(event) => update("summary", event.target.value)} placeholder="空欄なら「今日やったこと」から自動で作成します" rows={2} value={values.summary} />
            </div>
            <fieldset className="field fieldset-reset">
              <div className="field__label"><legend>テーマタグ<span className="optional-mark">任意</span></legend><span className="counter">{values.themeTags.length} / 5</span></div>
              <div className="tag-picker">
                {THEME_TAGS.map((tag) => <button aria-pressed={values.themeTags.includes(tag)} className="tag-option" disabled={!values.themeTags.includes(tag) && values.themeTags.length >= 5} key={tag} onClick={() => toggleTag(tag)} type="button">{values.themeTags.includes(tag) ? <CheckIcon /> : null}#{tag}</button>)}
              </div>
            </fieldset>
            <div className="field">
              <div className="field__label"><label htmlFor="learningText">判断・学び<span className="optional-mark">任意</span></label><span className="counter">{values.learningText.length.toLocaleString()} / 5,000</span></div>
              <textarea id="learningText" maxLength={5000} onChange={(event) => update("learningText", event.target.value)} placeholder="なぜそう判断した？ 次も使えそうな気づきは？" rows={5} value={values.learningText} />
            </div>
            <div className="field">
              <div className="field__label"><label htmlFor="issueText">課題・相談<span className="optional-mark">任意</span></label><span className="counter">{values.issueText.length.toLocaleString()} / 5,000</span></div>
              <textarea id="issueText" maxLength={5000} onChange={(event) => update("issueText", event.target.value)} placeholder="困っていること、チームに聞きたいこと" rows={5} value={values.issueText} />
            </div>
            <div className="field">
              <div className="field__label"><label htmlFor="nextActionText">次のアクション<span className="optional-mark">任意</span></label><span className="counter">{values.nextActionText.length.toLocaleString()} / 5,000</span></div>
              <textarea id="nextActionText" maxLength={5000} onChange={(event) => update("nextActionText", event.target.value)} placeholder="次に試すこと、続きを始めるときの一歩" rows={4} value={values.nextActionText} />
            </div>
          </section>

          <section aria-labelledby="media-heading" className="form-card">
            <div className="form-section-heading"><span>03</span><div><h2 id="media-heading">画像と関連リンク</h2><p>設計資料や作業中の写真を一緒に残せます。</p></div></div>
            <div className="field">
              <div className="field__label"><span className="label-like">画像<span className="optional-mark">任意</span></span><span className="counter">{(totalImageSize / 1024 / 1024).toFixed(1)} / 10 MiB</span></div>
              <label className={`upload-zone${uploading ? " upload-zone--busy" : ""}`}>
                <input accept="image/jpeg,image/png,image/webp" disabled={uploading || totalImageSize >= 10 * 1024 * 1024} multiple onChange={(event) => void uploadImages(event)} type="file" />
                <span className="upload-zone__icon"><ImageIcon /></span>
                <span><strong>{uploading ? "アップロードしています…" : "画像を選ぶ"}</strong><small>JPEG・PNG・WebP / 1件5MiB、合計10MiBまで</small></span>
              </label>
              {errors.attachments ? <p className="field-error">{errors.attachments}</p> : null}
              {values.attachments.length ? <div className="attachment-list">{values.attachments.map((attachment, index) => (
                <div className="attachment-item" key={`${attachment.storagePath}-${index}`}>
                  <span className="attachment-item__thumb"><ImageIcon /></span>
                  <div className="attachment-item__body"><div><strong>{attachment.filename}</strong><small>{(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MiB</small></div><label><span>画像の説明</span><input maxLength={300} onChange={(event) => updateAttachmentAlt(index, event.target.value)} placeholder="例：組み立て後の駆動系" value={attachment.altText || ""} /></label></div>
                  <button aria-label={`${attachment.filename}を削除`} className="icon-button" onClick={() => removeAttachment(index)} type="button"><XIcon /></button>
                </div>
              ))}</div> : null}
            </div>

            <div className="field">
              <div className="field__label"><span className="label-like">関連リンク<span className="optional-mark">任意</span></span><span className="counter">{values.relatedLinks.length} / 5</span></div>
              {values.relatedLinks.length ? <div className="related-link-list">{values.relatedLinks.map((link, index) => (
                <div className="related-link-row" key={link.id || index}>
                  <span className="related-link-row__icon"><LinkIcon /></span>
                  <label><span className="sr-only">リンク{index + 1}の表示名</span><input maxLength={100} onChange={(event) => updateLink(index, "label", event.target.value)} placeholder="表示名（例：CADデータ）" required value={link.label} /></label>
                  <label><span className="sr-only">リンク{index + 1}のURL</span><input onChange={(event) => updateLink(index, "url", event.target.value)} pattern="https://.*" placeholder="https://..." required type="url" value={link.url} /></label>
                  <button aria-label={`リンク${index + 1}を削除`} className="icon-button" onClick={() => removeLink(index)} type="button"><XIcon /></button>
                </div>
              ))}</div> : null}
              <button className="button button--ghost button--small" disabled={values.relatedLinks.length >= 5} onClick={addLink} type="button"><PlusIcon />リンクを追加</button>
            </div>
          </section>
        </div>

        <aside className="form-aside">
          <div className="form-guide">
            <h2>公開すると</h2>
            <ol><li><span>1</span><p><strong>Webへ保存</strong><small>まず本文を確実に保存します</small></p></li><li><span>2</span><p><strong>Slackへ投稿</strong><small>タイトルと要約をカードで共有</small></p></li><li><span>3</span><p><strong>Notionへ同期</strong><small>長く使える知識として整理</small></p></li></ol>
            <p className="form-guide__note">外部サービスに障害があっても、日報は失われません。</p>
          </div>
          {isPublished ? <SyncStatusPanel integration={report?.integration} /> : null}
        </aside>
      </div>

      <footer className="form-actions">
        <p aria-live="polite">{busy ? busy === "publish" ? "日報を公開しています…" : "下書きを保存しています…" : isPublished ? "保存すると公開先にも変更が反映されます" : "下書きはSlack・Notionへ配信されません"}</p>
        <div>
          {!isPublished ? <button className="button button--secondary" disabled={Boolean(busy) || uploading || isArchived} name="intent" type="submit" value="draft">{busy === "draft" ? <span className="button-spinner" /> : null}{busy === "draft" ? "保存中…" : "下書き保存"}</button> : null}
          <button className="button button--primary" disabled={Boolean(busy) || uploading || isArchived} name="intent" type="submit" value={isPublished ? "draft" : "publish"}>{busy ? <span className="button-spinner" /> : null}{busy ? "保存中…" : isPublished ? "変更を保存" : "公開する"}</button>
        </div>
      </footer>
    </form>
  );
}
