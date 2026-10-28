import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { IdeaGraphView } from "@/components/idea-graph/IdeaGraph";
import { InvalidParamScreen } from "@/components/invalid-param-screen";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export function generateStaticParams() {
  return [{ id: "app" }];
}


export default async function IdeaGraphPage({ params }: { params: Promise<Record<string, string>> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return <InvalidParamScreen />;
  }
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
  );}
