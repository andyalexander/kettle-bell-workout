# HTTPS for Kettlebell Trainer with your own certificate authority (Mac)

A step-by-step guide, starting from a Mac with nothing installed, to serving the
app over `https://` with a certificate your iPhone and iPad trust.

**Why bother?** iOS only lets a web page keep the screen awake (the Screen Wake
Lock API) when the page arrives over HTTPS. The app serves plain HTTP by default,
so on your phone that API simply does not exist. Turn HTTPS on and the app starts
using it automatically — there is no app setting beyond the ones below.

**How it works, in one paragraph.** You will make a *certificate authority* (CA)
on your Mac — a private "stamp" that only your own devices recognise. You use it
to stamp a *certificate* for the Pi, which says "I am `homeassistant.local`". The
Pi shows that certificate to anyone who connects. Your iPhone accepts it because
you have told the iPhone to trust your stamp. Nothing touches the internet: no
domain name, no public DNS, no ports opened on your router.

Allow 30–45 minutes the first time. After that, the only upkeep is a renewal
roughly every two years (see [Renewing](#renewing-in-about-two-years)).

Checked against current documentation on 12 September 2026 — see
[Sources](#sources).

## Contents

1. [What you need](#what-you-need)
2. [Install the tools on the Mac](#part-1--install-the-tools-on-the-mac)
3. [Create your certificate authority](#part-2--create-your-certificate-authority)
4. [Find the Pi's addresses](#part-3--find-the-pis-addresses)
5. [Make the Pi's certificate](#part-4--make-the-pis-certificate)
6. [Copy the certificate to Home Assistant](#part-5--copy-the-certificate-to-home-assistant)
7. [Turn HTTPS on in the app](#part-6--turn-https-on-in-the-app)
8. [Trust your CA on each iPhone and iPad](#part-7--trust-your-ca-on-each-iphone-and-ipad)
9. [Put the app back on the Home Screen](#part-8--put-the-app-back-on-the-home-screen)
10. [Check the screen stays awake](#part-9--check-the-screen-stays-awake)
11. [Troubleshooting](#troubleshooting), [Renewing](#renewing-in-about-two-years),
    [Undoing it all](#undoing-it-all)

## What you need

- A Mac running **macOS 15 Sequoia or newer** (Homebrew, the installer used
  below, no longer supports anything older). Check under  → *About This Mac*.
- The Mac's **administrator password** — the one you log in with, if you set the
  Mac up yourself.
- The Mac and the Pi on the **same home network**, and Home Assistant working
  (you can open `http://homeassistant.local:8123/`).
- The Kettlebell Trainer app installed in Home Assistant.
- Your iPhone and/or iPad, with **AirDrop** on (Control Centre → hold the
  network tile → AirDrop → *Contacts Only* or *Everyone for 10 Minutes*).

### Reading the commands in this guide

Everything in a grey box is typed into **Terminal**, one line at a time, pressing
Return after each. To open Terminal: press ⌘-Space, type `Terminal`, press
Return.

- You can copy a line from this page and paste it with ⌘-V.
- Lines starting with `#` are comments — you do not need to type them.
- When Terminal asks for a **password**, type your Mac password and press Return.
  **Nothing appears as you type** — no dots, no stars. That is normal.
- Wherever you see **`192.168.2.10`**, use *your* Pi's address from
  [Part 3](#part-3--find-the-pis-addresses) instead.

## Part 1 — Install the tools on the Mac

You need two tools: **Homebrew**, a package manager that installs command-line
software, and **mkcert**, which creates the certificate authority and
certificates.

### 1.1 Install Homebrew

Paste this into Terminal (it is one long line):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

What happens next:

1. It asks for your **password** (typed blind, see above).
2. It lists what it will do and says **"Press RETURN/ENTER to continue"** —
   press Return.
3. On a fresh Mac it first installs Apple's **Command Line Tools for Xcode**.
   This is a download of several hundred megabytes and can take 5–15 minutes. If
   a window pops up asking to install them, click **Install** and accept the
   licence.
4. It finishes with **"Installation successful!"** followed by a **"Next steps"**
   section. Do not close Terminal yet.

> If you prefer clicking to typing, Homebrew also offers a `.pkg` installer on
> its [latest GitHub release](https://github.com/Homebrew/brew/releases/latest).
> Either way, carry on with 1.2.

### 1.2 Let Terminal find Homebrew

Find out which kind of Mac you have:

```bash
uname -m
```

- **`arm64`** (Apple Silicon — M1, M2, M3, M4 and later): Homebrew lives in
  `/opt/homebrew`, which Terminal does not look in yet. Run the three lines the
  installer printed under "Next steps". They look like this — prefer the
  installer's own version if it differs:

  ```bash
  echo >> ~/.zprofile
  echo 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"' >> ~/.zprofile
  eval "$(/opt/homebrew/bin/brew shellenv zsh)"
  ```

- **`x86_64`** (Intel): nothing to do. Homebrew lives in `/usr/local`, which
  Terminal already looks in.

Check it worked:

```bash
brew --version
```

You should see `Homebrew 5.x.x` or similar. If you see
`zsh: command not found: brew`, quit Terminal (⌘-Q), open it again, and retry.

### 1.3 Install mkcert

```bash
brew install mkcert
```

Check it:

```bash
mkcert -version
```

This should print `v1.4.4` (the current release as of this writing).

> **Only if you use Firefox on this Mac:** also run `brew install nss`. Firefox
> keeps its own list of trusted authorities, and mkcert needs `nss` to add
> yours to it. Safari and Chrome do not need this.

## Part 2 — Create your certificate authority

```bash
mkcert -install
```

It will ask for your **password** — possibly once in Terminal and once in a macOS
pop-up saying you are changing the System Certificate Trust Settings. Both are
expected: mkcert is adding your new CA to the Mac's system keychain so Safari
trusts it.

You should see:

```text
Created a new local CA 💥
The local CA is now installed in the system trust store! ⚡️
```

A line saying Firefox's trust store was skipped is harmless unless you use
Firefox (see 1.3).

See where the CA was saved:

```bash
mkcert -CAROOT
```

This prints `/Users/<you>/Library/Application Support/mkcert`. That folder holds
two files:

| File | What it is | Share it? |
| --- | --- | --- |
| `rootCA.pem` | The CA's public certificate — what your devices will trust. | Yes: it goes to each iPhone/iPad in Part 7. |
| `rootCA-key.pem` | The CA's **private key** — the stamp itself. | **Never.** |

> ⚠️ **Guard `rootCA-key.pem`.** Anyone who has it can make certificates your
> devices trust for *any* website — including your bank's — and so read
> traffic from those devices. It never needs to leave the Mac. Do not AirDrop,
> email, sync or commit it.
>
> It is worth keeping a **private backup** of the whole folder (for example, as
> an attachment in your password manager). If this Mac is wiped and the folder
> is lost, the CA is gone and you must repeat this guide, including Part 7 on
> every device.

## Part 3 — Find the Pi's addresses

The certificate must name every address you will type to reach the Pi. You will
give it two: the **name** you use today and the Pi's **IP address** as a
fallback.

**The name.** The app is on your Home Screen as `http://homeassistant.local:8234/`,
so the name is `homeassistant.local`. If you changed Home Assistant's hostname,
check it under *Settings → System → Network* in Home Assistant, and add `.local`.

**The IP address.** In Terminal:

```bash
ping -c 1 homeassistant.local
```

The first line shows it in brackets, e.g.
`PING homeassistant.local (192.168.2.10): 56 data bytes`. You can also find it in
Home Assistant under *Settings → System → Network*, in the IPv4 section.

> **Optional but wise:** in your router's settings, give the Pi a *DHCP
> reservation* (sometimes called a "static lease") so its IP address never
> changes. If it does change, the name still works; only the IP fallback breaks.

## Part 4 — Make the Pi's certificate

Make a folder to keep the files in, and go into it:

```bash
mkdir -p ~/kettlebell-cert
cd ~/kettlebell-cert
```

Create the certificate and its private key, naming both addresses (use your IP):

```bash
mkcert -cert-file kettlebell.pem -key-file kettlebell-key.pem homeassistant.local 192.168.2.10
```

You should see:

```text
Created a new certificate valid for the following names 📜
 - "homeassistant.local"
 - "192.168.2.10"

The certificate is at "kettlebell.pem" and the key at "kettlebell-key.pem" ✅

It will expire on 12 December 2028 🗓
```

The explicit file names avoid a clash with `fullchain.pem` and `privkey.pem`,
which Home Assistant itself may already use in the same folder.

**Put the expiry date in your calendar** now, with a reminder a few weeks
before. You can check it again at any time:

```bash
openssl x509 -in ~/kettlebell-cert/kettlebell.pem -noout -enddate
```

And confirm the names are right:

```bash
openssl x509 -in ~/kettlebell-cert/kettlebell.pem -noout -text | grep -A1 "Subject Alternative Name"
```

which prints `DNS:homeassistant.local, IP Address:192.168.2.10`.

`kettlebell-key.pem` is the Pi's private key. It only goes to the Pi (Part 5);
don't share it anywhere else.

## Part 5 — Copy the certificate to Home Assistant

The app reads its certificate from Home Assistant's `ssl` folder. The easiest way
to reach that folder from a Mac is the **Samba share** app, which makes Home
Assistant's folders appear in Finder like a network drive.

### 5.1 Install and start Samba share

In Home Assistant:

1. *Settings → Apps → Install app*, search for **Samba share**, open it, click
   **Install**.
2. Open its **Configuration** tab. Set a **Username** and **Password** — these
   are new credentials just for this share, not your Home Assistant login. Click
   **Save**.
3. Back on the **Info** tab, click **Start**.

(If you already use Samba share, skip to 5.2 with your existing username and
password.)

### 5.2 Connect from Finder

1. In Finder, choose *Go → Connect to Server…* (⌘-K).
2. Type `smb://homeassistant.local` and click **Connect**.
3. Choose **Registered User**, enter the Samba username and password from 5.1,
   and click **Connect**. Tick *Remember this password in my keychain* if you
   like.
4. Pick **`ssl`** from the list of folders and click **OK**. A Finder window
   opens on it.

### 5.3 Copy the two files

Drag `kettlebell.pem` and `kettlebell-key.pem` from `~/kettlebell-cert` into the
`ssl` window. (In Finder, *Go → Home* shows the `kettlebell-cert` folder.)

Or, in Terminal:

```bash
cp ~/kettlebell-cert/kettlebell.pem ~/kettlebell-cert/kettlebell-key.pem /Volumes/ssl/
ls /Volumes/ssl
```

The listing should include both files. Don't delete or replace anything else in
that folder.

You can eject the share now (the ⏏ button next to `ssl` in Finder's sidebar), and
stop Samba share in Home Assistant if you don't use it for anything else.

## Part 6 — Turn HTTPS on in the app

### 6.1 First, send any unsaved workouts

The moment HTTPS is on, the old `http://` Home Screen app stops working. Your
training history lives on the Pi and is safe, but a workout that finished while
the Pi was unreachable waits *on the device* until it can be sent — and the old
app will never be able to send it.

So, on **each** iPhone and iPad, with Home Assistant running: open the Kettlebell
app from the Home Screen as you normally would and wait for the profile picker
to appear. Opening the app sends anything that was waiting. If your last workout
summary said **Saved**, there was nothing waiting anyway.

### 6.2 Change the settings

In Home Assistant:

1. *Settings → Apps → Kettlebell Trainer → **Configuration***.
2. Set:

   | Option | Value |
   | --- | --- |
   | `ssl` | on |
   | `certfile` | `kettlebell.pem` |
   | `keyfile` | `kettlebell-key.pem` |

   Just the file names — not `/ssl/kettlebell.pem`.
3. Click **Save**.
4. Go to the **Info** tab and click **Restart**.
5. Open the **Log** tab. Near the top you should see:

   ```text
   TLS enabled — serving https on port 8234.
   ```

   If instead it says `SSL is on but /ssl/… was not found`, a file name in step
   2 doesn't match what you copied in Part 5. The app refuses to start rather
   than silently fall back to HTTP — see [Troubleshooting](#troubleshooting).

### 6.3 Check it from the Mac

Your Mac already trusts your CA (Part 2), so this is a quick test before touching
the phone.

Open **Safari** and go to `https://homeassistant.local:8234/`. The app should load
with no warning. (Note the **https**.)

Or in Terminal, which also shows the certificate is correct:

```bash
curl --cacert "$(mkcert -CAROOT)/rootCA.pem" https://homeassistant.local:8234/api/health
```

The expected answer is `{"status":"ok","version":"…"}`. An error mentioning
`certificate` means the names in the certificate don't match the address — see
[Troubleshooting](#troubleshooting).

## Part 7 — Trust your CA on each iPhone and iPad

Do this on **every** device you train with. It takes two separate switches on
the device — *installing* the profile, then *trusting* it — and missing the
second one is the most common mistake.

### 7.1 Send `rootCA.pem` to the device

In Terminal, open the CA folder in Finder:

```bash
open "$(mkcert -CAROOT)"
```

Right-click **`rootCA.pem`** (not `rootCA-key.pem`) → *Share* → **AirDrop**, and
pick your iPhone or iPad.

> No AirDrop? Email `rootCA.pem` to yourself and tap the attachment in the
> **Mail** app on the device. (It has to be Apple's Mail app or Safari; other
> apps often just show the file's text.)

### 7.2 Install the profile

1. The device says **Profile Downloaded**. Tap **Close**. (If you have an Apple
   Watch, it may first ask which device the profile is for — choose the iPhone
   or iPad.)
2. Open **Settings**. Tap **Profile Downloaded**, just below your name at the top.
   (If it isn't there, go to *General → VPN & Device Management* and tap the
   profile under *Downloaded Profile*.)
3. You'll see a profile named **mkcert development CA**. Tap **Install** (top
   right), enter your passcode, tap **Install** again on the warning screen, and
   once more to confirm. Then tap **Done**.

Do this within about 8 minutes of the AirDrop — iOS deletes a downloaded
profile that isn't installed in time. If it vanished, just AirDrop it again.

### 7.3 Turn on full trust — don't skip this

1. *Settings → General → About*, scroll to the bottom, tap **Certificate Trust
   Settings**.
2. Under *Enable full trust for root certificates*, switch on **mkcert
   development CA**.
3. Tap **Continue** on the warning.

Until this switch is on, Safari still shows a *"This Connection Is Not Private"*
warning.

## Part 8 — Put the app back on the Home Screen

To iOS, `http://homeassistant.local:8234` and `https://homeassistant.local:8234`
are two different apps. The icon you have now opens the old `http://` address,
which no longer answers. Replace it:

1. On the Home Screen, touch and hold the old **Kettlebell** icon → *Remove
   App* (or *Delete Bookmark*) → confirm.
2. Open **Safari** and go to `https://homeassistant.local:8234/`. It should load
   with no warning.
3. Tap the **Share** button (in the ⋯ menu next to the address bar on iOS 26) →
   **Add to Home Screen**.
4. Make sure **Open as Web App** is on (it is by default), then tap **Add**.

Open the app from the new icon. Your profiles, routines and history are all
there — they live on the Pi, not on the phone.

## Part 9 — Check the screen stays awake

1. Temporarily shorten the lock time: *Settings → Display & Brightness →
   Auto-Lock → **30 seconds***.
2. Open the app from the new icon and start a workout.
3. Put the phone down and don't touch it for a minute or two.
4. The screen should stay on for the whole workout.
5. Set Auto-Lock back to what you had.

If the screen still dims: first open `https://homeassistant.local:8234/` in Safari
and check there is no certificate warning. If there isn't, HTTPS is working and
the remaining cause is in the app, not your certificate. WebKit prefers the
keep-awake request to come directly from a tap, and the app currently makes it
just after the workout starts. Issue
[#32](https://github.com/andyalexander/kettle-bell-workout/issues/32) tracks
that. In the meantime, *Auto-Lock → Never* is the reliable fallback.

## Troubleshooting

**`zsh: command not found: brew`** — Part 1.2 wasn't done, or Terminal wasn't
reopened after it. Run the three lines again, then quit and reopen Terminal.

**Safari on the phone says "This Connection Is Not Private"** — in order of
likelihood:

1. Full trust isn't switched on (Part 7.3). This is the usual cause.
2. The profile was never installed (Part 7.2). If *Certificate Trust Settings*
   has no *Enable full trust* section at all, no profile is installed.
3. You typed an address the certificate doesn't name — for example, a new IP
   after the Pi's address changed. Check the names (Part 4) and remake the
   certificate if needed.
4. You typed `http://` instead of `https://`.

**The app won't start, and the log says `SSL is on but /ssl/… was not found`** —
the `certfile` or `keyfile` option doesn't match a file in the `ssl` folder.
Compare the spelling exactly (it is case-sensitive) and use the file name only,
without `/ssl/`. Or switch `ssl` off to get the app back on HTTP while you sort
it out.

**The app starts but the page won't load at all** — check the address uses port
**8234**, not 8123. Home Assistant's own HTTPS setting (`ssl_certificate` under
`http:` in `configuration.yaml`) covers Home Assistant on port 8123 only. It does
nothing for this app, which runs its own server on 8234.

**`mkcert -install` mentions Firefox or `certutil`** — harmless unless you use
Firefox. If you do, run `brew install nss`, then `mkcert -install` again.

**The profile doesn't appear on the phone after AirDrop** — it may have opened
in *Files* instead. Use the Mail route in Part 7.1.

## Renewing (in about two years)

mkcert's certificates last **2 years and 3 months**. Apple refuses certificates
from a private CA that are valid for longer than 825 days, and mkcert
deliberately stays just under that.

Your CA itself lasts **10 years**, so **renewing needs nothing on the phones**:

1. On the Mac, remake the certificate with the same command as Part 4 (it
   overwrites the old files):

   ```bash
   cd ~/kettlebell-cert
   mkcert -cert-file kettlebell.pem -key-file kettlebell-key.pem homeassistant.local 192.168.2.10
   ```

2. Copy both files to the `ssl` share again (Part 5), replacing the old ones.
3. Restart the app in Home Assistant (Part 6.2, step 4).
4. Put the new expiry date in your calendar.

This needs the **same Mac**, or a restored backup of the CA folder (Part 2).
On a different Mac with a fresh CA you would have to repeat Part 7 on every
device.

Apple's recent move to much shorter certificate lifetimes (200 days from 2026,
down to 47 days by 2029) applies only to certificates from the public
authorities built into iOS and macOS, not to a CA you added yourself. Two years
still holds.

## Undoing it all

- **App back to HTTP:** Home Assistant → Kettlebell Trainer → Configuration →
  `ssl` off → Save → Restart. Re-add the Home Screen icon from
  `http://homeassistant.local:8234/`.
- **Phone:** *Settings → General → VPN & Device Management → mkcert development
  CA → Remove Profile*.
- **Mac:** `mkcert -uninstall` removes the CA from the Mac's trust store (the
  files stay in `mkcert -CAROOT`; delete that folder too if you want it gone).
- **Pi:** delete `kettlebell.pem` and `kettlebell-key.pem` from the `ssl` share.

## Sources

Checked 12 September 2026.

- mkcert — [README](https://github.com/FiloSottile/mkcert) (install, `-install`,
  iOS, `rootCA-key.pem` warning), [releases](https://github.com/FiloSottile/mkcert/releases)
  (v1.4.4 is current), and
  [`cert.go`](https://github.com/FiloSottile/mkcert/blob/master/cert.go)
  (2 years 3 months per certificate, 10 years for the CA, the 825-day ceiling).
- Homebrew — [brew.sh](https://brew.sh/) and
  [Installation](https://docs.brew.sh/Installation) (macOS 15+, Command Line
  Tools, `/opt/homebrew` on Apple Silicon, `brew shellenv`).
- Apple — [Trust manually installed certificate profiles in iOS and
  iPadOS](https://support.apple.com/en-us/102390),
  [Requirements for trusted certificates in iOS 13 and macOS 10.15](https://support.apple.com/en-us/103769)
  (the 825-day limit), and
  [About upcoming limits on trusted certificates](https://support.apple.com/en-us/102028)
  ("will not affect certificates issued from user-added or administrator-added
  Root CAs").
- Apple — [Turn a website into an app in Safari on
  iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
  (*Open as Web App*).
- Home Assistant — [Samba share app](https://github.com/home-assistant/addons/blob/master/samba/DOCS.md)
  (the `ssl` share, `smb://` from macOS).
- This repo — `addon/DOCS.md` ("Keeping the screen awake"), `addon/run.sh` (how
  the `ssl`, `certfile` and `keyfile` options start the server), and issues
  [#12](https://github.com/andyalexander/kettle-bell-workout/issues/12) and
  [#32](https://github.com/andyalexander/kettle-bell-workout/issues/32).
