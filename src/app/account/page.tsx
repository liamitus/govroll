"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  PasswordStrengthIndicator,
  validatePassword,
} from "@/components/auth/password-strength";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DonationHistory } from "@/components/account/donation-history";
import { ConversationHistory } from "@/components/account/conversation-history";
import { resolveUsername } from "@/lib/citizen-id";
import Link from "next/link";
import {
  fetchUserCommentsPage,
  userCommentsQueryKey,
  type UserCommentsPage,
} from "@/lib/queries/account-client";
import { billHref } from "@/lib/bills/url";

export default function AccountPage() {
  const { user, authState } = useAuth();
  const router = useRouter();

  // Settings state
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">(
    "success",
  );

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const showMessage = (text: string, type: "success" | "error" = "success") => {
    setMessage(text);
    setMessageType(type);
    if (type === "success") {
      setTimeout(() => setMessage(""), 4000);
    }
  };

  const {
    data: commentsData,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<UserCommentsPage>({
    queryKey: userCommentsQueryKey(user?.id ?? ""),
    queryFn: ({ pageParam, signal }) =>
      fetchUserCommentsPage(user!.id, pageParam as number, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const seen = last.page * last.pageSize;
      return seen < last.total ? last.page + 1 : undefined;
    },
    enabled: !!user,
  });
  const comments = useMemo(
    () => commentsData?.pages.flatMap((p) => p.comments) ?? [],
    [commentsData],
  );
  const totalComments = commentsData?.pages[0]?.total ?? 0;

  const queryClient = useQueryClient();
  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete comment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userCommentsQueryKey(user?.id ?? ""),
      });
      // The same comment may also be cached under any bill view.
      queryClient.invalidateQueries({ queryKey: ["bill-comments-page"] });
    },
  });

  const handleDeleteComment = async (commentId: number) => {
    if (deleteCommentMutation.isPending) return;
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    try {
      await deleteCommentMutation.mutateAsync(commentId);
    } catch {
      showMessage("Failed to delete comment", "error");
    }
  };

  useEffect(() => {
    if (authState === "signed-out") {
      router.push("/");
    }
  }, [authState, router]);

  if (authState !== "signed-in" || !user) return null;

  const username = resolveUsername(user);

  const handleUpdateUsername = async () => {
    const name = newUsername.trim();
    if (!name) return;
    // Authoritative, moderated write FIRST. The PATCH route runs the deny-list
    // + AI moderation and, only on success, updates Profile.username (the public
    // source of truth) and restamps existing comments. We must not write the
    // name to Supabase auth metadata before this passes — metadata is
    // client-writable and unmoderated, so it can never be the source of truth.
    const res = await fetch("/api/account/username", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showMessage(data.error || "That username cannot be used.", "error");
      return;
    }
    // Moderation passed. Mirror the name into auth metadata so the user's own
    // client-side display (account header, nav) reflects it. Best-effort:
    // Profile.username above is already the authoritative public record.
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.updateUser({ data: { username: name } });
    }
    showMessage("Username updated");
    setNewUsername("");
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim()) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      showMessage("Browser storage is disabled", "error");
      return;
    }
    const { error } = await supabase.auth.updateUser({
      email: newEmail.trim(),
    });
    if (error) {
      showMessage(error.message, "error");
    } else {
      showMessage(
        "Confirmation email sent to your new address. Check both inboxes.",
      );
      setNewEmail("");
    }
  };

  const handleUpdatePassword = async () => {
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      showMessage("Password does not meet requirements", "error");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      showMessage("Browser storage is disabled", "error");
      return;
    }
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) {
      showMessage(error.message, "error");
    } else {
      showMessage("Password updated");
      setNewPassword("");
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setDeleting(true);

    const res = await fetch("/api/account/delete", {
      method: "DELETE",
    });

    if (res.ok) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) await supabase.auth.signOut();
      router.push("/");
    } else {
      const data = await res.json();
      showMessage(data.error || "Failed to delete account", "error");
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-3xl font-bold">Account</h1>

      <Card className="space-y-4 p-4">
        <h2 className="text-xl font-semibold">Profile</h2>
        <p className="text-ink-muted text-base">
          Username: <span className="text-ink">{username}</span>
        </p>
        <p className="text-ink-muted text-base">
          Email: <span className="text-ink">{user.email}</span>
        </p>
        <p className="text-ink-muted text-base">
          Member since:{" "}
          <span className="text-ink">
            {new Date(user.created_at).toLocaleDateString("en-US")}
          </span>
        </p>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-xl font-semibold">Display Name</h2>
        <p className="text-ink-muted text-sm">
          This is how you appear in comments and discussions. You were assigned{" "}
          <span className="text-ink font-medium">{username}</span> — change it
          to your name or a pseudonym you prefer.
        </p>
        <div className="flex gap-2">
          <Input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="New display name"
          />
          <Button size="sm" onClick={handleUpdateUsername}>
            Update
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-xl font-semibold">Update Email</h2>
        <p className="text-ink-muted text-sm">
          A confirmation link will be sent to both your current and new email.
        </p>
        <div className="flex gap-2">
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email"
          />
          <Button size="sm" onClick={handleUpdateEmail}>
            Update
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-xl font-semibold">Change Password</h2>
        <div className="space-y-2">
          <Label>New Password</Label>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <PasswordStrengthIndicator password={newPassword} />
          <Button size="sm" onClick={handleUpdatePassword}>
            Change Password
          </Button>
        </div>
      </Card>

      {message && (
        <p
          className={`text-sm ${
            messageType === "error"
              ? "border-ink bg-paper text-ink-muted border-[1.5px] border-dashed px-3 py-2"
              : "text-ink"
          }`}
        >
          {message}
        </p>
      )}

      <Separator />

      <DonationHistory userId={user.id} />

      <Separator />

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">
          Your Comments ({totalComments})
        </h2>
        {comments.map((comment) => (
          <Card key={comment.id} className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-base">{comment.content}</p>
                {comment.bill && (
                  <Link
                    href={billHref({
                      billId: comment.bill.billId,
                      title: comment.bill.title,
                    })}
                    className="text-sapphire-deep mt-1 block text-sm hover:underline"
                  >
                    {comment.bill.title}
                  </Link>
                )}
              </div>
              <div className="ml-2 flex flex-col items-end gap-1">
                <span className="text-ink-muted text-sm whitespace-nowrap tabular-nums">
                  {new Date(comment.date).toLocaleDateString("en-US")}
                </span>
                <button
                  onClick={() => handleDeleteComment(comment.id)}
                  disabled={deleteCommentMutation.isPending}
                  className="text-ink-muted hover:text-destructive text-sm disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
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

      <Separator />

      <ConversationHistory userId={user.id} />

      <Separator />

      <Card className="border-ink space-y-4 border-[1.5px] border-dashed p-4">
        <h2 className="text-xl font-semibold">Danger Zone</h2>
        <p className="text-ink-muted text-base">
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </p>
        {!showDeleteConfirm ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete Account
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-ink-muted text-sm">
              Type <span className="text-ink font-bold">DELETE</span> to
              confirm:
            </p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="max-w-xs"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || deleting}
              >
                {deleting ? "Deleting..." : "Permanently Delete"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
