import type React from "react";
import { MessageSquare, ThumbsUp } from "lucide-react";

import {
  commentSuggestion,
  createSuggestion,
  promoteSuggestionToTask,
  updateSuggestionStatus,
  voteSuggestion,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, listProjectMembers, listSuggestionComments, listSuggestions } from "@/lib/data";

export default async function SuggestionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { activeProject, profile } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const [suggestions, members] = await Promise.all([
    listSuggestions(projectId, profile.id),
    listProjectMembers(projectId),
  ]);
  const commentsBySuggestion = await listSuggestionComments(suggestions.map((suggestion) => suggestion.id));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <RealtimeRefresh tables={["suggestions", "suggestion_votes", "suggestion_comments"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Suggestions</h1>
        <p className="text-muted-foreground">
          Ideas for {activeProject.name}. Accepted ideas can become tasks in one click.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-4">
          {suggestions.map((suggestion) => (
            <Card key={suggestion.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{suggestion.title}</CardTitle>
                    <CardDescription>
                      by {suggestion.author?.display_name ?? "Unknown"} · {suggestion.vote_count ?? 0} votes ·{" "}
                      {suggestion.comment_count ?? 0} comments
                    </CardDescription>
                  </div>
                  <Badge variant={suggestion.status === "accepted" ? "default" : "secondary"}>
                    {suggestion.status.replace("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {suggestion.description ? <p className="text-sm text-muted-foreground">{suggestion.description}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={voteSuggestion}>
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
                  </ActionForm>
                  <ActionForm action={updateSuggestionStatus} className="flex gap-2">
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
                  </ActionForm>
                </div>

                {suggestion.status === "accepted" && !suggestion.promoted_task_id ? (
                  <ActionForm
                    action={promoteSuggestionToTask}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]"
                  >
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
                  </ActionForm>
                ) : null}

                <div className="grid gap-2">
                  {(commentsBySuggestion.get(suggestion.id) ?? []).map((comment) => (
                    <div key={comment.id} className="rounded-lg bg-muted/40 p-3 text-sm">
                      <p>{comment.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {comment.author?.display_name ?? "Unknown"}
                      </p>
                    </div>
                  ))}
                </div>
                <ActionForm action={commentSuggestion} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input name="projectId" type="hidden" value={projectId} />
                  <input name="suggestionId" type="hidden" value={suggestion.id} />
                  <Input name="body" placeholder="Add a comment" />
                  <FormSubmitButton pendingLabel="Commenting..." variant="secondary">
                    <MessageSquare className="h-4 w-4" />
                    Comment
                  </FormSubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          ))}
          {suggestions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No suggestions yet.</CardContent>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Post suggestion</CardTitle>
            <CardDescription>Ideas stay attached to this project.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createSuggestion} className="grid gap-3">
              <input name="projectId" type="hidden" value={projectId} />
              <Field label="Title">
                <Input name="title" required />
              </Field>
              <Field label="Description">
                <Textarea name="description" />
              </Field>
              <FormSubmitButton pendingLabel="Posting...">Post idea</FormSubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
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
