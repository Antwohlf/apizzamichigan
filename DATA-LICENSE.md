# Data and asset licensing

The software license for this repository does not automatically apply to data
or media.

Production database snapshots, place records, source-derived datasets, review
queues, personal ratings and notes, user submissions, uploaded photographs,
provider responses, logs, and pipeline artifacts are not licensed for reuse
here.

The repository is still private and currently contains legacy record-level
files, including first-party fallback data and personal reviews. The generated
OSM SQL import and resume checkpoints were privately preserved and removed from
the current tree; older history still contains them. The remaining records
must be removed, replaced with synthetic data, or receive an explicit
provenance and licensing decision before repository visibility changes.

Files explicitly described as synthetic fixtures contain fabricated
names, identifiers, addresses, phone numbers, and URLs. They exist only for
testing code paths. Generated aggregate statistics and first-party interface
assets may be included when they do not disclose record-level data; their
provenance must be documented alongside the file.

Third-party names, trademarks, map tiles, fonts, icons, and source data remain
subject to their respective owners' terms. Adding a new data source requires a
documented acquisition, attribution, retention, and redistribution decision in
the external pipeline profile before real records are processed.
