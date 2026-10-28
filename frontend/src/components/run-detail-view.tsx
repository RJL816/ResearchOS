"use client";

import Link from "next/link";
import { useRouteId } from "@/lib/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MetricChart } from "@/components/metric-chart";
import { EvidenceLinkDialog } from "@/components/evidence-link-dialog";
import { getRun, getRunMetrics, type MetricSeries, type RunDetail } from "@/lib/api";
import { getIdeaVersionDetails, listIdeas, listNotes, type Idea, type IdeaVersionDetails, type ResearchNote } from "@/lib/api";
import { RunCreateDialog } from "@/components/run-create-dialog";
import { MetricEntryDialog } from "@/components/metric-entry-dialog";
import { NoteCreateDialog } from "@/components/note-create-dialog";
import { ResearchNotes } from "@/components/research-notes";
import { fmtDateTime, fmtNumber } from "@/lib/format";

export default function RunDetailPage() {
  const runId = useRouteId();

  const [run, setRun] = useState<RunDetail | null>(null);
  const [series, setSeries] = useState<MetricSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<IdeaVersionDetails | null>(null);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);

  const load = useCallback(async () => {
    try {
      const [runDetail, metrics] = await Promise.all([getRun(runId), getRunMetrics(runId)]);
      setRun(runDetail);
      setSeries(metrics.series);
      const [allNotes, allIdeas, targetDetails] = await Promise.all([
        listNotes(runDetail.project_id), listIdeas(runDetail.project_id),
        runDetail.target_version_id ? getIdeaVersionDetails(runDetail.target_version_id) : Promise.resolve(null),
      ]);
      setNotes(allNotes.filter((n) => n.run_id === runId)); setIdeas(allIdeas); setTarget(targetDetails);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error ?? "Run 不存在"}
        </div>
      </div>
    );
  }

  const statsByName = new Map(run.metric_stats.map((s) => [s.name, s]));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          href={`/projects/${run.project_id}/experiments`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← 返回实验台
        </Link>
        {run.research_idea_id && <Link className="ml-4 text-sm text-primary underline" href={`/research-ideas/${run.research_idea_id}`}>查看所属研究 Idea</Link>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1>
          <StatusBadge kind="run" value={run.status} />
        </div>
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>
            来源 <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{run.external_source}</code>
          </span>
          <span>
            外部键 <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{run.external_key}</code>
          </span>
          <span>创建于 {fmtDateTime(run.created_at)}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <RunCreateDialog key={run.updated_at} projectId={run.project_id} run={run} onCreated={load} />
          <MetricEntryDialog runId={run.id} onSaved={load} />
          <EvidenceLinkDialog mode="run" runId={run.id} projectId={run.project_id} initialVersionId={run.target_version_id ?? undefined} onLinked={load} />
        </div>
      </div>

      <div className="mb-6 rounded-lg border p-4 space-y-2 text-sm">
        <p className="font-medium">{run.status === "planned" ? "下一步：确认实验设计，开始后更新为运行中。" : run.status === "running" ? "下一步：实验结束后更新状态，补录结果与指标。" : "下一步：根据结果关联证据，再回到假设记录判断或修订。"}</p>
        {target ? <Link className="text-primary hover:underline" href={`/ideas/${target.idea.id}`}>验证目标：{target.idea.title} · v{target.version.version_number} → 返回假设</Link> : <p className="text-muted-foreground">尚未设置验证目标，可通过「编辑实验」关联假设版本。</p>}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">实验元数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <MetaRow label="Git commit">
              {run.git_commit ? (
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                  {run.git_commit}
                </code>
              ) : (
                "—"
              )}
            </MetaRow>
            <MetaRow label="数据集">{run.dataset ?? "—"}</MetaRow>
            <MetaRow label="评估协议">{run.eval_protocol ?? "—"}</MetaRow>
            <MetaRow label="开始 / 结束">
              {fmtDateTime(run.started_at)} → {fmtDateTime(run.finished_at)}
            </MetaRow>
            {run.notes && (
              <>
                <Separator />
                <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                  {run.notes}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">参数</CardTitle>
          </CardHeader>
          <CardContent>
            {run.params ? (
              <pre className="bg-muted/60 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(run.params, null, 2)}
              </pre>
            ) : (
              <p className="text-muted-foreground text-sm">未记录参数。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">指标曲线</CardTitle>
          <CardDescription>
            指标保留原始名称、step、value 与时间戳；导入幂等（同 run+name+step 覆盖更新）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!series || series.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              暂无指标数据。点击「补录指标」记录结果，也可以先在实验记录中写下观察。
            </p>
          ) : (
            <div className="space-y-6">
              {series.map((s) => {
                const stats = statsByName.get(s.name);
                return (
                  <div key={s.name}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-medium">{s.name}</span>
                      {stats && (
                        <span className="text-muted-foreground text-xs">
                          {stats.count} 点 · min {fmtNumber(stats.min_value)} · max{" "}
                          {fmtNumber(stats.max_value)} · 最新 {fmtNumber(stats.last_value)} (step{" "}
                          {stats.last_step})
                        </span>
                      )}
                    </div>
                    <MetricChart points={s.points} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="mt-6"><CardHeader><CardTitle className="text-base">实验观察与后续问题</CardTitle><NoteCreateDialog projectId={run.project_id} ideas={ideas} runs={[run]} initialRunId={run.id} initialIdeaId={target?.idea.id} onCreated={load} /></CardHeader><CardContent><ResearchNotes notes={notes} onChanged={load} /></CardContent></Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">证据关联（{run.evidence.length}）</CardTitle>
          <CardDescription>本实验对各假设版本的支撑情况。</CardDescription>
        </CardHeader>
        <CardContent>
          {run.evidence.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              尚未关联任何假设版本，点上方「关联证据」建立。
            </p>
          ) : (
            <ul className="space-y-2">
              {run.evidence.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <StatusBadge kind="verdict" value={e.verdict} />
                  <Link href={`/ideas/${e.idea_id}`} className="font-medium hover:underline">
                    {e.idea_title}
                  </Link>
                  <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                    v{e.version_number}
                  </span>
                  {e.note && (
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                      {e.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
