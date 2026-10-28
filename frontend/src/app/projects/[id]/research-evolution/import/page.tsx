import { Suspense } from "react";
import { RouteBoundary } from "@/lib/navigation";
import { ResearchEvolutionImport } from "@/components/research-evolution-import";
export function generateStaticParams() { return [{id:"app"}]; }
export default function Page() { return <Suspense fallback={<div>正在打开…</div>}><RouteBoundary><ResearchEvolutionImport /></RouteBoundary></Suspense>; }
