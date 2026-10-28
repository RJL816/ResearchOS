"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  FlaskConical,
  GitBranch,
  MessageSquareText,
  NotebookPen,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ProjectCreateDialog } from "@/components/project-create-dialog";
import { useProjectContext } from "@/components/project-context";
import {
  getProposalSummary,
  listIdeas,
  listNotes,
  listRuns,
  type Idea,
  type ProposalSummary,
  type ResearchNote,
  type Run,
} from "@/lib/api";
import { fmtRelative } from "@/lib/format";

interface ProjectData {
  runs: Run[];
  ideas: Idea[];
  notes: ResearchNote[];
  summary: ProposalSummary | null;
}

/**
 * Research Overview — answers "what am I working on today" for the ACTIVE
 * project (sidebar project switcher drives the context). First visual landing
 * point is the research focus statement (serif), second is evidence state.
 */
export default function OverviewPage() {
  const { projects, activeProject, setActiveProject } = useProjectContext();
  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = activeProject?.id ?? null;

  const load = useCallback(async () => {
    if (projectId === null) {
      setData(null);
      return;
    }
    try {
      setError(null);
      const [runs, ideas, notes, summary] = await Promise.all([
        listRuns(projectId),
        listIdeas(projectId),
        listNotes(projectId).catch(() => [] as ResearchNote[]),
        getProposalSummary(projectId).catch(() => null),
      ]);
      setData({ runs, ideas, notes, summary: summary && summary.total_count > 0 ? summary : null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const focus = useMemo(() => {
    if (!activeProject) return null;
    const statement =
      activeProject.description?.trim() ||
      data?.ideas.find((i) => i.status === "testing" || i.status === "exploring")?.title;
    return statement ? { text: statement, derived: !activeProject.description?.trim() } : null;
  }, [activeProject, data]);

  const activeIdeas = useMemo(
    () =>
      (data?.ideas ?? [])
        .filter((i) => i.status === "exploring" || i.status === "testing")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 4),
    [data],
  );
  const recentRuns = useMemo(
    () => [...(data?.runs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
    [data],
  );
  const recentEvolution = useMemo(() => {
    const events: { text: string; at: string; href: string }[] = [];
    for (const idea of data?.ideas ?? []) {
      const versions = [...idea.versions].sort((a, b) => b.version_number - a.version_number);
      for (let i = 0; i < versions.length - 1; i++) {
        events.push({
          text: versions[i].change_reason || `修订为 v${versions[i].version_number}`,
          at: versions[i].created_at,
          href: `/ideas/${idea.id}`,
        });
      }
    }
    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
  }, [data]);

  const nextStep = useMemo(() => {
    if (data?.summary?.pending_count) {
      return {
        text: `处理 ${data.summary.pending_count} 条 AI 提案`,
        reason: "最近的对话分析产生了待审核变更",
        href: data.summary.latest_job_id ? `/analysis/${data.summary.latest_job_id}` : `/projects/${projectId}/conversations`,
      };
    }
    const unreviewedRun = recentRuns.find((r) => r.status === "succeeded" || r.status === "failed");
    if (unreviewedRun) {
      return {
        text: `复盘实验 ${unreviewedRun.name}`,
        reason: "已有结果尚未关联到假设证据",
        href: `/runs/${unreviewedRun.id}`,
      };
    }
    if (activeIdeas[0]) {
      return {
        text: `验证假设「${activeIdeas[0].title}」`,
        reason: "当前最活跃的假设，先设计对照实验",
        href: `/ideas/${activeIdeas[0].id}`,
      };
    }
    return {
      text: "记录第一个实验",
      reason: "证据是研究记忆的起点",
      href: `/projects/${projectId}/experiments`,
    };
  }, [data, recentRuns, activeIdeas, projectId]);

  if (projects.length === 0 && !error) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-xl text-center">
          <h1 className="text-page-title">Research OS</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            还没有研究项目。创建第一个项目，开始记录假设、实验与证据。
          </p>
          <div className="mt-4 flex justify-center">
            <ProjectCreateDialog onCreated={() => window.location.reload()} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* status strip — quiet, mono numbers, tabular */}
      <div className="text-muted-foreground flex h-7 shrink-0 items-center gap-4 border-b px-6 text-xs">
        <span>
          活跃假设 <span className="text-foreground font-mono">{activeIdeas.length}</span>
        </span>
        <span>
          实验 <span className="text-foreground font-mono">{data?.runs.length ?? "—"}</span>
        </span>
        <span>
          笔记 <span className="text-foreground font-mono">{data?.notes.length ?? "—"}</span>
        </span>
        <span>
          待审{" "}
          <span className={`font-mono ${(data?.summary?.pending_count ?? 0) > 0 ? "text-warning" : "text-foreground"}`}>
            {data?.summary?.pending_count ?? 0}
          </span>
        </span>
        {data && <span className="ml-auto">更新于 {fmtRelative(activeProject?.updated_at)}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* research focus — the only hero, serif statement first */}
        {!activeProject ? (
          <Skeleton className="h-36 rounded-md" />
        ) : (
          <section className="border-b pb-5">
            <p className="text-muted-foreground text-xs">当前研究焦点</p>
            {focus ? (
              <>
                <p className="font-serif-ink mt-1.5 max-w-3xl text-[22px] leading-[34px] font-medium">
                  {focus.text}
                </p>
                {focus.derived && <p className="text-muted-foreground mt-1 text-[11px]">来自项目描述</p>}
              </>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">
                尚未设定研究焦点——可在项目描述中写一句话研究问题。
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium">{activeProject.name}</span>
              <StatusBadge kind="project" value={activeProject.status} />
              <Button asChild size="sm" className="h-7 text-xs">
                <Link href={`/projects/${projectId}/ideas/graph`}>
                  继续研究
                  <ArrowRight className="size-3" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                <Link href={`/projects/${projectId}/experiments`}>
                  <FlaskConical className="size-3" />
                  记录实验
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                <Link href={`/projects/${projectId}/conversations`}>
                  <MessageSquareText className="size-3" />
                  导入对话
                </Link>
              </Button>
              <ProjectCreateDialog onCreated={() => void load()} />
            </div>
            <p className="text-muted-foreground mt-2.5 flex flex-wrap items-baseline gap-1 text-xs">
              下一步：
              <Link href={nextStep.href} className="text-primary inline-flex items-center gap-1 font-medium hover:underline">
                {nextStep.text}
              </Link>
              <span>— {nextStep.reason}</span>
            </p>
          </section>
        )}

        {!data ? (
          <div className="space-y-3 pt-5">
            <Skeleton className="h-32 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
          </div>
        ) : (
          <div className="grid gap-6 pt-5 lg:grid-cols-[1fr_320px]">
            {/* main column: active ideas / recent runs / recent evolution */}
            <div className="min-w-0 space-y-6">
              <section>
                <SectionHeader title="活跃假设" />
                {activeIdeas.length === 0 ? (
                  <EmptyLine text="没有探索中或验证中的假设。" />
                ) : (
                  <ul className="divide-border-subtle border-border-subtle divide-y border-y">
                    {activeIdeas.map((idea) => (
                      <li key={idea.id}>
                        <Link
                          href={`/ideas/${idea.id}`}
                          className="hover:bg-accent/40 flex items-center gap-3 px-1 py-2.5 transition-standard"
                        >
                          <span className="text-muted-foreground w-14 shrink-0 font-mono text-[11px]">
                            #{idea.id} v{idea.versions.find((v) => v.id === idea.current_version_id)?.version_number ?? 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-serif-ink text-[15px]">{idea.title}</span>
                          <StatusBadge kind="idea" value={idea.status} />
                          <ArrowRight className="text-muted-foreground size-3 shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={`/projects/${projectId}/ideas/graph`}
                  className="text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline"
                >
                  在演化图谱中查看全部
                </Link>
              </section>

              <section>
                <SectionHeader title="最近实验" />
                {recentRuns.length === 0 ? (
                  <EmptyLine text="还没有实验记录——点上方「记录实验」。" />
                ) : (
                  <ul className="divide-border-subtle border-border-subtle divide-y border-y">
                    {recentRuns.map((run) => {
                      return (
                        <li key={run.id}>
                          <Link
                            href={`/runs/${run.id}`}
                            className="hover:bg-accent/40 flex items-center gap-3 px-1 py-2 transition-standard"
                          >
                            <StatusBadge kind="run" value={run.status} />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{run.name}</span>
                            {run.dataset && (
                              <span className="text-muted-foreground hidden shrink-0 text-[11px] sm:block">
                                {run.dataset}
                              </span>
                            )}
                            <span className="text-muted-foreground w-14 shrink-0 text-right text-[11px]">
                              {fmtRelative(run.created_at)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {recentEvolution.length > 0 && (
                <section>
                  <SectionHeader title="最近演化" hint="为什么改了假设" />
                  <ul className="space-y-1.5">
                    {recentEvolution.map((event, index) => (
                      <li key={index} className="flex items-baseline gap-2 text-[13px]">
                        <GitBranch className="text-muted-foreground size-3 shrink-0" />
                        <Link href={event.href} className="min-w-0 flex-1 truncate hover:underline">
                          {event.text}
                        </Link>
                        <span className="text-muted-foreground shrink-0 text-[11px]">{fmtRelative(event.at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* right rail: inbox / notes */}
            <div className="space-y-6">
              <section>
                <SectionHeader title="待处理" />
                <div className="divide-border-subtle border-border-subtle divide-y border-y">
                  {data.summary ? (
                    <Link
                      href={data.summary.latest_job_id ? `/analysis/${data.summary.latest_job_id}` : "#"}
                      className="hover:bg-accent/40 flex items-center gap-2.5 py-2.5 transition-standard"
                    >
                      <Workflow className="text-warning size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium">AI 提案 {data.summary.pending_count} 条待审</p>
                        <p className="text-muted-foreground text-[11px]">
                          共 {data.summary.total_count} 条，来自最近的对话分析
                        </p>
                      </div>
                    </Link>
                  ) : (
                    <p className="text-muted-foreground py-2 text-xs">暂时没有待处理事项。</p>
                  )}
                </div>
              </section>

              {data.notes.length > 0 && (
                <section>
                  <SectionHeader title="最近笔记" />
                  <ul className="divide-border-subtle border-border-subtle divide-y border-y">
                    {data.notes.slice(0, 4).map((note) => (
                      <li key={note.id} className="flex items-center gap-2 py-2 text-[13px]">
                        <NotebookPen className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{note.title}</span>
                        <span className="text-muted-foreground shrink-0 text-[11px]">{fmtRelative(note.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {projects.length > 1 && (
                <section>
                  <SectionHeader title="全部项目" />
                  <ul className="divide-border-subtle border-border-subtle divide-y border-y">
                    {projects.map((project) => (
                      <li key={project.id}>
                        <button
                          type="button"
                          onClick={() => setActiveProject(project.id)}
                          className="hover:bg-accent/40 flex w-full items-center gap-2 py-2 text-left text-[13px] transition-standard"
                        >
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${
                              project.id === projectId ? "bg-primary" : "bg-muted-foreground/30"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          {project.id !== projectId && <span className="text-muted-foreground text-[10px]">切换</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint && <span className="text-muted-foreground text-[11px]">{hint}</span>}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground border-border-subtle border-y py-4 text-xs">{text}</div>
  );
}
