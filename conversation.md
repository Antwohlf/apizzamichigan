# Conversation Summary: Nationwide Pizza Import Expansion

## Overview
This conversation covered expanding the pizza place discovery system from Michigan-only to all 50 US states.

## Context
The project already had scripts to import pizza places from OpenStreetMap for Michigan:
- `scripts/import-osm-pizza.mjs` - Core import script
- `scripts/populate-pizza-metadata.mjs` - Enriches data with Yelp scraping
- Supporting libraries in `scripts/lib/` for rate limiting, progress tracking, etc.

The app ("A Pizza Michigan") had 1,297 pizza places imported for Michigan, with an "And Beyond" button that zooms out to show data outside Michigan.

## What Was Implemented

### 1. Database Migration
Added a `state` column (VARCHAR(2)) to the `pizza_places` table:
```sql
ALTER TABLE pizza_places ADD COLUMN state VARCHAR(2);
CREATE INDEX idx_pizza_places_state ON pizza_places(state);
UPDATE pizza_places SET state = 'MI' WHERE state IS NULL;
```

### 2. Modified `import-osm-pizza.mjs`
- Added `--state` and `--state-code` CLI parameters
- Made Overpass API query dynamic (accepts any state name)
- Added state-aware deduplication (prevents false matches at state borders)
- Fixed address building to not return just "MI" when no address data exists
- Added `state` field to database inserts

**Usage:**
```bash
node scripts/import-osm-pizza.mjs --state "Ohio" --state-code "OH" --dry-run
node scripts/import-osm-pizza.mjs --state "California" --state-code "CA"
```

### 3. Created `scripts/lib/state-import-tracker.mjs`
Progress tracking class for multi-state imports:
- Tracks completed, failed, and pending states
- Stores record counts per state
- Supports resume capability
- Generates summary reports

### 4. Created `scripts/import-all-states.mjs`
Wrapper script to loop through all 49 remaining states:
- Contains mapping of all 50 US states (OSM name → 2-letter code)
- 60-second delays between states (Overpass API etiquette)
- Automatic retry on failures (up to 3 attempts)
- Progress saved after each state for resume capability

**Usage:**
```bash
node scripts/import-all-states.mjs              # Full import
node scripts/import-all-states.mjs --dry-run    # Preview mode
node scripts/import-all-states.mjs --limit=5    # Only 5 states
node scripts/import-all-states.mjs --report     # Show progress
```

### 5. Created `scripts/migrate-add-state-column.mjs`
Helper script for database migration (user ran SQL manually instead).

## Files Changed/Created

| File | Status | Description |
|------|--------|-------------|
| `scripts/import-osm-pizza.mjs` | Modified | Added state parameters and state-aware logic |
| `scripts/import-all-states.mjs` | Created | Wrapper for nationwide import |
| `scripts/lib/state-import-tracker.mjs` | Created | Progress tracking for multi-state imports |
| `scripts/migrate-add-state-column.mjs` | Created | Database migration helper |

## Key Design Decisions

1. **State column in database** - Prevents duplicate detection issues at state borders and enables future filtering
2. **Keep app Michigan-focused** - Default map view stays on Michigan; "And Beyond" button shows nationwide data
3. **60-second delays** - Conservative rate limiting for Overpass API
4. **Resume capability** - Progress saved to `.state-import-progress.json` after each state

## Expected Results
- **Runtime:** 1-2 hours for full 49-state import
- **Records:** 50,000-100,000 pizza places nationwide (estimated)
- **Success rate:** 96-100% of states

## Next Steps
1. Install Node.js on new computer (`nvm install --lts`)
2. Run `npm install` in project directory
3. Test with single state: `node scripts/import-osm-pizza.mjs --state "Ohio" --state-code "OH" --dry-run`
4. Run full import: `node scripts/import-all-states.mjs`
5. After import, run metadata enrichment: `node scripts/populate-pizza-metadata.mjs`

## Notes
- Existing Michigan data with `address = 'MI'` can be cleaned up later with: `UPDATE pizza_places SET address = NULL WHERE address = 'MI';`
- The metadata enrichment script is already nationwide-compatible and needs no changes

---

# Session 2: Nationwide Import Execution (January 2026)

## Overview
Executed the nationwide pizza import on a new computer, resolving several issues along the way.

## Environment Setup
1. Installed Node.js v24.13.0 via nvm (`nvm install --lts`)
2. Installed 1,431 npm packages (`npm install`)

