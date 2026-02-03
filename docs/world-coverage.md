# World Coverage Status

Current status of pizza and taco data imports by country.

**Legend:**
- ✅ Covered (region-by-region script with detailed data)
- 🌐 Global (country-level search via global scripts)
- 🔄 In Progress (currently importing)
- ❌ Not Covered (no script/regions defined)
- ⚠️ Partial (some regions only)

---

## North America

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇺🇸 United States | ✅ | ✅ | `import-osm-pizza.mjs`, `import-osm-tacos.mjs` | All 50 states supported |
| 🇨🇦 Canada | ✅ | ✅ | `import-international.mjs` | 13 provinces/territories |
| 🇲🇽 Mexico | ✅ | ✅ | `import-international.mjs` | 32 states |
| 🇬🇹 Guatemala | ✅ | ✅ | `import-latin-america.mjs` | 22 departments |
| 🇧🇿 Belize | ✅ | ✅ | `import-latin-america.mjs` | 6 districts |
| 🇭🇳 Honduras | ✅ | ✅ | `import-latin-america.mjs` | 18 departments |
| 🇸🇻 El Salvador | ✅ | ✅ | `import-latin-america.mjs` | 14 departments |
| 🇳🇮 Nicaragua | ✅ | ✅ | `import-latin-america.mjs` | 17 departments |
| 🇨🇷 Costa Rica | ✅ | ✅ | `import-latin-america.mjs` | 7 provinces |
| 🇵🇦 Panama | ✅ | ✅ | `import-latin-america.mjs` | 13 provinces |

## Caribbean

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇨🇺 Cuba | ❌ | ❌ | - | |
| 🇯🇲 Jamaica | ❌ | ❌ | - | |
| 🇭🇹 Haiti | ❌ | ❌ | - | |
| 🇩🇴 Dominican Republic | ❌ | ❌ | - | |
| 🇵🇷 Puerto Rico | ❌ | ❌ | - | US territory, could add to US script |
| 🇹🇹 Trinidad and Tobago | ❌ | ❌ | - | |
| 🇧🇸 Bahamas | ❌ | ❌ | - | |
| 🇧🇧 Barbados | ❌ | ❌ | - | |

## South America

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇧🇷 Brazil | ✅ | ✅ | `import-latin-america.mjs` | 27 states (Wave 1) |
| 🇦🇷 Argentina | ✅ | ✅ | `import-latin-america.mjs` | 24 provinces (Wave 1) |
| 🇨🇴 Colombia | ✅ | ✅ | `import-latin-america.mjs` | 33 departments (Wave 1) |
| 🇨🇱 Chile | ✅ | ✅ | `import-latin-america.mjs` | 16 regions (Wave 1) |
| 🇵🇪 Peru | ✅ | ✅ | `import-latin-america.mjs` | 25 departments (Wave 2) |
| 🇻🇪 Venezuela | ✅ | ✅ | `import-latin-america.mjs` | 25 states (Wave 2) |
| 🇪🇨 Ecuador | ✅ | ✅ | `import-latin-america.mjs` | 24 provinces (Wave 2) |
| 🇧🇴 Bolivia | ✅ | ✅ | `import-latin-america.mjs` | 9 departments (Wave 3) |
| 🇵🇾 Paraguay | ✅ | ✅ | `import-latin-america.mjs` | 18 departments (Wave 3) |
| 🇺🇾 Uruguay | ✅ | ✅ | `import-latin-america.mjs` | 19 departments (Wave 3) |
| 🇬🇾 Guyana | ✅ | ✅ | `import-latin-america.mjs` | 10 regions (Wave 3) |
| 🇸🇷 Suriname | ✅ | ✅ | `import-latin-america.mjs` | 10 districts (Wave 3) |

