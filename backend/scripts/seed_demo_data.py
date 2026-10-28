"""Seed the SQLite database with realistic demo data.

Run from the backend/ directory:

    .venv/Scripts/python scripts/seed_demo_data.py           # create if missing
    .venv/Scripts/python scripts/seed_demo_data.py --reset   # wipe demo projects first

The script goes through the same service functions the API uses, so demo data
respects every invariant (immutable versions, unique keys, project-local
evidence). Runs are imported via the reserved importer entry point.
"""

import argparse
import math
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.importers.base import RunImportPayload, import_run  # noqa: E402
from app.models import Project  # noqa: E402
from app.schemas import (  # noqa: E402
    EvidenceLinkCreate,
    IdeaCreate,
    IdeaEdgeCreate,
    IdeaVersionCreate,
    MetricPointCreate,
    ResearchNoteCreate,
)
from app.services import (  # noqa: E402
    add_idea_version,
    create_idea_edge,
    create_idea_with_version,
    create_note,
    upsert_evidence_link,
)
from app.utils import utcnow  # noqa: E402

DEMO_PROJECTS = ("LoRA Adapter Scaling", "Long-Context Retrieval")


def training_metrics(loss0: float, acc: float, steps: int = 30) -> list[MetricPointCreate]:
    """Deterministic, plausible-looking curves."""
    now = utcnow()
    points: list[MetricPointCreate] = []
    for step in range(steps):
        stamp = now - timedelta(minutes=(steps - step) * 5)
        loss = loss0 * math.exp(-step / 12) + 0.04 * abs(math.sin(step / 3)) + 0.05
        points.append(MetricPointCreate(name="train/loss", step=step, value=round(loss, 4), timestamp=stamp))
        if step % 5 == 4:
            acc_value = 1 - (1 - acc) * math.exp(-step / 10)
            points.append(MetricPointCreate(name="eval/accuracy", step=step, value=round(acc_value, 4), timestamp=stamp))
    return points


