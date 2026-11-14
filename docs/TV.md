# World Monitor on a TV

Open `/tv` on the origin running this build. For local development, run
`npm run dev` and open `http://localhost:5173/tv`. Use the actual port Vite prints
if 5173 is occupied. On a deployed preview, append `/tv` to that preview's URL.
These instructions do not establish that any production host has this build.

The `/?tv=1` shortcut also opens TV mode. On Vercel it redirects to `/tv` before
the normal landing-page and variant redirects. `?mode=agent` retains its existing
agent response. `/tv` serves the dashboard entry while keeping the TV URL visible.

The map remains visible beside seven scenes that rotate every 20 seconds. The
brief and pattern scenes show up to three reports; operational scenes show up
to two records. Long text is shortened on screen, and a count identifies
additional records. Open the linked source or the dashboard for full detail.
Normal means no qualifying pattern in the loaded news; it is not an all-clear.
Missing, stale or offline news coverage keeps the status at Watching.
Active is reserved for a shared-cause pattern backed by at least two distinct
Confirmed official sources. The current feeds do not supply validated
shared-cause evidence, so overlapping disruption reports remain Watching,
including when individual reports are Confirmed.

## Run this fork on the home network

Build from the checkout containing the TV changes. For an installation that is
not sharing its container names or host port with another running stack, with the configured
`.env` in that checkout, run:

```powershell
docker compose up -d --build
docker compose ps
docker compose logs --tail 80 tv-seeds
```

For a sibling worktree borrowing the main checkout's existing configuration,
pass its file explicitly without copying or changing it:

```powershell
docker compose --env-file ../worldmonitor/.env up -d --build
docker compose --env-file ../worldmonitor/.env ps
```

Use the same `--env-file` option on later Compose commands. A plain
`docker compose pull` fetches upstream images; it does not build this fork's TV
changes. The source build also creates the local `worldmonitor-tv-seeds:local`
image. Existing required Redis, relay and session secrets are described in
[Self-hosting](../SELF_HOSTING.md#-required-environment-variables); no new provider
key is required by the TV seed service.

To verify this fork alongside an existing installation, preserve that stack and
its tunnel. Use a separate Compose project, a free host port such as 3001, and an
override assigning distinct container names; this Compose file has explicit
container names, so changing the project alone is insufficient. Open
`http://<LAN-IP>:3001/tv` for that separate instance. Do not point an existing
Cloudflare tunnel at the verification instance or replace the original port
binding as part of a side-by-side check.

First check `http://localhost:3000/tv` on the computer running Docker. Then open
**`http://<LAN-IP>:3000/tv`** on the TV, replacing `<LAN-IP>` with that computer's
Wi-Fi or Ethernet IPv4 address. `ipconfig` shows the addresses on Windows; use the
active home-network adapter, not a Docker, VPN or loopback address. `localhost`
on the TV refers to the TV itself. If `WM_PORT` is configured, use that host port
instead of 3000. Compose maps the host port to container port 8080.

The TV and computer must be on a network that permits communication between
devices. Guest Wi-Fi or wireless client isolation can prevent this even when
both devices can browse the internet. Keep Docker and the host computer awake.
The TV browser also needs internet access for the broadcaster streams.

On Windows, if the trusted home network uses the **Private** profile and inbound
access is blocked, this rule permits only the local subnet to reach TCP 3000.
Run it once from an elevated PowerShell window, substituting the configured port
if needed:

```powershell
New-NetFirewallRule -DisplayName 'World Monitor TV (Private LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet
```

The rule's scope follows [Microsoft's firewall documentation](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).
Do not configure router port forwarding for this home display. Redis remains
internal, with its REST proxy published only at `127.0.0.1:8079`; neither port
8079 nor the relay port is needed on the TV. This setup does not create a tunnel
or a public deployment.

