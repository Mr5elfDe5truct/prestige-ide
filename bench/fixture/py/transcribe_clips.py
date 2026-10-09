"""Cutting a diarized recording into clips for speech-to-text.

From the Custom AI Workstation's tools/transcribe.py: Nemotron 3 Diarization says who spoke when, and each speaker's
stretch is cut at its pauses into clips of at most CLIP_S seconds, which Phonon-2 transcribes one at a time.
"""
import re

CLIP_S = 18.0  # longest clip sent to Phonon-2 in one go
MIN_CLIP_S = 0.3


def parse_silence(ffmpeg_stderr):
    """Mid-points of the pauses ffmpeg's silencedetect reported, where a long stretch can be cut without splitting a word."""
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", ffmpeg_stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", ffmpeg_stderr)]
    return [(s + e) / 2 for s, e in zip(starts, ends)]


def clips(segs, cuts, total):
    """Each speaker stretch as clips of at most CLIP_S seconds, cut at pauses (or hard at CLIP_S when there's none).

    segs: [{"start": s, "end": e, "speaker": n}, ...]; cuts: pause mid-points in seconds; total: the recording's length.
    Returns [(start, end, speaker), ...].
    """
    out = []
    for s in segs:
        a, end = max(0.0, s["start"] - 0.15), min(total, s["end"] + 0.15)
        while end - a > CLIP_S:
            inside = [c for c in cuts if a + 4 < c < a + CLIP_S]
            b = inside[-1] if inside else a + CLIP_S - 2
            out.append((a, b, s["speaker"]))
            a = b
        if end - a >= MIN_CLIP_S:
            out.append((a, end, s["speaker"]))
    return out
