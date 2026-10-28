import { cn } from "@/lib/utils";
import type { IdeaStatus, ProjectStatus, RunStatus, Verdict } from "@/lib/api";

/**
 * Status as a calibration mark (Inkline): a 2px left tick in the semantic
 * color + text. No colored pills, no fill backgrounds — color never carries
 * the meaning alone (the label text is always present).
 */
const PALETTE = {
  green: "text-success",
  red: "text-destructive",
  blue: "text-info",
  amber: "text-warning",
  gray: "text-muted-foreground",
} as const;

const TICK = {
  green: "before:bg-success",
  red: "before:bg-destructive",
  blue: "before:bg-info",
  amber: "before:bg-warning",
  gray: "before:bg-muted-foreground/50",
} as const;

const VERDICT_LABEL: Record<Verdict, string> = {
  supports: "支持",
  refutes: "反驳",
  inconclusive: "存疑",
};
const VERDICT_COLOR: Record<Verdict, keyof typeof PALETTE> = {
  supports: "green",
  refutes: "red",
  inconclusive: "gray", // 存疑用中性墨色，不用黄色（黄色只留给待审）
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
  refuted: "已反驳",
  parked: "已搁置",
};
const IDEA_STATUS_COLOR: Record<IdeaStatus, keyof typeof PALETTE> = {
  exploring: "gray",
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
  className,
}: {
  kind: Variant;
  value: string;
  className?: string;
}) {
  const label = LABELS[kind][value] ?? value;
  const color = COLORS[kind][value] ?? "gray";
  return (
    <span
      className={cn(
        // 2px status tick + plain text — reads as a calibration mark, not a badge
        "before:inline-block before:h-3 before:w-0.5 before:align-[-1.5px] before:mr-1.5 before:content-['']",
        PALETTE[color],
        TICK[color],
        "whitespace-nowrap text-xs",
        className,
      )}
    >
      {label}
    </span>
  );
}
