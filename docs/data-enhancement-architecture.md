# Zero-Egress Data Enrichment Pipeline

**Status:** Ready for implementation (after baseline imports complete)

## Core Insight

We already have the OSM ID cache with 181k+ IDs locally. We can enrich data **without any Supabase egress**:

```
Local OSM Cache          Overpass API           Local Processing
┌─────────────┐         ┌─────────────┐        ┌─────────────┐
│ osm:node/   │ ──────► │ Full OSM    │ ─────► │ LLM         │
│ 12345       │  parse  │ tags for    │ enrich │ classify    │
│ osm:way/    │   IDs   │ each place  │        │ + scrape    │
│ 67890       │         └─────────────┘        └──────┬──────┘
└─────────────┘                                       │
                                                      ▼
                                            ┌─────────────────┐
                                            │ Supabase UPDATE │
                                            │ (ingress only)  │
                                            └─────────────────┘

Egress cost: $0
```

---

## Goals

1. **Style classification** - Accurate pizza/taco style categorization (using existing taxonomy)
2. **Price range** - $ to $$$$ classification
3. **US quality first** - Deep enrichment for US, then expand internationally
4. **Address enrichment** - Fill in missing addresses from OSM/Nominatim
5. **High confidence only** - No data is better than wrong data

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data scope | OSM places only | Have 181k OSM IDs locally, zero egress |
| Style taxonomy | Use existing | `pizzaStyles.js` and `tacoTypes.js` |
| Field priority | Style > Price > Address > Hours > Website > Phone | Website valuable for scraping |
| Geographic priority | US → North America → Europe → Central/South Americas → Rest | User focus |
| Supabase sync | Daily batch | Balance between freshness and simplicity |
| LLM approach | Single call per place | Avoids hallucination from batch prompts |
| Website scraping | Simple fetch only | Leave room for Puppeteer expansion later |
| Local storage | Local PostgreSQL | Matches Supabase schema exactly |
| Error handling | Mark failed, move on | Can retry later, don't block |
| Monitoring | JSON stats file | Simple, no extra infra |
| Concurrency | Parallel scrapers, rate-limited APIs | Balance speed and respect limits |
| Quality threshold | High-confidence only | No data > wrong data |

---

## Style Taxonomy (Existing)

### Pizza Styles (`src/data/pizzaStyles.js`)
- Traditional
- New York
- Chicago
- Tavern
- Detroit
- Neapolitan
- Sicilian
- Roman
- California

### Taco Types (`src/data/tacoTypes.js`)
- Al Pastor
- Carne Asada
- Carnitas
- Chorizo
- Pollo
- Barbacoa
- Birria
- Lengua
- Fish
- Shrimp
- Ground Beef
- Cabeza
- Veggie

**Important:** LLM must classify into these exact values only. Unknown = null (not saved).

---

## Database Schema (New Columns)

Migration file: `scripts/enrichment/schema-migration.sql`

```sql
-- Add to both pizza_places and taco_places in Supabase
ALTER TABLE pizza_places ADD COLUMN IF NOT EXISTS
  address_source TEXT CHECK (address_source IN ('website', 'osm', 'geocoded')),
  price_range TEXT CHECK (price_range IN ('$', '$$', '$$$', '$$$$')),
  style_confidence TEXT CHECK (style_confidence IN ('confirmed', 'inferred')),
  website_url TEXT,
  phone TEXT,
  hours JSONB,
  enrichment_status TEXT DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed')),
  last_enriched_at TIMESTAMPTZ,
  scrape_method TEXT CHECK (scrape_method IN ('fetch', 'failed')),
  scrape_notes TEXT;
```

**Note:** `style_confidence` only has 'confirmed' and 'inferred' - we don't save 'unknown'.

### Address Confidence Tiers

