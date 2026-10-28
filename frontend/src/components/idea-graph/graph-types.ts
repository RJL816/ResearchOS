import type { Edge, Node } from "@xyflow/react";
import type { EdgeRelation, GraphEdge, GraphNode } from "@/lib/api";

export type LayoutDirection = "TB" | "LR";

/** Data carried by an "idea" React Flow node. */
export interface IdeaNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
  direction: LayoutDirection;
  isMatch?: boolean;
  /** true when the node is outside the selected path (visually dimmed) */
  dimmed?: boolean;
  /** true when the node is a proposed (not yet applied) node in previews */
  proposed?: boolean;
}

export type IdeaFlowNode = Node<IdeaNodeData, "idea">;

/** Data carried by an "ideaEdge" React Flow edge. */
export interface IdeaEdgeData extends Record<string, unknown> {
  db: GraphEdge;
  /** true when the edge touches the currently selected node */
  related?: boolean;
}

export type IdeaFlowEdge = Edge<IdeaEdgeData>;

/** Display metadata per relation (DB value -> label). */
export const RELATION_META: Record<
  EdgeRelation,
  { label: string; en: string; color: string; dashed?: boolean }
> = {
  revision: { label: "改进", en: "refines", color: "#64748b" },
  derivation: { label: "分支", en: "branches_from", color: "#0284c7" },
  merge: { label: "合并", en: "combines", color: "#7c3aed" },
  challenges: { label: "质疑", en: "challenges", color: "#d97706", dashed: true },
  supersedes: { label: "替代", en: "supersedes", color: "#dc2626", dashed: true },
};

export type GraphSelection =
  | { type: "node"; id: number }
  | { type: "edge"; edge: GraphEdge }
  | null;
