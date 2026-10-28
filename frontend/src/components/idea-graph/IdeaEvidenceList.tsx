"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { EvidenceDetailItem } from "@/lib/api";
import { fmtDateTime, fmtNumber } from "@/lib/format";

/**
 * Evidence associated with one hypothesis version.
 * Verdicts are recorded facts — they never auto-flip the idea's status.
 */
export function IdeaEvidenceList({ evidence }: { evidence: EvidenceDetailItem[] }) {
  if (evidence.length === 0) {
    return (
      <EmptyBlock text="该版本还没有关联实验证据。在假设页或实验页点「关联证据」建立 supports / refutes / inconclusive 记录。" />
    );
  }
  return (
    <div className="space-y-3">
      {evidence.map((item) => (
        <div key={item.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="verdict" value={item.verdict} />
            <Link
              href={`/runs/${item.run_id}`}
              className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
            >
              {item.run_name}
              <ExternalLink className="size-3" />
            </Link>
            <StatusBadge kind="run" value={item.run_status} />
            <span className="text-muted-foreground ml-auto text-[11px]">
              Run #{item.run_id} · {fmtDateTime(item.created_at)}
            </span>
          </div>
          {item.run_metrics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.run_metrics.map((metric) => (
                <span
                  key={metric.name}
                  className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
                  title={`step ${metric.last_step}`}
                >
                  {metric.name}: <span className="font-semibold">{fmtNumber(metric.last_value)}</span>
                </span>
              ))}
            </div>
          )}
          {item.note && (
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{item.note}</p>
          )}
        </div>
      ))}
      <p className="text-muted-foreground text-[11px]">
        提示：证据判定只记录实验结论，假设状态（如「已验证」）始终由研究者手动更新。
      </p>
    </div>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-xs leading-relaxed">
      {text}
    </div>
  );
}
