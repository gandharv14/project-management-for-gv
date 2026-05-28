"use client";

import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

import { useActionFormPending } from "@/components/action-form";
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
  const actionFormPending = useActionFormPending();
  const { pending: formStatusPending } = useFormStatus();
  const pending = actionFormPending || formStatusPending;

  return (
    <Button
      {...props}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      type={type}
    >
      {pending && showSpinner ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
