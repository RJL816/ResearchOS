"use client";

import { useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { createIdea } from "@/lib/api";

/** Creating an idea also creates its immutable version 1. */
export function IdeaCreateDialog({
  projectId,
  onCreated,
}: {
  projectId: number;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createIdea(projectId, {
        title: title.trim(),
        body: body.trim(),
      });
      setOpen(false);
      setTitle("");
      setBody("");
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
          新建假设
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="size-4" />
              新建研究假设
            </DialogTitle>
            <DialogDescription>
              提交后自动生成不可变的 v1；之后通过「新增版本」演化假设。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="idea-title">标题 *</Label>
              <Input
                id="idea-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="一句话概括假设，例如：Rank–performance 边际递减"
                required
                maxLength={300}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="idea-body">假设正文（v1）*</Label>
              <Textarea
                id="idea-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="清晰写出：预期现象、机制解释、可验证的判据"
                rows={5}
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !title.trim() || !body.trim()}>
              {submitting ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
