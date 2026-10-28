import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ReviewView from "./review-view";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export const generateStaticParams = process.env.DESKTOP_BUILD
  ? () => [{ jobId: "app" }]
  : undefined;

export default function AnalysisReviewPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1600px] p-6"><Skeleton className="h-[70vh] rounded-xl" /></div>}>
      <ReviewView />
    </Suspense>
  );
}
