#!/usr/bin/env python3
"""MinuteSmith local faster-whisper transcription runner.

Prints JSON to stdout and human-readable errors to stderr. It never calls a hosted
transcription API; faster-whisper may download the requested model from the local
Hugging Face cache or the internet according to faster-whisper/CTranslate2 rules.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe audio locally with faster-whisper")
    parser.add_argument("--audio-path", required=True, help="Path to the local audio file")
    parser.add_argument("--model", required=True, help="faster-whisper model name or local model directory")
    parser.add_argument("--language", default=None, help="Optional language code, for example en")
    parser.add_argument(
        "--output-format",
        default="json",
        choices=["json"],
        help="Output format. MinuteSmith currently supports json only.",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("MINUTESMITH_FASTER_WHISPER_DEVICE", "auto"),
        help="CTranslate2 device: auto, cpu, cuda, etc.",
    )
    parser.add_argument(
        "--compute-type",
        default=os.environ.get("MINUTESMITH_FASTER_WHISPER_COMPUTE_TYPE", "default"),
        help="CTranslate2 compute type, for example default, int8, float16.",
    )
    return parser.parse_args()


def fail(message: str, exit_code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(exit_code)


def confidence_from_segment(segment: Any) -> float | None:
    avg_logprob = getattr(segment, "avg_logprob", None)
    if avg_logprob is None:
        return None

    try:
        confidence = math.exp(float(avg_logprob))
    except (TypeError, ValueError, OverflowError):
        return None

    return round(max(0.0, min(1.0, confidence)), 4)


def main() -> int:
    args = parse_args()
    audio_path = Path(args.audio_path).expanduser()

    if not audio_path.exists() or not audio_path.is_file():
        fail(f"Invalid audio file: {audio_path} does not exist or is not a file")
    if audio_path.stat().st_size == 0:
        fail(f"Invalid audio file: {audio_path} is empty")

    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError:
        fail(
            "faster-whisper is not installed in the selected Python environment. "
            "Install it with: python -m pip install faster-whisper"
        )

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    except Exception as error:  # noqa: BLE001 - surface model/cache/download failures to the app
        fail(
            "Model download/load unavailable for faster-whisper model "
            f"'{args.model}': {error}"
        )

    try:
        segments_iter, _info = model.transcribe(
            str(audio_path),
            language=args.language or None,
            vad_filter=False,
        )
        segments = list(segments_iter)
    except Exception as error:  # noqa: BLE001 - decoder raises varied exceptions for bad media
        fail(f"Invalid audio file or unsupported media for faster-whisper: {error}")

    payload: dict[str, Any] = {
        "provider": "faster-whisper",
        "model": args.model,
        "segments": [],
    }

    for segment in segments:
        text = getattr(segment, "text", "").strip()
        if not text:
            continue

        payload["segments"].append(
            {
                "speakerLabel": "Unknown",
                "startMs": int(round(float(segment.start) * 1000)),
                "endMs": int(round(float(segment.end) * 1000)),
                "text": text,
                "confidence": confidence_from_segment(segment),
                "metadata": {},
            }
        )

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
