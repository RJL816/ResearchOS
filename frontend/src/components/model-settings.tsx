"use client";
import { useEffect, useState } from "react";
import { getModelSettings, setModelSettings, type ModelSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ModelSettingsCard() {
  const [info, setInfo] = useState<ModelSettings | null>(null);
  const [url, setUrl] = useState(""); const [model, setModel] = useState(""); const [key, setKey] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { let stale = false; getModelSettings().then((data) => { if (!stale) { setInfo(data); setUrl(data.base_url); setModel(data.model); } }).catch((err) => { if (!stale) setMessage(String(err)); }); return () => { stale = true; }; }, []);
  async function save() {
    setBusy(true); setMessage("");
    try { const data = await setModelSettings({ api_key: key, base_url: url, model }); setInfo(data); setKey(""); setMessage("已配置，可以返回 Agent 导入进行解析。"); }
    catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <Card><CardHeader><CardTitle className="text-card-title">模型 API</CardTitle><CardDescription>用于解析助手整理的内容，也可用于对话分析。支持兼容 Chat Completions 的服务。</CardDescription></CardHeader><CardContent className="space-y-3">
    <p className="text-sm">{info?.configured ? "已配置" : "尚未配置"}{info?.temporary ? " · 本次运行有效" : ""}</p>
    <label className="space-y-1 text-sm">API 基础地址<Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/v1" /></label>
    <label className="space-y-1 text-sm">模型名称<Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型名称" /></label>
    <label className="space-y-1 text-sm">API 密钥<Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info?.configured ? "留空保留现有密钥" : "输入密钥以配置"} /></label>
    <p className="text-xs text-muted-foreground">密钥由 Windows 当前用户加密保存，重启后无需再次填写；解析内容会发送到你配置的服务。</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    <Button disabled={busy || (!key.trim() && !info?.configured) || !url.trim() || !model.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存模型配置"}</Button>
  </CardContent></Card>;
}
