"use client";

import Link from "next/link";
import { useRouteId, useRouter } from "@/lib/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, FlaskConical, GitBranchPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { RunCreateDialog } from "@/components/run-create-dialog";
import { getProject, getRun, getRunMetrics, listRuns, type Project, type RunDetail } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "name" | "status" | "created_at" | "duration" | "metric";

interface Row {
  run: RunDetail;
  durationMs: number | null;
  spark: { step: number; value: number }[];
  linkedIdea: { id: number; title: string } | null;
}

function durationText(ms: number | null) {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function ExperimentsView() {
  const router = useRouter();
  const projectId = useRouteId();

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [asc, setAsc] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  const load = useCallback(async () => {
    try {
      const [projectData, runs] = await Promise.all([getProject(projectId), listRuns(projectId)]);
      setProject(projectData);
      const details = await Promise.all(
        runs.map(async (run) => {
          const [detail, metrics] = await Promise.all([getRun(run.id), getRunMetrics(run.id)]);
          const main = metrics.series[0];
          const spark = main
            ? main.points.slice(-24).map((p: { step: number; value: number }) => ({ step: p.step, value: p.value }))
            : [];
          const evidence = detail.evidence[0];
          return {
            run: detail,
            durationMs:
              detail.started_at && detail.finished_at
                ? new Date(detail.finished_at).getTime() - new Date(detail.started_at).getTime()
                : null,
            spark,
            linkedIdea: evidence ? { id: evidence.idea_id, title: evidence.idea_title } : null,
          };
        }),
      );
      setRows(details);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    if (!rows) return null;
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.run.name.localeCompare(b.run.name) * dir;
        case "status":
          return a.run.status.localeCompare(b.run.status) * dir;
        case "duration":
          return ((a.durationMs ?? -1) - (b.durationMs ?? -1)) * dir;
        case "metric": {
          const am = a.run.metric_stats[0]?.last_value ?? -Infinity;
          const bm = b.run.metric_stats[0]?.last_value ?? -Infinity;
          return (am - bm) * dir;
        }
        default:
          return a.run.created_at.localeCompare(b.run.created_at) * dir;
      }
    });
  }, [rows, sortKey, asc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAsc((prev) => !prev);
    else {
      setSortKey(key);
      setAsc(key === "name");
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 4),
    );
  };

  const allSelected = sorted !== null && sorted.length > 0 && sorted.slice(0, 4).every((row) => selected.includes(row.run.id));

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <FlaskConical className="size-3.5" />
            {project?.name ?? "…"}
          </div>
          <h1 className="text-page-title mt-0.5">实验台</h1>
        </div>
        <div className="flex items-center gap-2">
          {selected.length >= 2 && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => router.push(`/projects/${projectId}/compare?runs=${selected.join(",")}`)}
            >
              <GitBranchPlus className="size-3.5" />
              对比 {selected.length} 个实验
            </Button>
          )}
          <RunCreateDialog projectId={projectId} onCreated={load} />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {sorted === null ? (
        <Skeleton className="h-80 rounded-lg" />
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-center text-sm">
            <FlaskConical className="size-6" />
            还没有实验记录
            <span className="text-xs">点右上角「记录实验」登记第一条 Run。</span>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto overflow-y-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-9 pl-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : sorted.slice(0, 4).map((r) => r.run.id))}
                    className="accent-(--primary) size-3.5 cursor-pointer"
                    aria-label="全选"
                  />
                </TableHead>
                <SortableHead label="Run" sortKey="name" active={sortKey} asc={asc} onSort={toggleSort} mono />
                <SortableHead label="状态" sortKey="status" active={sortKey} asc={asc} onSort={toggleSort} />
                <TableHead>指标示例（最新）</TableHead>
                <TableHead className="hidden lg:table-cell">趋势</TableHead>
                <TableHead className="hidden xl:table-cell">关联假设</TableHead>
                <SortableHead label="耗时" sortKey="duration" active={sortKey} asc={asc} onSort={toggleSort} className="hidden md:table-cell" />
                <SortableHead
                  label="创建时间"
                  sortKey="created_at"
                  active={sortKey}
                  asc={asc}
                  onSort={toggleSort}
                  className="hidden pr-4 text-right md:table-cell"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(({ run, durationMs, spark, linkedIdea }) => {
                const metric = run.metric_stats[0];
                const checked = selected.includes(run.id);
                return (
                  <TableRow key={run.id} data-state={checked ? "selected" : undefined} className={cn(checked && "bg-primary/5")}>
                    <TableCell className="pl-4">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(run.id)}
                        className="accent-(--primary) size-3.5 cursor-pointer"
                        aria-label={`选择 ${run.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link href={`/runs/${run.id}`} className="group flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-medium group-hover:underline">{run.name}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">
                          #{run.id}
                          {run.git_commit ? ` · ${run.git_commit.slice(0, 7)}` : ""}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="run" value={run.status} />
                    </TableCell>
                    <TableCell>
                      {metric ? (
                        <span className="text-[13px]">
                          <span className="font-mono">{Number(metric.last_value.toPrecision(4))}</span>
                          <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                            {metric.name}@{metric.last_step}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {spark.length >= 2 ? <Spark points={spark} /> : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {linkedIdea ? (
                        <Link href={`/ideas/${linkedIdea.id}`} className="font-serif-ink hover:underline text-[13px]">
                          {linkedIdea.title}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{durationText(durationMs)}</TableCell>
                    <TableCell className="text-muted-foreground hidden pr-4 text-right text-xs md:table-cell">
                      {fmtDateTime(run.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Inkline sparkline: hairline polyline, solid last dot, no axes. */
function Spark({ points }: { points: { step: number; value: number }[] }) {
  const w = 64;
  const h = 18;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (w - 4) + 2;
      const y = h - 2 - ((p.value - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const [lx, ly] = path.split(" ").pop()!.split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.25" className="text-muted-foreground" />
      <circle cx={lx} cy={ly} r="1.8" className="fill-foreground" />
    </svg>
  );
}

function SortableHead({
  label,
  sortKey,
  active,
  asc,
  onSort,
  mono,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  mono?: boolean;
  className?: string;
}) {
  const isActive = active === sortKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-standard",
          isActive ? "text-foreground" : "",
        )}
      >
        <span className={mono ? "font-mono" : undefined}>{label}</span>
        <ArrowUpDown aria-label={isActive ? asc ? "升序" : "降序" : "切换排序"} className={cn("size-3", isActive ? "opacity-100" : "opacity-40")} />
      </button>
    </TableHead>
  );
}
