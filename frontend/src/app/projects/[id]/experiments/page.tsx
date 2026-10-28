import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ExperimentsView from "./experiments-view";

export function generateStaticParams() {
  return [{ id: "app" }];
}

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl p-6"><Skeleton className="h-96 rounded-lg" /></div>}>
      <ExperimentsView />
    </Suspense>
  );
}
