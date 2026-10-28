"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouteId, usePathname, useRouter } from "@/lib/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from "@xyflow/react";
import { GitBranch, MessageSquarePlus, Sparkles, MousePointerClick, Plus, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getProject, getProjectIdeaGraph, getProposalSummary, type GraphEdge, type GraphNode, type Project, type ProjectIdeaGraph, type ProposalSummary } from "@/lib/api";
import { ResizeHandle, usePanelWidth, clampPanelWidth } from "@/components/resize-handle";
import { fmtDateTime } from "@/lib/format";
import { GraphToolbar } from "./GraphToolbar";
import { IdeaCreateDialog } from "@/components/idea-create-dialog";
import { IdeaEdge } from "./IdeaEdge";
import { IdeaNode } from "./IdeaNode";
import { IdeaDetailPanel } from "./IdeaDetailPanel";
import { NODE_HEIGHT, NODE_WIDTH, detectCycleEdges, layoutIdeaGraph } from "./graph-layout";
import {
  RELATION_META,
  type GraphSelection,
  type IdeaFlowEdge,
  type IdeaFlowNode,
  type LayoutDirection,
} from "./graph-types";

const NODE_TYPES = { idea: IdeaNode };
const EDGE_TYPES = { ideaEdge: IdeaEdge };

const STATUS_LABELS: Record<string, string> = {
  exploring: "探索中",
  testing: "验证中",
  validated: "已验证",
  refuted: "已否证",
  parked: "搁置",
  inconclusive: "证据不足",
};

