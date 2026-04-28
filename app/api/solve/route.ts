import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a study assistant for Gov 310L (U.S. Government) at UT Austin.

Always structure your response like this:
1. Start with ## followed by the direct answer (1 sentence max) — this is displayed large
2. Then a brief explanation in plain paragraphs or a short list — this is displayed small

Rules:
- The ## answer line must be a complete standalone answer, not a heading like "Answer:"
- Keep the explanation to 2–4 sentences or a short bullet list
- If the image is blurry or unreadable, say so and ask for a clearer photo`;

const SYSTEM_PROMPT_WITH_GUIDES = `${SYSTEM_PROMPT}
- Draw primarily from the provided course materials
- If a question falls outside the provided materials, say so in the explanation`;

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

  const imageBlock = {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType, data: imageBase64 },
  };
  const questionText = { type: "text" as const, text: "Answer this question using the provided course materials." };
  const fallbackText = { type: "text" as const, text: "Answer this question." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docBlocks: any[] = guides.map((g) => ({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: g.data },
    title: g.title,
  }));

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      let closed = false;
      const close = () => { if (!closed) { closed = true; controller.close(); } };

      // — Guides stream —
      const guidesStream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: SYSTEM_PROMPT_WITH_GUIDES,
        messages: [{ role: "user", content: [...docBlocks, imageBlock, questionText] }],
      });

      let firstTokenSeen = false;

      const timeoutId = setTimeout(async () => {
        if (firstTokenSeen) return;
        // No token in 3s — abort guides and fall back to general AI
        guidesStream.abort();
        try {
          const fallback = client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: [imageBlock, fallbackText] }],
          });
          for await (const chunk of fallback) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              send(chunk.delta.text);
            }
          }
        } catch (err) {
          send(`\n\n[Error: ${err instanceof Error ? err.message : "Stream error"}]`);
        }
        close();
      }, 3000);

      try {
        for await (const chunk of guidesStream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              clearTimeout(timeoutId);
            }
            send(chunk.delta.text);
          }
        }
        if (firstTokenSeen) close();
      } catch {
        // Aborted by timeout — fallback is already running
        if (firstTokenSeen) {
          close();
        }
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
