"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EditProposalDialog } from "@/components/proposal-editor";
import { useRouteId } from "@/lib/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Eye,
  GitBranch,
  Loader2,
  MessageSquareText,
  Rocket,
  ShieldAlert,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";


import { ScrollArea } from "@/components/ui/scroll-area";


import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ResizeHandle, usePanelWidth, clampPanelWidth } from "@/components/resize-handle";
import { ProposalGraphPreview } from "@/components/idea-graph/ProposalGraphPreview";
import {
  applyProposals,
  getAnalysisJob,
  getConversation,
  getJobEvents,
  getJobProposals,
  reviewProposal,
  type AnalysisJobSummary,
  type ConversationMessageRead,
  type GraphChangeProposal,
  type ResearchEventRead,
  type ReviewStatus,
} from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

const ACTION_LABEL: Record<string, string> = {
  create_idea: "新增假设",
  create_idea_version: "新增版本",
  create_idea_edge: "新增演化关系",
  add_research_note: "添加研究笔记",
  add_open_question: "记录待解问题",
  propose_status_change: "修改假设状态",
  link_existing_idea: "关联现有假设",
};

const ACTION_GROUP: Record<string, string> = {
  create_idea: "create",
  create_idea_version: "modify",
  create_idea_edge: "relation",
  add_research_note: "note",
  add_open_question: "note",
  propose_status_change: "modify",
  link_existing_idea: "relation",
};

const EVENT_LABEL: Record<string, string> = {
  idea_created: "提出假设",
  idea_refined: "细化假设",
  idea_branched: "方向分支",
  idea_merged: "方向合并",
  idea_challenged: "假设受到质疑",
  idea_rejected: "放弃假设",
  research_decision: "研究决策",
  open_question: "待解问题",
  experiment_observation: "实验描述（未验证）",
};

