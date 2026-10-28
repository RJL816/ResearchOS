"use client";
import { useState } from "react";
import { updateIdea, type IdeaStatus } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export const IDEA_STATES: { value: IdeaStatus; label: string }[] = [
  { value: "exploring", label: "探索中" }, { value: "testing", label: "验证中" }, { value: "validated", label: "已验证" }, { value: "refuted", label: "已反驳" }, { value: "parked", label: "已搁置" },
];
export function IdeaStatusSelect({ ideaId, status, onChanged }: { ideaId: number; status: IdeaStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(value: string) {
    setBusy(true); setError(null);
    try { await updateIdea(ideaId, { status: value as IdeaStatus }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <div><Select value={status} onValueChange={(value) => void change(value)} disabled={busy}><SelectTrigger aria-label="更新假设状态" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{IDEA_STATES.map((state) => <SelectItem key={state.value} value={state.value}>{state.label}</SelectItem>)}</SelectContent></Select>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}