## Western Europe

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇮🇹 Italy | ✅ 18,213 | ✅ | `import-europe.mjs` | 21 regions |
| 🇩🇪 Germany | ✅ 14,892 | ✅ | `import-europe.mjs` | 16 states |
| 🇫🇷 France | ✅ 14,286 | ✅ | `import-europe.mjs` | 13 regions |
| 🇪🇸 Spain | ✅ 4,529 | ✅ | `import-europe.mjs` | 17 autonomous communities |
| 🇬🇧 United Kingdom | ✅ 7,891 | ✅ | `import-europe.mjs` | 4 countries (England, Scotland, Wales, NI) |
| 🇳🇱 Netherlands | ✅ 1,582 | ✅ | `import-europe.mjs` | 12 provinces |
| 🇧🇪 Belgium | ✅ 983 | ✅ | `import-europe.mjs` | 3 regions |
| 🇦🇹 Austria | ✅ 2,259 | ✅ | `import-europe.mjs` | 9 states |
| 🇨🇭 Switzerland | ✅ 1,848 | ✅ | `import-europe.mjs` | 26 cantons |
| 🇵🇹 Portugal | ✅ 1,039 | ✅ | `import-europe.mjs` | 20 districts |
| 🇮🇪 Ireland | ✅ 1,027 | ✅ | `import-europe.mjs` | 4 provinces |
| 🇱🇺 Luxembourg | ❌ | ❌ | - | Small country |
| 🇲🇨 Monaco | ❌ | ❌ | - | City-state |
| 🇦🇩 Andorra | ❌ | ❌ | - | Small country |
| 🇱🇮 Liechtenstein | ❌ | ❌ | - | Small country |
| 🇸🇲 San Marino | ❌ | ❌ | - | Microstate |
| 🇻🇦 Vatican City | ❌ | ❌ | - | Microstate |
| 🇲🇹 Malta | ❌ | ❌ | - | Small island nation |

## Northern Europe

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇸🇪 Sweden | ✅ 2,719 | ✅ | `import-europe.mjs` | 21 counties |
| 🇳🇴 Norway | ✅ 529 | ✅ | `import-europe.mjs` | 11 counties |
| 🇩🇰 Denmark | ✅ 1,913 | ✅ | `import-europe.mjs` | 5 regions |
| 🇫🇮 Finland | ✅ 1,521 | ✅ | `import-europe.mjs` | 19 regions |
| 🇮🇸 Iceland | ❌ | ❌ | - | Small population |
| 🇪🇪 Estonia | ✅ 159 | ✅ 7 | `import-europe.mjs` | 15 counties |
| 🇱🇻 Latvia | ✅ 148 | ✅ 2 | `import-europe.mjs` | 20 regions |
| 🇱🇹 Lithuania | ✅ 320 | ✅ 18 | `import-europe.mjs` | 10 counties |

## Central Europe

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇵🇱 Poland | ✅ 4,665 | ✅ | `import-europe.mjs` | 16 voivodeships |
| 🇨🇿 Czech Republic | ✅ 1,172 | ✅ | `import-europe.mjs` | 14 regions |
| 🇭🇺 Hungary | ✅ 981 | ✅ | `import-europe.mjs` | 20 counties |
| 🇸🇰 Slovakia | ✅ 936 | ✅ 21 | `import-europe.mjs` | 8 regions |
| 🇸🇮 Slovenia | ❌ | ❌ | - | |

## Southeastern Europe

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇬🇷 Greece | ✅ 873 | ✅ | `import-europe.mjs` | 13 regions |
| 🇭🇷 Croatia | ✅ 768 | ✅ 24 | `import-europe.mjs` | 21 counties |
| 🇷🇴 Romania | ✅ 1,013 | ✅ | `import-europe.mjs` | 42 counties |
| 🇧🇬 Bulgaria | ✅ 440 | ✅ 14 | `import-europe.mjs` | 28 provinces (Cyrillic) |
| 🇷🇸 Serbia | ❌ | ❌ | - | |
| 🇧🇦 Bosnia and Herzegovina | ❌ | ❌ | - | |
| 🇲🇪 Montenegro | ❌ | ❌ | - | |
| 🇲🇰 North Macedonia | ❌ | ❌ | - | |
| 🇦🇱 Albania | ❌ | ❌ | - | |
| 🇽🇰 Kosovo | ❌ | ❌ | - | |
| 🇨🇾 Cyprus | ❌ | ❌ | - | |

## Eastern Europe

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇺🇦 Ukraine | 🌐 | ❌ | Global scripts | Name search |
| 🇧🇾 Belarus | ❌ | ❌ | - | |
| 🇲🇩 Moldova | ❌ | ❌ | - | |
| 🇷🇺 Russia | ⚠️ | ❌ | Global scripts | Searched but ~0 results (Cyrillic/local platforms) |

