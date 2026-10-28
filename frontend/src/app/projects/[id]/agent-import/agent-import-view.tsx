"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/toast";
import {
  agentImport,
  getAgentPrompts,
  type AgentImportItem,
  type AgentImportResult,
  type AgentPromptInfo,
} from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  parse: "解析",
  idea: "假设",
  idea_version: "假设版本",
  run: "实验",
  evidence: "证据",
  note: "笔记",
};

export default function AgentImportView() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const { toast } = useToast();

  const [prompts, setPrompts] = useState<AgentPromptInfo[] | null>(null);
  const [activeKey, setActiveKey] = useState<AgentPromptInfo["key"]>("session");
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<AgentImportResult | null>(null);
  const [result, setResult] = useState<AgentImportResult | null>(null);
  const [working, setWorking] = useState(false);

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
      toast("Prompt 已复制，粘贴给你的 AI 助手即可", "success");
    } catch {
      toast("复制失败，请手动全选复制", "warning");
    }
  }, [active, toast]);

  const runImport = useCallback(
    async (dryRun: boolean) => {
      if (!content.trim()) return;
      setWorking(true);
      setError(null);
      try {
        const result = await agentImport(projectId, {
          module: activeKey,
          content,
          dry_run: dryRun,
        });
        if (dryRun) {
          setPreview(result);
          setResult(null);
        } else {
          setResult(result);
          setPreview(null);
          setContent("");
          toast(
            result.ok
              ? `导入完成：${result.created.length} 项创建`
              : `导入完成，但有 ${result.errors.length} 项失败`,
            result.ok ? "success" : "warning",
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorking(false);
      }
    },
    [projectId, activeKey, content, toast],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
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
          Agent 结构化导入
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          复制模块 Prompt → 粘贴给你的 AI 助手（GLM / Claude 等）→ 把助手输出的 JSON 粘回来 → 预览确认后导入。
          与「对话导入」互相独立，已有导入方式全部保留。
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* step 1: pick module + copy prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">第一步：选择模块并复制 Prompt</CardTitle>
          <CardDescription>
            每个模块一个专门调教的 Prompt；助手会按 Research OS 的数据契约输出严格 JSON。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!prompts ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Tabs value={activeKey} onValueChange={(v) => setActiveKey(v as AgentPromptInfo["key"])}>
              <TabsList className="flex-wrap">
                {prompts.map((p) => (
                  <TabsTrigger key={p.key} value={p.key} className="px-3">
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {prompts.map((p) => (
                <TabsContent key={p.key} value={p.key} className="mt-3 space-y-3">
                  <p className="text-muted-foreground text-xs leading-relaxed">{p.description}</p>
                  <div className="bg-muted/50 border-border-subtle max-h-72 overflow-y-auto rounded-lg border p-3">
                    <pre className="text-muted-foreground whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                      {p.prompt}
                    </pre>
                  </div>
                  <Button size="sm" onClick={() => void copyPrompt()}>
                    <ClipboardCopy className="size-3.5" />
                    复制「{p.name}」Prompt
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
          <CardTitle className="text-card-title">第二步：粘贴助手的 JSON 输出</CardTitle>
          <CardDescription>
            支持直接粘贴或带 markdown 围栏；系统会自动提取 JSON 并逐条校验。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder={'{"version":1,"ideas":[{"ref":"idea-a","title":"…","body":"…"}],"runs":[],"evidence":[],"notes":[]}'}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void runImport(true)} disabled={working || !content.trim()}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
              解析并预览
            </Button>
            <Button onClick={() => void runImport(false)} disabled={working || !content.trim() || !preview}>
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
            <p className="text-muted-foreground text-[11px]">
              建议先「解析并预览」确认无误后再「确认导入」；导入是逐条应用的，单条失败不影响其余条目。
            </p>
          )}
        </CardContent>
      </Card>

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
              <span className="text-muted-foreground font-mono text-[10px]">prompt {data.prompt_version}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.created.length > 0 && (
                <ItemList
                  title={`将创建 / 已创建（${data.created.length}）`}
                  items={data.created}
                  icon={<CheckCircle2 className="text-success size-3.5" />}
                />
              )}
              {data.skipped.length > 0 && (
                <ItemList
                  title={`跳过（${data.skipped.length}）`}
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
            <Badge variant="outline" className="text-[10px]">
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
