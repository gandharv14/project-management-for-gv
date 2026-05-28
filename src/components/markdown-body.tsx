/* eslint-disable @next/next/no-img-element */
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

const markdownComponents: Components = {
  a({ className, ...props }) {
    return (
      <a
        className={cn("font-medium text-primary underline-offset-4 hover:underline", className)}
        rel="noreferrer"
        target="_blank"
        {...props}
      />
    );
  },
  img({ alt, className, src, ...props }) {
    if (typeof src !== "string") {
      return null;
    }

    return (
      <img
        alt={alt ?? ""}
        className={cn("max-h-[480px] rounded-lg border bg-muted object-contain", className)}
        loading="lazy"
        src={src}
        {...props}
      />
    );
  },
};

export function MarkdownBody({ className, content }: { className?: string; content: string }) {
  return (
    <div
      className={cn(
        "space-y-3 break-words text-sm leading-6 text-foreground",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
        "[&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold",
        "[&_hr]:border-border [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg",
        "[&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2",
        "[&_ul]:list-disc",
        className,
      )}
    >
      <ReactMarkdown components={markdownComponents} rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
