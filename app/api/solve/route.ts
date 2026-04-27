import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a study assistant for Gov 310L (U.S. Government) at UT Austin. You have been provided the course lecture notes and review sheets as reference documents.

Always structure your response like this:
1. Start with ## followed by the direct answer (1 sentence max) — this is displayed large
2. Then a brief explanation in plain paragraphs or a short list — this is displayed small

Rules:
- Draw primarily from the provided course materials
- The ## answer line must be a complete standalone answer, not a heading like "Answer:"
- Keep the explanation to 2–4 sentences or a short bullet list
- If a question falls outside the provided materials, say so in the explanation
- If the image is blurry or unreadable, say so and ask for a clearer photo`;

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
