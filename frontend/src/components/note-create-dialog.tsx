"use client";

import { useState } from "react";
import { NotebookPen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createNote, type Idea, type Run } from "@/lib/api";

export function NoteCreateDialog({
  projectId,
  ideas,
  runs,
  onCreated,
}: {
  projectId: number;
  ideas: Idea[];
  runs: Run[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [ideaId, setIdeaId] = useState<string>("none");
  const [runId, setRunId] = useState<string>("none");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createNote(projectId, {
        title: title.trim(),
        content: content.trim() || undefined,
        idea_id: ideaId !== "none" ? Number(ideaId) : undefined,
        run_id: runId !== "none" ? Number(runId) : undefined,
      });
      setOpen(false);
      setTitle("");
      setContent("");
      setIdeaId("none");
      setRunId("none");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="size-4" />
          写笔记
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <NotebookPen className="size-4" />
              研究笔记
            </DialogTitle>
            <DialogDescription>
              可选关联一个假设或实验；被关联对象删除后笔记仍会保留。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="note-title">标题 *</Label>
              <Input
                id="note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：第一轮 sweep 结论"
                required
                maxLength={300}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-content">内容</Label>
              <Textarea
                id="note-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="观察、结论、下一步计划……"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>关联假设（可选）</Label>
                <Select value={ideaId} onValueChange={setIdeaId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="不关联" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {ideas.map((idea) => (
                      <SelectItem key={idea.id} value={String(idea.id)}>
                        {idea.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>关联实验（可选）</Label>
                <Select value={runId} onValueChange={setRunId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="不关联" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {runs.map((run) => (
                      <SelectItem key={run.id} value={String(run.id)}>
                        {run.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
