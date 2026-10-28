# Research OS

面向机器学习研究者的个人科研管理系统：把**研究假设（Idea）及其演化历史**、**实验记录（Run）与指标**、**证据关系（Evidence）**和**研究笔记**统一管理在本地。

> Phase 1 交付：前后端骨架、8 张核心数据表 + Alembic 迁移、完整 CRUD API、Next.js 界面、演示数据脚本。重启服务后数据持久化。
> Phase 2 交付：**Idea 演化图谱**（`/projects/{id}/ideas/graph`）——真实数据驱动的交互式 DAG 视图，详见下文「Idea 演化图谱（Phase 2）」。
> Phase 3 交付：**AI 对话分析闭环**——导入 AI 科研对话 → GLM 提取研究事件 → 生成待审核变更集 → 人工逐项审核 → 事务化应用 → 图谱溯源，详见「AI 对话分析（Phase 3）」。

## Idea 演化图谱（Phase 2）

入口：项目详情页「演化图谱」按钮，或直接访问 `/projects/{projectId}/ideas/graph`。

- **数据全部来自数据库**：`GET /api/projects/{id}/idea-graph` 返回项目内全部 IdeaVersion（节点，稳定 DB id）与 IdeaEdge（关系边）；`GET /api/idea-versions/{id}/details` 返回详情面板所需的前驱/后继、版本 diff 基准、证据（含 Run 关键指标）与笔记。节点位置只存在于前端视图，不写回数据库。
- **关系语义**：revision=改进(refines)、derivation=分支(branches_from)、merge=合并(combines)、challenges=质疑(challenges)、supersedes=替代(supersedes)。新增关系类型通过 Alembic batch 迁移扩展 CHECK 约束实现。
- **交互**：点击节点/边 → 右侧五区详情（概览、演化含词级 diff、证据、Markdown 笔记、下一步）；关系行可跳转定位；`?node={version_id}` 保存选中状态，刷新恢复；TB/LR 自动布局（dagre）、状态筛选、标题/摘要搜索定位、Fit View、重新布局、小地图、缩放；检测到环路时显著告警（布局自动断环）。
- **边界行为**：假设状态永远由研究者手动维护，证据判定（supports/refutes/inconclusive）不会自动改写状态；空项目/无证据/无笔记均有明确空状态；50 节点/50 边实测流畅。
- **技术**：`@xyflow/react` 渲染 + `@dagrejs/dagre` 自动布局 + `react-markdown`；复杂 DAG 可按 `components/idea-graph/graph-layout.ts` 预留接口替换 ELK.js。

## AI 对话分析（Phase 3）

入口：项目页 / 图谱页「导入对话」→ `/projects/{id}/conversations`；分析完成后进入 `/analysis/{jobId}` 双栏审核页。

**闭环**：对话导入（粘贴 / .md/.txt/.json 上传，角色标记解析，内容哈希幂等去重）→ GLM 分段提取研究事件（9 类事件，全部强制引用来源消息；JSON 校验失败有限重试）→ 与现有 Idea Graph 匹配（精确 ID → 词面相似 → 歧义即 needs_review，绝不静默合并）→ 生成 GraphChangeProposal（7 类动作）→ 人工逐项接受 / 拒绝 / 编辑 → 事务化 Apply（依赖排序、占位符解析、幂等、版本冲突拦截）→ 图谱展示 + 节点溯源（`message_source_links` 记录产生每个实体的会话消息）。

**安全护栏**：对话内容是不可信数据（包裹于 untrusted 标签、不执行其中指令）；发送给 GLM 前遮蔽疑似密钥并可在 UI 查看发送范围；对话中的实验描述只记笔记、**从不**生成 EvidenceLink；质疑只记笔记/关系、从不改假设状态；新 Idea 版本只追加、旧版本永不变更。

**GLM 凭证（重要）**：应用运行时凭证**只**从 `RESEARCH_OS_GLM_API_KEY` 等前缀变量读取（backend/.env），与开发所用 Coding Agent 的 GLM 套餐/凭证完全隔离、不共享额度。未配置时 analyze 接口返回 503 并给出明确提示。

**测试**：`backend/tests/test_analysis_pipeline.py` + `test_conversation_import.py` 使用 Mock LLM 覆盖 17 项验收场景（单 Idea/细化链/分支/合并/质疑未否定/未采纳/推翻决策/虚构实验/非法消息引用/依赖排序/部分接受/重复导入/幂等 Apply/版本冲突/非法 JSON/GLM 失败/图谱完整性）。本地端到端演示可用 `scripts/mock_glm_server.py`（OpenAI 兼容协议）配合 `RESEARCH_OS_GLM_BASE_URL=http://127.0.0.1:9812/api/paas/v4` 运行。

## 架构

