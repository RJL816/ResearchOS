import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ReviewView from "./review-view";

export function generateStaticParams() {
  return [{ jobId: "app" }];
}

export default function AnalysisReviewPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1600px] p-6"><Skeleton className="h-[70vh] rounded-xl" /></div>}>
      <ReviewView />
    </Suspense>
  );
}
