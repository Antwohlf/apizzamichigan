#!/usr/bin/env python3
"""Export a bounded FSQ OS Places sample through a Portal DuckDB setup snippet.

The Foursquare Places Portal provides the Iceberg/DuckDB setup SQL. Keep that
SQL in an ignored file because it may include account-specific catalog details
or token placeholders. This script only executes the setup, runs a small
read-only query, and writes JSON rows for source-input-sample-report.mjs.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


DEFAULT_INIT_SQL = "scripts/.fsq-portal-init.sql"
DEFAULT_OUTPUT = "data/source-samples/fsq-os-places-pizza-sample.json"
DEFAULT_REVIEW_OUTPUT = "reports/source-review/fsq-os-places-review.json"
PORTAL_INIT_SQL_EXAMPLE_MARKERS = [
    "Example FSQ Places Portal DuckDB setup file",
    "Paste the actual Portal setup SQL below",
    "Copy the DuckDB/Iceberg setup SQL from the Foursquare Places Portal",
]


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    out: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("\"'")
    return out


def merged_env(root: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    env.update(load_env_file(root / ".env"))
    env.update(load_env_file(root / ".env.local"))
    env.update(os.environ)
    return env


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a small FSQ OS Places sample through a Portal DuckDB snippet.",
    )
    parser.add_argument(
        "--init-sql-file",
        default=os.environ.get("FSQ_DUCKDB_INIT_SQL_FILE", DEFAULT_INIT_SQL),
        help=f"Ignored SQL setup file from the Places Portal (default {DEFAULT_INIT_SQL})",
    )
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help=f"JSON output path (default {DEFAULT_OUTPUT})")
    parser.add_argument("--entity", choices=["pizza", "taco"], default="pizza")
    parser.add_argument(
        "--review-output",
        default=DEFAULT_REVIEW_OUTPUT,
        help=f"Review JSON path for --run-report (default {DEFAULT_REVIEW_OUTPUT})",
    )
    parser.add_argument("--limit", type=int, default=100, help="Maximum rows to export.")
    parser.add_argument("--query", default="pizza", help="Case-insensitive text filter.")
    parser.add_argument(
        "--places-table",
        default=os.environ.get("FSQ_PLACES_TABLE", "places"),
        help="DuckDB-visible FSQ places table name after init SQL.",
    )
    parser.add_argument(
        "--categories-table",
        default=os.environ.get("FSQ_CATEGORIES_TABLE", "categories"),
        help="DuckDB-visible FSQ categories table name after init SQL.",
    )
    parser.add_argument("--run-report", action="store_true")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate that the setup SQL exposes the requested places table.",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable validation output.")
    return parser.parse_args()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def substitute_env_placeholders(sql: str, env: dict[str, str]) -> str:
    token = env.get("FSQ_PLACES_TOKEN", "")
    return (
        sql.replace("${FSQ_PLACES_TOKEN}", token)
        .replace("{{FSQ_PLACES_TOKEN}}", token)
        .replace("$FSQ_PLACES_TOKEN", token)
    )


def validate_init_sql(sql: str) -> tuple[bool, str]:
    if not sql.strip():
        return False, "Portal DuckDB setup SQL file exists but is empty."
    if any(marker in sql for marker in PORTAL_INIT_SQL_EXAMPLE_MARKERS):
        return False, "Portal DuckDB setup SQL file looks like the checked-in example, not the real Portal snippet."

    executable_keywords = ("ATTACH", "CREATE", "INSTALL", "LOAD", "SET", "CALL", "SELECT")
    upper_sql = sql.upper()
    if not any(keyword in upper_sql for keyword in executable_keywords):
        return False, "Portal DuckDB setup SQL file does not appear to contain executable DuckDB SQL."

    return True, "ok"


def json_safe(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    return value


def build_queries(places_table: str, categories_table: str, query: str, limit: int) -> tuple[str, str]:
    pattern = f"%{query.lower()}%"
    category_join = f"""
      SELECT
        p.fsq_place_id,
        p.name,
        p.latitude,
        p.longitude,
        p.address,
        p.locality,
        p.region,
        p.postcode,
        p.country,
        p.tel,
        p.website,
        p.fsq_category_ids,
        ARRAY_AGG(DISTINCT c.label) FILTER (WHERE c.label IS NOT NULL) AS fsq_category_labels,
        p.date_closed,
        p.unresolved_flags
      FROM {places_table} p
      LEFT JOIN {categories_table} c
        ON list_contains(p.fsq_category_ids, c.category_id)
      WHERE p.date_closed IS NULL
        AND (
          lower(p.name) LIKE {sql_literal(pattern)}
          OR lower(coalesce(c.label, '')) LIKE {sql_literal(pattern)}
        )
      GROUP BY
        p.fsq_place_id, p.name, p.latitude, p.longitude, p.address, p.locality,
        p.region, p.postcode, p.country, p.tel, p.website, p.fsq_category_ids,
        p.date_closed, p.unresolved_flags
      LIMIT {int(limit)}
    """
    name_only = f"""
      SELECT
        fsq_place_id,
        name,
        latitude,
        longitude,
        address,
        locality,
        region,
        postcode,
        country,
        tel,
        website,
        fsq_category_ids,
        date_closed,
        unresolved_flags
      FROM {places_table}
      WHERE date_closed IS NULL
        AND lower(name) LIKE {sql_literal(pattern)}
      LIMIT {int(limit)}
    """
    return category_join, name_only


def validate_table_visibility(con, places_table: str, categories_table: str) -> tuple[bool, dict]:
    result = {
        "places_table": places_table,
        "categories_table": categories_table,
        "places_ready": False,
        "categories_ready": False,
        "places_error": None,
        "categories_error": None,
    }
    try:
        con.execute(f"SELECT * FROM {places_table} LIMIT 0")
        result["places_ready"] = True
    except Exception as error:
        result["places_error"] = str(error).splitlines()[0]

    try:
        con.execute(f"SELECT * FROM {categories_table} LIMIT 0")
        result["categories_ready"] = True
    except Exception as error:
        result["categories_error"] = str(error).splitlines()[0]

    return bool(result["places_ready"]), result


def main() -> int:
    args = parse_args()
    if args.limit < 1 or args.limit > 5000:
        raise SystemExit("--limit must be between 1 and 5000")

    root = Path.cwd()
    env = merged_env(root)
    init_sql_path = root / args.init_sql_file
    if not init_sql_path.exists():
        print(f"Missing Places Portal DuckDB setup file: {args.init_sql_file}")
        print("Create it from the Portal DuckDB snippet. The file is ignored by git.")
        return 2
    if not env.get("FSQ_PLACES_TOKEN"):
        print("Missing FSQ_PLACES_TOKEN in environment or .env.")
        return 2

    try:
        import duckdb
    except ImportError:
        print("Missing Python package duckdb. Install it in an ignored venv first.")
        return 2

    raw_setup_sql = init_sql_path.read_text()
    init_ok, init_message = validate_init_sql(raw_setup_sql)
    if not init_ok:
        print(init_message)
        print("Replace scripts/.fsq-portal-init.sql with the real Portal-provided DuckDB/Iceberg setup SQL.")
        return 2

    setup_sql = substitute_env_placeholders(raw_setup_sql, env)
    con = duckdb.connect(":memory:")
    con.execute("SET enable_progress_bar = false")
    con.execute(setup_sql)

    visible, visibility = validate_table_visibility(con, args.places_table, args.categories_table)
    if args.validate_only:
        payload = {
            "ok": visible,
            "state": "ready" if visible else "missing_places_table",
            **visibility,
        }
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            print("# FSQ Places Portal DuckDB Validation")
            print("")
            print(f"state={payload['state']}")
            print(f"places_table={args.places_table}")
            print(f"places_ready={'yes' if payload['places_ready'] else 'no'}")
            print(f"categories_table={args.categories_table}")
            print(f"categories_ready={'yes' if payload['categories_ready'] else 'no'}")
            if payload["places_error"]:
                print(f"places_error={payload['places_error']}")
            if payload["categories_error"]:
                print(f"categories_error={payload['categories_error']}")
        return 0 if visible else 2

    with_categories, name_only = build_queries(args.places_table, args.categories_table, args.query, args.limit)
    try:
        cursor = con.execute(with_categories)
    except Exception:
        cursor = con.execute(name_only)

    columns = [item[0] for item in cursor.description]
    rows = [{columns[i]: json_safe(value) for i, value in enumerate(row)} for row in cursor.fetchall()]

    output_path = root / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(rows, indent=2) + "\n")

    print("# FSQ Places Portal DuckDB Sample Export")
    print("")
    print(f"Rows written: {len(rows)}")
    print(f"Output: {args.output}")
    print(f"Query: {args.query}")
    print(f"Limit: {args.limit}")
    print("")
    print("Next command:")
    report_cmd = [
        "node",
        "scripts/ops/source-input-sample-report.mjs",
        "--source",
        "fsq_os_places",
        "--input",
        args.output,
        "--entity",
        args.entity,
        "--max-distance-m",
        "100",
        "--limit",
        "5000",
        "--sample",
        "25",
        "--review-output",
        args.review_output,
    ]
    print(" ".join(report_cmd))

    if args.run_report:
        print("")
        print("Running source adapter report...")
        subprocess.run(report_cmd, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