## Script Improvements Made

### 1. Overpass API Endpoint Fallback
The main Overpass API was frequently timing out. Added automatic fallback to try multiple endpoints:

```javascript
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
]
```

The script now tries each endpoint in order until one succeeds.

### 2. Service Role Key for RLS Bypass
Supabase Row Level Security was blocking inserts with the anonymous key. Updated the script to use `SUPABASE_SERVICE_ROLE_KEY`:

```javascript
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
```

**Required:** Add `SUPABASE_SERVICE_ROLE_KEY` to `.env` file (get from Supabase Dashboard → Settings → API → Service Role key)

## Import Execution

### Initial Run
- Ran `node scripts/import-all-states.mjs`
- First 8 states (Alabama through Delaware) failed silently due to RLS - marked as "complete" with 0 records
- Remaining 41 states imported successfully

### Re-run for Missing States
Manually ran the 8 missing states after fixing the RLS issue:

```bash
for state in "Alabama:AL" "Alaska:AK" "Arizona:AZ" "Arkansas:AR" \
             "California:CA" "Colorado:CO" "Connecticut:CT" "Delaware:DE"; do
  name="${state%:*}"
  code="${state#*:}"
  node scripts/import-osm-pizza.mjs --state "$name" --state-code "$code"
  sleep 60
done
```

## Final Results

### States Re-imported (8 states)
| State | Places Inserted |
|-------|----------------|
| Alabama | 364 |
| Alaska | 94 |
| Arizona | 824 |
| Arkansas | 267 |
| California | 3,708 |
| Colorado | 826 |
| Connecticut | 502 |
| Delaware | 154 |
| **Subtotal** | **6,739** |

### Full Database
- **Total pizza places in database:** 37,201
- **States covered:** All 50 US states
- Michigan (original): ~1,400
- Other 49 states: ~35,800

## Issues Encountered & Resolved

| Issue | Solution |
|-------|----------|
| Overpass API 504 timeouts | Added fallback endpoints (kumi, main, lz4) |
| Supabase RLS blocking inserts | Use `SUPABASE_SERVICE_ROLE_KEY` instead of anon key |
| 8 states marked complete but empty | Re-ran manually after RLS fix |
| Kumi endpoint returning XML errors | Script automatically falls back to next endpoint |

## Files Modified

| File | Changes |
|------|---------|
| `scripts/import-osm-pizza.mjs` | Added endpoint fallback, service role key support |

## Next Steps
1. Run metadata enrichment: `node scripts/populate-pizza-metadata.mjs`
2. Verify all states appear on map via "And Beyond" button
3. Consider cleaning up `address = 'MI'` records: `UPDATE pizza_places SET address = NULL WHERE address = 'MI';`

---

# Session 3: Nationwide Taco Import (January 2026)

## Overview
Applied the same nationwide import approach to the taco side of the website ("Taco 'Bout Michigan"). Created taco-specific import scripts mirroring the pizza infrastructure.

## What Was Implemented

### 1. Database Migration
Added a `state` column to the `taco_places` table:
```sql
ALTER TABLE taco_places ADD COLUMN state VARCHAR(2);
CREATE INDEX idx_taco_places_state ON taco_places(state);
```

### 2. Created `scripts/import-osm-tacos.mjs`
Adapted from `import-osm-pizza.mjs` with:
- OSM query for Mexican/taco cuisine: `["cuisine"~"mexican|taco|tex-mex|burrito"]`
- Inserts to `taco_places` table instead of `pizza_places`
- Same features: `--state`, `--state-code`, `--dry-run`, endpoint fallback, deduplication

**Usage:**
```bash
node scripts/import-osm-tacos.mjs --state "Michigan" --state-code "MI" --dry-run
node scripts/import-osm-tacos.mjs --state "Texas" --state-code "TX"
```

### 3. Created `scripts/import-all-tacos-states.mjs`
Multi-state orchestrator adapted from `import-all-states.mjs`:
- Calls `import-osm-tacos.mjs` for each state
- Uses separate progress file: `.taco-state-import-progress.json`
- Same 60-second delays and retry logic

**Usage:**
```bash
node scripts/import-all-tacos-states.mjs              # Full import
node scripts/import-all-tacos-states.mjs --dry-run    # Preview mode
node scripts/import-all-tacos-states.mjs --report     # Show progress
```

