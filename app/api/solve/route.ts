import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a study assistant for Gov 310L (U.S. Government) at UT Austin. You have been provided the course lecture notes and review sheets as reference documents.

When answering questions:
- Draw primarily from the provided course materials
- Give direct, concise answers — no lengthy preamble
- Reference specific concepts, cases, amendments, or terms from the notes when relevant
- If a question falls outside the provided materials, say so briefly and answer from general knowledge
- Use short sections only when the question has multiple distinct parts

If the image is blurry or unreadable, say so briefly and ask for a clearer photo.`;

interface GuideDoc {
  title: string;
  data: string;
}

let cachedGuides: GuideDoc[] | null = null;

function loadGuides(): GuideDoc[] {
  if (cachedGuides) return cachedGuides;
  const guidesDir = path.join(process.cwd(), "guides");
  const files = fs
    .readdirSync(guidesDir)
    .filter((f) => f.endsWith(".pdf"))
    .sort();
  cachedGuides = files.map((file) => ({
    title: file.replace(".pdf", ""),
    data: fs.readFileSync(path.join(guidesDir, file)).toString("base64"),
  }));
  return cachedGuides;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "API key not configured. Set ANTHROPIC_API_KEY in your environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let imageBase64: string;
  try {
    const body = await req.json();
    imageBase64 = body.imageBase64;
    if (!imageBase64 || typeof imageBase64 !== "string") throw new Error("Missing imageBase64");
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body. Expected { imageBase64: string }." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  const prefix = imageBase64.slice(0, 12);
  if (prefix.startsWith("iVBOR")) mediaType = "image/png";
  else if (prefix.startsWith("R0lGO")) mediaType = "image/gif";
  else if (prefix.startsWith("UklGR")) mediaType = "image/webp";

  const guides = loadGuides();
  const client = new Anthropic({ apiKey });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docBlocks: any[] = guides.map((g) => ({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: g.data },
    title: g.title,
  }));

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...docBlocks,
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Answer this question using the provided course materials.",
          },
        ],
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
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
