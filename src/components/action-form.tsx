"use client";

import { createContext, useContext, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";

type ActionFormProps = Omit<ComponentProps<"form">, "action"> & {
  action: (formData: FormData) => Promise<unknown>;
};

const ActionFormPendingContext = createContext(false);

export function useActionFormPending() {
  return useContext(ActionFormPendingContext);
}

// Next.js signals redirect()/notFound() by throwing an error carrying a digest.
// Those must propagate so the framework can perform the navigation, rather than
// being shown to the user as a failure.
function isNextControlFlowError(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

export function ActionForm({ action, children, ...props }: ActionFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction(formData: FormData) {
    setPending(true);
    setError(null);

    try {
      await action(formData);
      router.refresh();
    } catch (caught) {
      if (isNextControlFlowError(caught)) {
        throw caught;
      }

      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <ActionFormPendingContext.Provider value={pending}>
      <form action={runAction} {...props}>
        {error ? (
          <p
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
            style={{ gridColumn: "1 / -1" }}
          >
            {error}
          </p>
        ) : null}
        {children}
      </form>
    </ActionFormPendingContext.Provider>
  );
}
