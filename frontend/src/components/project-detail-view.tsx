"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GitBranch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { IdeaCreateDialog } from "@/components/idea-create-dialog";
import { RunCreateDialog } from "@/components/run-create-dialog";
import { NoteCreateDialog } from "@/components/note-create-dialog";
import {
  getProject,
  listIdeas,
  listNotes,
  listRuns,
  type Idea,
  type Project,
  type ResearchNote,
  type Run,
} from "@/lib/api";
import { deleteProject } from "@/lib/api";
import { useToast } from "@/components/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fmtDateTime } from "@/lib/format";
import { useRouter } from "next/navigation";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const projectId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, i, r, n] = await Promise.all([
        getProject(projectId),
        listIdeas(projectId),
        listRuns(projectId),
        listNotes(projectId),
      ]);
      setProject(p);
      setIdeas(i);
      setRuns(r);
      setNotes(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteProject(projectId);
      toast("项目已删除", "success");
      router.push("/");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "warning");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }, [projectId, router, toast]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error ?? "项目不存在"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground text-sm">
          ← 全部项目
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <StatusBadge kind="project" value={project.status} />
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 px-2 text-xs">
                <Trash2 className="size-3.5" />
                删除
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>删除项目「{project.name}」？</DialogTitle>
                <DialogDescription>
                  将连带删除其全部假设、实验、证据与笔记（{project.idea_count} 假设 ·{" "}
                  {project.run_count} 实验 · {project.note_count} 笔记）。此操作不可恢复。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>取消</Button>
                <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
                  {deleting ? "删除中…" : "确认删除"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          {project.description ?? "暂无描述"}
        </p>
      </div>

      <Tabs defaultValue="ideas">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="ideas">假设（{ideas.length}）</TabsTrigger>
            <TabsTrigger value="runs">实验（{runs.length}）</TabsTrigger>
            <TabsTrigger value="notes">笔记（{notes.length}）</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}/ideas/graph`}>
                <GitBranch className="size-4" />
                演化图谱
              </Link>
            </Button>
            <IdeaCreateDialog projectId={projectId} onCreated={load} />
            <RunCreateDialog projectId={projectId} onCreated={load} />
            <NoteCreateDialog
              projectId={projectId}
              ideas={ideas}
              runs={runs}
              onCreated={load}
            />
          </div>
        </div>

        <TabsContent value="ideas" className="mt-4">
          {ideas.length === 0 ? (
            <EmptyHint text="还没有假设。点「新建假设」写下第一个可验证的想法。" />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>标题</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>当前版本</TableHead>
                    <TableHead>版本数</TableHead>
                    <TableHead className="text-right">更新时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ideas.map((idea) => {
                    const current = idea.versions.find(
                      (v) => v.id === idea.current_version_id,
                    );
                    return (
                      <TableRow key={idea.id}>
                        <TableCell>
                          <Link
                            href={`/ideas/${idea.id}`}
                            className="font-medium hover:underline"
                          >
                            {idea.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge kind="idea" value={idea.status} />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {current ? `v${current.version_number}` : "—"}
                        </TableCell>
                        <TableCell>{idea.versions.length}</TableCell>
                        <TableCell className="text-muted-foreground text-right text-sm">
                          {fmtDateTime(idea.updated_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          {runs.length === 0 ? (
            <EmptyHint text="还没有实验记录。点「记录实验」登记第一条 Run。" />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>外部键</TableHead>
                    <TableHead className="text-right">创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link href={`/runs/${run.id}`} className="font-medium hover:underline">
                          {run.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="run" value={run.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {run.external_source}
                      </TableCell>
                      <TableCell className="max-w-56 truncate font-mono text-xs" title={run.external_key}>
                        {run.external_key}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm">
                        {fmtDateTime(run.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          {notes.length === 0 ? (
            <EmptyHint text="还没有笔记。" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {notes.map((note) => (
                <Card key={note.id}>
                  <CardHeader>
                    <CardTitle className="text-sm">{note.title}</CardTitle>
                    <CardDescription>{fmtDateTime(note.created_at)}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {note.content && (
                      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    )}
                    <div className="text-muted-foreground flex gap-3 text-xs">
                      {note.idea_id && (
                        <Link href={`/ideas/${note.idea_id}`} className="hover:underline">
                          → 假设 #{note.idea_id}
                        </Link>
                      )}
                      {note.run_id && (
                        <Link href={`/runs/${note.run_id}`} className="hover:underline">
                          → 实验 #{note.run_id}
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground py-12 text-center text-sm">
        {text}
      </CardContent>
    </Card>
  );
}
