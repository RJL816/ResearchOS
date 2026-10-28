"use client";

import { useState } from "react";
import { GitBranchPlus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addIdeaVersion } from "@/lib/api";

/** Appends a new immutable version; the backend links it to the previous one. */
export function AddVersionDialog({
  ideaId,
  nextVersionNumber,
  onCreated,
  currentBody = "",
}: {
  ideaId: number;
  nextVersionNumber: number;
  onCreated: () => void;
  currentBody?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(currentBody);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addIdeaVersion(ideaId, {
        body: body.trim(),
        change_reason: reason.trim() || undefined,
      });
      setOpen(false);
      setBody("");
      setReason("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setBody(currentBody); setOpen(value); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <GitBranchPlus className="size-4" />
          新增版本 v{nextVersionNumber}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranchPlus className="size-4" />
              新增假设版本 v{nextVersionNumber}
            </DialogTitle>
            <DialogDescription>
              旧版本保持不变；系统会自动记录 v{nextVersionNumber - 1} → v{nextVersionNumber}{" "}
              的 revision 演化边。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="version-body">新版假设正文 *</Label>
              <Textarea
                id="version-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                required
                placeholder="写出修订后的完整假设（不是 diff）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-reason">变更原因</Label>
              <Textarea
                id="version-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="是什么证据/阅读促使了这次修订？"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !body.trim()}>
              {submitting ? "创建中…" : "创建版本"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
