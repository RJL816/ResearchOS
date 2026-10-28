"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  Compass,
  FlaskConical,
  Lightbulb,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import type { IdeaFlowNode } from "./graph-types";

const STATUS_ICON: Record<string, typeof Compass> = {
  exploring: Compass,
  testing: FlaskConical,
  validated: CircleCheck,
  refuted: CircleX,
  parked: CirclePause,
  inconclusive: CircleHelp,
};

function IdeaNodeInner({ data, selected }: NodeProps<IdeaFlowNode>) {
  const node = data.graphNode;
  const Icon = STATUS_ICON[node.status] ?? Lightbulb;
  const vertical = data.direction === "TB";
  const inconclusiveCount = Math.max(
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
              "w-64 cursor-pointer rounded-xl border bg-card p-3 text-left shadow-sm outline-none transition-all",
              "focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary ring-primary/40 shadow-md ring-2"
                : "hover:border-foreground/25 hover:shadow",
              data.isMatch && !selected && "border-amber-400/90 ring-2 ring-amber-300/60",
              data.proposed &&
                !selected &&
                "border-emerald-400 bg-emerald-50/60 ring-emerald-300/50 ring-2 dark:bg-emerald-950/40",
              data.dimmed && !selected && "opacity-35 saturate-50",
            )}
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
                #{node.idea_id} · v{node.version}
              </span>
              <Icon className="text-muted-foreground size-3.5" aria-hidden />
              <StatusBadge kind="idea" value={node.status} />
            </div>
            <div className="font-serif-ink text-[15px] leading-snug font-medium">{node.title}</div>
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-snug">
              {node.summary}
            </p>
            <div className="text-muted-foreground mt-2 flex items-center gap-2 border-t pt-1.5 text-[10px]">
              <span className="inline-flex items-center gap-1">
                <FlaskConical className="size-3" aria-hidden />
                {node.run_count} 实验
              </span>
              {node.supports_count > 0 && (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  支持 {node.supports_count}
                </span>
              )}
              {node.refutes_count > 0 && (
                <span className="font-medium text-red-600 dark:text-red-400">
                  反驳 {node.refutes_count}
                </span>
              )}
              {inconclusiveCount > 0 && <span>存疑 {inconclusiveCount}</span>}
              {node.evidence_count === 0 && <span>暂无证据</span>}
            </div>
            <Handle
              type="target"
              position={vertical ? Position.Top : Position.Left}
              className="!bg-muted-foreground/60 !border-none !size-1.5"
              isConnectable={false}
            />
            <Handle
              type="source"
              position={vertical ? Position.Bottom : Position.Right}
              className="!bg-muted-foreground/60 !border-none !size-1.5"
              isConnectable={false}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-60">
          <div className="text-xs font-medium">{node.title}</div>
          <div className="text-muted-foreground text-[11px]">
            v{node.version} · {node.evidence_count} 条证据 · {node.run_count} 个实验
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const IdeaNode = memo(IdeaNodeInner);
