"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type UpdateState = { status: "idle" | "checking" | "downloading" | "downloaded" | "current" | "error"; version: string | null; percent: number | null; error: string | null };
type DesktopBridge = { isDesktop: boolean; getUpdateStatus?: () => Promise<UpdateState>; onUpdateStatus?: (callback: (state: UpdateState) => void) => () => void; checkForUpdates?: () => Promise<unknown>; installUpdate?: () => Promise<void> };
export function DesktopUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const desktop = (window as unknown as {desktop?: DesktopBridge}).desktop;
    if (!desktop?.isDesktop || !desktop.getUpdateStatus) return;
    let active = true;
    const unsubscribe = desktop.onUpdateStatus?.((value) => { if (active) setState(value); });
    void desktop.getUpdateStatus().then((value) => { if (active) setState(value); }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, []);
  async function check() {
    const desktop = (window as unknown as {desktop?: DesktopBridge}).desktop;
    if (!desktop?.checkForUpdates) return;
    try { await desktop.checkForUpdates(); } catch (err) { setState({status:"error",version:null,percent:null,error:err instanceof Error ? err.message : String(err)}); }
  }
  if (!state) return null;
  const labels = {idle:"启动时会自动检查更新。", checking:"正在检查更新…", downloading:`正在下载 ${state.version ?? "新版本"}${state.percent === null ? "" : ` · ${state.percent}%`}`, downloaded:`${state.version ?? "新版本"} 已下载，可以重启安装。`, current:"当前已是最新版本。", error:"检查更新失败，请检查网络后重试。"};
  return <div className="space-y-2 border-t pt-3"><p role="status" className="text-sm">{labels[state.status]}</p>{state.status === "error" && state.error && <details className="text-xs text-muted-foreground"><summary>查看错误详情</summary><p className="break-words">{state.error}</p></details>}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={state.status === "checking" || state.status === "downloading"} onClick={() => void check()}>检查更新</Button>{state.status === "downloaded" && <Button size="sm" onClick={() => void (window as unknown as {desktop?: DesktopBridge}).desktop?.installUpdate?.()}>重启并安装</Button>}</div></div>;
}
