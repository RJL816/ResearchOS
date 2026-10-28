"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import type { IdeaFlowNode } from "./graph-types";

/**
 * Idea node — Inkline calibration-mark style.
 *
 * Shape IS the status (never color alone):
 * - exploring: solid hairline border, neutral tick
 * - testing:   dashed border
 * - validated: support-colored left bar + green tick
 * - refuted:   clipped corner + refute-colored left bar, title stays readable
 * - parked:    dotted border, muted
 * Bottom: 4px evidence micro-bar (supports/refutes/inconclusive proportions)
 * with mono counts. v2+ nodes surface their change reason (core info).
 */

const STATUS_STYLE: Record<
  string,
  { border: string; bar: string; tick: string }
> = {
  exploring: { border: "", bar: "before:bg-muted-foreground/50", tick: "text-muted-foreground" },
  testing: { border: "border-dashed", bar: "before:bg-muted-foreground/50", tick: "text-warning" },
  validated: { border: "", bar: "before:bg-success", tick: "text-success" },
  refuted: { border: "", bar: "before:bg-destructive", tick: "text-destructive" },
  parked: { border: "border-dotted", bar: "before:bg-border", tick: "text-muted-foreground" },
};

function EvidenceBar({
  supports,
  refutes,
  inconclusive,
}: {
  supports: number;
  refutes: number;
  inconclusive: number;
}) {
  const total = supports + refutes + inconclusive;
  if (total === 0) {
    return <span className="text-muted-foreground text-[10px]">暂无证据</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="border-border-subtle flex h-1 w-20 shrink-0 overflow-hidden rounded-[1px] border">
        {supports > 0 && <span className="bg-success" style={{ flexGrow: supports }} />}
        {refutes > 0 && <span className="bg-destructive" style={{ flexGrow: refutes }} />}
        {inconclusive > 0 && <span className="bg-muted-foreground/50" style={{ flexGrow: inconclusive }} />}
      </span>
      <span className="text-muted-foreground truncate font-mono text-[10px]">
        {supports > 0 && `支持${supports} `}
        {refutes > 0 && `反驳${refutes} `}
        {inconclusive > 0 && `存疑${inconclusive}`}
      </span>
    </span>
  );
}

function IdeaNodeInner({ data, selected }: NodeProps<IdeaFlowNode>) {
  const node = data.graphNode;
  const vertical = data.direction === "TB";
  const style = STATUS_STYLE[node.status] ?? STATUS_STYLE.exploring;
  const inconclusive = Math.max(
    0,
    node.evidence_count - node.supports_count - node.refutes_count,
  );

  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            tabIndex={0}
            role="button"
            aria-label={`${node.title}，版本 ${node.version}，${node.evidence_count} 条证据`}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                (event.currentTarget as HTMLElement).click();
              }
            }}
            className={cn(
              "group relative w-64 cursor-pointer rounded-md border border-line-strong bg-card p-3 pl-4 text-left shadow-sm outline-none transition-all",
              "focus-visible:ring-2 focus-visible:ring-ring",
              style.border,
              selected
                ? "border-primary shadow-md"
                : "hover:border-foreground/30 hover:shadow-sm",
              data.proposed &&
                !selected &&
                "border-success bg-success/5 ring-success/40 ring-2",
              data.dimmed && !selected && "opacity-35 saturate-50",
              data.isMatch && !selected && !data.proposed && "ring-2 ring-warning/60",
              // refuted: clipped top-left corner
              node.status === "refuted" &&
                "[clip-path:polygon(12px_0,100%_0,100%_100%,0_100%,0_12px)]",
            )}
          >
            {/* status left bar */}
            <span
              aria-hidden
              className={cn("absolute top-2 bottom-2 left-0 w-[3px] rounded-full", style.bar)}
            />

            {/* meta row */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-muted-foreground font-mono text-[10px]">
                #{node.idea_id} · v{node.version}
              </span>
              <StatusBadge kind="idea" value={node.status} className={style.tick} />
            </div>

            {/* hypothesis statement — serif, this node's core content */}
            <p className="font-serif-ink line-clamp-2 text-[15px] leading-snug font-medium">
              {node.title}
            </p>

            {/* change reason — why this version exists (v2+ when present) */}
            {node.version > 1 && node.change_reason && (
              <p className="text-muted-foreground mt-1.5 line-clamp-2 border-l pl-2 text-[11px] leading-snug">
                ↳ {node.change_reason}
              </p>
            )}

            {/* evidence micro-bar */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-1.5">
              <EvidenceBar
                supports={node.supports_count}
                refutes={node.refutes_count}
                inconclusive={inconclusive}
              />
              {node.run_count > 0 && (
                <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                  {node.run_count} 实验
                </span>
              )}
            </div>

            <Handle
              type="target"
              position={vertical ? Position.Top : Position.Left}
              className="!size-1.5 !border-none !bg-muted-foreground/50"
              isConnectable={false}
            />
            <Handle
              type="source"
              position={vertical ? Position.Bottom : Position.Right}
              className="!size-1.5 !border-none !bg-muted-foreground/50"
              isConnectable={false}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-60">
          <div className="font-serif-ink text-xs font-medium">{node.title}</div>
          <div className="text-muted-foreground text-[11px]">
            v{node.version} · {node.evidence_count} 条证据 · {node.run_count} 个实验
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const IdeaNode = memo(IdeaNodeInner);
