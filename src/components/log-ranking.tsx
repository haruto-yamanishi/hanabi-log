import Link from "next/link";
import type { LogRanking, LogRankingEntry } from "@/lib/types";
import { Avatar } from "@/components/ui";

export function LogRankingCard({ ranking }: { ranking: LogRanking | null }) {
  if (!ranking) return null;
  return <section className="log-ranking" aria-labelledby="log-ranking-heading">
    <div className="section-heading"><div><p>LOG RANKING</p><h2 id="log-ranking-heading">#{ranking.rank} <span>/ {ranking.memberCount}</span></h2></div><strong>{ranking.score}<small>pt</small></strong></div>
    <dl><div><dt>公開日報</dt><dd>{ranking.publishedReports}</dd></div><div><dt>いいね</dt><dd>{ranking.likesReceived}</dd></div><div><dt>もらったコメント</dt><dd>{ranking.commentsReceived}</dd></div><div><dt>したコメント</dt><dd>{ranking.commentsMade}</dd></div><div><dt>連続活動</dt><dd>{ranking.currentStreak}<small>日</small></dd></div></dl>
  </section>;
}

export function LogRankingList({ entries }: { entries: LogRankingEntry[] }) {
  return <ol className="ranking-list">{entries.map(({ member, ranking }) => <li key={member.id}><span className="ranking-list__rank">#{ranking.rank}</span><Link href={`/members/${member.id}`}><Avatar name={member.displayName} size="small" src={member.avatarUrl} /><strong>{member.displayName}</strong></Link><span>{ranking.score} pt</span></li>)}</ol>;
}
