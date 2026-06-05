# Gemini Image Reader Node — Design

**Date:** 2026-06-05
**Status:** Approved, ready for implementation plan

## Problem

The engine runs on the happy path but cannot read images. Telegram users send
photos (notably payment screenshots), and the agent only accepts text. We need
built-in nodes that turn an image into text using Gemini, without buffering
large files (e.g. 8MB) fully in memory.

## Why native Gemini + Files API (not OpenRouter, not inline base64)

- **OpenRouter** would accept a remote URL via `image_url`, but the user chose
  the native Google Generative Language API.
- Native Gemini does **not** accept arbitrary external URLs (`file_data.file_uri`
  must be a GCS or Files API URI). So the only native, large-file-safe path is
  the **Files API**: stream bytes up, reference the returned `file_uri`.
- **Inline `inline_data` base64** is rejected: it forces the whole file into a
  buffer/string in memory — exactly the failure mode we want to avoid for large
  files. Google itself recommends Files API for requests over 20MB.

The memory win only holds if **nothing buffers the whole file**: the source
stream is piped straight into the Files API resumable upload, and Gemini fetches
the bytes by `file_uri` at generate time (our server never holds them for the
LLM call).

## Scope

Build **three built-in nodes** and a small shared HTTP helper. **No demo
workflow wiring, no agent-input change, no S3** — those are deferred (see Out of
Scope).

### Node 1 — `TelegramGetFileNode`

`src/engine/nodes/telegram/get-file.node.ts`

Resolves a Telegram `fileId` to a downloadable URL. Generic — reused later for
video/audio, not image-specific.

```
input:  { botToken: string; fileId: string }
output: { url: string; filePath: string; fileSize?: number }
```

Flow:
1. `GET https://api.telegram.org/bot<botToken>/getFile?file_id=<fileId>`
2. On `!res.ok` → throw `Error("getFile failed: <status> <body>")`.
3. Parse `result.file_path`, `result.file_size`.
4. Build `url = https://api.telegram.org/file/bot<botToken>/<file_path>`.

Notes:
- The returned URL embeds the bot token. That is internal-only — it is consumed
  immediately by the upload node, not surfaced to users.
- `@Injectable()`, extends `Node<I, O>`.

### Node 2 — `GeminiUploadFileNode`

`src/engine/nodes/gemini/upload-file.node.ts`

Streams a file from a URL into the Gemini Files API. **Media-agnostic** — the
Files API uses one upload endpoint for image/video/audio/PDF, so this node is
reused by future read nodes (audio, video).

```
input:  { apiKey: string; url: string; mimeType: string; fileSize: number; displayName?: string }
output: { fileUri: string; name: string; mimeType: string; state: string }
```

Flow (resumable, streamed — never buffers the whole file):
1. `const src = await fetch(url)`; on `!src.ok` → throw. Take `src.body`
   (a `ReadableStream`).
2. **Start the resumable session:**
   `POST https://generativelanguage.googleapis.com/upload/v1beta/files?key=<apiKey>`
   headers:
   - `X-Goog-Upload-Protocol: resumable`
   - `X-Goog-Upload-Command: start`
   - `X-Goog-Upload-Header-Content-Length: <fileSize>`
   - `X-Goog-Upload-Header-Content-Type: <mimeType>`
   - `Content-Type: application/json`
   body: `{ "file": { "display_name": <displayName ?? "upload"> } }`
   Read the `x-goog-upload-url` response header → `uploadUrl`. Throw if missing.
3. **Upload bytes + finalize in one request:**
   `POST <uploadUrl>` headers:
   - `Content-Length: <fileSize>`
   - `X-Goog-Upload-Offset: 0`
   - `X-Goog-Upload-Command: upload, finalize`
   body: `src.body` with `duplex: 'half'` (stream — no buffering).
   Response JSON: `{ file: { name, uri, mimeType, state } }`.
