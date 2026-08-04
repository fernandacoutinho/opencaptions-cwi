---
name: cwi-captions
category: creative
description: Creative direction for CWI (Caption with Intention) captions
---

# CWI Captions -- Creative Direction

## When to Use CWI vs Flat SRT

Use CWI captions for **any content where emotional delivery matters**. The decision is straightforward:

| Content Type | CWI Recommended? | Reasoning |
|---|---|---|
| Narrative film / documentary | Yes | Dialogue carries emotion, pacing, and character |
| Interview / podcast | Yes | Speaker identity and tonal shifts are central |
| Music video | Yes | Lyrics have rhythm, emphasis, and dynamic range |
| Tutorial / screencast | Sometimes | Monotone narration gains little from intonation |
| Corporate presentation | Rarely | Flat delivery is the norm; CWI may feel unnatural |
| Surveillance / security footage | No | No speech intent to convey |

**Rule of thumb**: if you would lose meaning by reading a flat transcript instead of hearing the audio, the content needs CWI.

## The Three CWI Pillars

### Attribution (Speaker Colors)

Every speaker gets a unique, WCAG AA-compliant color. OpenCaptions provides a 12-color palette with minimum deltaE >= 30 in CIE Lab space, ensuring colors are distinguishable even for colorblind viewers.

**Color assignment strategy for multi-speaker content:**

1. **Protagonist first** -- assign the most visually prominent color (the default palette starts with `#6B8AFF` blue) to the main character or interviewer.
2. **Contrast over aesthetics** -- choose colors that maximize visual distance between speakers who talk in rapid succession (back-and-forth dialogue).
3. **Consistency across scenes** -- if a character appears in multiple scenes, they keep the same color throughout. The `cast` array in the CWI document is the source of truth.
4. **Named speakers** -- always provide `speaker_names` when characters are known. "Dr. Martinez" is infinitely more meaningful than "Speaker 2".
5. **Off-screen and narration** -- use a muted color (e.g., `#FFD56B` warm yellow) for voice-over narration to visually separate it from on-screen dialogue.

### Synchronization (Word-Level Animation)

CWI animates words as they are spoken, using a 600ms ease curve with a 100ms delay. This creates a "karaoke" effect where words transition from white to the speaker's color at the moment of utterance.

**Creative considerations:**

- **Fast dialogue**: the animation timing is fixed at 600ms per the CWI spec. If two speakers overlap or alternate rapidly, ensure caption events do not overlap (SYN_003 rule).
- **Dramatic pauses**: a pause > 3 seconds triggers FCC_001 (gap warning). This is intentional -- long silences should have `[silence]` or `[music]` placeholder events.
- **Song lyrics**: word-level sync is crucial. If the transcription backend misaligns words to beats, use `opencaptions annotate` to correct individual word timestamps.

### Intonation (Variable Font Weight & Size)

This is where CWI creates its emotional impact. The Roboto Flex variable font maps two audio dimensions to two visual dimensions:

| Audio Signal | CWI Visual | Roboto Flex Axis | Range |
|---|---|---|---|
| Pitch | Font weight | `wght` | 100 (thin, low pitch) to 900 (black, high pitch) |
| Volume | Font size | multiplier | 0.7x (quiet) to 1.5x (loud) |

**Emotional arc considerations:**

1. **Build tension gradually** -- a scene that builds from whisper to shout should show a smooth weight/size gradient across caption events, not a sudden jump.
2. **INT_003 variance threshold** -- at least 20% of words must have non-default weight (not all 400). If the content is genuinely monotone, that is a signal the content may not benefit from CWI.
3. **Sarcasm** -- the intent extractor detects sarcasm probability. When sarcasm is high, the mapper may produce unexpected weight patterns (light weight on emphatic words). Review these carefully.
4. **Whisper and shout markers** -- OpenCaptions tags words as `whisper` or `shout` when volume deviates significantly from the speaker's baseline. These trigger special rendering: whispers get a subtle opacity reduction, shouts get the 15% size bounce animation.

## Validation Scores as Quality Gates

The CWI validation score (0-100, averaged across three pillars) should be used as a quality gate in OpenMontage pipelines:

| Score | Quality Level | Pipeline Action |
|---|---|---|
| >= 90 | Excellent | Auto-approve, no review needed |
| 80-89 | Good | Auto-approve with info log of findings |
| 60-79 | Needs review | Flag for human review, show findings |
| < 60 | Poor | Block pipeline, require manual correction |

**Recommended pipeline gate:**

```yaml
# In your OpenMontage pipeline YAML
- tool: opencaptions_cwi
  quality_gate:
    min_score: 80
    fail_action: review  # or "block"
```

## Creative Decisions by Genre

### Documentary / Interview

- Use speaker names from research/pre-production
- Assign warm colors to subjects, cool colors to interviewer
- Low intonation variance is expected for calm interviews -- lower the INT_003 threshold mentally
- Consider adding `[ambient sound]` events for B-roll segments

### Narrative Film

- Match speaker colors to character arcs (antagonist in red, protagonist in blue is a common but effective choice)
- Pay special attention to whispered dialogue -- this is where CWI adds the most value over flat SRT
- Dramatic monologues should show wide weight/size variance
- Review sarcasm detection carefully in comedic films

### Music Video / Performance

- One speaker per performer; background vocals can share a muted color
- Word-level sync is critical -- verify SYN_001 and SYN_002 scores are perfect
- Volume mapping (size) should reflect the dynamic range of the performance
- Consider disabling the FCC_001 gap warning for instrumental breaks

### Explainer / Tutorial

- Typically single-speaker -- one color throughout
- Emphasis words (`emphasis: true`) should align with on-screen visual cues
- Lower quality gate to 70 -- tutorials have naturally lower intonation variance
- WebVTT fallback is often sufficient for this genre

## Working with the Intent Extractor

The V1 intent extractor uses audio analysis (pitch/volume via parselmouth) and vision (face emotion via keyframes). For best results:

1. **Clean audio** -- background music and noise degrade pitch extraction. Pre-process with noise reduction if needed.
2. **Face visibility** -- the vision model needs clear face shots for emotion detection. B-roll with no faces will produce `neutral` emotion with low confidence.
3. **Language support** -- Whisper supports 97 languages, but the semantic layer (sarcasm, emphasis) works best in English. For other languages, expect lower semantic accuracy and rely more on vocal signals.

## Edge Cases

- **Overlapping speakers**: The diarization backend handles turn-taking but cannot separate truly simultaneous speech. If two people talk at once, the louder voice wins and the other is dropped. Flag this for manual annotation.
- **Non-speech audio**: Music, sound effects, and ambient noise are not captioned by default. Use the `annotate` command to add `[music]`, `[applause]`, etc.
- **Very short clips (< 5s)**: The pipeline needs enough audio to establish a speaker baseline. Clips under 5 seconds may produce unreliable weight/size mappings.
