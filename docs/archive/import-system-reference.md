# Pizza & Taco Import System Reference (Archived)

> ⚠️ This file is kept for historical reference.
> 
> Current docs:
> - `docs/DATA_PIPELINE.md`
> - `docs/world-coverage.md`
> - `docs/data-enhancement-architecture.md`
> - `scripts/enrichment/SETUP.md`


## Overview
This project imports pizza and taco places from OpenStreetMap into Supabase for a dual-themed map application ("A Pizza Michigan" / "Taco 'Bout Michigan").

## Current Coverage

| Region | Pizza | Tacos | Script |
|--------|-------|-------|--------|
| USA (50 states) | ~37,201 | ~36,068 | `import-all-states.mjs`, `import-all-tacos-states.mjs` |
| Canada (13 provinces) | ✅ | ✅ | `import-international.mjs` |
| Mexico (32 states) | ✅ | ✅ | `import-international.mjs` |
| Europe (26 countries) | ✅ 81,500 | ✅ 5,292 | `import-europe.mjs` |
| Central America (7 countries) | ✅ | ✅ | `import-latin-america.mjs` |
| South America (12 countries) | ✅ | ✅ | `import-latin-america.mjs` |
| Asia-Pacific (15 countries) | ✅ ~15,000 | ⚠️ Limited | Global scripts (see below) |
| Middle East (5 countries) | ✅ ~1,000 | ❌ | Global scripts (see below) |
| Africa (5 countries) | ✅ ~700 | ❌ | Global scripts (see below) |

**See `docs/world-coverage.md` for complete country-by-country status.**

---

## Scripts Reference

### Core Import Scripts

```bash
# Pizza import - single region
node scripts/import-osm-pizza.mjs --state "Michigan" --state-code "MI"
node scripts/import-osm-pizza.mjs --state "Bayern" --state-code "BY" --admin-level 4
node scripts/import-osm-pizza.mjs --state "Michigan" --state-code "MI" --dry-run

# Taco import - single region
node scripts/import-osm-tacos.mjs --state "Texas" --state-code "TX"
node scripts/import-osm-tacos.mjs --state "Jalisco" --state-code "JAL" --admin-level 4
node scripts/import-osm-tacos.mjs --state "Texas" --state-code "TX" --dry-run
```

### Batch Import Scripts

```bash
# US States (all 50)
node scripts/import-all-states.mjs              # Full pizza import
node scripts/import-all-tacos-states.mjs        # Full taco import
node scripts/import-all-states.mjs --report     # Progress report
node scripts/import-all-states.mjs --dry-run    # Preview mode

# Canada + Mexico
node scripts/import-international.mjs                    # Both countries, pizza + tacos
node scripts/import-international.mjs --canada-only      # Canada only
node scripts/import-international.mjs --mexico-only      # Mexico only
node scripts/import-international.mjs --pizza-only       # Pizza only
node scripts/import-international.mjs --tacos-only       # Tacos only
node scripts/import-international.mjs --report           # Progress report
node scripts/import-international.mjs --dry-run          # Preview mode

# Europe
node scripts/import-europe.mjs                    # All countries
node scripts/import-europe.mjs --italy-only       # Single country
node scripts/import-europe.mjs --pizza-only       # Pizza only
node scripts/import-europe.mjs --tacos-only       # Tacos only
node scripts/import-europe.mjs --report           # Progress report
node scripts/import-europe.mjs --dry-run          # Preview mode
node scripts/import-europe.mjs --limit=5          # Limit regions

# Latin America (Central + South America)
node scripts/import-latin-america.mjs                    # All 19 countries
node scripts/import-latin-america.mjs --brazil-only      # Single country
node scripts/import-latin-america.mjs --central-america-only  # 7 Central American countries
node scripts/import-latin-america.mjs --south-america-only    # 12 South American countries
node scripts/import-latin-america.mjs --wave1-only       # Brazil, Argentina, Colombia, Chile
node scripts/import-latin-america.mjs --wave2-only       # Peru, Venezuela, Ecuador, Central America
node scripts/import-latin-america.mjs --wave3-only       # Bolivia, Paraguay, Uruguay, Guyana, Suriname
node scripts/import-latin-america.mjs --pizza-only       # Pizza only
node scripts/import-latin-america.mjs --tacos-only       # Tacos only
node scripts/import-latin-america.mjs --report           # Progress report
node scripts/import-latin-america.mjs --dry-run          # Preview mode
node scripts/import-latin-america.mjs --limit=5          # Limit regions
```

### Global Import Scripts (Country-Level)

These scripts search entire countries at once using ISO country codes, rather than individual regions.

