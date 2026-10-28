"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileInput, PenLine } from "lucide-react";
import { useRouteId, useRouter } from "@/lib/navigation";
import { createResearchIdea, listResearchIdeas, type ResearchIdea } from "@/lib/api";
import { ResearchEvolutionImport } from "@/components/research-evolution-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSessionState } from "@/lib/session-state";

type Mode = "manual" | "import";

export default function ResearchIdeaList({ initialMode }: { initialMode?: Mode } = {}) {
  const projectId = useRouteId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultMode = initialMode ?? (searchParams.get("mode") === "import" ? "import" : "manual");
  const [mode, setMode] = useSessionState<Mode>(`research-os:evolution:${projectId}:mode`, "manual");
  const [importOpened, setImportOpened] = useState(defaultMode === "import");
  const [items, setItems] = useState<ResearchIdea[] | null>(null);
  const [name, setName] = useSessionState(`research-os:idea:${projectId}:new-name`, "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listResearchIdeas(projectId));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => { if (defaultMode === "import") setMode("import"); }, [defaultMode, setMode]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const idea = await createResearchIdea(projectId, name.trim());
      setName("");
      router.push(`/research-ideas/${idea.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7 px-6 py-8">
      <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">← 返回项目</Link>
      <header>
        <h1 className="text-page-title">研究 Idea</h1>
        <p className="mt-2 text-muted-foreground">在这里创建或导入研究思路，整理目标、方法、实验和后续演化。</p>
      </header>

      <section aria-labelledby="add-idea-heading" className="space-y-4">
        <div>
          <h2 id="add-idea-heading" className="text-section-title">添加研究思路</h2>
          <p className="mt-1 text-sm text-muted-foreground">选择适合你的方式，导入前可以逐项审核。</p>
        </div>
        <Tabs value={mode} onValueChange={(value) => {
          const next = value as Mode;
          setMode(next);
          if (next === "import") setImportOpened(true);
        }} className="gap-4">
          <TabsList aria-label="添加研究思路的方式" className="h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-fit">
            <TabsTrigger value="manual" className="min-h-10 flex-1 px-4 sm:flex-none"><PenLine aria-hidden="true" />自己创建</TabsTrigger>
            <TabsTrigger value="import" className="min-h-10 flex-1 px-4 sm:flex-none"><FileInput aria-hidden="true" />导入完整研究过程</TabsTrigger>
          </TabsList>
          <TabsContent value="manual" forceMount className="data-[state=inactive]:hidden">
            <Card><CardContent>
              <div><h3 className="font-semibold">从一条新 Idea 开始</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">先起一个名字，再逐步填写研究内容；也可以在 Idea 详情中导入单个 Markdown 方案。</p></div>
              <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (!busy && name.trim()) void create(); }}>
                <Input aria-label="研究 Idea 名称" className="max-w-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：面向困难任务的自适应计算" maxLength={300} />
                <Button type="submit" disabled={busy || !name.trim()}>创建研究 Idea</Button>
              </form>
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="import" forceMount className="data-[state=inactive]:hidden">
            {(importOpened || mode === "import") && <ResearchEvolutionImport embedded onImported={() => void load()} />}
          </TabsContent>
        </Tabs>
      </section>

      {error && <p role="alert" className="text-destructive">{error}</p>}
      <section id="research-ideas-list" aria-labelledby="ideas-heading" className="space-y-3 scroll-mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="ideas-heading" className="text-section-title">已有研究思路</h2>{items && <span className="text-sm text-muted-foreground">{items.length} 条 Idea</span>}</div>
        {items === null ? <p className="text-sm text-muted-foreground">正在加载…</p> : items.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">还没有研究 Idea。现有假设仍在项目工作台中，可以稍后关联。</p> : items.map((item) => <Link href={`/research-ideas/${item.id}`} key={item.id} className="block rounded-xl border bg-card p-5 transition-standard hover:border-primary/40"><h3 className="font-semibold">{item.title}</h3><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.goal || item.background || "尚未填写研究目标"}</p></Link>)}
      </section>
    </div>
  );
}
