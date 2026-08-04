# OpenCaptions — Project Context

## What This Is

OpenCaptions is an open-source video understanding pipeline that generates **Caption with Intention (CWI)** compliant captions. CWI is the Oscar-winning (2025) captioning standard by FCB Chicago + Chicago Hearing Society that transforms flat static captions into expressive visual storytelling through attribution (speaker colors), synchronization (word-level animation), and intonation (variable font weight/size conveying pitch and volume).

OpenCaptions is the first programmatic toolchain for CWI. It extracts cinematic intent from video — pitch, volume, emotion, emphasis, sarcasm, pacing — then renders that felt experience as CWI visual language.

## Repos

- **Public (OSS)**: https://github.com/broomva/opencaptions → `~/broomva/apps/opencaptions/`
- **Private (platform)**: https://github.com/broomva/opencaptions-platform → `~/broomva/apps/opencaptions-platform/`
- **npm org**: `@opencaptions` (broomva = owner)

## Architecture

```
VideoInput
  → TranscriptBackend (V1: faster-whisper)
  → DiarizationBackend (V1: pyannote-audio, fallback: energy-based)
  → IntentExtractorBackend (V1: parselmouth + FER, V2: V-JEPA2, V3: TRIBE v2)
  → IntentMapper (V1: RulesMapper, V2: LearnedMapper, V3: NeuralMapper)
  → CWIValidator → ValidationReport
  → TracingCollector (opt-in feedback flywheel)
```

## Package Structure

```
packages/
├── types/       — Zero-dep TypeScript types + constants (506 LOC)
├── spec/        — 12-rule CWI validation engine (468 LOC)
├── layout/      — Word geometry engine, animation helpers (218 LOC)
├── pipeline/    — Orchestrator + RulesMapper + voice profiling (344 LOC)
├── backend-av/  — V1 extractor + 4 Python scripts (374 LOC TS + 822 LOC Python)
├── backend-jepa/— V2 extractor stub
├── renderer/    — Terminal ANSI + WebVTT + AE/Premiere export (645 LOC)
├── mcp/         — MCP server with 4 tools (478 LOC)
├── tracing/     — Telemetry + correction collection (346 LOC)
└── cli/         — Bun CLI: 8 commands (794 LOC)
```

## Commands

```bash
bun install                                      # Install deps
turbo build                                      # Build all packages
bun run packages/cli/src/index.ts --help         # CLI help
bun run packages/cli/src/index.ts generate <video>  # Generate CWI captions
bun run packages/cli/src/index.ts validate <cwi.json>
bun run packages/cli/src/index.ts preview <cwi.json>
bun run packages/cli/src/index.ts export <cwi.json> --format webvtt|ae-json|premiere-xml
bun run packages/cli/src/index.ts doctor         # Check dependencies
bun run packages/cli/src/index.ts setup          # Install Python deps
bun run packages/cli/src/index.ts telemetry show|on|off
bun test                                         # Run all tests
```

## Conventions

- **Package manager**: Bun
- **Build**: Turborepo (`turbo build`)
- **Linter**: Biome (never ESLint/Prettier)
- **TypeScript**: Strict mode, ES2022 target
- **Testing**: `bun test`
- **License**: MIT

## Python Dependencies (Layered Degradation)

Pipeline works with zero Python deps. Each adds a layer:

| Package | What it enables | Install |
|---------|----------------|---------|
| faster-whisper | Word-level transcription | `pip install faster-whisper` |
| praat-parselmouth | Real pitch/volume per utterance | `pip install praat-parselmouth` |
| librosa | Speech rate, energy-based diarization fallback | `pip install librosa` |
| pyannote-audio | Multi-speaker detection + colors | `pip install pyannote-audio` + HF token |
| fer + opencv | Facial emotion detection | `pip install fer opencv-python-headless` |
| ollama | Semantic emphasis/sarcasm detection | Install from ollama.com |

## Key Design Decisions

1. **Pluggable backends**: All backends implement typed interfaces. V1→audio+vision, V2→V-JEPA2, V3→TRIBE v2.
2. **RulesMapper V1**: pitch→weight (lerp 200-700), volume→size (lerp 0.8-1.35), emphasis from semantic+volume.
3. **Pause-based utterance splitting**: Gaps > 400ms create natural breaks even without diarization.
4. **Layered degradation**: Pipeline works with nothing installed, improves with each dep added.
5. **Tracing is the moat**: Correction data → learned mapper training data.
6. **Lighthouse model**: We measure, not certify. Validation report URL is the artifact.

## Linear Tickets (BRO-520 through BRO-546)

### Done (19)
BRO-520–529, BRO-534–538, BRO-540–541, BRO-544, BRO-546

### Remaining (8)
- BRO-530: Hosted API + billing (platform repo)
- BRO-531: Web dashboard (platform repo)
- BRO-532: V-JEPA2 backend
- BRO-533: LearnedMapper V2
- BRO-539: Community outreach
- BRO-542: backend-tribe (TRIBE v2)
- BRO-543: NeuralMapper V3
- BRO-545: Deaf reviewer study

## npm Publishing

Run `./scripts/publish-all.sh` (passkey auth per package via `bun publish`).
Publish order: types → spec/layout/pipeline/tracing → backend-av/renderer/mcp → cli

## CWI Animation Spec (from FCB Chicago)

- Ease curve, 100ms delay, 600ms duration
- Word transition: white → speaker color
- Emphasis: 15% size bounce upward
- Font: Roboto Flex (variable, weight = pitch, size = volume)
- 12-color WCAG AA palette in types/src/index.ts
