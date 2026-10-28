import { Suspense } from "react";
import { RouteBoundary } from "@/lib/navigation";
import ResearchIdeaList from "@/components/research-idea-list";
export function generateStaticParams() { return [{id: "app"}]; }
export default function Page() { return <Suspense fallback={<div>正在打开…</div>}><RouteBoundary><ResearchIdeaList /></RouteBoundary></Suspense>; }