## Middle East

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇹🇷 Turkey | 🌐 | ❌ | Global scripts | Name search |
| 🇮🇱 Israel | 🌐 | ❌ | Global scripts | Name search |
| 🇱🇧 Lebanon | ❌ | ❌ | - | |
| 🇯🇴 Jordan | ❌ | ❌ | - | |
| 🇸🇦 Saudi Arabia | 🌐 | ❌ | Global scripts | Name + chains |
| 🇦🇪 United Arab Emirates | 🌐 | ❌ | Global scripts | Name + chains |
| 🇶🇦 Qatar | ❌ | ❌ | - | |
| 🇰🇼 Kuwait | ❌ | ❌ | - | |
| 🇧🇭 Bahrain | ❌ | ❌ | - | |
| 🇴🇲 Oman | ❌ | ❌ | - | |
| 🇾🇪 Yemen | ❌ | ❌ | - | |
| 🇮🇶 Iraq | ❌ | ❌ | - | |
| 🇸🇾 Syria | ❌ | ❌ | - | |
| 🇮🇷 Iran | ❌ | ❌ | - | |

## Central Asia

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇰🇿 Kazakhstan | ❌ | ❌ | - | |
| 🇺🇿 Uzbekistan | ❌ | ❌ | - | |
| 🇹🇲 Turkmenistan | ❌ | ❌ | - | |
| 🇹🇯 Tajikistan | ❌ | ❌ | - | |
| 🇰🇬 Kyrgyzstan | ❌ | ❌ | - | |
| 🇦🇫 Afghanistan | ❌ | ❌ | - | |

## South Asia

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇮🇳 India | 🌐 ~1,000 | ⚠️ | Global scripts | Name + chains + street food |
| 🇵🇰 Pakistan | ❌ | ❌ | - | |
| 🇧🇩 Bangladesh | ❌ | ❌ | - | |
| 🇱🇰 Sri Lanka | ❌ | ❌ | - | |
| 🇳🇵 Nepal | ❌ | ❌ | - | |
| 🇧🇹 Bhutan | ❌ | ❌ | - | |
| 🇲🇻 Maldives | ❌ | ❌ | - | |

## East Asia

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇨🇳 China | ⚠️ | ❌ | Global scripts | Searched but ~0 results (local platforms) |
| 🇯🇵 Japan | 🌐 ~1,230 | ⚠️ | Global scripts | Name + chains + cuisines |
| 🇰🇷 South Korea | 🌐 | 🌐 | Global scripts | Name + chains + cuisines |
| 🇰🇵 North Korea | ❌ | ❌ | - | Limited OSM data |
| 🇲🇳 Mongolia | ❌ | ❌ | - | |
| 🇹🇼 Taiwan | ❌ | ❌ | - | |
| 🇭🇰 Hong Kong | ❌ | ❌ | - | SAR |
| 🇲🇴 Macau | ❌ | ❌ | - | SAR |

## Southeast Asia

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇹🇭 Thailand | 🌐 | 🌐 | Global scripts | Name + cuisines + street food |
| 🇻🇳 Vietnam | 🌐 | 🌐 | Global scripts | Name + street food |
| 🇮🇩 Indonesia | 🌐 | 🌐 | Global scripts | Name + chains + street food |
| 🇵🇭 Philippines | 🌐 | ⚠️ | Global scripts | Name + chains + street food |
| 🇲🇾 Malaysia | 🌐 | ❌ | Global scripts | Name search |
| 🇸🇬 Singapore | 🌐 | ⚠️ | Global scripts | Cuisines search |
| 🇲🇲 Myanmar | ❌ | ❌ | - | |
| 🇰🇭 Cambodia | ❌ | ❌ | - | |
| 🇱🇦 Laos | ❌ | ❌ | - | |
| 🇧🇳 Brunei | ❌ | ❌ | - | |
| 🇹🇱 Timor-Leste | ❌ | ❌ | - | |

## Oceania

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇦🇺 Australia | 🌐 | ⚠️ | Global scripts | Name + chains + cuisines |
| 🇳🇿 New Zealand | 🌐 | ❌ | Global scripts | Name search |
| 🇵🇬 Papua New Guinea | ❌ | ❌ | - | |
| 🇫🇯 Fiji | ❌ | ❌ | - | |
| 🇳🇨 New Caledonia | ❌ | ❌ | - | French territory |
| 🇵🇫 French Polynesia | ❌ | ❌ | - | French territory |
| 🇬🇺 Guam | ❌ | ❌ | - | US territory |

## Africa

