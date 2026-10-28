"""Local mock GLM server for end-to-end testing (OpenAI-compatible protocol).

Serves POST {base}/chat/completions and replies with a scripted research-event
extraction. Used by scripts/e2e_phase3.py with
RESEARCH_OS_GLM_BASE_URL=http://127.0.0.1:9812/api/paas/v4 so the whole
pipeline (HTTP client -> parsing -> matching -> proposals) runs for real
without touching the actual GLM API or consuming any quota.

Run:  .venv/Scripts/python scripts/mock_glm_server.py [port] [reply_json_file]
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

DEFAULT_REPLY = {
    "events": [
        {
            "event_type": "idea_created",
            "title": "难度自适应秩选择",
            "description": "简单任务固定 rank=8，困难推理任务使用 rank>=32，由轻量分类器路由。",
            "source_sequences": [1],
            "related_idea_ids": [],
            "reasoning": "研究者在消息 1 中明确提出了新假设",
            "evidence_type": "user_decision",
            "uncertainty": "low",
            "details": {
                "new_title": "难度自适应秩选择",
                "new_body": "简单任务固定 rank=8，困难推理任务使用 rank>=32；用轻量难度分类器自动路由，避免显存浪费。",
            },
        },
        {
            "event_type": "idea_challenged",
            "title": "显存容量质疑",
            "description": "分类器训练本身可能吃掉节省的显存，收益存疑。",
            "source_sequences": [3],
            "related_idea_ids": [-1],
            "reasoning": "消息 3 对该假设提出了可行性质疑，但没有放弃",
            "evidence_type": "discussion",
            "uncertainty": "medium",
            "details": {},
        },
        {
            "event_type": "idea_refined",
            "title": "引入梯度检查点",
            "description": "结合梯度检查点降低峰值显存，细化后的假设正文。",
            "source_sequences": [5],
            "related_idea_ids": [-1],
            "reasoning": "研究者在消息 5 给出了修订后的假设",
            "evidence_type": "user_decision",
            "uncertainty": "low",
            "details": {
                "new_body": "简单任务固定 rank=8，困难任务 rank>=32 并配合梯度检查点；分类器仅用任务元数据（长度/领域），训练开销可忽略。",
                "reason": "回应显存质疑后的修订",
            },
        },
        {
            "event_type": "idea_branched",
            "title": "部署侧量化分支",
            "description": "部署阶段用 4bit 量化替代部分训练侧优化，作为独立方向验证。",
            "source_sequences": [7],
            "related_idea_ids": [-1],
            "reasoning": "消息 7 提出从主假设派生的独立方向",
            "evidence_type": "ai_suggestion",
            "uncertainty": "medium",
            "details": {
                "new_title": "部署侧量化分支",
                "new_body": "部署阶段对 rank>=32 的适配器做 4bit 量化，验证是否可以替代训练侧的梯度检查点。",
            },
        },
        {
            "event_type": "research_decision",
            "title": "先跑 LR 基线",
            "description": "决定：难度分类器先用逻辑回归基线，AUC>0.85 再考虑更复杂模型。",
            "source_sequences": [8],
            "related_idea_ids": [-1],
            "reasoning": "消息 8 是研究者做出的明确决策",
            "evidence_type": "user_decision",
            "uncertainty": "low",
            "details": {},
        },
    ]
}


class Handler(BaseHTTPRequestHandler):
    scripted = None  # list of replies popped per request; falls back to DEFAULT_REPLY

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        if self.scripted:
            reply = self.scripted.pop(0)
        else:
            reply = DEFAULT_REPLY
        body = json.dumps(
            {
                "id": "mock-chatcmpl",
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": json.dumps(reply, ensure_ascii=False)}}
                ],
                "usage": {"total_tokens": 0},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quiet
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9812
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as handle:
            Handler.scripted = json.load(handle)
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"mock GLM listening on http://127.0.0.1:{port} (scripted={bool(Handler.scripted)})", flush=True)
    server.serve_forever()
