#!/usr/bin/env node
/**
 * Export ambiguous and likely-new source review artifacts to CSV.
 *
 * The CSV includes empty decision columns so an operator can review rows in a
 * spreadsheet before any future import/admin workflow consumes the decisions.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const REVIEW_KINDS = new Set(['all', 'ambiguous', 'likely_new']);

function parseArgs(argv) {
  const args = {
    inputDir: 'reports/source-review',
    output: null,
    kind: 'all',
    source: null,
    reportFile: null,
    state: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input-dir') args.inputDir = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--kind') args.kind = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--report-file') args.reportFile = argv[++i];
    else if (arg === '--state') args.state = String(argv[++i] || '').trim().toUpperCase();
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!REVIEW_KINDS.has(args.kind)) throw new Error(`Invalid --kind: ${args.kind}`);
  if (!args.output) {
    args.output = `reports/source-review-${args.kind.replace('_', '-')}.csv`;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/source-review-export.mjs [options]

Options:
  --input-dir <dir>          Directory with *-review.json files
                             (default reports/source-review)
  --output <file>            CSV output path
                             (default reports/source-review-<kind>.csv)
  --kind <all|ambiguous|likely_new>
                             Review rows to export (default all)
  --source <key>             Limit to one source key
  --report-file <file>       Limit to one chain/report artifact
  --state <code>             Limit to source_data.region/state code

Decision columns are intentionally blank: decision, canonical_place_id,
reviewer_notes.
`);
}

function csvCell(value) {
  const text = value == null ? '' : String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function sourceField(item, key) {
  return item?.source_data?.[key] ?? '';
}

function rowFromItem({ report, file, kind, item }) {
  return {
    decision: '',
    canonical_place_id: '',
    reviewer_notes: '',
    review_kind: kind,
    report_file: file,
    source: report.source,
    source_label: report.source_label,
    entity: report.entity,
    source_id: item.source_id,
    source_name: item.source_name,
    source_category: sourceField(item, 'category'),
    source_address: sourceField(item, 'address'),
    source_website: sourceField(item, 'website'),
    source_phone: sourceField(item, 'phone'),
    source_url: item.source_url,
    nearest_place_id: item.nearest_place?.id ?? '',
    nearest_place_name: item.nearest_place?.name ?? '',
    nearest_google_place_id: item.nearest_place?.google_place_id ?? '',
    distance_m: item.nearest_place?.distance_m ?? '',
    name_score: item.nearest_place?.name_score ?? '',
    review_reason: item.nearest_place?.review_reason ?? '',
  };
}

function readRows(inputDir, args) {
  const { kind, source, reportFile, state } = args;
  const absDir = resolve(process.cwd(), inputDir);
  if (!existsSync(absDir)) return [];

  const rows = [];
  for (const file of readdirSync(absDir).filter(name => name.endsWith('-review.json')).sort()) {
    if (reportFile && file !== reportFile) continue;
    const report = JSON.parse(readFileSync(join(absDir, file), 'utf8'));
    if (source && report.source !== source) continue;
    if (kind === 'all' || kind === 'ambiguous') {
      for (const item of report.ambiguous || []) {
        const row = rowFromItem({ report, file, kind: 'ambiguous', item });
        if (!state || String(sourceField(item, 'region') || sourceField(item, 'state')).toUpperCase() === state) rows.push(row);
      }
    }
    if (kind === 'all' || kind === 'likely_new') {
      for (const item of report.likely_new || []) {
        const row = rowFromItem({ report, file, kind: 'likely_new', item });
        if (!state || String(sourceField(item, 'region') || sourceField(item, 'state')).toUpperCase() === state) rows.push(row);
      }
    }
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv);
  const rows = readRows(args.inputDir, args);
  const headers = [
    'decision',
    'canonical_place_id',
    'reviewer_notes',
    'review_kind',
    'report_file',
    'source',
    'source_label',
    'entity',
    'source_id',
    'source_name',
    'source_category',
    'source_address',
    'source_website',
    'source_phone',
    'source_url',
    'nearest_place_id',
    'nearest_place_name',
    'nearest_google_place_id',
    'distance_m',
    'name_score',
    'review_reason',
  ];
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(',')),
  ].join('\n');

  const outputPath = resolve(process.cwd(), args.output);
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, `${csv}\n`);
  console.log(`Wrote ${rows.length} review rows to ${args.output}`);
}

main();
