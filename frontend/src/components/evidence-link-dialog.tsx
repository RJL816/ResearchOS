"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  linkEvidence,
  listIdeas,
  listRuns,
  type Idea,
  type Run,
  type Verdict,
} from "@/lib/api";

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "supports", label: "支持 (supports)" },
  { value: "refutes", label: "反驳 (refutes)" },
  { value: "inconclusive", label: "不确定 (inconclusive)" },
];

type Props =
  | {
      mode: "version";
      /** Linking from an idea page: run is chosen, version defaults to current. */
      idea: Idea;
      initialVersionId?: number;
      projectId: number;
      onLinked: () => void;
    }
  | {
      mode: "run";
      /** Linking from a run page: idea + version are chosen. */
      runId: number;
      initialVersionId?: number;
      projectId: number;
      onLinked: () => void;
    };

export function EvidenceLinkDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string>("");
  const [ideaId, setIdeaId] = useState<string>(
    props.mode === "version" ? String(props.idea.id) : "",
  );
  const [versionId, setVersionId] = useState<string>("");
  const [verdict, setVerdict] = useState<Verdict>("inconclusive");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    Promise.all([listRuns(props.projectId), listIdeas(props.projectId)])
      .then(([runList, ideaList]) => {
        if (stale) return;
        setLoadError(null);
        setRuns(runList);
        setIdeas(ideaList);
        if (props.mode === "run" && props.initialVersionId) {
          const target = ideaList.find((i) => i.versions.some((v) => v.id === props.initialVersionId));
          if (target) { setIdeaId(String(target.id)); setVersionId(String(props.initialVersionId)); }
        }
        if (props.mode === "version") {
          setVersionId(
            String(props.initialVersionId ?? props.idea.current_version_id ?? ""),
          );
        }
      })
      .catch((err) => { if (!stale) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.projectId]);

  const selectedIdea = useMemo(
    () => ideas.find((i) => String(i.id) === ideaId),
    [ideas, ideaId],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await linkEvidence({
        idea_version_id: Number(versionId),
        run_id: props.mode === "version" ? Number(runId) : props.runId,
        verdict,
        note: note.trim() || undefined,
      });
      setOpen(false);
      setNote("");
      props.onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const ready =
    (props.mode === "version" ? runId !== "" : true) &&
    versionId !== "" &&
    (props.mode === "run" ? ideaId !== "" : true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 className="size-4" />
          关联证据
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="size-4" />
              建立证据关联
            </DialogTitle>
            <DialogDescription>
              把一个实验 Run 与某个假设版本关联，并给出 supports / refutes /
              inconclusive 判定。同一对可重复提交，判定会被更新。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
            {props.mode === "version" && (
              <div className="space-y-2">
                <Label>实验 Run *</Label>
                <Select value={runId} onValueChange={setRunId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择一个 Run" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((run) => (
                      <SelectItem key={run.id} value={String(run.id)}>
                        {run.name}（{run.status}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {props.mode === "run" && (
              <div className="space-y-2">
                <Label>假设 *</Label>
                <Select value={ideaId} onValueChange={(value) => { setIdeaId(value); setVersionId(String(ideas.find((i) => i.id === Number(value))?.current_version_id ?? "")); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择假设" />
                  </SelectTrigger>
                  <SelectContent>
                    {ideas.map((idea) => (
                      <SelectItem key={idea.id} value={String(idea.id)}>
                        {idea.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>假设版本 *</Label>
              {props.mode === "version" ? (
                <Select value={versionId} onValueChange={setVersionId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{props.idea.versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>v{v.version_number}{v.id === props.idea.current_version_id ? "（当前）" : ""}</SelectItem>)}</SelectContent></Select>
              ) : (
                <Select value={versionId} onValueChange={setVersionId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择版本" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedIdea?.versions ?? []).map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        v{v.version_number}
                        {v.id === selectedIdea?.current_version_id ? "（当前）" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>判定 *</Label>
              <Select value={verdict} onValueChange={(v) => setVerdict(v as Verdict)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERDICTS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-note">备注</Label>
              <Textarea
                id="evidence-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="支撑判定的关键数字，例如 +3.4pt on DROP"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {ideas.length === 0 && <Link href={`/projects/${props.projectId}`} className="text-sm text-primary underline">先到项目工作台创建假设</Link>}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !ready}>
              {submitting ? "提交中…" : "建立关联"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
