# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

OIRTE AI — a Next.js PWA that helps deaf people and elderly adults communicate. It listens to
spoken conversation via the Web Speech API, shows it as large-text chat, and uses Gemini to
suggest 3 short reply options; replies are read aloud via ElevenLabs TTS (with native
`speechSynthesis` as fallback). It also analyzes photos/documents and transcribes uploaded
audio/video (with SRT subtitle export for video). Spanish-language UI, mobile-first,
single-page (`src/app/page.tsx`), no routing beyond the 3 in-app tabs (Chat / Medios / Contactos).

## Commands

```bash
npm run dev      # start dev server (Next.js 16, Turbopack) on :3000
npm run build    # production build (Turbopack)
npm run start    # run the production build
npm run lint     # eslint (flat config, eslint-config-next core-web-vitals + typescript)
```

There is no test suite/framework configured in this repo.

### Required environment variables (`.env.local`, gitignored)

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
```

Both are read server-side only, inside the two API routes — never exposed to the client.

## Architecture

- **Everything client-side lives in one file**: `src/app/page.tsx`. All chat/media/contacts state,
  handlers, and inline styles (`S` object) are defined there — there's no component
  decomposition. When making UI changes, this is almost always the file to edit.
- **Two server routes, both stateless proxies to external APIs**:
  - `src/app/api/gemini/route.ts` — one endpoint that branches on the request body shape
    (`text` → 3 suggested replies, `image`+`mimeType` → photo/doc description, `docText` → plain
    text summary, `audio`+`audioMimeType` [+`subtitles`] → transcription or timestamped SRT
    text). Tries `gemini-2.5-flash` then falls back to `gemini-2.5-pro` (`tryModels()`).
  - `src/app/api/tts/route.ts` — proxies text to ElevenLabs TTS. The voice ID (Matilda,
    `XrExE9yKIg1WjnnlVkGX`) is **hardcoded**, deliberately overriding any stale env var that
    might be set in a hosting dashboard (see comment in the file).
- **`src/hooks/useSpeechRecognition.ts`**: wraps the Web Speech API with iOS Safari workarounds —
  `continuous` mode fires `onend` prematurely on iOS, so it auto-restarts recognition while
  `wantListeningRef` is true. Auto-stops after 4s of silence (`SILENCE_MS`) and fires
  `onAutoStop(finalText)`, which `page.tsx` wires to `fetchSuggestions`. Only supported in
  Chromium-based browsers and Safari — not Firefox desktop.
- **`src/lib/mediaUtils.ts`**: client-side image compression (canvas → JPEG, capped at 1024px by
  default) and base64 encoding, plus a best-effort `[MM:SS] text` → `.srt` parser
  (`generateSRT`) for the video-subtitle feature.
- **Upload size limit**: `MAX_AUDIO_BYTES` in `page.tsx` (3.5 MB) exists specifically because of
  Vercel Hobby tier's ~4.5 MB serverless payload limit (base64 grows payloads ~33%). This
  constraint is now stale now that the app deploys to Netlify (see below) — Netlify's function
  payload limits differ — but the value hasn't been revisited.
- **`src/components/DemoUserProvider.tsx`**: trivial localStorage-backed context for a demo user
  toggle (name "ARMIN SALAZAR"), unrelated to auth.
- **`src/lib/contacts.json`**: static WhatsApp contact list rendered in the Contacts tab.

## Deployment

Deployed on **Netlify** (production, live): https://oirte-ai.netlify.app
Admin/build logs: https://app.netlify.com/projects/oirte-ai
Account: Netlify team "aiwis 360" (soporte.aiwis@gmail.com), same account used across other
AIWIS Lab projects.

GitHub source of truth: `origin` → `https://github.com/soporteaiwis-lab/oirte-ai.git`. Note a
second remote, `oirte_v2` (`OIRTE_v2.git`), also exists in this repo but is not the deployed one —
don't assume it's in sync.

Netlify config is `netlify.toml` (build command `npm run build`, `NODE_VERSION=20`, official
`@netlify/plugin-nextjs` runtime plugin). `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` are set as
Netlify environment variables (production context) via `netlify env:set` — not present anywhere
in the repo.

To redeploy manually: `netlify deploy --prod` from the repo root (Netlify CLI is already linked
to the `oirte-ai` site here). There is no GitHub → Netlify CI hookup yet; pushes to `main` do
**not** auto-deploy. Deploys are triggered manually via the CLI.

There's also a leftover `.vercel/project.json` (project `oirte-v2`) from when this app was
previously deployed on Vercel — that history explains the Vercel-specific payload-size comments
still in `page.tsx`. Vercel is not the current deployment target.

### Known Windows-local gotcha

`netlify deploy` renames `.next` on disk as part of publishing. If a local `next dev` server is
still running in this same folder, its open file handles inside `.next` cause the rename to fail
with `EPERM` (confirmed via a Node repro — not a flaky/transient error). Stop any local dev
server (`npm run dev`) before running a production deploy from this machine.
