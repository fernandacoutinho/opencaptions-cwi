# TRIBE v2 ROI Extraction for OpenCaptions

Predicts brain activations from video using Meta's TRIBE v2, then extracts
6 region-of-interest (ROI) scalars that drive CWI caption styling.

## Brain ROIs → CWI Parameters

| ROI | Brain Region | CWI Parameter |
|-----|-------------|---------------|
| `amygdala_activation` | Amygdala-adjacent cortex | **size** (emotional intensity) |
| `right_temporal_activation` | Right temporal cortex | **weight** (prosody processing) |
| `broca_activation` | Broca's area | **emphasis** (syntactic load) |
| `insula_activation` | Insular cortex | **animation speed** (visceral response) |
| `dmn_suppression` | Default Mode Network | **emphasis** (engagement spikes) |
| `ffa_activation` | Fusiform Face Area | **attribution timing** (face salience) |

## Usage

```bash
# With GPU + TRIBE v2 installed
python3 extract_roi.py --input film.mp4 --output roi.json

# With utterance timestamps from the pipeline
python3 extract_roi.py --input film.mp4 --utterances utterances.json --output roi.json

# Mock mode (no GPU needed, for testing)
python3 extract_roi.py --input film.mp4 --mock --output roi.json
```

## Setup

```bash
# Option 1: pip install
pip install tribev2 torch torchvision torchaudio

# Option 2: clone from source
git clone https://github.com/facebookresearch/tribev2
cd tribev2 && pip install -e .
```

Weights download automatically from HuggingFace on first use (~several GB).

## Output Format

```json
{
  "version": "1.0",
  "model": "tribev2",
  "video": "film.mp4",
  "total_inference_ms": 12345.6,
  "activations": [
    {
      "utterance_id": "utt_0",
      "start": 0.0,
      "end": 2.5,
      "neural_prediction": {
        "amygdala_activation": 0.42,
        "right_temporal_activation": 0.65,
        "broca_activation": 0.31,
        "insula_activation": 0.28,
        "dmn_suppression": 0.71,
        "ffa_activation": 0.55
      },
      "inference_ms": 1234.5
    }
  ]
}
```

## Resources

- TRIBE v2 paper: https://arxiv.org/abs/2507.22229
- GitHub: https://github.com/facebookresearch/tribev2
- HuggingFace: https://huggingface.co/facebook/tribev2
- Interactive demo: https://aidemos.atmeta.com/tribev2
- License: CC BY-NC (non-commercial)
