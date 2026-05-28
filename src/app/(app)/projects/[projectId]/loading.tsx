import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-5 w-full max-w-lg" />
        </div>
        <Skeleton className="h-10 w-full sm:w-32" />
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-full grid-flow-col auto-cols-[minmax(18rem,1fr)] gap-4">
          {Array.from({ length: 5 }).map((_, columnIndex) => (
            <section key={columnIndex} className="flex min-h-[32rem] flex-col rounded-xl border bg-card/70">
              <div className="flex items-center justify-between border-b p-4">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-6 w-8 rounded-full" />
              </div>
              <div className="grid gap-3 p-4">
                {Array.from({ length: 3 }).map((__, cardIndex) => (
                  <div key={cardIndex} className="rounded-lg border bg-background p-3 shadow-sm">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Skeleton className="h-8 flex-1" />
                      <Skeleton className="h-8 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <Skeleton className="h-24" />
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
