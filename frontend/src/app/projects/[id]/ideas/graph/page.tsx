import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { IdeaGraphView } from "@/components/idea-graph/IdeaGraph";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export const generateStaticParams = process.env.DESKTOP_BUILD
  ? () => [{ id: "app" }]
  : undefined;


export default function IdeaGraphPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1700px] space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-[60vh] w-full rounded-xl" />
        </div>
      }
    >
      <IdeaGraphView />
    </Suspense>
  );
}
