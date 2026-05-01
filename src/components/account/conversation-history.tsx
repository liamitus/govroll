"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { billHref } from "@/lib/bills/url";

type ConversationRow = {
  id: string;
  bill: { id: number; billId: string; title: string } | null;
  lastMessage: {
    sender: "user" | "ai";
    text: string;
    createdAt: string;
  } | null;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
};

type ConversationsPage = {
  conversations: ConversationRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function conversationsQueryKey(userId: string) {
  return ["account-conversations", userId] as const;
}

async function fetchConversationsPage(
  page: number,
  signal?: AbortSignal,
): Promise<ConversationsPage> {
  const res = await fetch(`/api/account/conversations?page=${page}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error("Failed to load conversations");
  return res.json();
}

const PREVIEW_MAX_CHARS = 140;

function previewFor(message: ConversationRow["lastMessage"]): string {
  if (!message) return "No messages yet.";
  const trimmed = message.text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= PREVIEW_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

export function ConversationHistory({ userId }: { userId: string }) {
  const { data, isLoading, hasNextPage, fetchNextPage } =
    useInfiniteQuery<ConversationsPage>({
      queryKey: conversationsQueryKey(userId),
      queryFn: ({ pageParam, signal }) =>
        fetchConversationsPage(pageParam as number, signal),
      initialPageParam: 1,
      getNextPageParam: (last) => {
        const seen = last.page * last.pageSize;
        return seen < last.total ? last.page + 1 : undefined;
      },
      staleTime: 60_000,
    });

  const conversations = data?.pages.flatMap((p) => p.conversations) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  // Match DonationHistory's pattern — quietly skip the section when empty so
  // /account doesn't grow a heading users have nothing to interact with.
  if (isLoading) return null;
  if (conversations.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Your conversations ({total})</h2>
      {conversations.map((c) => (
        <Card key={c.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {c.bill && (
                <Link
                  href={billHref({
                    billId: c.bill.billId,
                    title: c.bill.title,
                  })}
                  className="text-primary block truncate text-sm font-medium hover:underline"
                >
                  {c.bill.title}
                </Link>
              )}
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                <span className="font-medium">
                  {c.lastMessage?.sender === "ai" ? "AI: " : "You: "}
                </span>
                {previewFor(c.lastMessage)}
              </p>
              <p className="text-muted-foreground/70 mt-1 text-xs">
                {`${c.questionCount} question${c.questionCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
              {new Date(c.updatedAt).toLocaleDateString("en-US")}
            </span>
          </div>
        </Card>
      ))}

      {hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchNextPage()}
          className="w-full"
        >
          Load more
        </Button>
      )}
    </div>
  );
}
