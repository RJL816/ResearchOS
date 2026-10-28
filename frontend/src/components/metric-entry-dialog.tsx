"use client";
import { useState } from "react";
import { addMetrics } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

export function MetricEntryDialog({ runId, onSaved }: { runId: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    try {
      const points = text.trim().split(/\r?\n/).map((line, index) => {
        const parts = line.trim().split(/[,\t ]+/);
        const [name, stepText, valueText] = parts;
        const step = Number(stepText), value = Number(valueText);
        if (parts.length !== 3 || !name || !Number.isSafeInteger(step) || step < 0 || !Number.isFinite(value)) throw new Error(`第 ${index + 1} 行格式有误，应为：指标名称, 非负整数步数, 数值`);
        return { name, step, value };
      });
      const keys = points.map((p) => `${p.name}\0${p.step}`);
      if (new Set(keys).size !== keys.length) throw new Error("本次录入存在重复的指标名称和步数，请保留一个数值。");
      await addMetrics(runId, points); setText(""); setOpen(false); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline">补录指标</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>补录实验指标</DialogTitle><DialogDescription>每行一个指标点：名称, step, 数值。支持从表格复制三列；同名同 step 的已有数值会被更新。</DialogDescription></DialogHeader><Textarea aria-label="指标数据" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"accuracy, 0, 0.72\naccuracy, 100, 0.81\nloss, 100, 0.24"} className="font-mono text-xs" />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存指标"}</Button></DialogFooter></DialogContent></Dialog>;
}