### 4. Fixed Supabase 1000-Row Limit Bug
The taco map was only showing 1,000 places due to Supabase's default row limit. Fixed `src/App.js` to use pagination for both pizza and taco fetches:
- Removed special case for taco that called `fetchTacoPlaces()` without pagination
- Now both themes use the same paginated fetch pattern with `.range()` calls

### 5. Fixed Leaflet Map Switch Error
When switching between pizza and taco maps, a race condition caused "Cannot read properties of null (reading 'getMinZoom')" error. Fixed by adding a `key` prop to `MapView`:
```jsx
<MapView
  key={isPizza ? 'pizza-map' : 'taco-map'}
  ...
/>
```
This forces React to fully unmount/remount the map when switching themes.

## Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `scripts/import-osm-tacos.mjs` | Created | Taco-specific OSM import script |
| `scripts/import-all-tacos-states.mjs` | Created | Multi-state taco import orchestrator |
| `src/App.js` | Modified | Fixed pagination for tacos, added map key prop |

## Import Execution

### Initial Michigan Import
```bash
node scripts/import-osm-tacos.mjs --state "Michigan" --state-code "MI"
```
- Found 861 taco places from OSM
- 10 skipped as duplicates of existing entries
- **851 places inserted**

### Nationwide Import
```bash
node scripts/import-all-tacos-states.mjs
```
- Runtime: ~4 hours
- 49/50 states completed on first pass
- Pennsylvania failed (Overpass API connectivity) - manually retried successfully

## Final Results

| Stat | Value |
|------|-------|
| States completed | **50/50** |
| Total taco places | **~36,068** |
| Runtime | ~4 hours |

### Top 10 States by Taco Places
| Rank | State | Count |
|------|-------|-------|
| 1 | California | 5,977 |
| 2 | Texas | 4,102 |
| 3 | New York | 1,576 |
| 4 | Illinois | 1,430 |
| 5 | Florida | 1,394 |
| 6 | Washington | 1,350 |
| 7 | Arizona | 1,297 |
| 8 | Virginia | 1,230 |
| 9 | Colorado | 1,221 |
| 10 | Ohio | 1,174 |

## Issues Encountered & Resolved

| Issue | Solution |
|-------|----------|
| `taco_places.state` column missing | Ran SQL migration to add column |
| Taco map showing only 1,000 places | Fixed App.js to use pagination for tacos |
| Map crash when switching themes | Added `key` prop to force map remount |
| Pennsylvania import failed | Manually retried after main job completed |

## Key Differences: Pizza vs Taco Import

| Aspect | Pizza | Taco |
|--------|-------|------|
| OSM cuisine query | `pizza` | `mexican\|taco\|tex-mex\|burrito` |
| Database table | `pizza_places` | `taco_places` |
| Progress file | `.state-import-progress.json` | `.taco-state-import-progress.json` |
| Total places | ~37,201 | ~36,068 |

## Notes
- The `StateImportTracker` class already supported custom progress file paths via constructor parameter
- California and Texas dominate taco counts (as expected)
- OSM has good coverage of Mexican restaurants due to chain tagging (Taco Bell, Chipotle, etc.)

---

# Conversation Summary: Data Quality & Map Stability Improvements (Jan 2026)

## Overview
This session addressed three main concerns with the pizza/taco map:
1. Non-taco chains (Chipotle, Qdoba) appearing on taco map
2. Map switching errors when navigating between pizza and taco views
3. Data duplicates and quality issues

## What Was Implemented

### 1. Chain Exclusion for Taco Imports

**Problem**: Chipotle, Qdoba, and similar burrito-focused chains were included because they're tagged with `cuisine=mexican|burrito` in OSM, but they don't serve traditional tacos.

**Solution**: Created exclusion list to filter out non-taco chains during import.

**Files Created/Modified**:
- `scripts/lib/excluded-taco-chains.mjs` - Exclusion list module
- `scripts/import-osm-tacos.mjs` - Integrated chain filtering

**Excluded Chains**:
- Chipotle, Qdoba, Moe's Southwest Grill, Cafe Rio, Freebirds, Pancheros, Baja Fresh, Costa Vida, California Tortilla, Boloco, Illegal Pete's

**Note**: Taco Bell is NOT excluded (they serve tacos). Domino's/Little Caesars/Pizza Hut are NOT excluded from pizza (they serve pizza).

**Usage**: Chain filtering happens automatically during import. Output shows:
```
Parsed 1234 valid taco places with names (excluded 56 non-taco chains)
```

