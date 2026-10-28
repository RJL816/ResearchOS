"use client";

import Link from "next/link";
import { usePathname } from "@/lib/navigation";
import { ChevronRight, Moon, Search, Sun } from "lucide-react";
import { SidebarMobileTrigger } from "@/components/app-sidebar";
import { useProjectContext } from "@/components/project-context";
import { useTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";

const SEGMENT_LABELS: Record<string, string> = {
  "research-ideas": "研究 Idea",
  hypotheses: "假设",
  experiments: "实验",
  compare: "对比",
  ideas: "假设",
  graph: "演化图谱",
  timeline: "研究时间线",
  conversations: "对话导入",
  "agent-import": "Agent 导入",
  analysis: "AI 审核",
  settings: "设置",
  runs: "实验详情",
};

export function Topbar() {
  const pathname = usePathname();
  const { activeProject } = useProjectContext();
  const { resolved, setTheme } = useTheme();

  const crumbs = buildCrumbs(pathname, activeProject?.id ?? null, activeProject?.name ?? null);

  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 flex h-[52px] shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      <SidebarMobileTrigger />
      <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((crumb, index) => (
          <span key={crumb.href} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight className="text-muted-foreground/60 size-3 shrink-0" />}
            {crumb.href && index < crumbs.length - 1 ? (
              <Link
                href={crumb.href}
                className="text-muted-foreground hover:text-foreground truncate transition-standard"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8 gap-1.5 text-xs"
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
          }}
          title="搜索与跳转 (Ctrl+K)"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">搜索</span>
          <kbd className="bg-muted rounded border px-1 font-mono text-[10px]">Ctrl K</kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
          aria-label={resolved === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          title={resolved === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        >
          {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>
    </header>
  );
}

interface Crumb {
  label: string;
  href: string | null;
}

function buildCrumbs(pathname: string, projectId: number | null, projectName: string | null): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Research OS", href: "/" }];
  if (pathname === "/") return crumbs;

  if (projectId !== null) crumbs.push({ label: projectName ?? `项目 #${projectId}`, href: `/projects/${projectId}` });
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "projects" && parts[2] === "ideas" && parts[3] === "graph") {
    crumbs.push({ label: "Idea 演化图谱", href: null });
    return crumbs;
  }
  if (["ideas", "runs", "analysis", "research-ideas"].includes(parts[0])) {
    crumbs.push({ label: SEGMENT_LABELS[parts[0]], href: null });
  } else {
    const tail = parts[0] === "projects" ? parts.slice(2) : parts;
    if (tail.length) crumbs.push({ label: tail.map((p) => SEGMENT_LABELS[p] ?? p).join(" · "), href: null });
    else if (parts[0] === "projects") crumbs.push({ label: "项目工作台", href: null });
  }
  return crumbs;
}