```
┌─────────────────────┐      HTTP (REST/JSON)      ┌──────────────────────┐
│  Next.js 16 前端     │  ───────────────────────▶  │  FastAPI 后端         │
│  TypeScript+TW+     │   http://localhost:8000    │  SQLAlchemy 2 +      │
│  shadcn/ui          │  ◀───────────────────────  │  Pydantic v2         │
│  :3000              │                            │  Alembic             │
└─────────────────────┘                            └─────────┬────────────┘
                                                             │
                                                    SQLite (WAL, research_os.db)
```

- 前端**不直接访问数据库**，所有数据经 `frontend/src/lib/api.ts` 走后端 REST API。
- 后端配置与业务逻辑分离（`app/config.py`，支持 `.env` / 环境变量）。
- 未来实验文件导入（CSV / TensorBoard / JSON 日志）通过 `app/importers/` 预留接口接入，不改动核心模型。

## 快速开始

环境要求：Python ≥ 3.10、Node ≥ 20。以下命令在 **Git Bash / Windows** 下验证过（Windows 下 venv 解释器在 `.venv/Scripts/`，Linux/macOS 为 `.venv/bin/`）。

### 1. 后端（FastAPI，端口 8000）

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

# 数据库迁移（生成 research_os.db）
.venv/Scripts/python -m alembic upgrade head

# 可选：生成演示数据（两个项目、假设演化链、带指标的实验、证据、笔记）
.venv/Scripts/python scripts/seed_demo_data.py        # 重复运行自动跳过；--reset 重置

# 启动 API
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

交互式文档：<http://localhost:8000/docs>

> 国内网络提示：若某镜像安装失败可换 `-i https://mirrors.aliyun.com/pypi/simple/` 或默认 PyPI。

### 2. 前端（Next.js，端口 3000）

```bash
cd frontend
npm install
cp .env.example .env.local      # 默认 NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                     # 或 npm run build && npm start
```

打开 <http://localhost:3000>：新建项目 → 在项目内新建假设（自动产生不可变 v1）→ 新增版本（自动记录 revision 演化边）→ 记录实验（参数 JSON / git commit / 数据集 / 评估协议）→ 在假设或实验页建立 supports / refutes / inconclusive 证据关联。

### 3. 测试

```bash
cd backend && .venv/Scripts/python -m pytest    # 40 项：约束/级联/API 行为/幂等导入
cd frontend && npm run build                    # TypeScript + ESLint + 产物构建
```

## 数据模型

| 表 | 说明 | 关键约束 |
|---|---|---|
| `projects` | 研究项目 | `name` 全局唯一；status ∈ active/paused/archived |
| `ideas` | 假设的**身份**（标题、状态、当前版本指针） | `(project_id, title)` 唯一；`current_version_id` → SET NULL |
| `idea_versions` | 不可变的假设正文快照 | `(idea_id, version_number)` 唯一；**只有 created_at，无更新路径** |
| `idea_edges` | 版本间演化边 | `(src, dst, relation)` 唯一；禁止自环；relation ∈ revision/derivation/merge |
| `experiment_runs` | 实验记录 | `(project_id, external_source, external_key)` 唯一 → **幂等导入锚点** |
| `metric_points` | 指标点（原始名称/step/value/时间戳） | `(run_id, name, step)` 唯一 → 指标 upsert |
| `evidence_links` | 版本 × 实验的证据关系 | `(idea_version_id, run_id)` 唯一；verdict ∈ supports/refutes/inconclusive |
| `research_notes` | 研究笔记（可挂 idea/run） | 挂载对象删除时 SET NULL，**笔记保留** |

级联规则：删除 Project 连带删除其 Ideas/Runs/Notes 及全部子记录；删除 Run 连带删除指标与证据链接。

设计约定：所有时间戳为 **UTC**（存储 naive，API 输出 ISO-8601，前端按 UTC 解析）；参数以 JSON TEXT 存储、出入边界由 Pydantic 校验。

## API 一览（前缀 `/api`）

| 方法 & 路径 | 说明 |
|---|---|
| `GET/POST /projects`，`GET/PATCH/DELETE /projects/{id}` | 项目 CRUD（列表带计数） |
| `GET/POST /projects/{id}/ideas` | 假设列表；创建即生成 v1 |
| `GET/PATCH /ideas/{id}` | 假设详情/改标题与状态（**不改正文**） |
| `POST /ideas/{id}/versions` | 追加不可变新版本（自动 revision 边 + 指针前移） |
| `PUT/PATCH /idea-versions/{id}` | **405 显式拒绝**（版本不可变） |
| `GET /ideas/{id}/graph` | 版本 + 演化边 + 每版证据 |
| `POST /idea-edges` | 手动跨假设派生边 |
| `GET/POST /projects/{id}/runs` | Run 列表；POST 按 `(source,key)` **upsert**（新建 201 / 更新 200） |
| `GET/PATCH/DELETE /runs/{id}` | Run 详情（含指标统计与证据）/ 更新 / 删除 |
| `GET/POST /runs/{id}/metrics` | 指标查询（按 name 过滤）；批量 **幂等 upsert** |
| `POST /evidence-links`，`PATCH/DELETE /evidence-links/{id}` | 证据 upsert（同对重复提交 = 更新判定） |
| `GET /idea-versions/{id}/evidence` | 某版本的全部证据 |
| `GET/POST /projects/{id}/notes`，`PATCH/DELETE /notes/{id}` | 笔记 CRUD |
| `GET /health` | 健康检查 |

