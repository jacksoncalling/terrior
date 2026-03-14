'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Project } from '@/types';
import { getProject } from '@/lib/supabase';

// ── Context shape ────────────────────────────────────────────────────────────

interface ProjectContextValue {
  projectId: string | null;
  project: Project | null;
  loading: boolean;
  error: string | null;
  setProjectId: (id: string | null) => void;
  refreshProject: () => Promise<void>;
}

// ── Context (module-level = stable singleton) ────────────────────────────────

const ProjectContext = createContext<ProjectContextValue>({
  projectId: null,
  project: null,
  loading: false,
  error: null,
  setProjectId: () => {},
  refreshProject: async () => {},
});

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [projectId, setProjectIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('terroir_project_id');
    }
    return null;
  });
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const p = await getProject(id);
        if (p) {
          setProject(p);
        } else {
          // Project not found — clear selection and redirect
          setProject(null);
          setProjectIdState(null);
          localStorage.removeItem('terroir_project_id');
          router.push('/projects');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project');
        setProject(null);
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  // Fetch project metadata when projectId changes
  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
    } else {
      setProject(null);
    }
  }, [projectId, fetchProject]);

  // Redirect to /projects if no project selected and not already there
  useEffect(() => {
    if (!projectId && !loading && pathname !== '/projects') {
      router.push('/projects');
    }
  }, [projectId, loading, pathname, router]);

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id);
    if (id) {
      localStorage.setItem('terroir_project_id', id);
    } else {
      localStorage.removeItem('terroir_project_id');
    }
  }, []);

  const refreshProject = useCallback(async () => {
    if (projectId) await fetchProject(projectId);
  }, [projectId, fetchProject]);

  return (
    <ProjectContext.Provider
      value={{ projectId, project, loading, error, setProjectId, refreshProject }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
