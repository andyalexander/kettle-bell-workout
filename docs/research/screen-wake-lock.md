# Keeping the iPhone screen awake from a Home Screen web app

Research for issue #32. Question: can a Home Screen web app, served by the add-on over
plain HTTP on the LAN (`http://homeassistant.local:8234/`), keep an iPhone on
**iOS 26.6.1** from dimming and auto-locking during a workout, without setting
Auto-Lock to Never globally?

Researched 2026-09-11 against WebKit source (`main` and the `safari-7624.5.1.11`
release branch), WebKit Bugzilla, webkit.org, Apple Support / developer docs and W3C
specs. Anything not stated by a source is marked **unconfirmed**.

## Answer in brief

- **Yes, there is a supported mechanism: the Screen Wake Lock API.** It works in Home
  Screen web apps from iOS 18.4, so on 26.6.1 too. But it is only exposed in a
  **secure context**, and `http://homeassistant.local` / `http://192.168.x.x` is not
  one. On our current plain-HTTP setup the API is absent. That is a hard rule in the
  spec and in WebKit's code, not a bug.
- **Our video fallback cannot work, by WebKit's own design.** WebKit only holds the
  display awake for a media element that is playing, **not looping**, and **has audible
  audio (not muted, with an audio track)**. That rule has been in place since 2012 and is
  still in the shipping 26.x branch. Our video is muted, looping, and has no audio
  track, so it fails on all three counts. NoSleep.js differs: its video has an audio
  track, is not muted, and does not use `loop`.
