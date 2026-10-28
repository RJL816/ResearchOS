"use client";
import { useState } from "react";
import { updateNote, type ResearchNote } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import Link from "next/link";

export const isNextNote = (note: ResearchNote) => /^(next\s*[:：]|下一步\s*[:：])/i.test(note.title);

export function ResearchNotes({ notes, onChanged }: { notes: ResearchNote[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<ResearchNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  async function save(note: ResearchNote, body: { title?: string; content?: string; is_done?: boolean }) {
    setBusy(note.id); setError(null);
    try { await updateNote(note.id, body); setEditing(null); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  return <div className="space-y-3">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notes.length === 0 && <p className="py-4 text-sm text-muted-foreground">暂无记录。可以先写下观察或下一步要验证的问题。</p>}
    {notes.map((note) => <article key={note.id} className="rounded-lg border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3"><h3 className={`text-sm font-medium ${note.is_done ? "line-through text-muted-foreground" : ""}`}>{note.title.replace(/^Next:\s*/i, "")}</h3><div className="flex shrink-0 gap-1">
        {isNextNote(note) && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void save(note, { is_done: !note.is_done })}>{note.is_done ? "重新打开" : "标记完成"}</Button>}
        <Button variant="ghost" size="sm" onClick={() => setEditing(note)}>编辑</Button>
      </div></div>
      {note.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.content}</p>}
      <div className="flex gap-3 text-xs text-primary">{note.idea_id && <Link href={`/ideas/${note.idea_id}`}>查看关联假设</Link>}{note.run_id && <Link href={`/runs/${note.run_id}`}>查看关联实验</Link>}</div>
    </article>)}
    {editing && <Dialog open onOpenChange={(open) => !open && setEditing(null)}><DialogContent><DialogHeader><DialogTitle>编辑研究记录</DialogTitle></DialogHeader>
      <label className="space-y-1 text-sm">标题<Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={300} /></label>
      <label className="space-y-1 text-sm">内容<Textarea value={editing.content ?? ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={8} /></label>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <DialogFooter><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button disabled={busy !== null || !editing.title.trim()} onClick={() => void save(editing, { title: editing.title.trim(), content: editing.content ?? "" })}>保存</Button></DialogFooter>
    </DialogContent></Dialog>}
  </div>;
}
