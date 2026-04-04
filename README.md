# PSPM Form Engine

Self-hosted form engine for PS Property Management, replacing the Gravity Forms plugin ecosystem on psprop.net.

## Stack

- **Framework:** Next.js 15 (App Router, TypeScript)
- **Forms:** react-hook-form + zod validation
- **Styling:** Tailwind CSS 4 with PSPM brand theme
- **Deploy:** Google Cloud Run (Dockerfile, standalone output)

## Forms

| Route | Form | Status |
|-------|------|--------|
| `/contact` | Contact Us | Phase 1 |
| `/proposal` | Request a Management Proposal | Phase 1 |
| `/invoice` | Invoicing System | Phase 3 |
| `/vendor-apply` | Vendor Application | Phase 4 |
| `/portal/falcon-pointe` | Falcon Pointe Portal Request | Phase 4 |
| `/reserve/indoor` | Indoor Gathering Room Reservation | Phase 4 |
| `/reserve/pavilion` | Pool Pavilion Reservation | Phase 4 |
| `/billback` | Manager Billback Tool | Phase 3 |
| `/bid` | Bid Request System | Phase 5 |

## Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values. See the file for all available variables.

## Build and Deploy

```bash
# Local build
pnpm build

# Docker
docker build -t pspm-form-engine .
docker run -p 8080:8080 pspm-form-engine
```

Cloud Run deployment uses the Dockerfile with `--port 8080`.
