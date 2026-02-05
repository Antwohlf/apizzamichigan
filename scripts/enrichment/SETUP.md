# Multi-Agent Enrichment Pipeline Setup Guide

This document provides instructions for setting up the multi-agent data enrichment pipeline on the iMac.

## Prerequisites

- iMac with 32GB RAM, 1TB storage
- OpenClaw (clawdbot/openclaw) installed
- Node.js 20+
- PostgreSQL 16
- Ollama with llama3.2:8b model

## What's Already Created

The following files are ready to use:

| File | Purpose |
|------|---------|
| `local-schema-v2.sql` | Extended PostgreSQL schema with agent tracking, caches |
| `sync-from-supabase.mjs` | One-time download from Supabase to local DB |
| `queue.mjs` | SQLite job queue with atomic operations |
| `priority.mjs` | Priority calculation (MI first, then US, etc.) |
| `agents/coordinator.mjs` | Main orchestrator that spawns workers |
| `agents/osm-extractor.mjs` | Worker for Overpass API queries |
| `agents/web-scraper.mjs` | Worker for website scraping |

## What Still Needs to Be Created

The following agents need implementation:

### 1. `agents/llm-classifier.mjs`

LLM classification worker that:
- Claims jobs from queue with `job_type = 'classify'`
- Builds prompts from name + scraped hints
- Calls ollama (primary) or Groq API (fallback)
- Parses JSON response for style/price classification
- Caches results in `classification_cache` table

Key patterns to follow (from osm-extractor.mjs):
```javascript
class LlmClassifier {
  constructor(workerId) { /* ... */ }
  async init() { /* connect to DB, register worker */ }
  async classifyPlace(job) {
    // Build prompt with name, address, scraped hints
    // Call ollama: POST http://localhost:11434/api/generate
    // Fallback to Groq if ollama fails
    // Parse response, update DB
  }
  async run() { /* main loop claiming jobs */ }
}
```

### 2. `agents/sync-agent.mjs`

Supabase sync worker that:
- Runs daily at 2am (or on-demand)
- Reads enriched records from local PostgreSQL
- Batches updates to Supabase (ingress only)
- Tracks sync state to prevent double-writes

### 3. `agents/google-places.mjs` (Optional)

Google Places API worker that:
- Uses $200/month free credit (~90 requests/day)
- Targets high-priority places missing websites
- Prioritizes Michigan first

## Setup Steps on iMac

### 1. Install Dependencies

```bash
# Install PostgreSQL
brew install postgresql@16
brew services start postgresql@16

# Create database
createdb pizza_enrichment

# Install Ollama
brew install ollama
ollama pull llama3.2:8b

# Install OpenClaw (if not already)
npm install -g openclaw@latest

# Install Node dependencies
cd /path/to/apizzamichigan
npm install better-sqlite3 pg cheerio
```

### 2. Initialize Database

```bash
# Run base schema
psql pizza_enrichment < scripts/enrichment/local-schema.sql

# Run extended schema
psql pizza_enrichment < scripts/enrichment/local-schema-v2.sql
```

### 3. Sync Data from Supabase (One-Time)

```bash
# Set environment variables
export SUPABASE_SERVICE_ROLE_KEY="your-key"

# Download all data
node scripts/enrichment/sync-from-supabase.mjs --force
```

### 4. Populate Job Queue

```bash
node scripts/enrichment/agents/coordinator.mjs --populate --type all
```

### 5. Start the Pipeline

```bash
# Foreground mode (for testing)
node scripts/enrichment/agents/coordinator.mjs

# Or check status
node scripts/enrichment/agents/coordinator.mjs --status
```

## Environment Variables

Create `.env` in project root:

```bash
# Supabase (for sync)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
VITE_SUPABASE_URL=https://htahyiuvqmalfpbgiizx.supabase.co

# Local PostgreSQL
PGUSER=your-username
PGPASSWORD=

# Groq API (fallback for LLM)
GROQ_API_KEY=gsk_your-key

# Google Places (optional)
GOOGLE_PLACES_API_KEY=your-key
```

## Monitoring

```bash
# Queue statistics
node scripts/enrichment/queue.mjs stats

# Worker status
node scripts/enrichment/queue.mjs workers

# Progress
node scripts/enrichment/queue.mjs progress osm_extract
```

## Architecture Overview

```
┌─────────────────────┐
│  Coordinator Agent  │  ← Spawns/monitors workers
└──────────┬──────────┘
           │
     ┌─────┼─────┬─────────────┐
     ▼     ▼     ▼             ▼
┌────────┐ ┌────────┐ ┌────────────┐ ┌────────┐
│  OSM   │ │  Web   │ │    LLM     │ │  Sync  │
│Extract │ │Scraper │ │ Classifier │ │ Agent  │
└────────┘ └────────┘ └────────────┘ └────────┘
     │           │           │             │
     └───────────┴───────────┴─────────────┘
                       │
              ┌────────┴────────┐
              │  SQLite Queue   │
              │  (queue.mjs)    │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │ Local PostgreSQL │
              │ (pizza_enrichment)│
              └─────────────────┘
```

## Priority System

Jobs are processed in priority order:

| Priority | Region |
|----------|--------|
| 100 | Michigan |
| 95 | Major US (NY, CA, TX, FL, IL, etc.) |
| 80 | Other US states |
| 60 | Canada |
| 55 | Mexico |
| 50 | Europe |
| 40 | Latin America |
| 30 | Rest of world |

## Rate Limits

| Service | Limit | Notes |
|---------|-------|-------|
| Overpass API | ~10k/day | 2s delay between batches |
| Nominatim | 1 req/sec | For geocoding only |
| Groq API | 30 req/min | LLM fallback |
| Google Places | ~90/day | $200/month free tier |

## Daemon Mode (Future)

To run as a background service, create:

`~/Library/LaunchAgents/com.apizzamichigan.enrichment.plist`

See plan file for plist template.
