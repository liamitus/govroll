"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
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
  const { user, loading: authLoading } = useAuth();
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

  const supabase = createSupabaseBrowserClient();

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

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) return null;

  const username = resolveUsername(user);

  const handleUpdateUsername = async () => {
    if (!newUsername.trim()) return;
    const { error } = await supabase.auth.updateUser({
      data: { username: newUsername.trim() },
    });
    if (error) {
      showMessage(error.message, "error");
    } else {
      // Sync display name to existing comments
      await fetch("/api/account/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim() }),
      });
      showMessage("Username updated");
      setNewUsername("");
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim()) return;
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
      await supabase.auth.signOut();
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
        <p className="text-muted-foreground text-base">
          Username: <span className="text-foreground">{username}</span>
        </p>
        <p className="text-muted-foreground text-base">
          Email: <span className="text-foreground">{user.email}</span>
        </p>
        <p className="text-muted-foreground text-base">
          Member since:{" "}
          <span className="text-foreground">
            {new Date(user.created_at).toLocaleDateString("en-US")}
          </span>
        </p>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="text-xl font-semibold">Display Name</h2>
        <p className="text-muted-foreground text-sm">
          This is how you appear in comments and discussions. You were assigned{" "}
          <span className="text-foreground font-medium">{username}</span> —
          change it to your name or a pseudonym you prefer.
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
        <p className="text-muted-foreground text-sm">
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
            messageType === "error" ? "text-red-500" : "text-green-600"
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
                    className="text-primary mt-1 block text-sm hover:underline"
                  >
                    {comment.bill.title}
                  </Link>
                )}
              </div>
              <span className="text-muted-foreground ml-2 text-sm whitespace-nowrap">
                {new Date(comment.date).toLocaleDateString("en-US")}
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

      <Separator />

      <ConversationHistory userId={user.id} />

      <Separator />

      <Card className="space-y-4 border-red-200 p-4">
        <h2 className="text-xl font-semibold text-red-600">Danger Zone</h2>
        <p className="text-muted-foreground text-base">
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
            <p className="text-sm text-red-600">
              Type <span className="font-mono font-bold">DELETE</span> to
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