- **Ranked fix:** (1) serve the add-on over HTTPS with a certificate the phone trusts
  (local CA via mkcert, or Let's Encrypt DNS-01), which turns on native Wake Lock;
  (2) in the meantime, use **Guided Access** with its own per-session Display
  Auto-Lock. A NoSleep-faithful video is possible on HTTP but unverified on device and
  has side effects.

---

## 1. Screen Wake Lock API on iOS / iPadOS WebKit

**Shipped in Safari 16.4 (iOS/iPadOS 16.4).** The WebKit Safari 16.4 post lists it:
"The Screen Wake Lock API provides a mechanism to prevent devices from dimming or
locking the screen." ([WebKit, Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)).
The enabling change is WebKit bug
[245884 "[WK2] Turn on the Screen Wake Lock API support"](https://bugs.webkit.org/show_bug.cgi?id=245884).
caniuse (secondary) agrees: iOS Safari "16.4 – 26.6: Supported"
([caniuse](https://caniuse.com/wake-lock)).

**Broken in Home Screen web apps until iOS 18.4.** The bug is
[WebKit 254545 "New Wake Lock API does not work in Home Screen Web Apps"](https://bugs.webkit.org/show_bug.cgi?id=254545),
filed 2023-03-27 (also reported against NoSleep.js as
[issue #156](https://github.com/richtr/NoSleep.js/issues/156)). Chris Dumez gave the
root cause in comment 10: "We rely on `[UIApplication sharedApplication].idleTimerDisabled = YES;`
This likely doesn't work in Home Screen Web Apps because they are not UIApplications
but ViewServices." The fix,
[PR #13179](https://github.com/WebKit/WebKit/pull/13179), was committed as 263419@main
in April 2023 and routes the request to the host app through a UIDelegate SPI. It did
not reach users until two years later. Jen Simmons in comment 65, 2025-03-31: "The
Screen Wake Lock API now works in Home Screen Web Apps on iOS and iPadOS 18.4 — which
just shipped today." The Safari 18.4 notes confirm it: "The Screen Wake Lock API now
also works in Home Screen Web Apps on iOS and iPadOS 18.4" and "Fixed Screen Wake Lock
API for Home Screen Web Apps. (108573133)"
([WebKit, Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)).

**iOS 26.6.1.** The Safari 26.4, 26.5 and 26.6 posts do not mention Wake Lock at all
([26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/),
[26.5](https://webkit.org/blog/17938/webkit-features-for-safari-26-5/),
[26.6](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/)). I found no
WebKit bug reporting a regression. The fix is still in the code: on the
`safari-7624.5.1.11` release branch, `SleepDisablerIOS.mm` still calls the web-app
handler (`m_screenWakeLockHandler`) before falling back to
`_setIdleTimerDisabled`. **Conclusion:** Wake Lock should work in a 26.6.1 Home Screen
web app, provided the page is a secure context.
**Unconfirmed:** which exact Safari version each `safari-7624.*` branch ships as. Safari
26.4 is reported as build 20624.1.16 (secondary:
[9to5Mac](https://9to5mac.com/2026/03/24/apple-details-safari-26-4-with-44-new-features-191-bug-fixes-more/)),
so the 7624 branches are the 26.4+ line. I have not verified on a device.

**Chrome / Firefox / Edge on iOS.** App Review Guideline 2.5.6: "Apps that browse the
web must use the appropriate WebKit framework and WebKit JavaScript", with
alternative-engine entitlements only "for the EU and Japan"
([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
So they get WebKit's implementation. PR #13179 keeps the old `UIApplication`
idle-timer path for any host that does not implement the new delegate, and a browser
app is a real UIApplication. **Unconfirmed:** actual behaviour in each third-party
browser. In any case, this does not matter for a Home Screen web app.

**Known limitations (spec + WebKit source):**

- `[SecureContext]` in both the spec IDL
  ([W3C Screen Wake Lock](https://w3c.github.io/screen-wake-lock/)) and WebKit's
  [`WakeLock.idl`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/screen-wake-lock/WakeLock.idl).
- **WebKit requires a user gesture for the first request.** Commit
  [d901ad78bd (bug 255363)](https://github.com/WebKit/WebKit/commit/d901ad78bdb6536b4c0bdcbf85b1c1e40b8bdfc4)
  says: "Unlike other browser engines, WebKit requires a transient activation to
  acquire a screen wake lock … If the page has previously acquired a screen wake lock
  with transient activation, we will remember this permission for the lifetime of the
  document." In
  [`WakeLock.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/screen-wake-lock/WakeLock.cpp)
  (the same on `safari-7624.5.1.11`), a request without transient activation and
  without earlier sticky authorisation is rejected with "Permission was denied".
  Transient activation lasts `defaultTransientActivationDuration { 5_s }`
  ([`LocalDOMWindow.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalDOMWindow.cpp)).
  The spec itself does not require activation.
- **Released when the page is hidden.** Spec: when visibility becomes hidden, "For each
  lock in document's active locks: run release a wake lock". `request()` rejects while
  hidden. Re-acquiring on `visibilitychange` works in WebKit thanks to the sticky
  authorisation above.
- **Permissions Policy** `screen-wake-lock`, default allowlist `'self'`: allowed in
  same-origin iframes, blocked in third-party ones (spec).
- **Battery / Low Power Mode.** The spec says a UA "may release a wake lock" when
  "battery is considered low and discharging" or "the user turns on some kind of device
  power conservation mode". Apple: in Low Power Mode, "Auto-Lock: defaults to 30
  seconds" ([Apple 101604](https://support.apple.com/en-us/101604)).
  **Unconfirmed:** whether iOS actually drops a web wake lock in Low Power Mode. I found
  no WebKit code that does. `SleepDisablerIOS.mm` has no power-mode check.

**Consequence for our code.** `useWorkoutTimer.ts` calls `keepScreenAwake()` from a
`useEffect` on mount, not from a click handler. Once HTTPS is on, that only succeeds if
the workout screen mounts within 5 s of the tap that started it. The robust fix is to
make the first `navigator.wakeLock.request("screen")` directly inside the Start button's
handler. Later re-acquisitions can stay in the `visibilitychange` listener.

## 2. Secure context on a LAN

**`http://homeassistant.local:8234` and `http://192.168.2.10:8234` are not secure
contexts.** The spec's "Is origin potentially trustworthy?" algorithm trusts
`https`/`wss`, `127.0.0.0/8`, `::1/128`, `localhost` / `*.localhost`, and `file`. It
does not list private address ranges or `.local` names
([W3C Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/)). WebKit's
implementation, `shouldTreatAsPotentiallyTrustworthy` in
[`SecurityOrigin.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/SecurityOrigin.cpp),
returns true only for a secure scheme, `isLocalHostOrLoopbackIPAddress(host)`
(loopback IP or localhost), a local scheme, or a scheme handled by an app's scheme
handler. A web page on a LAN has no exception. The spec lets "authorities" configure
origins as trustworthy for development (Chrome has a flag for this), but **I found no
equivalent setting in iOS Safari (unconfirmed either way)**.

**Ways to get a certificate iOS will trust:**

**(a) Private CA (mkcert) installed as a profile.** Apple's steps: install the
downloaded profile (installed profiles are listed under "Settings > General > VPN &
Device Management"
([iPhone User Guide](https://support.apple.com/guide/iphone/iph6c493b19/ios))), then
"Settings > General > About > Certificate Trust Settings" and "turn on trust for the
certificate" under "Enable full trust for root certificates"
([Apple 102390](https://support.apple.com/en-us/102390)). mkcert's README: "On iOS,
you can either use AirDrop, email the CA to yourself, or serve it from an HTTP server.
After opening it, you need to install the profile in Settings > Profile Downloaded and
then enable full trust in it" ([mkcert](https://github.com/FiloSottile/mkcert)).
Apple's certificate rules for iOS 13+ ([Apple 103769](https://support.apple.com/en-us/103769)):
"All TLS server certificates must comply":

- RSA keys ≥ 2048 bits; SHA-2 signatures;
- "must present the DNS name of the server in the Subject Alternative Name extension"
  (the CN is not used);
- EKU with `id-kp-serverAuth`;
- validity **≤ 825 days**.

The later **398-day** limit "will not affect certificates issued from user-added or
administrator-added Root CAs" ([Apple 102028](https://support.apple.com/en-us/102028)).
mkcert's own code chooses "2 years and 3 months, which is always less than 825 days,
the limit that macOS/iOS apply to all certificates, including custom roots"
([`cert.go`](https://github.com/FiloSottile/mkcert/blob/master/cert.go)), and its
README shows IP names (`127.0.0.1`, `::1`) as valid arguments. **Unconfirmed:**

- Apple's page talks only about a "DNS name" and says nothing on IP-address SANs.
  mkcert writes IP SANs, but I have not verified on a device that iOS accepts
  `https://192.168.2.10`.
- `homeassistant.local` as a DNS SAN is an ordinary DNS name to the certificate
  checker, but the name also has to resolve over mDNS on the phone. Issuing one
  certificate for **both** (`mkcert homeassistant.local 192.168.2.10`) keeps both URLs
  usable.

**(b) A real domain + Let's Encrypt DNS-01, pointed at the LAN IP.** DNS-01 "can
validate domain names whose webservers aren't exposed to the public internet", but
"cannot be used to validate IP Addresses"
([Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)). Home
Assistant's official **Let's Encrypt** app supports a DNS challenge with a long list of
providers (including `dns-duckdns`, `dns-cloudflare`) and writes `fullchain.pem` /
`privkey.pem` into `/ssl`. It does not renew on its own: "The app has to be started
again to renew certificates"
([HA Let's Encrypt docs](https://github.com/home-assistant/addons/blob/master/letsencrypt/DOCS.md)).
The **DuckDNS** app also stores its certificate as `/ssl/fullchain.pem` /
`privkey.pem` and relies on "the dns-01 challenge"
([HA DuckDNS docs](https://github.com/home-assistant/addons/blob/master/duckdns/DOCS.md)).
Those are exactly the files our `certfile`/`keyfile` options read from `/ssl`. The
hostname must then resolve to `192.168.2.10`, via a public A record or a local DNS
override. **DNS-rebinding protection:** routers built on dnsmasq with
`--stop-dns-rebind` "Reject (and log) addresses from upstream nameservers which are in
the private ranges". `--rebind-domain-ok` exempts named domains
([dnsmasq man page](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html)). So a
public record pointing at 192.168.x.x may be silently dropped by the router. The fix
is a rebind exemption for the domain, or a local DNS entry. Advantage: no profile on
any device, so every phone and iPad just works.

**(c) What Home Assistant provides.** HA's certificate apps above write to `/ssl`,
which this add-on can already use. HA's `http:` `ssl_certificate` only secures Core on
8123 (already covered in `addon/DOCS.md`). HA **Ingress** serves an app's UI "via the
Home Assistant UI" with HA doing the authentication
([HA developer docs, Presentation](https://developers.home-assistant.io/docs/apps/presentation/)).
Because the spec's default allowlist is `'self'`, a same-origin ingress iframe would be
allowed to take a wake lock if HA itself is served over HTTPS. **Unconfirmed / not
evaluated further:** this add-on does not enable `ingress` (`addon/config.yaml`), and I
did not verify HA's ingress iframe attributes. It would also mean using the app inside
HA's UI, not as its own Home Screen app.

**Re-adding the icon.** An `https://` URL is a different origin from `http://`, so the
existing Home Screen icon keeps opening the HTTP page. It has to be removed and added
again from the HTTPS URL, and anything in `localStorage` (such as the Auto-Lock hint
dismissal) starts empty. This follows from the origin model. **I found no Apple
document stating it for Home Screen web apps.** Since iOS 26, "Users can add any site to
their Home Screen and open it as a web app"
([WebKit, Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).

## 3. The video (NoSleep.js) technique

**What WebKit actually checks** (`HTMLMediaElement::shouldDisableSleep()`,
[`HTMLMediaElement.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp),
the same on `safari-7624.5.1.11`):

```cpp
if (RefPtr player = m_player; !player || !player->timeIsProgressing() || loop())
    return SleepType::None;
...
bool shouldBeAbleToSleep = mediaType() != PlatformMediaSession::MediaType::VideoAudio;
...
if (shouldBeAbleToSleep)
    return SleepType::None;
```

`mediaType()` returns `VideoAudio` only when `hasVideo && canProduceAudio()`.
`computeCanProduceAudio()` returns false if `muted()`, if `!volume()`, or if the media
has no audio track (`hasAudio()`). Before metadata loads, a muted `<video>` counts as
plain `Video`. The rule dates from 2012, commit
[52e7235651 (bug 75972)](https://github.com/WebKit/WebKit/commit/52e7235651be93f6934f55aaf4bc1490a77ddd3e):
"Only disable idle and display sleep when a video element is not paused, not looping,
and has both a video and audio track."

**Why ours fails.** `playSilentVideo()` in `addon/frontend/src/timer/wakeLock.ts` sets
`muted = true` and `loop = true`, and `keep-awake.mp4` has only one stream
(`ffprobe`: `codec_type=video`, h264, no audio). Each of these three alone makes
WebKit return `SleepType::None`, so the display is never held. This is not an iOS
regression. Starting it without a gesture is not the cause either: muted playback may
start without one.

**What NoSleep.js does instead**
([source](https://github.com/richtr/NoSleep.js/blob/master/src/index.js),
[media](https://github.com/richtr/NoSleep.js/blob/master/src/media.js)):

- Its MP4 contains an audio track (the decoded file has a `soun` handler and an `mp4a`
  sample entry).
- The video is **not** muted.
- For the MP4 source it does not use `loop`. It seeks back on `timeupdate`
  (`currentTime > 0.5` → `currentTime = Math.random()`).
- Its README requires `enable()` to "be wrapped in a user input event handler". That is
  necessary because WebKit's iOS video policy lets video `play()` without a gesture
  only "if their source media contains no audio tracks, or if their muted property is
  set to true", and "If a `<video>` element … becomes un-muted without a user gesture,
  playback will pause"
  ([WebKit, New video policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)).

**Does it work on 26.6.1 in standalone mode?** **Unconfirmed.** No first-party source
documents the video trick as supported. It is an implementation side effect. The
NoSleep.js tracker has open, unanswered reports: iOS 15
([#135](https://github.com/richtr/NoSleep.js/issues/135)) and the 16.4 standalone case
([#156](https://github.com/richtr/NoSleep.js/issues/156)). hls.js reported the screen
locking during real video playback "only if the page is 'installed' as pwa" on iOS 18.1
([hls.js #6725](https://github.com/video-dev/hls.js/issues/6725)). That is consistent
with bug 254545, where sleep-disabling went through `UIApplication.idleTimerDisabled`,
which did not work in Home Screen web apps. Media playback and Wake Lock share the same
`SleepDisabler` path that PR #13179 fixed for 18.4, so a NoSleep-faithful video
*should* hold the display in a 26.6.1 Home Screen web app. That is an inference from
source; I found no confirmation from Apple or on a device.

Side effects of trying it:

- It must start inside the Start tap.
- It plays unmuted (silent) audio, so it will probably take over the audio session and
  interrupt the user's music. This is **unconfirmed**; I found no source on it.
- On platforms with `HAVE(IDLE_SLEEP_STATE)`, a hidden element gets only
  `SleepType::System`, not `Display`. That favours a visible, non-zero-size element.
  **Unconfirmed** which platforms define it, or how `m_elementIsHidden` is computed on
  iOS.

## 4. Other mechanisms

- **Guided Access: a real, supported option that is limited to the session.** Apple:
  under Settings > Accessibility > Guided Access, "Set how long it takes iPhone to lock
  automatically: Tap Display Auto-Lock, then select an option"
  ([iPhone User Guide, Guided Access](https://support.apple.com/guide/iphone/iph7fad0d10/ios)).
  Another Apple article describes it as "Set how quickly your device automatically locks
  when not in use during a Guided Access session"
  ([Apple 111795](https://support.apple.com/en-us/111795)). Start a session by
  triple-clicking the side button in the app. End it with the triple-click plus the
  passcode or Face ID. This setting applies only during a Guided Access session, and
  the global Auto-Lock setting is left alone. **Unconfirmed from a primary source:**
  the list of choices. Apple's pages do not enumerate them. Secondary sources (TidBITS,
  Apple Community) say the range goes to "Never". Caveat from the same Apple guide:
  Emergency SOS / Crash Detection are unavailable while it is on.
- **Shortcuts / Personal Automations: none found.** I found no Shortcuts action that
  sets Auto-Lock or keeps the display on. Apple's Auto-Lock documentation names only
  "Settings > Display & Brightness > Auto-Lock"
  ([Keep the iPhone display on longer](https://support.apple.com/guide/iphone/iph7117338a8/ios)).
  Apple Community threads say no such action exists
  ([example](https://discussions.apple.com/thread/251201249)). **Not confirmed by a
  first-party action list.** A shortcut can at best open the Settings page.
- **Web app manifest: no.** None of the members (`display`, `orientation`, and so on)
  concerns screen sleep ([W3C Manifest](https://www.w3.org/TR/appmanifest/)).
  `apple-mobile-web-app-capable` controls only standalone presentation.
- **Global Auto-Lock → Never:** works, but the user rejected it.
- **Ruled out:** treating a LAN HTTP origin as secure (section 2); a muted or looping
  video (section 3); the old NoSleep page-reload hack, which the NoSleep source limits
  to iOS < 10.

## 5. Recommendation (iPhone on iOS 26.6.1, Home Screen app, single household)

1. **HTTPS with a local CA (mkcert), then native Wake Lock.** This is the only
   documented, supported API.
   - Steps: `mkcert -install`, then `mkcert homeassistant.local 192.168.2.10`. Copy
     both files to `/ssl`, set `ssl`/`certfile`/`keyfile`, and restart. AirDrop
     `rootCA.pem` to the phone, install the profile, and enable it in Certificate Trust
     Settings. Delete the old icon and re-add it from `https://homeassistant.local:8234/`.
   - Code change: request the lock inside the Start tap handler (WebKit's 5-second
     transient-activation rule).
   - Cost: about 15 minutes one-off per device; reissue the certificate before 825 days
     (mkcert: 2 years 3 months). No internet dependency.
   - Risk: IP-SAN acceptance on iOS is unverified. Use the hostname URL, or test both.
2. **HTTPS with Let's Encrypt DNS-01 (HA Let's Encrypt or DuckDNS app).**
   - Result: the same Wake Lock outcome, and no profile on any device.
   - Cost: a domain or DuckDNS name, a DNS record or local override pointing at
     192.168.2.10, possibly a router rebind exemption, and re-running the app to renew.
   - Best choice if the household already runs one of these apps, or will add more
     devices.
3. **Guided Access with Display Auto-Lock set to its longest or Never value.** Use this
   now, until 1 or 2 is done.
   - Cost: zero code. Triple-click to start and end each workout. Locks the phone to
     the app; no Emergency SOS or Crash Detection during the session.
4. **Make the fallback faithful to NoSleep.js.** Use a video with an audio track, not
   muted, no `loop` attribute, seeking back on `timeupdate`, started inside the Start
   tap, and visible (not 1 px / opacity 0).
   - Only if HTTP must stay. Unverified on 26.6.1 and depends on undocumented
     behaviour. Likely to interrupt music.
   - At minimum, the current muted/looping fallback should be removed or rewritten: per
     WebKit source it can never work.
5. Global Auto-Lock → Never: works, but rejected by the user.

## Sources

- WebKit blog: [Safari 16.4](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/), [26.5](https://webkit.org/blog/17938/webkit-features-for-safari-26-5/), [26.6](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/), [New video policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- WebKit Bugzilla: [254545](https://bugs.webkit.org/show_bug.cgi?id=254545), [245884](https://bugs.webkit.org/show_bug.cgi?id=245884); PR [#13179](https://github.com/WebKit/WebKit/pull/13179); commits [d901ad78bd](https://github.com/WebKit/WebKit/commit/d901ad78bdb6536b4c0bdcbf85b1c1e40b8bdfc4), [95606b1312](https://github.com/WebKit/WebKit/commit/95606b13126e82a5cf2534a05e107d0aa69ccc0a), [52e7235651](https://github.com/WebKit/WebKit/commit/52e7235651be93f6934f55aaf4bc1490a77ddd3e)
- WebKit source (`main` and `safari-7624.5.1.11-branch`): [`WakeLock.idl`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/screen-wake-lock/WakeLock.idl), [`WakeLock.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/screen-wake-lock/WakeLock.cpp), [`HTMLMediaElement.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp), [`SecurityOrigin.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/SecurityOrigin.cpp), [`LocalDOMWindow.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalDOMWindow.cpp), [`SleepDisablerIOS.mm`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/PAL/pal/system/ios/SleepDisablerIOS.mm)
- W3C: [Screen Wake Lock](https://w3c.github.io/screen-wake-lock/), [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/), [App Manifest](https://www.w3.org/TR/appmanifest/)
- Apple: [102390 Trust manually installed certificate profiles](https://support.apple.com/en-us/102390), [103769 Requirements for trusted certificates](https://support.apple.com/en-us/103769), [102028 Limits on trusted certificates](https://support.apple.com/en-us/102028), [101604 Low Power Mode](https://support.apple.com/en-us/101604), [111795 Guided Access](https://support.apple.com/en-us/111795), [iPhone User Guide: Guided Access](https://support.apple.com/guide/iphone/iph7fad0d10/ios), [Keep the display on longer](https://support.apple.com/guide/iphone/iph7117338a8/ios), [Configuration profiles](https://support.apple.com/guide/iphone/iph6c493b19/ios), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Let's Encrypt: [Challenge types](https://letsencrypt.org/docs/challenge-types/); dnsmasq [man page](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html)
- Home Assistant: [Let's Encrypt app](https://github.com/home-assistant/addons/blob/master/letsencrypt/DOCS.md), [DuckDNS app](https://github.com/home-assistant/addons/blob/master/duckdns/DOCS.md), [App presentation / Ingress](https://developers.home-assistant.io/docs/apps/presentation/)
- NoSleep.js: [README](https://github.com/richtr/NoSleep.js), [`index.js`](https://github.com/richtr/NoSleep.js/blob/master/src/index.js), [`media.js`](https://github.com/richtr/NoSleep.js/blob/master/src/media.js), issues [#135](https://github.com/richtr/NoSleep.js/issues/135), [#156](https://github.com/richtr/NoSleep.js/issues/156); hls.js [#6725](https://github.com/video-dev/hls.js/issues/6725); mkcert [README](https://github.com/FiloSottile/mkcert), [`cert.go`](https://github.com/FiloSottile/mkcert/blob/master/cert.go)
- Secondary only: [caniuse](https://caniuse.com/wake-lock), [9to5Mac on Safari 26.4](https://9to5mac.com/2026/03/24/apple-details-safari-26-4-with-44-new-features-191-bug-fixes-more/), [Apple Community on Shortcuts/Auto-Lock](https://discussions.apple.com/thread/251201249)
