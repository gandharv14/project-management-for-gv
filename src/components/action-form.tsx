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

export function ActionForm({ action, children, ...props }: ActionFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function runAction(formData: FormData) {
    setPending(true);

    const reloadTimer = window.setTimeout(() => window.location.reload(), 3000);

    void action(formData)
      .then(() => {
        router.refresh();
        window.location.reload();
      })
      .finally(() => {
        window.clearTimeout(reloadTimer);
        setPending(false);
      });
  }

  return (
    <ActionFormPendingContext.Provider value={pending}>
      <form action={runAction} {...props}>
        {children}
      </form>
    </ActionFormPendingContext.Provider>
  );
}
