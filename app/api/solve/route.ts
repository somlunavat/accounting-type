import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are an expert financial accounting tutor with deep knowledge of GAAP, IFRS, journal entries, financial statements, ratios, and managerial accounting.

When shown an accounting problem:
- Give the answer directly and concisely — no lengthy preamble
- Show journal entries in proper debit/credit format
- Include key numbers and the final answer clearly labelled
- Skip obvious reasoning; only explain non-obvious steps in one sentence
- Use short sections only when the problem has multiple distinct parts

If the image is blurry or unreadable, say so briefly and ask for a clearer photo.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY environment variable is not set.");
    return new Response(
      JSON.stringify({ error: "API key not configured. Set ANTHROPIC_API_KEY in your environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let imageBase64: string;
  try {
    const body = await req.json();
    imageBase64 = body.imageBase64;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      throw new Error("Missing imageBase64");
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body. Expected { imageBase64: string }." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Detect media type from base64 header magic bytes (fallback to jpeg)
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  const prefix = imageBase64.slice(0, 12);
  if (prefix.startsWith("iVBOR")) mediaType = "image/png";
  else if (prefix.startsWith("R0lGO")) mediaType = "image/gif";
  else if (prefix.startsWith("UklGR")) mediaType = "image/webp";

  const client = new Anthropic({ apiKey });

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: "Solve this accounting problem.",
          },
        ],
      },
    ],
  });

  // Stream the text chunks directly to the client
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
