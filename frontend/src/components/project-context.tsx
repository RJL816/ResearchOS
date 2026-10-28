"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "@/lib/navigation";
import { getAnalysisJob, getIdea, getRun, getResearchIdea, listProjects, type Project } from "@/lib/api";
interface ProjectContextValue {
  projects: Project[]; activeProject: Project | null; activeProjectId: number | null;
  setActiveProject: (id: number) => void; loading: boolean; error: string | null; refresh: () => Promise<void>;
}
const ProjectContext = createContext<ProjectContextValue>({ projects: [], activeProject: null, activeProjectId: null, setActiveProject: () => {}, loading: true, error: null, refresh: async () => {} });
const STORAGE_KEY = "research-os-active-project";
export function ProjectProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [owner, setOwner] = useState<{ path: string; id: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setActiveProject = useCallback((id: number) => {
    setSelectedId(id); localStorage.setItem(STORAGE_KEY, String(id));
  }, []);
  const refresh = useCallback(async () => {
    try {
      const data = await listProjects(); setProjects(data); setError(null);
      setSelectedId((current) => {
        if (data.some((p) => p.id === current)) return current;
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        return data.find((p) => p.id === stored)?.id ?? data[0]?.id ?? null;
      });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Async API loader; updates occur after the request settles.
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let stale = false;
    const project = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
    if (project) { localStorage.setItem(STORAGE_KEY, project[1]); return; }
    const match = pathname.match(/^\/(ideas|runs|analysis|research-ideas)\/(\d+)/);
    if (!match) return;
    const read = match[1] === "research-ideas" ? getResearchIdea : match[1] === "ideas" ? getIdea : match[1] === "runs" ? getRun : getAnalysisJob;
    void read(Number(match[2])).then((entity) => {
      if (stale) return;
      setOwner({ path: pathname, id: entity.project_id }); setActiveProject(entity.project_id);
    }).catch((err) => { if (!stale) setError(err instanceof Error ? err.message : String(err)); });
    return () => { stale = true; };
  }, [pathname, setActiveProject]);
  const routeId = Number(pathname.match(/^\/projects\/(\d+)(?:\/|$)/)?.[1]) || null;
  const entityRoute = /^\/(ideas|runs|analysis|research-ideas)\//.test(pathname);
  const stored = typeof window === "undefined" ? null : Number(localStorage.getItem(STORAGE_KEY));
  const remembered = projects.some((p) => p.id === stored) ? stored : selectedId;
  const activeProjectId = routeId ?? (entityRoute ? owner?.path === pathname ? owner.id : null : remembered);
  const value = useMemo(() => ({ projects, activeProject: projects.find((p) => p.id === activeProjectId) ?? null, activeProjectId, setActiveProject, loading, error, refresh }), [projects, activeProjectId, setActiveProject, loading, error, refresh]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
export const useProjectContext = () => useContext(ProjectContext);
