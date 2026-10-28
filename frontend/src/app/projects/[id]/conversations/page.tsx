import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ConversationsView from "./conversations-view";

export function generateStaticParams() {
  // Static export placeholder; the desktop shell serves deep links via SPA fallback.
  return [{ id: "app" }];
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-6"><Skeleton className="h-96 rounded-xl" /></div>}>
      <ConversationsView />
    </Suspense>
  );
}
