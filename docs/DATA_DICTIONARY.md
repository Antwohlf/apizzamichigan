# Data Dictionary

Reference for all enumerated values and field definitions used in the APizzaMichigan database.

---

## Pizza Styles

Values stored in `pizza_places.style`:

| Style | Description |
|-------|-------------|
| Traditional | Classic American pizza, no specific regional style |
| New York | Large, foldable slices with thin crust |
| Chicago | Deep dish or stuffed pizza |
| Tavern | Thin, crispy crust cut into squares (Midwest style) |
| Detroit | Thick, rectangular with caramelized cheese edges |
| Neapolitan | Traditional Italian style, wood-fired, soft center |
| Sicilian | Thick, rectangular with fluffy dough |
| Roman | Thin and crispy throughout, often sold by weight |
| California | Innovative toppings, often gourmet/artisanal |

**Additional styles recognized by inference scripts but not yet in UI:**
- Greek, St. Louis, New Haven, Coal-Fired, Wood-Fired, Grandma, Bar

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

---

## Status Values

Values stored in `status` column for both tables:

| Value | Description |
|-------|-------------|
| unvisited | Not yet visited by the user (default) |
| visited | Has been visited |
| golden | Exceptional, highly recommended |

---

## State Codes

The `state` column uses standard 2-letter US state codes:

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
| Domino's | Traditional | $ |
| Pizza Hut | Traditional | $ |
| Little Caesars | Traditional | $ |
| Papa John's | Traditional | $ |
| B.C. Pizza | Traditional | $$ |
| Fox's Pizza | Traditional | $$ |
| Pizza Ranch | Traditional | $$ |
| Jet's Pizza | Detroit | $$ |
| Buddy's Pizza | Detroit | $$ |
| Lou Malnati's | Chicago | $$ |
| Giordano's | Chicago | $$ |
| Joe's Pizza | New York | $$ |
| &pizza | Neapolitan | $$ |

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
