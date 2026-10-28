"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Moon, Settings as SettingsIcon, Sun, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme";
import { resolveApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: SettingsIcon },
] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [backend, setBackend] = useState<"checking" | "ok" | "down">("checking");
  const [backendUrl, setBackendUrl] = useState("");
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBackend("checking");
    const url = resolveApiBase().replace(/\/$/, "");
    setBackendUrl(url);
    try {
      const res = await fetch(`${url}/api/health`, { cache: "no-store" });
      setBackend(res.ok ? "ok" : "down");
      if (res.ok) {
        const body = (await res.json()) as { version?: string };
        setBackendVersion(body.version ?? null);
      }
    } catch {
      setBackend("down");
    }
  }, []);

  useEffect(() => {
    void check();
    // Desktop shell bridge (preload.cjs) — absent in a plain browser.
    const desktop = (window as unknown as {
      desktop?: { isDesktop: boolean; version: string | null };
    }).desktop;
    if (desktop?.isDesktop) {
      setDesktopInfo(desktop.version ?? "已安装");
    }
  }, [check]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-6 py-6">
      <div>
        <h1 className="text-page-title">设置</h1>
        <p className="text-muted-foreground mt-0.5 text-[13px]">外观与系统连接状态。</p>
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

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-card-title">后端连接</CardTitle>
          <Button variant="outline" size="sm" className="h-7" onClick={() => void check()}>
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
            <span className="font-mono text-[13px]">{backendUrl}</span>
            <span className="text-muted-foreground text-xs">
              {backend === "ok" ? "已连接" : backend === "down" ? "无法连接" : "检测中…"}
            </span>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            后端地址由 <code className="bg-muted rounded px-1 font-mono">NEXT_PUBLIC_API_URL</code> 配置。
            GLM 运行时凭证在 <code className="bg-muted rounded px-1 font-mono">backend/.env</code> 中以{" "}
            <code className="bg-muted rounded px-1 font-mono">RESEARCH_OS_GLM_API_KEY</code> 配置，
            与开发工具的凭证相互独立。
          </p>
        </CardContent>
      </Card>

      <Card>
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
            <span className="text-muted-foreground text-xs">后端版本</span>
            <span className="font-mono text-[13px]">{backendVersion ?? "—"}</span>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {desktopInfo
              ? "桌面版通过 GitHub Releases 自动更新；下载完成后会提示重启应用。"
              : "打包为桌面应用后，此处可一键检查更新（通过 GitHub Releases 分发）。"}
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
            <li>长对话按 12,000 字符分段送入 GLM，分段保留全局消息顺序</li>
            <li>发送前自动遮蔽疑似密钥；对话内容仅作为数据分析，不会执行</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
