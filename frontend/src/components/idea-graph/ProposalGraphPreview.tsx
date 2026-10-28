"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
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
    const graphNodes: GraphNode[] = (graph?.nodes ?? []).map((n) => ({ ...n }));
    const graphEdges: GraphEdge[] = [...(graph?.edges ?? [])];
    const accepted = (proposals ?? []).filter((p) => p.review_status === "accepted");
    const resolved = new Map<number, { idea: number; version: number }>();
    const current = new Map<number, number>();
    for (const n of graphNodes) {
      const prev = graphNodes.find((v) => v.id === current.get(n.idea_id));
      if (!prev || n.version > prev.version) current.set(n.idea_id, n.id);
    }
    const resolve = (value: unknown, kind: "idea" | "version"): number | undefined => {
      if (typeof value === "number") return value;
      if (value && typeof value === "object" && "proposal_ref" in value) return resolved.get(Number(value.proposal_ref))?.[kind];
      return undefined;
    };
    const remaining = [...accepted];
    const applied = new Set((proposals ?? []).filter((p) => p.review_status === "applied").map((p) => p.id));
    let progressed = true;
    while (remaining.length && progressed) {
      progressed = false;
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i];
        if (p.depends_on_proposal_ids.some((id) => !resolved.has(id) && !applied.has(id))) continue;
        const payload = p.payload;
        if (p.action_type === "create_idea" || p.action_type === "create_idea_version") {
          const ideaId = p.action_type === "create_idea" ? -p.id : resolve(payload.idea_id, "idea");
          if (ideaId === undefined) continue;
          const previousId = current.get(ideaId);
          const previous = graphNodes.find((n) => n.id === previousId);
          const node: GraphNode = { id: -p.id, idea_id: ideaId, title: String(payload.title ?? previous?.title ?? "新增版本"), summary: String(payload.body ?? "").slice(0, 140), status: previous?.status ?? "exploring", version: (previous?.version ?? 0) + 1, change_reason: String(payload.change_reason ?? ""), evidence_count: 0, run_count: 0, supports_count: 0, refutes_count: 0, created_at: p.created_at };
          graphNodes.push(node); current.set(ideaId, node.id);
          resolved.set(p.id, { idea: ideaId, version: node.id });
          if (previousId !== undefined) graphEdges.push({ id: -p.id, source: previousId, target: node.id, relation: "revision", reason: null, created_at: p.created_at });
        } else if (p.action_type === "create_idea_edge") {
          const source = resolve(payload.src_version_id, "version"), target = resolve(payload.dst_version_id, "version");
          if (source === undefined || target === undefined) continue;
          graphEdges.push({ id: -p.id, source, target, relation: payload.relation as GraphEdge["relation"], reason: null, created_at: p.created_at });
          resolved.set(p.id, { idea: 0, version: 0 });
        } else {
          const ideaId = resolve(payload.idea_id, "idea");
          if (p.action_type === "propose_status_change") for (const node of graphNodes) if (node.idea_id === ideaId) node.status = payload.status as GraphNode["status"];
          resolved.set(p.id, { idea: ideaId ?? 0, version: current.get(ideaId ?? 0) ?? 0 });
        }
        applied.add(p.id); remaining.splice(i--, 1); progressed = true;
      }
    }
    const flow = layoutIdeaGraph(graphNodes, graphEdges, "TB");
    return { nodes: flow.nodes.map((node) => ({ ...node, data: { ...node.data, proposed: Number(node.id) < 0 } })), edges: flow.edges.map((edge) => Number(edge.data?.db.id) < 0 ? { ...edge, style: { stroke: "#d97706", strokeDasharray: "6 4" } } : edge) };
  }, [graph, proposals]);

  return (
    <div className="flex h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          已接受变更的图谱预览
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
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">仅展示已接受提案的假设与关系；笔记不显示为节点。最终应用仍会检查依赖、重复和版本冲突。</p>
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
