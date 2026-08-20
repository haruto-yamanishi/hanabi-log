import type { DeliveryStatus } from "@/lib/constants";
import type { IntegrationBinding } from "@/lib/types";
import { CheckIcon, ClockIcon, ExternalLinkIcon, RefreshIcon } from "@/components/icons";

const statusCopy: Record<DeliveryStatus, { label: string; description: string; tone: string }> = {
  pending: { label: "同期待ち", description: "まもなく処理を開始します", tone: "pending" },
  processing: { label: "同期中", description: "外部サービスへ反映しています", tone: "pending" },
  delivered: { label: "同期済み", description: "最新の内容が反映されています", tone: "success" },
  partial: { label: "一部同期", description: "本文は同期済みです。画像を再試行します", tone: "warning" },
  failed: { label: "再試行待ち", description: "日報は保存済みです。自動で再試行します", tone: "warning" },
  dead: { label: "要確認", description: "日報は保存済みです。管理者が再試行します", tone: "error" },
};

function IntegrationItem({ name, status, href, mark }: { name: string; status: DeliveryStatus; href?: string | null; mark: string }) {
  const copy = statusCopy[status];
  const StatusIcon = status === "delivered" ? CheckIcon : status === "pending" || status === "processing" ? ClockIcon : RefreshIcon;
  return (
    <div className="sync-status__item">
      <span aria-hidden="true" className={`integration-logo integration-logo--${name.toLowerCase()}`}>{mark}</span>
      <div className="sync-status__copy">
        <strong>{name}</strong>
        <span>{copy.description}</span>
      </div>
      <span className={`sync-pill sync-pill--${copy.tone}`}><StatusIcon />{copy.label}</span>
      {href ? <a aria-label={`${name}で開く`} className="icon-link" href={href} rel="noreferrer" target="_blank"><ExternalLinkIcon /></a> : null}
    </div>
  );
}

export function SyncStatusPanel({ integration }: { integration?: IntegrationBinding | null }) {
  if (!integration) {
    return (
      <aside aria-label="外部サービス同期状態" className="sync-status">
        <div className="sync-status__heading"><div><ClockIcon /><h2>外部サービスへ同期中</h2></div><p>日報本文はWebアプリへ保存されています。</p></div>
        <IntegrationItem mark="S" name="Slack" status="pending" />
        <IntegrationItem mark="N" name="Notion" status="pending" />
      </aside>
    );
  }

  return (
    <aside aria-label="外部サービス同期状態" className="sync-status">
      <div className="sync-status__heading"><div><RefreshIcon /><h2>同期状態</h2></div><p>SlackとNotionはそれぞれ独立して同期されます。</p></div>
      <IntegrationItem href={integration.slackPermalink} mark="S" name="Slack" status={integration.slackStatus} />
      <IntegrationItem href={integration.notionPageUrl} mark="N" name="Notion" status={integration.notionStatus} />
    </aside>
  );
}
