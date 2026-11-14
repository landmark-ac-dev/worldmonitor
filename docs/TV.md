# World Monitor on a TV

Open `/tv` on the origin running this build. For local development, run
`npm run dev` and open `http://localhost:5173/tv`. Use the actual port Vite prints
if 5173 is occupied. On a deployed preview, append `/tv` to that preview's URL.
These instructions do not establish that any production host has this build.

The `/?tv=1` shortcut also opens TV mode. On Vercel it redirects to `/tv` before
the normal landing-page and variant redirects. `?mode=agent` retains its existing
agent response. `/tv` serves the dashboard entry while keeping the TV URL visible.

The map remains visible beside six scenes that rotate every 20 seconds. The
brief and pattern scenes show up to three reports; operational scenes show up
to two records. Long text is shortened on screen, and a count identifies
additional records. Open the linked source or the dashboard for full detail.
Normal means no qualifying pattern in the loaded news; it is not an all-clear.
Missing, stale or offline news coverage keeps the status at Watching.

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

## Controls and quiet hours

| Control | Action |
| --- | --- |
| Left / Right | Previous / next scene, pausing automatic rotation |
| Up | Open controls and pause rotation |
| Down | Resume rotation |
| Enter | Toggle rotation |
| F | Request fullscreen |
| D | Toggle dimming |

Within the controls, arrow keys move focus and Enter activates the focused
control. Escape closes the controls. Automatic rotation advances every 20 seconds.

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

## Before leaving it unattended

Verify on the actual display that text is legible at viewing distance, the scene
rotation and remote controls work, data timestamps advance, and the overnight
schedule uses the desired Central time window. Reconnect after a network outage
and confirm new data appears. Browser and source failures should not be treated
as evidence that the world is quiet. Device-level testing remains separate from
local browser or build verification.

External setup instructions were checked against official Google and Amazon
documentation on 2026-11-13.
