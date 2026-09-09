# The MQTT contract: what we publish, where, and how Home Assistant reads it

Research for the MQTT discovery ticket on `andyalexander/kettle-bell-workout`. Every claim below
cites a primary source: the Home Assistant MQTT integration documentation, the Home Assistant
developer documentation, Home Assistant Core source, Supervisor source, the official Mosquitto
add-on source, bashio source, or the libraries' own repositories. Anything I could not verify
against one of those is labelled **unverified**.

Researched 2026-09-09 against `home-assistant/core@dev`, `home-assistant/supervisor@main`,
`home-assistant/addons@master` and the current `home-assistant.io` docs source.

Vocabulary is [`CONTEXT.md`](../../CONTEXT.md): profile, exercise, routine, slot, weight override,
turn, round, session, prescription, volume. No synonyms are introduced.

Consistency note: this document **agrees** with
[`docs/research/addon-packaging.md`](addon-packaging.md) §6.2/§6.3 on credentials and broker
addressing, and extends it with one addition to `run.sh` (§5.3). It contradicts nothing there.

---

## 0. The answer in one page

| | Decision |
| --- | --- |
| Discovery style | **Device-based discovery.** One retained payload per profile at `homeassistant/device/kettlebell_profile_<id>/config`. Not per-entity discovery. |
| Abbreviated keys | **No.** Use full key names (`unique_id`, not `uniq_id`). Abbreviations exist for memory-constrained firmware; we are a Python app publishing a few hundred bytes a day. |
| HA devices | **One HA device per profile.** Not one device for the app. Identifiers `kettlebell_profile_<id>`. |
| Entities per profile | 5: `last_workout` (timestamp), `last_routine` (text), `last_volume` (kg), `sessions` (count), `volume` (kg). |
| Rejected metrics | **Current streak** — undefined in the domain model (§2.4). **Sessions this week** — replaced by a lifetime `sessions` total, because a "this week" number goes stale the moment the week rolls over (§2.3). |
| State topic | One JSON document per profile at `kettlebell/profile/<id>/state`, retained, shared by all five components via a root-level `state_topic` plus per-component `value_template`. |
| Retention | **Retain both** the discovery payload and the state payload. This is what makes entities and their values survive an HA restart with no birth-message subscription on our side. |
| Availability / LWT | **None.** No `availability_topic`, no Last Will. Our entities are statements about the past; going `unavailable` when the add-on stops would be wrong (§4.4). |
| Credentials | Unchanged from `addon-packaging.md`: `services: [mqtt:need]` + `bashio::services mqtt ...` into `KB_MQTT_*`. Add `KB_MQTT_SSL` (§5.3). |
| Library | **`paho-mqtt`**, via the one-shot `paho.mqtt.publish.multiple()` helper, run in a worker thread. Connect-publish-disconnect, no long-lived connection. Not `aiomqtt` (§6). |
| Integration point | Publish discovery on FastAPI lifespan startup; publish discovery + state again after each session completes, in a background task, after the DB commit, inside a `try/except Exception` that only logs. |

---

## 1. Discovery payloads

### 1.1 The two discovery styles, and which HA prefers

The topic grammar:

```text
<discovery_prefix>/<component>/[<node_id>/]<object_id>/config
```

> - `<discovery_prefix>`: The Discovery Prefix defaults to `homeassistant` and this prefix can be changed.
> - `<component>`: One of the supported MQTT integrations, for example, `binary_sensor`, or `device` in case of device discovery.
> - `<node_id>`: (*Optional*): ID of the node providing the topic, this is not used by Home Assistant but may be used to structure the MQTT topic. The ID of the node must only consist of characters from the character class `[a-zA-Z0-9_-]` (alphanumerics, underscore and hyphen).
> - `<object_id>`: The ID of the device. This allows for separate topics for each device. The ID of the device must only consist of characters from the character class `[a-zA-Z0-9_-]` (alphanumerics, underscore and hyphen).

