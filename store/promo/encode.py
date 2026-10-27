# Encodes the rendered frames and the soundtrack into the final MP4, with Blender's sequencer
# (this machine has no ffmpeg; Blender carries its own).
#
#   blender -b -P store/promo/encode.py -- <frames dir> <mix.wav> <out.mp4> <width> <height>
#
# The frames are drawn at twice the size; the sequencer shrinks them with a box filter, so every
# pixel of the film is the average of four. H.264 at Blender's "perceptually lossless" quality
# (CRF 17), a keyframe every second, 60 fps; AAC at 256 kb/s.
import os
import sys

import bpy

frames_dir, audio, out, width, height = sys.argv[sys.argv.index("--") + 1 :]
width, height = int(width), int(height)
# Blender reads a relative output path against its own idea of the current folder, not ours
frames_dir, audio, out = (os.path.abspath(p) for p in (frames_dir, audio, out))

scene = bpy.context.scene
scene.render.fps = 60
scene.render.fps_base = 1
scene.render.resolution_x = width
scene.render.resolution_y = height
scene.render.resolution_percentage = 100
# straight sRGB in, straight sRGB out: no film-look transform on the app's colours
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.sequencer_colorspace_settings.name = "sRGB"

files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
se = scene.sequence_editor_create()
# every frame is read once, in order: caching 4K frames only eats memory
bpy.context.preferences.system.memory_cache_limit = 1024
for cache in ("use_cache_raw", "use_cache_preprocessed", "use_cache_composite", "use_cache_final"):
    if hasattr(se, cache):
        setattr(se, cache, False)
# One single-frame strip per frame. A strip grown with elements.append() keeps uninitialised
# orig_width/orig_height on every appended element (read-only from Python), and Blender 5.2 then
# allocates a buffer of that garbage size and crashes; new_image() initialises its element.
for i, f in enumerate(files):
    strip = se.strips.new_image(name=f"f{i:04d}", filepath=os.path.join(frames_dir, f), channel=1, frame_start=i + 1, fit_method="FIT")
    strip.frame_final_end = i + 2
    strip.colorspace_settings.name = "sRGB"
    if i == 0:
        filters = {e.identifier for e in strip.transform.bl_rna.properties["filter"].enum_items}
        filt = "BOX" if "BOX" in filters else "CUBIC_MITCHELL"
    strip.transform.filter = filt

sound = se.strips.new_sound(name="mix", filepath=audio, channel=2, frame_start=1)
scene.frame_start = 1
scene.frame_end = len(files)

r = scene.render
# Blender 5 files video under its own media type
if hasattr(r.image_settings, "media_type"):
    r.image_settings.media_type = "VIDEO"
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "PERC_LOSSLESS"
r.ffmpeg.ffmpeg_preset = "GOOD"
r.ffmpeg.gopsize = 60
r.ffmpeg.audio_codec = "AAC"
r.ffmpeg.audio_bitrate = 256
r.ffmpeg.audio_mixrate = 48000
r.ffmpeg.audio_channels = "STEREO"
r.use_file_extension = False
r.filepath = out

print(f"encoding {len(files)} frames ({filt}) + {os.path.basename(audio)} -> {out}", flush=True)
bpy.ops.render.render(animation=True)
print("encoded", out, os.path.getsize(out), "bytes")
