# MathSnap — AI Problem Solver

Point your phone camera at any math, science, or reading problem and get a clear, step-by-step solution powered by Claude Sonnet.

## Quick start (local dev)

```bash
npm install
# Add your Anthropic key to .env.local
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local
npm run dev
# Open http://localhost:3000
```

## Deploy to Vercel

### 1. Install Vercel CLI and log in

```bash
npm install -g vercel
vercel login
```

### 2. Link to a new Vercel project

```bash
vercel
# Follow the prompts — create a new project, leave all settings at defaults
```

### 3. Add your Anthropic API key

```bash
vercel env add ANTHROPIC_API_KEY
# Paste your key when prompted, select all environments (Production, Preview, Development)
```

> Get your key at https://console.anthropic.com/

### 4. Deploy to production

```bash
vercel --prod
```

Vercel prints a live URL like `https://math-solver-abc123.vercel.app`.  
Open it on any phone — no App Store needed.

---

## How it works

1. User taps **Take a Photo** (opens native camera on mobile) or uploads from gallery
2. The image is base64-encoded in the browser and sent to `/api/solve`
3. The API route calls `claude-sonnet-4-6` with the image and streams the response back
4. The UI renders the streamed markdown + LaTeX answer in real time

## Project structure

```
app/
  page.tsx          # Mobile-optimized single-page UI
  layout.tsx        # Loads KaTeX CSS for math rendering
  globals.css       # Dark theme + solution prose styles
  api/
    solve/
      route.ts      # Streaming API route (API key stays server-side)
.env.local          # ANTHROPIC_API_KEY (never committed)
vercel.json         # Sets API route maxDuration to 30s
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `API key not configured` error | Add `ANTHROPIC_API_KEY` to `.env.local` or Vercel env vars |
| Camera button opens file picker | Expected on desktop — native camera only works on mobile |
| Blurry/unreadable image | Claude will say so — retake with better lighting |
| Deploy times out | Verify `vercel.json` has `maxDuration: 30` |
