# APizzaMichigan & TacoBoutMichigan

Dual-brand React app that surfaces Michigan pizza and taco recommendations on top of a shared map + directory experience. APizzaMichigan remains the default route while TacoBoutMichigan reuses the layout with distinct theming, copy, and data.

## Quick Start

```bash
npm install
npm start
```

The dev server lives at http://localhost:3000.

- `http://localhost:3000/` → APizzaMichigan (original experience)
- `http://localhost:3000/tacos` → TacoBoutMichigan (alt theme)

Each page footer includes a “Check out …” call-to-action that hops between the twins.

## Theme System

Themes live in `src/themes/` and provide palette, copy, icon, and map tile settings. Use `ThemeKeys.PIZZA` or `ThemeKeys.TACO` when wiring components. The `ThemeProvider` drops CSS variables and metadata for the active theme; new surfaces should read theme tokens instead of hard-coding pizza colors.

Key files:
- `src/themes/pizzaTheme.js`
- `src/themes/tacoTheme.js`
- `src/themes/ThemeProvider.js`

## Data Sources

Supabase tables remain unchanged for pizza (`pizza_places`, `frozen_pizzas`). Taco views look for parallel tables (`taco_places`, `frozen_tacos`). While those are provisioned, Taco routes fall back to local sample data located in `src/data/`.

Filters pull style/type options from:
- `src/data/pizzaStyles.js`
- `src/data/tacoTypes.js`
- `src/data/latinMarkets.placeholder.js` (temporary static list rendered on the Taco route while we stand up Supabase data)

## Admin Submit Portal

Authenticated submissions live at `/admin/submit`. To enable the secure flow locally:

```bash
# in one terminal
ADMIN_PORTAL_PASSWORD=your-password \
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run start:server

# in another terminal
npm start
```

The server route sets an `admin_auth` HttpOnly cookie after validating `ADMIN_PORTAL_PASSWORD`. Use the submit form to geocode addresses (Mapbox token required when `VITE_GEOCODER=mapbox`) and post to the appropriate Supabase table with the service role key. The public anon key never sees write access.

## Testing

```bash
npm test
```

The suite includes smoke coverage that ensures both routes render with the expected CTA labels and Supabase queries per brand.

## Deployment

`npm run build` continues to emit the CRA production bundle. No pizza assets or copy were altered; Taco assets and favicons live alongside them in `public/` for easy hosting.
