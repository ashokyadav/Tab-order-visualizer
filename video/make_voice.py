"""Synthesizes the narration with Piper (MIT) and the LibriTTS 'high' voice (CC BY 4.0).

    PIPER=/path/to/piper VOICE=/path/to/en-us-libritts-high.onnx python3 video/make_voice.py

Writes video/audio/<id>.wav and video/audio/durations.json. To use your own voice instead,
record each line from narration.json as video/audio/<id>.wav and run with OWN_VOICE=1.
"""
import json, os, subprocess, wave
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, 'audio'); os.makedirs(out, exist_ok=True)
lines = json.load(open(os.path.join(here, 'narration.json')))
durations = {}
for line in lines:
    wav = os.path.join(out, f"{line['id']}.wav")
    if not os.environ.get('OWN_VOICE'):
        subprocess.run([os.environ['PIPER'], '-m', os.environ['VOICE'], '-s', os.environ.get('SPEAKER', '88'),
                        '--length_scale', '1.04', '--sentence_silence', '0.25', '-f', wav],
                       input=line['text'].encode(), check=True, capture_output=True)
    with wave.open(wav) as w:
        durations[line['id']] = round(w.getnframes() / w.getframerate(), 3)
json.dump(durations, open(os.path.join(out, 'durations.json'), 'w'), indent=2)
print(json.dumps(durations, indent=2))
