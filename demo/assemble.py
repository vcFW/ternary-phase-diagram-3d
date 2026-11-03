#!/usr/bin/env python3
"""帧序列 → 分段 → 转场拼接 → 配乐 → 1080p MP4"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(ROOT, "frames")
SEG = os.path.join(ROOT, "segments")
MUSIC = os.path.join(ROOT, "music", "voxel_revolution.mp3")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "三元相图_发布会演示视频_1080p.mp4")
os.makedirs(SEG, exist_ok=True)

ORDER = ["intro", "s1_workspace", "s2_linear", "s3_rules", "s4_thermo", "s5_lp", "s6_path", "s7_lab", "s8_live", "stats", "outro"]
# (转场类型, 时长) —— 位于 ORDER[k] 与 ORDER[k+1] 之间
TRANS = [("fade", 0.8), ("smoothleft", 0.6), ("smoothleft", 0.6), ("fade", 0.5), ("smoothleft", 0.6), ("fade", 0.5),
         ("smoothleft", 0.6), ("fade", 0.5), ("fade", 0.8), ("fade", 0.7)]
assert len(TRANS) == len(ORDER) - 1


def run(cmd):
    print(" ".join(cmd[:6]), "...")
    subprocess.run(cmd, check=True)


def dur(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
    return float(out)


segs = []
for name in ORDER:
    path = os.path.join(SEG, name + ".mp4")
    run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", os.path.join(FR, name, "%05d.jpg"),
         "-vf", "scale=1920:1080:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "12",
         "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-r", "30", path])
    segs.append(path)

durs = [dur(s) for s in segs]
total = sum(durs) - sum(t[1] for t in TRANS)
print("segment durations", [round(d, 2) for d in durs], "total", round(total, 2))

inputs = []
for s in segs:
    inputs += ["-i", s]
inputs += ["-i", MUSIC]

filt = []
prev = "[0:v]"
acc = durs[0]
for k, (kind, td) in enumerate(TRANS):
    offset = acc - td
    label = f"[v{k}]"
    filt.append(f"{prev}[{k + 1}:v]xfade=transition={kind}:duration={td}:offset={offset:.3f}{label}")
    prev = label
    acc = offset + durs[k + 1]
filt.append(f"{prev}scale=out_range=tv,format=yuv420p[vout]")
mi = len(segs)
filt.append(
    f"[{mi}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.2,"
    f"afade=t=out:st={total - 3.5:.3f}:d=3.5,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[aout]"
)

run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[vout]", "-map", "[aout]",
     "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-profile:v", "high", "-level", "4.2", "-r", "30",
     "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
     "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-t", f"{total:.3f}", OUT])
print("written", OUT, round(dur(OUT), 2), "s")