| Tier | Source | Trust Level |
|------|--------|-------------|
| 1 | Website (scraped from restaurant's own site) | Authoritative |
| 2 | OSM (community-contributed) | Secondary |
| 3 | Geocoded (reverse lookup from lat/lng) | Fallback |

---

## Pipeline Phases

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ZERO-EGRESS ENRICHMENT PIPELINE                   │
└─────────────────────────────────────────────────────────────────────┘

Phase 1: Parse Local Cache
──────────────────────────
  Input:  scripts/.osm-id-cache.json (181k+ IDs)
  Output: Parsed OSM element references

  • Parse "osm:node/12345" → { type: 'node', id: 12345 }
  • Queue for OSM lookup

Phase 2: OSM Deep Extract
─────────────────────────
  Input:  OSM element IDs
  Output: phone, website_url, hours, cuisine tags, full address

  • Overpass API: Batch query by element ID
  • Nominatim: Reverse geocode for missing addresses (1 req/sec)
  • Set address_source = 'osm' or 'geocoded'

Phase 3: Website Scraping (Simple Fetch)
────────────────────────────────────────
  Input:  Places with website_url
  Output: HTML content for LLM extraction

  • Simple fetch() only (no Puppeteer initially)
  • 5 concurrent scrapers max
  • Mark failures with scrape_method='failed', scrape_notes='reason'
  • Leave room for Puppeteer expansion

Phase 4: LLM Classification (Single Call Per Place)
───────────────────────────────────────────────────
  Input:  Name + scraped content + OSM tags
  Output: style, style_confidence, price_range

  • One LLM call per place (prevents hallucination)
  • Only save high-confidence classifications
  • Unknown = null (no data > wrong data)

Phase 5: Daily Supabase Sync
────────────────────────────
  Input:  Local PostgreSQL with enriched data
  Output: Batch UPDATE to Supabase (ingress only)

  • Run once daily
  • Only sync records with enrichment_status = 'enriched'
  • Compare hashes to avoid redundant writes
```

---

## Local Database Architecture

All enrichment work happens against a local PostgreSQL database on the iMac. This avoids Supabase egress costs entirely.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LOCAL-FIRST ENRICHMENT (iMac)                     │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     LOCAL POSTGRESQL                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │  pizza_places   │  │  taco_places    │  │  enrichment_log │   │
│  │  (enriched)     │  │  (enriched)     │  │  (local only)   │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
         │                                              │
         │  ← All enrichment work happens here →        │
         │                                              │
         ▼                                              ▼
┌──────────────────┐                        ┌──────────────────┐
│ Enrichment       │                        │ Daily Sync       │
│ Pipeline         │                        │ (to Supabase)    │
│ • OSM extract    │                        │ • Batch UPDATE   │
│ • Website scrape │                        │ • Ingress only   │
│ • LLM classify   │                        │ • Hash compare   │
└──────────────────┘                        └──────────────────┘
```

### Local PostgreSQL Setup

```bash
# On iMac (brew install postgresql@16)
createdb pizza_enrichment

# Mirror Supabase schema
psql pizza_enrichment < scripts/enrichment/local-schema.sql
```

### Local-Only Tables

```sql
-- Track enrichment attempts
CREATE TABLE enrichment_log (
  id SERIAL PRIMARY KEY,
  osm_id TEXT NOT NULL,  -- e.g., "osm:node/12345"
  place_type TEXT CHECK (place_type IN ('pizza', 'taco')),
  phase TEXT,  -- 'osm_extract', 'scrape', 'classify'
  status TEXT, -- 'success', 'failed', 'skipped'
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track sync state
CREATE TABLE sync_state (
  id SERIAL PRIMARY KEY,
  table_name TEXT,
  records_synced INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

---

## Worker Architecture (iMac 24/7)

```
┌──────────────────────────────────────────────────────────────────┐
│                         REDIS QUEUE                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │ osm:extract │ │ scrape:     │ │ classify:   │ │ sync:      │ │
│  │             │ │ website     │ │ style       │ │ daily      │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
└──────────────────────────────────────────────────────────────────┘
         │                │                │               │
         ▼                ▼                ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ OSM Worker  │  │ Scraper     │  │ LLM Worker  │  │ Sync Worker │
│             │  │ Worker      │  │             │  │             │
│ • Overpass  │  │ • fetch()   │  │ • Groq API  │  │ • Daily     │
│   batch     │  │   only      │  │ • Together  │  │   batch     │
│ • Nominatim │  │ • 5 concur- │  │   fallback  │  │ • Hash      │
│   1 req/sec │  │   rent max  │  │ • 1 per     │  │   compare   │
└─────────────┘  └─────────────┘  │   place     │  └─────────────┘
         │                │       └─────────────┘         │
         └────────────────┴───────────────┬───────────────┘
                                          ▼
                            ┌──────────────────────────┐
                            │   LOCAL POSTGRESQL       │
                            │   (all writes go here)   │
                            └──────────────────────────┘
                                          │
                                    (daily batch)
                                          ▼
                            ┌──────────────────────────┐
                            │      SUPABASE            │
                            │   (UPDATE only, ingress) │
                            └──────────────────────────┘

Geographic Priority Queue:
  1. US (50 states) - ~73k places
  2. Canada + Mexico - ~8k places
  3. Europe - ~40k places
  4. Central/South Americas - ~15k places
  5. Rest of world
```

---

## Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Queue | **Redis + BullMQ** | Resume capability, monitoring |
| LLM | **Groq API (primary)** | Free tier, extremely fast |
| LLM Fallback | **Together.ai** | Backup when Groq rate limited |
| Model | **Llama 3.1 8B** (via API) | Good balance of speed/quality |
| Scraping | **fetch only** | Simple first, Puppeteer later if needed |
| Local DB | **PostgreSQL** | Matches Supabase schema |

### LLM Strategy

Free API tiers keep costs at $0:

```
Primary:   Groq (free tier: 30 req/min, very fast)
Fallback:  Together.ai (free tier: modest limits)
Emergency: OpenRouter (pay-per-use if needed)
```

---

## Rate Limits & Costs

| Service | Rate Limit | Cost | Concurrency |
|---------|------------|------|-------------|
| Overpass API | ~10,000/day reasonable | Free | 1 (batch) |
| Nominatim | 1 req/sec | Free | 1 |
| Website scraping | Self-limited | Free | 5 parallel |
| Groq API | 30 req/min | Free | 1 |
| Together.ai | ~60 req/min | Free | 1 |
| Supabase writes | Unlimited | Free (ingress) | Batch |

**Estimated time for US enrichment (~73,000 places):**
- OSM extraction: ~7 hours (batch queries)
- Website scraping: ~4 hours (5 concurrent)
- LLM classification: ~41 hours (30/min = 1800/hour)
- **Total: ~2-3 days running 24/7**

---

## Monitoring: JSON Stats File

```javascript
// scripts/.enrichment-stats.json
{
  "lastUpdated": "2026-02-01T12:00:00Z",
  "pizza": {
    "total": 135000,
    "pending": 62000,
    "enriched": 71500,
    "failed": 1500,
    "byRegion": {
      "US": { "total": 73000, "enriched": 71500, "failed": 1500 },
      "CA": { "total": 5000, "enriched": 0, "failed": 0 }
    }
  },
  "taco": { ... },
  "phases": {
    "osm_extract": { "processed": 73000, "success": 72500, "failed": 500 },
    "scrape": { "processed": 50000, "success": 35000, "failed": 15000 },
    "classify": { "processed": 35000, "success": 33000, "failed": 2000 }
  }
}
```

---

## File Structure

```
scripts/
├── .osm-id-cache.json          # Existing: 181k OSM IDs
├── .enrichment-stats.json      # Progress tracking
├── enrichment/
│   ├── schema-migration.sql    # Supabase column additions
│   ├── local-schema.sql        # Local PostgreSQL schema
│   ├── orchestrator.mjs        # Main coordinator
│   ├── workers/
│   │   ├── osm-extractor.mjs   # Query Overpass by ID
│   │   ├── website-scraper.mjs # Simple fetch
│   │   ├── style-classifier.mjs # Single LLM call per place
│   │   └── daily-sync.mjs      # Batch to Supabase
│   ├── lib/
│   │   ├── local-db.mjs        # Local PostgreSQL client
│   │   ├── redis-queue.mjs     # BullMQ wrapper
│   │   ├── llm-client.mjs      # Groq/Together.ai client
│   │   ├── scraper.mjs         # fetch() wrapper
│   │   └── prompts.mjs         # LLM prompts
│   └── config.mjs              # Rate limits, priorities
```

---

## Implementation Order

1. [x] **Schema migration SQL** - `scripts/enrichment/schema-migration.sql`

2. [ ] **Local PostgreSQL setup** (on iMac)
   - Install PostgreSQL 16
   - Create `pizza_enrichment` database
   - Run local schema SQL

3. [ ] **OSM ID parser + extractor**
   - Parse cache file
   - Batch Overpass queries
   - Store results locally

4. [ ] **Simple website scraper**
   - fetch() only
   - 5 concurrent workers
   - Mark failures with reason

5. [ ] **LLM classifier (Groq primary)**
   - Single call per place
   - Match to existing style taxonomy
   - Only save high-confidence results

6. [ ] **Daily sync to Supabase**
   - Batch UPDATE (ingress only)
   - Hash comparison
   - Cron job at 2am

7. [ ] **Redis + BullMQ setup**
   - Resume capability
   - Progress tracking

8. [ ] **Stats file updater**
   - Update `.enrichment-stats.json` periodically

---

## Verification

1. **OSM extraction test:**
   - Run on 100 random US OSM IDs
   - Verify full tags retrieved
   - Check Nominatim addresses

2. **Scraper test:**
   - Sample 50 places with websites
   - Verify success/failure tracking
   - Check fetch-only works for most

3. **LLM classification test:**
   - Manual review of 100 classifications
   - Verify only known styles saved
   - Check confidence is appropriate

4. **Full pipeline test:**
   - Run on Michigan (~2000 places)
   - Measure success rate
   - Verify Supabase sync works

---

*Last updated: 2026-02-01*
