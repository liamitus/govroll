import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PAGE_SIZE = 20;

/**
 * GET /api/account/conversations?page=N
 *
 * Lists the user's AI chat conversations, most recently updated first, with
 * the bill they were anchored to and a preview of the last message. Used by
 * the /account "Your conversations" section so the user can resume any past
 * chat without remembering which bill it was on.
 */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageParam = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  // Single query — Prisma batches the nested message include and `_count`,
  // so even with a page of 20 conversations we issue a small fixed number
  // of round-trips rather than 1 + 20.
  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        bill: { select: { id: true, billId: true, title: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { sender: true, text: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.conversation.count({ where: { userId: user.id } }),
  ]);

  return NextResponse.json(
    {
      conversations: conversations.map((c) => ({
        id: c.id,
        bill: c.bill,
        lastMessage: c.messages[0] ?? null,
        messageCount: c._count.messages,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
