"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  donationsQueryKey,
  fetchDonations,
  mutateDonation,
  type DonationRow,
} from "@/lib/queries/account-client";

export function DonationHistory({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = donationsQueryKey(userId);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchDonations(signal),
    staleTime: 60_000,
  });

  // Optimistic mutation — flip the donation's displayMode / hiddenAt in
  // the cache immediately, roll back on server failure. Matches the
  // prior UX where the row changed before the fetch completed.
  const mutation = useMutation({
    mutationFn: ({
      donationId,
      action,
    }: {
      donationId: string;
      action: "anonymize" | "hide";
    }) => mutateDonation(donationId, action),
    onMutate: async ({ donationId, action }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ donations: DonationRow[] }>(
        queryKey,
      );
      queryClient.setQueryData<{ donations: DonationRow[] }>(queryKey, (old) =>
        old
          ? {
              donations: old.donations.map((d) => {
                if (d.id !== donationId) return d;
                if (action === "anonymize")
                  return { ...d, displayMode: "ANONYMOUS" };
                return { ...d, hiddenAt: new Date().toISOString() };
              }),
            }
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const donations = data?.donations ?? [];
  if (isLoading) return null;
  if (donations.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Your Contributions ({donations.length})
        </h2>
        <Link href="/support" className="text-primary text-sm hover:underline">
          Support again
        </Link>
      </div>
      {donations.map((d) => (
        <Card key={d.id} className="p-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium">
                  ${(d.amountCents / 100).toFixed(2)}
                </span>
                {d.isRecurring && (
                  <Badge variant="outline" className="px-1.5 text-xs">
                    {d.recurringStatus === "ACTIVE"
                      ? "Monthly"
                      : d.recurringStatus === "GRACE"
                        ? "Retrying"
                        : d.recurringStatus === "CANCELED"
                          ? "Canceled"
                          : "Monthly"}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {d.displayMode === "ANONYMOUS"
                  ? "Anonymous"
                  : d.displayMode === "TRIBUTE"
                    ? `In honor of ${d.tributeName}`
                    : (d.displayName ?? "Anonymous")}
                {d.hiddenAt && " (hidden from public page)"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {new Date(d.createdAt).toLocaleDateString("en-US")}
              </span>
              {d.displayMode !== "ANONYMOUS" && !d.hiddenAt && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() =>
                      mutation.mutate({
                        donationId: d.id,
                        action: "anonymize",
                      })
                    }
                  >
                    Make anonymous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-6 px-2 text-xs"
                    onClick={() =>
                      mutation.mutate({ donationId: d.id, action: "hide" })
                    }
                  >
                    Hide
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// userId prop is still required by the parent for queryKey scoping.
// The component itself doesn't read it directly because DonationRow
// includes the userId's own donations via the session-scoped API.
