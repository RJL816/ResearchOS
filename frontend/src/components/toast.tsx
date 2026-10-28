"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "info" | "warning";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  toast: (message: string, kind?: ToastKind) => void;
}>({ toast: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId++;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "bg-popover text-popover-foreground pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3 text-sm shadow-md",
              "animate-in fade-in slide-in-from-bottom-2 duration-200",
            )}
          >
            {item.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : item.kind === "warning" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-info" />
            )}
            <p className="min-w-0 flex-1 leading-snug">{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="text-muted-foreground hover:text-foreground transition-standard shrink-0"
              aria-label="关闭提示"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
