import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { IdeaGraphView } from "@/components/idea-graph/IdeaGraph";

export function generateStaticParams() {
  return [{ id: "app" }];
}


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
