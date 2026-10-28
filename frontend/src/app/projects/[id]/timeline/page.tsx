import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import TimelineView from "./timeline-view";
import { InvalidParamScreen } from "@/components/invalid-param-screen";


// generateStaticParams is only needed for the desktop static export
// (DESKTOP_BUILD=1); in web/PPR mode exporting it pins placeholder routes.
export function generateStaticParams() {
  return [{ id: "app" }];
}

export default async function TimelinePage({ params }: { params: Promise<Record<string, string>> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return <InvalidParamScreen />;
  }
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl p-6"><Skeleton className="h-96 rounded-lg" /></div>}>
      <TimelineView />
    </Suspense>
  );
}
