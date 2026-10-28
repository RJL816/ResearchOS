"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Moon, Settings as SettingsIcon, Sun, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DesktopUpdate } from "@/components/desktop-update";
import { ModelSettingsCard } from "@/components/model-settings";
import { useTheme } from "@/components/theme";
import { resolveApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: SettingsIcon },
] as const;

const subscribeDesktop = () => () => {};
const desktopSnapshot = () => {
  const desktop = (window as unknown as { desktop?: { isDesktop: boolean; version: string | null } }).desktop;
  return desktop?.isDesktop ? desktop.version ?? "已安装" : null;
};

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [backend, setBackend] = useState<"checking" | "ok" | "down">("checking");
  const [backendUrl, setBackendUrl] = useState("");
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const desktopInfo = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => null);

  const check = useCallback(async () => {
    const url = resolveApiBase().replace(/\/$/, "");
    try {
      const res = await fetch(`${url}/api/health`, { cache: "no-store" });
      setBackendUrl(url);
      setBackend(res.ok ? "ok" : "down");
      if (res.ok) {
        const body = (await res.json()) as { version?: string };
        setBackendVersion(body.version ?? null);
      }
    } catch {
      setBackendUrl(url);
      setBackend("down");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Health status comes from the completed API request.
    void check();
  }, [check]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-6 py-6">
      <div>
        <h1 className="text-page-title">设置</h1>
        <p className="text-muted-foreground mt-0.5 text-[13px]">调整阅读外观，查看应用运行状态。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">外观</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-4 text-xs transition-standard",
                  theme === option.value
                    ? "border-primary bg-primary/5 text-foreground ring-primary/30 ring-1"
                    : "text-muted-foreground hover:border-foreground/25",
                )}
              >
                <option.icon className="size-4" />
                {option.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <ModelSettingsCard />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-card-title">本地服务</CardTitle>
          <Button variant="outline" size="sm" className="h-7" onClick={() => { setBackend("checking"); void check(); }}>
            重新检测
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            {backend === "ok" ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : backend === "down" ? (
              <XCircle className="size-4 text-destructive" />
            ) : (
              <span className="bg-muted size-4 animate-pulse rounded-full" />
            )}

            <span className="text-muted-foreground text-xs">
              {backend === "ok" ? "运行正常" : backend === "down" ? "暂时无法连接" : "正在检查…"}
            </span>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {desktopInfo ? "应用通过本机服务保存和读取研究记录，通常会随应用自动启动。" : "浏览器需要连接 Research OS 服务才能读取和保存研究记录。"}
            {backend === "down" && " 请尝试重启应用；若仍无法连接，可展开连接详情排查。"}
          </p>
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">连接详情</summary>
            <p className="mt-2 break-all font-mono">{backendUrl || "正在获取地址…"}</p>
            {!desktopInfo && <p className="mt-2">浏览器版的服务地址由部署环境配置。</p>}
          </details>
        </CardContent>
      </Card>

      <Card id="updates">
        <CardHeader>
          <CardTitle className="text-card-title">关于与更新</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">运行环境</span>
            <span className="font-mono text-[13px]">
              {desktopInfo ? `桌面版 ${desktopInfo}` : "浏览器（Web 模式）"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">服务版本</span>
            <span className="font-mono text-[13px]">{backendVersion ?? "—"}</span>
          </div>
          <DesktopUpdate />
          <p className="text-muted-foreground text-xs leading-relaxed">
            {desktopInfo
              ? "桌面版通过 GitHub Releases 自动更新；更新可用时会下载并提示重启。"
              : "桌面版可通过发布渠道获取更新。"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">导入与分析限制</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs leading-relaxed">
            <li>单次导入对话不超过 200,000 字符 / 500 条消息（可在后端环境变量调整）</li>
            <li>上传文件支持 .md / .markdown / .txt / .json，大小 ≤ 2MB，UTF-8 编码</li>
            <li>长对话按 12,000 字符分段送入 LLM，分段保留全局消息顺序</li>
            <li>发送前自动遮蔽疑似密钥；对话内容仅作为数据分析，不会执行</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
