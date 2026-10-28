import { Badge } from "@/components/ui/badge";
import type { IdeaStatus, ProjectStatus, RunStatus, Verdict } from "@/lib/api";

const PALETTE = {
  green: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  red: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  blue: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  amber: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  gray: "border-border bg-muted text-muted-foreground",
} as const;

const VERDICT_LABEL: Record<Verdict, string> = {
  supports: "支持",
  refutes: "反驳",
  inconclusive: "不确定",
};
const VERDICT_COLOR: Record<Verdict, keyof typeof PALETTE> = {
  supports: "green",
  refutes: "red",
  inconclusive: "amber",
};

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  planned: "计划中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  stopped: "已停止",
};
const RUN_STATUS_COLOR: Record<RunStatus, keyof typeof PALETTE> = {
  planned: "gray",
  running: "blue",
  succeeded: "green",
  failed: "red",
  stopped: "amber",
};

const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  exploring: "探索中",
  testing: "验证中",
  validated: "已验证",
  refuted: "已否证",
  parked: "搁置",
};
const IDEA_STATUS_COLOR: Record<IdeaStatus, keyof typeof PALETTE> = {
  exploring: "blue",
  testing: "amber",
  validated: "green",
  refuted: "red",
  parked: "gray",
};

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  archived: "已归档",
};
const PROJECT_STATUS_COLOR: Record<ProjectStatus, keyof typeof PALETTE> = {
  active: "green",
  paused: "amber",
  archived: "gray",
};

type Variant = "verdict" | "run" | "idea" | "project";

const LABELS: Record<Variant, Record<string, string>> = {
  verdict: VERDICT_LABEL,
  run: RUN_STATUS_LABEL,
  idea: IDEA_STATUS_LABEL,
  project: PROJECT_STATUS_LABEL,
};
const COLORS: Record<Variant, Record<string, keyof typeof PALETTE>> = {
  verdict: VERDICT_COLOR,
  run: RUN_STATUS_COLOR,
  idea: IDEA_STATUS_COLOR,
  project: PROJECT_STATUS_COLOR,
};

export function StatusBadge({
  kind,
  value,
}: {
  kind: Variant;
  value: string;
}) {
  const label = LABELS[kind][value] ?? value;
  const color = COLORS[kind][value] ?? "gray";
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${PALETTE[color]}`}>
      {label}
    </Badge>
  );
}
