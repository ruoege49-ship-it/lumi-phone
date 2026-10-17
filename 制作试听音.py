"""Create a short original synthesized sample track, 24 seconds, mono PCM."""
from pathlib import Path
import math
import struct
import wave

rate, seconds = 22050, 24
notes = [60, 64, 67, 72, 69, 67, 64, 62, 60, 64, 67, 71, 69, 67, 65, 64]
events = [(i * 1.35, 440 * 2 ** ((note - 69) / 12)) for i, note in enumerate(notes)]
target = Path(__file__).parent / 'dist/assets/afternoon.wav'
with wave.open(str(target), 'wb') as output:
    output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    frames = bytearray()
    for i in range(rate * seconds):
        t = i / rate
        signal = 0
        for onset, frequency in events:
            age = t - onset
            if 0 <= age <= 4:
                envelope = (1 - math.exp(-age * 28)) * math.exp(-age * 1.2)
                signal += envelope * (math.sin(2 * math.pi * frequency * age) + .2 * math.sin(2 * math.pi * frequency * 2 * age)) * .19
        fade = min(1, t / .5, max(0, (seconds - t) / 2))
        frames.extend(struct.pack('<h', int(max(-.85, min(.85, signal * fade)) * 32767)))
    output.writeframes(frames)
print(f'Created {target.name}: {seconds}s, {target.stat().st_size} bytes')
