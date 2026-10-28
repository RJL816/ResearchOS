"use client";

import Link from "next/link";
import { useRouteId } from "@/lib/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { AddVersionDialog } from "@/components/add-version-dialog";
import { EvidenceLinkDialog } from "@/components/evidence-link-dialog";
import { getIdeaGraph, listNotes, listRuns, type IdeaGraph, type ResearchNote, type Run } from "@/lib/api";
import { RunCreateDialog } from "@/components/run-create-dialog";
import { NoteCreateDialog } from "@/components/note-create-dialog";
import { ResearchNotes, isNextNote } from "@/components/research-notes";
import { IdeaStatusSelect } from "@/components/idea-status-select";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function IdeaDetailPage() {
  const ideaId = useRouteId();

  const [graph, setGraph] = useState<IdeaGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await getIdeaGraph(ideaId);
      const [allNotes, allRuns] = await Promise.all([listNotes(data.idea.project_id), listRuns(data.idea.project_id)]);
      setGraph(data);
      setNotes(allNotes.filter((n) => n.idea_id === ideaId));
      setRuns(allRuns);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ideaId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error ?? "假设不存在"}
        </div>
      </div>
    );
  }

  const { idea, versions, edges } = graph;
  const nextVersionNumber =
    Math.max(0, ...versions.map((v) => v.version_number)) + 1;
  const versionLabel = (id: number) => {
    const v = versions.find((ver) => ver.id === id);
    return v ? `v${v.version_number}` : `#${id}`;
  };
  const evidenceCount = versions.reduce((sum, v) => sum + v.evidence.length, 0);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          href={`/projects/${idea.project_id}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← 返回项目
        </Link>
        {idea.research_idea_id && <Link className="ml-4 text-sm text-primary underline" href={`/research-ideas/${idea.research_idea_id}`}>查看所属研究 Idea</Link>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{idea.title}</h1>
          <IdeaStatusSelect ideaId={idea.id} status={idea.status} onChanged={load} />
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          创建于 {fmtDateTime(idea.created_at)} · 更新于 {fmtDateTime(idea.updated_at)} ·{" "}
          {versions.length} 个版本 · {evidenceCount} 条证据
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <RunCreateDialog projectId={idea.project_id} researchIdeaId={idea.research_idea_id ?? undefined} initialVersionId={idea.current_version_id ?? undefined} onCreated={load} />
          <AddVersionDialog
            ideaId={idea.id}
            nextVersionNumber={nextVersionNumber}
            onCreated={load}
            currentBody={versions.find((v) => v.id === idea.current_version_id)?.body}
          />
          <NoteCreateDialog projectId={idea.project_id} ideas={[idea]} runs={runs} initialIdeaId={idea.id} nextStep onCreated={load} />
          <EvidenceLinkDialog
            mode="version"
            idea={idea}
            projectId={idea.project_id}
            onLinked={load}
          />
          <Button variant="ghost" asChild>
            <Link
              href={
                idea.current_version_id
                  ? `/projects/${idea.project_id}/ideas/graph?node=${idea.current_version_id}`
                  : `/projects/${idea.project_id}/ideas/graph`
              }
            >
              <GitBranch className="size-4" />
              在图谱中查看
            </Link>
          </Button>
        </div>
      </div>

      <Card className="mb-6"><CardHeader><CardTitle className="text-base">验证进展与下一步</CardTitle><CardDescription>实验计划关联验证目标；完成实验后再记录证据判断，状态由你确认。</CardDescription></CardHeader><CardContent className="space-y-4">
        {runs.filter((r) => versions.some((v) => v.id === r.target_version_id)).map((r) => <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent"><span>{r.name} · v{versions.find((v) => v.id === r.target_version_id)?.version_number}</span><StatusBadge kind="run" value={r.status} /></Link>)}
        <ResearchNotes notes={notes.filter(isNextNote)} onChanged={load} />
      </CardContent></Card>
      <Card className="mb-6"><CardHeader><CardTitle className="text-base">研究笔记</CardTitle><NoteCreateDialog projectId={idea.project_id} ideas={[idea]} runs={runs} initialIdeaId={idea.id} onCreated={load} /></CardHeader><CardContent><ResearchNotes notes={notes.filter((n) => !isNextNote(n))} onChanged={load} /></CardContent></Card>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">版本时间线</CardTitle>
          <CardDescription>
            版本创建后不可修改；演化通过追加新版本完成（最新在上）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {[...versions].reverse().map((version, index) => (
              <div key={version.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                      version.id === idea.current_version_id
                        ? "border-primary text-primary bg-primary/10 font-semibold"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    v{version.version_number}
                  </div>
                  {index < versions.length - 1 && (
                    <div className="bg-border w-px flex-1" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-8">
                  <div className="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
                    <span>{fmtDateTime(version.created_at)}</span>
                    {version.id === idea.current_version_id && (
                      <span className="text-primary font-medium">当前版本</span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {version.body}
                  </p>
                  {version.change_reason && (
                    <p className="text-muted-foreground mt-2 border-l-2 pl-3 text-xs italic">
                      变更原因：{version.change_reason}
                    </p>
                  )}
                  {version.evidence.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      {version.evidence.map((e) => (
                        <div
                          key={e.id}
                          className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md px-3 py-1.5 text-xs"
                        >
                          <StatusBadge kind="verdict" value={e.verdict} />
                          <Link
                            href={`/runs/${e.run_id}`}
                            className="font-medium hover:underline"
                          >
                            {e.run_name}
                          </Link>
                          <span className="text-muted-foreground">
                            ({fmtDateTime(e.created_at)})
                          </span>
                          {e.note && (
                            <span className="text-muted-foreground min-w-0 flex-1 truncate">
                              {e.note}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">演化关系</CardTitle>
          <CardDescription>版本之间的有向边；revision 为自动生成。</CardDescription>
        </CardHeader>
        <CardContent>
          {edges.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无演化边。</p>
          ) : (
            <ul className="space-y-2">
              {edges.map((edge) => (
                <li
                  key={edge.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs">{versionLabel(edge.src_version_id)}</span>
                  <ArrowRight className="text-muted-foreground size-3.5" />
                  <span className="font-mono text-xs">{versionLabel(edge.dst_version_id)}</span>
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {edge.relation}
                  </Badge>
                  {edge.note && (
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                      {edge.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Separator className="my-4" />
          <p className="text-muted-foreground text-xs">
            提示：假设正文的任何修改都应通过「新增版本」完成，历史版本永远可回溯。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
