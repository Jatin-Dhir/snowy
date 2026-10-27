# Turns the music bed into the 48 kHz 16-bit stereo WAV the mixer reads, with Blender's own
# audio library (this machine has no ffmpeg):
#
#   blender -b -P store/promo/music/to_wav.py
import os

import aud

here = os.path.dirname(os.path.abspath(__file__))
for name in ["v1"]:
    s = aud.Sound(os.path.join(here, name + ".m4a")).resample(48000, False)
    s.write(
        os.path.join(here, name + ".wav"),
        rate=48000,
        channels=aud.CHANNELS_STEREO,
        format=aud.FORMAT_S16,
        container=aud.CONTAINER_WAV,
        codec=aud.CODEC_PCM,
    )
    print(name, "ok", s.specs, s.length)