Plain HTTP at a LAN IP supports the dashboard, but does not provide the secure
context required for service workers and screen wake lock. A successful
`localhost` check on the host does not establish those capabilities on the TV.
Use a bookmark and device power settings on HTTP; use HTTPS trusted by the TV
for those browser features, and check whether its browser supports installation.
See [Chrome's service-worker requirements](https://developer.chrome.com/docs/workbox/service-worker-lifecycle/)
and the [Screen Wake Lock specification](https://www.w3.org/TR/screen-wake-lock/).

## Local feed audit

This table records the source paths and limits of this Docker configuration. It
does not claim that a provider is responding or that a physical TV has been tested.

| TV content | Local data path | Coverage and credential limits |
| --- | --- | --- |
| Facts and patterns | Existing RSS/news digest pipeline and selected dashboard feeds | Only loaded source-linked reports qualify. Missing categories, stale data and failed refreshes remain visible as limited coverage. Live video does not count as corroborating evidence. |
| Aviation | `tv-seeds` runs `scripts/seed-aviation.mjs` every 10 minutes | Attempts public FAA delay reports and aviation RSS. No AviationStack or ICAO key is passed; international coverage and keyed NOTAM sources remain unavailable. A successful empty FAA response is distinct from a failed request. |
| Cyber | `tv-seeds` runs `scripts/seed-cyber-threats.mjs` every 60 minutes | Attempts Feodo and C2Intel public indicators. URLhaus, OTX and AbuseIPDB are skipped without their keys. Indicators are not confirmed incidents. |
| Finance | Existing relay market seeding and dashboard market API | Public Yahoo paths may supply some quotes. This configuration adds no Finnhub or other paid market key. Rate limits and unavailable symbols can leave partial or empty coverage. |
| Weather | Existing relay weather seed for NWS, ECCC and WMO SWIC | Public bulletin coverage depends on provider responses and area. No loaded alerts is not a local forecast or an all-clear. |
| Live TV video | Existing configured broadcaster HLS and official YouTube players | No new video API key. A catalog entry may be offline, geographically restricted or blocked from embedding. The player reports connecting, live, recording, unverified or offline separately from the news pattern status. |

The two scheduled seeders start sequentially on container boot and never overlap.
Each run has a five-minute deadline; a stalled child receives a termination signal
and then a forced stop after five seconds. A failed run waits for its next cadence
while the other seeder can proceed. The service uses only the Compose Redis REST
endpoint and local token; it does not inherit provider keys or load a checkout
`.env.local`.

The existing seeders own their `seed-meta` writes and last-good retention. The
runner does not refresh metadata merely because a job started. Aviation can
publish FAA/news data and its bootstrap, then exit nonzero because the later
international stage has no AviationStack key. That exit does not prove the FAA
stage failed, and it must not be reported as complete international coverage.
Read the stage logs and the corresponding freshness records.

For readback, inspect `/api/health?compact=1` and the TV's source timestamps after
the first runs. Relevant records include `seed-meta:aviation:faa`,
`seed-meta:aviation:delays-bootstrap` and `seed-meta:cyber:threats`. The TV consumes
`aviation:delays-bootstrap:v2` and `cyber:threats-bootstrap:v2`. A running container
alone is not evidence of fresh data. Other unconfigured sources in the full health
report may still be empty; do not expect the entire hosted-source catalog to turn
green on this local installation.

## Three ways to put it on the screen

### 1. Computer connected by HDMI

Connect a computer to the TV, choose that HDMI input, and open `/tv` in a current
browser. Select Fullscreen in the display, or press **F**. This is the recommended
starting point because the computer runs the browser and the TV only displays it.

For a dedicated shortcut, open `/tv` in Chrome, then choose the browser menu's
**Cast, save, and share > Install page as app** (or its address-bar install icon).
The TV manifest has its own app identity and launches `/tv`. Fullscreen behavior
depends on the browser and platform. See [Google's web app instructions](https://support.google.com/chrome/answer/9658361?hl=en).

### 2. Cast the Chrome tab

Open `/tv` in desktop Chrome. Put the computer and a Google Cast receiver on the
same Wi-Fi network, then choose **Cast, save, and share > Cast** from Chrome's
menu and select the receiver. Cast this tab and leave the computer running.
This uses browser tab casting; the display does not provide a native Cast app or
receiver. Supported receivers and the current procedure are in
[Google's casting instructions](https://support.google.com/chrome/answer/3228332?hl=en).

### 3. Open the URL in a TV browser

If the TV has a modern browser, enter the deployed `/tv` URL and bookmark it.
For Fire TV, open Amazon Silk and enter that URL. Amazon documents Silk's
website and bookmark support on Fire TV in its
[Silk guide](https://docs.aws.amazon.com/silk/latest/developerguide/what-is-silk.html).
A Fire TV is not assumed to be a Google Cast receiver. TV browsers vary in
JavaScript support, available memory, fullscreen support, and remote key delivery;
use HDMI or casting if the direct browser cannot render the display reliably.

## Home Assistant: Samsung TV

These are setup examples, not changes to an existing Home Assistant installation.
The integration documentation and source were checked on 2026-11-13. The actual
TV model, installed integration, power-on behavior and browser launch have not
been verified on a physical TV.

### Identify the integration first

In Home Assistant, open **Settings > Devices & services > Entities**, find the
TV's `media_player` entity, and check its integration. Record the exact entity ID;
the same TV can have several entities from different integrations.

| Integration | Browser URL support for this guide |
| --- | --- |
| **SamsungTV Smart**, custom component `samsungtv_smart` from `ollo69/ha-samsungtv-smart` (usually installed through HACS) | Documents `media_player.play_media` with `media_content_type: browser`. Use the full script below. Confirm the installed repository if using a fork. |
| **Samsung Smart TV**, built-in `samsungtv` | Power, remote keys and source/app controls depend on the model. Its `play_media` implementation accepts app/channel requests, not the custom component's `browser` type. |
| **SmartThings**, built-in `smartthings` | Exposes the TV's supported cloud capabilities, including power and source selection where available. Its documented media-player actions do not provide arbitrary browser URL launch. |

Sources: [SamsungTV Smart browser action](https://github.com/ollo69/ha-samsungtv-smart#open-browser-page),
[core Samsung integration](https://www.home-assistant.io/integrations/samsungtv/),
[core Samsung media-player implementation](https://github.com/home-assistant/core/blob/dev/homeassistant/components/samsungtv/media_player.py),
and [SmartThings media-player capabilities](https://www.home-assistant.io/integrations/smartthings/#media-player).
The shared `media_player` domain does not make integration-specific commands
interchangeable.

### Prepare the TV and network

First open `http://<LAN-IP>:3000/tv` manually in Samsung Internet and bookmark it.
Use the Docker host's reachable LAN address and actual published port; a separate
verification stack may use 3001. Reserve the host and TV addresses in the router
if they need to remain stable. Home Assistant, the TV and Docker host must have
the required LAN access; local Samsung control normally needs HA and the TV on
the same subnet/VLAN.

On supported models, look under **Settings > All Settings > Connection > Network
> Expert Settings** for **IP Remote** and **Power On with Mobile**, and enable
them for local control and wake-up. Older models put Network under General;
names and availability vary. Pair with the TV on and accept Home Assistant's
access request on its screen. If authorization repeats, check **Device connection
manager > Device list** and **Access notification > First time only**.
See [Samsung's IP-control worksheet](https://image-us.samsung.com/SamsungUS/samsungbusiness/tv-ci-resources/Samsung-IP-Control.pdf)
and [Home Assistant's permission troubleshooting](https://www.home-assistant.io/integrations/samsungtv/#samsung-tv-keeps-asking-for-permission).

Test power-on after the TV has been off for several minutes. Wake-on-LAN needs
the MAC address of the TV's active wired or wireless adapter and a network that
passes wake packets. Core Samsung uses the discovered MAC when available; its
[turn-on documentation](https://www.home-assistant.io/integrations/samsungtv/#turn-on-action)
also describes a custom wake action. SamsungTV Smart has its own wake options;
SmartThings power depends on the TV's exposed capabilities and cloud connection.
Do not assume that a successful turn-off proves wake-up works.

### SamsungTV Smart: World Monitor on TV

Create a script in **Settings > Automations & scenes > Scripts**, open its YAML
editor, and use this example. Replace every occurrence of
`media_player.samsung_tv_smart` with the entity belonging to **SamsungTV Smart**,
and replace the URL with the LAN address and port verified above.

```yaml
alias: World Monitor on TV
mode: single
sequence:
  - action: media_player.turn_on
    target:
      entity_id: media_player.samsung_tv_smart
  - wait_template: >-
      {{ states('media_player.samsung_tv_smart') in
         ['on', 'idle', 'playing', 'paused'] }}
    timeout: "00:01:30"
    continue_on_timeout: false
  - delay: "00:00:10"
  - action: media_player.play_media
    target:
      entity_id: media_player.samsung_tv_smart
    data:
      media_content_type: browser
      media_content_id: "http://<LAN-IP>:3000/tv"
```

The state wait stops after 90 seconds if the TV never reports powered-on status;
the extra ten seconds is a starting allowance for startup, not a browser-ready
signal. Adjust it from actual cold-start tests. A completed script proves only
that HA issued the actions: verify Samsung Internet opens the requested `/tv`
page and its timestamps advance. If this model opens the browser without the
URL or ignores the command, use the saved bookmark or HDMI fallback above.
The wait behavior follows [Home Assistant's wait-template documentation](https://www.home-assistant.io/building-blocks/wait_template/).

### Core Samsung or SmartThings: wake, then open the bookmark

For either built-in integration, use this limited script with that integration's
actual TV entity. It powers on and waits; then open Samsung Internet and its
saved World Monitor bookmark with the TV remote. If Internet appears in the
entity's actual `source_list`, source selection may launch it, but this does not
pass a URL. Do not add `media_content_type: browser` to these integrations or
guess a universal browser app ID. For automatic URL launch, use a compatible
SamsungTV Smart setup or a separately controlled HDMI browser.

```yaml
alias: Wake TV for World Monitor
mode: single
sequence:
  - action: media_player.turn_on
    target:
      entity_id: media_player.your_tv
  - wait_template: >-
      {{ states('media_player.your_tv') in
         ['on', 'idle', 'playing', 'paused'] }}
    timeout: "00:01:30"
    continue_on_timeout: false
```

### Optional dashboard button and off script

For the full SamsungTV Smart script, add a manual dashboard card using its saved
script entity ID (check it after saving; the example assumes
`script.world_monitor_on_tv`). This follows the official
[button-card script pattern](https://www.home-assistant.io/dashboards/button/#examples).

```yaml
type: button
name: World Monitor on TV
icon: mdi:television
show_state: false
tap_action:
  action: perform-action
  perform_action: script.turn_on
  target:
    entity_id: script.world_monitor_on_tv
```

An optional separate script turns off the selected TV. Substitute the same
integration's entity ID. Check the physical result, particularly on Frame models
where art-mode behavior can differ. No schedule is created by these examples.

```yaml
alias: World Monitor off
mode: single
sequence:
  - action: media_player.turn_off
    target:
      entity_id: media_player.samsung_tv_smart
```

## Controls and quiet hours

| Control | Action |
| --- | --- |
| Left / Right | Previous / next scene, pausing automatic rotation |
| Up | Open controls and pause rotation |
| Down | Resume rotation |
| Enter | Toggle rotation |
| F | Request fullscreen |
| D | Toggle dimming |
| P | Toggle the corner Live TV player |
| M | Toggle Live TV sound |
| [ / ] | Previous / next Live TV channel |

Within the controls, arrow keys move focus and Enter activates the focused
control. Escape closes the controls. Automatic rotation advances every 20 seconds.
The controls include corresponding Live TV, sound and channel buttons for a remote
without letter keys. The seventh scene shows the Live TV player; the optional
corner player is off initially. Video starts muted, and sound is enabled only by
an explicit unmute. Broadcaster playback status is separate from news confidence.

Remote keys work when the browser passes the matching arrow and Enter keys to the
page. Browser menus, pointer modes, and system shortcuts may intercept them.

To configure overnight dimming, open
`/tv?quiet=22:00-07:00`. Quiet hours use **America/Chicago** time, including daylight
saving changes, and are saved in this browser. The installed app launches `/tv`
and uses the saved preference. Dimming changes the page brightness; it does not
turn off the TV or configure its sleep timer.

Use `/tv?quiet=off` to clear the saved schedule, or use the Quiet hours control.

Fullscreen needs a user gesture in browsers that require one. Screen wake lock is
requested only where supported and can be released by the browser or operating
system. The application permission policy allows same-origin wake lock while
embedded documents retain their denial. Check the computer and TV power settings
for an unattended installation. A PWA installation does not make live feeds
available offline.

## Windows test prerequisite

The four deployment-script tests now locate Git for Windows Bash through a
cross-platform Node helper instead of assuming `/bin/bash`. Git for Windows
must be installed, or `WM_TEST_BASH` must point to a compatible Bash executable.
The tests still execute the actual production `vercel-ignore.sh`; replacing
that script with a PowerShell imitation would not verify its deployment behavior.

## Before leaving it unattended

Verify on the actual display that text is legible at viewing distance, the scene
rotation and remote controls work, data timestamps advance, and the overnight
schedule uses the desired Central time window. Reconnect after a network outage
and confirm new data appears. Browser and source failures should not be treated
as evidence that the world is quiet. Device-level testing remains separate from
local browser or build verification.

External setup instructions were checked against official Google and Amazon
documentation on 2026-11-13.
