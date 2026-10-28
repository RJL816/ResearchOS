"use client";

import { useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
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
import { createRun, type RunStatus } from "@/lib/api";

const RUN_STATUSES: { value: RunStatus; label: string }[] = [
  { value: "running", label: "运行中" },
  { value: "succeeded", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "stopped", label: "已停止" },
  { value: "planned", label: "计划中" },
];

export function RunCreateDialog({
  projectId,
  onCreated,
}: {
  projectId: number;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<RunStatus>("running");
  const [gitCommit, setGitCommit] = useState("");
  const [dataset, setDataset] = useState("");
  const [evalProtocol, setEvalProtocol] = useState("");
  const [paramsText, setParamsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    let params: Record<string, unknown> | undefined;
    if (paramsText.trim()) {
      try {
        params = JSON.parse(paramsText);
      } catch {
        setError("参数不是合法的 JSON");
        setSubmitting(false);
        return;
      }
    }
    try {
      await createRun(projectId, {
        name: name.trim(),
        status,
        git_commit: gitCommit.trim() || undefined,
        dataset: dataset.trim() || undefined,
        eval_protocol: evalProtocol.trim() || undefined,
        params,
      });
      setOpen(false);
      setName("");
      setGitCommit("");
      setDataset("");
      setEvalProtocol("");
      setParamsText("");
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
          记录实验
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="size-4" />
              记录实验 Run
            </DialogTitle>
            <DialogDescription>
              手动登记一条实验记录；后续 CSV / TensorBoard 导入会以外部键幂等合并，不会重复。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="run-name">名称 *</Label>
                <Input
                  id="run-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="lora-rank-sweep-r8"
                  required
                  maxLength={300}
                />
              </div>
              <div className="space-y-2">
                <Label>状态</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as RunStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RUN_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="run-commit">Git commit</Label>
                <Input
                  id="run-commit"
                  value={gitCommit}
                  onChange={(e) => setGitCommit(e.target.value)}
                  placeholder="a1b2c3d"
                  maxLength={64}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="run-dataset">数据集</Label>
                <Input
                  id="run-dataset"
                  value={dataset}
                  onChange={(e) => setDataset(e.target.value)}
                  placeholder="natural-instructions"
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="run-protocol">评估协议</Label>
              <Input
                id="run-protocol"
                value={evalProtocol}
                onChange={(e) => setEvalProtocol(e.target.value)}
                placeholder="8-task avg accuracy, 5-shot"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="run-params">参数（JSON）</Label>
              <Textarea
                id="run-params"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                placeholder={'{\n  "lr": 1e-4,\n  "lora_rank": 8\n}'}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
