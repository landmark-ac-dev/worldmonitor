# TV display

Run `npx playwright test e2e/tv.spec.ts --project=chromium --workers=1` from the
prepared worktree. Playwright owns the server. On native Windows, use `cross-env`
for the existing configuration's POSIX environment assignment.

The strict test enters the real app through `/tv` and `/?tv=1`, loads fictional
news through the normal digest route, checks all six scenes and captures facts
and pattern screenshots at 1920×1080 and 3840×2160. It exercises rotation,
D-pad controls, quiet-hour storage, the TV manifest and reconnect behavior.

Stable handles: `html[data-situation-room]`, `.tv-reader[data-scene]`,
`.tv-scene[data-scene]`, `.tv-overall-status`, `.tv-map-status`, `.tv-toolbar`,
`.tv-footer[data-paused]`, and `html[data-tv-dimmed]`.

The data path is `DataLoaderManager` → `AppContext` →
`getSituationRoomSnapshot` → `buildSituationRoomModel` →
`SituationRoomController`. Hidden dashboard panels remain mounted; TV consumers
use the existing refresh scheduler. No additional provider is introduced.

These checks prove local behavior with controlled responses. They do not prove
live provider coverage, PWA installation, casting, a physical remote, hardware
wake lock, TV sleep settings or readability at the user's actual viewing distance.
Follow [TV setup](../../../../docs/TV.md) for device checks.
