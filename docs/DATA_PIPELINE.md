# Data Pipeline Documentation

This document describes the data acquisition, enrichment, and maintenance processes for the APizzaMichigan/TacoBoutMichigan project.

## Overview

The project maintains two primary datasets:
- **pizza_places**: ~37,000 pizza restaurants across the US
- **taco_places**: ~33,000 taco/Mexican restaurants across the US

Data is stored in Supabase (PostgreSQL) and sourced primarily from OpenStreetMap.

---

## Data Sources

### Primary Source: OpenStreetMap (OSM)

OpenStreetMap is the primary data source for restaurant locations. The data is freely available and community-maintained.

**Query approach:**
- Use Overpass API to query OSM
- Filter by `amenity=restaurant` or `amenity=fast_food`
- Match by cuisine tags (`cuisine=pizza`, `cuisine=mexican`, etc.) and name patterns
- Extract: name, coordinates, address components, website, phone, hours

**Scripts:**
- `scripts/import-osm-pizza.mjs` - Pizza import script
- `scripts/import-osm-tacos.mjs` - Taco import script
- `scripts/import-all-states.mjs` - Batch import for all US states

### Secondary Sources

1. **Nominatim Reverse Geocoding** - For enriching missing addresses
2. **Name-based inference** - For categorizing chains and styles

---

## Database Schema

### pizza_places

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| name | text | Restaurant name |
| lat | double | Latitude |
| lng | double | Longitude |
| address | text | Full street address |
| state | text | 2-letter state code |
| style | text | Pizza style (e.g., "New York", "Detroit", "Neapolitan") |
| price | text | Price tier ($, $$, $$$) |
| status | text | Visit status (unvisited, visited, golden) |
| notes | text | Additional notes |
| osm_id | bigint | OpenStreetMap node/way ID |
| created_at | timestamp | Record creation time |
| updated_at | timestamp | Last update time |

### taco_places

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| name | text | Restaurant name |
| lat | double | Latitude |
| lng | double | Longitude |
| address | text | Full street address |
| state | text | 2-letter state code |
| style | text | Protein types (comma-separated: "birria, al pastor") |
| price | text | Price tier ($, $$, $$$) |
| status | text | Visit status (unvisited, visited, golden) |
| notes | text | Additional notes |
| osm_id | bigint | OpenStreetMap node/way ID |
| created_at | timestamp | Record creation time |
| updated_at | timestamp | Last update time |

---

## Metadata Enrichment

### Pizza Style Inference

**Script:** `scripts/populate-pizza-metadata.mjs`
**Library:** `scripts/lib/style-inference.mjs`

**Process:**
1. Match known chains to predefined styles/prices
2. Match name keywords to styles (e.g., "Detroit" -> Detroit style)
3. Export unmatched for manual review

**Confidence levels:**
- `chain` - High confidence (known chain match)
- `keyword` - Medium confidence (name contains style keyword)
- `address_keyword` - Low confidence (excluded - matches address not name)

**Pizza styles tracked:**
- New York, Detroit, Chicago, Neapolitan, Sicilian, Greek, St. Louis, New Haven, California, Roman, Coal-Fired, Wood-Fired, Grandma, Bar

### Taco Protein/Type Inference

**Script:** `scripts/populate-taco-metadata.mjs`
**Library:** `scripts/lib/type-inference-tacos.mjs`

**Process:**
1. Match known chains to predefined protein types and prices
2. Match name keywords to protein types (e.g., "birria" in name)
3. Allow multiple types per restaurant (comma-separated)

**Protein types tracked:**
- Carne Asada, Al Pastor, Birria, Carnitas, Chicken, Pollo, Fish, Shrimp, Barbacoa, Lengua, Cabeza, Chorizo, Ground Beef, Veggie

**Chain mappings include:**
- Taco Bell -> Ground Beef, Chicken ($)
- Del Taco -> Ground Beef, Chicken, Carne Asada ($)
- Chipotle -> Carne Asada, Carnitas, Chicken ($$)
- And many more regional chains

### Address Enrichment

**Script:** `scripts/enrich-addresses.mjs`

**Process:**
1. Query places with `address IS NULL`
2. Reverse geocode using Nominatim API
3. Build address from components (street, city, state, zip)
4. Update database with enriched address

**Rate limiting:** 1 request per second (Nominatim requirement)

**Progress tracking:** Saves progress to JSON files to allow resumption:
- `scripts/.address-enrichment-pizza_places.json`
- `scripts/.address-enrichment-taco_places.json`

---

## Scripts Reference

### Import Scripts

| Script | Purpose |
|--------|---------|
| `import-osm-pizza.mjs` | Import pizza places from OSM for a single state |
| `import-osm-tacos.mjs` | Import taco places from OSM for a single state |
| `import-all-states.mjs` | Batch import all US states (pizza) |
| `import-all-tacos-states.mjs` | Batch import all US states (tacos) |

### Enrichment Scripts

| Script | Purpose |
|--------|---------|
| `populate-pizza-metadata.mjs` | Infer pizza styles and prices |
| `populate-taco-metadata.mjs` | Infer taco protein types and prices |
| `enrich-addresses.mjs` | Fill missing addresses via reverse geocoding |
| `migrate-add-state-column.mjs` | Backfill state codes from coordinates |

### Analysis Scripts

| Script | Purpose |
|--------|---------|
| `check-address-coverage.mjs` | Quick stats on address/style coverage |
| `generate-data-quality-report.mjs` | Detailed report with duplicate detection |
| `analyze-pizza-keywords.mjs` | Review pizza keyword matches |

### Utility Libraries

| Library | Purpose |
|---------|---------|
| `lib/style-inference.mjs` | Pizza chain/style matching logic |
| `lib/type-inference-tacos.mjs` | Taco chain/protein matching logic |
| `lib/excluded-taco-chains.mjs` | Chains to exclude (burrito-only, etc.) |
| `lib/state-import-tracker.mjs` | Track import progress by state |

---

## Running Scripts

### Prerequisites

```bash
# Install dependencies
npm install

# Set environment variables in .env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # For write operations
```

### Common Commands

```bash
# Check current data coverage
node scripts/check-address-coverage.mjs

# Run full data quality report
node scripts/generate-data-quality-report.mjs pizza_places
node scripts/generate-data-quality-report.mjs taco_places

# Import from OSM (single state)
node scripts/import-osm-pizza.mjs MI
node scripts/import-osm-tacos.mjs CA

# Enrich metadata
node scripts/populate-pizza-metadata.mjs --phase=1 --commit
node scripts/populate-taco-metadata.mjs --phase=1 --commit

# Enrich missing addresses
node scripts/enrich-addresses.mjs pizza_places --commit
node scripts/enrich-addresses.mjs taco_places --commit
```

---

## Data Quality Metrics

As of the last enrichment run:

### Pizza Places
- Total: 37,187
- With address: ~71% (enrichment in progress)
- With style: ~48%
- Potential duplicates: ~50 groups

### Taco Places
- Total: 33,207
- With address: ~71% (enrichment in progress)
- With style/type: ~28%
- Potential duplicates: ~54 groups

---

## Maintenance Tasks

### Regular Tasks

1. **Re-import from OSM** - Quarterly to catch new restaurants
2. **Duplicate review** - Check `generate-data-quality-report.mjs` output
3. **Address enrichment** - Run for new imports without addresses

### Future Improvements

- [ ] Integrate Google Places API for hours/ratings (requires API key)
- [ ] Add Yelp data enrichment for reviews
- [ ] Automated duplicate merging
- [ ] User-submitted corrections workflow
