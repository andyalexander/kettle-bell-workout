# Kettlebell Trainer

EMOM and interval kettlebell workouts, run from an iPhone or iPad on the home
network. Results are published to Home Assistant over MQTT.

## Installation

Add this repository to the app store
(`https://github.com/andyalexander/kettle-bell-workout`), then install **Kettlebell
Trainer**. The first install builds the image on the device and takes a few minutes.

## Configuration

| Option | Meaning |
| --- | --- |
| `log_level` | `debug`, `info`, `warning` or `error`. |
| `mqtt_discovery_prefix` | Discovery topic prefix. Leave as `homeassistant` unless you have changed it in the MQTT integration. |
| `ssl` | Serve HTTPS instead of HTTP. Off by default. See [Keeping the screen awake](#keeping-the-screen-awake) — this is the only reason to turn it on. |
| `certfile` | Certificate filename inside the `/ssl` folder. A filename, not a path. Only read when `ssl` is on. |
| `keyfile` | Private key filename inside the `/ssl` folder. Only read when `ssl` is on. |

Broker host, port and credentials are supplied by the Supervisor — there is nothing
to configure, but an MQTT broker must be installed.

If `ssl` is on and either file is missing from `/ssl`, the app **refuses to start**
and says which file it wanted. That is deliberate: quietly falling back to HTTP
would leave the screen dimming mid-workout while everything looked healthy.

## Using it

Open the web interface on port `8234`, e.g. `http://homeassistant.local:8234/`.

## Keeping the screen awake

**Set Auto-Lock to Never on the device you train with**: *Settings → Display &
Brightness → Auto-Lock → Never*. Do this first. Everything below explains why it is
necessary, and what the alternative costs.

### Why the screen dims

A web page can ask iOS to keep the screen on, through the Screen Wake Lock API. That
API is only available in a **secure context** — that is, over HTTPS. This app serves
plain HTTP by default, so on your iPad the API is not unreliable, it is **absent**.

The app falls back to playing a silent, invisible looping video, which used to be
enough to keep iOS awake. On current iOS it is much less dependable. Treat Auto-Lock
→ Never as the actual fix and the video as a bonus, not the other way round.

### The trap: HTTPS in Home Assistant does not cover this app

If you have already configured `ssl_certificate` under the `http:` integration,
that secures **Home Assistant Core on port 8123**. It does nothing here. This app
runs its own web server on port **8234**, and Home Assistant never sees that
traffic. Enabling HTTPS for this app means the `ssl` option above, and nothing else.

### Advanced: real HTTPS with a local certificate authority

Turning on `ssl` makes the page a secure context, and the Screen Wake Lock API
appears on its own — the app already checks for it. The work is in getting a
certificate the iPad will trust.

You do **not** need a domain name, public DNS, or a certificate authority on the
internet. A certificate can name an IP address directly, so
`https://192.168.2.10:8234/` works with nothing but a certificate authority of your
own. On a Mac, `mkcert` does the whole job:

```bash
brew install mkcert
mkcert -install          # creates your local CA
mkcert 192.168.2.10      # a certificate naming the Pi's IP address
```

That leaves `192.168.2.10.pem` and `192.168.2.10-key.pem`. Then:

1. Copy both into the Pi's `/ssl` folder (the Samba or File Editor app is the
   easiest route).
2. Set `ssl: true`, `certfile: 192.168.2.10.pem`, `keyfile: 192.168.2.10-key.pem`,
   and restart the app.
3. Trust your CA on **each** iPhone and iPad. `mkcert -CAROOT` prints the folder
   holding `rootCA.pem`; AirDrop or email that file to the device, install it under
   *Settings → General → VPN & Device Management*, then switch it on under
   *Settings → General → About → Certificate Trust Settings*.
4. Browse to `https://192.168.2.10:8234/`. Use the address the certificate names —
   `homeassistant.local` will not match a certificate issued for the IP.

The cost is step 3, once per device, and repeating the whole thing when the
certificate expires. Apple's 398-day limit on certificate lifetime
[does not apply to certificates from a root CA you added yourself](https://support.apple.com/en-us/HT211025),
so mkcert's default of roughly two years holds.

The `webui` link in Home Assistant follows the `ssl` option automatically, as does
the watchdog that restarts the app if it stops answering. The watchdog does not
verify certificates, so a certificate from your own CA will not upset it.

## Your data

Everything — profiles, routines and training history — lives in a single SQLite
database at `/data/kettlebell.db`, which is included in Home Assistant backups.

**Uninstalling the app deletes `/data`, and with it your entire training history.**
Updates, rebuilds and restarts all preserve it; only uninstall destroys it.
