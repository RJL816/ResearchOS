"use client";

import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { IdeaFlowEdge } from "./graph-types";
import { RELATION_META } from "./graph-types";

function IdeaEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<IdeaFlowEdge>) {
  const [hovered, setHovered] = useState(false);
  if (!data) return null;
  const relation = data.db.relation;
  const meta = RELATION_META[relation] ?? RELATION_META.revision;
  const highlighted = hovered || selected || data.related === true;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: highlighted ? meta.color : "var(--muted-foreground)",
          strokeOpacity: highlighted ? 1 : 0.45,
          strokeWidth: highlighted ? 2.2 : 1.6,
          strokeDasharray: meta.dashed ? "6 4" : undefined,
        }}
      />
      {/* Wide transparent path so thin edges get a usable hover/click target. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        className="nodrag nopan"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {highlighted && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="border-border bg-popover pointer-events-none absolute rounded-md border px-2 py-0.5 text-[11px] leading-relaxed shadow-sm"
          >
            <span className="font-semibold" style={{ color: meta.color }}>
              {meta.label} · {meta.en}
            </span>
            {data.db.reason && (
              <span className="text-muted-foreground">：{data.db.reason}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const IdeaEdge = memo(IdeaEdgeInner);