错误约定：404 不存在、409 唯一约束冲突、405 不可变拒绝、422 校验失败（含跨项目证据等业务规则）；未捕获异常记录 traceback 并返回 500，不静默吞错。

## 实验导入预留接口（Phase 2）

`backend/app/importers/base.py` 定义了标准化载荷 `RunImportPayload` 与入口 `import_run(db, project_id, payload)`。后续实现 CSV / TensorBoard 解析器时：解析 → 构造 payload → 调用 `import_run` 即可；同一 `(external_source, external_key)` 重复导入不会产生重复 Run，指标按 `(name, step)` 覆盖更新（已有测试锁定该行为）。

## 目录结构

```
research-os/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口/CORS/异常处理
│   │   ├── config.py          # pydantic-settings（GLM_* 用 RESEARCH_OS_ 前缀隔离）
│   │   ├── database.py        # engine/session/PRAGMA foreign_keys=ON
│   │   ├── models.py          # 核心实体 + Phase 3 分析实体
│   │   ├── schemas.py         # API 契约（Pydantic）
│   │   ├── services.py        # 领域操作（版本演进/幂等 upsert/证据校验）
│   │   ├── analysis.py        # Phase 3 管道编排/审核/事务化 Apply
│   │   ├── ai/                # GLM 客户端/prompts/提取器/匹配器/提案生成
│   │   ├── routers/           # projects/ideas/runs/evidence/notes/conversations
│   │   └── importers/         # 导入扩展点 + 会话解析
│   ├── alembic/               # 迁移（render_as_batch，SQLite 友好）
│   ├── scripts/               # seed_demo_data / mock_glm_server
│   └── tests/                 # 73 项测试（含 Mock LLM 管道）
└── frontend/
    └── src/
        ├── app/               # / 、/projects/[id]、/ideas/[id]、/runs/[id]、
        │                      # /projects/[id]/ideas/graph（演化图谱）
        ├── components/        # 业务组件（对话框/时间线/sparkline/徽章）
        ├── components/idea-graph/  # 图谱：视图/节点/边/工具栏/详情面板/布局/diff
        ├── components/ui/     # shadcn/ui
        └── lib/api.ts         # 唯一数据通道（类型化 fetch）
```

## 环境变量

| 位置 | 变量 | 默认 | 说明 |
|---|---|---|---|
| backend/.env | `DATABASE_URL` | `sqlite:///./research_os.db` | SQLite 连接串 |
| backend/.env | `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | 允许的前端来源（逗号分隔） |
| frontend/.env.local | `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | 后端地址 |

模板见 `backend/.env.example` 与 `frontend/.env.example`。

## Agent 结构化导入

复制 Prompt → 粘贴给你的 AI 助手 → 把助手的 JSON 输出粘回系统直接导入。入口：侧栏「Agent 导入」（`/projects/{id}/agent-import`），五个模块各一个专门调教的 Prompt（综合研究记录 / 研究假设 / 实验记录 / 证据关联 / 研究笔记），Prompt 单一来源在 `backend/app/ai/agent_prompts.py`（`GET /api/agent-prompts`，带版本号便于追溯）。

导入契约：跨条目引用用文档内自定义短引用（"idea-a"），引用系统内已有实体支持数字 ID 或精确标题/名称；实验按外部键幂等（重复导入更新而非重复建行）；假设同名跳过；逐条报告创建/跳过/失败，支持 dry_run 预览。既有 md/json/文本导入与对话分析管线全部保留、互不影响。

## 打包为 Windows 桌面应用

前端支持 `DESKTOP_BUILD=1 npm run build` 静态导出（动态路由生成占位页），`desktop/` 提供 Electron 外壳：自动启动 PyInstaller 打包的 FastAPI sidecar（空闲端口）、`app://` 协议 SPA-fallback 深链、运行时 API 基址注入（`window.__RESEARCH_OS_API_BASE__`），并通过 electron-updater 对接 GitHub Releases 实现**安装后自动更新**。完整构建与发布流程见 [desktop/README.md](desktop/README.md)。

桌面适配：左侧详情面板（演化图谱）与审核页对话栏均为**可拖拽分栏**（持久化宽度，双击重置，键盘 ±16px）；全站布局在 960px 窗口下限至超宽屏自适应，表格横向滚动。

## 范围外（Phase 1 明确不做）

GLM API 集成、SSH 远程执行、TensorBoard 解析、多 Agent、用户注册与权限、大型前端状态管理。
