"use client";

import { ArrowRight, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GraphRelationLink, IdeaVersion, IdeaVersionDetails } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { diffWords } from "./diff";
import { EmptyBlock } from "./IdeaEvidenceList";
import { RELATION_META } from "./graph-types";

function RelationRow({
  link,
  onSelect,
}: {
  link: GraphRelationLink;
  onSelect: (versionId: number) => void;
}) {
  const meta = RELATION_META[link.relation] ?? RELATION_META.revision;
  return (
    <button
      type="button"
      onClick={() => onSelect(link.other.id)}
      className="hover:bg-accent/50 flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
      title="在图中定位并选中该版本"
    >
      <Badge variant="outline" className="font-mono text-[10px]" style={{ color: meta.color, borderColor: meta.color }}>
        {meta.label} · {meta.en}
      </Badge>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {link.other.title}{" "}
          <span className="bg-muted text-muted-foreground rounded px-1 font-mono text-[10px]">
            v{link.other.version_number}
          </span>
        </span>
        {link.reason && (
          <span className="text-muted-foreground block truncate text-[11px]">{link.reason}</span>
        )}
      </span>
      <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  );
}

function VersionDiff({ previous, current }: { previous: IdeaVersion; current: IdeaVersion }) {
  const parts = diffWords(previous.body, current.body);
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-[11px]">
        <span className="font-medium text-foreground">v{previous.version_number} → v{current.version_number} 差异</span>
        <span className="rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">新增</span>
        <span className="rounded bg-red-100 px-1 text-red-700 line-through dark:bg-red-950 dark:text-red-300">删除</span>
      </div>
      <p className="whitespace-pre-wrap">
        {parts.map((part, index) =>
          part.kind === "same" ? (
            <span key={index}>{part.text}</span>
          ) : part.kind === "add" ? (
            <span
              key={index}
              className="rounded-sm bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            >
              {part.text}
            </span>
          ) : (
            <span
              key={index}
              className="rounded-sm bg-red-100 text-red-700 line-through dark:bg-red-950 dark:text-red-300"
            >
              {part.text}
            </span>
          ),
        )}
      </p>
    </div>
  );
}

export function IdeaEvolutionHistory({
  details,
  onSelectNode,
}: {
  details: IdeaVersionDetails;
  onSelectNode: (versionId: number) => void;
}) {
  const { version, incoming, outgoing, previous_version } = details;
  const hasRelations = incoming.length > 0 || outgoing.length > 0;

  return (
    <div className="space-y-4">
      {previous_version ? (
        <VersionDiff previous={previous_version} current={version} />
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium">初始版本 v{version.version_number}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            这是该假设的第一个版本，没有可对比的上一版。
          </p>
        </div>
      )}
      {version.change_reason && (
        <div className="text-muted-foreground border-l-2 pl-3 text-xs italic">
          演化原因：{version.change_reason}
        </div>
      )}

      <section>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold">
          <ArrowDown className="size-3" /> 前置关系（incoming · {incoming.length}）
        </h4>
        {incoming.length === 0 ? (
          <EmptyBlock text="没有前置版本（根节点）。" />
        ) : (
          <div className="space-y-2">
            {incoming.map((link) => (
              <RelationRow key={link.edge_id} link={link} onSelect={onSelectNode} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold">
          <ArrowRight className="size-3" /> 后续衍生（outgoing · {outgoing.length}）
        </h4>
        {outgoing.length === 0 ? (
          <EmptyBlock text="尚未派生后续版本或假设。" />
        ) : (
          <div className="space-y-2">
            {outgoing.map((link) => (
              <RelationRow key={link.edge_id} link={link} onSelect={onSelectNode} />
            ))}
          </div>
        )}
      </section>

      {!hasRelations && previous_version === null && (
        <p className="text-muted-foreground text-[11px]">
          该版本尚未参与任何演化关系，最后更新于 {fmtDateTime(details.idea.updated_at)}。
        </p>
      )}
    </div>
  );
}
