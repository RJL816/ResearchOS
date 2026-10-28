"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listAnalysisJobs, listConversations, type AnalysisJobSummary } from "@/lib/api";
import { useRouteId } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";

export default function AnalysisQueue() {
  const projectId = useRouteId();
  const [jobs, setJobs] = useState<AnalysisJobSummary[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const load = useCallback(async () => {
    try {
      const [history, conversations] = await Promise.all([listAnalysisJobs(projectId), listConversations(projectId)]);
      setJobs(history); setNames(Object.fromEntries(conversations.map((c) => [c.id, c.title]))); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [projectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
  useEffect(() => { void load(); }, [load]);
  const pending = jobs?.filter((j) => j.pending_count > 0 || j.accepted_count > 0 || j.needs_revision_count > 0) ?? [];
  return <div className="mx-auto max-w-5xl p-6 space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-page-title">AI 审核与历史</h1><p className="mt-1 text-sm text-muted-foreground">每次分析都会保留。接受提案后，还需应用才能写入研究记录。</p></div><Button asChild><Link href={`/projects/${projectId}/conversations`}>导入研究讨论</Link></Button></div>
    <div className="flex gap-2"><Button variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>全部分析</Button><Button variant={filter === "pending" ? "default" : "outline"} onClick={() => setFilter("pending")}>待处理（{pending.length} 次分析）</Button><Button variant="ghost" onClick={() => void load()}>刷新</Button></div>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {!jobs ? <p>正在加载…</p> : (filter === "pending" ? pending : jobs).length === 0 ? <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">{filter === "pending" ? "没有待处理的分析。" : "还没有分析记录，导入讨论后即可开始。"}</p> : (filter === "pending" ? pending : jobs).map((job) => <article key={job.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"><div><h2 className="font-medium">{names[job.conversation_id] ?? "研究讨论"} · 分析 #{job.id}</h2><p className="mt-1 text-xs text-muted-foreground">{fmtDateTime(job.created_at)} · {job.status === "completed" ? `${job.pending_count} 待审 · ${job.needs_revision_count} 需修改 · ${job.accepted_count} 待应用 · ${job.applied_count} 已应用` : job.status === "failed" ? "分析失败" : "分析进行中"}</p>{job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}</div><Button asChild variant="outline"><Link href={`/analysis/${job.id}`}>{job.status === "completed" ? "进入审核" : "查看详情"}</Link></Button></article>)}
  </div>;
}
