#!/usr/bin/env node

import pg from 'pg';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, values) => {
  if (value.startsWith('--')) out.push([value.slice(2), values[index + 1]]);
  return out;
}, []));
const output = args.output;
const limit = Math.min(Number(args.limit || 50), 100);
if (!output) throw new Error('Usage: export-wikidata-source.mjs --output file [--limit n]');

const client = new pg.Client({ host: 'localhost', database: 'pizza_enrichment', user: process.env.PGUSER || process.env.USER });
await client.connect();
const { rows: places } = await client.query(`
  SELECT DISTINCT ON (qid) qid, id, name, lat, lng
  FROM (
    SELECT id, name, lat, lng, NULLIF(regexp_replace(COALESCE(brand_wikidata, ''), '^https?://www\\.wikidata\\.org/entity/', ''), '') qid FROM pizza_places
    UNION ALL
    SELECT id, name, lat, lng, NULLIF(regexp_replace(COALESCE(operator_wikidata, ''), '^https?://www\\.wikidata\\.org/entity/', ''), '') qid FROM pizza_places
  ) candidates
  WHERE qid ~ '^Q[0-9]+$'
  ORDER BY qid, id
  LIMIT $1
`, [limit]);
await client.end();
if (!places.length) { writeFileSync(output, '[]\n'); console.log(JSON.stringify({ source: 'wikidata', rows: 0, output })); process.exit(0); }

const ids = places.map(row => row.qid).join('|');
const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=claims|labels|sitelinks&languages=en&format=json`;
const response = await fetch(url, { headers: { 'user-agent': 'APizzaMichigan/1.0 source-pipeline' } });
if (!response.ok) throw new Error(`Wikidata failed: ${response.status}`);
const payload = await response.json();
const byQid = new Map(places.map(row => [row.qid, row]));
const rows = Object.entries(payload.entities || {}).map(([qid, entity]) => {
  const place = byQid.get(qid);
  const claims = entity.claims || {};
  const website = claims.P856?.[0]?.mainsnak?.datavalue?.value || null;
  const label = entity.labels?.en?.value || place?.name || qid;
  return { item: qid, name: label, lat: place.lat, lng: place.lng, official_website: website, category: 'known pizza place', source_url: `https://www.wikidata.org/wiki/${qid}` };
});
writeFileSync(output, `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify({ source: 'wikidata', rows: rows.length, output }));
