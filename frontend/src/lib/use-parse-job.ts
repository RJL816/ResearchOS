"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getParseJob, startParseJob, type ParseJobKind } from "@/lib/api";
import { useSessionState } from "@/lib/session-state";

type Pending = { id: string; kind: ParseJobKind; targetId: number; requestedAt: number };
type Payload = { content: string; filename?: string; module?: "session" | "idea" | "run" | "evidence" | "note" };

export function useParseJob<T>(key: string, targetId: number, onCompleted: (result: T) => void) {
  const [pending, setPending] = useSessionState<Pending | null>(`${key}:job`, null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{completed:number; total:number|null; stage:string}>({completed:0,total:null,stage:"等待解析"});
  const completed = useRef(onCompleted);
  useEffect(() => { completed.current = onCompleted; }, [onCompleted]);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const job = await getParseJob<T>(pending!.id);
        if (cancelled) return;
        setProgress({completed:job.completed,total:job.total,stage:job.stage});
        if (job.target_id !== pending!.targetId || job.kind !== pending!.kind) {
          setPending(null);
          setError("解析任务与当前内容不匹配，请重新解析。");
          return;
        }
        if (job.status === "completed") {
          completed.current(job.result as T);
          setPending(null);
          setError("");
          return;
        }
        if (job.status === "failed") {
          setPending(null);
          setError(job.error || "解析失败，请重试。");
          return;
        }
        setError("");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404 && Date.now() - pending!.requestedAt > 8000) {
          setPending(null);
          setError(err.message);
          return;
        }
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 404) {
          setPending(null);
          setError(err.message);
          return;
        }
        setError(err instanceof ApiError && err.status === 0 ? "暂时无法连接，恢复连接后会继续获取解析结果。" : "正在确认解析任务状态…");
      }
      timer = setTimeout(poll, 1200);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending, setPending]);

  const start = useCallback((kind: ParseJobKind, payload: Payload) => {
    if (pending) return;
    const id = crypto.randomUUID();
    const job = { id, kind, targetId, requestedAt: Date.now() };
    setError("");
    setProgress({completed:0,total:null,stage:"等待解析"});
    setPending(job);
    void startParseJob({ job_id: id, kind, target_id: targetId, ...payload }).catch((err: unknown) => {
      // On navigation the request can be interrupted after reaching the server;
      // let polling recover it. Definitive client errors cannot have started it.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        setPending((current) => current?.id === id ? null : current);
        setError(err.message);
      }
    });
  }, [pending, setPending, targetId]);
  return { start, pending: Boolean(pending), progress, error, clearError: () => setError("") };
}
