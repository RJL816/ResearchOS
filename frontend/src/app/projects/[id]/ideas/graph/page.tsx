import { Suspense } from "react";
import { ResearchEvolutionGraph } from "@/components/research-evolution-graph";
import { RouteBoundary } from "@/lib/navigation";
export function generateStaticParams() { return [{id: "app"}]; }
export default function Page() { return <Suspense fallback={<div>正在打开…</div>}><RouteBoundary><ResearchEvolutionGraph /></RouteBoundary></Suspense>; }
