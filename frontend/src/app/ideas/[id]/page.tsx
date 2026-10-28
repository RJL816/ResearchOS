import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import IdeaDetailView from "@/components/idea-detail-view";

export function generateStaticParams() {
  return [{ id: "app" }];
}


export default function IdeaPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      }
    >
      <IdeaDetailView />
    </Suspense>
  );
}
