import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ProjectDetailView from "@/components/project-detail-view";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export const generateStaticParams = process.env.DESKTOP_BUILD
  ? () => [{ id: "app" }]
  : undefined;


export default function ProjectPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      }
    >
      <ProjectDetailView />
    </Suspense>
  );
}
