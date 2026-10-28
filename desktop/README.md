# Research OS 桌面版（Windows）

把 Research OS 打包为 Windows 桌面应用：Electron 外壳 + 静态导出的前端 + PyInstaller 打包的 FastAPI sidecar + SQLite。安装后的应用通过 **GitHub Releases 自动更新**。

## 架构

```
┌─ Electron 窗口 ──────────────────────────────────┐
│  前端（静态导出，app:// 协议 + SPA fallback）      │
│      │ fetch → http://127.0.0.1:<port>            │
│  FastAPI sidecar（PyInstaller exe，子进程）        │
│      └─ SQLite（应用数据目录，随安装保留）          │
└──────────────────────────────────────────────────┘
        ↑ electron-updater 检查 GitHub Releases
```

- 主进程 `main.cjs`：选空闲端口启动 sidecar → 等待 `/api/health` → 把端口写入 `web/config.js`（前端运行时读取，见 `frontend/src/lib/api.ts` 的 `resolveApiBase()`）→ 加载窗口
- 前端静态导出：`frontend` 目录执行 `DESKTOP_BUILD=1 npm run build`（产出 `out/`），动态路由生成 `app` 占位页，`app://` 协议把任意深链的数字段替换成 `app` 实现 SPA fallback，深链可直接打开

## 构建步骤（Windows 开发机，一次性）

```bash
# 1. 前端静态导出
cd frontend
DESKTOP_BUILD=1 npm run build        # Git Bash；PowerShell 用 $env:DESKTOP_BUILD="1"; npm run build
rm -rf ../desktop/web && cp -r out ../desktop/web

# 2. 后端 sidecar
cd ../backend
.venv/Scripts/pip install pyinstaller
.venv/Scripts/python scripts/build_sidecar.py

# 3. 桌面壳
cd ../desktop
npm install
npm run start       # 开发预览（会尝试启动 sidecar）
npm run dist        # 产出 release/ResearchOS-Setup-<version>.exe
```

## 发布与自动更新

1. 在 `desktop/package.json` 的 `build.publish` 里把 `owner` 改为你的 GitHub 用户名/仓库名。
2. 版本号以 `desktop/package.json` 的 `version` 为准（升级时同步 bump）。
3. 发布：

   ```bash
   # 需要 GH_TOKEN（repo 权限）
   cd desktop && npm run release
   ```

   electron-builder 会构建 NSIS 安装包 + `latest.yml` 并上传到 GitHub Releases（草稿）。
4. 已安装的客户端启动时及每小时自动检查 Release；下载完成后通过 Toast/设置页提示「重启以更新」。

> 更新只替换 Electron 外壳与前端；用户数据库保存在应用数据目录，升级不迁移不覆盖。

## 日常开发

Web 模式不受影响：`frontend` 目录 `npm run dev` + `backend` 目录 uvicorn，与之前完全一致。桌面模式仅在 `DESKTOP_BUILD=1` 构建时启用，两条产物互不干扰。
