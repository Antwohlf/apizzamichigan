# APizzaMichigan Local Enrichment System

## Current Production Shape

```mermaid
graph TD
    OP["MacBook Operator<br/>Tailscale SSH"] --> IMAC["Michigan iMac<br/>ants-imac"]

    subgraph "iMac Process Control"
        LAUNCHD["launchd<br/>com.apizzamichigan.classifier"]
        MANUAL["Manual SSH Commands<br/>scrape / OSM / sync / QA"]
    end

    subgraph "Active Classifier Service"
        CLS["LLM Classifier<br/>llm-classifier.mjs"]
    end

    subgraph "Manual / Opt-In Agents"
        OSM["OSM Extractor<br/>osm-extractor.mjs"]
        SCR["Web Scraper<br/>web-scraper.mjs"]
        MP["Menu Parse Slowlane"]
        QA["QA Scripts"]
        SYNC["Manual Supabase Sync<br/>sync-local-to-supabase.mjs"]
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
    OP --> MANUAL
    LAUNCHD --> CLS
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
5. Supabase sync is a manual dry-run-first operation until explicitly approved.

## Operational Defaults

- Remote control: `ssh apizza-imac`
- Classifier model: `llama3.2:latest`
- Classifier output cap: `OLLAMA_NUM_PREDICT=80`
- Classifier timeout: `OLLAMA_TIMEOUT_MS=240000`
- Sync workers: disabled by default (`SYNC_WORKERS=0`)
- Scrape/OSM services: manual only in this phase

## Key Files

| Component | Path |
|-----------|------|
| iMac runbook | `docs/IMAC_PIPELINE_RUNBOOK.md` |
| launchd templates | `infra/local/launchd/` |
| classifier health report | `scripts/ops/classifier-health-report.mjs` |
| status report | `scripts/ops/home-status-report.mjs` |
| stale worker cleanup | `scripts/ops/stale-worker-cleanup.mjs` |
| bounded classifier report | `scripts/ops/classifier-batch-report.mjs` |
| classifier | `scripts/enrichment/agents/llm-classifier.mjs` |
| queue | `scripts/enrichment/queue.mjs` |
| manual sync | `scripts/sync-local-to-supabase.mjs` |
| archived legacy pipeline | `scripts/enrichment/archive/` |
