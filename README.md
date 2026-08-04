# OpenCaptions TTML Converter

Biblioteca Python para conversão de legendas em formato JSON para TTML com suporte a ênfase e estilização.

## Instalação

```bash
pip install git+[https://github.com/SEU_USUARIO/NOME_DO_REPOSITORIO.git](https://github.com/fernandacoutinho/opencaptions-cwi.git)
=======
# OpenCaptions
------------------------------------------------------------------------------------------------------

> Feel the film. Render the intent.

Open-source video understanding pipeline that generates [Caption with Intention (CWI)](https://www.captionwithintention.org/) compliant captions by extracting cinematic intent from video.

## What is this?

Caption with Intention won an Oscar (2025) and two Cannes Lions Grand Prix. It transforms flat, static captions into expressive visual storytelling through:

- **Attribution** — color-coded speaker identification
- **Synchronization** — word-by-word animation synced to speech
- **Intonation** — variable font weight and size conveying pitch, volume, and emotion

OpenCaptions is the first programmatic toolchain for CWI. Point it at a video, and it extracts intent — pitch, volume, emotion, emphasis, sarcasm, pacing — then renders that felt experience as CWI visual language.

## Quick Start

```bash
# Install faster-whisper for transcription
pip install faster-whisper

# Generate CWI captions from a video
npx opencaptions generate film.mp4

# Preview in terminal (with speaker colors)
npx opencaptions preview film.cwi.json

# Validate against CWI spec
npx opencaptions validate film.cwi.json

# Export to WebVTT, After Effects, or Premiere Pro
npx opencaptions export film.cwi.json --format webvtt
npx opencaptions export film.cwi.json --format ae-json
npx opencaptions export film.cwi.json --format premiere-xml
```

## How It Works

```
Video → Transcription (Whisper) → Speaker Diarization → Intent Extraction → CWI Mapping → Validation
         word timestamps           who speaks when       pitch, volume,      weight, size,   12-rule
                                                         emotion, emphasis   emphasis, color  scoring
```

Each dependency you install makes the captions feel more:

| Install | What improves |
|---------|--------------|
| `pip install faster-whisper` | Word-level transcription with timestamps |
| `pip install praat-parselmouth` | Real pitch/volume → weight/size vary per word |
| `pip install librosa` | Speech rate, pause detection, energy-based segmentation |
| `pip install pyannote-audio` | Multi-speaker detection → each speaker gets their own color |
| `pip install fer opencv-python-headless` | Facial emotion → valence/arousal in captions |

## Packages

| Package | Description |
|---------|-------------|
| `@opencaptions/types` | Core TypeScript types + JSON Schema + constants |
| `@opencaptions/spec` | 12-rule CWI validation engine (ATT/SYN/INT/FCC) |
| `@opencaptions/layout` | Word geometry engine (Pretext-compatible) |
| `@opencaptions/pipeline` | Orchestrator + RulesMapper + voice profiling |
| `@opencaptions/backend-av` | V1: Whisper + pyannote + parselmouth + FER |
| `@opencaptions/renderer` | Terminal renderer + WebVTT + AE/Premiere export |
| `@opencaptions/tracing` | Opt-in anonymous telemetry + correction data |
| `@opencaptions/mcp` | MCP server for AI agent integration |
| `opencaptions` | Bun CLI |

## CLI Commands

```
opencaptions generate <video> [--output <file.cwi.json>]  # Full pipeline
opencaptions validate <file.cwi.json>                      # Score against CWI spec
opencaptions preview <file.cwi.json>                       # Terminal preview with colors
opencaptions export <file.cwi.json> --format <fmt>         # WebVTT, AE, Premiere
opencaptions telemetry [show|on|off]                        # Manage telemetry
opencaptions setup                                          # Install Python deps
opencaptions doctor                                         # Verify components
```

## CWI Document Format (`.cwi.json`)

```json
{
  "$schema": "https://opencaptions.tools/schema/cwi/1.0.json",
  "version": "1.0",
  "cast": [
    { "id": "S0", "name": "Elara", "color": "#6B8AFF", "voice_profile": { ... } }
  ],
  "captions": [
    {
      "id": "cap_001",
      "start": 5.2, "end": 8.4,
      "speaker_id": "S0",
      "words": [
        { "text": "I", "start": 5.2, "end": 5.4, "weight": 400, "size": 1.0, "emphasis": false },
        { "text": "never", "start": 5.4, "end": 5.9, "weight": 700, "size": 1.2, "emphasis": true }
      ]
    }
  ]
}
```

## Development

```bash
git clone https://github.com/broomva/opencaptions
cd opencaptions
bun install
turbo build
bun test
```

## Integrations

- **[OpenMontage](https://github.com/calesthio/OpenMontage)** — CWI tool + skill pack for the agentic video production orchestrator
- **MCP Server** — AI agents (Claude, GPT) can generate CWI captions via `@opencaptions/mcp`
- **After Effects** — ExtendScript export with keyframed animations
- **Premiere Pro** — FCP XML import with styled caption tracks

## Architecture

The pipeline uses pluggable backends with three mapper versions:

- **V1 RulesMapper** (shipped) — `pitch → weight`, `volume → size`, pure math
- **V2 LearnedMapper** (planned) — Neural network trained on human correction data
- **V3 NeuralMapper** (planned) — TRIBE v2 brain activations → CWI styling

## License

MIT