```bash
# Pizzerias by name (23 countries - Asia, Middle East, Africa, Oceania)
node scripts/import-pizzerias-by-name.mjs
# Searches for "Pizza", "Pizzeria", "Пицца", "ピザ", "피자"
# Result: 11,425 pizzerias

# Pizza & Taco chains (20 countries worldwide)
node scripts/import-chains.mjs
# Searches for Domino's, Pizza Hut, Taco Bell, Chipotle, etc.
# Result: 4,714 pizza + 310 taco = 5,024 places

# Additional cuisine tags (25 countries)
node scripts/import-additional-cuisines.mjs
# Pizza: neapolitan, napoletana, roman_pizza, sicilian, detroit_pizza, etc.
# Taco: burrito, quesadilla, latin_american, peruvian, colombian, etc.
# Result: 105 pizza + 1,402 taco = 1,507 places

# Street food / food carts (18 countries)
node scripts/import-street-food.mjs
# Searches food trucks, kiosks, takeaway-only with pizza/taco names
# Result: 5,940 pizza + 690 taco = 6,630 places

# Retry failed 504 queries with simpler patterns
node scripts/import-retry-failed.mjs
# Breaks large regex patterns into smaller chunks (3-4 alternatives)
# Result: 1,174 pizza + 1,095 taco = 2,269 places
```

**Total from global scripts: ~26,855 places (before deduplication)**

### Data Quality Scripts

```bash
# Data quality report
node scripts/generate-data-quality-report.mjs pizza_places      # All states
node scripts/generate-data-quality-report.mjs pizza_places MI   # Michigan only
node scripts/generate-data-quality-report.mjs taco_places       # All tacos

# Fix missing state codes
node scripts/fix-missing-state-codes.mjs taco_places --dry-run
node scripts/fix-missing-state-codes.mjs taco_places

# Pizza metadata (chain matching)
node scripts/populate-pizza-metadata.mjs --stats
node scripts/populate-pizza-metadata.mjs --phase=1 --chains-only --commit
```

---

## Database Structure

### Tables
- `pizza_places` - Pizza locations
- `taco_places` - Taco/Mexican locations

### Key Columns
- `name`, `lat`, `lng`, `address`
- `state` - VARCHAR(4) for region codes (MI, CA, CDMX, BY, etc.)
- `google_place_id` - Used as OSM ID (format: `osm:node/12345`)
- `status` - visited/unvisited/golden
- `style`, `price`, `rating`, `notes`

### Environment Variables
```bash
VITE_SUPABASE_URL=https://htahyiuvqmalfpbgiizx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<required for imports - bypasses RLS>
VITE_SUPABASE_ANON_KEY=<for app frontend>
```

---

## Key Technical Details

### OSM Admin Levels
| Region Type | Admin Level |
|-------------|-------------|
| US states | 4 |
| Canadian provinces | 4 |
| Mexican states | 4 |
| Most European regions | 4 |
| Portugal districts | 6 |
| Hungary counties | 6 |
| Irish provinces | 5 |
| Greek regions | 5 |
| Croatian counties | 4 |
| All Latin American countries | 4 |

### OSM Region Names
OSM uses **native language names**, not English:
- ❌ "Bavaria" → 0 results
- ✅ "Bayern" → 2,242 results
- ❌ "Lombardy" → 0 results
- ✅ "Lombardia" → 3,304 results

### Overpass API Endpoints
```javascript
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',      // Primary
  'https://lz4.overpass-api.de/api/interpreter',  // Mirror
  'https://overpass.kumi.systems/api/interpreter' // Fallback
]
```
Scripts automatically try each endpoint on failure.

### Rate Limiting
- 60-second delays between regions (Overpass API etiquette)
- IP-based rate limiting (same WiFi = same IP = no benefit from multiple computers)
- Adaptive delays on 429/503 errors

---

## Chain Filtering

### Excluded from Taco Imports
Chipotle, Qdoba, Moe's Southwest Grill, Cafe Rio, Freebirds, Pancheros, Baja Fresh, Costa Vida, California Tortilla, Boloco, Illegal Pete's

**Note**: Taco Bell is NOT excluded (they serve tacos).

### Pizza Chain Metadata
12,821 places tagged via chain matching:
- Domino's, Pizza Hut, Little Caesars, Papa John's → Traditional, $
- Jet's, Buddy's, Via 313 → Detroit, $$
- Sbarro → New York, $$
- Lou Malnati's, Giordano's, Uno → Chicago, $$

---

## Progress Tracking Files

