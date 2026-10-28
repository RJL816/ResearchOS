"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { MetricChart } from "@/components/metric-chart";
import {
  getRun,
  getRunMetrics,
  type MetricSeries,
  type RunDetail,
} from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";


const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

interface Loaded {
  run: RunDetail;
  metrics: MetricSeries[];
}

export default function CompareView() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const projectId = Number(params.id);
  const runIds = useMemo(
    () =>
      (search.get("runs") ?? "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 4),
    [search],
  );

  const [loaded, setLoaded] = useState<Loaded[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Record<string, Set<number>>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const results = await Promise.all(
        runIds.map(async (id) => ({ run: await getRun(id), metrics: (await getRunMetrics(id)).series })),
      );
      setLoaded(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const metaRows = useMemo(() => {
    if (!loaded) return [];
    const fields: { label: string; get: (r: RunDetail) => string | null; mono?: boolean }[] = [
      { label: "名称", get: (r) => r.name },
      { label: "状态", get: (r) => r.status },
      { label: "Git commit", get: (r) => r.git_commit, mono: true },
      { label: "数据集", get: (r) => r.dataset },
      { label: "评估协议", get: (r) => r.eval_protocol },
      { label: "开始", get: (r) => (r.started_at ? fmtDateTime(r.started_at) : null) },
      { label: "结束", get: (r) => (r.finished_at ? fmtDateTime(r.finished_at) : null) },
    ];
    return fields.map((field) => {
      const values = loaded.map((l) => field.get(l.run));
      const distinct = new Set(values.filter((v) => v !== null && v !== ""));
      return { label: field.label, values, differ: values.length > 1 && distinct.size > 1, mono: field.mono };
    });
  }, [loaded]);

  const paramDiff = useMemo(() => {
    if (!loaded) return [];
    const keys = [...new Set(loaded.flatMap((l) => Object.keys(l.run.params ?? {})))];
    return keys
      .map((key) => {
        const values = loaded.map((l) =>
          l.run.params && key in l.run.params ? JSON.stringify(l.run.params[key]) : "—",
        );
        return { key, values, differ: new Set(values).size > 1 };
      })
      .sort((a, b) => Number(b.differ) - Number(a.differ));
  }, [loaded]);

  const commonMetrics = useMemo(() => {
    if (!loaded || loaded.length < 2) return [];
    const first = loaded[0].metrics.map((s) => s.name);
    return first.filter((name) => loaded.every((l) => l.metrics.some((s) => s.name === name)));
  }, [loaded]);

  const toggleSeries = (metricName: string, runIndex: number) => {
    setHidden((prev) => {
      const set = new Set(prev[metricName] ?? []);
      if (set.has(runIndex)) set.delete(runIndex);
      else set.add(runIndex);
      return { ...prev, [metricName]: set };
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4">
        <Link
          href={`/projects/${projectId}/experiments`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-standard"
        >
          <ArrowLeft className="size-3.5" />
          返回实验台
        </Link>
        <h1 className="text-page-title mt-1 flex items-center gap-2">
          <Scale className="text-primary size-5" />
          实验对比
          <span className="text-muted-foreground font-mono text-sm font-normal">
            {runIds.map((id) => `#${id}`).join(" vs ")}
          </span>
        </h1>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : !loaded ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : loaded.length < 2 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-12 text-center text-sm">
          至少选择两个实验才能对比。
        </div>
      ) : (
        <div className="space-y-5">
          {/* metadata comparison */}
          <Card className="overflow-hidden p-0">
            <CardHeader className="bg-muted/50 border-b px-4 py-2.5">
              <CardTitle className="text-card-title">基本元数据</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-[13px]">
                <tbody>
                  {metaRows.map((row) => (
                    <tr key={row.label} className="border-b border-border-subtle last:border-0">
                      <td className="text-muted-foreground w-28 shrink-0 px-4 py-2 text-xs">{row.label}</td>
                      {row.values.map((value, index) => (
                        <td
                          key={index}
                          className={cn(
                            "px-3 py-2 align-top",
                            row.differ && "font-medium",
                            row.mono && "font-mono text-xs",
                          )}
                        >
                          {value ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* parameter diff */}
          {paramDiff.length > 0 && (
            <Card className="overflow-hidden p-0">
              <CardHeader className="bg-muted/50 border-b flex-row items-center justify-between space-y-0 px-4 py-2.5">
                <CardTitle className="text-card-title">参数 Diff</CardTitle>
                <span className="text-muted-foreground text-[11px]">差异项在前，<span className="text-foreground">加粗</span> = 不同</span>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-[13px]">
                  <tbody>
                    {paramDiff.map((row) => (
                      <tr key={row.key} className={cn("border-b border-border-subtle last:border-0", row.differ && "bg-warning/5")}>
                        <td className="text-muted-foreground w-40 shrink-0 px-4 py-2 font-mono text-xs">{row.key}</td>
                        {row.values.map((value, index) => (
                          <td key={index} className={cn("px-3 py-2 align-top font-mono text-xs", row.differ && "font-semibold")}>
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* common metrics overlay */}
          {commonMetrics.length > 0 ? (
            <div className="space-y-4">
              {commonMetrics.map((metricName) => {
                const hiddenSet = hidden[metricName] ?? new Set<number>();
                return (
                  <Card key={metricName} className="p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="font-mono text-[13px]">{metricName}</CardTitle>
                      <div className="flex flex-wrap gap-2">
                        {loaded.map((l, index) => (
                          <button
                            key={l.run.id}
                            type="button"
                            onClick={() => toggleSeries(metricName, index)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-standard",
                              hiddenSet.has(index) && "opacity-40",
                            )}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
                            />
                            #{l.run.id} {l.run.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {loaded.map((l, index) => {
                        if (hiddenSet.has(index)) return null;
                        const series = l.metrics.find((s) => s.name === metricName);
                        if (!series) return null;
                        return (
                          <div key={l.run.id} className="flex items-center gap-3">
                            <span className="text-muted-foreground w-14 shrink-0 truncate font-mono text-[10px]">
                              #{l.run.id}
                            </span>
                            <div className="min-w-0 flex-1">
                              <MetricChart points={series.points} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
              这些实验没有共同指标，无法绘制对比曲线。
            </div>
          )}

          {/* statuses + links */}
          <Card className="overflow-hidden p-0">
            <CardHeader className="bg-muted/50 border-b px-4 py-2.5">
              <CardTitle className="text-card-title">关联</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-[13px]">
                <tbody>
                  {loaded.map((l) => (
                    <tr key={l.run.id} className="border-b border-border-subtle last:border-0">
                      <td className="text-muted-foreground w-28 px-4 py-2 font-mono text-xs">#{l.run.id}</td>
                      <td className="px-3 py-2">
                        <StatusBadge kind="run" value={l.run.status} />
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/runs/${l.run.id}`} className="text-primary text-xs hover:underline">
                          打开详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
