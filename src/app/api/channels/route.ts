import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const channels = await db.channel.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return NextResponse.json({
      channels: channels.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        tagline: c.tagline,
        messageCount: c._count.messages,
        lastMessage: c.messages[0]
          ? {
              author: c.messages[0].author,
              content: c.messages[0].content,
              createdAt: c.messages[0].createdAt,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("GET /api/channels error:", error);
    return NextResponse.json({ error: "Failed to load channels" }, { status: 500 });
  }
}
