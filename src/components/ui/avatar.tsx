import * as React from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

function Avatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted", className)}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  alt = "",
  src,
}: {
  className?: string;
  alt?: string;
  src: string;
}) {
  return (
    <Image
      alt={alt}
      className={cn("aspect-square h-full w-full object-cover", className)}
      height={72}
      src={src}
      width={72}
    />
  );
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted text-xs", className)}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
