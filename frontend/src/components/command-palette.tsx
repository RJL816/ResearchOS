"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  NotebookPen,
  ScrollText,
  Search,
  Settings,
  Workflow,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjectContext } from "@/components/project-context";
import { listIdeas, listRuns, type Idea, type Run } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CommandItem {
  label: string;
  hint: string;
  icon: typeof GitBranch;
  action: () => void;
  keywords?: string;
}

/**
 * ⌘K / Ctrl+K command palette — jump to pages, projects, ideas and runs of
 * the active project. Lightweight: data is fetched lazily on first open.
 */
export function CommandPalette() {
  const router = useRouter();
  const { projects, activeProject, setActiveProject } = useProjectContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [cursor, setCursor] = useState(0);

  const pid = activeProject?.id ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || pid === null) return;
    void listIdeas(pid)
      .then(setIdeas)
      .catch(() => setIdeas([]));
    void listRuns(pid)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [open, pid]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setCursor(0);
      router.push(href);
    },
    [router],
  );

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...texts: string[]) =>
      !q || texts.some((t) => t.toLowerCase().includes(q));

    const nav: CommandItem[] = [
      { label: "总览", hint: "导航", icon: LayoutDashboard, action: () => go("/"), keywords: "overview dashboard home" },
      ...(pid
        ? ([
            { label: "实验台", hint: "导航", icon: FlaskConical, action: () => go(`/projects/${pid}/experiments`), keywords: "experiments runs" },
            { label: "Idea 演化图谱", hint: "导航", icon: GitBranch, action: () => go(`/projects/${pid}/ideas/graph`), keywords: "graph evolution" },
            { label: "研究时间线", hint: "导航", icon: ScrollText, action: () => go(`/projects/${pid}/timeline`), keywords: "timeline history" },
            { label: "对话导入", hint: "导航", icon: MessageSquareText, action: () => go(`/projects/${pid}/conversations`), keywords: "conversation import" },
            { label: "Agent 导入", hint: "导航", icon: NotebookPen, action: () => go(`/projects/${pid}/agent-import`), keywords: "agent prompt structured" },
            { label: "设置", hint: "导航", icon: Settings, action: () => go("/settings"), keywords: "settings theme" },
          ] as CommandItem[])
        : []),
    ].filter((item) => match(item.label, item.keywords ?? ""));

    const projectItems: CommandItem[] = projects
      .filter((p) => match(p.name, "project"))
      .map((p) => ({
        label: p.name,
        hint: "切换项目",
        icon: LayoutDashboard,
        action: () => {
          setActiveProject(p.id);
          go(`/projects/${p.id}`);
        },
      }));

    const ideaItems: CommandItem[] = ideas
      .filter((i) => match(i.title))
      .slice(0, 6)
      .map((i) => ({
        label: i.title,
        hint: `假设 · v${i.versions.find((v) => v.id === i.current_version_id)?.version_number ?? 1}`,
        icon: GitBranch,
        action: () => go(`/ideas/${i.id}`),
      }));

    const runItems: CommandItem[] = runs
      .filter((r) => match(r.name))
      .slice(0, 6)
      .map((r) => ({
        label: r.name,
        hint: "实验",
        icon: FlaskConical,
        action: () => go(`/runs/${r.id}`),
      }));

    return [...nav, ...projectItems, ...ideaItems, ...runItems];
  }, [query, projects, pid, ideas, runs, go, setActiveProject]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter" && items[cursor]) {
        e.preventDefault();
        items[cursor].action();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [items, cursor],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[15%] translate-y-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Search className="text-muted-foreground size-4" />
            搜索与跳转
          </DialogTitle>
          <DialogDescription className="sr-only">输入关键词跳转到页面、假设或实验</DialogDescription>
        </DialogHeader>
        <div className="pb-2" onKeyDown={onKey}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索假设、实验，或输入页面名跳转…"
            className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
            aria-label="命令搜索"
          />
          <ul className="max-h-80 overflow-y-auto p-2">
            {items.length === 0 ? (
              <li className="text-muted-foreground px-3 py-6 text-center text-xs">
                没有匹配项。
              </li>
            ) : (
              items.map((item, index) => (
                <li key={`${item.hint}-${item.label}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={item.action}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-standard",
                      index === cursor ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    <item.icon className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="text-muted-foreground shrink-0 text-[11px]">{item.hint}</span>
                    {index === cursor && <ArrowRight className="text-muted-foreground size-3" />}
                  </button>
                </li>
              ))
            )}
          </ul>
          <p className="text-muted-foreground border-t px-4 py-2 text-[10px]">
            ↑↓ 选择 · Enter 打开 · Esc 关闭
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}


