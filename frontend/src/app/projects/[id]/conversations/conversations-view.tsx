"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Copy,
  FileUp,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getAnalysisJob,
  getPayloadPreview,
  importConversation,
  listConversations,
  startAnalysis,
  uploadConversationFile,
  type AnalysisJobSummary,
  type Conversation,
  type ConversationImportResult,
  type PayloadPreview,
} from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

const SOURCE_LABEL: Record<string, string> = {
  paste: "粘贴",
  file_md: "Markdown",
  file_txt: "TXT",
  file_json: "JSON",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  parsing: "解析",
  extracting: "AI 提取",
  matching: "匹配现有 Idea",
  proposing: "生成提案",
  completed: "完成",
  failed: "失败",
};

export default function ConversationsView() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [jobs, setJobs] = useState<Record<number, AnalysisJobSummary>>({});
  const [error, setError] = useState<string | null>(null);

  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ConversationImportResult | null>(null);
  const [preview, setPreview] = useState<PayloadPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setConversations(await listConversations(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doImport = useCallback(
    async (source: "paste" | "file_md" | "file_txt" | "file_json", content: string, title?: string) => {
      setImporting(true);
      setError(null);
      setImportResult(null);
      setPreview(null);
      try {
        const result =
          source === "paste"
            ? await importConversation(projectId, { source, content, title })
            : await uploadConversationFile(projectId, content as unknown as File);
        setImportResult(result);
        setPasteText("");
        setPreview(await getPayloadPreview(result.conversation.id));
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setImporting(false);
      }
    },
    [projectId, load],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const suffix = file.name.toLowerCase().split(".").pop();
      if (!suffix || !["md", "markdown", "txt", "json"].includes(suffix)) {
        setError("仅支持 .md / .markdown / .txt / .json 文件");
        return;
      }
      await doImport(
        suffix === "json" ? "file_json" : suffix === "txt" ? "file_txt" : "file_md",
        file as unknown as string,
      );
    },
    [doImport],
  );

  const analyze = useCallback(async (conversationId: number) => {
    setError(null);
    try {
      const job = await startAnalysis(conversationId);
      setJobs((prev) => ({
        ...prev,
        [job.id]: {
          ...job,
          event_count: 0,
          proposal_count: 0,
          pending_count: 0,
          accepted_count: 0,
          applied_count: 0,
        },
      }));
      const timer = setInterval(async () => {
        try {
          const fresh = await getAnalysisJob(job.id);
          setJobs((prev) => ({ ...prev, [fresh.id]: fresh }));
          if (fresh.status === "completed" || fresh.status === "failed") clearInterval(timer);
        } catch {
          clearInterval(timer);
        }
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-page-title">
          <Brain className="text-primary size-5" />
          导入 AI 科研对话
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          粘贴或上传与 AI 的研究讨论，由 GLM 提取研究事件并生成待审核的图谱变更。
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">第一步：导入对话</CardTitle>
          <CardDescription>
            对话内容仅作为数据存储与分析，不会被执行；发送给 GLM 前会自动遮蔽疑似密钥，并按长度分段。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="paste">
            <TabsList>
              <TabsTrigger value="paste">粘贴文本</TabsTrigger>
              <TabsTrigger value="upload">上传文件</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="mt-3 space-y-3">
              <Label htmlFor="paste-area">对话内容（支持 user: / assistant: / 我: / AI: 角色标记）</Label>
              <Textarea
                id="paste-area"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={10}
                placeholder={"user: 我觉得 rank=8 就够了\nassistant: 在困难任务上可能不够，建议对比 rank=32。\nuser: 好，那就做消融实验。"}
                className="font-mono text-xs"
              />
              <Button onClick={() => void doImport("paste", pasteText)} disabled={importing || !pasteText.trim()}>
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                解析对话
              </Button>
            </TabsContent>
            <TabsContent value="upload" className="mt-3">
              <div
                className="hover:border-primary/50 flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed transition-standard"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) void handleFile(file);
                }}
              >
                <FileUp className="text-muted-foreground size-6" />
                <p className="text-sm">点击选择或拖拽 .md / .txt / .json 文件（≤2MB）</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = "";
                }}
              />
            </TabsContent>
          </Tabs>

          {importResult && (
            <div className="space-y-3">
              <Alert>
                <CheckCircle2 className="size-4" />
                <AlertTitle>
                  {importResult.deduplicated
                    ? "内容与已有导入相同，已返回原会话（幂等去重）"
                    : `解析成功：${importResult.conversation.message_count} 条消息`}
                </AlertTitle>
                <AlertDescription>
                  {importResult.warnings.join("；") || `会话「${importResult.conversation.title}」`}
                </AlertDescription>
              </Alert>

              <ScrollArea className="h-56 rounded-lg border p-3">
                <div className="space-y-2">
                  {importResult.conversation.messages.map((m) => (
                    <div key={m.id} id={`msg-${m.sequence}`} className="text-sm">
                      <span
                        className={`mr-2 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          m.role === "user"
                            ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300"
                            : "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300"
                        }`}
                      >
                        m{m.sequence} · {m.role}
                      </span>
                      <span className="whitespace-pre-wrap">{m.content.slice(0, 200)}</span>
                      {m.content.length > 200 && "…"}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {preview && (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <ShieldCheck className="text-success size-4" />
                  将发送 {preview.segment_count} 段（每段 ≤{preview.segment_max_chars} 字符）给 GLM；
                  已遮蔽 {preview.masked_chars} 处疑似密钥。
                </div>
              )}

              <Button onClick={() => void analyze(importResult.conversation.id)}>
                <Brain className="size-4" />
                第二步：开始 AI 分析
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">导入的会话与分析任务</CardTitle>
        </CardHeader>
        <CardContent>
          {conversations === null ? (
            <Skeleton className="h-24 w-full" />
          ) : conversations.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">还没有导入过对话。</p>
          ) : (
            <div className="space-y-3">
              {conversations.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conversation={conv}
                  job={jobs[conv.id]}
                  onAnalyze={() => void analyze(conv.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConversationRow({
  conversation,
  job,
  onAnalyze,
}: {
  conversation: Conversation;
  job?: AnalysisJobSummary;
  onAnalyze: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{conversation.title}</span>
          <Badge variant="outline" className="text-[10px]">
            {SOURCE_LABEL[conversation.source] ?? conversation.source}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          {conversation.message_count} 条消息 · {conversation.char_count} 字符 · {fmtDateTime(conversation.created_at)}
        </div>
      </div>
      {job && (
        <div className="flex items-center gap-2 text-xs">
          <Badge
            variant={job.status === "failed" ? "destructive" : job.status === "completed" ? "secondary" : "outline"}
          >
            {JOB_STATUS_LABEL[job.status] ?? job.status}
          </Badge>
          {job.status === "completed" && (
            <span className="text-muted-foreground">
              {job.event_count} 事件 / {job.proposal_count} 提案
              {job.pending_count > 0 ? `（${job.pending_count} 待审）` : ""}
            </span>
          )}
          {job.status === "completed" && (
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link href={`/analysis/${job.id}`}>进入审核</Link>
            </Button>
          )}
        </div>
      )}
      {!job && (
        <Button variant="outline" size="sm" onClick={onAnalyze}>
          <Brain className="size-3.5" />
          AI 分析
        </Button>
      )}
    </div>
  );
}