| File | Purpose |
|------|---------|
| `.state-import-progress.json` | US pizza import |
| `.taco-state-import-progress.json` | US taco import |
| `.international-import-progress.json` | Canada/Mexico |
| `.europe-import-progress.json` | Europe |
| `.latin-america-import-progress.json` | Latin America |

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/import-osm-pizza.mjs` | Core pizza import (single region) |
| `scripts/import-osm-tacos.mjs` | Core taco import (single region) |
| `scripts/import-all-states.mjs` | US pizza orchestrator |
| `scripts/import-all-tacos-states.mjs` | US taco orchestrator |
| `scripts/import-international.mjs` | Canada/Mexico orchestrator |
| `scripts/import-europe.mjs` | Europe orchestrator |
| `scripts/import-latin-america.mjs` | Latin America orchestrator (19 countries, ~327 regions) |
| `scripts/import-pizzerias-by-name.mjs` | Global pizzeria search (23 countries) |
| `scripts/import-chains.mjs` | Global chain search (20 countries) |
| `scripts/import-additional-cuisines.mjs` | Additional cuisine tags (25 countries) |
| `scripts/import-street-food.mjs` | Street food/carts (18 countries) |
| `scripts/import-retry-failed.mjs` | Retry failed 504 queries with chunked patterns |
| `scripts/lib/excluded-taco-chains.mjs` | Chain exclusion list |
| `scripts/lib/style-inference.mjs` | Pizza style detection |
| `src/data/stateCentroids.js` | Map navigation coordinates |
| `src/pages/DataDashboard.js` | Statistics dashboard |
| `docs/world-coverage.md` | World coverage status |

---

## Common Issues & Solutions

### RLS Blocking Inserts
**Solution**: Use `SUPABASE_SERVICE_ROLE_KEY` in `.env`

### Overpass API Timeouts
**Solution**: Scripts auto-retry with fallback endpoints

### Map Crash on Theme Switch
**Solution**: Added `key` prop to MapView and state-based stability check in PlacesLayer.js

### OSM Returns 0 Results
**Solutions**:
1. Check native language name (Bayern not Bavaria)
2. Verify correct admin_level for country
3. Query Overpass Turbo directly to find exact boundary names

### Query OSM Boundaries
```
[out:json][timeout:25];
area["ISO3166-1"="DE"]->.country;
(
  relation["admin_level"="4"]["boundary"="administrative"](area.country);
);
out tags;
```
Change "DE" to country code, adjust admin_level as needed.

---

## Development Notes

### Running Imports
1. Ensure `.env` has `SUPABASE_SERVICE_ROLE_KEY`
2. Use `--dry-run` first to preview
3. Check `--report` to see progress
4. Use `--limit=N` for testing
5. Monitor with `tail -f /tmp/<import>.log` for background runs

### Adding New Countries
1. Research OSM boundary names (native language)
2. Verify admin_level for regions
3. Add to appropriate import script
4. Add centroids to `stateCentroids.js`
5. Update country detection in `DataDashboard.js`

---

---

## Global Import Coverage (Feb 2026)

### Countries Searched by Global Scripts

**Pizzerias by name (23 countries):**
Japan, South Korea, China, India, Indonesia, Thailand, Vietnam, Philippines, Malaysia, Turkey, Saudi Arabia, UAE, Egypt, Israel, South Africa, Nigeria, Kenya, Morocco, Russia, Ukraine, Poland, Australia, New Zealand

**Chains (20 countries):**
US, Canada, Mexico, UK, Germany, France, Spain, Italy, Australia, Japan, South Korea, China, India, Brazil, Russia, South Africa, UAE, Saudi Arabia, Philippines, Indonesia

**Additional cuisines (25 countries):**
US, Canada, Mexico, Brazil, Argentina, Colombia, Peru, Chile, Italy, Germany, France, Spain, UK, Netherlands, Belgium, Austria, Switzerland, Poland, Australia, Japan, South Korea, China, India, Thailand, Singapore

**Street food (18 countries):**
Mexico, Guatemala, El Salvador, Colombia, Peru, Brazil, Argentina, US, Italy, France, Germany, UK, Spain, Thailand, Vietnam, Indonesia, Philippines, India

### Countries NOT Searched

- **Central Asia:** Kazakhstan, Uzbekistan, Turkmenistan, Tajikistan, Kyrgyzstan
- **Most of Africa:** Only 5 countries covered (South Africa, Nigeria, Kenya, Morocco, Egypt)
- **Caribbean:** Cuba, Jamaica, Haiti, Dominican Republic, Puerto Rico, etc.
- **Balkans:** Serbia, Bosnia, Montenegro, Albania, Kosovo, North Macedonia
- **Scandinavia:** Norway, Sweden, Finland, Denmark, Iceland (covered by Europe script, not global)
- **Pacific Islands:** Fiji, Papua New Guinea, etc.

### Known Data Gaps

| Issue | Countries Affected | Reason |
|-------|-------------------|--------|
| Zero results | China, Russia | Different character sets, local platforms |
| Repeated 504 timeouts | India, Brazil, Canada | Large countries, complex OSM data |
| No taco culture | Most of Asia, Africa, Middle East | Tacos aren't common outside Americas |

---

*Last updated: February 2026*
