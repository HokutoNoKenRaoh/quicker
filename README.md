# quicker

A multiplayer mental-math race that runs on the server: whoever solves the addition and subtraction questions fastest
wins. Race the bots right away, or create a lobby and invite friends with a link.

- Next.js 16 (App Router), React 19, Tailwind CSS 4
- No database, no accounts: everyone plays as a guest
- The server runs the race: questions, timing, points, bots and placings are decided on the server; the browser only
  sends the typed answers
- Live state arrives over Server-Sent Events, answers go out as POST requests

## Getting started

Requires Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local   # fill in QUICKER_GUEST_SECRET (32+ characters)
npm run dev                  # http://localhost:3000
```

For production:

```bash
npm run build
npm run start
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `QUICKER_GUEST_SECRET` | Yes | Signs the guest cookie a browser uses to find its lobby seat again. At least 32 characters. |
| `QUICKER_TRUST_PROXY` | No | Set to `true` when the app runs behind a reverse proxy that sets `X-Real-IP` / `X-Forwarded-For`. This turns on the per-network limits (people per lobby, request limits). Leave it unset when the app is reached directly: those headers can be forged. |

## Notes

- **Single process:** rooms live in memory. Run the app as one `next start` process; several instances or a
  serverless deployment can't share rooms. A restart drops the races in progress.
- **Reverse proxy:** the proxy must not buffer the SSE stream (the app sends `X-Accel-Buffering: no`).

## Project layout

```
src/lib/engine.ts            race rules (pure TypeScript: questions, points, bots)
src/lib/server/registry.ts   the in-memory room registry and its 250 ms clock
src/app/api/quicker/*        stream (SSE), answer, lobby and join endpoints
src/components/quicker/*     game screen, lobby, keypad, feedback
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Personal, educational and other noncommercial use is free.

**Commercial use requires permission.**

---

[Made for GameKodBank](https://gamekodbank.com)
