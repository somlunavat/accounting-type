import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are an expert tutor. The user will show you a problem — math, science, reading comprehension, or any subject. Solve it step by step, explain your reasoning clearly, and provide the final answer. Format your response with clear sections.

If the image is blurry, unclear, or you cannot read the problem, say so honestly and suggest the user retake the photo with better lighting or focus.`;

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
            text: "Please solve this problem step by step.",
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
