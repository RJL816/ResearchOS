"use client";
import { useEffect, useState } from "react";
import { listIdeas, reviewProposal, type GraphChangeProposal, type Idea, type IdeaStatus, type EdgeRelation } from "@/lib/api";
import { IDEA_STATES } from "@/components/idea-status-select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function EditProposalDialog({ proposal, onClose, onSaved }: { proposal: GraphChangeProposal; onClose: () => void; onSaved: (proposal: GraphChangeProposal) => void }) {
  const payload = proposal.payload;
  const isNote = ["add_research_note", "add_open_question", "link_existing_idea"].includes(proposal.action_type);
  const hasTitle = proposal.action_type === "create_idea" || isNote;
  const hasBody = hasTitle || proposal.action_type === "create_idea_version";
  const hasTarget = !["create_idea", "create_idea_edge"].includes(proposal.action_type);
  const isEdge = proposal.action_type === "create_idea_edge";
  const [title, setTitle] = useState(String(payload.title ?? ""));
  const [body, setBody] = useState(String(payload.body ?? payload.content ?? ""));
  const [reason, setReason] = useState(String(payload.change_reason ?? ""));
  const [target, setTarget] = useState(typeof payload.idea_id === "number" ? String(payload.idea_id) : "keep");
  const [src, setSrc] = useState(typeof payload.src_version_id === "number" ? String(payload.src_version_id) : "keep");
  const [dst, setDst] = useState(typeof payload.dst_version_id === "number" ? String(payload.dst_version_id) : "keep");
  const [relation, setRelation] = useState(String(payload.relation ?? "derivation"));
  const [status, setStatus] = useState(String(payload.status ?? "exploring"));
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { let stale = false; listIdeas(proposal.project_id).then((data) => { if (!stale) setIdeas(data); }).catch((err) => { if (!stale) setError(String(err)); }); return () => { stale = true; }; }, [proposal.project_id]);
  async function save() {
    setSaving(true); setError(null);
    try {
      const edits: NonNullable<Parameters<typeof reviewProposal>[1]["edits"]> = {};
      if (hasTitle) edits.title = title.trim();
      if (hasBody) { if (isNote) edits.note_content = body; else edits.body = body.trim(); }
      if (hasTarget && target !== "keep") edits.target_idea_id = Number(target);
      if (proposal.action_type === "create_idea_version") edits.change_reason = reason;
      if (proposal.action_type === "propose_status_change") edits.status = status as IdeaStatus;
      if (isEdge) { edits.relation = relation as EdgeRelation; if (src !== "keep") edits.src_version_id = Number(src); if (dst !== "keep") edits.dst_version_id = Number(dst); }
      onSaved(await reviewProposal(proposal.id, { edits, review_status: "pending" }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  }
  const versionOptions = ideas?.flatMap((idea) => idea.versions.map((v) => <SelectItem key={v.id} value={String(v.id)}>{idea.title} · v{v.version_number}</SelectItem>));
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>修正提案</DialogTitle><DialogDescription>修改后重新确认接受，再应用到研究记录。原始讨论来源会保留。</DialogDescription></DialogHeader>
    {hasTitle && <div className="space-y-1"><Label>标题</Label><Textarea value={title} onChange={(e) => setTitle(e.target.value)} rows={2} maxLength={300} /></div>}
    {hasTarget && <div className="space-y-1"><Label>关联假设</Label><Select value={target} onValueChange={setTarget}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">保留原目标 / 提案依赖</SelectItem>{ideas?.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.title}</SelectItem>)}</SelectContent></Select></div>}
    {hasBody && <div className="space-y-1"><Label>{isNote ? "笔记内容" : "假设正文"}</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} /></div>}
    {proposal.action_type === "create_idea_version" && <div className="space-y-1"><Label>修改原因</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>}
    {proposal.action_type === "propose_status_change" && <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="目标状态"><SelectValue /></SelectTrigger><SelectContent>{IDEA_STATES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select>}
    {isEdge && <><div className="space-y-1"><Label>起点版本</Label><Select value={src} onValueChange={setSrc}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">保留原端点 / 提案依赖</SelectItem>{versionOptions}</SelectContent></Select></div><div className="space-y-1"><Label>终点版本</Label><Select value={dst} onValueChange={setDst}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="keep">保留原端点 / 提案依赖</SelectItem>{versionOptions}</SelectContent></Select></div><Select value={relation} onValueChange={setRelation}><SelectTrigger aria-label="演化关系"><SelectValue /></SelectTrigger><SelectContent>{Object.entries({ revision: "修订", derivation: "分支", merge: "合并", challenges: "质疑", supersedes: "替代" }).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={saving || ideas === null || (hasTitle && !title.trim()) || (hasBody && !isNote && !body.trim()) || (isEdge && src !== "keep" && src === dst)} onClick={() => void save()}>{saving ? "保存中…" : "保存并重新审核"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
