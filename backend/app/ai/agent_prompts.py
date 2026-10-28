"""Prompts for agent-assisted structured import.

Users copy one of these prompts into their own AI assistant (GLM / Claude /
any chat agent), paste research content, and import the agent's JSON output
back into Research OS via POST /api/projects/{id}/agent-import.

The prompts are the single source of truth for the envelope schema — keep
them in sync with app.schemas.AgentImportEnvelope. PROMPTS_VERSION is stored
with each import for traceability.
"""

PROMPTS_VERSION = "2026-10-28.1"

_ROLE = """你是 Research OS 的科研数据录入助手。把研究者提供的研究内容整理为严格的 JSON，供 Research OS 系统直接导入。"""

_RULES = """【铁律】
1. 只输出一个 JSON 对象：不写解释、不加前后缀、不用 markdown 代码围栏。
2. 只使用【字段说明】中定义的键；没有对应内容的数组输出空 []。
3. 禁止编造：metrics 里的数字只能来自研究者明确给出的实验数据；缺失的信息省略整个字段，不要猜。
4. 讨论、推测、AI 建议都不是实验结论。evidence 的 verdict 只能是 supports / refutes / inconclusive，且只在研究者明确给出实验对比结论时填写；拿不准就用 notes 记录。
5. idea 的 status 只能是 exploring / testing / validated / refuted / parked；受质疑 ≠ refuted。
6. 引用规则：同一段 JSON 内的条目用自定义短引用互相指向（如 "idea-a"、"run-1"），引用必须在本文档中定义过；不引用数据库 ID。
7. 保留研究者的原始表述；指标名保持原始形式（如 train/loss、eval/accuracy）；数字一律用阿拉伯数字。"""

_ENVELOPE = """【字段说明】
{
  "version": 1,
  "ideas": [
    { "ref": "唯一短引用，如 idea-a", "title": "≤50字标题", "body": "完整假设正文",
      "status": "exploring", "change_reason": "提出/修改原因（可选）" }
  ],
  "idea_versions": [
    { "idea": "指向 ideas[].ref", "body": "修订后的完整正文（不是 diff）", "change_reason": "修订原因" }
  ],
  "runs": [
    { "ref": "唯一短引用，如 run-1", "name": "实验名",
      "status": "running | succeeded | failed | stopped | planned",
      "git_commit": "commit 哈希（可选）", "dataset": "数据集（可选）",
      "eval_protocol": "评估协议（可选）", "params": { "参数名": 值 },
      "notes": "补充说明（可选）",
      "metrics": [ { "name": "train/loss", "step": 0, "value": 2.31 } ] }
  ],
  "evidence": [
    { "idea": "指向 ideas[].ref", "run": "指向 runs[].ref",
      "verdict": "supports | refutes | inconclusive", "note": "关键数字或解释（可选）" }
  ],
  "notes": [
    { "title": "笔记标题", "content": "笔记正文",
      "idea": "可选，指向 ideas[].ref", "run": "可选，指向 runs[].ref" }
  ]
}"""

_EXAMPLE = """【输出示例（仅示意结构）】
{"version":1,"ideas":[{"ref":"idea-a","title":"难度自适应秩","body":"简单任务固定 rank=8，困难任务使用 rank>=32","status":"exploring"}],"idea_versions":[],"runs":[{"ref":"run-1","name":"r8-baseline","status":"succeeded","git_commit":"a1b2c3d","dataset":"ni","eval_protocol":"5-shot acc","params":{"rank":8,"lr":0.0001},"metrics":[{"name":"eval/accuracy","step":10,"value":0.72}]}],"evidence":[{"idea":"idea-a","run":"run-1","verdict":"supports","note":"acc 0.72"}],"notes":[{"title":"下一步","content":"补 rank=32 对照组","idea":"idea-a"}]}"""

_NO_CONTENT = """【没有可录入内容时】
输出 {"version":1,"ideas":[],"idea_versions":[],"runs":[],"evidence":[],"notes":[]}"""


def _compose(usage: str, fields: str, example: str | None) -> str:
    parts = [_ROLE, usage, _RULES]
    if fields:
        parts.append(fields)
    if example:
        parts.append(example)
    parts.append(_NO_CONTENT)
    return "\n\n".join(parts)


