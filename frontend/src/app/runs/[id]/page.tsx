import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import RunDetailView from "@/components/run-detail-view";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export const generateStaticParams = process.env.DESKTOP_BUILD
  ? () => [{ id: "app" }]
  : undefined;


export default function RunPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      }
    >
      <RunDetailView />
    </Suspense>
  );
}
