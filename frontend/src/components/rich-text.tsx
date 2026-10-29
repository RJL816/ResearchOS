"use client";

import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export function RichText({ text }: { text: string }) {
  return <div className="space-y-2 break-words text-sm leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_.katex-display]:overflow-x-auto"><Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{text}</Markdown></div>;
}
