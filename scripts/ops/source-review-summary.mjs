#!/usr/bin/env node
/**
 * Summarize generated source review artifacts.
 *
 * This is intentionally file-based. The review JSONs are operator artifacts,
 * not production records, so they stay out of Postgres until a human decides
 * what to import or ignore.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

function parseArgs(argv) {
  const args = {
    inputDir: 'reports/source-review',
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input-dir') args.inputDir = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/source-review-summary.mjs [options]

Options:
  --input-dir <dir>  Directory containing *-review.json files
                     (default reports/source-review)
  --json             Print machine-readable JSON instead of Markdown
`);
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function readReports(inputDir) {
  const absDir = resolve(process.cwd(), inputDir);
  if (!existsSync(absDir)) return [];

  return readdirSync(absDir)
    .filter(file => file.endsWith('-review.json'))
    .sort()
    .map(file => {
      const report = JSON.parse(readFileSync(join(absDir, file), 'utf8'));
      const counts = report.counts || {};
      return {
        file,
        source: report.source,
        source_label: report.source_label,
        entity: report.entity,
        input: report.input,
        generated_at: report.generated_at,
        input_rows: counts.inputRowsInspected ?? 0,
        matched: counts.matchedExistingPlaces ?? 0,
        ambiguous: counts.ambiguousReviewCandidates ?? report.ambiguous?.length ?? 0,
        likely_new: counts.likelyNewUnmatchedCandidates ?? report.likely_new?.length ?? 0,
        accepted: counts.acceptedForPlaceSourcesImport ?? 0,
      };
    });
}

function main() {
  const args = parseArgs(process.argv);
  const reports = readReports(args.inputDir);
  const totals = reports.reduce((acc, report) => {
    acc.input_rows += report.input_rows;
    acc.matched += report.matched;
    acc.ambiguous += report.ambiguous;
    acc.likely_new += report.likely_new;
    acc.accepted += report.accepted;
    return acc;
  }, { input_rows: 0, matched: 0, ambiguous: 0, likely_new: 0, accepted: 0 });

  if (args.json) {
    console.log(JSON.stringify({ input_dir: args.inputDir, totals, reports }, null, 2));
    return;
  }

  console.log('# Source Review Summary');
  console.log('');
  console.log(`Input directory: \`${args.inputDir}\``);
  console.log('');
  console.log('## Totals');
  console.log(table(['input_rows', 'matched', 'ambiguous', 'likely_new', 'accepted'], [totals]));
  console.log('');
  console.log('## Reports');
  console.log(table(
    ['file', 'source', 'entity', 'input_rows', 'matched', 'ambiguous', 'likely_new', 'accepted'],
    reports
  ));
}

main();
