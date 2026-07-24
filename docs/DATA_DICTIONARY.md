# Data Dictionary

Reference for all enumerated values and field definitions used in the APizzaMichigan database.

The machine-readable canonical contract is
[`config/canonical-contract.json`](../config/canonical-contract.json). Verify
that contract, the sync boundary, and source-promotion policy agree with:

```bash
node scripts/ops/verify-canonical-contract.mjs
```

The contract deliberately classifies fields as identity, source factual,
inferred, editorial, or operational. Source adapters may add evidence without
silently changing identity or editorial fields.

---

## Pizza Styles

Values stored in `pizza_places.style`. This is a single primary style, not a
complete description of every format or topping. `style_confidence` records
whether the classification was explicitly supported or inferred.

| Style | Description |
|-------|-------------|
| New York | Large, foldable slices with thin crust |
| New Haven / Connecticut | Thin, charred apizza associated with New Haven and Connecticut |
| Chicago Deep Dish | Deep dish or stuffed pizza |
| Chicago Tavern | Thin, crisp Chicago tavern-style pizza |
| Detroit | Thick, rectangular with caramelized cheese edges |
| Sicilian | Thick, rectangular with fluffy dough |
| Grandma | Thin, rectangular East Coast pizza with a crisp base |
| Neapolitan | Traditional Italian style, wood-fired, soft center |
| Roman | Thin and crispy throughout, often sold by weight |
| California | Innovative toppings, often gourmet/artisanal |
| St. Louis | Thin, crisp, unleavened-style pizza commonly cut into squares |
| Tavern | Thin, crispy pizza cut into squares when the regional identity is unclear |
| Standard Round | Conventional round pizza with no stronger style evidence |
| Other | A known style that does not yet have its own category |
| Unknown | Not enough evidence to assign a primary style |

The production classifier and UI currently accept only the controlled
primary-style vocabulary above. Breakfast, frozen, white pizza, tomato pie,
slice, pan, square, and similar descriptors are intentionally not primary
styles; they are future format or category attributes. Legacy values are
handled by an explicit migration map: `Traditional` becomes `Standard Round`,
and generic `Chicago` becomes `Chicago Deep Dish`.

---

## Taco Protein Types

Values stored in `taco_places.style` (comma-separated when multiple):

| Type | Description |
|------|-------------|
| Al Pastor | Marinated pork, vertical spit roasted |
| Carne Asada | Grilled beef, typically skirt or flank steak |
| Carnitas | Slow-cooked, shredded pork |
| Chorizo | Spiced Mexican sausage |
| Pollo | Chicken (Spanish term) |
| Barbacoa | Slow-cooked beef cheeks or head |
| Birria | Stewed meat (beef/goat) with dried chilies |
| Lengua | Beef tongue |
| Fish | Battered or grilled fish (pescado) |
| Shrimp | Shrimp tacos (camarones) |
| Ground Beef | American-style seasoned ground beef |
| Cabeza | Beef head meat |
| Veggie | Vegetarian options |

**Example multi-value:** `"Birria, Carne Asada, Al Pastor"`

---

## Price Tiers

Values stored in `price_range` for enriched rows. Older/imported rows may still
have values in `price`; new enrichment should prefer `price_range`.

| Value | Description |
|-------|-------------|
| $ | Budget-friendly, typically fast food or quick service |
| $$ | Mid-range, casual dining |
| $$$ | Higher-end, sit-down restaurants |
| $$$$ | Premium or luxury dining |

---

## Status Values

Values stored in `status` column for both tables:

`status` is the personal map status: `visited`, `unvisited`, or `golden`.
Business lifecycle is separate and optional:

- `lifecycle_status`: explicit `closed`, `replaced`, or `demolished` state.
- `lifecycle_replaced_by_id`: canonical ID of the successor business when the
  lifecycle is `replaced`.
- A null lifecycle status means “not explicitly classified,” not “confirmed
  open.” Source adapters cannot set these fields.

| Value | Description |
|-------|-------------|
| unvisited | Not yet visited by the user (default) |
| visited | Has been visited |
| golden | Exceptional, highly recommended |

---

## Region Codes

The `state` column is a legacy region field. For US rows it normally uses
standard 2-letter state codes, but the table also contains international rows
where the value is a source-provided region, province, department, or other
administrative abbreviation. It must not be interpreted as a US state without
an explicit product scope or source-country rule.

