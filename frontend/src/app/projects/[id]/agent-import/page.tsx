import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import AgentImportView from "./agent-import-view";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export const generateStaticParams = process.env.DESKTOP_BUILD
  ? () => [{ id: "app" }]
  : undefined;

export default function AgentImportPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl p-6"><Skeleton className="h-96 rounded-lg" /></div>}>
      <AgentImportView />
    </Suspense>
  );
}
