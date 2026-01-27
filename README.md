# Bridgelet SDK

**Backend SDK for ephemeral Stellar account management**

## Overview

The Bridgelet SDK is a NestJS-based backend service that manages the lifecycle of ephemeral Stellar accounts. It handles account creation, claim authentication, webhook notifications, and integration with the bridgelet-core smart contracts.

---

## ⚠️ TEMPORARY DEVELOPMENT WORKAROUNDS (IMPORTANT)

**PLEASE READ THIS SECTION BEFORE DEVELOPMENT**

The following services/imports are currently **commented out** to allow `npm run start:dev` to run without errors. These are **NOT removed** and **MUST be restored** once proper implementations exist.

### Missing Services:

1. **WebhooksService** (referenced in `src/modules/claims/providers/claim-redemption.provider.ts`)
   - **Location:** `src/modules/webhooks/` (does not exist yet)
   - **What was commented out:**
     - Constructor dependency injection (line ~25)
     - Webhook trigger for `sweep.completed` event (line ~106)
     - Webhook trigger for `sweep.failed` event (line ~137)
   - **Why:** Service implementation does not exist, causing TypeScript compilation errors
   - **Impact:** Webhook notifications will NOT fire when claims are redeemed or when sweeps fail
   - **Restoration required:** Once `WebhooksService` is implemented in `src/modules/webhooks/`, uncomment all marked sections

### How to Find Temporary Changes:

Search the codebase for comments containing `TEMPORARY:` to locate all commented-out code that needs restoration.

### Status:

This is a **temporary stabilization** to enable local development and onboarding until missing implementations are complete. **No code was deleted** - all logic remains in place as comments.

---

## Tech Stack

- **Framework:** NestJS (Node.js + TypeScript)
- **Database:** PostgreSQL
- **ORM:** TypeORM
- **Blockchain:** Stellar SDK + Soroban RPC
- **API:** REST api

## Features

- Account lifecycle management (create, claim, expire)
- Claim authentication via signed tokens
- Webhook system for payment events
- Integration with bridgelet-core contracts
- Admin dashboard API endpoints

## Project Structure

```
src/
├── modules/
│   ├── accounts/        # Ephemeral account management
│   ├── claims/          # Claim authentication & processing
│   ├── sweeps/          # Fund sweep orchestration
│   ├── webhooks/        # Event notification system
│   └── stellar/         # Stellar/Soroban integration
├── common/
│   ├── guards/          # Auth guards
│   ├── interceptors/    # Logging, transform
│   └── filters/         # Exception filters
├── config/              # Environment configuration
└── database/            # Migrations, entities
```

## Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Run migrations
npm run migration:run

# Start development server
npm run start:dev
```

## Environment Variables

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=bridgelet
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Stellar
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Security
JWT_SECRET=your-secret-key
CLAIM_TOKEN_EXPIRY=2592000  # 30 days

# Application
PORT=3000
NODE_ENV=development
```

## API Documentation

Once running, access API docs at:

- Swagger: `http://localhost:3000/api/docs`

## Key Endpoints

POST /accounts # Create ephemeral account
GET /accounts/:id # Get account details
POST /claims/initiate # Generate claim token
POST /claims/redeem # Redeem claim and sweep
GET /webhooks # List webhook subscriptions
POST /webhooks # Subscribe to events

## Database Schema

See [Database Schema Documentation](./docs/database-schema.md)

## Development

```bash
# Run tests
npm run test

# Run e2e tests
npm run test:e2e

# Lint
npm run lint

# Format
npm run format
```

## Deployment

See [Deployment Guide](./docs/deployment.md) for production setup.

## Documentation

- [API Reference](./docs/api-reference.md)
- [Database Schema](./docs/database-schema.md)
- [Webhook Events](./docs/webhook-events.md)
- [Deployment Guide](./docs/deployment.md)

Visit http://localhost:3000/api/docs for API documentation.

See [Getting Started Guide](../docs/getting-started.pdf) for full setup instructions.

## Support

(Nest)[https://nestjs.com](https://nestjs.com/)

## License

UNLICENSED
