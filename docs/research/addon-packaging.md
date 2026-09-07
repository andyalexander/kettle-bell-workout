# Add-on packaging, and where the front end gets built

Research for [issue #5](https://github.com/andyalexander/kettle-bell-workout/issues/5). All claims cite
primary sources: the Home Assistant developer documentation, the Supervisor source, and the
`home-assistant/docker-base` and `home-assistant/builder` repositories. Timings I measured myself are
labelled as such.

Researched 2026-09-07 against `home-assistant/supervisor@main` and the current developer docs.

---

## 0. Two things that invalidate assumptions in the ticket — read these first

### 0.1 "Add-ons" are now called **apps**, and the docs have moved

The developer documentation renamed add-ons to **apps**. The docs now live at
`developers.home-assistant.io/docs/apps/...`, and the introduction states plainly: *"Apps (formerly
known as add-ons) for Home Assistant allow the user to extend the functionality around Home
Assistant."*
Source: <https://developers.home-assistant.io/docs/apps> ([source md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps.md))

The rename has gone all the way into the Supervisor: the package is `supervisor/apps/`, the container
naming helper is now `DockerApp.slug_to_name(slug) -> f"app_{slug}"`, and errors are `AppBuildFailedUnknownError`,
`StoreAppNotFoundError`, etc.
Source: <https://github.com/home-assistant/supervisor/blob/main/supervisor/docker/app.py>, <https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/app.py>

**What this changes for us:** nothing structural — the on-disk layout is unchanged (`/addons` is still
the local folder, `config.yaml` is still the file, `slug` is still `slug`). But it means older blog
posts and community add-on templates you find by searching are describing the previous generation of
docs, and the current label for `io.hass.type` is `app`, not `addon`. Prefer the `/docs/apps/` pages
over anything you find in a search result pointing at `/docs/add-ons/`.

### 0.2 **`build.yaml` is dead. Do not write one.**

The ticket asks for a `build.yaml`. There should not be one.

