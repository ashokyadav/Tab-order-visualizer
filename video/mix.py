"""Builds the soundtrack and captions for the demo video.

    python3 video/mix.py        (after make_voice.py and record.mjs)

Everything here is generated from code: the music is composed below, so there is
nothing to license. Writes video/raw/mix.wav and video/tab-order-visualizer-demo.srt
"""
import json, os, textwrap, wave
import numpy as np
from scipy.signal import butter, sosfilt, resample_poly

here = os.path.dirname(os.path.abspath(__file__))
SR = 48000
tl = json.load(open(os.path.join(here, 'raw/timeline.json')))
marks, stops = tl['marks'], tl['stops']
lines = {l['id']: l['text'] for l in json.load(open(os.path.join(here, 'narration.json')))}
length = marks['finish'] + 0.6
N = int(length * SR)
t = np.arange(N) / SR

def db(x): return 10 ** (x / 20)
def lowpass(x, hz, order=2): return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x)
def highpass(x, hz, order=2): return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x)
def place(buf, clip, at):
    i = int(at * SR); j = min(len(buf), i + len(clip))
    if j > i: buf[i:j] += clip[: j - i]

# ------------------------------------------------------------- music
BPM = 84; beat = 60 / BPM; bar = 4 * beat
mid = lambda n: 440 * 2 ** ((n - 69) / 12)
chords = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60, 64], [48, 52, 55, 59]]   # Fmaj7 Am7 Dm9 Cmaj7
roots = [41, 45, 38, 36]
pad = np.zeros(N); bass = np.zeros(N); arp = np.zeros(N)
rng = np.random.default_rng(3)
nbars = int(np.ceil(length / bar)) + 1
for b in range(nbars):
    start = b * bar; ch = chords[b % 4]
    seg_n = int((bar + 1.5) * SR); st = np.arange(seg_n) / SR
    env = np.minimum(1, st / 0.9) * np.exp(-np.maximum(0, st - bar) / 0.5)          # slow swell, soft tail
    tone = np.zeros(seg_n)
    for n in ch:
        f = mid(n + 12)
        for k, a in ((1, 1), (2, .28), (3, .1)):
            for det in (-0.12, 0.12):                                                  # gentle chorus
                tone += a * np.sin(2 * np.pi * (f * k + det * k) * st + rng.uniform(0, 6.28))
    place(pad, tone * env / len(ch), start)
    bn = int(bar * SR); bt = np.arange(bn) / SR
    place(bass, np.sin(2 * np.pi * mid(roots[b % 4]) * bt) * np.exp(-bt / 1.6) * np.minimum(1, bt / 0.02), start)
    for e in range(8):                                                                 # soft eighth-note pluck
        n = ch[[0, 2, 1, 3, 2, 0, 3, 1][e] % len(ch)] + 24
        pn = int(0.6 * SR); pt = np.arange(pn) / SR
        pl = (np.sin(2 * np.pi * mid(n) * pt) + .3 * np.sin(4 * np.pi * mid(n) * pt)) * np.exp(-pt / 0.18) * np.minimum(1, pt / 0.004)
        place(arp, pl * (0.8 if e % 2 else 1.0), start + e * beat / 2)
music = lowpass(pad, 1800) * 0.55 + lowpass(bass, 220) * 0.6 + lowpass(arp, 3000) * 0.18
music /= np.abs(music).max()
fade = np.minimum(1, t / 1.5) * np.minimum(1, (length - t) / 2.5)
music *= fade

# ------------------------------------------------------------- narration
voice = np.zeros(N); spans = []; captions = []
starts = {'intro': marks['intro'] + 0.4, 'broken_open': marks['broken'] + 0.6, 'broken_play': marks['play1'] + 0.3,
          'findings': marks['findings'] + 0.2, 'fixed_card': marks['fixed_card'] + 0.3,
          'fixed': marks['fixed_scanned'] + 0.3, 'end': marks['end'] + 0.6}
for lid, at in starts.items():
    with wave.open(os.path.join(here, 'audio', f'{lid}.wav')) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
        if w.getnchannels() == 2: x = x.reshape(-1, 2).mean(1)
    if sr != SR:
        from math import gcd
        g = gcd(SR, sr); x = resample_poly(x, SR // g, sr // g)
    x = highpass(x, 85)
    x = x / (np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2)) + 1e-9) * db(-17)            # even level across lines
    place(voice, x, at)
    spans.append((at, at + len(x) / SR)); captions.append((lid, at, at + len(x) / SR))
voice = np.tanh(voice * 1.2) / 1.2                                                     # gentle peak control

# ------------------------------------------------------------- tab-stop ticks
fx = np.zeros(N)
def tone(freqs, dur, decay, level):
    n = int(dur * SR); st = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * st) for f in freqs) / len(freqs)
    return x * np.exp(-st / decay) * np.minimum(1, st / 0.002) * db(level)
tick = tone([2100, 3150], 0.05, 0.012, -30)
warn = tone([660], 0.12, 0.04, -30)
err = np.concatenate([tone([392], 0.07, 0.03, -27), tone([294], 0.11, 0.04, -27)])
for s in stops:
    place(fx, {'ok': tick, 'info': tick, 'warn': warn, 'error': err}[s['sev']], s['t'])

# ------------------------------------------------------------- duck music under the voice
duck = np.ones(N)
for a, b in spans:
    duck[int(max(0, a - 0.25) * SR): int(min(length, b + 0.35) * SR)] = db(-9)
k = int(0.25 * SR); duck = np.convolve(duck, np.ones(k) / k, 'same')               # smooth 250 ms ramps
mix = voice + music * db(-18) * duck + fx
mix /= max(1.0, np.abs(mix).max() / db(-1.5))
stereo = np.stack([mix, mix], 1)
# a touch of width on the music only
stereo[:, 0] += np.roll(music * db(-18) * duck, 240) * 0.15
stereo[:, 1] -= np.roll(music * db(-18) * duck, 240) * 0.15
pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
with wave.open(os.path.join(here, 'raw/mix.wav'), 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# ------------------------------------------------------------- captions (SRT)
def ts(s):
    ms = int(round(s * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); sec, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{sec:02},{ms:03}'
cues = []
for lid, a, b in captions:
    sentences = [s.strip() for s in lines[lid].replace('? ', '?|').replace('. ', '.|').split('|') if s.strip()]
    total = sum(len(s) for s in sentences); cur = a
    for s in sentences:
        span = (b - a) * len(s) / total
        wrapped = textwrap.wrap(s, 42)
        for i in range(0, len(wrapped), 2):
            part = wrapped[i:i + 2]; frac = sum(len(p) for p in part) / max(1, len(s))
            cues.append((cur, cur + span * frac, '\n'.join(part))); cur += span * frac
srt = '\n'.join(f'{i}\n{ts(a)} --> {ts(min(b, length))}\n{txt}\n' for i, (a, b, txt) in enumerate(cues, 1))
open(os.path.join(here, 'tab-order-visualizer-demo.srt'), 'w').write(srt)
print(f'mix: {length:.1f}s, {len(stops)} ticks, {len(cues)} caption cues')