def seed_lora_project(db) -> Project:
    project = Project(name=DEMO_PROJECTS[0], description="参数高效微调中 adapter 秩与放置位置的系统性消融。")
    db.add(project)
    db.commit()

    idea = create_idea_with_version(
        db,
        project.id,
        IdeaCreate(
            title="Rank–performance 边际递减",
            body="在 8 个分类任务上，LoRA rank 从 4 提升到 32 只带来 <1pt 的平均收益；"
            "猜测 rank>=8 之后容量不再是瓶颈，瓶颈在训练数据分布。",
            change_reason="初始假设，来自文献阅读",
        ),
    )
    placement = create_idea_with_version(
        db,
        project.id,
        IdeaCreate(
            title="Adapter 放置位置影响大于秩",
            body="把 LoRA adapter 放在 FFN 输出后 (post-FFN) 比放在 attention 投影后 (post-attn) "
            "平均高 1.5pt。",
        ),
    )

    run_r8, _, _ = import_run(
        db,
        project.id,
        RunImportPayload(
            name="lora-rank-sweep-r8",
            external_source="manual",
            external_key="tmux://gpu-1/rank-sweep-r8",
            status="succeeded",
            git_commit="a1b2c3d",
            dataset="natural-instructions",
            eval_protocol="8-task avg accuracy, 5-shot",
            params={"model": "llama-3-8b", "lora_rank": 8, "lora_alpha": 16, "lr": 1e-4, "epochs": 3},
            metrics=training_metrics(loss0=2.2, acc=0.62),
        ),
    )
    run_r32, _, _ = import_run(
        db,
        project.id,
        RunImportPayload(
            name="lora-rank-sweep-r32",
            external_source="manual",
            external_key="tmux://gpu-1/rank-sweep-r32",
            status="succeeded",
            git_commit="a1b2c3d",
            dataset="natural-instructions",
            eval_protocol="8-task avg accuracy, 5-shot",
            params={"model": "llama-3-8b", "lora_rank": 32, "lora_alpha": 64, "lr": 1e-4, "epochs": 3},
            metrics=training_metrics(loss0=2.1, acc=0.63),
        ),
    )
    post_ffn, _, _ = import_run(
        db,
        project.id,
        RunImportPayload(
            name="lora-placement-postffn",
            external_source="manual",
            external_key="tmux://gpu-2/placement-postffn",
            status="succeeded",
            git_commit="e4f5a6b",
            dataset="natural-instructions",
            eval_protocol="8-task avg accuracy, 5-shot",
            params={"model": "llama-3-8b", "lora_rank": 8, "placement": "post_ffn"},
            metrics=training_metrics(loss0=2.2, acc=0.615),
        ),
    )

    upsert_evidence_link(
        db,
        EvidenceLinkCreate(
            idea_version_id=idea.current_version_id, run_id=run_r8.id, verdict="supports",
            note="rank=8 已达 0.68 avg acc",
        ),
    )
    upsert_evidence_link(
        db,
        EvidenceLinkCreate(
            idea_version_id=idea.current_version_id, run_id=run_r32.id, verdict="supports",
            note="rank=32 仅 +0.4pt，边际收益符合预期",
        ),
    )
    upsert_evidence_link(
        db,
        EvidenceLinkCreate(
            idea_version_id=placement.current_version_id, run_id=post_ffn.id, verdict="refutes",
            note="post-FFN 反而 -0.5pt，假设不成立",
        ),
    )

    v2 = add_idea_version(
        db,
        idea.id,
        IdeaVersionCreate(
            body="边际递减只在简单任务成立；困难推理任务 (DROP, GSM8K) 上 rank 32 仍有 3pt+ 提升，"
            "应按任务难度自适应选秩。",
            change_reason="结合 r8/r32 分任务结果重写",
        ),
    )
    upsert_evidence_link(
        db,
        EvidenceLinkCreate(
            idea_version_id=v2.id, run_id=run_r32.id, verdict="supports",
            note="困难任务子集差距 3.4pt",
        ),
    )

    create_note(
        db,
        project.id,
        ResearchNoteCreate(
            title="第一轮 rank sweep 结论",
            content="rank 边际收益整体低于预期，但分任务看差异很大。下一步按任务难度分层做 placement 消融。",
            run_id=run_r32.id,
        ),
    )
    create_note(
        db,
        project.id,
        ResearchNoteCreate(title="待办", content="下周一跑 post-FFN + r32 组合验证交互效应。"),
    )

    # Phase 2 demo: branch / challenge / supersede relations for the evolution graph.
    hard_idea = create_idea_with_version(
        db,
        project.id,
        IdeaCreate(
            title="按任务难度自适应选择秩",
            body="简单任务固定 rank=8，困难推理任务 rank>=32；用一个轻量难度分类器自动路由，"
            "避免全局大秩带来的显存浪费。",
        ),
    )
    create_idea_edge(
        db,
        IdeaEdgeCreate(
            src_version_id=idea.current_version_id,
            dst_version_id=hard_idea.current_version_id,
            relation="derivation",
            note="由 v2 的任务难度观察派生",
        ),
    )
    create_idea_edge(
        db,
        IdeaEdgeCreate(
            src_version_id=placement.current_version_id,
            dst_version_id=idea.current_version_id,
            relation="challenges",
            note="放置位置的混杂效应可能才是分任务差异的真正来源",
        ),
    )
    create_idea_edge(
        db,
        IdeaEdgeCreate(
            src_version_id=hard_idea.current_version_id,
            dst_version_id=placement.current_version_id,
            relation="supersedes",
            note="若难度自适应成立，位置消融的结论需要重新解释",
        ),
    )
    create_note(
        db,
        project.id,
        ResearchNoteCreate(
            title="难度分类器选型笔记",
            content=(
                "## 候选方案\n\n- **logistic regression** on task embedding：训练快，可解释\n"
                "- 轻量 `MLP`：上限更高但需要防过拟合\n\n> 结论：先跑 LR 基线，`AUC > 0.85` 再考虑 MLP。"
            ),
            idea_id=hard_idea.id,
        ),
    )
    return project


