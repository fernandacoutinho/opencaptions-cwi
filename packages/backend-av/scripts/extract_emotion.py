#!/usr/bin/env python3
"""
Facial emotion extraction from video keyframes.

Input:  --input <video_path>, stdin receives JSON array of utterance windows:
        [{"id": "utt_0", "start": 0.0, "end": 2.5}, ...]
Output: JSON to stdout mapping utterance ID to EmotionFeatures:
{
  "utt_0": {
    "valence": 0.2,
    "arousal": 0.6,
    "dominant_emotion": "joy",
    "confidence": 0.85
  },
  ...
}
"""

import argparse
import json
import sys
import subprocess
import tempfile
import os
import numpy as np


# Emotion to valence/arousal mapping (Russell's circumplex model)
EMOTION_VA = {
    "happy":    {"valence":  0.8, "arousal": 0.6},
    "sad":      {"valence": -0.7, "arousal": -0.3},
    "angry":    {"valence": -0.6, "arousal": 0.8},
    "fear":     {"valence": -0.8, "arousal": 0.7},
    "surprise": {"valence":  0.1, "arousal": 0.8},
    "disgust":  {"valence": -0.7, "arousal": 0.3},
    "neutral":  {"valence":  0.0, "arousal": 0.0},
}

# Map FER emotion names to our Emotion type
EMOTION_MAP = {
    "happy": "joy",
    "sad": "sadness",
    "angry": "anger",
    "fear": "fear",
    "surprise": "surprise",
    "disgust": "disgust",
    "neutral": "neutral",
}


def extract_keyframe(video_path: str, time_sec: float) -> "np.ndarray | None":
    """Extract a single frame from video at given time."""
    try:
        import cv2
    except ImportError:
        return None

    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, time_sec * 1000)
    ret, frame = cap.read()
    cap.release()

    return frame if ret else None


def analyze_emotion_fer(frame: "np.ndarray") -> dict | None:
    """Analyze facial emotion using FER (Facial Expression Recognition)."""
    try:
        from fer import FER
    except ImportError:
        return None

    detector = FER(mtcnn=True)
    emotions = detector.detect_emotions(frame)

    if not emotions:
        return None

    # Take the dominant face (largest bounding box)
    face = max(emotions, key=lambda e: e["box"][2] * e["box"][3])
    scores = face["emotions"]

    # Find dominant emotion
    dominant = max(scores, key=scores.get)
    confidence = scores[dominant]

    # Map to valence/arousal
    va = EMOTION_VA.get(dominant, EMOTION_VA["neutral"])

    return {
        "valence": va["valence"],
        "arousal": va["arousal"],
        "dominant_emotion": EMOTION_MAP.get(dominant, "neutral"),
        "confidence": round(confidence, 4),
        "all_scores": scores,
    }


def analyze_emotion_simple(video_path: str, start: float, end: float) -> dict:
    """
    Fallback: simple motion-based arousal estimation.
    More motion = higher arousal. No face detection needed.
    """
    try:
        import cv2
    except ImportError:
        return {
            "valence": 0.0,
            "arousal": 0.3,
            "dominant_emotion": "neutral",
            "confidence": 0.1,
        }

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25

    # Sample 3 frames from the utterance
    times = [start, (start + end) / 2, end]
    frames = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if ret:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            frames.append(gray.astype(float))

    cap.release()

    if len(frames) < 2:
        return {
            "valence": 0.0,
            "arousal": 0.3,
            "dominant_emotion": "neutral",
            "confidence": 0.1,
        }

    # Compute frame differences (motion = arousal proxy)
    diffs = []
    for i in range(1, len(frames)):
        diff = np.mean(np.abs(frames[i] - frames[i - 1]))
        diffs.append(diff)

    motion = np.mean(diffs)

    # Normalize motion to 0-1 (typical range: 0-50 pixel difference)
    arousal = min(1.0, motion / 30.0)

    return {
        "valence": 0.0,  # Can't determine valence from motion alone
        "arousal": round(float(arousal), 4),
        "dominant_emotion": "neutral",
        "confidence": 0.2,  # Low confidence for motion-only
    }


def main():
    parser = argparse.ArgumentParser(description="Extract facial emotion")
    parser.add_argument("--input", required=True, help="Path to video file")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Read utterance windows from stdin
    utterances = json.loads(sys.stdin.read())

    # Check if FER is available
    use_fer = True
    try:
        from fer import FER
        import cv2
    except ImportError:
        use_fer = False
        print("FER/OpenCV not available, using motion-based fallback", file=sys.stderr)

    result = {}

    for utt in utterances:
        uid = utt["id"]
        start = utt["start"]
        end = utt["end"]
        midpoint = (start + end) / 2

        if use_fer:
            # Extract keyframe at midpoint
            frame = extract_keyframe(args.input, midpoint)

            if frame is not None:
                emotion = analyze_emotion_fer(frame)
                if emotion is not None:
                    result[uid] = {
                        "valence": emotion["valence"],
                        "arousal": emotion["arousal"],
                        "dominant_emotion": emotion["dominant_emotion"],
                        "confidence": emotion["confidence"],
                    }
                    continue

            # FER detected no face — fall back to motion
            emotion = analyze_emotion_simple(args.input, start, end)
            result[uid] = emotion
        else:
            # Motion-based fallback
            result[uid] = analyze_emotion_simple(args.input, start, end)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
