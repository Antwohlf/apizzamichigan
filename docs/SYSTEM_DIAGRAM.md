# APizzaMichigan: How the System Works

> The scheduled compatibility runtime now lives in the external pipeline
> repository under `packages/food-runtime`. App-local script paths shown below
> describe retained compatibility interfaces and should not be used to install
> production services from this checkout.

This is the plain-language view of the project. It shows where information comes
from, how it gets checked, and what eventually appears on the public map.

## The Simple Picture

```mermaid
flowchart LR
    SOURCES["Information from the outside world\nOpenStreetMap, restaurant websites,\npublic directories, and your own visits"]
    GATHER["Find and collect\npossible pizza places and updates"]
    CHECK["Check and improve\ncompare records, remove duplicates,\nfill in useful details"]
    REVIEW["Your review\nconfirm a match, approve a new place,\nor save it for later"]
    MAP["The pizza map\nthe trusted list of places\npeople can browse"]
    CARE["Ongoing upkeep\nphotos, suggestions, new details,\nand periodic refreshes"]

    SOURCES --> GATHER --> CHECK --> REVIEW --> MAP
    MAP --> CARE --> CHECK

    classDef source fill:#263238,stroke:#90a4ae,color:#fff
    classDef step fill:#fff4e6,stroke:#ff7a1a,color:#1f2933
    classDef map fill:#e8f5e9,stroke:#2e7d32,color:#1f2933
    class SOURCES source
    class GATHER,CHECK,REVIEW,CARE step
    class MAP map
```

## What Each Step Means

| Step | In everyday language |
|---|---|
| **Find and collect** | The system looks for pizza places and changes from trusted sources. |
| **Check and improve** | It compares names, addresses, phone numbers, websites, and locations so the same place is not added twice. It also gathers menus, hours, prices, and pizza style when available. |
| **Your review** | You make the final call when a source might be the same place, a genuinely new place, bad information, or a business that replaced an older one. |
| **The pizza map** | This is the clean, public list used by the website. It contains places people can actually find and use. |
| **Ongoing upkeep** | New photos, suggestions, closures, and updated restaurant information come back through the same checking process. |

## The Important Rule

Outside sources can **suggest** changes. They do not silently rewrite your personal
history. Your visits, ratings, notes, and photos stay attached to the place you
reviewed unless you deliberately choose a historical replacement action.

## What You See as the Owner

```mermaid
flowchart TB
    HOME["Admin home\nWhat needs attention?"] --> DATA["Data review\nOne decision at a time"]
    HOME --> PHOTOS["Photos\nAdd, reorder, or remove"]
    HOME --> SUGGESTIONS["Suggestions\nApprove or reject"]
    HOME --> SYSTEM["System\nDetailed status and diagnostics"]
    DATA --> DECIDE["Same place\nDifferent place\nNew place\nBad data\nSave for later"]
    DECIDE --> MAP["Trusted public map"]
```

The everyday workflow is intentionally short. Technical reports, source details,
and import controls remain available, but they are kept out of the main review
path.

## Runtime ownership

- This repository owns the public maps, admin review interface, product schemas,
  protected editorial fields, and guarded database publication contracts.
- The [external pipeline repository](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline)
  owns acquisition, enrichment, queues, scheduling, and the production publishers.
- The website reads public data independently of pipeline execution. Its admin
  interface reads bounded status snapshots; reading status does not authorize writes.
- Host services, machine paths, schedules, and operational state belong in private
  deployment inventories, not this diagram.

See [PIPELINE_BOUNDARY.md](PIPELINE_BOUNDARY.md) for integration details and
[DATA_PIPELINE.md](DATA_PIPELINE.md) for the product data flow.
