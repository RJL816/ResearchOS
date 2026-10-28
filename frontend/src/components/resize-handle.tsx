"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * Draggable vertical divider for split-pane layouts (desktop app requirement).
 * - Pointer-capture dragging; calls onResize with the pointer's clientX.
 * - Double-click resets via onReset.
 * - Keyboard: focus + ArrowLeft/Right nudges by `step` px.
 * The parent clamps and persists the resulting size.
 */
export function ResizeHandle({
  onResize,
  onNudge,
  onReset,
  ariaLabel = "拖拽调整分栏宽度",
  className,
}: {
  onResize: (clientX: number) => void;
  onNudge: (deltaPx: number) => void;
  onReset: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      lastX.current = e.clientX;
      setDragging(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      onResize(e.clientX);
      lastX.current = e.clientX;
    },
    [dragging, onResize],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
    }
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onNudge(-16);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onNudge(16);
        }
      }}
      className={cn(
        "group relative w-px shrink-0 cursor-col-resize bg-transparent outline-none transition-standard",
        "after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-['']",
        "focus-visible:bg-primary/60 hover:bg-primary/40",
        dragging && "bg-primary/70",
        className,
      )}
      title="拖拽调整宽度 · 双击重置"
    />
  );
}

/** Persisted panel width with clamping. */
export function usePanelWidth(storageKey: string, fallback: number) {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("research-panel-width", notify);
    return () => window.removeEventListener("research-panel-width", notify);
  }, []);
  const read = useCallback(() => {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }, [storageKey, fallback]);
  const width = useSyncExternalStore(subscribe, read, () => fallback);
  const update = useCallback((value: number) => {
    localStorage.setItem(storageKey, String(Math.round(value)));
    window.dispatchEvent(new Event("research-panel-width"));
  }, [storageKey]);
  return [width, update] as const;
}

export function clampPanelWidth(value: number, containerWidth: number, min = 300, maxRatio = 0.6) {
  const max = Math.max(min + 40, Math.round(containerWidth * maxRatio));
  return Math.min(max, Math.max(min, Math.round(value)));
}
