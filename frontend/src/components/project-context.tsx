"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { listProjects, type Project } from "@/lib/api";

interface ProjectContextValue {
  projects: Project[];
  activeProject: Project | null;
  activeProjectId: number | null;
  setActiveProject: (id: number) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  activeProject: null,
  activeProjectId: null,
  setActiveProject: () => {},
  loading: true,
  refresh: async () => {},
});

const STORAGE_KEY = "research-os-active-project";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setActiveId((current) => {
        if (current !== null && data.some((p) => p.id === current)) return current;
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        if (stored && data.some((p) => p.id === stored)) return stored;
        return data[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // URL is the source of truth when inside a project route.
  useEffect(() => {
    const match = pathname.match(/^\/projects\/(\d+)/);
    if (match) {
      const id = Number(match[1]);
      setActiveId(id);
      localStorage.setItem(STORAGE_KEY, String(id));
    }
  }, [pathname]);

  const setActiveProject = useCallback((id: number) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      activeProject: projects.find((p) => p.id === activeProjectId) ?? null,
      activeProjectId,
      setActiveProject,
      loading,
      refresh,
    }),
    [projects, activeProjectId, setActiveProject, loading, refresh],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export const useProjectContext = () => useContext(ProjectContext);
