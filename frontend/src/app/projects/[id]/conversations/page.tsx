import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ConversationsView from "./conversations-view";
import { InvalidParamScreen } from "@/components/invalid-param-screen";

export function generateStaticParams() {
  // Static export placeholder; the desktop shell serves deep links via SPA fallback.
  return [{ id: "app" }];
}

export default async function ConversationsPage({ params }: { params: Promise<Record<string, string>> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return <InvalidParamScreen />;
  }
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-6"><Skeleton className="h-96 rounded-xl" /></div>}>
      <ConversationsView />
    </Suspense>
  );
}
