"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, MessageSquareText, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { getIdeaVersionDetails, getVersionSources, type IdeaVersionDetails, type VersionSource } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { IdeaEvidenceList } from "./IdeaEvidenceList";
import { IdeaEvolutionHistory } from "./IdeaEvolutionHistory";
import { getIdea, type Idea } from "@/lib/api";
import { AddVersionDialog } from "@/components/add-version-dialog";
import { EvidenceLinkDialog } from "@/components/evidence-link-dialog";
import { RunCreateDialog } from "@/components/run-create-dialog";
import { NoteCreateDialog } from "@/components/note-create-dialog";
import { ResearchNotes, isNextNote } from "@/components/research-notes";
import { IdeaStatusSelect } from "@/components/idea-status-select";



export function IdeaDetailPanel({
  versionId,
  onClose,
  onSelectNode,
  onChanged,
}: {
  versionId: number;
  onClose: () => void;
  onSelectNode: (versionId: number) => void;
  onChanged: () => void;
}) {
  const [details, setDetails] = useState<IdeaVersionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [idea, setIdea] = useState<Idea | null>(null);
  const reload = () => { setRetryNonce((n) => n + 1); onChanged(); };

  useEffect(() => {
    let stale = false;
    getIdeaVersionDetails(versionId)
      .then(async (data) => {
        const fullIdea = await getIdea(data.idea.id);
        if (!stale) { setDetails(data); setIdea(fullIdea); setError(null); }
      })
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      stale = true;
    };
  }, [versionId, retryNonce]);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b px-4 py-3">
        <div className="min-w-0">
          {details ? (
            <>
              <CardTitle className="truncate text-sm">{details.idea.title}</CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  v{details.version.version_number}
                </Badge>
                <StatusBadge kind="idea" value={details.idea.status} />
                <Link
                  href={`/ideas/${details.idea.id}`}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[11px] hover:underline"
                >
                  打开假设工作区 <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClose} aria-label="关闭详情">
          <X className="size-4" />
        </Button>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
              <RotateCcw className="size-3.5" /> 重试
            </Button>
          </div>
        ) : !details ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <Tabs defaultValue="overview" className="flex h-full min-h-0 flex-col">
            <div className="border-b px-3 py-2 space-y-2">
              {idea && <div className="flex flex-wrap gap-2">
                <RunCreateDialog projectId={idea.project_id} researchIdeaId={idea.research_idea_id ?? undefined} initialVersionId={versionId} onCreated={reload} />
                <AddVersionDialog ideaId={idea.id} nextVersionNumber={Math.max(...idea.versions.map((v) => v.version_number)) + 1} currentBody={idea.versions.find((v) => v.id === idea.current_version_id)?.body} onCreated={reload} />
                <EvidenceLinkDialog mode="version" idea={idea} projectId={idea.project_id} initialVersionId={versionId} onLinked={reload} />
                <IdeaStatusSelect ideaId={idea.id} status={idea.status} onChanged={reload} />
              </div>}
              <TabsList className="h-8">
                <TabsTrigger value="overview" className="px-2 text-xs">概览</TabsTrigger>
                <TabsTrigger value="evolution" className="px-2 text-xs">演化</TabsTrigger>
                <TabsTrigger value="evidence" className="px-2 text-xs">
                  证据{details.evidence.length > 0 ? ` (${details.evidence.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="notes" className="px-2 text-xs">
                  笔记{details.notes.length > 0 ? ` (${details.notes.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="next" className="px-2 text-xs">下一步</TabsTrigger>
              </TabsList>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4">
                {/* key resets all tab state when the selected node changes */}
                <TabsContent key={versionId} value="overview" className="mt-0">
                  <OverviewSection details={details} />
                </TabsContent>
                <TabsContent key={versionId} value="evolution" className="mt-0">
                  <IdeaEvolutionHistory details={details} onSelectNode={onSelectNode} />
                </TabsContent>
                <TabsContent key={versionId} value="evidence" className="mt-0">
                  <IdeaEvidenceList evidence={details.evidence} />
                </TabsContent>
                <TabsContent key={versionId} value="notes" className="mt-0">
                  {idea && <NoteCreateDialog projectId={idea.project_id} ideas={[idea]} runs={[]} initialIdeaId={idea.id} onCreated={reload} />}
                  <ResearchNotes notes={details.notes.filter((n) => !isNextNote(n))} onChanged={reload} />
                </TabsContent>
                <TabsContent key={versionId} value="next" className="mt-0">
                  {idea && <NoteCreateDialog projectId={idea.project_id} ideas={[idea]} runs={[]} initialIdeaId={idea.id} nextStep onCreated={reload} />}
                  <ResearchNotes notes={details.notes.filter(isNextNote)} onChanged={reload} />
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewSection({ details }: { details: IdeaVersionDetails }) {
  const [sources, setSources] = useState<VersionSource[] | null>(null);
  useEffect(() => {
    let stale = false;
    getVersionSources(details.version.id)
      .then((data) => !stale && setSources(data))
      .catch(() => !stale && setSources([]));
    return () => {
      stale = true;
    };
  }, [details.version.id]);

  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-1 text-xs font-semibold">假设正文（v{details.version.version_number}）</h4>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{details.version.body}</p>
      </section>
      {details.version.change_reason && (
        <section>
          <h4 className="mb-1 text-xs font-semibold">来源 / 演化原因</h4>
          <p className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed italic">
            {details.version.change_reason}
          </p>
        </section>
      )}
      {/* conversation provenance (Phase 3) */}
      <section>
        <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold">
          <MessageSquareText className="size-3" /> 会话溯源
        </h4>
        {sources === null ? (
          <p className="text-muted-foreground text-[11px]">加载中…</p>
        ) : sources.length === 0 ? (
          <p className="text-muted-foreground text-[11px]">该版本来自手动创建，没有关联的 AI 对话。</p>
        ) : (
          <div className="space-y-1.5">
            {sources.map((source) => (
              <Link
                key={`${source.conversation_id}-${source.entity_type}-${source.entity_id}`}
                href={
                  source.job_id
                    ? `/analysis/${source.job_id}?msg=${source.message_ids[0] ?? ""}`
                    : `/projects/${details.idea.project_id}/conversations`
                }
                className="hover:bg-accent/50 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
              >
                <MessageSquareText className="text-muted-foreground size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {source.conversation_title ?? `会话 #${source.conversation_id}`}
                </span>
                <span className="text-muted-foreground font-mono text-[10px]">
                  m{source.message_ids.join(", m")}
                </span>
                <ArrowUpRight className="text-muted-foreground size-3" />
              </Link>
            ))}
            <p className="text-muted-foreground text-[10px]">
              点击可打开该次 AI 分析，定位到产生本版本的原始聊天消息。
            </p>
          </div>
        )}
      </section>
      <section className="text-muted-foreground space-y-1 border-t pt-3 text-[11px]">
        <div>版本创建：{fmtDateTime(details.version.created_at)}</div>
        <div>假设更新：{fmtDateTime(details.idea.updated_at)} · 假设创建：{fmtDateTime(details.idea.created_at)}</div>
        <div className="flex items-center gap-2">
          状态：
          <StatusBadge kind="idea" value={details.idea.status} />
          <span className="text-muted-foreground/70">（状态由研究者手动维护）</span>
        </div>
      </section>
    </div>
  );
}

export function PanelLoadingIndicator() {
  return <Loader2 className="size-4 animate-spin" />;
}
