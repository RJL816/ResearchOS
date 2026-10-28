import { Suspense } from "react";
import IdeaDetailView from "@/components/idea-detail-view";
import { RouteBoundary } from "@/lib/navigation";


// Desktop exports use a placeholder; the client reads the actual numeric URL.
export function generateStaticParams() {
  return [{ id: "app" }];
}


export default function Page() {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">正在打开工作区…</div>}><RouteBoundary><IdeaDetailView /></RouteBoundary></Suspense>;
}
