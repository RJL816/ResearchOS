"use client";

import { Crosshair, LayoutGrid, Map, Maximize2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { LayoutDirection } from "./graph-types";

export interface GraphToolbarProps {
  direction: LayoutDirection;
  onDirectionChange: (direction: LayoutDirection) => void;
  statusOptions: { value: string; label: string }[];
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  matchCount: number;
  onLocateNext: () => void;
  minimap: boolean;
  onMinimapChange: (visible: boolean) => void;
  onFit: () => void;
  onResetLayout: () => void;
  visibleCount: number;
  totalCount: number;
}

export function GraphToolbar(props: GraphToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={props.direction}
        onValueChange={(v) => props.onDirectionChange(v as LayoutDirection)}
      >
        <SelectTrigger size="sm" className="w-[130px]" aria-label="布局方向">
          <LayoutGrid className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TB">从上到下 (TB)</SelectItem>
          <SelectItem value="LR">从左到右 (LR)</SelectItem>
        </SelectContent>
      </Select>

      <Select value={props.statusFilter} onValueChange={props.onStatusFilterChange}>
        <SelectTrigger size="sm" className="w-[120px]" aria-label="状态筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          {props.statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="搜索标题 / 摘要"
          className="h-8 w-52 pl-8 text-sm"
          aria-label="搜索节点"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2"
        onClick={props.onLocateNext}
        disabled={props.matchCount === 0}
        title="定位到下一个匹配节点"
      >
        <Crosshair className="size-3.5" />
        {props.search.trim()
          ? `${props.matchCount} 命中`
          : "定位"}
      </Button>

      <Separator orientation="vertical" className="mx-1 !h-5" />

      <Button variant="outline" size="sm" className="h-8" onClick={props.onFit}>
        <Maximize2 className="size-3.5" />
        适配视图
      </Button>
      <Button variant="outline" size="sm" className="h-8" onClick={props.onResetLayout}>
        <RotateCcw className="size-3.5" />
        重新布局
      </Button>
      <Button
        variant={props.minimap ? "default" : "outline"}
        size="sm"
        className="h-8"
        onClick={() => props.onMinimapChange(!props.minimap)}
        aria-pressed={props.minimap}
      >
        <Map className="size-3.5" />
        小地图
      </Button>

      <span className="text-muted-foreground ml-auto text-xs" aria-live="polite">
        {props.visibleCount}/{props.totalCount} 节点
        {props.statusFilter !== "all" && "（已按状态筛选）"}
      </span>
    </div>
  );
}