| Country | Pizza | Tacos | Script | Notes |
|---------|-------|-------|--------|-------|
| 🇿🇦 South Africa | 🌐 | ❌ | Global scripts | Name + chains |
| 🇪🇬 Egypt | 🌐 | ❌ | Global scripts | Name search |
| 🇳🇬 Nigeria | 🌐 | ❌ | Global scripts | Name search |
| 🇰🇪 Kenya | 🌐 | ❌ | Global scripts | Name search |
| 🇲🇦 Morocco | 🌐 | ❌ | Global scripts | Name search |
| 🇩🇿 Algeria | ❌ | ❌ | - | |
| 🇹🇳 Tunisia | ❌ | ❌ | - | |
| 🇱🇾 Libya | ❌ | ❌ | - | |
| 🇪🇹 Ethiopia | ❌ | ❌ | - | |
| 🇬🇭 Ghana | ❌ | ❌ | - | |
| 🇹🇿 Tanzania | ❌ | ❌ | - | |
| 🇺🇬 Uganda | ❌ | ❌ | - | |
| 🇷🇼 Rwanda | ❌ | ❌ | - | |
| 🇸🇳 Senegal | ❌ | ❌ | - | |
| 🇨🇮 Côte d'Ivoire | ❌ | ❌ | - | |
| 🇨🇲 Cameroon | ❌ | ❌ | - | |
| 🇦🇴 Angola | ❌ | ❌ | - | |
| 🇿🇼 Zimbabwe | ❌ | ❌ | - | |
| 🇧🇼 Botswana | ❌ | ❌ | - | |
| 🇳🇦 Namibia | ❌ | ❌ | - | |
| 🇲🇺 Mauritius | ❌ | ❌ | - | |
| 🇲🇬 Madagascar | ❌ | ❌ | - | |

---

## Summary Statistics

**Dashboard totals (Feb 2026):**
- **164,604 pizza places** across 55 detected countries
- **52,141 taco places** across 48 detected countries

| Status | Pizza | Tacos |
|--------|-------|-------|
| ✅ Correctly detected | 55 countries | 48 countries |
| ⚠️ Data exists but miscounted | 9 countries | 9 countries |
| ❌ Not Covered | ~130 countries | ~140 countries |

**Note:** ~4,872 places from 9 countries (Thailand, China, Singapore, Turkey, Philippines, Saudi Arabia, South Africa, India, Indonesia) exist in the database but are miscounted due to state code conflicts. See "State Code Conflicts" section below.

### Currently Covered Countries (55 detected)

**North America (3):**
- United States (50 states)
- Canada (13 provinces/territories)
- Mexico (32 states)

**Central America (7):**
- Guatemala (22 departments)
- Honduras (18 departments)
- El Salvador (14 departments)
- Nicaragua (17 departments)
- Costa Rica (7 provinces)
- Panama (13 provinces)
- Belize (6 districts)

**South America (12):**
- Brazil (27 states)
- Argentina (24 provinces)
- Colombia (33 departments)
- Chile (16 regions)
- Peru (25 departments)
- Venezuela (25 states)
- Ecuador (24 provinces)
- Bolivia (9 departments)
- Paraguay (18 departments)
- Uruguay (19 departments)
- Guyana (10 regions)
- Suriname (10 districts)

**Europe (26 countries):**
- Italy, Germany, France, Spain, United Kingdom
- Netherlands, Belgium, Austria, Switzerland
- Poland, Portugal, Czech Republic
- Sweden, Norway, Denmark, Finland
- Ireland, Greece, Hungary, Croatia, Romania
- Slovakia, Estonia, Latvia, Lithuania, Bulgaria

---

## Priority Countries for Future Expansion

### High Priority (strong pizza/taco culture, good OSM data)
1. 🇦🇺 Australia - Strong pizza culture, English OSM names
2. 🇯🇵 Japan - Unique pizza scene, good OSM coverage
3. 🇰🇷 South Korea - Growing market
4. 🇮🇳 India - Large Domino's presence, growing market
5. 🇵🇭 Philippines - Growing pizza market

### Medium Priority (decent OSM data)
- Balkans (Slovenia, Serbia, Bosnia, Montenegro)
- Turkey, Israel, UAE
- Southeast Asia (Thailand, Vietnam, Indonesia)
- South Africa

### Lower Priority (limited OSM data or small markets)
- Central Asia
- Most of Africa
- Pacific Islands
- Caribbean

---

## Technical Notes

### Adding a New Country

1. Research OSM admin boundaries for the country
2. Determine correct `admin_level` for regions/states
3. Find exact OSM names (may need native language)
4. Add region definitions to appropriate script
5. Test with `--dry-run` before importing

### Common OSM Admin Levels by Country Type

| Country Type | Typical Admin Level |
|--------------|---------------------|
| Federal states | 4 |
| Provinces | 4-6 |
| Departments | 5-6 |
| Counties | 5-6 |
| Districts | 6-8 |

