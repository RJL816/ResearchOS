import Link from "next/link";

/** Shown when a dynamic-route parameter is not a valid id (e.g. the desktop
 * export's placeholder path was opened directly, or a malformed link). */
export function InvalidParamScreen({
  message = "页面地址无效或尚未就绪",
}: {
  message?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-muted-foreground max-w-md text-center text-sm leading-relaxed">
        <p>{message}</p>
        <Link href="/" className="text-primary mt-3 inline-block hover:underline">
          返回研究总览
        </Link>
      </div>
    </div>
  );
}
