"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouteId, useRouter } from "@/lib/navigation";
import { createResearchIdea, listResearchIdeas, type ResearchIdea } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export default function ResearchIdeaList() {
 const projectId=useRouteId(); const router=useRouter(); const [items,setItems]=useState<ResearchIdea[]|null>(null); const [name,setName]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try {setItems(await listResearchIdeas(projectId));setError("");} catch(e){setError(e instanceof Error?e.message:String(e));}},[projectId]);
 useEffect(()=>{void Promise.resolve().then(load)},[load]);
 async function create(){setBusy(true);setError("");try {const idea=await createResearchIdea(projectId,name.trim());router.push(`/research-ideas/${idea.id}`);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false)}}
 return <div className="mx-auto max-w-5xl space-y-6 px-6 py-8"><Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground">← 返回项目</Link><div><h1 className="text-page-title">研究 Idea</h1><p className="mt-2 text-muted-foreground">围绕一条研究思路，记录目标、方法、创新点、理论、实验结论与未来规划。</p></div><Card><CardContent><h2 className="font-semibold">建立研究思路</h2><p className="text-sm text-muted-foreground">先给 Idea 起一个名字，然后填写内容，或导入 AI 助手整理的 Markdown 方案。</p><div className="flex flex-wrap gap-2"><Input aria-label="研究 Idea 名称" className="max-w-lg" value={name} onChange={e=>setName(e.target.value)} placeholder="例如：面向困难任务的自适应计算" maxLength={300}/><Button disabled={busy || !name.trim()} onClick={()=>void create()}>创建研究 Idea</Button></div></CardContent></Card>{error&&<p role="alert" className="text-destructive">{error}</p>}<div className="space-y-3"><h2 className="text-section-title">已有研究思路</h2>{items===null?<p>正在加载…</p>:items.length===0?<p className="rounded-lg border p-6 text-sm text-muted-foreground">还没有研究 Idea。现有假设仍在项目工作台中，可以稍后关联。</p>:items.map(item=><Link href={`/research-ideas/${item.id}`} key={item.id} className="block rounded-xl border bg-card p-5 transition-standard hover:border-primary/40"><h3 className="font-semibold">{item.title}</h3><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.goal || item.background || "尚未填写研究目标"}</p></Link>)}</div></div>
}
