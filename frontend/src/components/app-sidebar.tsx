"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  PanelLeft,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import { useProjectContext } from "@/components/project-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "research-os-sidebar";

interface NavItem {
  href: string | null;
  label: string;
  icon: typeof LayoutDashboard;
  /** when true the item is disabled without an active project */
  needsProject?: boolean;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "工作区",
    items: [
      { href: "/", label: "总览", icon: LayoutDashboard },
      { href: null, label: "实验", icon: FlaskConical, needsProject: true }, // /projects/{id}/experiments
      { href: null, label: "Idea 演化", icon: GitBranch, needsProject: true },
      { href: null, label: "研究时间线", icon: ScrollText, needsProject: true },
    ],
  },
  {
    title: "研究",
    items: [
      { href: null, label: "对话导入", icon: MessageSquareText, needsProject: true },
      { href: null, label: "Agent 导入", icon: ClipboardPaste, needsProject: true },
      { href: null, label: "AI 审核", icon: Workflow, needsProject: true },
    ],
  },
  {
    title: "系统",
    items: [{ href: "/settings", label: "设置", icon: Settings }],
  },
];

function projectHref(path: string, projectId: number | null) {
  return projectId ? `/projects/${projectId}${path}` : null;
}

export function AppSidebar() {
  const pathname = usePathname();
  const { projects, activeProjectId, setActiveProject, loading } = useProjectContext();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "collapsed");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem(STORAGE_KEY, prev ? "open" : "collapsed");
      return !prev;
    });
  };

  // Resolve placeholder hrefs against the active project.
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.href
        ? item
        : {
            ...item,
            href: projectHref(
              item.label === "实验"
                ? "/experiments"
                : item.label === "Idea 演化"
                  ? "/ideas/graph"
                  : item.label === "研究时间线"
                    ? "/timeline"
                    : item.label === "对话导入"
                      ? "/conversations"
                      : item.label === "Agent 导入"
                        ? "/agent-import"
                        : "/analysis",
              activeProjectId,
            ),
          },
    ),
  }));

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`) || pathname === href.replace(/\/$/, "");
  };

  const sidebarBody = (
    <div className="flex h-full min-h-0 flex-col">
      {/* brand + project switcher */}
      <div className="flex h-[52px] items-center gap-2 border-b border-sidebar-border px-3">
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-2">
          <FlaskConical className="text-primary size-4.5 shrink-0" />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">Research OS</span>
          )}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="text-muted-foreground hover:text-foreground hidden size-6 items-center justify-center rounded md:flex transition-standard"
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="border-b border-sidebar-border px-3 py-2.5">
          <Select
            value={activeProjectId ? String(activeProjectId) : undefined}
            onValueChange={(v) => setActiveProject(Number(v))}
            disabled={loading || projects.length === 0}
          >
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="切换项目">
              <SelectValue placeholder={loading ? "加载中…" : "选择项目"} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {sections.map((section) => (
          <div key={section.title} className="mb-3">
            {!collapsed && (
              <p className="text-muted-foreground/70 px-2 pt-1 pb-1 text-[10px] font-semibold tracking-widest uppercase">
                {section.title}
              </p>
            )}
            {collapsed && <div className="mx-2 my-2 border-t border-sidebar-border" />}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const disabled = item.needsProject && !activeProjectId;
                const href = item.href;
                const active = href !== null && !disabled && isActive(href);
                const link = (
                  <Link
                    key={item.label}
                    href={disabled ? "#" : (href ?? "#")}
                    onClick={() => {
                      if (!disabled) setMobileOpen(false);
                    }}
                    aria-disabled={disabled}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-standard",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : disabled
                          ? "text-muted-foreground/50 cursor-not-allowed"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                    onClickCapture={(e) => disabled && e.preventDefault()}
                  >
                    <item.icon className={cn("size-4 shrink-0", active && "text-primary")} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
                return collapsed ? (
                  <li key={item.label}>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </li>
                ) : (
                  <li key={item.label}>{link}</li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="text-muted-foreground/70 border-t border-sidebar-border p-3 text-[11px] leading-relaxed">
          <BookOpenText className="mb-1 size-3.5" />
          Personal Research Workspace
          <br />
          本地单机 · 数据经 FastAPI 存取
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* desktop */}
      <aside
        className={cn(
          "bg-sidebar border-sidebar-border hidden shrink-0 border-r transition-[width] duration-200 md:flex md:flex-col",
          collapsed ? "w-[56px]" : "w-[232px]",
        )}
      >
        {sidebarBody}
      </aside>

      {/* mobile drawer trigger lives in the topbar */}
      <MobileSidebar open={mobileOpen} onOpenChange={setMobileOpen}>
        {sidebarBody}
      </MobileSidebar>
      <button type="button" className="hidden" data-sidebar-trigger onClick={() => setMobileOpen(true)} />
    </>
  );
}

function MobileSidebar({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { activeProjectId } = useProjectContext();
  const pathname = usePathname();
  useEffect(() => {
    onOpenChange(false);
    // close on navigation
  }, [pathname, activeProjectId, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="bg-black/40 absolute inset-0" onClick={() => onOpenChange(false)} />
      <div className="bg-sidebar absolute inset-y-0 left-0 w-64 border-r shadow-xl">{children}</div>
    </div>
  );
}

export function SidebarMobileTrigger() {
  return (
    <button
      type="button"
      onClick={() => {
        document.querySelector<HTMLButtonElement>("[data-sidebar-trigger]")?.click();
      }}
      className="text-muted-foreground hover:text-foreground -ml-1 flex size-8 items-center justify-center rounded-md md:hidden transition-standard"
      aria-label="打开导航"
    >
      <PanelLeft className="size-4.5" />
    </button>
  );
}
