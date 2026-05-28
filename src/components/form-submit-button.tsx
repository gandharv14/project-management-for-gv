"use client";

import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type FormSubmitButtonProps = ComponentProps<typeof Button> & {
  pendingLabel?: ReactNode;
  showSpinner?: boolean;
};

export function FormSubmitButton({
  children,
  disabled,
  pendingLabel,
  showSpinner = true,
  type = "submit",
  ...props
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      type={type}
      {...props}
    >
      {pending && showSpinner ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
