import { Suspense } from "react";
import { RouteBoundary } from "@/lib/navigation";
import AnalysisQueue from "./queue-view";
export function generateStaticParams() { return [{ id: "app" }]; }
export default function Page() {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">正在打开工作区…</div>}><RouteBoundary><AnalysisQueue /></RouteBoundary></Suspense>;
}