### Scripts Reference

**Region-level scripts (detailed coverage):**

| Script | Purpose |
|--------|---------|
| `import-osm-pizza.mjs` | Single region pizza import |
| `import-osm-tacos.mjs` | Single region taco import |
| `import-international.mjs` | Canada + Mexico batch import |
| `import-europe.mjs` | European countries batch import |
| `import-latin-america.mjs` | Latin America batch import (19 countries, ~327 regions) |

**Global scripts (country-level search):**

| Script | Purpose | Countries |
|--------|---------|-----------|
| `import-pizzerias-by-name.mjs` | Search for "Pizza", "Pizzeria", etc. | 23 countries |
| `import-chains.mjs` | Major chains (Domino's, Pizza Hut, Taco Bell, etc.) | 20 countries |
| `import-additional-cuisines.mjs` | Specialty cuisines (neapolitan, burrito, etc.) | 25 countries |
| `import-street-food.mjs` | Food trucks, carts, kiosks | 18 countries |
| `import-retry-failed.mjs` | Retry 504 failures with chunked queries | Failed regions |

---

## Global Scripts Coverage Details

### Countries Searched by Global Scripts (Feb 2026)

**Pizzerias by name (23 countries):**
Japan, South Korea, China, India, Indonesia, Thailand, Vietnam, Philippines, Malaysia, Turkey, Saudi Arabia, UAE, Egypt, Israel, South Africa, Nigeria, Kenya, Morocco, Russia, Ukraine, Poland, Australia, New Zealand

**Chains (20 countries):**
US, Canada, Mexico, UK, Germany, France, Spain, Italy, Australia, Japan, South Korea, China, India, Brazil, Russia, South Africa, UAE, Saudi Arabia, Philippines, Indonesia

**Additional cuisines (25 countries):**
US, Canada, Mexico, Brazil, Argentina, Colombia, Peru, Chile, Italy, Germany, France, Spain, UK, Netherlands, Belgium, Austria, Switzerland, Poland, Australia, Japan, South Korea, China, India, Thailand, Singapore

**Street food (18 countries):**
Mexico, Guatemala, El Salvador, Colombia, Peru, Brazil, Argentina, US, Italy, France, Germany, UK, Spain, Thailand, Vietnam, Indonesia, Philippines, India

### Countries NOT Searched by Any Script

- **Central Asia:** Kazakhstan, Uzbekistan, Turkmenistan, Tajikistan, Kyrgyzstan
- **Most of Africa:** Only 5 countries covered (South Africa, Nigeria, Kenya, Morocco, Egypt)
- **Caribbean:** Cuba, Jamaica, Haiti, Dominican Republic, Puerto Rico, etc.
- **Balkans:** Serbia, Bosnia, Montenegro, Albania, Kosovo, North Macedonia
- **Pacific Islands:** Fiji, Papua New Guinea, etc.

### Known Data Gaps

| Issue | Countries Affected | Reason |
|-------|-------------------|--------|
| Zero results | Russia | Different character sets, local platforms |
| Repeated 504 timeouts | India, Brazil, Canada | Large countries, complex OSM data |
| No taco culture | Most of Asia, Africa, Middle East | Tacos aren't common outside Americas |

### State Code Conflicts (Dashboard Miscount Issue)

The global import scripts save places with ISO country codes as the `state` field (e.g., `TH` for Thailand).
However, these codes conflict with regional codes used by European and Latin American imports.
The dashboard's country detection prioritizes regional codes, causing global country data to be miscounted.

| Country | Code | Conflict | Data Counted As |
|---------|------|----------|-----------------|
| Thailand | TH | Thuringia (Germany) | Germany |
| China | CN | Canary Islands (Spain) | Spain |
| Singapore | SG | St. Gallen (Switzerland) | Switzerland |
| Turkey | TR | Trujillo (Venezuela) | Venezuela |
| Philippines | PH | Paraguayan dept | Paraguay |
| Saudi Arabia | SA | Multiple Latin American regions | Various |
| South Africa | ZA | Guatemalan dept | Guatemala |
| India | IN | Indiana (US) | USA |
| Indonesia | ID | Idaho (US) | USA |

**Impact:** ~4,872 places from these 9 countries are in the database but not correctly attributed.

**Future Fix:** Global scripts should use 3-letter codes (THA, CHN, SGP, etc.) to avoid conflicts.

---

*Last updated: 2026-02-03*