### 2. Map Switching Stability Fix

**Problem**: Error `Cannot read properties of null (reading 'getMinZoom')` when switching between pizza and taco maps.

**Root Cause**: React-Leaflet's `useMap()` can return null during component transitions, and the MarkerClusterGroup tries to access map methods on a null instance.

**Solution**: Added null guards in `PlacesLayer.js`:
- Null checks in `MapClickCloser` useEffect
- Try-catch wrapper in `flyToPlace` callback
- Map readiness check before rendering MarkerClusterGroup

**IMPORTANT**: Initial fix used early return before hooks, which violated React's rules of hooks. The correct fix is to:
1. Keep all hooks at the top (unconditionally)
2. Add `isMapReady` check AFTER hooks
3. Use conditional return at the END of the component

**File Modified**: `src/map/PlacesLayer.js`

### 3. Data Quality Report Script

**Created**: `scripts/generate-data-quality-report.mjs`

**Usage**:
```bash
node scripts/generate-data-quality-report.mjs pizza_places      # All states
node scripts/generate-data-quality-report.mjs pizza_places MI   # Michigan only
node scripts/generate-data-quality-report.mjs taco_places       # All tacos
```

**Reports**:
- Total records and address coverage
- Missing state codes
- Potential duplicates (same name, <1km apart)
- Likely chains (same name, >10km apart - different locations)
- Status distribution (visited/unvisited/golden)

**Results** (at time of analysis):

| Metric | Pizza | Taco |
|--------|-------|------|
| Total records | 37,201 | 33,218 |
| Missing address | 29% | 29.4% |
| Duplicate groups | 61 | 64 |

### 4. Duplicate Cleanup

Identified and cleaned up exact duplicates:
- Same address, 0-10m apart
- OSM imports with just state code as address vs manually corrected entries

**Example cleanup SQL**:
```sql
-- Pizza exact duplicates
DELETE FROM pizza_places WHERE id IN (
  35218, 35231, 35236, 35241,  -- Modena Pizza dupes
  1160,   -- Belle Isle Pizza
  4382,   -- Growler's Pizza Grill
  4445,   -- Toll Station Pizza & Grill
  280,    -- Buscemi's Pizza (OSM dupe)
  308,    -- Hello Faz Pizza (OSM dupe)
  304     -- Mary Sacco's Pizza (OSM dupe)
);

-- Taco exact duplicates
DELETE FROM taco_places WHERE id IN (
  6691, 4119,  -- Mi Grullense Taco Truck
  2941,        -- El Bohemio
  3017,        -- El Rincon Mexicano
  8440,        -- Zendejas Mexican Grill
  7798,        -- Los Toros Mexican Restaurant
  9690,        -- Madre Cocina Y Lounge
  10233        -- Musso's Restaurant
);
```

### 5. Missing State Code Fix

**Created**: `scripts/fix-missing-state-codes.mjs`

**Usage**:
```bash
node scripts/fix-missing-state-codes.mjs taco_places --dry-run
node scripts/fix-missing-state-codes.mjs taco_places
```

**How it works**:
1. Fetches entries with null state
2. Tries to extract state from address string (fast)
3. Falls back to reverse geocoding via Nominatim API
4. Updates database with found state codes

**Results**: Fixed 50/51 missing state codes in taco_places. The 1 remaining entry was intentionally international (El Rey De Los Tacos in Madrid, Spain - a legitimate visited entry).

### 6. Chipotle/Qdoba Cleanup

Removed existing non-taco chains from database:
```sql
DELETE FROM taco_places
WHERE LOWER(name) LIKE '%chipotle%'
   OR LOWER(name) LIKE '%qdoba%'
   OR LOWER(name) LIKE '%cafe rio%'
   OR LOWER(name) LIKE '%freebirds%'
   OR LOWER(name) LIKE '%pancheros%'
   OR LOWER(name) LIKE '%moe''s%';
```

## Files Created This Session

| File | Purpose |
|------|---------|
| `scripts/lib/excluded-taco-chains.mjs` | Chain exclusion list for taco imports |
| `scripts/generate-data-quality-report.mjs` | Data quality analysis tool |
| `scripts/fix-missing-state-codes.mjs` | Reverse geocoding for missing states |

## Files Modified This Session

| File | Changes |
|------|---------|
| `scripts/import-osm-tacos.mjs` | Added chain exclusion filter |
| `src/map/PlacesLayer.js` | Added null guards for map stability |

