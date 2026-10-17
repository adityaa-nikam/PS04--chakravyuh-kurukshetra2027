"""Offline speech only: one model load, exact validated narration, one WAV per scene."""
import json
import sys
import wave
from piper import PiperVoice

with open(sys.argv[1], encoding="utf-8") as source:
    job = json.load(source)
voice = PiperVoice.load(job["model"])
for scene in job["scenes"]:
    with wave.open(scene["output"], "wb") as audio:
        voice.synthesize_wav(scene["text"], audio)
