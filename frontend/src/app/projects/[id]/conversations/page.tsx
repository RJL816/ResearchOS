import { Suspense } from "react";
import ConversationsView from "./conversations-view";
import { RouteBoundary } from "@/lib/navigation";

export function generateStaticParams() {
  // Static export placeholder; the desktop shell serves deep links via SPA fallback.
  return [{ id: "app" }];
}

export default function Page() {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">正在打开工作区…</div>}><RouteBoundary><ConversationsView /></RouteBoundary></Suspense>;
}
