# TVC Creator OS

Dashboard for The Viral Circle: TikTok Shop performance (via Cruva), Discord community health, and the
Discord bot's automations with a human approval queue.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run lint
```

## Views (hash routes)

| Route | What it does |
| --- | --- |
| `#overview` | 12 KPIs with period-over-period change, GMV-by-day chart, ads vs organic split, top creators and videos |
| `#content` | Sortable, paginated video table with handle filter; rows expand to summary and hooks |
| `#community` | Activity KPIs (DAU/WAU/MAU, stickiness, activation, reply time), leaderboard, channels, creators × revenue, retention cohorts, scoring settings |
| `#automations` | Six bot automations: on/off, channel, schedule, approval mode, per-automation settings, test posts |
| `#approvals` | Drafts rendered as Discord messages; approve & post, edit, regenerate, reject; activity log |
| `#onboarding` | Welcome line and DM questions (reorder, AI suggestions), live preview, member responses |
| `#setup` | Server info, channel allowlist, bot voice and mod channel, channel/permission table |
| `#welcome` | 3-step setup guide (add bot → assign channels → pick Cruva brand); shown until setup is finished |

## Architecture

```
src/
  context/        AppProvider (state + actions) and useApp()
  services/
    db.js         document store ("collection/id"), localStorage-backed, live across tabs
    cruva.js      Cruva API client (+ cache) — currently serves deterministic demo data
    bridge.js     sends requests to the Claude session that runs the bot
    worker.js     demo stand-in for that session (sync, allowlist, draft, post, reject)
    mockData.js   seeded shops, videos, members, channels and activity
    ai.js         onboarding question suggestions
  lib/            formatting, constants, community metrics, Discord markdown
  components/     layout (Rail, Topbar), LineChart, shared UI primitives
  pages/          one file per view
```

### Going live

The UI only talks to `services/`. To connect real backends:

- **Cruva**: replace the bodies in `services/cruva.js` and keep the returned shapes.
- **Store**: swap `services/db.js` for a hosted database client that exposes the same
  `get / list / set / update / remove / add` methods and a change subscription.
- **Bot**: point `services/bridge.js` at the real trigger and remove `startWorker()` from `main.jsx`.

Use **Reset demo** in the sidebar to clear local data and run the setup guide again.
