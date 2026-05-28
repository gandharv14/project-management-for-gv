import Link from "next/link";
import type React from "react";
import { formatDistanceToNow } from "date-fns";
import { ImageIcon, MessageSquare, ThumbsUp } from "lucide-react";

import {
  commentSuggestion,
  createSuggestion,
  promoteSuggestionToTask,
  updateSuggestionStatus,
  voteSuggestion,
} from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MarkdownBody } from "@/components/markdown-body";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getAppContext,
  listProjectMembers,
  listSuggestionCategoryCounts,
  listSuggestionComments,
  listSuggestions,
} from "@/lib/data";
import { SUGGESTION_CATEGORIES, type SuggestionCategory, type SuggestionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const categoryLabels: Record<SuggestionCategory, string> = {
  proposal: "Proposal",
  project: "Project related",
  management: "Management related",
  process: "Process",
  tooling: "Tooling",
  other: "Other",
};

const statusLabels: Record<SuggestionStatus, string> = {
  open: "Open",
  under_consideration: "Under consideration",
  accepted: "Accepted",
  parked: "Parked",
};

function isSuggestionCategory(value: string | undefined): value is SuggestionCategory {
  return SUGGESTION_CATEGORIES.includes(value as SuggestionCategory);
}

export default async function SuggestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const [{ projectId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const requestedCategory = Array.isArray(resolvedSearchParams.category)
    ? resolvedSearchParams.category[0]
    : resolvedSearchParams.category;
  const activeCategory = isSuggestionCategory(requestedCategory) ? requestedCategory : "all";
  const { activeProject, profile } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const categoryFilter = activeCategory === "all" ? undefined : activeCategory;
  const [suggestions, members, categoryCounts] = await Promise.all([
    listSuggestions(projectId, profile.id, categoryFilter),
    listProjectMembers(projectId),
    listSuggestionCategoryCounts(projectId),
  ]);
  const commentsBySuggestion = await listSuggestionComments(suggestions.map((suggestion) => suggestion.id));
  const totalSuggestions = Array.from(categoryCounts.values()).reduce((total, count) => total + count, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <RealtimeRefresh tables={["suggestions", "suggestion_votes", "suggestion_comments"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Suggestions</h1>
        <p className="text-muted-foreground">
          Issue-style idea threads for {activeProject.name}. Use markdown and screenshots to keep feedback in context.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px_1fr_360px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>Filter suggestion threads.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <CategoryLink
              active={activeCategory === "all"}
              count={totalSuggestions}
              href={`/projects/${projectId}/suggestions`}
              label="All"
            />
            {SUGGESTION_CATEGORIES.map((category) => (
              <CategoryLink
                active={activeCategory === category}
                count={categoryCounts.get(category) ?? 0}
                href={`/projects/${projectId}/suggestions?category=${category}`}
                key={category}
                label={categoryLabels[category]}
              />
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {suggestions.map((suggestion) => (
            <Card key={suggestion.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{categoryLabels[suggestion.category]}</Badge>
                      <Badge variant={suggestion.status === "accepted" ? "default" : "secondary"}>
                        {statusLabels[suggestion.status]}
                      </Badge>
                    </div>
                    <CardTitle className="break-words text-xl">{suggestion.title}</CardTitle>
                    <CardDescription className="mt-1">
                      opened by {suggestion.author?.display_name ?? "Unknown"} · updated{" "}
                      {formatDistanceToNow(new Date(suggestion.updated_at), { addSuffix: true })}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>{suggestion.vote_count ?? 0} votes</span>
                    <span>{suggestion.comment_count ?? 0} comments</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-lg border bg-background/60 p-4">
                  {suggestion.description ? (
                    <MarkdownBody content={suggestion.description} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No description provided.</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={voteSuggestion} className="contents">
                    <input name="projectId" type="hidden" value={projectId} />
                    <input name="suggestionId" type="hidden" value={suggestion.id} />
                    <FormSubmitButton
                      pendingLabel="Upvoting..."
                      size="sm"
                      variant={suggestion.has_voted ? "secondary" : "outline"}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      Upvote
                    </FormSubmitButton>
                  </form>
                  <form action={updateSuggestionStatus} className="flex flex-wrap gap-2">
                    <input name="projectId" type="hidden" value={projectId} />
                    <input name="suggestionId" type="hidden" value={suggestion.id} />
                    <Select name="status" defaultValue={suggestion.status}>
                      <option value="open">Open</option>
                      <option value="under_consideration">Under consideration</option>
                      <option value="accepted">Accepted</option>
                      <option value="parked">Parked</option>
                    </Select>
                    <FormSubmitButton pendingLabel="Saving..." size="sm" variant="secondary">
                      Set
                    </FormSubmitButton>
                  </form>
                  {suggestion.promoted_task_id ? <Badge variant="secondary">Promoted to task</Badge> : null}
                </div>

                {suggestion.status === "accepted" && !suggestion.promoted_task_id ? (
                  <form action={promoteSuggestionToTask} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]">
                    <input name="projectId" type="hidden" value={projectId} />
                    <input name="suggestionId" type="hidden" value={suggestion.id} />
                    <Select name="assigneeId" defaultValue="">
                      <option value="">Unassigned task</option>
                      {members.map((member) => (
                        <option key={member.profile_id} value={member.profile_id}>
                          {member.profiles?.display_name ?? member.profile_id}
                        </option>
                      ))}
                    </Select>
                    <FormSubmitButton pendingLabel="Promoting...">Promote to task</FormSubmitButton>
                  </form>
                ) : null}

                <div className="grid gap-3 border-l pl-4">
                  {(commentsBySuggestion.get(suggestion.id) ?? []).map((comment) => (
                    <div key={comment.id} className="rounded-lg border bg-muted/30 p-3">
                      <div className="mb-2 text-xs text-muted-foreground">
                        {comment.author?.display_name ?? "Unknown"} commented{" "}
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </div>
                      <MarkdownBody content={comment.body} />
                    </div>
                  ))}
                </div>

                <form action={commentSuggestion} className="grid gap-3 rounded-lg border border-dashed p-3">
                  <input name="projectId" type="hidden" value={projectId} />
                  <input name="suggestionId" type="hidden" value={suggestion.id} />
                  <Textarea
                    name="body"
                    placeholder="Add feedback with markdown. Mention decisions, follow-ups, or more context."
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <Field label="Attach screenshots">
                      <Input
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        multiple
                        name="screenshots"
                        type="file"
                      />
                    </Field>
                    <FormSubmitButton pendingLabel="Commenting..." variant="secondary">
                      <MessageSquare className="h-4 w-4" />
                      Add to thread
                    </FormSubmitButton>
                  </div>
                </form>
              </CardContent>
            </Card>
          ))}
          {suggestions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No suggestions in this category yet.</CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Post suggestion</CardTitle>
            <CardDescription>Start a categorized thread with markdown and screenshots.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createSuggestion} className="grid gap-3">
              <input name="projectId" type="hidden" value={projectId} />
              <Field label="Title">
                <Input name="title" required />
              </Field>
              <Field label="Category">
                <Select name="category" defaultValue={categoryFilter ?? "project"}>
                  {SUGGESTION_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabels[category]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  placeholder="Describe the proposal, expected impact, and any relevant links using markdown."
                />
              </Field>
              <Field label="Screenshots">
                <Input accept="image/png,image/jpeg,image/webp,image/gif" multiple name="screenshots" type="file" />
              </Field>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                Up to 4 images, 5MB each. Uploaded screenshots are embedded into the markdown body.
              </p>
              <FormSubmitButton pendingLabel="Posting...">Post idea</FormSubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CategoryLink({
  active,
  count,
  href,
  label,
}: {
  active: boolean;
  count: number;
  href: string;
  label: string;
}) {
  return (
    <Button
      asChild
      className={cn("justify-between", active && "border-primary bg-accent text-foreground")}
      size="sm"
      variant={active ? "outline" : "ghost"}
    >
      <Link href={href}>
        <span>{label}</span>
        <Badge variant="secondary">{count}</Badge>
      </Link>
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
