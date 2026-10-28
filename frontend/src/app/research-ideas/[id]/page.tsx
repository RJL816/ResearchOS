import { Suspense } from "react";
import { RouteBoundary } from "@/lib/navigation";
import ResearchIdeaView from "@/components/research-idea-view";
export function generateStaticParams() { return [{id: "app"}]; }
export default function Page() { return <Suspense fallback={<div>正在打开…</div>}><RouteBoundary><ResearchIdeaView /></RouteBoundary></Suspense>; }
