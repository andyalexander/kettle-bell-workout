# PROTOTYPE — sound test (issue #33)

**Throwaway.** Answers one question: **which way of making a sound is audible on the
iPhone, at the moment a workout needs it?** That moment is seconds after the tap that
unlocked audio, not inside it. No build, no framework, nothing touches the Pi. This
branch, `prototype/sound-test`, is its permanent home.

## Run it

```sh
python3 prototypes/sound-test/serve.py
```

Then on the iPhone, on the same Wi-Fi: `http://<your-mac's-LAN-IP>:8000/`. Find the IP
with `ipconfig getifaddr en0`. The Mac's full-tunnel VPN may need to be off.

Every tap is logged with the `AudioContext`'s state, on screen and in `results.log`
beside `serve.py`. So the only thing to report is what you **heard**: tap **Heard it**
or **Silence** after each sound.

## The suspects, and the buttons that tell them apart

| Suspect | What the buttons show |
| --- | --- |
| **Unlock:** `resume()` alone leaves iOS silent | U1 then B2 vs U2 then B2 |
| **Wrong event:** the workout screen unlocks on `pointerdown`, which is not a user gesture for touch | U3 then B1 |
| **Interrupted:** after a lock the context is `interrupted` and `beep()` skips it | lock, unlock, B1 |
| **Audio session:** ambient is muted by the Silent switch | S buttons, then B2, with Silent on and off |
| **The video fallback** takes the audio session | V on, then A1 |
| **Web Audio at all** | B5 / B6, a plain `<audio>` element |

## The script

Ring/Silent switch **off** (ringer on), volume up. Tap *Heard it* / *Silence* after each.

1. **A1**: exactly what the app does. Silence reproduces the bug.
2. Reload. **U1**, then **B2**. Then **B3**.
3. Reload. **U2**, then **B2**.
4. Reload. **U3**, then **B1**.
5. **B5**, then **B6**.
6. Each **S** button in turn, then **B2**. Repeat with the Silent switch **on**.
   Leave music playing in another app for **playback**: does it stop?
7. **V** on, then **A1**.
8. Lock the phone for 10 s, unlock, **B1**. Then **U1**, **B1**.
9. Add it to the Home Screen and repeat 1–3. The real failure was there.
