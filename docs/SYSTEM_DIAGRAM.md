# APizzaMichigan Local Enrichment System

## Current Production Shape

```mermaid
graph TD
    OP["MacBook Operator<br/>Tailscale SSH"] --> IMAC["Michigan iMac<br/>ants-imac"]

    subgraph "iMac Process Control"
        LAUNCHD["launchd<br/>com.apizzamichigan.classifier"]
        SYNC_SVC["launchd<br/>com.apizzamichigan.supabase-sync"]
        MANUAL["Manual SSH Commands<br/>scrape / OSM / QA"]
    end

    subgraph "Active Classifier Service"
        CLS["LLM Classifier<br/>llm-classifier.mjs"]
    end

    subgraph "Manual / Opt-In Agents"
        OSM["OSM Extractor<br/>osm-extractor.mjs"]
        SCR["Web Scraper<br/>web-scraper.mjs"]
        MP["Menu Parse Slowlane"]
        QA["QA Scripts"]
        SYNC["Guarded Supabase Sync<br/>auto-guarded-supabase-sync.mjs"]
    end

    subgraph "Local State"
        SQLITE[("SQLite Queue<br/>scripts/.job-queue.db")]
        PG[("Local Postgres<br/>pizza_enrichment")]
        LOGS[("/tmp/apizzamichigan/*.log")]
    end

    subgraph "External Services"
        OLLAMA["Ollama<br/>llama3.2:latest"]
        OVERPASS["Overpass API"]
        WEBSITES["Restaurant Websites"]
        SUPABASE["Supabase"]
    end

    OP --> LAUNCHD
    OP --> SYNC_SVC
    OP --> MANUAL
    LAUNCHD --> CLS
    SYNC_SVC --> SYNC
    CLS --> SQLITE
    CLS --> PG
    CLS --> OLLAMA
    CLS --> LOGS

    MANUAL --> OSM
    MANUAL --> SCR
    MANUAL --> MP
    MANUAL --> QA
    MANUAL --> SYNC

    OSM --> SQLITE
    OSM --> PG
    OSM --> OVERPASS
    SCR --> SQLITE
    SCR --> PG
    SCR --> WEBSITES
    MP --> SQLITE
    MP --> PG
    MP --> OLLAMA
    QA --> PG
    SYNC --> PG
    SYNC --> SUPABASE
```

## Data Flow

1. Supabase remains the public production database.
2. The iMac maintains local Postgres (`pizza_enrichment`) as the enrichment working database.
3. SQLite `scripts/.job-queue.db` tracks enrichment jobs and worker state.
4. The first launchd-managed service runs only classification jobs.
5. Supabase sync is launchd-managed through guarded health, QA, readiness,
   dry-run, and protected-field gates.

## Operational Defaults

- Remote control: `ssh apizza-imac`
- Classifier model: `llama3.2:latest`
- Classifier output cap: `OLLAMA_NUM_PREDICT=80`
- Classifier timeout: `OLLAMA_TIMEOUT_MS=240000`
- Sync service: `com.apizzamichigan.supabase-sync`, one guarded 100-row batch every 30 minutes
- Scrape/OSM services: manual only in this phase

## Key Files

| Component | Path |
|-----------|------|
| iMac runbook | `docs/IMAC_PIPELINE_RUNBOOK.md` |
| launchd templates | `infra/local/launchd/` |
| classifier health report | `scripts/ops/classifier-health-report.mjs` |
| classification QA report | `scripts/ops/classification-qa-report.mjs` |
| status report | `scripts/ops/home-status-report.mjs` |
| stale worker cleanup | `scripts/ops/stale-worker-cleanup.mjs` |
| bounded classifier report | `scripts/ops/classifier-batch-report.mjs` |
| classifier | `scripts/enrichment/agents/llm-classifier.mjs` |
| queue | `scripts/enrichment/queue.mjs` |
| guarded sync | `scripts/ops/auto-guarded-supabase-sync.mjs` |
| direct sync engine | `scripts/sync-local-to-supabase.mjs` |
| archived legacy pipeline | `scripts/enrichment/archive/` |