/** Radix portals escape CSS wrappers, so panel variant must be chosen in JS. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function IdeaGraphView() {
  // useReactFlow() requires the provider context, so the real view lives inside.
  return (
    <ReactFlowProvider>
      <IdeaGraphInner />
    </ReactFlowProvider>
  );
}

function IdeaGraphInner() {
  const projectId = useRouteId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Hooks must run unconditionally (before the loading/error early returns).
  const isDesktop = useIsDesktop();

  const [project, setProject] = useState<Project | null>(null);
  const [graph, setGraph] = useState<ProjectIdeaGraph | null>(null);
  const [proposalSummary, setProposalSummary] = useState<ProposalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showMinimap, setShowMinimap] = useState(true);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const cycleEdges = useMemo(() => detectCycleEdges(graph?.edges ?? []), [graph]);
  const [resetNonce, setResetNonce] = useState(0);
  const [matchCursor, setMatchCursor] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelWidth, updatePanelWidth] = usePanelWidth("research-os-graph-panel", 400);
  const splitRowRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<IdeaFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<IdeaFlowEdge>([]);
  const { fitView, setCenter } = useReactFlow();
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const load = useCallback(async () => {
    try {
      const [projectData, graphData] = await Promise.all([
        getProject(projectId),
        getProjectIdeaGraph(projectId),
      ]);
      setProject(projectData);
      setGraph(graphData);
      getProposalSummary(projectId)
        .then(setProposalSummary)
        .catch(() => setProposalSummary(null));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
    void load();
  }, [load]);

  /* ------------------------- filtering + layout ------------------------- */

  const visibleNodes = useMemo(
    () =>
      graph ? graph.nodes.filter((node) => statusFilter === "all" || node.status === statusFilter) : [],
    [graph, statusFilter],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () =>
      graph
        ? graph.edges.filter(
            (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
          )
        : [],
    [graph, visibleNodeIds],
  );

  useEffect(() => {
    if (!graph) return;
    const laid = layoutIdeaGraph(visibleNodes, visibleEdges, direction);
    setNodes(laid.nodes);
    setEdges(laid.edges);
    const frame = requestAnimationFrame(() => { void fitView({ padding: 0.18, duration: 400 }); });
    return () => cancelAnimationFrame(frame);
  }, [graph, visibleNodes, visibleEdges, direction, resetNonce, setNodes, setEdges, fitView]);

  const initialNode = Number(searchParams.get("node"));
  useEffect(() => {
    if (!graph || selection !== null || !graph.nodes.some((node) => node.id === initialNode)) return;
    // Defer selection until React Flow has committed the laid out nodes.
    const frame = requestAnimationFrame(() => setSelection({ type: "node", id: initialNode }));
    return () => cancelAnimationFrame(frame);
  }, [graph, initialNode, selection]);

  const focusNode = useCallback(
    (id: number) => {
      const node = nodesRef.current.find((item) => item.id === String(id));
      if (!node) return;
      void setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
        zoom: 1.05,
        duration: 500,
      });
    },
    [setCenter],
  );

  const selectNode = useCallback(
    (id: number, options?: { focus?: boolean }) => {
      setSelection({ type: "node", id });
      router.replace(`${pathname}?node=${id}`, { scroll: false });
      if (options?.focus) focusNode(id);
    },
    [router, pathname, focusNode],
  );

  const deselect = useCallback(() => {
    setSelection(null);
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(Number(node.id));
    },
    [selectNode],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    const db = (edge as IdeaFlowEdge).data?.db;
    if (db) setSelection({ type: "edge", edge: db });
  }, []);

  /* ------------------------------- search ------------------------------- */

  const query = search.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!query || !graph) return [] as number[];
    return visibleNodes
      .filter(
        (node) =>
          node.title.toLowerCase().includes(query) || node.summary.toLowerCase().includes(query),
      )
      .map((node) => node.id);
  }, [graph, visibleNodes, query]);
  const matchIdSet = useMemo(() => new Set(matchIds), [matchIds]);

  const locateNext = useCallback(() => {
    if (matchIds.length === 0) return;
    const id = matchIds[matchCursor % matchIds.length];
    setMatchCursor((cursor) => cursor + 1);
    selectNode(id, { focus: true });
  }, [matchIds, matchCursor, selectNode]);

  /* ------------------------- derived view state ------------------------- */

  const selectedNodeId = selection?.type === "node" ? selection.id : null;

  // Ancestor path + direct children of the selection; everything else dims.
  const focusIds = useMemo(() => {
    if (selectedNodeId === null) return null;
    const related = new Set<number>([selectedNodeId]);
    const incoming = new Map<number, number[]>();
    const outgoing = new Map<number, number[]>();
    for (const edge of edges) {
      (incoming.get(Number(edge.target)) ?? incoming.set(Number(edge.target), []).get(Number(edge.target))!).push(Number(edge.source));
      (outgoing.get(Number(edge.source)) ?? outgoing.set(Number(edge.source), []).get(Number(edge.source))!).push(Number(edge.target));
    }
    const walk = (id: number, next: Map<number, number[]>, visited: Set<number>) => {
      for (const parent of next.get(id) ?? []) {
        if (!visited.has(parent)) {
          visited.add(parent);
          walk(parent, next, visited);
        }
      }
    };
    const ancestors = new Set<number>();
    walk(selectedNodeId, incoming, ancestors);
    ancestors.forEach((id) => related.add(id));
    for (const child of outgoing.get(selectedNodeId) ?? []) related.add(child); // direct branches only
    return related;
  }, [selectedNodeId, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isMatch: matchIdSet.has(Number(node.id)),
          dimmed: focusIds !== null && !focusIds.has(Number(node.id)),
        },
      })),
    [nodes, matchIdSet, focusIds],
  );

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const src = Number(edge.source);
        const dst = Number(edge.target);
        const related =
          selectedNodeId !== null &&
          focusIds !== null &&
          focusIds.has(src) &&
          focusIds.has(dst) &&
          (src === selectedNodeId || dst === selectedNodeId || (focusIds.has(src) && focusIds.has(dst)));
        return related ? { ...edge, data: { ...edge.data!, related: true } } : edge;
      }),
    [edges, selectedNodeId, focusIds],
  );

  const statusOptions = useMemo(() => {
    const present = new Set(graph?.nodes.map((node) => node.status) ?? []);
    return [...present].map((status) => ({ value: status, label: STATUS_LABELS[status] ?? status }));
  }, [graph]);

  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  );

  /* ------------------------------- render ------------------------------- */

  if (loading) {
    return (
      <div className="mx-auto max-w-[1700px] space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-[60vh] w-full rounded-xl" />
      </div>
    );
  }

  if (loadError || !project || !graph) {
    return (
      <div className="mx-auto max-w-[1700px] space-y-4">
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>无法加载演化图谱</AlertTitle>
          <AlertDescription>{loadError ?? "项目不存在"}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => void load()}>
          重试
        </Button>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="mx-auto max-w-[1700px] space-y-4">
        <Link
          href={`/projects/${projectId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← 返回项目
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <GitBranch className="text-muted-foreground size-8" />
            <p className="font-medium">该项目还没有假设，暂无演化图谱</p>
            <p className="text-muted-foreground max-w-md text-sm">
              先创建研究假设（Idea），随着版本演进与分支派生，图谱会自动生长。
            </p>
            <Button asChild>
              <Link href={`/projects/${projectId}`}>
                <Plus className="size-4" />
                去创建第一个假设
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectFromPanel = (id: number) => selectNode(id, { focus: true });
  const panelContent = selection === null ? null : selection.type === "node" ? (
    <IdeaDetailPanel
      key={selection.id}
      versionId={selection.id}
      onClose={deselect}
      onSelectNode={selectFromPanel}
      onChanged={load}
    />
  ) : (
    <EdgeDetailCard
      edge={selection.edge}
      nodeById={nodeById}
      onClose={deselect}
      onSelectNode={selectFromPanel}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* single compact header row: title inline with toolbar and actions */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <h1 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
          <GitBranch className="text-primary size-4" />
          假设演化图谱
        </h1>
        <GraphToolbar
          direction={direction}
          onDirectionChange={setDirection}
          statusOptions={statusOptions}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          search={search}
          onSearchChange={(value) => { setSearch(value); setMatchCursor(0); }}
          matchCount={matchIds.length}
          onLocateNext={locateNext}
          minimap={showMinimap}
          onMinimapChange={setShowMinimap}
          onFit={() => void fitView({ padding: 0.18, duration: 400 })}
          onResetLayout={() => setResetNonce((nonce) => nonce + 1)}
          visibleCount={visibleNodes.length}
          totalCount={graph.nodes.length}
        />
        <div className="ml-auto flex items-center gap-2">
          <IdeaCreateDialog projectId={projectId} onCreated={load} />
          {proposalSummary && proposalSummary.total_count > 0 && (
            <Button
              asChild
              variant={proposalSummary.pending_count > 0 ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
            >
              <Link
                href={
                  `/projects/${projectId}/analysis`
                }
              >
                <Sparkles className="size-3.5" />
                AI 提案
                {proposalSummary.pending_count > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5">
                    {proposalSummary.pending_count}
                  </Badge>
                )}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-7 text-xs">
            <Link href={`/projects/${projectId}/conversations`}>
              <MessageSquarePlus className="size-3.5" />
              导入对话
            </Link>
          </Button>
        </div>
      </div>

      {cycleEdges > 0 && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          检测到 {cycleEdges} 条环形演化关系，布局已自动断环以便显示；请回查关系数据是否录入有误。
        </div>
      )}

      <div className="flex min-h-0 flex-1" ref={splitRowRef}>
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={deselect}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.15}
            maxZoom={2}
            nodesConnectable={false}
            deleteKeyCode={null}
            nodesFocusable
            edgesFocusable
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            {showMinimap && <MiniMap pannable zoomable />}
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
          {visibleNodes.length === 0 && (
            <div className="bg-background/70 absolute inset-0 flex items-center justify-center">
              <p className="text-muted-foreground text-sm">当前筛选条件下没有可见节点</p>
            </div>
          )}
        </div>

        {isDesktop && !panelCollapsed && (
          <>
            <ResizeHandle
              onResize={(clientX) => {
                const row = splitRowRef.current;
                if (!row) return;
                const rect = row.getBoundingClientRect();
                updatePanelWidth(clampPanelWidth(rect.right - clientX, rect.width));
              }}
              onNudge={(delta) => updatePanelWidth(clampPanelWidth(panelWidth + delta, window.innerWidth * 0.9))}
              onReset={() => updatePanelWidth(400)}
            />
            <aside className="flex shrink-0 flex-col border-l" style={{ width: panelWidth }}>
              {panelContent ?? (
                <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                  <MousePointerClick className="size-6" />
                  <p className="text-sm">点击左侧节点查看详情</p>
                  <p className="text-xs">支持概览、演化历史、实验证据与研究笔记</p>
                </div>
              )}
            </aside>
          </>
        )}
        {isDesktop && (
          <button
            type="button"
            onClick={() => setPanelCollapsed((v) => !v)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground w-6 shrink-0 border-l text-[10px] transition-standard"
            aria-label={panelCollapsed ? "展开详情面板" : "折叠详情面板"}
            title={panelCollapsed ? "展开详情面板" : "折叠详情面板"}
          >
            {panelCollapsed ? "‹" : "›"}
          </button>
        )}
      </div>

      {/* Mobile detail drawer (portal escapes CSS, so gate by viewport in JS) */}
      {!isDesktop && (
        <Sheet
          open={selection !== null}
          onOpenChange={(open) => {
            if (!open) deselect();
          }}
        >
          <SheetContent side="right" className="w-[88vw] max-w-sm gap-0 p-2">
            {panelContent}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function EdgeDetailCard({
  edge,
  nodeById,
  onClose,
  onSelectNode,
}: {
  edge: GraphEdge;
  nodeById: Map<number, GraphNode>;
  onClose: () => void;
  onSelectNode: (id: number) => void;
}) {
  const meta = RELATION_META[edge.relation] ?? RELATION_META.revision;
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl">
      <div className="flex items-start justify-between border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]" style={{ color: meta.color, borderColor: meta.color }}>
              {meta.label} · {meta.en}
            </Badge>
            <span className="text-sm font-semibold">演化关系详情</span>
          </div>
          <p className="text-muted-foreground mt-1 text-[11px]">建立于 {fmtDateTime(edge.created_at)}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="关闭">
          ✕
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <button
          type="button"
          onClick={() => onSelectNode(edge.source)}
          className="hover:bg-accent/50 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="text-muted-foreground block text-[10px]">源版本（from）</span>
            <span className="block truncate text-sm font-medium">
              {source ? `${source.title} · v${source.version}` : `#${edge.source}`}
            </span>
          </span>
          <span className="text-muted-foreground font-mono text-xs">#{edge.source}</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectNode(edge.target)}
          className="hover:bg-accent/50 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="text-muted-foreground block text-[10px]">目标版本（to）</span>
            <span className="block truncate text-sm font-medium">
              {target ? `${target.title} · v${target.version}` : `#${edge.target}`}
            </span>
          </span>
          <span className="text-muted-foreground font-mono text-xs">#{edge.target}</span>
        </button>
        <div className="rounded-lg border bg-muted/30 p-3">
          <h4 className="mb-1 text-xs font-semibold">关系原因</h4>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {edge.reason ?? "（未记录原因）"}
          </p>
        </div>
      </div>
    </Card>
  );
}
