---
name: ak:ai-multimodal
description: Analyze and generate image, audio, video, and document content through the npm-latest Multix CLI and live provider catalogs. Use for vision analysis, transcription, OCR, design extraction, and multimodal generation.
user-invocable: true
when_to_use: "Invoke for Gemini vision, OCR, media generation, or transcription."
category: ai-ml
keywords: [vision, image, video, audio, Gemini]
license: MIT
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
argument-hint: "[file-path] [prompt]"
---

# AI Multimodal

Process audio, images, videos, and documents with the latest npm release of
`@mrgoonie/multix`. Use the `npx` invocation shown here; do not install or
call a global `multix`.

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix --version
```

## Setup

Requires Node.js 20+ and provider keys in process env, project `.env`, or
`~/.multix/.env`.

```bash
export GEMINI_API_KEY="your-key"          # https://aistudio.google.com/apikey
export OPENROUTER_API_KEY="your-key"      # optional image/video routing
export MINIMAX_API_KEY="your-key"         # optional MiniMax generation
```

Verify setup:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix check --verbose
```

When npm networking is enabled, every command resolves npm's `latest` dist-tag
and forces a registry staleness check. Network-restricted sessions must
pre-warm the current release first.

### Backend ownership

- Treat the npm-latest Multix CLI as the runtime contract for covered media
  operations; keep this skill focused on orchestration, provider setup, and
  examples.
- Report missing keys, FFmpeg, provider access, or `multix check` failures as
  environment blockers, not kit-loader failures.
- Track missing capability upstream and refresh the package's latest release
  before retrying. Do not recreate a parallel AgentKit Python backend unless an
  accepted ADR or explicit maintainer decision changes backend ownership.
- The skill intentionally has no managed runtime package: AgentKit requires
  immutable package pins there, while this command contract requires npm latest.

## Quick Start

Analyze media:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini analyze \
  --files input.png \
  --prompt "Analyze this content" \
  --format markdown \
  --output analysis.md
```

Transcribe audio or video:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini transcribe \
  --files interview.mp4 \
  --prompt "Generate a transcript with timestamps" \
  --format markdown \
  --output transcript.md
```

Extract structured data:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini extract \
  --files receipt.png \
  --prompt "Extract merchant, date, total, and line items as JSON" \
  --format json \
  --output receipt.json
```

Convert documents to Markdown:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix doc convert \
  --input report.pdf \
  --output report.md
```

Generate images after resolving an available model from the live provider catalog:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini generate \
  --prompt "Studio product photo on white background" \
  --model <verified-model-id> \
  --aspect-ratio 1:1 \
  --size 2K \
  --output product.png
```

Generate images through OpenRouter:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix openrouter generate \
  --prompt "Editorial campaign key visual" \
  --model <provider-qualified-model-id> \
  --aspect-ratio 4:5 \
  --image-size 2K \
  --output campaign.png
```

Configure OpenRouter fallback models with:

```bash
export OPENROUTER_FALLBACK_MODELS="black-forest-labs/flux.2-flex,recraft-ai/recraft-v3"
```

Generate videos with a currently available provider model:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix gemini generate-video \
  --prompt "15-second product demo video" \
  --model <verified-model-id> \
  --resolution 1080p \
  --aspect-ratio 16:9 \
  --output demo.mp4
```

Generate with MiniMax:

```bash
# Image
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate \
  --prompt "A cyberpunk city" --model <verified-image-model> --aspect-ratio 16:9 --output city.png

# Video
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate-video \
  --prompt "A dancer" --model <verified-video-model> --duration <supported-seconds> --resolution <supported-resolution> --output dancer.mp4

# Speech
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate-speech \
  --text "Hello world" --model <verified-speech-model> --voice <verified-voice> --output hello.mp3

# Music
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix minimax generate-music \
  --lyrics "La la la\nOh yeah" --prompt "upbeat pop" --model <verified-music-model> --output song.mp3
```

Optimize media before provider uploads:

```bash
npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix media optimize \
  --input raw-video.mp4 \
  --output optimized-video.mp4 \
  --target-size 20
```

## Provider and Model Resolution

The npm-latest Multix CLI owns command syntax. Provider catalogs own model IDs,
availability, features, limits, pricing, and deprecations. Before generation:

1. Run the relevant npm-latest `multix ... --help` command.
2. Check the provider's current model and pricing documentation.
3. Select an explicit model that supports the requested modality and controls.
4. Record that model in project configuration when reproducibility matters.

Never infer a provider model as "latest," "default," or "recommended" from this skill.

## Failure UX

- **First run / offline**: when npm networking is enabled, `npx --prefer-online` checks the npm registry before each run. For sandboxed or offline sessions, pre-warm with `npx --yes --prefer-online --package=@mrgoonie/multix@latest -- multix --version` while network access is available.
- **Node <20**: install Node.js 20+ and rerun the command.
- **Provider key missing**: `multix` reports the missing env var. Export keys in the shell, project `.env`, or `~/.multix/.env`.
- **Environment discovery**: use the locations reported by the resolved CLI; do not infer provider-key search paths from an older backend.
- **Provider API error**: keep the full provider error, redact keys, and retry only after fixing auth, billing, quota, model access, or request parameters.
- **Codex installs**: this skill has no managed runtime package. Codex uses the npm-latest `npx` commands in this file, so pre-warm the npm cache before network-restricted runs.

If the resolved CLI does not expose a required operation, report the observed gap
and check the upstream issue tracker. Do not revive a parallel local backend.

## References

Load for detailed guidance:

| Topic | File | Description |
|-------|------|-------------|
| Music | `references/music-generation.md` | Stable music brief and review workflow; resolve live provider controls. |
| Audio | `references/audio-processing.md` | Stable transcription and generation workflow; resolve live formats, models, limits, and pricing. |
| Images | `references/vision-understanding.md` | Stable OCR and visual-analysis workflow; resolve live input limits. |
| Image Gen | `references/image-generation.md` | Stable generation/editing workflow; resolve live model capabilities and pricing. |
| Video | `references/video-analysis.md` | Stable video-analysis workflow; resolve live inputs and limits. |
| Video Gen | `references/video-generation.md` | Stable video-generation workflow; resolve live controls and models. |
| MiniMax | `references/minimax-generation.md` | Stable multimodal workflow; resolve the live MiniMax catalog. |

## Limits

Provider limits still apply. Resolve current inline/file-upload size,
retention, duration, context, and output limits before execution. When input or
output exceeds the verified limit, split media with `ffmpeg` or the resolved
Multix media command, process segments, then combine the results.

Transcript output should be Markdown with metadata, chunk status, and timestamped
lines:

```text
[HH:MM:SS -> HH:MM:SS] transcript content
```

## Outputs

Invoke `ak:project-organization` when generated assets need to be grouped into a
project, campaign, report, or deliverable folder.

## Resources

- [multix CLI](https://github.com/mrgoonie/multix-cli)
- [Gemini API Docs](https://ai.google.dev/gemini-api/docs/)
- [Gemini Pricing](https://ai.google.dev/pricing)
- [OpenRouter Image Generation Docs](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter Provider Routing](https://openrouter.ai/docs/features/provider-routing)
- [MiniMax API Docs](https://platform.minimax.io/docs/api-reference/api-overview)
- [MiniMax Pricing](https://platform.minimax.io/pricing)
