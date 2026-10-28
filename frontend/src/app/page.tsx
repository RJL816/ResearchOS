"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  FlaskConical,
  GitBranch,
  MessageSquareText,
  NotebookPen,
  Plus,
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
  listProjects,
  listRuns,
  type Idea,
  type ProposalSummary,
  type Run,
} from "@/lib/api";
import { fmtRelative } from "@/lib/format";

interface ProjectData {
  projectId: number;
  projectName: string;
  runs: Run[];
  ideas: Idea[];
  summary: ProposalSummary | null;
}

export default function OverviewPage() {
  const { projects, activeProject, setActiveProject } = useProjectContext();
  const [data, setData] = useState<ProjectData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const projectList = await listProjects();
      const results = await Promise.all(
        projectList.map(async (project) => {
          const [runs, ideas, summary] = await Promise.all([
            listRuns(project.id).catch(() => []),
            listIdeas(project.id).catch(() => []),
            getProposalSummary(project.id).catch(() => null),
          ]);
          return {
            projectId: project.id,
            projectName: project.name,
            runs,
            ideas,
            summary: summary && summary.total_count > 0 ? summary : null,
          };
        }),
      );
      setData(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    if (!data) return null;
    const allRuns = data.flatMap((d) => d.runs.map((r) => ({ ...r, projectName: d.projectName })));
    const allIdeas = data.flatMap((d) => d.ideas.map((i) => ({ ...i, projectName: d.projectName })));
    const activeIdeas = allIdeas.filter((i) => i.status === "exploring" || i.status === "testing");
    const pending = data.reduce((sum, d) => sum + (d.summary?.pending_count ?? 0), 0);
    const running = allRuns.filter((r) => r.status === "running" || r.status === "planned");
    return { allRuns, activeIdeas, pending, running };
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-page-title">研究总览</h1>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            {activeProject ? `当前项目：${activeProject.name}` : "全部项目的最近动态"}
          </p>
        </div>
        <div className="flex gap-2">
          {activeProject && (
            <>
              <Button asChild variant="outline" size="sm" className="h-8">
                <Link href={`/projects/${activeProject.id}/conversations`}>
                  <MessageSquareText className="size-3.5" />
                  导入对话
                </Link>
              </Button>
              <Button asChild size="sm" className="h-8">
                <Link href={`/projects/${activeProject.id}/experiments`}>
                  <FlaskConical className="size-3.5" />
                  打开实验台
                </Link>
              </Button>
            </>
          )}
          <ProjectCreateDialog onCreated={() => void load()} />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* compact stat strip — real counts only */}
      <div className="border-border-subtle mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
        <Stat label="活跃假设" value={stats?.activeIdeas.length} icon={GitBranch} />
        <Stat label="进行中实验" value={stats?.running.length} icon={FlaskConical} />
        <Stat label="待审 AI 提案" value={stats?.pending} icon={Workflow} highlight={(stats?.pending ?? 0) > 0} />
        <Stat label="项目" value={projects.length} icon={NotebookPen} />
      </div>

      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-6">
            {/* recent experiments across projects */}
            <section>
              <SectionHeader title="最近实验" />
              <RecentRuns runs={stats?.allRuns ?? []} />
            </section>

            {/* active ideas */}
            <section>
              <SectionHeader title="活跃假设" hint="探索中 / 验证中" />
              <ActiveIdeas ideas={stats?.activeIdeas ?? []} />
            </section>
          </div>

          <div className="space-y-6">
            {/* pending reviews */}
            <section>
              <SectionHeader title="待处理" />
              <div className="bg-card divide-border-subtle rounded-lg border">
                {data.every((d) => !d.summary) ? (
                  <p className="text-muted-foreground p-4 text-xs">没有待处理的 AI 提案。</p>
                ) : (
                  data
                    .filter((d) => d.summary)
                    .map((d) => (
                      <Link
                        key={d.projectId}
                        href={d.summary?.latest_job_id ? `/analysis/${d.summary.latest_job_id}` : "#"}
                        className="hover:bg-accent/50 flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0 transition-standard"
                      >
                        <Workflow className="text-primary size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{d.projectName}</p>
                          <p className="text-muted-foreground text-xs">
                            {d.summary?.pending_count} 条待审 / {d.summary?.total_count} 总计
                          </p>
                        </div>
                        <ArrowUpRight className="text-muted-foreground size-3.5" />
                      </Link>
                    ))
                )}
              </div>
            </section>

            {/* projects */}
            <section>
              <SectionHeader title="项目" />
              <div className="bg-card divide-border-subtle rounded-lg border">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setActiveProject(project.id)}
                    className="hover:bg-accent/50 flex w-full items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-left last:border-0 transition-standard"
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${project.id === activeProject?.id ? "bg-primary" : "bg-muted-foreground/30"}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{project.name}</span>
                    <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                      {project.idea_count}/{project.run_count}
                    </span>
                  </button>
                ))}
                {projects.length === 0 && (
                  <p className="text-muted-foreground p-4 text-xs">还没有项目，点右上角新建。</p>
                )}
              </div>
            </section>

            <section>
              <SectionHeader title="快速入口" />
              <div className="grid grid-cols-2 gap-2">
                {activeProject ? (
                  <>
                    <QuickLink href={`/projects/${activeProject.id}/ideas/graph`} icon={GitBranch} label="演化图谱" />
                    <QuickLink href={`/projects/${activeProject.id}/timeline`} icon={NotebookPen} label="研究时间线" />
                    <QuickLink href={`/projects/${activeProject.id}/conversations`} icon={MessageSquareText} label="导入对话" />
                    <QuickLink href={`/projects/${activeProject.id}`} icon={Plus} label="新建内容" />
                  </>
                ) : (
                  <p className="text-muted-foreground col-span-2 rounded-lg border border-dashed p-4 text-xs">
                    创建或选择一个项目后可用。
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string;
  value?: number;
  icon: typeof FlaskConical;
  highlight?: boolean;
}) {
  return (
    <div className="bg-card flex items-center gap-3 px-4 py-3">
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
          highlight ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className={`font-mono text-lg leading-none font-semibold ${highlight ? "text-primary" : ""}`}>
          {value ?? "—"}
        </p>
        <p className="text-muted-foreground mt-1 truncate text-xs">{label}</p>
      </div>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-section-title">{title}</h2>
      {hint && <span className="text-muted-foreground text-[11px]">{hint}</span>}
    </div>
  );
}

