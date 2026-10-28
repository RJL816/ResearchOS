import dagre from "@dagrejs/dagre";
import type { GraphEdge, GraphNode } from "@/lib/api";
import type { IdeaFlowEdge, IdeaFlowNode, LayoutDirection } from "./graph-types";

/** Must match the rendered IdeaNode card size closely (w-64 card ≈ 256px). */
export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 132;

interface DagrePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Count edges that close a cycle (gray-target hits in a DFS). The layout
 * engine tolerates cycles, but the UI warns the user so they can fix the data.
 */
export function detectCycleEdges(edges: Pick<GraphEdge, "source" | "target">[]): number {
  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<number, number>();
  let backEdges = 0;
  const visit = (node: number) => {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) backEdges += 1;
      else if (state === WHITE) visit(next);
    }
    color.set(node, BLACK);
  };
  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node);
  }
  return backEdges;
}

/**
 * Auto-layout with dagre. Handles DAGs with multiple roots, isolated nodes
 * and multiple parents; positions are view-only and never persisted.
 */
export function layoutIdeaGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: LayoutDirection,
): { nodes: IdeaFlowNode[]; edges: IdeaFlowEdge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction === "TB" ? "TB" : "LR",
    nodesep: 44,
    ranksep: 72,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(String(node.id), { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(String(edge.source), String(edge.target));
  }
  dagre.layout(graph);

  const flowNodes: IdeaFlowNode[] = nodes.map((node) => {
    const positioned = graph.node(String(node.id)) as DagrePosition | undefined;
    return {
      id: String(node.id), // stable DB version id, never an array index
      type: "idea" as const,
      position: {
        x: (positioned?.x ?? 0) - (positioned?.width ?? NODE_WIDTH) / 2,
        y: (positioned?.y ?? 0) - (positioned?.height ?? NODE_HEIGHT) / 2,
      },
      data: { graphNode: node, direction },
    };
  });

  const flowEdges: IdeaFlowEdge[] = edges.map((edge) => ({
    id: `e-${edge.id}`,
    source: String(edge.source),
    target: String(edge.target),
    type: "ideaEdge" as const,
    data: { db: edge },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}
