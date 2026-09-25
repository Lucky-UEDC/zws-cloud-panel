# Contributing

MyRDPHub Platform is a private proprietary repository.

## Workflow

1. Create a focused branch from `main`.
2. Keep secrets, production data, logs, backups, build output, and runtime sessions out of Git.
3. Follow existing Next.js, TypeScript, Prisma, and shell-script patterns.
4. Add focused tests for behavior changes.
5. Run the relevant validation before opening a pull request.

```bash
pnpm exec prisma validate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Deployment changes must additionally pass `bash -n` for installer/updater scripts, `nginx -t` on the target host, candidate smoke checks, and PM2 process validation.

Console changes must verify Windows noVNC, Linux noVNC/xterm.js policy, stopped and unavailable states, reconnect, fullscreen, clipboard, responsive layout, and framebuffer readiness.

Do not commit `.env`, database dumps, private keys, API credentials, PM2 dumps, browser sessions, uploads, logs, `.next`, `node_modules`, backups, or production screenshots containing sensitive data.
