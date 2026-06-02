import { formatDistanceToNow } from "date-fns";
import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import type React from "react";

import { createProjectDocument } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAppContext, getProjectDocumentsState } from "@/lib/data";
import { PROJECT_DOCUMENT_TYPES, type ProjectDocument, type ProjectDocumentType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DeleteProjectDocumentButton } from "./delete-project-document-button";

const documentTypeLabels: Record<ProjectDocumentType, string> = {
  doc: "Doc",
  sheet: "Sheet",
  slide: "Slides",
  folder: "Folder",
  other: "Other",
};

function isProjectDocumentType(value: string | undefined): value is ProjectDocumentType {
  return PROJECT_DOCUMENT_TYPES.includes(value as ProjectDocumentType);
}

function normalizeTagParam(value: string | undefined) {
  return value && /^[a-z0-9-]+$/.test(value) ? value : undefined;
}

function documentsHref(
  projectId: string,
  filters?: { documentType?: ProjectDocumentType | "all"; tag?: string | null },
) {
  const params = new URLSearchParams();

  if (filters?.documentType && filters.documentType !== "all") {
    params.set("type", filters.documentType);
  }

  if (filters?.tag) {
    params.set("tag", filters.tag);
  }

  const query = params.toString();
  return `/projects/${projectId}/documents${query ? `?${query}` : ""}`;
}

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tag?: string | string[]; type?: string | string[] }>;
}) {
  const [{ projectId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const requestedType = Array.isArray(resolvedSearchParams.type)
    ? resolvedSearchParams.type[0]
    : resolvedSearchParams.type;
  const requestedTag = Array.isArray(resolvedSearchParams.tag) ? resolvedSearchParams.tag[0] : resolvedSearchParams.tag;
  const activeType = isProjectDocumentType(requestedType) ? requestedType : "all";
  const activeTag = normalizeTagParam(requestedTag);
  const { activeProject } = await getAppContext(projectId);

  if (!activeProject) {
    return null;
  }

  const { documents, setupRequired, tagCounts, totalCount, typeCounts } = await getProjectDocumentsState(projectId, {
    documentType: activeType === "all" ? undefined : activeType,
    tag: activeTag,
  });
  const tags = [...tagCounts.entries()].sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <RealtimeRefresh tables={["project_documents"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
        <p className="text-muted-foreground">
          Keep Google Docs, Sheets, Slides, and Drive folders for {activeProject.name} in one tagged registry.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px_1fr_360px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Browse by type or tag.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <FilterLink
                active={activeType === "all"}
                count={totalCount}
                href={documentsHref(projectId, { tag: activeTag, documentType: "all" })}
                label="All types"
              />
              {PROJECT_DOCUMENT_TYPES.map((documentType) => (
                <FilterLink
                  active={activeType === documentType}
                  count={typeCounts.get(documentType) ?? 0}
                  href={documentsHref(projectId, { tag: activeTag, documentType })}
                  key={documentType}
                  label={documentTypeLabels[documentType]}
                />
              ))}
            </div>

            <div className="grid gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
              <FilterLink
                active={!activeTag}
                count={totalCount}
                href={documentsHref(projectId, { documentType: activeType })}
                label="All tags"
              />
              {tags.map(([tag, count]) => (
                <FilterLink
                  active={activeTag === tag}
                  count={count}
                  href={documentsHref(projectId, { documentType: activeType, tag })}
                  key={tag}
                  label={tag}
                />
              ))}
              {tags.length === 0 ? <p className="text-sm text-muted-foreground">No tags yet.</p> : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {setupRequired ? (
            <Card>
              <CardHeader>
                <CardTitle>Documents setup required</CardTitle>
                <CardDescription>Apply the latest Supabase migration before saving project document links.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                The `project_documents` table is not available in the connected database yet.
              </CardContent>
            </Card>
          ) : null}
          {documents.map((document) => (
            <DocumentCard document={document} key={document.id} projectId={projectId} />
          ))}
          {documents.length === 0 && !setupRequired ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No document links match the selected filters.
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add document link</CardTitle>
            <CardDescription>Paste an existing Google Workspace link and tag it for discovery.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createProjectDocument} className="grid gap-3">
              <input name="projectId" type="hidden" value={projectId} />
              <Field label="Title">
                <Input name="title" placeholder="Client tracker" required />
              </Field>
              <Field label="Google link">
                <Input name="url" placeholder="https://docs.google.com/..." required type="url" />
              </Field>
              <Field label="Type">
                <Select name="documentType" defaultValue="doc">
                  {PROJECT_DOCUMENT_TYPES.map((documentType) => (
                    <option key={documentType} value={documentType}>
                      {documentTypeLabels[documentType]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tags">
                <Input name="tags" placeholder="scope, budget, client" />
              </Field>
              <p className="text-xs text-muted-foreground">
                Tags are normalized to lowercase slugs, deduped, and can be comma or newline separated.
              </p>
              <Field label="Notes">
                <Textarea name="description" placeholder="What this doc is for, owner, or when to use it." />
              </Field>
              <FormSubmitButton disabled={setupRequired} pendingLabel="Saving...">
                Save document link
              </FormSubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DocumentCard({ document, projectId }: { document: ProjectDocument; projectId: string }) {
  const creator = document.creator?.display_name ?? document.creator?.email ?? "Unknown member";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{documentTypeLabels[document.document_type]}</Badge>
              {document.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
            <CardTitle className="break-words text-xl">{document.title}</CardTitle>
            <CardDescription className="mt-1">
              added by {creator} - updated {formatDistanceToNow(new Date(document.updated_at), { addSuffix: true })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild size="sm" variant="outline">
              <Link href={document.url} rel="noreferrer" target="_blank">
                <ExternalLink className="h-4 w-4" />
                Open
              </Link>
            </Button>
            <DeleteProjectDocumentButton
              documentId={document.id}
              documentTitle={document.title}
              projectId={projectId}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {document.description ? (
          <div className="rounded-lg border bg-background/60 p-4">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{document.description}</p>
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="break-all">{document.url}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterLink({
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
        <span className="truncate">{label}</span>
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
