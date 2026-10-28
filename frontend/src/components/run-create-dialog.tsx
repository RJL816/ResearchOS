"use client";

import { useEffect, useState } from "react";
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
import { createRun, updateRun, listIdeas, type Idea, type Run, type RunStatus } from "@/lib/api";
import { useRouter } from "@/lib/navigation";

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
  initialVersionId,
  researchIdeaId,
  run,
}: {
  projectId: number;
  onCreated: () => void;
  initialVersionId?: number;
  researchIdeaId?: number;
  run?: Run;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(run?.name ?? "");
  const [status, setStatus] = useState<RunStatus>(run?.status ?? "planned");
  const [gitCommit, setGitCommit] = useState(run?.git_commit ?? "");
  const [dataset, setDataset] = useState(run?.dataset ?? "");
  const [evalProtocol, setEvalProtocol] = useState(run?.eval_protocol ?? "");
  const [paramsText, setParamsText] = useState(run?.params ? JSON.stringify(run.params, null, 2) : "");
  const [notes, setNotes] = useState(run?.notes ?? "");
  const [target, setTarget] = useState(String(run?.target_version_id ?? initialVersionId ?? "none"));
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    listIdeas(projectId).then((data) => { if (!stale) setIdeas(data); }).catch((err) => { if (!stale) setError(String(err)); });
    return () => { stale = true; };
  }, [open, projectId]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    let params: Record<string, unknown> | undefined;
    if (paramsText.trim()) {
      try {
        params = JSON.parse(paramsText);
        if (!params || Array.isArray(params) || typeof params !== "object") throw new Error();
      } catch {
        setError("参数不是合法的 JSON");
        setSubmitting(false);
        return;
      }
    }
    try {
      const body = {
        name: name.trim(),
        research_idea_id: run ? run.research_idea_id : researchIdeaId,
        status,
        git_commit: gitCommit.trim(),
        dataset: dataset.trim(),
        eval_protocol: evalProtocol.trim(),
        params: params ?? (run ? {} : undefined),
        notes,
        target_version_id: target === "none" ? null : Number(target),
      };
      const saved = run ? await updateRun(run.id, body) : await createRun(projectId, body);
      setOpen(false);
      setName("");
      setGitCommit("");
      setDataset("");
      setEvalProtocol("");
      setParamsText("");
      onCreated();
      if (!run) router.push(`/runs/${saved.id}`);
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
          {run ? "编辑实验 / 更新进展" : initialVersionId ? "安排验证实验" : "记录实验"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="size-4" />
              {run ? "更新实验记录" : "安排或记录实验"}
            </DialogTitle>
            <DialogDescription>
              先关联要验证的假设版本；实验完成后再根据结果判断是否支持它。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-4">
            <div className="space-y-2">
              <Label>验证目标</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-full"><SelectValue placeholder="选择假设版本" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">暂不关联</SelectItem>
                  {ideas.flatMap((idea) => idea.versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{idea.title} · v{v.version_number}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
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
            <div className="space-y-2"><Label htmlFor="run-notes">实验设计 / 结果与结论</Label><Textarea id="run-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="记录对照条件、预期判据，以及实际观察到的结果" /></div>
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
