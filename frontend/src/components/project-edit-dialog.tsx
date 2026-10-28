"use client";
import { useState } from "react";
import { updateProject, type Project, type ProjectStatus } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
export function ProjectEditDialog({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const { refresh } = useProjectContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() { setBusy(true); setError(null); try { await updateProject(project.id, { name: name.trim(), description, status }); await refresh(); onSaved(); setOpen(false); } catch (err) { setError(String(err)); } finally { setBusy(false); } }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm">编辑项目</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>编辑研究项目</DialogTitle></DialogHeader><label className="space-y-1 text-sm">名称<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></label><label className="space-y-1 text-sm">研究问题与目标<Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} /></label><Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}><SelectTrigger aria-label="项目状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">进行中</SelectItem><SelectItem value="paused">已暂停</SelectItem><SelectItem value="archived">已归档</SelectItem></SelectContent></Select>{error && <p className="text-destructive text-sm">{error}</p>}<DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>取消</Button><Button disabled={busy || !name.trim()} onClick={() => void save()}>保存</Button></DialogFooter></DialogContent></Dialog>;
}