function ReviewInner() {
  const jobId = useRouteId();
  const search = useSearchParams();
  const [reviewing, setReviewing] = useState(false);

  const [job, setJob] = useState<AnalysisJobSummary | null>(null);
  const [events, setEvents] = useState<ResearchEventRead[]>([]);
  const [proposals, setProposals] = useState<GraphChangeProposal[]>([]);
  const [messages, setMessages] = useState<ConversationMessageRead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [group, setGroup] = useState("all");
  const [highlightMsg, setHighlightMsg] = useState<number | null>(null);
  const [leftWidth, updateLeftWidth] = usePanelWidth("research-os-review-left", 480);
  const splitRowRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<GraphChangeProposal | null>(null);
  const [applyResult, setApplyResult] = useState<Awaited<ReturnType<typeof applyProposals>> | null>(null);
  const [applying, setApplying] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    try {
      const [jobData, eventsData, proposalsData] = await Promise.all([
        getAnalysisJob(jobId),
        getJobEvents(jobId),
        getJobProposals(jobId),
      ]);
      setJob(jobData);
      setEvents(eventsData);
      setProposals(proposalsData);
      const conv = await getConversation(jobData.conversation_id);
      setMessages(conv.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
    void load();
  }, [load]);

  const review = useCallback(
    async (proposal: GraphChangeProposal, status: ReviewStatus, edits?: Record<string, unknown>) => {
      setError(null); setReviewing(true);
      try {
        const fresh = await reviewProposal(proposal.id, { review_status: status, edits });
        setProposals((prev) => prev.map((p) => (p.id === fresh.id ? fresh : p)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally { setReviewing(false); }
    },
    [],
  );

  const doApply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const accepted = proposals.filter((p) => p.review_status === "accepted").map((p) => p.id);
      const result = await applyProposals(jobId, accepted);
      setApplyResult(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [jobId, proposals, load]);

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const visibleProposals = useMemo(
    () => (group === "all" ? proposals : proposals.filter((p) => ACTION_GROUP[p.action_type] === group)),
    [proposals, group],
  );

  const pendingCount = proposals.filter((p) => p.review_status === "pending").length;
  const acceptedCount = proposals.filter((p) => p.review_status === "accepted").length;

  const jumpToMessage = useCallback((messageId: number) => {
    const message = messageById.get(messageId);
    if (!message) return;
    setHighlightMsg(messageId);
    document.getElementById(`msg-anchor-${message.sequence}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [messageById]);

  useEffect(() => {
    if (loading) return;
    const id = Number(search.get("msg"));
    if (messageById.has(id)) {
      const frame = requestAnimationFrame(() => jumpToMessage(id));
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, search, messageById, jumpToMessage]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-[70vh] rounded-xl" />
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>无法加载分析任务</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${job.project_id}/analysis`} className="text-muted-foreground hover:text-foreground text-sm">
            ← 全部分析与待审事项
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <GitBranch className="size-5 text-primary" />
            AI 分析审核 #{job.id}
            <Badge variant={job.status === "failed" ? "destructive" : job.status === "completed" ? "secondary" : "outline"}>
              {job.status === "completed" ? "分析完成" : job.status === "failed" ? "失败" : job.status}
            </Badge>
          </h1>
          <p className="text-muted-foreground mt-0.5 text-xs">
            模型 {job.model || "—"} · Prompt {job.prompt_version} · {job.segment_count} 段 · 完成于 {fmtDateTime(job.finished_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="size-4" />
            {showPreview ? "隐藏图预览" : "已接受变更预览"}
          </Button>
          <Button onClick={() => void doApply()} disabled={applying || reviewing || acceptedCount === 0}>
            {applying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            应用已接受的变更（{acceptedCount}）
          </Button>
        </div>
      </div>

      {job.error && (
        <Alert variant={job.status === "failed" ? "destructive" : "default"}>
          <ShieldAlert className="size-4" />
          <AlertTitle>{job.status === "failed" ? "分析失败" : "分析完成，但有部分事件被丢弃"}</AlertTitle>
          <AlertDescription>{job.error}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {applyResult && (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>
            应用完成：{applyResult.applied.length} 成功 · {applyResult.blocked.length} 被拦截 · {applyResult.skipped.length} 跳过（批次 #{applyResult.batch_id}）
          </AlertTitle>
          <AlertDescription>
            {applyResult.blocked.length > 0
              ? `被拦截：${applyResult.blocked.map((b) => `#${b.proposal_id} ${b.reason}`).join("；")}`
              : "变更已写入图谱，可在演化图谱中查看，节点详情可追溯本会话。"}
          </AlertDescription>
          <div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm"><Link href={`/projects/${job.project_id}`}>查看更新后的研究记录</Link></Button><Button asChild size="sm" variant="outline"><Link href={`/projects/${job.project_id}/hypotheses/graph${applyResult.applied.find((p) => p.version_id)?.version_id ? `?node=${applyResult.applied.find((p) => p.version_id)?.version_id}` : ""}`}>在图谱中定位</Link></Button></div>
        </Alert>
      )}

      {job.status !== "completed" && <div className="flex items-center gap-3 text-sm"><span>{job.status === "failed" ? "请返回对话页面重试分析。" : "分析仍在进行，完成后刷新查看提案。"}</span><Button variant="outline" onClick={() => void load()}>刷新状态</Button><Button asChild variant="ghost"><Link href={`/projects/${job.project_id}/conversations`}>返回导入讨论</Link></Button></div>}
      <div className="flex min-h-0 flex-1" ref={splitRowRef}>
        {/* left: original conversation (drag the divider to resize) */}
        <Card className="flex shrink-0 flex-col overflow-hidden" style={{ width: leftWidth }}>
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquareText className="size-4" />
              原始对话
            </CardTitle>
            <CardDescription className="text-xs">点击提案卡片的来源消息可定位到此处。</CardDescription>
          </CardHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  id={`msg-anchor-${m.sequence}`}
                  className={`rounded-lg border p-3 text-sm transition-colors ${
                    highlightMsg === m.id ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40" : ""
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] ${
                        m.role === "user"
                          ? "border-sky-300 text-sky-700 dark:text-sky-300"
                          : "border-violet-300 text-violet-700 dark:text-violet-300"
                      }`}
                    >
                      m{m.sequence} · {m.role}
                    </Badge>
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>

        <ResizeHandle
          onResize={(clientX) => {
            const row = splitRowRef.current;
            if (!row) return;
            const rect = row.getBoundingClientRect();
            updateLeftWidth(clampPanelWidth(clientX - rect.left, rect.width, 320));
          }}
          onNudge={(delta) => updateLeftWidth(clampPanelWidth(leftWidth + delta, window.innerWidth * 0.9, 320))}
          onReset={() => updateLeftWidth(480)}
          ariaLabel="拖拽调整对话栏宽度"
        />

        {/* right: proposals */}
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="border-b px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">
                AI 提案（{pendingCount} 待审 / {proposals.length} 总计）
              </CardTitle>
              <Tabs value={group} onValueChange={setGroup}>
                <TabsList className="h-7">
                  <TabsTrigger value="all" className="px-2 text-xs">全部</TabsTrigger>
                  <TabsTrigger value="create" className="px-2 text-xs">新增</TabsTrigger>
                  <TabsTrigger value="modify" className="px-2 text-xs">修改</TabsTrigger>
                  <TabsTrigger value="relation" className="px-2 text-xs">关系</TabsTrigger>
                  <TabsTrigger value="note" className="px-2 text-xs">笔记</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-4">
              {visibleProposals.length === 0 ? (
                <p className="text-muted-foreground py-10 text-center text-sm">没有该类别的提案。</p>
              ) : (
                visibleProposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    event={proposal.event_id ? eventById.get(proposal.event_id) : undefined}
                    onJump={jumpToMessage}
                    messageLabels={Object.fromEntries(messages.map((m) => [m.id, m.sequence]))}
                    dependencies={proposal.depends_on_proposal_ids.map((id) => proposals.find((p) => p.id === id)).filter((p): p is GraphChangeProposal => !!p)}
                    busy={reviewing || applying}
                    onReview={review}
                    onEdit={() => setEditing(proposal)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {editing && (
        <EditProposalDialog
          proposal={editing}
          onClose={() => setEditing(null)}
          onSaved={(fresh) => {
            setProposals((prev) => prev.map((p) => (p.id === fresh.id ? fresh : p)));
            setEditing(null);
          }}
        />
      )}

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setShowPreview(false)}>
          <div className="bg-background max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border shadow-lg" onClick={(e) => e.stopPropagation()}>
            <ProposalGraphPreview jobId={jobId} onClose={() => setShowPreview(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function CheckCircle2Icon() {
  return <Check className="size-4" />;
}

function ProposalCard({
  proposal,
  event,
  onJump,
  onReview,
  onEdit,
  messageLabels,
  dependencies,
  busy,
}: {
  proposal: GraphChangeProposal;
  event?: ResearchEventRead;
  onJump: (messageId: number) => void;
  onReview: (proposal: GraphChangeProposal, status: ReviewStatus) => void;
  onEdit: () => void;
  messageLabels: Record<number, number>;
  dependencies: GraphChangeProposal[];
  busy: boolean;
}) {
  const statusColor: Record<ReviewStatus, string> = {
    pending: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    accepted: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    rejected: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    needs_revision: "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    applied: "border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  };
  const statusLabel: Record<ReviewStatus, string> = {
    pending: "待审核",
    accepted: "已接受",
    rejected: "已拒绝",
    needs_revision: "需修改",
    applied: "已应用",
  };
  const payload = proposal.payload as Record<string, string | number | null>;
  const uncertainty = event?.uncertainty ?? "medium";

  return (
    <div className={`rounded-xl border p-4 ${proposal.review_status === "applied" ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-medium">
          {ACTION_LABEL[proposal.action_type] ?? proposal.action_type}
        </Badge>
        {event && (
          <Badge variant="outline" className="text-[10px]">
            {EVENT_LABEL[event.event_type] ?? event.event_type}
          </Badge>
        )}
        {uncertainty === "high" && (
          <Badge variant="destructive" className="text-[10px]">
            <ShieldAlert className="mr-1 size-3" />
            高不确定性
          </Badge>
        )}
        <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${statusColor[proposal.review_status]}`}>
          {statusLabel[proposal.review_status]}
        </span>
      </div>

      <h4 className="mt-2 text-sm font-semibold">
        {String(payload.title ?? payload.relation ?? proposal.action_type)}
        {payload.status ? ` → ${String(payload.status)}` : ""}
      </h4>
      <p className="text-muted-foreground mt-1 line-clamp-3 text-xs leading-relaxed">
        {String(payload.body ?? payload.content ?? payload.note ?? proposal.explanation)}
      </p>
      {event && (
        <p className="text-muted-foreground mt-1 text-[11px] italic">
          判定依据：{event.reasoning} · 证据类型 {event.evidence_type}
          {event.match_status === "needs_review" && " · ⚠ 未自动匹配到现有假设，请人工确认目标"}
        </p>
      )}
      {dependencies.length > 0 && <p className="mt-2 text-xs text-muted-foreground">依赖提案：{dependencies.map((p) => `#${p.id} ${p.payload.title ?? ACTION_LABEL[p.action_type]}（${p.review_status === "applied" ? "已应用" : p.review_status === "accepted" ? "已接受" : p.review_status === "rejected" ? "已拒绝，应用将被拦截" : "需先审核"}）`).join("；")}</p>}
      {proposal.review_note && (
        <p className="mt-1 text-[11px] text-orange-600">系统备注：{proposal.review_note}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-[11px]">来源：</span>
        {proposal.source_message_ids.map((messageId) => (
          <button
            key={messageId}
            type="button"
            onClick={() => onJump(messageId)}
            className="bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono text-[10px] hover:underline"
          >
            m{messageLabels[messageId] ?? messageId}
            <ChevronRight className="inline size-2.5" />
          </button>
        ))}
      </div>

      {proposal.review_status !== "applied" && (
        <fieldset disabled={busy} className="mt-3 flex gap-2 disabled:opacity-50">
          <Button size="sm" variant="outline" className="h-7" onClick={onEdit}>
            编辑
          </Button>
          <Button size="sm" className="h-7" onClick={() => onReview(proposal, "accepted")}>
            <Check className="size-3.5" />
            接受
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onReview(proposal, "rejected")}>
            <X className="size-3.5" />
            拒绝
          </Button>
        </fieldset>
      )}
    </div>
  );
}


export default function ReviewView() {
  return <ReviewInner />;
}
