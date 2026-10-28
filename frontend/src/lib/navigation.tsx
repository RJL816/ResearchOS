"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation";
import { InvalidParamScreen } from "@/components/invalid-param-screen";

const subscribe = () => () => {};
export function usePathname() {
  // Subscribe to Next navigation, but keep hydration identical for desktop
  // placeholder HTML and the numeric URL where that HTML is actually opened.
  useNextPathname();
  return useSyncExternalStore(subscribe, () => window.location.pathname.replace(/\/$/, "") || "/", () => "/");
}

export function useRouteId() {
  return Number(usePathname().split("/")[2]);
}

const isDesktop = () => typeof window !== "undefined" && window.location.protocol === "app:";

export function useRouter() {
  const router = useNextRouter();
  return useMemo(() => ({
    ...router,
    push: (href: string) => isDesktop() ? window.location.assign(href) : router.push(href),
    replace: (href: string, options?: { scroll?: boolean }) => {
      if (isDesktop()) {
        const next = new URL(href, window.location.href);
        if (next.pathname === window.location.pathname) window.history.replaceState(null, "", href);
        else window.location.replace(href);
      } else router.replace(href, options);
    },
  }), [router]);
}

export function RouteBoundary({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const id = useRouteId();
  if (!ready) return <div className="p-6 text-sm text-muted-foreground">正在打开工作区…</div>;
  if (!Number.isSafeInteger(id) || id <= 0) return <InvalidParamScreen />;
  // Remount local page state when changing entities/projects.
  return <div key={id} className="h-full">{children}</div>;
}

export function DesktopNavigation() {
  useEffect(() => {
    if (!isDesktop()) return;
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.("a");
      if (!anchor || anchor.target || anchor.hasAttribute("download") || anchor.getAttribute("aria-disabled") === "true") return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(href);
    };
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, []);
  return null;
}