function RecentRuns({ runs }: { runs: (Run & { projectName: string })[] }) {
  const recent = [...runs]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  if (recent.length === 0) {
    return <EmptyLine text="还没有实验记录。" />;
  }
  return (
    <div className="bg-card divide-border-subtle overflow-hidden rounded-lg border">
      {recent.map((run) => (
        <Link
          key={run.id}
          href={`/runs/${run.id}`}
          className="hover:bg-accent/50 flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 transition-standard"
        >
          <span className="text-muted-foreground shrink-0 font-mono text-[11px]">#{run.id}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{run.name}</span>
          <span className="text-muted-foreground hidden truncate text-xs sm:block">{run.projectName}</span>
          <StatusBadge kind="run" value={run.status} />
          <span className="text-muted-foreground w-16 shrink-0 text-right text-[11px]">
            {fmtRelative(run.created_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function ActiveIdeas({ ideas }: { ideas: (Idea & { projectName: string })[] }) {
  const recent = [...ideas]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);
  if (recent.length === 0) {
    return <EmptyLine text="没有探索中或验证中的假设。" />;
  }
  return (
    <div className="bg-card divide-border-subtle overflow-hidden rounded-lg border">
      {recent.map((idea) => (
        <Link
          key={idea.id}
          href={`/ideas/${idea.id}`}
          className="hover:bg-accent/50 flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 transition-standard"
        >
          <span className="text-muted-foreground shrink-0 font-mono text-[11px]">#{idea.id}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{idea.title}</span>
          <span className="text-muted-foreground hidden truncate text-xs sm:block">{idea.projectName}</span>
          <StatusBadge kind="idea" value={idea.status} />
          <span className="text-muted-foreground w-16 shrink-0 text-right text-[11px]">
            {fmtRelative(idea.updated_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof GitBranch;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="hover:border-primary/40 hover:text-foreground text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] transition-standard"
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-xs">
      {text}
    </div>
  );
}
