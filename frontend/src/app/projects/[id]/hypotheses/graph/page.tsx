import { Suspense } from "react";
import { IdeaGraphView } from "@/components/idea-graph/IdeaGraph";
import { RouteBoundary } from "@/lib/navigation";
export function generateStaticParams() { return [{id: "app"}]; }
export default function Page() { return <Suspense fallback={<div>正在打开…</div>}><RouteBoundary><IdeaGraphView /></RouteBoundary></Suspense>; }
