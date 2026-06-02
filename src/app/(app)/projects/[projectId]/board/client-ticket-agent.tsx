"use client";

import * as React from "react";
import { Check, Copy, Info, Sparkles } from "lucide-react";

import { draftClientTicketMessage, type ClientTicketDraft } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Task } from "@/lib/types";

export function ClientTicketAgent({ task }: { task: Task }) {
  const [isPending, startTransition] = React.useTransition();
  const [draft, setDraft] = React.useState<ClientTicketDraft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  function handleDraft() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const result = await draftClientTicketMessage(task.id);
        setDraft(result);
      } catch (caught) {
        setDraft(null);
        setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      }
    });
  }

  async function handleCopy() {
    if (!draft?.message) {
      return;
    }

    try {
      await navigator.clipboard.writeText(draft.message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border bg-card/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Client message agent
        </h4>
        <Button onClick={handleDraft} disabled={isPending} size="sm" type="button" variant="secondary">
          {isPending ? "Analyzing..." : draft ? "Re-run agent" : "Draft client message"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {draft && !draft.isClientFacing ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Not a client-facing ticket. {draft.reason}</span>
        </p>
      ) : null}

      {draft?.isClientFacing && draft.message ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{draft.reason}</p>
          <Textarea className="min-h-40 font-mono text-sm" readOnly value={draft.message} />
          <div className="flex justify-end">
            <Button onClick={handleCopy} size="sm" type="button" variant="outline">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy message"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