## Known Issues / Future Work

1. ~~**React hooks violation**: The early return in PlacesLayer.js needs to be moved AFTER all hooks to comply with React rules~~ **FIXED**
2. **International entries**: Currently no state code handling for non-US entries (Spain entry left with null state)
3. **29% missing addresses**: Could be improved with Google Places API enrichment (cost/rate limit considerations)
4. **Ongoing duplicate prevention**: Could add database-level unique constraints on OSM IDs

---

# Session 5: Map Stability Fix & Pizza Metadata Enrichment (January 2026)

## Overview
Fixed the map switching error and implemented safe metadata enrichment for pizza places using verified chain matching.

## Issues Fixed

### 1. Map Switching Error (getMinZoom null)

**Problem**: Error `Cannot read properties of null (reading 'getMinZoom')` when switching between pizza and taco maps.

**Root Cause**: MarkerClusterGroup was trying to access the map during the transition period when switching themes. The previous fix used a computed `isMapReady` value, but async operations could still occur after the check passed.

**Solution**: Implemented state-based approach with delayed rendering in `PlacesLayer.js`:
- Added `isMapStable` state (instead of computed value)
- Added `isMountedRef` to track component mount status
- Used `requestAnimationFrame` to delay setting `isMapStable` to true
- Cleanup function sets `isMapStable` to false when map changes, unmounting MarkerClusterGroup before map destruction

### 2. Pizza Metadata Enrichment

**Problem**: 37,000+ pizza places had no style or price metadata.

**Approach**: Two-tier confidence system
- **Chain matches** (high confidence): Exact name matching against known chains
- **Keyword matches** (medium confidence): Name/address keyword detection - requires manual review

**Safety measures implemented**:
- Added `--chains-only` flag to only commit verified chain matches
- Separated chain matches from keyword matches in export
- Used `update` instead of `upsert` to only modify existing records
- Removed hardcoded API keys, now requires env variables

## Script Improvements

### `scripts/populate-pizza-metadata.mjs`
- Added `--chains-only` flag for safe, high-confidence-only commits
- Changed from `upsert` to `update` (prevents NOT NULL constraint errors)
- Now uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS
- Exports separate chain vs keyword matches for review

### `scripts/lib/style-inference.mjs`
- Added null check in `normalizeName()` function
- Fixed Sbarro classification: Traditional → New York

## Metadata Commit Results

**12,821 chain matches committed** (0 errors):

| Style | Count |
|-------|-------|
| Traditional | 12,456 |
| New York | 769 |
| Neapolitan | 475 |
| Chicago | 407 |
| Detroit | 146 |
| Tavern | 77 |
| Roman | 31 |
| Sicilian | 23 |

| Price | Count |
|-------|-------|
| $ | 5,974 |
| $$ | 5,888 |
| $$$ | 51 |

**Chains tagged** (sample):
- Domino's (3,445), Pizza Hut (2,899), Little Caesars (1,745), Papa John's (1,355)
- Jet's (86), Via 313 (11), Buddy's (3) - Detroit style
- Sbarro (130), various NY-style shops - New York style
- Giordano's (7), Lou Malnati's (7), Uno (37) - Chicago style

## Files Modified

| File | Changes |
|------|---------|
| `src/map/PlacesLayer.js` | State-based map stability check with RAF delay |
| `scripts/populate-pizza-metadata.mjs` | Added --chains-only, fixed RLS/upsert issues |
| `scripts/lib/style-inference.mjs` | Null check fix, Sbarro → New York |

## Pending Review

**1,563 keyword matches** saved to `scripts/pizza-metadata-review.json`:
- 1,077 name-based keywords (mixed confidence - needs review)
- 486 address-based keywords (likely false positives - skip)

Examples needing review:
- "Wood Fired" → Neapolitan (likely correct)
- "Detroit Pizza Factory" → Detroit (likely correct)
- "Tavern" in name → Tavern style (questionable)
- Places in Detroit, MI → Detroit style (false positive from address)

## Usage

```bash
# Check current stats
node scripts/populate-pizza-metadata.mjs --stats

# Export for review (chains vs keywords separated)
node scripts/populate-pizza-metadata.mjs --phase=1 --export

# Commit only verified chains
node scripts/populate-pizza-metadata.mjs --phase=1 --chains-only --commit

# Commit all matches (after reviewing keywords)
node scripts/populate-pizza-metadata.mjs --phase=1 --commit
```
