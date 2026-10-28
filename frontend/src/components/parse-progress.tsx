"use client";

type Progress = { completed: number; total: number | null; stage: string };
export function ParseProgress({ progress }: { progress: Progress }) {
  const total = progress.total;
  const completed = total ? Math.min(progress.completed, total) : 0;
  const percent = total ? Math.round((completed / total) * 100) : null;
  return <div role="status" className="space-y-2 rounded-xl border bg-card p-4 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{progress.stage || "正在准备解析"}</span>{total && <span className="text-muted-foreground">已完成 {completed} / {total} 段 · {percent}%</span>}</div>
    {total ? <progress className="h-2 w-full accent-primary" max={total} value={completed} aria-label="分段解析进度" /> : <progress className="h-2 w-full accent-primary" aria-label="等待解析" />}
    <p className="text-muted-foreground">解析在后台进行，可以切换页面后返回查看。进度按已完成的段数计算。关闭应用会中断任务。</p>
  </div>;
}
