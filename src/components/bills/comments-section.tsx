"use client";

import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import type { CommentData } from "@/types";

function Comment({
  comment,
  onReply,
  onDelete,
  onVote,
  userId,
}: {
  comment: CommentData;
  onReply: (parentId: number, content: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
  onVote: (commentId: number, voteType: number) => Promise<void>;
  userId: string | null;
}) {
  const [showReply, setShowReply] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [voting, setVoting] = useState(false);

  const isOwner = userId !== null && comment.userId === userId;

  const handleVote = async (voteType: number) => {
    if (!userId || voting) return;
    setVoting(true);
    try {
      await onVote(comment.id, voteType);
    } catch {
      // Vote failures are low-stakes; the count simply won't update.
    } finally {
      setVoting(false);
    }
  };

  const handleReply = async () => {
    if (!replyContent.trim()) return;
    setSubmitting(true);
    await onReply(comment.id, replyContent);
    setReplyContent("");
    setShowReply(false);
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (deleting) return;
    const replyCount = comment.replies?.length ?? 0;
    const message =
      replyCount > 0
        ? `Delete this comment? Its ${replyCount} ${replyCount === 1 ? "reply" : "replies"} will remain as separate comments.`
        : "Delete this comment? This cannot be undone.";
    if (!window.confirm(message)) return;
    setDeleting(true);
    try {
      await onDelete(comment.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border-border border-l-2 py-2 pl-3">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span className="text-foreground font-medium">{comment.username}</span>
        <span>{new Date(comment.date).toLocaleDateString("en-US")}</span>
      </div>

      <p className="mt-1 text-base">{comment.content}</p>

      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() => handleVote(1)}
          className="text-muted-foreground hover:text-foreground text-sm disabled:opacity-50"
          disabled={!userId || voting}
        >
          +
        </button>
        <span className="text-sm font-medium">{comment.voteCount}</span>
        <button
          onClick={() => handleVote(-1)}
          className="text-muted-foreground hover:text-foreground text-sm disabled:opacity-50"
          disabled={!userId || voting}
        >
          -
        </button>
        {userId && (
          <button
            onClick={() => setShowReply(!showReply)}
            className="text-muted-foreground hover:text-foreground ml-2 text-sm"
          >
            Reply
          </button>
        )}
        {isOwner && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-muted-foreground hover:text-destructive ml-2 text-sm disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>

      {showReply && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder="Write a reply..."
            className="min-h-[60px] text-base"
          />
          <Button size="sm" onClick={handleReply} disabled={submitting}>
            {submitting ? "..." : "Reply"}
          </Button>
        </div>
      )}

      {comment.replies?.map((reply) => (
        <Comment
          key={reply.id}
          comment={reply}
          onReply={onReply}
          onDelete={onDelete}
          onVote={onVote}
          userId={userId}
        />
      ))}
    </div>
  );
}

interface BillCommentsPage {
  comments: CommentData[];
  total: number;
  topLevelTotal: number;
}

export function CommentsSection({
  billId,
  onSignUp,
}: {
  billId: number;
  onSignUp?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const [sort, setSort] = useState<"new" | "best">("new");

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<BillCommentsPage>({
      queryKey: ["bill-comments-page", billId, sort],
      queryFn: async ({ pageParam, signal }) => {
        const res = await fetch(
          `/api/comments/bill/${billId}?page=${pageParam}&sort=${sort}`,
          { signal },
        );
        if (!res.ok) throw new Error("Failed to load comments");
        return res.json() as Promise<BillCommentsPage>;
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage, allPages) => {
        // Only top-level comments are paged (replies are nested inside them),
        // so compare top-level loaded against the top-level total.
        const loaded = allPages.reduce((n, p) => n + p.comments.length, 0);
        return loaded < lastPage.topLevelTotal
          ? allPages.length + 1
          : undefined;
      },
      staleTime: 15_000,
    });
  const comments = useMemo(
    () => data?.pages.flatMap((p) => p.comments) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;

  const mutation = useMutation({
    mutationFn: async ({
      content,
      parentCommentId,
    }: {
      content: string;
      parentCommentId?: number;
    }) => {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId,
          content,
          parentCommentId: parentCommentId || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
    },
    onSuccess: () => {
      // Invalidate every (sort) combo for this bill so the new comment shows
      // up regardless of which tab is visible.
      queryClient.invalidateQueries({
        queryKey: ["bill-comments-page", billId],
      });
    },
  });
  const submitting = mutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: async (commentId: number) => {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete comment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["bill-comments-page", billId],
      });
    },
  });

  const voteMutation = useMutation({
    mutationFn: async ({
      commentId,
      voteType,
    }: {
      commentId: number;
      voteType: number;
    }) => {
      const res = await fetch("/api/comment-votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, voteType }),
      });
      if (!res.ok) throw new Error("Failed to record vote");
    },
    onSuccess: () => {
      // Re-fetch so the server-computed voteCount reflects the new vote.
      queryClient.invalidateQueries({
        queryKey: ["bill-comments-page", billId],
      });
    },
  });

  const submitComment = async (parentCommentId?: number, content?: string) => {
    const text = content || newComment;
    if (!text.trim() || !user) return;
    await mutation.mutateAsync({ content: text, parentCommentId });
    if (!parentCommentId) setNewComment("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">
          Comments{total > 0 ? ` (${total})` : ""}
        </h3>
        <div className="flex gap-1">
          {(["new", "best"] as const).map((s) => (
            <Button
              key={s}
              variant={sort === s ? "default" : "ghost"}
              size="sm"
              onClick={() => setSort(s)}
              className="h-7 text-xs"
            >
              {s === "new" ? "New" : "Best"}
            </Button>
          ))}
        </div>
      </div>

      {user && (
        <div className="space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Share your thoughts..."
            className="min-h-[80px]"
          />
          <Button
            size="sm"
            onClick={() => submitComment()}
            disabled={submitting || !newComment.trim()}
          >
            {submitting ? "Posting..." : "Post Comment"}
          </Button>
        </div>
      )}

      {comments.length === 0 ? (
        <div className="space-y-1 py-8 text-center">
          <p className="text-muted-foreground text-base">
            {user ? (
              "Start the conversation — share your perspective above."
            ) : (
              <>
                No comments yet.{" "}
                <button
                  type="button"
                  onClick={onSignUp}
                  className="hover:text-primary font-medium underline underline-offset-2 transition-colors"
                >
                  Sign up
                </button>{" "}
                to be the first to weigh in.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              onReply={async (parentId, content) =>
                submitComment(parentId, content)
              }
              onDelete={async (commentId) =>
                deleteMutation.mutateAsync(commentId)
              }
              onVote={async (commentId, voteType) =>
                voteMutation.mutateAsync({ commentId, voteType })
              }
              userId={user?.id || null}
            />
          ))}
        </div>
      )}

      {hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full"
        >
          {isFetchingNextPage ? "Loading..." : "Load more comments"}
        </Button>
      )}
    </div>
  );
}