There is not currently a canonical `country` column in the production place
tables. The public app may derive a display country from known region
groupings, but that derived value is not stored place data. A future country
field should be introduced through a coordinated schema, sync, source, and
public-filter migration; source adapters must not assume it exists today.

Examples of valid non-US values currently present include `TIR` (Italy), `ALY`
(Turkey), and `KAH` (Finland). New source adapters should preserve the source
region in `state`, avoid inventing a US-style abbreviation, and preserve the
source region until a country-aware schema is formally added. Geographic
filters should use an explicit scoped region key rather than treating every
`state` value as a US state code.

Common US state codes:

| Code | State | Code | State |
|------|-------|------|-------|
| AL | Alabama | MT | Montana |
| AK | Alaska | NE | Nebraska |
| AZ | Arizona | NV | Nevada |
| AR | Arkansas | NH | New Hampshire |
| CA | California | NJ | New Jersey |
| CO | Colorado | NM | New Mexico |
| CT | Connecticut | NY | New York |
| DE | Delaware | NC | North Carolina |
| FL | Florida | ND | North Dakota |
| GA | Georgia | OH | Ohio |
| HI | Hawaii | OK | Oklahoma |
| ID | Idaho | OR | Oregon |
| IL | Illinois | PA | Pennsylvania |
| IN | Indiana | RI | Rhode Island |
| IA | Iowa | SC | South Carolina |
| KS | Kansas | SD | South Dakota |
| KY | Kentucky | TN | Tennessee |
| LA | Louisiana | TX | Texas |
| ME | Maine | UT | Utah |
| MD | Maryland | VT | Vermont |
| MA | Massachusetts | VA | Virginia |
| MI | Michigan | WA | Washington |
| MN | Minnesota | WV | West Virginia |
| MS | Mississippi | WI | Wisconsin |
| MO | Missouri | WY | Wyoming |

Plus: DC (District of Columbia), PR (Puerto Rico)

---

## Chain Mappings

### Pizza Chains (sample)

| Chain | Style | Price |
|-------|-------|-------|
| Domino's | Standard Round | $ |
| Pizza Hut | Standard Round | $ |
| Little Caesars | Standard Round | $ |
| Papa John's | Standard Round | $ |
| B.C. Pizza | Standard Round | $$ |
| Fox's Pizza | Standard Round | $$ |
| Pizza Ranch | Standard Round | $$ |
| Simple Simon's Pizza | Standard Round | $$ |
| Sal's Pizza | Standard Round | $$ |
| Jet's Pizza | Detroit | $$ |
| Buddy's Pizza | Detroit | $$ |
| Lou Malnati's | Chicago Deep Dish | $$ |
| Giordano's | Chicago Deep Dish | $$ |
| Joe's Pizza | New York | $$ |
| &pizza | Standard Round | $$ |

### Taco Chains (sample)

| Chain | Types | Price |
|-------|-------|-------|
| Taco Bell | Ground Beef, Chicken | $ |
| Del Taco | Ground Beef, Chicken, Carne Asada | $ |
| Chipotle | Carne Asada, Carnitas, Chicken | $$ |
| Qdoba | Carne Asada, Carnitas, Chicken | $$ |
| Taco Cabana | Chicken, Carne Asada, Carnitas | $ |
| El Pollo Loco | Chicken, Pollo | $ |

---

## Address Format

Addresses are stored as a single text string in the format:

```
[Street Number] [Street Name], [City], [State], [ZIP]
```

Examples:
- `123 Main Street, Detroit, MI, 48201`
- `456 Oak Avenue, Austin, TX, 78701`

Some addresses may be incomplete (missing street number or ZIP).

---

## External Place ID

The current `google_place_id` column is a legacy external identifier field.
Despite the name, many imported rows store OpenStreetMap identifiers in this
format:

```text
osm:node/12345
osm:way/12345
osm:relation/12345
```

For rows with a real Google Place ID, the field may contain the Google ID.
Do not assume every `google_place_id` value is valid for a Google Maps
`place_id:` URL.

This field currently supports:
- Deduplication during imports
- Linking back to OSM/other external systems for updates
- Identifying data provenance

Long term, split this into explicit source identity fields or an external IDs
table, for example `source_system`, `source_id`, `verified_at`, and
`source_url`.
