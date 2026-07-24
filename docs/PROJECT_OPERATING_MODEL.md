# Project Operating Model

APizzaMichigan is the first product built on a reusable place-data platform.
The platform should support TacoBoutMichigan by configuration, not by copying
the pizza code and operating rules.

## Product boundary

The public app answers one question well:

> What pizza place should I try here, and why might it be worth my time?

The map is the discovery surface. Search, location, style, price, lifecycle,
photos, and Anthony's Picks help a person narrow the map. The admin portal is
an editorial workbench, not a second public product.

## Three data layers

### Canonical place record

One row represents one business at one point in its history. It owns the
public identity, coordinates, lifecycle, editorial rating, photos, and the
primary classification shown on the map.

### Source evidence

OSM, official websites, FSQ OS Places, All The Places, Overture, and Wikidata
are inputs. They provide discovery and factual evidence. They do not silently
overwrite identity, personal history, lifecycle, or classification.

### Operational state

Queues, worker heartbeats, checkpoints, reports, and review decisions exist to
run the pipeline. They are not public place data and should remain local or in
bounded admin views.

## Field ownership

| Field group | Owner | Public by default? |
| --- | --- | --- |
| Name, address, coordinates, external identity | reviewed source match or explicit admin action | Yes |
| Website, phone, menu, hours | fresh source evidence under promotion rules | Yes |
| Primary pizza style and price | classifier plus human correction | Yes |
| Lifecycle and replacement relationship | explicit editorial/admin action | Yes, with historical context |
| Rating, notes, photos, Anthony's Picks | Anthony/editorial workflow | Yes where intentionally published |
| Provenance, queue state, audit history, raw evidence | local/admin operations | No |

## Primary style rule

Each pizza place has one primary style for filtering and map display. The
taxonomy is intentionally compact: New York, New Haven / Connecticut, Chicago
Deep Dish, Chicago Tavern, Detroit, Sicilian, Grandma, Neapolitan, Roman,
California, St. Louis, Tavern, Standard Round, Other, and Unknown.

Descriptors such as breakfast, frozen, white pizza, slice, pan, square, or
tomato pie are useful secondary attributes, but should not become additional
primary-style values without a product decision.

Anthony's Picks is an editorial filter, not a source or classifier result. Its
minimum rating is configured per entity profile (currently 8/10 for Pizza and
Taco), and the public map count and place filter must use that same configured
value.

## Source precedence

1. Official website for first-party contact and menu facts.
2. OSM for broad discovery and current map-linked factual evidence.
3. FSQ OS Places and All The Places for additional discovery and evidence.
4. Overture and Wikidata for identity and supporting facts.
5. Manual/editorial review for identity conflicts, lifecycle, ratings, photos,
   and personal history.

Google Maps is an outbound navigation link only. It is not an ingestion source.

## Lifecycle rule

Closing a business is not deleting it. A permanently closed place remains in
the historical record. When a successor occupies the same location, the old
place is marked replaced and points to the new canonical place. A source match
must never overwrite a reviewed place's name or personal history merely
because the address is unchanged.

## Operating priorities

1. Keep the public map fast, searchable, and trustworthy.
2. Keep canonical data and public data reconciled through bounded, low-I/O
   operations.
3. Make human review small and high-value by automating only high-confidence
   matches and presenting uncertainty clearly.
4. Refresh OSM and source evidence on a schedule without creating duplicate
   writers or unbounded queues.
5. Add TacoBoutMichigan only through the shared entity profile and verified
   configuration boundary.

## Current implementation boundary

`config/entity-profiles.json` is the reuse boundary. It identifies what varies
by entity. The canonical contract remains shared; source pipelines may be
enabled per entity as their adapters and schemas become production-ready.
Each profile declares this explicitly through `source_pipeline.enabled` and,
when enabled, the path to its pipeline configuration. Pizza is operationally
active today. Taco has a canonical table and public/admin surface, but its
`source_pipeline.enabled` flag is deliberately false until it has its own
validated policy and runbook.