PROMPTS: dict[str, dict[str, str]] = {
    "session": {
        "name": "综合研究记录",
        "description": "一段对话/一次研究讨论的全部产出：假设、实验、证据、笔记一次性录入。",
        "prompt": _compose(
            "【本次任务】研究者会粘贴一段研究讨论或阶段性总结，请提取其中所有可录入的研究产出。",
            _ENVELOPE,
            _EXAMPLE,
        ),
    },
    "idea": {
        "name": "研究假设",
        "description": "新建假设或对已有假设追加不可变版本。",
        "prompt": _compose(
            "【本次任务】研究者会描述一个研究假设（或对已有假设的修订）。"
            "已有假设追加版本时：ideas 留空，在 idea_versions 中把 idea 写成该假设在系统中的数字 ID，"
            "并把 body 写成修订后的完整正文。新建假设时在 ideas 里给出 ref，系统会自动生成 v1。",
            "【字段说明（本模块相关部分）】\n"
            "ideas[]: { ref, title（≤50字）, body（完整假设正文）, status（默认 exploring）, change_reason? }\n"
            "idea_versions[]: { idea（已有假设的数字 ID）, body（修订后完整正文）, change_reason }",
            '{"version":1,"ideas":[{"ref":"idea-a","title":"难度自适应秩","body":"简单任务 rank=8，困难任务 rank>=32，用轻量分类器路由","status":"exploring","change_reason":"来自文献阅读"}],"idea_versions":[{"idea":3,"body":"细化后正文","change_reason":"回应显存质疑"}],"runs":[],"evidence":[],"notes":[]}',
        ),
    },
    "run": {
        "name": "实验记录",
        "description": "登记实验 Run 与其指标（幂等：重复导入同名实验不会重复建行）。",
        "prompt": _compose(
            "【本次任务】研究者会描述一次实验执行。把配置整理为 params，把实验产出的指标序列整理为 metrics"
            "（保留原始指标名、step、value；只有研究者明确给出的真实数字才能写入 metrics）。",
            "【字段说明（本模块相关部分）】\n"
            "runs[]: { ref, name, status, git_commit?, dataset?, eval_protocol?, params?, notes?, metrics?: [{name, step, value}] }",
            '{"version":1,"ideas":[],"idea_versions":[],"runs":[{"ref":"run-1","name":"lora-rank-sweep-r32","status":"succeeded","git_commit":"e4f5a6b","dataset":"natural-instructions","eval_protocol":"8-task avg accuracy","params":{"model":"llama-3-8b","lora_rank":32,"lr":0.0001},"metrics":[{"name":"train/loss","step":0,"value":2.1},{"name":"train/loss","step":29,"value":0.25},{"name":"eval/accuracy","step":29,"value":0.9796}]}],"evidence":[],"notes":[]}',
        ),
    },
    "evidence": {
        "name": "证据关联",
        "description": "把已有实验与已有假设版本关联，并给出 supports / refutes / inconclusive 判定。",
        "prompt": _compose(
            "【本次任务】研究者会说明某次实验对某个假设的支撑情况。evidence 里 idea/run 的写法二选一："
            "写数字 ID（系统内已有实体的 ID，如 3），或写 \"名称\"（必须与系统中已有的假设标题/实验名完全一致）。"
            "两者都匹配不到时不要输出该条 evidence。",
            "【字段说明（本模块相关部分）】\n"
            "evidence[]: { idea（数字 ID 或假设标题）, run（数字 ID 或实验名）, verdict, note? }",
            '{"version":1,"ideas":[],"idea_versions":[],"runs":[],"evidence":[{"idea":3,"run":"lora-rank-sweep-r32","verdict":"supports","note":"rank=32 在困难任务 +3.4pt"}],"notes":[]}',
        ),
    },
    "note": {
        "name": "研究笔记",
        "description": "会议记录、阶段结论、下一步计划等（可关联已有假设或实验）。",
        "prompt": _compose(
            "【本次任务】研究者会提供笔记内容（组会记录、阶段总结、计划等）。idea/run 字段写法同证据模块："
            "数字 ID 或完全一致的名称，匹配不到就省略。",
            "【字段说明（本模块相关部分）】\n"
            "notes[]: { title, content, idea?（数字 ID 或标题）, run?（数字 ID 或实验名） }",
            '{"version":1,"ideas":[],"idea_versions":[],"runs":[],"evidence":[],"notes":[{"title":"组会记录 10-28","content":"导师建议固定 depth 分桶协议后再比较机制假设。","idea":3}]}',
        ),
    },
}
