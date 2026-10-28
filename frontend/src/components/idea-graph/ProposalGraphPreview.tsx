"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getJobProposals,
  getProjectIdeaGraph,
  type GraphChangeProposal,
  type GraphEdge,
  type GraphNode,
  type ProjectIdeaGraph,
} from "@/lib/api";
import { IdeaNode } from "./IdeaNode";
import { layoutIdeaGraph } from "./graph-layout";
import type { IdeaFlowNode } from "./graph-types";

const NODE_TYPES = { idea: IdeaNode };

/**
 * Read-only Before/After preview of a job's changeset: the current graph with
 * proposed additions overlaid (green nodes / amber dashed edges). Reuses the
 * Phase 2 dagre layout and IdeaNode renderer; positions are view-only.
 */
export function ProposalGraphPreview({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  return (
    <ReactFlowProvider>
      <PreviewInner jobId={jobId} onClose={onClose} />
    </ReactFlowProvider>
  );
}

function PreviewInner({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const [proposals, setProposals] = useState<GraphChangeProposal[] | null>(null);
  const [graph, setGraph] = useState<ProjectIdeaGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    getJobProposals(jobId)
      .then(async (data) => {
        if (stale) return;
        setProposals(data);
        if (data.length > 0) {
          setGraph(await getProjectIdeaGraph(data[0].project_id));
        }
      })
      .catch((err: unknown) => !stale && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      stale = true;
    };
  }, [jobId]);

  const { nodes, edges } = useMemo(() => {
    const beforeNodes: GraphNode[] = graph?.nodes ?? [];
    const beforeEdges: GraphEdge[] = graph?.edges ?? [];
    const props = proposals ?? [];

    const flow = layoutIdeaGraph(beforeNodes, beforeEdges, "TB");
    const anchorBase = flow.nodes[0]?.position ?? { x: 0, y: 0 };
    const proposedNodes: IdeaFlowNode[] = props
      .filter((p) => p.action_type === "create_idea")
      .map((p, index) => {
        const payload = p.payload as Record<string, string>;
        return {
          id: `proposal-${p.id}`,
          type: "idea" as const,
          position: { x: anchorBase.x + 360, y: anchorBase.y + index * 180 },
          data: {
            graphNode: {
              id: -p.id,
              idea_id: -p.id,
              title: payload.title ?? "（未命名提案）",
              summary: String(payload.body ?? "").slice(0, 140),
              status: "exploring" as const,
              version: 1,
              evidence_count: 0,
              run_count: 0,
              supports_count: 0,
              refutes_count: 0,
              created_at: new Date().toISOString(),
            },
            direction: "TB" as const,
            proposed: true,
          },
        };
      });

    const proposedEdges: Edge[] = props
      .filter((p) => p.action_type === "create_idea_edge")
      .map((p) => {
        const payload = p.payload as Record<string, unknown>;
        const src = String(payload.src_version_id ?? "");
        const dst = String(payload.dst_version_id ?? "");
        const label = String(payload.relation ?? "");
        return {
          id: `pe-${p.id}`,
          source: src,
          target: dst.startsWith("{") ? src : dst,
          style: { stroke: "#d97706", strokeDasharray: "6 4", strokeWidth: 2 },
          label,
          labelStyle: { fontSize: 10, fill: "#d97706" },
        };
      });

    return { nodes: [...flow.nodes, ...proposedNodes], edges: [...flow.edges, ...proposedEdges] };
  }, [graph, proposals]);

  return (
    <div className="flex h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          变更集预览
          <Badge variant="outline" className="border-emerald-400 text-[10px] text-emerald-700">
            绿框 = 建议新增假设
          </Badge>
          <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">
            橙虚线 = 建议新增关系
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : !proposals || (proposals.length > 0 && !graph) ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-[50vh] rounded-xl" />
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesConnectable={false}
            nodesDraggable={false}
            panOnScroll
            zoomOnScroll={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
