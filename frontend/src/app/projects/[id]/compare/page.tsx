import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import CompareView from "./compare-view";

export function generateStaticParams() {
  return [{ id: "app" }];
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl p-6"><Skeleton className="h-96 rounded-lg" /></div>}>
      <CompareView />
    </Suspense>
  );
}
