import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const author = typeof body?.author === "string" ? body.author.trim() : "";
    const slug = typeof body?.channelSlug === "string" ? body.channelSlug.trim() : "";

    if (!content || !author || !slug) {
      return NextResponse.json(
        { error: "content, author and channelSlug are required" },
        { status: 400 }
      );
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Message too long (2000 max)" }, { status: 400 });
    }

    const channel = await db.channel.findUnique({ where: { slug } });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const message = await db.message.create({
      data: { content, author, channelId: channel.id },
    });

    return NextResponse.json({
      message: {
        id: message.id,
        content: message.content,
        author: message.author,
        channelId: message.channelId,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    console.error("POST /api/messages error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
