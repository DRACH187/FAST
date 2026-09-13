import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const channel = await db.channel.findUnique({ where: { slug } });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const url = new URL(_req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 200);

    const messages = await db.message.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      channel: {
        id: channel.id,
        slug: channel.slug,
        name: channel.name,
        tagline: channel.tagline,
      },
      messages: messages.reverse().map((m) => ({
        id: m.id,
        content: m.content,
        author: m.author,
        channelId: m.channelId,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("GET channel messages error:", error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