Source: [MQTT § Discovery topic](https://www.home-assistant.io/integrations/mqtt/#discovery-topic)
([source md](https://github.com/home-assistant/home-assistant.io/blob/current/source/_integrations/mqtt.markdown))

There are two kinds of payload, and the docs state the preference plainly:

> MQTT discovery supports two types of discovery messages:
>
> - Device discovery, which allows you to include several components in a single discovery message
> - Single component discovery, where you publish a separate discovery message for each component
>
> **If you use a device with multiple components, it is recommended to use MQTT device discovery. It reduces the number of messages sent, and allows you to send the device information only once.**

Source: [MQTT § Discovery messages](https://www.home-assistant.io/integrations/mqtt/#discovery-messages)

Device-based discovery was added in **Home Assistant 2024.11**:

> [@jbouwh](https://github.com/jbouwh) added support for [MQTT device-based auto discovery](https://www.home-assistant.io/integrations/mqtt/#device-discovery-payload). This allows MQTT devices to be set up and discovered once instead of separately for each entity; which is much more efficient.

Source: [2024.11 release notes](https://www.home-assistant.io/blog/2024/11/06/release-202411/)

**Decision: device-based discovery.** We publish five sensors that all belong to one profile and all
read from one state topic. That is exactly the shape device discovery was introduced for: one
message, one copy of the device block, one copy of the shared `state_topic`. Per-entity discovery
would mean five retained topics per profile carrying five identical copies of the device block, and
five separate cleanup topics when a profile is removed.

**Rejected alternative:** per-entity discovery
(`homeassistant/sensor/kettlebell_p1_last_workout/config` × 5 × N profiles). Its only advantage is
compatibility with Home Assistant older than 2024.11, which is not a constraint we have. If it ever
becomes one, the docs describe a supported migration path in both directions via a
`{"migrate_discovery": true}` payload
([MQTT § Migration from single component to device discovery](https://www.home-assistant.io/integrations/mqtt/#migration-from-single-component-to-device-discovery)).

### 1.2 Rules for a device discovery payload

> The shared options at the root level of the JSON message must include:
>
> - `device` mapping (abbreviated as `dev`)
> - `origin` mapping (abbreviated as `o`)
>
> These mappings are mandatory and cannot be overridden at the entity/component level.
>
> Supported shared options are:
>
> - The `availability` options.
> - The `origin` (required) options
> - `command_topic`
> - `state_topic`
> - `qos`
> - `encoding`

> A component config part in a device discovery payload must have the `platform` (`p`) option set with the name of the `component` and also must have at least one component specific config option. Entity components must have set the `unique_id` option and have a `device` context.

Source: [MQTT § Device discovery payload](https://www.home-assistant.io/integrations/mqtt/#device-discovery-payload)

Note the consequence for us: **`state_topic` is a supported shared option**, so one root-level
`state_topic` serves every component and each component distinguishes itself with a
`value_template`. That is the whole reason one JSON state document works.

The `origin` block:

> `name`: The name of the application that is the origin of the discovered MQTT item. (Required)
> `sw_version`: Software version of the application that supplies the discovered MQTT item.
> `support_url`: Support URL of the application that supplies the discovered MQTT item.

Source: [MQTT § Discovery payload](https://www.home-assistant.io/integrations/mqtt/#discovery-payload)

### 1.3 `unique_id` rules

`unique_id` does three things, all of which we want:

1. It makes the entity user-editable in the entity registry:
   > For every configured MQTT entity Home Assistant automatically assigns a unique `entity_id`. If the `unique_id` option is configured, you can change the `entity_id` after creation, and the changes are stored in the Entity Registry.

   Source: [MQTT § Naming of MQTT Entities](https://www.home-assistant.io/integrations/mqtt/#naming-of-mqtt-entities)

2. It is **required** for entity components inside a device discovery payload (quoted in §1.2).

3. It is what makes an entity survive a restart:
   > When Home Assistant is restarting, discovered MQTT items with a unique ID will be unavailable until a new discovery message is received. **MQTT items without a unique ID will not be added at startup.**

   Source: [MQTT § Discovery messages and availability](https://www.home-assistant.io/integrations/mqtt/#discovery-messages-and-availability)

A `unique_id` must be unique across the whole MQTT integration, not just within our device, so every
one of ours is prefixed `kettlebell_`. It must also be **stable forever** — changing it orphans the
old entity in the registry and creates a new one. Ours are derived from the profile's database id,
never from the profile's name, because a profile can be renamed.

### 1.4 What puts entities on one HA device page

The `device` block, keyed on `identifiers`. From the docs on entity naming:

> This means any MQTT entity which is part of a device will automatically have its `friendly_name` attribute prefixed with the device name […] Note that on each MQTT entity, the `has_entity_name` attribute will be set to `True`.

Source: [MQTT § Naming of MQTT Entities](https://www.home-assistant.io/integrations/mqtt/#naming-of-mqtt-entities),
[developer docs § `has_entity_name`](https://developers.home-assistant.io/docs/core/entity/#has_entity_name-true-mandatory-for-new-integrations)

Two entities land on the same device page when their `device` blocks share an entry in
`identifiers` (or `connections`). For single-component discovery the docs additionally require a
name alongside:

> The mandatory fields were previously limited to at least one of `connection` and `identifiers`, but have now been extended to at least one of `connection` and `identifiers` as well as the `name`.

Source: [MQTT § Single component discovery payload](https://www.home-assistant.io/integrations/mqtt/#single-component-discovery-payload)

With device discovery this is moot — there is only one `dev` block per payload — but the rule
matters if we ever fall back.

The device abbreviation table (`homeassistant/components/mqtt/abbreviations.py`, `DEVICE_ABBREVIATIONS`)
is the authoritative list of allowed device fields:
`connections`, `configuration_url`, `identifiers`, `name`, `manufacturer`, `model`, `model_id`,
`hw_version`, `sw_version`, `suggested_area`, `serial_number`.
Source: [`abbreviations.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/abbreviations.py)

`configuration_url` is worth setting — it turns the device page into a link back to the add-on's web
UI.

### 1.5 Abbreviated keys: don't

Every key has a short form (`uniq_id`, `stat_t`, `dev_cla`, `stat_cla`, `unit_of_meas`, `val_tpl`,
`ic`, `p`, `cmps`, `dev`, `o`, …), listed in
[`abbreviations.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/abbreviations.py)
and in the docs' [supported abbreviations table](https://www.home-assistant.io/integrations/mqtt/#supported-abbreviations-in-mqtt-discovery-messages).
The stated purpose is memory, not style:

> Configuration variable names in the discovery payload may be abbreviated **to conserve memory when sending a discovery message from memory constrained devices**.

Source: [MQTT § Discovery payload](https://www.home-assistant.io/integrations/mqtt/#discovery-payload)

**Decision: full key names.** A full payload for one profile is under 2 kB, published a handful of
times a day from a Python process on a Pi. The abbreviations buy nothing and cost readability in
`mosquitto_sub` output, in logs, and in this repository. The one exception is `cmps` vs
`components` — both are accepted; use `components`.

### 1.6 The topic strings, concretely

With the default discovery prefix (`KB_MQTT_DISCOVERY_PREFIX`, default `homeassistant`) and a
profile whose database id is `1`:

| Purpose | Topic | Retained |
| --- | --- | --- |
| Discovery, profile 1 | `homeassistant/device/kettlebell_profile_1/config` | yes |
| State, profile 1 | `kettlebell/profile/1/state` | yes |
| Removal, profile 1 | empty payload to `homeassistant/device/kettlebell_profile_1/config` | yes |

The docs' best-practice note — *"Best practice for entities with a `unique_id` is to set
`<object_id>` to the `unique_id` and omit the `<node_id>`"*
([Discovery topic](https://www.home-assistant.io/integrations/mqtt/#discovery-topic)) — applies to
the device here: `<object_id>` is the device's identifier, and we omit `<node_id>` entirely.

Also note, because it trips people up:

> The `<object_id>` in the topic does not influence the resulting `entity_id`; use `default_entity_id` if you need to control the `entity_id`.

Source: [MQTT § Discovery topic](https://www.home-assistant.io/integrations/mqtt/#discovery-topic)

So we set `default_entity_id` explicitly on each component to get predictable entity IDs:

> Use `default_entity_id` instead of name for automatic generation of the entity ID. For example, `sensor.foobar`. […] When used with a `unique_id`, the `default_entity_id` is only used when the entity is added for the first time.

Source: [MQTT Sensor § configuration](https://www.home-assistant.io/integrations/sensor.mqtt/)
([source md](https://github.com/home-assistant/home-assistant.io/blob/current/source/_integrations/sensor.mqtt.markdown))

### 1.7 The discovery payload, copy-pasteable

Published **retained**, QoS 1, to `homeassistant/device/kettlebell_profile_1/config`:

```json
{
  "device": {
    "identifiers": ["kettlebell_profile_1"],
    "name": "Kettlebell Andy",
    "manufacturer": "Kettlebell Trainer",
    "model": "Training profile",
    "sw_version": "0.1.0",
    "configuration_url": "http://homeassistant.local:8234/"
  },
  "origin": {
    "name": "Kettlebell Trainer",
    "sw_version": "0.1.0",
    "support_url": "https://github.com/andyalexander/kettle-bell-workout"
  },
  "state_topic": "kettlebell/profile/1/state",
  "qos": 1,
  "components": {
    "last_workout": {
      "platform": "sensor",
      "name": "Last workout",
      "unique_id": "kettlebell_profile_1_last_workout",
      "default_entity_id": "sensor.kettlebell_andy_last_workout",
      "device_class": "timestamp",
      "icon": "mdi:clock-start",
      "value_template": "{{ value_json.last_workout }}"
    },
    "last_routine": {
      "platform": "sensor",
      "name": "Last routine",
      "unique_id": "kettlebell_profile_1_last_routine",
      "default_entity_id": "sensor.kettlebell_andy_last_routine",
      "icon": "mdi:kettlebell",
      "value_template": "{{ value_json.last_routine }}"
    },
    "last_volume": {
      "platform": "sensor",
      "name": "Last workout volume",
      "unique_id": "kettlebell_profile_1_last_volume",
      "default_entity_id": "sensor.kettlebell_andy_last_volume",
      "device_class": "weight",
      "state_class": "measurement",
      "unit_of_measurement": "kg",
      "suggested_display_precision": 0,
      "icon": "mdi:weight-kilogram",
      "value_template": "{{ value_json.last_volume_kg }}"
    },
    "sessions": {
      "platform": "sensor",
      "name": "Sessions",
      "unique_id": "kettlebell_profile_1_sessions",
      "default_entity_id": "sensor.kettlebell_andy_sessions",
      "state_class": "total",
      "unit_of_measurement": "sessions",
      "suggested_display_precision": 0,
      "icon": "mdi:calendar-check",
      "value_template": "{{ value_json.sessions_total }}"
    },
    "volume": {
      "platform": "sensor",
      "name": "Total volume",
      "unique_id": "kettlebell_profile_1_volume",
      "default_entity_id": "sensor.kettlebell_andy_volume",
      "device_class": "weight",
      "state_class": "total",
      "unit_of_measurement": "kg",
      "suggested_display_precision": 0,
      "icon": "mdi:arm-flex",
      "value_template": "{{ value_json.total_volume_kg }}"
    }
  }
}
```

The five component keys (`last_workout`, …) are the *discovery ids* — *"The components id's under
the `components` (`cmps`) key, are used as part of the discovery identification"*
([Device discovery payload](https://www.home-assistant.io/integrations/mqtt/#device-discovery-payload)) —
so they must be stable, but they are not the `unique_id` and not the entity id.

All five icons exist in Material Design Icons: `clock-start` (1.5.54), `kettlebell` (4.8.95),
`weight-kilogram` (1.5.54), `calendar-check` (1.5.54), `arm-flex` (4.2.95). Verified against
[`Templarian/MaterialDesign-SVG/meta.json`](https://github.com/Templarian/MaterialDesign-SVG/blob/master/meta.json).

### 1.8 The state payload, copy-pasteable

Published **retained**, QoS 1, to `kettlebell/profile/1/state`:

```json
{
  "last_workout": "2026-09-09T18:42:07.512430+00:00",
  "last_routine": "Simple & Sinister",
  "last_volume_kg": 1920.0,
  "sessions_total": 128,
  "total_volume_kg": 214560.0
}
```

`last_routine` is the routine name **from the frozen prescription**, not from the `routine` row —
ADR-0001 is the reason. A renamed routine does not rewrite what was published for a past session,
and the next session simply publishes the new name.

### 1.9 Removing a profile

> To remove the components, publish an empty (retained) string payload to the discovery topic. This will remove the component and clear the published discovery payload. It will also remove the device entry if there are no further references to it.

Source: [MQTT § Device discovery payload](https://www.home-assistant.io/integrations/mqtt/#device-discovery-payload)

So deleting a profile means: publish `""` retained to
`homeassistant/device/kettlebell_profile_1/config`, and publish `""` retained to
`kettlebell/profile/1/state` so the broker does not keep a ghost value. Both are required — clearing
only the discovery topic leaves a retained state message that will re-populate the entity if the
profile id is ever reused.

---

## 2. Which metrics, and at what granularity

### 2.1 Per-profile or aggregate? **Per-profile, one HA device each.**

**Decision: one Home Assistant device per profile, and no app-level device.**

Reasoning:

- Aggregate is derivable from per-profile; per-profile is not derivable from aggregate. If the
  household wants a combined total, HA has first-class tools for it (a
  [`min_max`](https://www.home-assistant.io/integrations/min_max/) or
  [`group`](https://www.home-assistant.io/integrations/group/) helper, or a template sensor). If we
  published only an aggregate, "how much did Andy lift this month" would be unanswerable from HA,
  and that is the question the app exists to answer.
- The domain is per-profile by construction. `CONTEXT.md`: *"Routines are shared; load is
  personal"*, and a **session** is *"one workout actually performed by **one profile**"*. Volume is
  a fold over one session's prescription, so it is inherently attributed to a profile. An aggregate
  would be an invention on top of the model.
- A device per profile buys the device page, per-device history, per-device automations, and — the
  practical one — the ability to rename the device in HA and have all five entities follow, because
  `has_entity_name` is `True` for every MQTT entity (§1.4). One rename, five friendly names fixed.
- The count is small and bounded. `CONTEXT.md` describes a household picker with no passwords;
  a handful of profiles means at most ~25 entities. Device discovery keeps that to one retained
  topic per person.

**Rejected alternative:** one device named "Kettlebell Trainer" carrying `andy_last_workout`,
`sam_last_workout`, … The device page becomes a wall of unrelated entities, per-person dashboard
cards need manual entity lists rather than a device card, and removing a profile means editing one
shared payload rather than clearing one topic. It also puts the profile name inside every
`unique_id`-adjacent name, which then goes stale on rename.

### 2.2 The entities

Per profile, five sensors. `<id>` is the profile's database id; `<slug>` is a slugified profile name
used only in `default_entity_id` (a one-time hint — see §1.6 — so a later rename is harmless).

| Component id | Name | `unique_id` | `default_entity_id` | Unit | `device_class` | `state_class` | Icon |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `last_workout` | Last workout | `kettlebell_profile_<id>_last_workout` | `sensor.kettlebell_<slug>_last_workout` | — | `timestamp` | *(none)* | `mdi:clock-start` |
| `last_routine` | Last routine | `kettlebell_profile_<id>_last_routine` | `sensor.kettlebell_<slug>_last_routine` | — | *(none)* | *(none)* | `mdi:kettlebell` |
| `last_volume` | Last workout volume | `kettlebell_profile_<id>_last_volume` | `sensor.kettlebell_<slug>_last_volume` | `kg` | `weight` | `measurement` | `mdi:weight-kilogram` |
| `sessions` | Sessions | `kettlebell_profile_<id>_sessions` | `sensor.kettlebell_<slug>_sessions` | `sessions` | *(none)* | `total` | `mdi:calendar-check` |
| `volume` | Total volume | `kettlebell_profile_<id>_volume` | `sensor.kettlebell_<slug>_volume` | `kg` | `weight` | `total` | `mdi:arm-flex` |

Definitions, in `CONTEXT.md` terms:

- **Last workout** — the completion timestamp of the profile's most recent session, UTC, ISO-8601.
- **Last routine** — `prescription.routine_name` from that same session (the frozen value, per
  ADR-0001).
- **Last workout volume** — reps × resolved weight summed over every **turn** of that session's
  prescription, kg. `CONTEXT.md` rule 3 (*"every session completes"*) is what makes this a fold over
  the whole prescription rather than over logged turns.
- **Sessions** — lifetime count of completed sessions for this profile.
- **Total volume** — lifetime sum of per-session volume for this profile, kg.

`last_volume` earns its place even though it is not on the ticket's candidate list: the app already
computes it to produce `total_volume`, it costs one more key in a JSON document we are publishing
anyway, and it is the number you actually want on the wall dashboard immediately after training.

### 2.3 "Sessions this week" — rejected, replaced by a lifetime total

The ticket lists *sessions this week*. I am rejecting it in favour of a lifetime `sessions` total,
for a reason that is structural rather than aesthetic:

**We publish only on session completion.** A "this week" counter is therefore a value that is
correct at publish time and silently wrong afterwards. Train three times, then rest — on Monday
morning the sensor still reads `3`, and it keeps reading `3` until the next workout, at which point
it snaps to `1`. Nothing in the system is wrong; the number just lies for days at a time. Fixing it
means a scheduled republish, which drags a timer, a timezone policy and a week-boundary definition
into an app that currently has none of them.

A lifetime `total` has none of that failure mode, and Home Assistant answers "this week" from it for
free: `state_class: total` opts the sensor into long-term statistics, whose `sum` is exactly
"growth over the period" (§3.1), so a Statistics Graph card or a
[`statistics`](https://www.home-assistant.io/integrations/statistics/) helper produces sessions-per-week
without us publishing a per-week number at all.

The same argument applies to `volume`, which is why both are lifetime totals.

**Unverified:** I have not confirmed the exact wording of the Statistics Graph card's period
options against a primary source; the `state_class: total` → `sum` statistic behaviour it draws
from *is* verified (§3.1).

### 2.4 "Current streak" — rejected

`CONTEXT.md` defines profile, exercise, routine, slot, weight override, turn, round, session,
prescription and volume. It does not define a streak, and a streak is not derivable without a rule
somebody has to choose: consecutive days with a session? Consecutive ISO weeks with at least one?
At least three? Does a rest day break it? Does the week roll at local midnight or UTC?

That rule is a product decision, not a research finding, and inventing one here would put a term in
the codebase that the glossary does not own. It also has the §2.3 staleness problem in a sharper
form — a day-based streak is wrong within 24 hours of the last publish.

**Recommendation:** leave it out of v1. If it is wanted later, define it in `CONTEXT.md` first, then
add one component to the existing discovery payload — device discovery makes that a one-key edit to
a payload we already publish, with no new topics.

---

## 3. `state_class`, `device_class`, and long-term statistics

### 3.1 What opts a sensor into statistics

> Home Assistant has support for storing sensors as long-term statistics if the entity has the right properties. To opt-in for statistics, the sensor must have `state_class` set to one of the valid state classes: `SensorStateClass.MEASUREMENT`, `SensorStateClass.TOTAL` or `SensorStateClass.TOTAL_INCREASING`.

Source: [Sensor entity § Long-term Statistics](https://developers.home-assistant.io/docs/core/entity/sensor#long-term-statistics)
([source md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/core/entity/sensor.md))

The three classes, verbatim:

> | `SensorStateClass.MEASUREMENT` | The state represents _a measurement in present time_, not a historical aggregation such as statistics or a prediction of the future. […] For supported sensors, statistics of hourly min, max and average sensor readings is updated every 5 minutes.
> | `SensorStateClass.TOTAL` | The state represents a total amount that can both increase and decrease, for example, a net energy meter. Statistics of the accumulated growth or decline of the sensor's value since it was first added is updated every 5 minutes. […]
> | `SensorStateClass.TOTAL_INCREASING` | Similar to `SensorStateClass.TOTAL`, with the restriction that the state represents a monotonically increasing positive total which periodically restarts counting from 0 […] A decreasing value is interpreted as the start of a new meter cycle or the replacement of the meter.

Source: [Sensor entity § Available state classes](https://developers.home-assistant.io/docs/core/entity/sensor#available-state-classes)

And the exclusion list, which matters for our `measurement` sensor:

> The `state_class` property must be set to `SensorStateClass.MEASUREMENT`, and the `device_class` must not be either of `SensorDeviceClass.DATE`, `SensorDeviceClass.ENUM`, `SensorDeviceClass.ENERGY`, `SensorDeviceClass.GAS`, `SensorDeviceClass.MONETARY`, `SensorDeviceClass.TIMESTAMP`, `SensorDeviceClass.VOLUME` or `SensorDeviceClass.WATER`.

Source: [Sensor entity § Entities not representing a total amount](https://developers.home-assistant.io/docs/core/entity/sensor#entities-not-representing-a-total-amount)

`SensorDeviceClass.WEIGHT` is not on that list, so `weight` + `measurement` records statistics.

### 3.2 `total` vs `total_increasing` for our two lifetime totals

The docs give the deciding rule directly:

> It's recommended to use state class `SensorStateClass.TOTAL` without `last_reset` whenever possible, state class `SensorStateClass.TOTAL_INCREASING` or `SensorStateClass.TOTAL` with `last_reset` should only be used when state class `SensorStateClass.TOTAL` without `last_reset` does not work for the sensor.
>
> - The sensor's value never resets, for example, a lifetime total energy consumption or production: state_class `SensorStateClass.TOTAL`, `last_reset` not set or set to `None`

Source: [Sensor entity § How to choose `state_class` and `last_reset`](https://developers.home-assistant.io/docs/core/entity/sensor#how-to-choose-state_class-and-last_reset)

`sessions` and `volume` are lifetime totals that never reset, so both get **`total`**, and neither
gets `last_reset`.

`total_increasing` would also technically work, since both are monotonic. It is the wrong choice
because of its recovery semantics: *"A decreasing value is interpreted as the start of a new meter
cycle"*. If the database is ever restored from an older backup, or a bad session row is deleted, the
value dips — and `total_increasing` would silently treat that dip as a meter reset and add the whole
value again as growth, permanently corrupting the statistics. `total` treats the same dip as a
decline of that size, which is recoverable and visible.

`last_volume` gets **`measurement`**: it is a per-session reading whose min/max/mean over a period is
the interesting thing, and accumulating it would double-count what `volume` already sums.

### 3.3 The timestamp sensor

The device class contract:

> | `SensorDeviceClass.TIMESTAMP` | | Timestamp. Requires `native_value` to return a Python `datetime.datetime` object, **with time zone information**, or `None`.

Source: [Sensor entity § Available device classes](https://developers.home-assistant.io/docs/core/entity/sensor#available-device-classes)

For MQTT, the string on the state topic is parsed by
`homeassistant.util.dt.parse_datetime`, which tries `ciso8601.parse_datetime` first and falls back
to a regex; if it returns `None`, Core logs `Invalid state message '%s' from '%s'` and sets the state
to `None`:

```python
try:
    if (payload_datetime := dt_util.parse_datetime(payload)) is None:
        raise ValueError  # noqa: TRY301
except ValueError:
    _LOGGER.warning("Invalid state message '%s' from '%s'", payload, msg.topic)
    self._attr_native_value = None
    return
```
Source: [`homeassistant/components/mqtt/sensor.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/sensor.py),
[`homeassistant/util/dt.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/util/dt.py)

A *parseable but naive* datetime gets past that and is then rejected by the sensor base entity:

```python
if device_class in (SensorDeviceClass.TIMESTAMP, SensorDeviceClass.UPTIME):
    value = cast(datetime, value)
    if value.tzinfo is None:
        raise ValueError(
            f"Invalid datetime: {self.entity_id} provides state '{value}', "
            "which is missing timezone information"
        )
    if value.tzinfo != UTC:
        value = value.astimezone(UTC)
```
Source: [`homeassistant/components/sensor/__init__.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/sensor/__init__.py)

**Requirement, concretely:** the string must carry an explicit UTC designator. Both
`2026-09-09T18:42:07.512430+00:00` and `2026-09-09T18:42:07Z` parse and are timezone-aware.
`2026-09-09T18:42:07` does not — it parses, then raises. `CONTEXT.md` already mandates UTC ISO-8601
storage, so:

```python
datetime.now(tz=UTC).isoformat()  # -> '2026-09-09T18:42:07.512430+00:00'
```

is the correct producer. Never `datetime.utcnow().isoformat()` — that is naive and will break the
sensor.

`last_workout` gets **no `state_class`**. It could not have one anyway: `timestamp` is on the
`measurement` exclusion list quoted in §3.1. A timestamp sensor has no long-term statistics; its
history is the state history, which is exactly what you want.

### 3.4 The text sensor: what "last routine" can and cannot do

`last_routine` has no `device_class`, no `state_class` and no `unit_of_measurement`. Consequences,
all verified in Core:

- **No long-term statistics, at all.** Statistics require a `state_class` (§3.1), and text has none.
  It will not appear in a Statistics Graph card and there is no sum/mean/min/max for it.
- **It does get ordinary state history** (the recorder's `states` table), so a History card, a
  logbook entry and `state_changed` automation triggers all work.
- **255 characters, hard.** Core checks the proposed state against `MAX_LENGTH_STATE_STATE` and, if
  it is longer, logs a warning and falls back to `unknown`:
  `MAX_LENGTH_STATE_STATE: Final = 255` in
  [`homeassistant/const.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/const.py);
  the check is `check_state_too_long` in
  [`homeassistant/components/mqtt/util.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/util.py),
  called from `sensor.py`. Routine names are short, but truncate to 255 defensively before
  publishing.
- **Do not use `device_class: enum`.** It would let HA treat the routine name as a categorical state,
  but it requires a fixed `options` list — *"List of allowed sensor state value. […] The sensor's
  `device_class` must be set to `enum`. The `options` option cannot be used together with
  `state_class` or `unit_of_measurement`"*
  ([MQTT Sensor](https://www.home-assistant.io/integrations/sensor.mqtt/)) — and Core drops any
  payload not in that list (`"Ignoring invalid option received on topic '%s'"`, `sensor.py`). Routines
  are user-created and editable, so the option list would go stale the moment somebody adds a
  routine, and the sensor would silently stop updating. `enum` is also on the statistics exclusion
  list anyway, so it buys nothing.

### 3.5 `weight` + `kg`

> | `SensorDeviceClass.WEIGHT` | kg, g, mg, µg, oz, lb, st | Generic mass; `weight` is used instead of `mass` to fit with every day language.

Source: [Sensor entity § Available device classes](https://developers.home-assistant.io/docs/core/entity/sensor#available-device-classes)

`kg` is a valid unit for it, and `CONTEXT.md` rule 5 says weights are kg throughout. Setting
`device_class: weight` gives the entity a mass icon, unit-aware display and user-selectable unit
conversion in the frontend.

If unit conversion is unwanted — a US-locale household seeing "472,800 lb" — the fallback is to drop
`device_class` and keep `unit_of_measurement: kg` and `state_class: total`. Statistics still record,
because §3.1 requires only a `state_class`. I recommend keeping `weight`; the conversion is a
feature, not a bug, and it is reversible per-entity from the HA UI.

`suggested_display_precision: 0` keeps the dashboard reading `214560 kg` rather than
`214560.0000001 kg`.

---

## 4. Retention and availability

### 4.1 What a retained *discovery* message does

> A discovery payload can be sent with a retain flag set. In that case, the discovery message will be stored at the MQTT broker and processed automatically when the MQTT integrations start. This method removes the need for it to be resent.

Source: [MQTT § Discovery payload](https://www.home-assistant.io/integrations/mqtt/#discovery-payload)

> When Home Assistant is restarting, discovered MQTT items with a unique ID will be unavailable until a new discovery message is received. MQTT items without a unique ID will not be added at startup. So a device or service using MQTT discovery must make sure a configuration message is offered after the **MQTT** integration has been (re)started. There are two common approaches to make sure the discovered items are set up at startup:
>
> 1. Using Birth and Will messages to trigger setup
> 2. Using retained messages

Source: [MQTT § Discovery messages and availability](https://www.home-assistant.io/integrations/mqtt/#discovery-messages-and-availability)

### 4.2 What a retained *state* message does

> State updates also need to be re-published after a config as been processed. This can also be done by publishing "retained" messages. As soon as a config is received (or replayed from a retained message), the setup will subscribe any state topics. If a retained message is available at a state topic, this message will be replayed so that the state can be restored for this topic.

Source: [MQTT § Using retained state messages](https://www.home-assistant.io/integrations/mqtt/#using-retained-state-messages)

The documented downside, which we should take seriously:

> A disadvantage of using retained messages is that these messages retain at the broker, even when the device or service stops working. They are retained even after the system or broker has been restarted. **Retained messages can create ghost entities that keep coming back.**

Source: same section

### 4.3 Decision: retain both

**Both topics are published with `retain: true`.**

- **Retaining discovery** is what makes the entities exist after an HA restart. Without it the
  entities go unavailable on every HA restart and stay that way until somebody trains.
- **Retaining state** is what makes the *values* survive. This one is not optional for us either,
  and for a reason specific to this app: we publish a handful of times a day. If state is not
  retained, an HA restart at 09:00 leaves "Last workout" showing `unknown` until the next workout —
  possibly the next evening, possibly Thursday.
- **Add-on restart** needs neither. Both messages live at the broker, not in our process, so an
  add-on restart (update, rebuild, Supervisor watchdog) changes nothing HA can see. We do republish
  discovery at startup (§6.4), but that is to ship config changes, not to restore anything.
- **The ghost-entity warning applies to us and is acceptable.** Our ghosts are bounded: at most one
  discovery topic and one state topic per profile, cleared explicitly on profile deletion (§1.9).
  This is a household app with a handful of profiles, not a fleet publishing thousands of retained
  topics. The docs' concern — *"Especially when you have many entities, (unneeded) discovery messages
  can cause excessive system load"* — is about scale we do not have.

**Rejected alternative:** subscribing to `homeassistant/status` and republishing on the birth
message. HA publishes `online`/`offline` there by default
([Birth and last will messages](https://www.home-assistant.io/integrations/mqtt/#birth-and-last-will-messages)),
and the docs call it *"a better approach"* than retained discovery — for firmware with thousands of
entities. For us it would mean holding a permanent subscription and a permanent connection, purely
to handle an event that retention handles for free. It also fails in the one case retention handles
best: if the add-on is stopped when HA restarts, there is nobody to react to the birth message, and
every entity is gone until the add-on comes back.

Do **not** set `expire_after` on any of these sensors. The docs are explicit about the interaction:
*"when a sensor's value was sent retained to the MQTT broker, the last value sent will be replayed by
the MQTT broker when Home Assistant restarts […] As this could cause the sensor to become available
with an expired state, it is not recommended to retain the sensor's state payload"*
([MQTT Sensor](https://www.home-assistant.io/integrations/sensor.mqtt/)). We want retention, so we
do not want `expire_after`.

### 4.4 Availability and LWT: none, deliberately

The mechanism, for the record. An entity can carry an `availability_topic` (or an `availability`
list), with defaults:

> `payload_available`: The payload that represents the available state. *default:* `online`
> `payload_not_available`: The payload that represents the unavailable state. *default:* `offline`

Source: [MQTT § Using Availability topics](https://www.home-assistant.io/integrations/mqtt/#using-availability-topics)

And the intended pairing with MQTT's Last Will and Testament:

> A device or service can announce its availability by publishing a Birth message and set a Will message at the broker. When the device or service loses connection to the broker, the broker will publish the Will message. This allows the **MQTT** integration to make an entity unavailable.

Source: same section

**Decision: no `availability_topic`, no `availability` block, no Last Will.**

Three reasons, in order of weight:

1. **`unavailable` would be semantically wrong.** Every one of our five entities is a statement about
   the past: "the last workout was at 18:42 on Tuesday", "Andy has lifted 214 t in total". Those
   facts do not stop being true when the add-on is stopped. Marking them `unavailable` would blank
   the dashboard, break `{{ states('sensor…') }}` templates in any automation, and inject gaps into
   the recorder — for no information gain. Contrast a thermostat, where "unavailable" genuinely means
   "I no longer know the temperature".
2. **The liveness question is already answered elsewhere, and better.** Supervisor shows the add-on
   as stopped in the UI, and `addon-packaging.md` §4.1 already wires
   `watchdog: "http://[HOST]:[PORT:8234]/api/health"`, which restarts the container if the app stops
   responding. An MQTT availability topic would be a second, worse liveness signal.
3. **The publishing design cannot hold an LWT anyway.** A Last Will is registered at CONNECT and
   fired by the broker only when the connection drops *without* a clean DISCONNECT. Our design
   (§6) connects, publishes, and disconnects cleanly — so the will is discarded every time and
   would never fire. `paho.mqtt.publish.multiple()` accepts a `will` parameter
   ([`publish.py`](https://github.com/eclipse-paho/paho.mqtt.python/blob/master/src/paho/mqtt/publish.py)),
   but setting it on a one-shot publish is theatre.

**The alternative I rejected, stated fairly:** hold a long-lived connection with
`will_set("kettlebell/status", "offline", retain=True)`, publish `online` on connect, and put
`availability_topic: kettlebell/status` in the shared options of the discovery payload. This gives a
genuine "the trainer is offline" signal in HA and would be the right design for an app publishing a
live workout timer. It is the wrong design for an app publishing five historical facts a day: it
buys a signal we do not need, priced in a permanent connection, a reconnect loop, and five entities
that go blank whenever the add-on is updated. If the app ever grows live in-workout publishing (a
current-round sensor, say), revisit this — that sensor *should* have availability, and the ones here
still should not, which the per-component availability options make expressible.

---

## 5. Credentials

Nothing here changes the plan in
[`addon-packaging.md`](addon-packaging.md) §6.3. This section confirms it against the source and adds
one field.

### 5.1 The declaration, and what it grants

`addon/config.yaml` already has:

```yaml
services:
  - mqtt:need
```

Supervisor enforces this at the API layer — an app with no `services_role` for `mqtt` gets a 403:

```python
def _check_access(request, service, provide=False):
    """Raise error if the rights are wrong."""
    app = request[REQUEST_FROM]
    if not app.services_role.get(service):
        raise APIForbidden(f"No access to {service} service!")
```
Source: [`supervisor/api/services.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/services.py)

### 5.2 What `GET /services/mqtt` returns

The schema is fixed in the Supervisor's MQTT service module:

```python
SCHEMA_SERVICE_MQTT = vol.Schema(
    {
        vol.Required(ATTR_HOST): str,
        vol.Required(ATTR_PORT): network_port,
        vol.Optional(ATTR_USERNAME): str,
        vol.Optional(ATTR_PASSWORD): str,
        vol.Optional(ATTR_SSL, default=False): vol.Boolean(),
        vol.Optional(ATTR_PROTOCOL, default="3.1.1"): vol.All(
            str, vol.In(["3.1", "3.1.1"])
        ),
    }
)
```
Source: [`supervisor/services/modules/mqtt.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/services/modules/mqtt.py)

So: `host`, `port`, `username`, `password`, `ssl`, `protocol`, plus an `app` key naming the provider.
Note that provider key: it is `app`, not `addon`, since Supervisor 2026.05 —
`# 'addon' field deprecated as of 2026.05, replaced by 'app'` in the same file, with
`get_service_v1` still rewriting it to `addon` for the v1 endpoint
([`supervisor/api/services.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/services.py)).
This does not affect us — we read none of it — but it is the kind of thing that breaks an add-on
that parsed the whole object.

And here is exactly what the **official Mosquitto add-on** puts there, which settles the values
rather than leaving them abstract:

```bash
# Create service config payload for other add-ons
config=$(bashio::var.json \
    host "$(hostname)" \
    port "^1883" \
    ssl "^false" \
    protocol "3.1.1" \
    username "addons" \
    password "${service_password}" \
)
...
if bashio::services.publish "mqtt" "${config}" > /dev/null 2>&1; then
```
Source: [`addons/mosquitto/rootfs/etc/services.d/mosquitto/discovery`](https://github.com/home-assistant/addons/blob/master/mosquitto/rootfs/etc/services.d/mosquitto/discovery)

Three things follow, all confirming `addon-packaging.md` §6.2:

- `host` is `$(hostname)` inside the Mosquitto container, i.e. **`core-mosquitto`**. Not
  `192.168.2.10`. The LAN IP would leave the Supervisor's internal network and break when the Pi's
  address changes.
- `port` is `1883` and `ssl` is `false` for the standard Mosquitto add-on setup.
- The username handed to add-ons is `addons` with a password from Mosquitto's
  `/data/system_user.json` — a **different** account from the `homeassistant` user Mosquitto sends to
  Core via `bashio::discovery`. We get our own credentials; nothing is shared.

**Never** put any of this in `options`/`schema`, in this file, or in a commit. Placeholders only.

### 5.3 `run.sh`: one addition

`addon/run.sh` already does the right thing. `bashio::services.available "mqtt"` is a real guard, not
decoration — it does `GET /services/mqtt` and returns non-OK on any failure
([`bashio/lib/services.sh`](https://github.com/hassio-addons/bashio/blob/main/lib/services.sh)), and
Supervisor returns an error when nothing provides the service
(`if not service.enabled: raise APIError("Service not enabled")`,
[`supervisor/api/services.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/services.py)).
So a plain `docker run` on the Mac, with no Supervisor, takes the `else` branch and the app starts
with MQTT disabled.

The one thing missing is `ssl`. It is `false` for the Mosquitto add-on today, but it is part of the
service contract and reading it costs one line:

```bash
if bashio::services.available "mqtt"; then
  KB_MQTT_HOST="$(bashio::services mqtt 'host')"
  KB_MQTT_PORT="$(bashio::services mqtt 'port')"
  KB_MQTT_USERNAME="$(bashio::services mqtt 'username')"
  KB_MQTT_PASSWORD="$(bashio::services mqtt 'password')"
  KB_MQTT_SSL="$(bashio::services mqtt 'ssl')"
  export KB_MQTT_HOST KB_MQTT_PORT KB_MQTT_USERNAME KB_MQTT_PASSWORD KB_MQTT_SSL
else
  bashio::log.warning "No MQTT service registered with the Supervisor."
fi
```

`bashio::services` renders a boolean as the literal string `true`/`false`
([`lib/services.sh`](https://github.com/hassio-addons/bashio/blob/main/lib/services.sh) — the jq
query has an explicit `boolean` branch), so the matching change in
`addon/backend/src/kettlebell/config.py` is:

```python
@dataclass(frozen=True, slots=True)
class MqttSettings:
    """Broker connection details handed to us by the Supervisor.

    Absent when no MQTT service is registered, in which case publishing is skipped.
    """

    host: str
    port: int
    username: str | None
    password: str | None
    discovery_prefix: str
    ssl: bool


def _mqtt_from_env(source: Mapping[str, str]) -> MqttSettings | None:
    """Read broker settings, returning None when no broker was advertised."""
    host = source.get("KB_MQTT_HOST")
    if not host:
        return None
    return MqttSettings(
        host=host,
        port=int(source.get("KB_MQTT_PORT", "1883")),
        username=source.get("KB_MQTT_USERNAME") or None,
        password=source.get("KB_MQTT_PASSWORD") or None,
        discovery_prefix=source.get("KB_MQTT_DISCOVERY_PREFIX", "homeassistant"),
        ssl=source.get("KB_MQTT_SSL", "false").lower() == "true",
    )
```

That is the whole `KB_*` change. `Settings.mqtt is None` remains the single "MQTT is not configured"
signal, and every publishing call site checks it.

---

## 6. Library and integration

### 6.1 The two candidates, as they stand today

| | `paho-mqtt` | `aiomqtt` |
| --- | --- | --- |
| Latest release on PyPI | **2.1.0**, 2024-04-29 | **2.5.1**, 2026-03-05 |
| Repo activity | commits as recent as 2026-08-25 (e.g. "Bump minimum Python version to 3.9") — active, but unreleased | commits to 2026-04 |
| Maintainer | Eclipse Foundation (Paho project) | Single maintainer (`empicano`) |
| Licence | EPL-2.0 OR BSD-3-Clause | (unset on PyPI; MIT/BSD per repo — **unverified**) |
| Async | No. Threaded network loop (`loop_start`), or an external-event-loop API | Yes, asyncio-native API |
| Dependencies | none | **`paho-mqtt>=2.1.0,<3.0.0`** |

Sources: [PyPI `paho-mqtt`](https://pypi.org/pypi/paho-mqtt/json),
[PyPI `aiomqtt`](https://pypi.org/pypi/aiomqtt/json),
[`eclipse-paho/paho.mqtt.python`](https://github.com/eclipse-paho/paho.mqtt.python),
[`empicano/aiomqtt`](https://github.com/empicano/aiomqtt).

Two facts worth pausing on:

**`aiomqtt` 2.x is a wrapper around paho-mqtt.** Its declared dependency is
`paho-mqtt<3.0.0,>=2.1.0`. Choosing `aiomqtt` does not avoid paho; it adds a layer over it.

**`aiomqtt` 3.0 is a rewrite, currently in alpha.** From its own README:

> aiomqtt v3 is released! It switches the underlying protocol library from paho-mqtt to the sans-io [mqtt5](https://github.com/empicano/mqtt5) library. This means aiomqtt is now pure asyncio (no more threads). Try it with `pip install aiomqtt==3.0.0-alpha.1`.

Source: [`aiomqtt` README](https://github.com/empicano/aiomqtt/blob/main/README.md); PyPI confirms
`3.0.0a1` is the only 3.x release.

So adopting `aiomqtt` now means adopting a wrapper whose protocol engine is being swapped out
underneath it, for an app that publishes five values a day.

### 6.2 Long-lived connection, or connect-publish-disconnect?

**Decision: connect-publish-disconnect, one shot per event.**

- **The event rate is trivial.** A handful of sessions a day, plus one publish at startup. A TCP
  connect and MQTT CONNECT to `core-mosquitto` on the Supervisor's internal Docker network is
  sub-millisecond-to-low-milliseconds. There is no throughput problem to solve.
- **A long-lived connection is a stateful thing that can be wrong.** It needs a reconnect policy, it
  breaks when the Mosquitto add-on updates or the broker restarts, and it needs a health story of
  its own. A one-shot publish has exactly two outcomes: it worked, or it raised — and we already
  have to handle "it raised".
- **It interacts cleanly with §4.4.** Because we hold no connection, we hold no LWT, and because we
  publish no availability topic, we need no LWT. The two decisions are consistent by construction
  rather than by discipline. This is the honest version of the tension the ticket raises: a
  connect-publish-disconnect design *cannot* hold an LWT, and the resolution is not to work around
  that but to notice we do not want one.
- **Retention does the work a persistent session would.** The broker holds our messages; we do not
  need to be connected for HA to see them.

**Rejected alternative:** an `aiomqtt.Client` opened in the FastAPI lifespan and held for the process
lifetime. It is the right shape for an app that subscribes (aiomqtt's whole selling point is
`async for message in client.messages()`) or publishes continuously. We do neither.

### 6.3 Recommendation: `paho-mqtt`, via `publish.multiple`, in a worker thread

`paho.mqtt.publish` exists for precisely this case — its module docstring:

> This module provides some helper functions to allow straightforward publishing of messages in a one-shot manner. In other words, they are useful for the situation where you have a single/multiple messages you want to publish to a broker, then disconnect and nothing else is required.

Source: [`paho/mqtt/publish.py`](https://github.com/eclipse-paho/paho.mqtt.python/blob/master/src/paho/mqtt/publish.py)

`multiple()` takes `msgs, hostname, port, client_id, keepalive, will, auth, tls, protocol,
transport, proxy_args` (same file), so both messages — discovery and state — go out over one
connection, with `auth={"username": ..., "password": ...}`.

It is synchronous and blocking, so it runs in a worker thread. `anyio.to_thread.run_sync` is the
right primitive: the project's testing rule in `CLAUDE.md` is *"Async testing: use anyio, not
asyncio"*, and anyio is already a dev dependency; adding it to the runtime dependencies is a
no-op in practice because Starlette and FastAPI already depend on it.

Add to `addon/backend/pyproject.toml`:

```toml
dependencies = [
    "anyio>=4.11",
    "fastapi>=0.121",
    "paho-mqtt>=2.1,<3",
    "uvicorn[standard]>=0.38",
]
```

Installed with `uv add paho-mqtt anyio`. Never pip. Pin below 3.0 — paho 2.0 was already a breaking
release (*"Warning breaking change - Release 2.0 contains a breaking change"*,
[README](https://github.com/eclipse-paho/paho.mqtt.python/blob/master/README.rst)) and a 3.0 would be
another.

The one honest mark against paho: its last PyPI release is April 2024, even though the repository is
active as of August 2026. That is a slow release cadence, not abandonment — it is an Eclipse
Foundation project and 2.1.0 does everything we need. And since `aiomqtt` 2.x depends on
`paho-mqtt>=2.1.0` anyway, the alternative does not escape this risk; it inherits it and adds a
second maintainer to it.

### 6.4 Integration point in the FastAPI app

Sketch, not final code. Type hints throughout, docstrings on the public API, 88 columns.

```python
"""Publishing session results to Home Assistant over MQTT.

Publishing is best-effort: every failure is logged and swallowed, because a
broker problem must never stop a workout being logged.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anyio
from paho.mqtt import publish as mqtt_publish

from kettlebell.config import MqttSettings

__all__ = ["ProfileMetrics", "publish_profile"]

_LOGGER = logging.getLogger(__name__)
_PUBLISH_TIMEOUT_SECONDS = 10.0


async def publish_profile(
    settings: MqttSettings,
    metrics: ProfileMetrics,
    *,
    include_discovery: bool = True,
) -> None:
    """Publish one profile's discovery and state payloads, best effort.

    Never raises. A broker that is down, slow or misconfigured must not affect
    the session that has just been recorded.
    """
    messages = _messages(settings, metrics, include_discovery=include_discovery)
    try:
        with anyio.fail_after(_PUBLISH_TIMEOUT_SECONDS):
            await anyio.to_thread.run_sync(
                lambda: mqtt_publish.multiple(
                    messages,
                    hostname=settings.host,
                    port=settings.port,
                    client_id="kettlebell",
                    auth=_auth(settings),
                )
            )
    except Exception:  # noqa: BLE001 - publishing must never propagate
        _LOGGER.warning(
            "Could not publish profile %s to MQTT", metrics.profile_id, exc_info=True
        )
```

Two call sites:

1. **Lifespan startup.** In the FastAPI `lifespan`, after the database is open, publish the discovery
   payload (and current state) for every profile. This is not needed to restore anything — retention
   already did that (§4.3) — but it ships config changes after an add-on update, and it heals a
   broker that lost its retained store. Do it in a background task so a slow broker cannot delay
   uvicorn coming up and tripping the Supervisor `watchdog`.

2. **Session completion.** In the handler that finalises a session, **after** the transaction
   commits, publish discovery + state for that one profile. Discovery is idempotent — a repeat
   payload is a config update, per *"Subsequent messages on a topic where a valid payload has been
   received will be handled as a configuration update"*
   ([Discovery payload](https://www.home-assistant.io/integrations/mqtt/#discovery-payload)) — so
   sending it every time is safe and means a profile renamed in the app propagates to HA on the next
   workout with no extra machinery.

How it must fail:

- **Never inside the request's critical path.** Publish from a background task (FastAPI's
  `BackgroundTasks`, or an `anyio` task group) so the "workout finished" response returns as soon as
  the session is committed.
- **Never before the commit.** Publishing a result that then fails to persist is the one ordering
  that produces a lie in Home Assistant.
- **Bounded.** `anyio.fail_after` caps the whole attempt, so an unreachable broker cannot leave a
  thread parked forever.
- **`Settings.mqtt is None` is not an error.** It is the normal local-development and
  no-Mosquitto case: log once at startup, skip silently thereafter.
- **No retries in v1.** The next session republishes everything, and the retained state at the
  broker still holds the last good values. A retry queue is complexity in exchange for closing a
  window that closes itself.

---

## 7. Open questions this research did not settle

1. ~~**The broker's provenance.**~~ **Settled — not an open question.**
   `addon-packaging.md` §9 flagged this, but it was closed by
   [#8](https://github.com/andyalexander/kettle-bell-workout/issues/8) while this research was in
   flight: the broker on `192.168.2.10:1883` **is** the official Mosquitto add-on. So §5 stands as
   written — `core-mosquitto:1883`, `services: [mqtt:need]`, `bashio::services`, and no credentials
   in add-on `options`. Nothing here needs re-checking.

2. **`sessions` unit.** `unit_of_measurement: "sessions"` is not a Home Assistant-recognised unit; it
   is a free-text label, which HA permits for sensors without a `device_class`. I did not find a
   primary-source statement blessing or forbidding arbitrary unit strings on a `total` sensor —
   **unverified**. The observable risk is cosmetic (a "sessions" suffix in the UI) and the fallback
   is to omit the unit entirely; statistics require only the `state_class` (§3.1).
3. **Profile slug stability in `default_entity_id`.** Setting `default_entity_id` from the profile
   name is a first-add-only hint, so a rename does not churn entity IDs — but I have not tested what
   happens if two profiles slugify to the same string. The docs say HA appends a numeric suffix
   ("If `sensor.test` already exists, Home Assistant will append a suffix"), which suggests it is
   handled; **unverified** for the `default_entity_id` path specifically.
4. **Volume magnitudes and `suggested_display_precision`.** A year of training puts `total_volume_kg`
   in the hundreds of thousands. Whether HA's frontend renders that with thousands separators or
   switches to scientific notation is **unverified** — worth one look at a real dashboard before
   deciding whether to publish tonnes instead of kg. Note that changing the unit later invalidates
   statistics: *"During compilation of long-term statistics this unit change will be detected"*
   ([Sensor entity](https://developers.home-assistant.io/docs/core/entity/sensor)), so decide before
   the first publish, not after.

---

## Sources

- [MQTT integration](https://www.home-assistant.io/integrations/mqtt/) — discovery topic, device
  discovery payload, retention, availability, birth/will, abbreviations, entity naming
  ([source md](https://github.com/home-assistant/home-assistant.io/blob/current/source/_integrations/mqtt.markdown))
- [MQTT Sensor](https://www.home-assistant.io/integrations/sensor.mqtt/) — per-option reference,
  `default_entity_id`, `expire_after`, `options`/`enum`, timestamp example
  ([source md](https://github.com/home-assistant/home-assistant.io/blob/current/source/_integrations/sensor.mqtt.markdown))
- [Sensor entity (developer docs)](https://developers.home-assistant.io/docs/core/entity/sensor) —
  device classes, state classes, long-term statistics, `last_reset`
- [Entity (developer docs) § `has_entity_name`](https://developers.home-assistant.io/docs/core/entity/#has_entity_name-true-mandatory-for-new-integrations)
- [Home Assistant 2024.11 release notes](https://www.home-assistant.io/blog/2024/11/06/release-202411/) —
  device-based discovery introduced
- `home-assistant/core@dev` — [`components/mqtt/abbreviations.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/abbreviations.py),
  [`components/mqtt/sensor.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/sensor.py),
  [`components/mqtt/util.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mqtt/util.py),
  [`components/sensor/__init__.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/sensor/__init__.py),
  [`util/dt.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/util/dt.py),
  [`const.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/const.py)
- `home-assistant/supervisor@main` — [`services/modules/mqtt.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/services/modules/mqtt.py),
  [`api/services.py`](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/services.py)
- `home-assistant/addons@master` — [`mosquitto/rootfs/etc/services.d/mosquitto/discovery`](https://github.com/home-assistant/addons/blob/master/mosquitto/rootfs/etc/services.d/mosquitto/discovery)
- [`hassio-addons/bashio`](https://github.com/hassio-addons/bashio/blob/main/lib/services.sh) —
  `bashio::services`, `bashio::services.available`
- [App communication § services API](https://developers.home-assistant.io/docs/apps/communication#services-api),
  [App configuration](https://developers.home-assistant.io/docs/apps/configuration) — note the
  `/docs/add-ons/` paths now 302 to `/docs/apps/`
- [`eclipse-paho/paho.mqtt.python`](https://github.com/eclipse-paho/paho.mqtt.python) —
  [`README.rst`](https://github.com/eclipse-paho/paho.mqtt.python/blob/master/README.rst),
  [`src/paho/mqtt/publish.py`](https://github.com/eclipse-paho/paho.mqtt.python/blob/master/src/paho/mqtt/publish.py)
- [`empicano/aiomqtt`](https://github.com/empicano/aiomqtt) — [`README.md`](https://github.com/empicano/aiomqtt/blob/main/README.md)
- [`Templarian/MaterialDesign-SVG`](https://github.com/Templarian/MaterialDesign-SVG/blob/master/meta.json) — icon existence and version
