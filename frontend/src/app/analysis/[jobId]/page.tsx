import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ReviewView from "./review-view";
import { InvalidParamScreen } from "@/components/invalid-param-screen";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export function generateStaticParams() {
  return [{ jobId: "app" }];
}

export default async function AnalysisReviewPage({ params }: { params: Promise<Record<string, string>> }) {
  const { jobId } = await params;
  const numericId = Number(jobId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return <InvalidParamScreen />;
  }
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1600px] p-6"><Skeleton className="h-[70vh] rounded-xl" /></div>}>
      <ReviewView />
    </Suspense>
  );
}
