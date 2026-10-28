"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { createProject } from "@/lib/api";

export function ProjectCreateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setOpen(false);
      setName("");
      setDescription("");
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
        <Button>
          <Plus className="size-4" />
          新建项目
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>新建研究项目</DialogTitle>
            <DialogDescription>项目是假设、实验与笔记的容器。</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">名称 *</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：LoRA Adapter Scaling"
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">描述</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="研究目标、背景、约束……"
                rows={3}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