def seed_retrieval_project(db) -> Project:
    project = Project(name=DEMO_PROJECTS[1], description="长上下文场景下检索召回率的行为分析与修复。")
    db.add(project)
    db.commit()

    idea = create_idea_with_version(
        db,
        project.id,
        IdeaCreate(
            title="召回率随上下文长度线性衰减",
            body="在 needle-in-a-haystack 任务上，上下文从 8k 增加到 128k 时召回率近似线性下降，"
            "斜率与中间层 attention entropy 相关。",
        ),
    )
    add_idea_version(
        db,
        idea.id,
        IdeaVersionCreate(
            body="衰减只在关键信息位于中段时线性；头尾位置符合 U 型 (primacy/recency)，"
            "应改用位置条件建模。",
            change_reason="按 position 分桶重新分析失败用例",
        ),
    )
    v3 = add_idea_version(
        db,
        idea.id,
        IdeaVersionCreate(
            body="U 型现象来自 attention sink；给中段 token 增加 logit 偏置可以在不重训的情况下"
            "把中段召回率拉回 90%。",
            change_reason="阅读 attention sink 文献后的新机制假设",
        ),
    )

    failed_run, _, _ = import_run(
        db,
        project.id,
        RunImportPayload(
            name="attn-sink-repro-01",
            external_source="manual",
            external_key="tmux://gpu-3/attn-sink-repro-01",
            status="failed",
            git_commit="0c9d8e7",
            dataset="niah-multilingual",
            eval_protocol="depth 25/50/75%, 8k-128k",
            params={"model": "qwen2.5-7b", "logit_bias": 0.5},
            notes="CUDA OOM at 128k，中段召回无改善，样本量不足",
            metrics=training_metrics(loss0=2.5, acc=0.55, steps=20),
        ),
    )
    window_run, _, _ = import_run(
        db,
        project.id,
        RunImportPayload(
            name="sliding-window-64k",
            external_source="manual",
            external_key="tmux://gpu-3/sliding-window-64k",
            status="succeeded",
            git_commit="3f7e2d1",
            dataset="niah-multilingual",
            eval_protocol="depth 25/50/75%, 8k-64k",
            params={"model": "qwen2.5-7b", "window": 4096, "stride": 2048},
            metrics=training_metrics(loss0=2.3, acc=0.71, steps=25),
        ),
    )

    upsert_evidence_link(
        db,
        EvidenceLinkCreate(
            idea_version_id=v3.id, run_id=failed_run.id, verdict="inconclusive",
            note="128k OOM，64k 以下信号弱",
        ),
    )
    upsert_evidence_link(
        db,
        EvidenceLinkCreate(
            idea_version_id=v3.id, run_id=window_run.id, verdict="refutes",
            note="滑窗修复召回与 logit 假设矛盾，更可能是全局注意力稀释",
        ),
    )

    create_note(
        db,
        project.id,
        ResearchNoteCreate(
            title="组会记录 10-24",
            content="导师建议：先固定 depth 分桶协议，再比较机制假设，避免协议漂移。",
            idea_id=idea.id,
        ),
    )

    # Phase 2 demo: a merge node combining two earlier versions (multi-parent).
    unified_idea = create_idea_with_version(
        db,
        project.id,
        IdeaCreate(
            title="位置条件统一建模框架",
            body="把 primacy/recency 的 U 型现象与中段稀释统一为一个位置条件生成模型，"
            "同时解释 v2 的分桶结果与 v3 的滑窗反例。",
        ),
    )
    v2_version_id = idea.versions[1].id
    v3_version_id = idea.versions[2].id
    for src in (v2_version_id, v3_version_id):
        create_idea_edge(
            db,
            IdeaEdgeCreate(
                src_version_id=src,
                dst_version_id=unified_idea.current_version_id,
                relation="merge",
                note="合并两条解释路径",
            ),
        )
    return project


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete demo projects before seeding")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        existing = db.scalars(select(Project).where(Project.name.in_(DEMO_PROJECTS))).all()
        if args.reset and existing:
            for project in existing:
                db.delete(project)
            db.commit()
            print(f"reset: deleted {len(existing)} demo project(s)")
            existing = []
        if existing:
            names = ", ".join(p.name for p in existing)
            print(f"demo data already present ({names}); use --reset to reseed")
            return
        seed_lora_project(db)
        seed_retrieval_project(db)
        print("seeded demo data into", db.get_bind().url)
    finally:
        db.close()


if __name__ == "__main__":
    main()
