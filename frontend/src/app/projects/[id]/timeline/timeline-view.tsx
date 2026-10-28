"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, GitBranch, MessageSquareText, NotebookPen, ScrollText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import {
  listIdeas,
  listNotes,
  listRuns,
  type Idea,
  type ResearchNote,
  type Run,
} from "@/lib/api";
import { fmtDateTime } from "@/lib/format";


interface Event {
  kind: "idea" | "run" | "note";
  title: string;
  detail?: string;
  at: string;
  href: string | null;
  badge?: { kind: "idea" | "run"; value: string };
}

const KIND_ICON = {
  idea: GitBranch,
  run: FlaskConical,
  note: NotebookPen,
} as const;

export default function TimelineView() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [ideas, runs, notes] = await Promise.all([
        listIdeas(projectId),
        listRuns(projectId),
        listNotes(projectId),
      ]);
      setEvents(mergeEvents(ideas, runs, notes));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!events) return null;
    const byDay = new Map<string, Event[]>();
    for (const event of events) {
      const day = event.at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
    return [...byDay.entries()];
  }, [events]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-5">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ScrollText className="size-3.5" />
          按时间倒序的研究活动
        </div>
        <h1 className="text-page-title mt-0.5">研究时间线</h1>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!grouped ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : grouped.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-12 text-center text-sm">
          还没有任何研究活动。
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, dayEvents]) => (
            <div key={day}>
              <p className="text-muted-foreground mb-2 font-mono text-[11px] tracking-wide">{day}</p>
              <div className="space-y-0">
                {dayEvents.map((event, index) => (
                  <div key={`${event.kind}-${event.at}-${index}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border ${
                          event.kind === "idea"
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : event.kind === "run"
                              ? "border-info/30 bg-info/10 text-info"
                              : "text-muted-foreground border-border bg-muted"
                        }`}
                      >
                        {(() => {
                          const Icon = KIND_ICON[event.kind];
                          return <Icon className="size-3" />;
                        })()}
                      </span>
                      {index < dayEvents.length - 1 && <span className="bg-border w-px flex-1" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {event.href ? (
                          <Link href={event.href} className="text-[13px] font-medium hover:underline">
                            {event.title}
                          </Link>
                        ) : (
                          <span className="text-[13px] font-medium">{event.title}</span>
                        )}
                        {event.badge && <StatusBadge kind={event.badge.kind} value={event.badge.value} />}
                        <span className="text-muted-foreground font-mono text-[10px]">
                          {fmtDateTime(event.at).split(", ")[1] ?? fmtDateTime(event.at)}
                        </span>
                      </div>
                      {event.detail && (
                        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{event.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function mergeEvents(ideas: Idea[], runs: Run[], notes: ResearchNote[]): Event[] {
  const events: Event[] = [
    ...ideas.map((idea) => ({
      kind: "idea" as const,
      title: idea.title,
      detail: idea.versions.find((v) => v.id === idea.current_version_id)?.body,
      at: idea.updated_at,
      href: `/ideas/${idea.id}`,
      badge: { kind: "idea" as const, value: idea.status },
    })),
    ...runs.map((run) => ({
      kind: "run" as const,
      title: run.name,
      detail: run.eval_protocol ?? undefined,
      at: run.created_at,
      href: `/runs/${run.id}`,
      badge: { kind: "run" as const, value: run.status },
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      title: note.title,
      detail: note.content ?? undefined,
      at: note.created_at,
      href: null as string | null,
    })),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
}
