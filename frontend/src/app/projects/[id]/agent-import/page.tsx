import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import AgentImportView from "./agent-import-view";

export function generateStaticParams() {
  return [{ id: "app" }];
}

export default function AgentImportPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl p-6"><Skeleton className="h-96 rounded-lg" /></div>}>
      <AgentImportView />
    </Suspense>
  );
}
