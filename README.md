# Callisto

Real-time video conferencing built with mediasoup WebRTC.

## Features

- **Auto-generated rooms** – Visit the app and get a unique shareable room URL
- **Multi-participant** – Multiple users can join the same room
- **WebRTC powered** – Low-latency video/audio using mediasoup SFU
- **Monorepo architecture** – pnpm workspaces + Turborepo

## Project Structure

```
callisto/
├── apps/
│   ├── client/
│   └── server/
│       ├── src/config.ts
│       ├── src/handlers/
│       ├── src/lib/
│       └── src/types.ts
├── packages/
│   └── shared/
├── pnpm-workspace.yaml
└── turbo.json
```

## Prerequisites

- Node.js 18+
- pnpm 9+

## Getting Started

```bash
# Install dependencies
pnpm install

# Run both client and server in dev mode
pnpm dev
```

- **Client**: http://localhost:3000
- **Server**: http://localhost:4000

## How It Works

1. Visit `http://localhost:3000`
2. You're redirected to a unique room (e.g., `/aB3xK9mNpQ`)
3. Share the URL with others to join the same room
4. Video streams are exchanged via mediasoup SFU

## Scripts

| Command      | Description                        |
| ------------ | ---------------------------------- |
| `pnpm dev`   | Start all apps in development mode |
| `pnpm build` | Build all packages                 |
| `pnpm lint`  | Lint all packages                  |
| `pnpm clean` | Clean build artifacts              |

## Tech Stack

- **Frontend**: Next.js 14, React, mediasoup-client
- **Backend**: Node.js, Express, Socket.IO, mediasoup
- **Build**: pnpm, Turborepo, TypeScript

## License

MIT