> "The new build workflow doesn't use `build.yaml` anymore. Move the content into your `Dockerfile`
> [...] With the content of `build.yaml` migrated, you can delete the file from your repository."
>
> — [Migrating app builds to Docker BuildKit](https://developers.home-assistant.io/blog/2026/04/02/builder-migration), 2 April 2026

And the corresponding removal of the implicit base image:

> "Since Supervisor 2026.04.0, the `BUILD_FROM` argument is no longer provided by default. Use explicit
> `FROM ghcr.io/home-assistant/base:latest` in your Dockerfile to achieve the same build result as
> before. Using a pinned version of the base image is recommended for better build stability."
>
> — [App configuration](https://developers.home-assistant.io/docs/apps/configuration#build-args)

Supervisor still *reads* a `build.yaml` if it finds one, but logs a deprecation warning and will drop
support:

```python
_LOGGER.warning(
    "App %s uses build.yaml which is deprecated. "
    "Move build parameters into the Dockerfile directly.",
    app.slug,
)
```
Source: [`supervisor/apps/build.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/build.py)

The legacy `home-assistant/builder@master` GitHub Action is also retired and will be deleted, replaced
by three composite actions (`prepare-multi-arch-matrix`, `build-image`, `publish-multi-arch-manifest`).
Source: <https://github.com/home-assistant/builder#legacy-home-assistantbuilder-action>

**Consequence:** the file list for our add-on is `config.yaml`, `Dockerfile`, `run.sh`, `icon.png`,
`logo.png`, `README.md`, `DOCS.md`, `CHANGELOG.md`, `translations/en.yaml`. No `build.yaml`.

---

## 1. Add-on (app) anatomy

### 1.1 Folder layout

```text
kettlebell/                # this folder's name is arbitrary; `slug` is what matters
  config.yaml
  Dockerfile
  DOCS.md
  CHANGELOG.md
  README.md
  icon.png                 # square, shown in the app list
  logo.png                 # wide, shown on the app page
  translations/en.yaml     # optional: nicer labels for options and ports
  run.sh
```
Source: [App configuration § file structure](https://developers.home-assistant.io/docs/apps/configuration)

Caution from the same page, worth heeding because our repo will also contain a FastAPI app and a Vite
app: *"Avoid using `config.yaml` as filename in your app for anything other than the app configuration.
The Supervisor does recursively search for `config.yaml` in the app repository."* If our backend ever
wants a YAML config file, it must not be called `config.yaml`.

Icon/logo requirements (sizes, formats) are in
[Presentation](https://developers.home-assistant.io/docs/apps/presentation). `DOCS.md` renders as the
"Documentation" tab in the app UI; `README.md` is what people see on GitHub; `CHANGELOG.md` is shown by
the update dialog.

### 1.2 Required and relevant `config.yaml` keys

Required: `name`, `version`, `slug`, `description`, `arch`.
Source: [App configuration § required configuration options](https://developers.home-assistant.io/docs/apps/configuration#required-configuration-options)

The optional keys that matter to us:

| Key | Why we want it |
| --- | --- |
| `ports` | `"container-port/type": host-port`. Publishes the port on the host. `null` host port disables the mapping. |
| `ports_description` | Human label for the port in the UI. |
| `webui` | `http://[HOST]:[PORT:8234]/` — makes the app page show an "OPEN WEB UI" button. `[PORT:8234]` is the *internal* port, substituted with whatever the user actually mapped. |
| `init: false` | **Required.** See §1.4. |
| `startup: services` | Start before Home Assistant Core, since we publish MQTT discovery that Core consumes. |
| `boot: auto` | Default; start on boot. |
| `services: ["mqtt:need"]` | Gets us broker host/port/credentials without asking the user. See §6. |
| `watchdog` | `http://[HOST]:[PORT:8234]/api/health` — Supervisor restarts the container if this stops responding. |
| `image` | Present ⇒ pull from a registry. Absent ⇒ build on device. **This single key is the whole build-location decision.** See §3. |
| `map` | We need *nothing* here. `/data` is always mapped. See §5. |
| `backup: hot` | Default. Consider `cold` — see §5.3. |

Source for all of the above: [App configuration § optional configuration options](https://developers.home-assistant.io/docs/apps/configuration#optional-configuration-options)

### 1.3 Which base image on aarch64

Use **`ghcr.io/home-assistant/base-python`**, pinned.

- `home-assistant/docker-base` publishes `base-python` on Alpine for Python 3.12, 3.13 and 3.14 across
  Alpine 3.22/3.23/3.24, `latest` currently being `3.14-alpine3.24`.
  Source: <https://github.com/home-assistant/docker-base#python-images>
- *"Beginning with the 2026.03.1 release, all images are published as multi-arch images"* for `amd64`
  and `arm64`. I confirmed this directly against the registry: the manifest for
  `ghcr.io/home-assistant/base-python:3.13-alpine3.24` is an OCI image index containing
  `linux/amd64` and `linux/arm64` entries. So a plain `FROM ghcr.io/home-assistant/base-python:3.13-alpine3.24`
  resolves correctly on the Pi with no `{arch}` templating.
  Source: <https://github.com/home-assistant/docker-base#supported-architectures>; verified via
  `GET https://ghcr.io/v2/home-assistant/base-python/manifests/3.13-alpine3.24`.
- The base image ships S6-Overlay, Bashio and TempIO, and — usefully for us — already sets
  `UV_EXTRA_INDEX_URL=https://wheels.home-assistant.io/musllinux-index/`, a musl wheel index. So `uv`
  is an anticipated tool here, and the extra index gives us prebuilt musl aarch64 wheels for packages
  that would otherwise need a compiler.
  Source: [`docker-base/alpine/Dockerfile`](https://github.com/home-assistant/docker-base/blob/master/alpine/Dockerfile)

Pin the tag rather than using `latest`: the docs say *"Using a pinned version of the base image is
recommended for better build stability"*, and Supervisor always passes `--pull` when it builds
(§3.1), so an unpinned base would silently move under us.

**Alpine/musl caveat.** This is a musl-libc image, not glibc. FastAPI, Uvicorn, `paho-mqtt` and
`aiosqlite` are fine (pure Python or already shipping musllinux wheels); `pydantic-core` publishes
musllinux aarch64 wheels. If we ever pull in something with only manylinux wheels it will try to
compile on the Pi, which is exactly the kind of surprise we're trying to avoid. `ghcr.io/home-assistant/base-debian`
exists as a glibc escape hatch, but it's larger and the docs prefer Alpine as *"more IoT friendly"*.
Source: <https://github.com/home-assistant/docker-base#debian-images>

### 1.4 `init: false` is not optional

The base images bundle S6-Overlay **3.2.3.0**
(`ARG S6_OVERLAY_VERSION=3.2.3.0` in [`docker-base/alpine/Dockerfile`](https://github.com/home-assistant/docker-base/blob/master/alpine/Dockerfile)),
and the config reference says of `init`:

> *"Set this to `false` to disable the Docker default system init. Use this if the image has its own
> init system (Like s6-overlay). Note: Starting in V3 of S6 setting this to `false` is required or the
> app won't start."*

Source: [App configuration](https://developers.home-assistant.io/docs/apps/configuration#optional-configuration-options)

The tutorial's own example sets `init: false`.
Source: <https://developers.home-assistant.io/docs/apps/tutorial>

### 1.5 Labels

If we build in CI with our own workflow rather than letting the composite actions infer them, we must
add labels ourselves — the new actions no longer synthesise `io.hass.type`, `io.hass.name`,
`io.hass.description` and `io.hass.url` the way the old builder did.
Source: [builder migration blog § labels](https://developers.home-assistant.io/blog/2026/04/02/builder-migration)

The minimum set, per the docs, is:

```dockerfile
LABEL \
  io.hass.version="VERSION" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64"
```
Source: [App configuration § app Dockerfile](https://developers.home-assistant.io/docs/apps/configuration#app-dockerfile)

Note `io.hass.type="app"`, not `"addon"`. When Supervisor builds locally it injects these labels itself
via `--label` on the build command, so for a locally built add-on they are belt-and-braces.
Source: [`supervisor/apps/build.py#get_docker_args`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/build.py)

---

## 2. Getting it onto the Pi: `/addons` vs custom repository

Both are officially supported; they are **orthogonal to the build-location question** (§3), which is
governed solely by whether `image:` is set.

### 2.1 Local add-on in `/addons`

Copy the add-on folder into `/addons` on the HAOS device using the Samba or SSH add-ons; it then
appears under "Local apps" in the store after clicking "Check for updates".
Source: <https://developers.home-assistant.io/docs/apps/tutorial>, <https://developers.home-assistant.io/docs/apps/testing#remote-development>

- Repo identifier `{REPO}` is the literal string `local`, so the container hostname is
  `local-kettlebell` (see §6.2).
- Update loop: edit files on the Mac → copy over Samba/SSH → bump `version` in `config.yaml` → "Check
  for updates" → Update (or Rebuild). Fast to iterate; nothing needs to be committed or pushed.
- Downside: the Pi holds the source of truth for what's deployed, and it can drift from git silently.

### 2.2 Custom add-on repository (this GitHub repo)

Add `repository.yaml` at the repo root:

```yaml
name: Andrew's apps
url: https://github.com/andyalexander/kettle-bell-workout
maintainer: Andrew Alexander <andrew@homeemail.me.uk>
```
Source: <https://developers.home-assistant.io/docs/apps/repository>

The user pastes the repo URL into the store. Supervisor clones the repo and treats each folder
containing a `config.yaml` as an app.

- Update loop: commit and push → "Check for updates" in the store → Update button appears when
  `version` in `config.yaml` is higher than the installed one.
- Repo identifier `{REPO}` becomes a hash of the repository URL, so the hostname is
  `<hash>-kettlebell` — less predictable than `local-`, which matters if anything ever needs to address
  us by name.
  Source: <https://developers.home-assistant.io/docs/apps/communication#network>

### 2.3 Recommendation

**Use the custom repository.** The repo already exists on GitHub, and it makes "what is deployed" a
function of what's pushed rather than what was last dragged over Samba. Keep `/addons` in your pocket
for the awkward hour when you're bisecting a startup failure and don't want a commit per attempt —
the two can coexist (install the local copy, uninstall it, install from the repo).

Practical shape: put the add-on in a subfolder, e.g. `addon/` at the repo root, with the FastAPI
source and the Vite source either inside it (needed if Supervisor builds — the build context is the
add-on folder) or elsewhere (fine if we build in CI, §3.4).

---

## 3. The build-location question

This is the important one, so here is the mechanism first and the trade-offs second.

### 3.1 What Supervisor actually does when it builds on the device

From [`supervisor/apps/build.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/build.py):

```python
build_cmd = [
    "docker", "buildx", "build", ".",
    "--tag", image_tag,
    "--file", str(dockerfile_path),
    "--platform", MAP_ARCH[self.arch],
    "--pull",
]
```

Facts that follow:

- It is a normal **BuildKit** build of the add-on folder, bind-mounted read-only at `/addon`. So the
  build context is the add-on folder and nothing outside it.
- **`--pull` is always passed.** The base image is re-resolved on every build. Pin the base tag or
  every rebuild risks a full cache invalidation.
- **No `--cache-from` / `--cache-to`.** It relies on the host daemon's local layer cache, which does
  persist across rebuilds. So an unchanged `package.json` + `package-lock.json` layer *is* cached
  between rebuilds — the pathological "every rebuild is a cold `npm ci`" case only happens on the first
  build, after a base image bump, or when the lockfile changes.
- `BUILD_VERSION` and `BUILD_ARCH` are passed as build args. `BUILD_FROM` is passed only if a legacy
  `build.yaml` supplied it.
- `Dockerfile.aarch64` takes precedence over `Dockerfile` if present (`get_dockerfile()`), which we
  don't need.

The decision between building and pulling is one line in
[`supervisor/apps/model.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/model.py):

```python
@property
def need_build(self) -> bool:
    """Return True if this app need a local build."""
    return ATTR_IMAGE not in self.data
```

**`image:` present ⇒ pull. `image:` absent ⇒ build on the Pi.** That's the whole switch.

### 3.2 How slow is `npm ci` on a Pi, honestly

I measured the floor on the dev Mac (Apple silicon, arm64), using a minimal but realistic
React 19 + TypeScript + Vite 6 + Tailwind 4 dependency set:

| Step | Mac (arm64) | Result |
| --- | --- | --- |
| `npm ci` | **12.5 s** | 82 packages, 83 MB, 2,625 files in `node_modules` |
| `vite build` (trivial app) | **0.5 s** | 194 KB JS, 4.7 KB CSS |

Extrapolating honestly, and flagging it as extrapolation rather than a measured Pi number:

- `npm ci` is dominated by decompressing and writing thousands of small files. That is I/O and
  single-thread CPU, both of which are where a Pi is weakest — and worst on an SD card, where small
  random writes are the failure mode. A **5–15× factor** is the realistic band, i.e. **roughly
  1–3 minutes** for this dependency set on a Pi 4 with SD, less on a Pi 5 with NVMe.
- A real app's `node_modules` will be several times this (a router, a chart library, test tooling), so
  scale accordingly: **3–8 minutes** is a fair planning number for a maturing front end.
- `vite build` grows with source size and Tailwind's scan, but stays the small half: call it tens of
  seconds on a Pi, not minutes.
- Add to that pulling a `node:*-alpine` stage image (~50 MB compressed) and the Python stage's
  dependency install.

**I have not measured this on the actual Pi and it is the one number in this document that is a
projection.** It is also easy to settle for real: install a throwaway add-on with a node stage and
watch the Supervisor log timestamps. Worth doing before committing to option (a) at scale.

The docs also warn about the wear, not just the wait:

> "This method includes installing and potentially compiling code. This means that installing such an
> app is slow and adds more wear and tear to users' SD cards/hard drives than the above-mentioned
> pre-built solution. It also has a higher chance of failure if one of the dependencies of the
> container has changed or is no longer available."
>
> — [Publishing your app](https://developers.home-assistant.io/docs/apps/publishing)

### 3.3 Option (b): commit the built `dist/` to the repo

Mechanically fine. `config.yaml` has no `image:`, the Dockerfile is single-stage Python, and it just
`COPY`s a checked-in `dist/` into the image. Supervisor's build becomes a Python-only build:
seconds-to-a-minute on the Pi.

Costs:

- **Every front-end change is a binary diff in git.** Hashed asset filenames mean each build adds new
  files rather than modifying existing ones, so the repo grows monotonically. Blame, diffs and reviews
  become noise.
- **The build artefact and its source can silently disagree.** There is no mechanism forcing `dist/` to
  correspond to `src/`. Forget one `npm run build` and you ship a stale UI while the code says
  otherwise — a genuinely nasty failure mode because everything *looks* correct.
- It taxes the loop we care most about, the UI loop, at exactly the wrong moment: you'd be running
  `npm run build` and committing generated files as part of "tweak a font size".

There is a narrow case for it — a hobby add-on you touch twice a year, where a committed `dist/` means
the whole thing installs in 40 seconds. That is not the shape of this project, where the map says the
UI is iterated on until it's legible across a room.

### 3.4 Option (c): build in GitHub Actions, publish to ghcr.io, `image:` in config.yaml

This is the path the docs call **preferred**:

> "With pre-built containers, the developer is responsible for building the images for each
> architecture and pushing the results to a container registry. This has a lot of advantages for the
> user who will only have to download the final container and be up and running once the download
> finishes. This makes the installation process fast and has almost no chance of failure, so it is the
> preferred method."
>
> — [Publishing your app](https://developers.home-assistant.io/docs/apps/publishing)

Mechanics:

- Use the composite actions from `home-assistant/builder`: `prepare-multi-arch-matrix` →
  `build-image` (per arch) → `publish-multi-arch-manifest`. A complete example workflow is in the
  builder README and in [`home-assistant/apps-example`](https://github.com/home-assistant/apps-example/blob/main/.github/workflows/builder.yaml).
  Source: <https://github.com/home-assistant/builder#example-workflow>
- We only need `aarch64` (the Pi). `amd64` is worth adding anyway so the image runs in the devcontainer
  on the Mac under emulation, and it costs one extra matrix leg on a free runner.
- Set the generic multi-arch name in `config.yaml`:

  ```yaml
  image: "ghcr.io/andyalexander/kettlebell-addon"
  ```

  The `{arch}` placeholder is a compatibility fallback only; the generic name is preferred now that
  base and app images are multi-arch manifests.
  Source: [Publishing § image naming](https://developers.home-assistant.io/docs/apps/publishing#image-naming)
- **`version` in `config.yaml` must equal the image tag.** The config reference is explicit: *"Version
  of the app. If you are using a docker image with the `image` option, this needs to match the tag of
  the image that will be used."* So a release bumps `version` and tags the image identically — one
  commit, or a release workflow that does both.
  Source: [App configuration § required configuration options](https://developers.home-assistant.io/docs/apps/configuration#required-configuration-options)
- **The GHCR package must be public**, or Supervisor cannot pull it anonymously. Private registries
  *are* supported (`POST /docker/registries`, and Supervisor injects a `config.json` into the build
  container — see `get_docker_config_json` in `supervisor/apps/build.py`), but that's per-device
  credential setup for a LAN-only hobby app. Make the package public and skip it.
  Source: <https://developers.home-assistant.io/docs/api/supervisor/endpoints>
- Build time on a GitHub runner: the `aarch64` leg cross-builds under QEMU on an x86 runner unless a
  native arm64 runner is selected. `npm ci` under QEMU is slow — expect a few minutes — but it's a few
  minutes of somebody else's CPU, running in parallel with you doing something else.

Costs:

- Every UI tweak now goes through a CI round trip before it can be seen on the Pi. That's minutes of
  latency on a loop you want to be seconds.
- More moving parts: a workflow, GHCR permissions, package visibility, version/tag coupling.
- Debugging a build failure means reading CI logs, not the Supervisor log.

### 3.5 The false dilemma, and the recommendation

The framing in the ticket — pick one — misses that the two ends of the loop have different needs:

- **Day-to-day UI iteration does not go through the add-on at all.** Vite's dev server on the Mac,
  pointed at the FastAPI backend, is the loop for "make the timer digits bigger". Sub-second HMR. No
  Docker, no Pi, no Supervisor. Nothing in this document should be allowed to intrude on that loop.
- **The add-on build is the *deploy* step**, and it happens when you want to train with it, not when
  you want to see a font change.

Once you see it that way, the multi-stage-on-Pi build is not on a hot path, and the cost of option (a)
mostly evaporates.

**Recommendation, in two stages:**

**Stage 1 — start with (a): multi-stage Dockerfile, no `image:` key, built on the Pi by Supervisor.**

- Zero infrastructure. One `git push`, one "Update" click.
- The Dockerfile is the single source of truth, which is exactly the direction the project moved in
  April 2026 — `docker build` locally reproduces what the Pi does, byte for byte, so you can debug a
  build failure on the Mac (`docker build --platform linux/arm64 .`, per
  [Local app testing](https://developers.home-assistant.io/docs/apps/testing#local-build)).
- The layer cache makes the *second* and subsequent builds much cheaper than the first, because
  `package-lock.json` rarely changes. Order the Dockerfile so this is true (copy lockfiles, install,
  *then* copy source).
- Nothing generated is committed, so git stays honest.

**Stage 2 — move to (c) when, and only when, the Pi build actually annoys you.**

The migration is genuinely cheap and non-destructive: add the workflow, add one line (`image:`) to
`config.yaml`. The Dockerfile is unchanged — it's the same file the CI actions consume. `/data`
survives the switch (§5). So this is not a decision you need to get right now; it's a decision you can
defer until you have a measured Pi build time to justify it.

**Reject (b) outright.** Committing `dist/` buys a build-time saving that stage 2 buys properly, and
pays for it with a permanently dishonest repository.

**Do this early, whichever option you're on:** measure one real Supervisor build on the Pi and write
the number down. It converts the §3.2 projection into a fact and makes the stage-1→stage-2 trigger
objective.

---

## 4. Concrete sketches

### 4.1 `config.yaml`

```yaml
name: Kettlebell Trainer
version: "0.1.0"
slug: kettlebell
description: >-
  EMOM and interval kettlebell workouts, with results published to
  Home Assistant over MQTT.
url: https://github.com/andyalexander/kettle-bell-workout
arch:
  - aarch64
  - amd64

init: false          # required: base images use S6-Overlay v3
startup: services    # start before Home Assistant Core
boot: auto

ports:
  8234/tcp: 8234
ports_description:
  8234/tcp: Web interface

webui: "http://[HOST]:[PORT:8234]/"
watchdog: "http://[HOST]:[PORT:8234]/api/health"

services:
  - mqtt:need        # Supervisor hands us broker host/port/credentials

backup: cold         # stop the app before backing up, so SQLite is quiescent

options:
  log_level: info
  mqtt_discovery_prefix: homeassistant
schema:
  log_level: "list(debug|info|warning|error)"
  mqtt_discovery_prefix: str

# Stage 2 only — adding this line switches Supervisor from building to pulling.
# The tag must equal `version` above.
# image: "ghcr.io/andyalexander/kettlebell-addon"
```

Notes:

- No `map:` entry. `/data` is mapped unconditionally (§5).
- No MQTT host/username/password in `options`. See §6.
- Port 8234 is arbitrary but chosen to avoid 8123 (Core), 4357 (Observer), 1883/1884 (Mosquitto),
  8099 (the default ingress port — internal only, but avoid the confusion).
- `backup: cold` is a judgement call, not a doc requirement — see §5.3.

### 4.2 `Dockerfile` — multi-stage, stage 1

```dockerfile
# ---------- front end ----------
FROM node:22-alpine AS frontend

WORKDIR /build

# Lockfile layer first, so `npm ci` is cached across rebuilds
# whenever dependencies haven't changed.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build          # -> /build/dist

# ---------- runtime ----------
FROM ghcr.io/home-assistant/base-python:3.13-alpine3.24

# uv, per the project's Python rules — never pip.
# The base image already sets UV_EXTRA_INDEX_URL to the HA musllinux wheel index.
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

# Dependency layer, cached independently of application source.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/ ./
RUN uv sync --locked --no-dev

# Static assets from the front-end stage; FastAPI mounts this directory.
COPY --from=frontend /build/dist /app/static

COPY run.sh /
RUN chmod a+x /run.sh

# Supervisor injects these when it builds; declared so plain `docker build` works too.
ARG BUILD_VERSION="dev"
ARG BUILD_ARCH="aarch64"

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.title="Kettlebell Trainer" \
  org.opencontainers.image.source="https://github.com/andyalexander/kettle-bell-workout"

CMD [ "/run.sh" ]
```

Why it's shaped like this:

- Two `uv sync` calls with the project source in between: the first resolves and installs third-party
  dependencies into a layer keyed on `uv.lock` alone, so editing backend source doesn't reinstall
  FastAPI. This matters precisely because Supervisor keeps the host layer cache between rebuilds
  (§3.1).
- `COPY --from=ghcr.io/astral-sh/uv:0.9` avoids `pip install uv`, honouring the project's "uv only,
  never pip" rule inside the image as well as outside it. Pin the minor tag.
- The base tag is pinned because Supervisor always builds with `--pull`.
- `CMD [ "/run.sh" ]` — the base image's `ENTRYPOINT` is `/init` (S6), which the config's
  `init: false` leaves in charge. Matches the tutorial's shape exactly.
  Source: [`docker-base/alpine/Dockerfile`](https://github.com/home-assistant/docker-base/blob/master/alpine/Dockerfile),
  [tutorial](https://developers.home-assistant.io/docs/apps/tutorial)

Stage 2 changes nothing in this file. The CI `build-image` action consumes the same Dockerfile.

### 4.3 `run.sh`

```bash
#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Kettlebell Trainer..."

export KB_DATABASE_PATH="/data/kettlebell.db"
export KB_LOG_LEVEL="$(bashio::config 'log_level')"
export KB_MQTT_DISCOVERY_PREFIX="$(bashio::config 'mqtt_discovery_prefix')"

if bashio::services.available "mqtt"; then
  export KB_MQTT_HOST="$(bashio::services mqtt 'host')"
  export KB_MQTT_PORT="$(bashio::services mqtt 'port')"
  export KB_MQTT_USERNAME="$(bashio::services mqtt 'username')"
  export KB_MQTT_PASSWORD="$(bashio::services mqtt 'password')"
else
  bashio::log.warning "No MQTT service registered with the Supervisor."
fi

exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8234
```

`#!/usr/bin/with-contenv bashio` and the `bashio::services` calls are both straight from the docs.
Source: [App configuration § app script](https://developers.home-assistant.io/docs/apps/configuration#app-script),
[App communication § services API](https://developers.home-assistant.io/docs/apps/communication#services-api)

`--host 0.0.0.0` is required: the container has its own network namespace, and binding to `127.0.0.1`
would make the published port unreachable.

---

## 5. Persistence: is `/data` right, and does it survive updates?

**Yes on both counts, and it's confirmed in the Supervisor source, not just the docs.**

### 5.1 `/data` is always mapped

The docs state `/data` is *"a volume for persistent storage"* and that *"the `data` directory is always
mapped and writable"* — so unlike `share` or `homeassistant_config`, we do **not** need a `map:` entry
for it.
Source: [App configuration § app script](https://developers.home-assistant.io/docs/apps/configuration#app-script)
and the `map` row in [§ optional configuration options](https://developers.home-assistant.io/docs/apps/configuration#optional-configuration-options)

On the host it lives at `<supervisor data>/addons/data/<slug>`:

```python
@property
def path_data(self) -> Path:
    """Return app data path inside Supervisor."""
    return Path(self.sys_config.path_apps_data, self.slug)
```
Source: [`supervisor/apps/app.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/app.py)

`/data/options.json` also lives here — the user's `options` values, written by Supervisor before start
(`path_options` is `Path(self.path_data, "options.json")`). So the SQLite file sits alongside it. Give
it a distinct name (`kettlebell.db`) and never write anything to `/data` that could collide with
`options.json`.

### 5.2 Survival matrix (read from the Supervisor source)

| Operation | `/data` |
| --- | --- |
| **Update** (new version) | **Preserved.** `Addon.update()` pulls/builds the new image, stops, swaps, restarts. It never touches `path_data`. |
| **Rebuild** | **Preserved.** `rebuild()` removes the container and image and reinstalls — no `path_data` call in the method. |
| **Restart / stop / start** | Preserved, trivially. |
| **Uninstall** | **Destroyed.** `uninstall()` calls `unload()`, whose `remove_data_dir()` does `remove_data(self.path_data)` — logging *"Removing app data folder %s"*. |
| **Backup** | **Included.** `backup()` adds `self.path_data` to the tar under `arcname="data"`. |
| **Restore** | Replaced from the tar. |

Source: [`supervisor/apps/app.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/app.py) — `update()`, `rebuild()`, `unload()`, `uninstall()`, `backup()`, `restore()`.

**The one to remember: uninstalling deletes the database, silently, with no confirmation specific to
`/data`.** If you ever uninstall to "start clean", the training history goes with it. Take a backup
first, or grab the file over SSH/Samba.

Note the asymmetry: uninstall offers a `remove_config` flag for the *public* config folder
(`/addon_configs/...`), but `/data` is removed unconditionally.

### 5.3 `backup: hot` vs `cold`

The default is `hot` — the container keeps running while the tar is written. For SQLite that risks
capturing a torn file if a write is in flight. `backup: cold` makes Supervisor stop the app first,
which for a single-user app used a few times a week costs nothing.
Source: [App configuration § optional configuration options](https://developers.home-assistant.io/docs/apps/configuration#optional-configuration-options)

If you'd rather keep `hot`, the alternative is `backup_pre`/`backup_post` commands running a
`VACUUM INTO` or `sqlite3 .backup` to produce a consistent snapshot. Both keys exist for exactly this.
`cold` is simpler and I'd take it.

Related but out of scope here: the map lists "Backup and restore of the SQLite database on the Pi" as
not yet specified. Add-on backups cover it as long as they are actually being taken.

---

## 6. Networking and configuration

### 6.1 What `ports` does, and the resulting LAN URL

`ports` is a straight Docker port publish. Supervisor filters out `null` host ports and hands the rest
to the Docker API as the container's `ports` argument:

```python
@property
def ports(self) -> dict[str, str | int | None] | None:
    """Filter None from app ports."""
    if self.app.host_network or not self.app.ports:
        return None
    return {
        container_port: host_port
        for container_port, host_port in self.app.ports.items()
        if host_port
    }
```
Source: [`supervisor/docker/app.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/docker/app.py)

With `8234/tcp: 8234` the host publishes on all interfaces, so the app is reachable at:

- **`http://192.168.2.10:8234/`**
- `http://homeassistant.local:8234/` (mDNS)

The tutorial confirms the pattern end to end: it maps `8000/tcp: 8000` and then says *"navigate to
http://homeassistant.local:8000 to see our server in action"*.
Source: <https://developers.home-assistant.io/docs/apps/tutorial>

The user can remap the host port in the UI; `webui: "http://[HOST]:[PORT:8234]/"` uses the *internal*
port as the key and Supervisor substitutes whatever the effective host port is, so the "OPEN WEB UI"
button stays correct if they do.
Source: [App configuration](https://developers.home-assistant.io/docs/apps/configuration#optional-configuration-options)

`host_network: true` is not needed and shouldn't be used — it would put us on the host network and,
per the communication docs, make us *unaddressable by name* from other add-ons.

### 6.2 Reaching the MQTT broker by hostname

> "We use an internal network that's allowed to communicate with every app, including to/from Home
> Assistant, by using its name or alias. [...] The name is generated using the following format:
> `{REPO}_{SLUG}`, for example, `local_xy` or `3283fh_myaddon`. You can use this name as the DNS name
> also, but you need to replace any `_` with `-` to have a valid hostname."
>
> — [App communication § network](https://developers.home-assistant.io/docs/apps/communication#network)

Confirmed in the source — `hostname` is the slug with underscores swapped for hyphens, registered in
the Supervisor DNS plugin with a `.local.hass.io` suffix:

```python
@property
def hostname(self) -> str:
    """Return slug/id of app."""
    return self.slug.replace("_", "-")
```
Source: [`supervisor/apps/model.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/apps/model.py); `DNS_SUFFIX = "local.hass.io"` in [`supervisor/const.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/const.py)

So **if** the broker is the official Mosquitto add-on (slug `core_mosquitto`), it is reachable at
**`core-mosquitto:1883`** from inside our container.

**Ambiguity worth resolving before we write MQTT code.** The verified environment facts say "an MQTT
broker is already running on 192.168.2.10:1883" — that establishes the port, not the provenance. If
it's the Mosquitto add-on, hostname routing and the services API (§6.3) both work. If it's a broker
running elsewhere on the LAN, or on the host outside Supervisor, neither does, and we'd need explicit
host/port options after all. **Check `Settings → Add-ons` for "Mosquitto broker" before building on
this assumption.** Everything in §6.3 is contingent on it.

Don't hardcode the IP either way: `192.168.2.10:1883` from inside the container would leave the
internal network, hairpin off the host, and break the moment the Pi's address changes.

### 6.3 Should MQTT credentials go in `options`/`schema`? **No.**

There is a purpose-built mechanism and this is exactly what it's for:

> "We have an internal services API to make services public to other apps without the user needing to
> add any configuration. An app can get the full configuration for a service to use and to connect to
> it. The app needs to mark the usage of a service in the app configuration to be able to access a
> service."
>
> — [App communication § services API](https://developers.home-assistant.io/docs/apps/communication#services-api)

`mqtt` is one of the two supported services. Declare it in `config.yaml`:

```yaml
services:
  - mqtt:need
```

`need` means the app requires it — Supervisor will surface an error if no MQTT service is registered,
which is better than us failing obscurely at runtime. (`want` is the softer variant, `provide` is for
brokers.)
Source: [App configuration § optional configuration options](https://developers.home-assistant.io/docs/apps/configuration#optional-configuration-options)

Then read it in `run.sh` with bashio, exactly as the docs show:

```bash
MQTT_HOST=$(bashio::services mqtt "host")
MQTT_USER=$(bashio::services mqtt "username")
MQTT_PASSWORD=$(bashio::services mqtt "password")
```
Source: [App communication § services API](https://developers.home-assistant.io/docs/apps/communication#services-api)

Under the hood that's `GET http://supervisor/services/mqtt`, returning `addon`, `host`, `port`, `ssl`,
`username`, `password`, `protocol`.
Source: [Supervisor API endpoints § /services/mqtt](https://developers.home-assistant.io/docs/api/supervisor/endpoints)

Why this beats putting credentials in `options`:

- Zero configuration for the user — no copying a password from the Mosquitto add-on into ours.
- Credentials aren't stored a second time in Supervisor's add-on options, where they're visible in the
  options UI and included in backups as plaintext.
- If the broker's credentials rotate, we pick up the change on restart.
- Note the endpoint is in the list of Supervisor API paths callable **without** setting
  `hassio_api: true` (`/services*` is explicitly listed), so we don't need to widen our API permissions.
  Source: [App communication § Supervisor API](https://developers.home-assistant.io/docs/apps/communication#supervisor-api)

### 6.4 What `options`/`schema` *is* right for

Genuine user preferences that the Supervisor cannot infer. For us that's a short list: `log_level`, and
the MQTT discovery prefix if we want it configurable. Everything else — database path, port, broker
credentials — is either fixed by the add-on contract or supplied by Supervisor.

Mechanics: Supervisor writes the merged options to `/data/options.json` before start
(`path_options = Path(self.path_data, "options.json")`), and `bashio::config 'key'` reads it. A Python
app could equally `json.load(open("/data/options.json"))` and skip bashio, but going through `run.sh`
keeps one convention for both options and services.
Source: [App configuration § app script](https://developers.home-assistant.io/docs/apps/configuration#app-script)

Schema types available: `str`, `bool`, `int`, `float`, `email`, `url`, `password`, `port`,
`match(REGEX)`, `list(a|b|c)`, `device`, with `?` suffix for truly optional values.
Source: [App configuration § options / schema](https://developers.home-assistant.io/docs/apps/configuration#options--schema)

One gotcha for later: removing an option from `schema` after users have it set produces
`Option '<key>' does not exist in the schema` warnings; the docs show the `bashio::addon.option` dance
to clean up. With one user this is a non-issue, but it's why option names are worth getting right early.

---

## 7. Local testing before it ever touches the Pi

Two documented routes, both worth having:

1. **Devcontainer.** `home-assistant/devcontainer` runs Supervisor + Core in VS Code with the repo's
   apps mounted as local apps, reachable at `http://localhost:7123/`. This is the *"fastest and
   recommended way"* per the docs, and it means a broken `config.yaml` costs seconds rather than a
   round trip to the Pi.
   Source: [Local app testing](https://developers.home-assistant.io/docs/apps/testing)
2. **Plain Docker.** Since the Dockerfile is now the whole build definition:

   ```bash
   docker build --platform linux/arm64 -t local/kettlebell .
   docker run --rm -v /tmp/kb_data:/data -p 8234:8234 local/kettlebell
   ```

   Note the arch naming trap the docs call out: HA's `aarch64` is Docker's `linux/arm64`.
   Source: [Local app testing § local build / local run](https://developers.home-assistant.io/docs/apps/testing#local-build)

   Both machines are arm64, so this is a native build on the Mac — no QEMU, and a fair proxy for the
   Pi build apart from raw speed.

For local Docker runs, hand-write a `/tmp/kb_data/options.json` to stand in for Supervisor. There's no
MQTT service to query, so the `bashio::services.available` guard in `run.sh` matters.

---

## 8. Summary of recommendations

| Question | Answer |
| --- | --- |
| **Where does the Vite bundle get built?** | **On the Pi, multi-stage Dockerfile, no `image:` key** — for now. Move to GitHub Actions + ghcr.io when the Pi build time actually irritates; it's a one-line change to `config.yaml`. Never commit `dist/`. |
| Base image | `ghcr.io/home-assistant/base-python:3.13-alpine3.24`, pinned. Multi-arch, includes S6 + bashio, presets the musl wheel index. |
| `build.yaml` | **Don't write one.** Retired April 2026; everything goes in the Dockerfile. |
| `init` | `false`. Required with S6-Overlay v3. |
| Getting it onto the Pi | Custom add-on repository (`repository.yaml` at repo root). Keep `/addons` for hairy debugging. |
| SQLite location | `/data/kettlebell.db`. No `map:` needed. Survives update, rebuild and restart; **destroyed by uninstall**; included in backups. |
| Backups | Set `backup: cold` so SQLite is quiescent when the tar is written. |
| LAN URL | `http://192.168.2.10:8234/` (and `homeassistant.local:8234`). Bind uvicorn to `0.0.0.0`. |
| MQTT broker address | `core-mosquitto:1883` **if** it's the Mosquitto add-on — verify this. Never the LAN IP. |
| MQTT credentials | **Not** in `options`. `services: [mqtt:need]` + `bashio::services mqtt ...`. |
| `options`/`schema` | Only real user preferences: `log_level`, discovery prefix. |

## 9. Open questions this research did not settle

1. **Is the broker on 192.168.2.10:1883 the Mosquitto add-on?** §6.2/§6.3 depend on it. Cheap to check
   in the add-on list; changes the MQTT config design if not.
2. **How slow is a Supervisor build on *this* Pi?** §3.2 is a projection from Mac timings. One real
   build, read off the Supervisor log, replaces it — and it's the trigger condition for moving to CI
   builds.
3. **Pi model and storage** (Pi 4 vs 5, SD vs SSD/NVMe) — swings the build-time answer by several times
   and wasn't in the verified environment facts.

---

## Sources

- [Developing an app (index)](https://developers.home-assistant.io/docs/apps)
- [App configuration](https://developers.home-assistant.io/docs/apps/configuration)
- [Tutorial: Making your first app](https://developers.home-assistant.io/docs/apps/tutorial)
- [App communication](https://developers.home-assistant.io/docs/apps/communication)
- [Local app testing](https://developers.home-assistant.io/docs/apps/testing)
- [Publishing your app](https://developers.home-assistant.io/docs/apps/publishing)
- [Create an app repository](https://developers.home-assistant.io/docs/apps/repository)
- [Presentation](https://developers.home-assistant.io/docs/apps/presentation)
- [Supervisor API endpoints](https://developers.home-assistant.io/docs/api/supervisor/endpoints)
- [Blog: Migrating app builds to Docker BuildKit (2026-04-02)](https://developers.home-assistant.io/blog/2026/04/02/builder-migration)
- [`home-assistant/supervisor`](https://github.com/home-assistant/supervisor) — `supervisor/apps/{app,build,model}.py`, `supervisor/docker/app.py`, `supervisor/const.py`
- [`home-assistant/docker-base`](https://github.com/home-assistant/docker-base) — `README.md`, `alpine/Dockerfile`, `python/3.13/Dockerfile`
- [`home-assistant/builder`](https://github.com/home-assistant/builder) — composite actions and example workflow
- [`home-assistant/apps-example`](https://github.com/home-assistant/apps-example)
