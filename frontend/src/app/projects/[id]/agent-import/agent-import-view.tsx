"use client";

import Link from "next/link";
import { useRouteId } from "@/lib/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  RotateCcw,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/toast";
import {
  agentImport,
  type AgentParseResult,
  getAgentPrompts,
  type AgentImportItem,
  type AgentImportResult,
  type AgentPromptInfo,
} from "@/lib/api";
import { useSessionState, useSessionStorageWarning } from "@/lib/session-state";
import { useParseJob } from "@/lib/use-parse-job";
import { ParseProgress } from "@/components/parse-progress";

const KIND_LABEL: Record<string, string> = {
  parse: "解析",
  idea: "假设",
  idea_version: "假设版本",
  run: "实验",
  evidence: "证据",
  note: "笔记",
};

export default function AgentImportView() {
  const projectId = useRouteId();
  const { toast } = useToast();

  const [prompts, setPrompts] = useState<AgentPromptInfo[] | null>(null);
  const key = `research-os:agent-import:${projectId}`;
  const [activeKey, setActiveKey] = useSessionState<AgentPromptInfo["key"]>(`${key}:module`, "session");
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useSessionState(`${key}:content`, "");
  const [preview, setPreview] = useSessionState<AgentImportResult | null>(`${key}:preview`, null);
  const [result, setResult] = useSessionState<AgentImportResult | null>(`${key}:result`, null);
  const [previewInput, setPreviewInput] = useSessionState(`${key}:preview-input`, "");
  const [parsed, setParsed] = useSessionState<AgentParseResult | null>(`${key}:parsed`, null);
  const [applying, setWorking] = useState(false);
  const storageWarning = useSessionStorageWarning();
  const job = useParseJob<{parsed: AgentParseResult; imported: AgentImportResult | null}>(key, projectId, (output) => {
    setParsed(output.parsed);
    setPreviewInput(`${projectId}:${activeKey}:${content}`);
    setPreview(output.imported ? null : output.parsed.preview);
    setResult(output.imported);
    if (output.imported?.ok) setContent("");
  });
  const working = applying || job.pending;

  useEffect(() => {
    getAgentPrompts()
      .then((data) => setPrompts(data.prompts))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const active = prompts?.find((p) => p.key === activeKey);

  const copyPrompt = useCallback(async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.prompt);
      toast("提示词已复制，粘贴给你的 AI 助手即可", "success");
    } catch {
      toast("复制失败，请手动全选复制", "warning");
    }
  }, [active, toast]);

  const runImport = useCallback(
    async (dryRun: boolean, autoImport = false) => {
      if (!content.trim() || (!dryRun && previewInput !== `${projectId}:${activeKey}:${content}`)) return;
      setError(null);
      if (dryRun) {
        setParsed(null); setPreview(null); setResult(null); setPreviewInput("");
        job.start(autoImport ? "agent_auto" : "agent", { module: activeKey, content });
        return;
      }
      setWorking(true);
      try {
        if (!parsed) return;
        const imported = await agentImport(projectId, { module: activeKey, content: parsed.normalized, dry_run: false });
        setResult(imported);
        setPreview(null);
        if (imported.ok) setContent("");
        toast(imported.ok ? `导入完成：${imported.created.length} 项创建` : `导入完成，但有 ${imported.errors.length} 项失败`, imported.ok ? "success" : "warning");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorking(false);
      }
    },
    [projectId, activeKey, content, toast, previewInput, parsed, job, setParsed, setPreview, setResult, setPreviewInput, setContent],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div>
        <Link
          href={`/projects/${projectId}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-standard"
        >
          <ArrowLeft className="size-3.5" />
          返回项目
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-page-title">
          <Bot className="text-primary size-5" />
          从 AI 助手整理研究记录
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          复制提示词给正在聊天的 AI 助手 → 把它整理的内容粘贴回来 → 用本软件的模型分段解析 → 预览确认后导入。
          适合已有助手整理好的记录；原始讨论请使用「对话导入」。
        </p>
      </div>

      {(error || job.error) && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{error || job.error}</AlertDescription>
        </Alert>
      )}

      {job.pending && <ParseProgress progress={job.progress} />}
      {storageWarning && <p role="alert" className="text-sm text-destructive">本窗口无法保存草稿；请保持页面打开并检查存储空间。</p>}
      <div className="rounded-lg border bg-card p-4 text-sm">整理过去讨论中的多个 Idea 和演化原因？ <Link className="text-primary underline" href={`/projects/${projectId}/research-ideas?mode=import`}>导入科研演化报告</Link>；也可以 <Link className="text-primary underline" href={`/projects/${projectId}/research-ideas`}>整理单个 Idea</Link>。</div>
      {/* step 1: pick module + copy prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">01 选择整理方式</CardTitle>
          <CardDescription>
            选择类型，复制固定提示词，直接发送给正在与你讨论研究的助手。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!prompts ? (
            error ? <p className="text-sm text-destructive">无法加载提示词，请检查服务连接后刷新页面。</p> : <Skeleton className="h-40 w-full" />
          ) : (
            <Tabs value={activeKey} onValueChange={(v) => { setActiveKey(v as AgentPromptInfo["key"]); setPreview(null); setParsed(null); setResult(null); }}>
              <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
                {prompts.map((p) => (
                  <TabsTrigger key={p.key} value={p.key} disabled={working} className="px-3">
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {prompts.map((p) => (
                <TabsContent key={p.key} value={p.key} className="mt-3 space-y-3">
                  <p className="text-muted-foreground text-xs leading-relaxed">{p.description}</p>
                  <div className="bg-muted/50 border-border-subtle max-h-80 overflow-y-auto rounded-lg border p-4">
                    <pre className="text-muted-foreground whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                      {p.prompt}
                    </pre>
                  </div>
                  <Button size="sm" onClick={() => void copyPrompt()}>
                    <ClipboardCopy className="size-3.5" />
                    复制「{p.name}」提示词
                  </Button>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* step 2: paste agent output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">02 粘贴助手的整理结果</CardTitle>
          <CardDescription>
            粘贴助手的自然语言或结构化整理结果。系统将发送给你配置的模型，按所选类型分段解析；可直接解析并自动导入，或先预览。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setPreview(null); setParsed(null); setResult(null); }}
            disabled={working}
            rows={10}
            placeholder="把助手整理好的研究内容粘贴在这里…"
            aria-label="助手的整理结果"
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runImport(true)} disabled={working || !content.trim()}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
              {working ? "正在分段解析…" : "模型解析并预览"}
            </Button>
            <Button onClick={() => void runImport(true, true)} disabled={working || !content.trim()}>
              解析并自动导入
            </Button>
            <Button variant="outline" onClick={() => void runImport(false)} disabled={working || !content.trim() || !preview || !preview.ok || !parsed || Object.entries(parsed.records).filter(([key]) => key !== "version").every(([, value]) => !Array.isArray(value) || value.length === 0) || previewInput !== `${projectId}:${activeKey}:${content}`}>
              确认导入
            </Button>
            {(preview || result) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setResult(null);
                }}
              >
                <RotateCcw className="size-4" />
                清空结果
              </Button>
            )}
          </div>
          {!preview && !result && (
            <p className="text-muted-foreground text-xs">
              解析需要先在设置中配置模型 API。自动导入会在解析和校验成功后写入；有错误时会停在预览。
            </p>
          )}
        </CardContent>
      </Card>

      {!preview && !result && <p className="text-sm text-muted-foreground">尚未配置模型？<Link href="/settings" className="text-primary underline">前往设置模型 API</Link></p>}
      {parsed && (preview || result) && <Card><CardHeader><CardTitle className="text-card-title">03 解析内容</CardTitle><CardDescription>共解析 {parsed.segments} 段{parsed.masked_count > 0 ? `，已遮蔽 ${parsed.masked_count} 处疑似密钥` : ""}。{result ? "已提交导入，请核对记录。" : "请逐项检查再确认导入。"}</CardDescription></CardHeader><CardContent className="space-y-4">{Object.entries({ideas:"假设", idea_versions:"假设修订", runs:"实验", evidence:"证据", notes:"笔记与下一步"}).map(([key, label]) => { const items = parsed.records[key] ?? []; return items.length ? <section key={key} className="rounded-lg border p-4"><h3 className="font-semibold">{label} · {items.length}</h3><div className="mt-3 space-y-3">{items.map((item, index) => <div key={index} className="rounded-md bg-muted/50 p-3"><p className="font-medium">{String(item.title ?? item.name ?? item.idea ?? `记录 ${index + 1}`)}</p><dl className="mt-2 space-y-1 text-sm text-muted-foreground">{Object.entries(item).filter(([field]) => !["ref", "title", "name"].includes(field)).map(([field, value]) => <div key={field} className="flex gap-2"><dt className="shrink-0 font-medium">{({ body: "正文", content: "内容", change_reason: "修订原因", status: "状态", idea: "关联假设", run: "关联实验", verdict: "判断", note: "依据", notes: "说明", dataset: "数据集", params: "参数", metrics: "指标", git_commit: "代码版本", eval_protocol: "评估方式" } as Record<string, string>)[field] ?? field}：</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</dd></div>)}</dl></div>)}</div></section> : null; })}</CardContent></Card>}
      {result && <Button asChild><Link href={`/projects/${projectId}`}>查看导入后的研究记录</Link></Button>}
      {/* step 3: preview / result */}
      {(preview || result) && (() => {
        const data = (preview ?? result) as AgentImportResult;
        const isPreview = preview !== null;
        return (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-card-title">
                {isPreview ? "导入预览（尚未写入）" : "导入结果"}
                <Badge variant={data.ok ? "secondary" : "destructive"} className="ml-2">
                  {data.ok ? "全部可导入" : `${data.errors.length} 项失败`}
                </Badge>
              </CardTitle>
              <span className="text-muted-foreground font-mono text-xs">prompt {data.prompt_version}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.created.length > 0 && (
                <ItemList
                  title={`新建（${data.created.length}）`}
                  items={data.created}
                  icon={<CheckCircle2 className="text-success size-3.5" />}
                />
              )}
              {data.skipped.length > 0 && (
                <ItemList
                  title={`更新或跳过（${data.skipped.length}）`}
                  items={data.skipped}
                  icon={<SkipForward className="text-muted-foreground size-3.5" />}
                />
              )}
              {data.errors.length > 0 && (
                <ItemList
                  title={`失败（${data.errors.length}）`}
                  items={data.errors}
                  icon={<TriangleAlert className="text-destructive size-3.5" />}
                />
              )}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

function ItemList({
  title,
  items,
  icon,
}: {
  title: string;
  items: AgentImportItem[];
  icon: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold">{title}</h4>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div
            key={`${item.kind}-${index}`}
            className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md px-3 py-1.5 text-xs"
          >
            {icon}
            <Badge variant="outline" className="text-xs">
              {KIND_LABEL[item.kind] ?? item.kind}
            </Badge>
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            {item.detail && <span className="text-muted-foreground">{item.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