4. **Poll until processed:**
   `GET https://generativelanguage.googleapis.com/v1beta/files/<name>?key=<apiKey>`
   - Loop while `state === "PROCESSING"`, with a fixed delay between attempts
     and a max attempt cap.
   - `state === "ACTIVE"` → return.
   - `state === "FAILED"` (or cap exceeded) → throw.
   - Images are typically `ACTIVE` immediately; the poll still runs to be safe
     for larger media.

Output `fileUri` is `file.uri`, `name` is `file.name` (e.g. `files/abc123`).

### Node 3 — `GeminiReadImageNode`

`src/engine/nodes/gemini/read-image.node.ts`

Calls `generateContent` with a `file_uri` reference and a caller-supplied prompt,
returns the model's text.

```
input:  { apiKey: string; model: string; fileUri: string; mimeType: string; prompt: string }
output: { text: string }
```

Flow:
1. `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<apiKey>`
   body:
   ```json
   { "contents": [ { "parts": [
       { "file_data": { "mime_type": "<mimeType>", "file_uri": "<fileUri>" } },
       { "text": "<prompt>" }
   ] } ] }
   ```
2. On `!res.ok` → throw.
3. Parse `candidates[0].content.parts[].text`, join into one string.
4. Throw if there are no candidates / no text (e.g. safety block) →
   `Error("Gemini returned no text")`.

The prompt is the caller's responsibility (e.g. a payment-slip extraction prompt
for the demo). This node stays generic.

### Shared — `gemini-http.ts`

`src/engine/nodes/gemini/gemini-http.ts`

- `GEMINI_BASE = "https://generativelanguage.googleapis.com"` (and the
  `/upload/v1beta` / `/v1beta` paths as needed).
- A helper to throw a uniform `Error` from a failed `Response`
  (`<context>: <status> <body>`), used by both Gemini nodes.
- `sleep(ms)` for the upload node's poll loop.

### Registration & exports

- Add `TelegramGetFileNode`, `GeminiUploadFileNode`, `GeminiReadImageNode` to
  `EngineModule` `providers` and `exports` (mirrors `AiAgentNode` — they are
  built-ins, resolvable via `wf.run` without per-project provider wiring).
  - (The existing telegram webhook/send nodes are registered in `DemoModule`
    instead; that pre-existing inconsistency is left untouched.)
- Export the node classes and their input/output types from
  `src/engine/index.ts`.

## Testing (TDD)

- Co-located `*.spec.ts` for each node. Write the failing test first.
- Mock the global `fetch`. No real credentials; no live calls.
- `TelegramGetFileNode`: asserts the getFile call URL, success parsing into the
  download URL, and the `!ok` throw.
- `GeminiUploadFileNode`: asserts the two-step resumable sequence (start reads
  `x-goog-upload-url`; upload sends `upload, finalize` + offset 0; stream body
  passed through), the poll loop transitioning `PROCESSING → ACTIVE`, and the
  `FAILED`/`!ok` throws. Verify the source body is streamed, not buffered.
- `GeminiReadImageNode`: asserts the `generateContent` body shape (`file_data`
  + `text` parts), text extraction/join, and the no-text throw.

## Error handling

- Every non-2xx response throws an `Error` carrying status + body text (matches
  the existing `TelegramSendMessageNode` / `OpenRouterChatModel` convention).
- Upload poll: throw on `FAILED` state or when the attempt cap is exceeded.
- Read: throw when no candidate text is present (covers safety blocks).
- Errors propagate up; `WorkflowEngine` records them in the trace as usual.

## Out of scope (deferred, discussed later)

- **Agent-input injection / demo workflow wiring** — how extracted text reaches
  `AiAgentNode` (text-only input today). Decided separately.
- **S3** — dropped; the Gemini Files API is the store for the native path.
- **`demoConfig` Gemini keys** (`DEMO_GEMINI_API_KEY`, `DEMO_GEMINI_MODEL`) —
  added when the nodes are wired into the demo.
- Other modalities' read nodes (audio/video) — the upload node is built to be
  reused by them, but they are not built now.
