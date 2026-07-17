#!/usr/bin/env python3
import argparse, json
from pathlib import Path
import duckdb

parser = argparse.ArgumentParser()
parser.add_argument('--bbox', required=True, help='south,west,north,east')
parser.add_argument('--output', required=True)
parser.add_argument('--limit', type=int, default=5000)
args = parser.parse_args()
south, west, north, east = [float(value) for value in args.bbox.split(',')]
con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
con.execute("SET s3_region='us-west-2'")
release = con.execute("SELECT latest FROM read_json_auto('https://stac.overturemaps.org/catalog.json')").fetchone()[0]
path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
query = f"""
SELECT id, names.primary AS name, confidence, basic_category,
       categories.primary AS primary_category, operating_status,
       bbox.xmin AS lng, bbox.ymin AS lat,
       CAST(websites AS JSON) AS websites, CAST(phones AS JSON) AS phones
FROM read_parquet('{path}', filename=true, hive_partitioning=1)
WHERE categories.primary = 'pizza_restaurant'
  AND bbox.xmin BETWEEN {west} AND {east}
  AND bbox.ymin BETWEEN {south} AND {north}
  AND COALESCE(operating_status, 'open') NOT IN ('closed', 'permanently_closed')
LIMIT {int(args.limit)}
"""
cursor = con.execute(query)
columns = [item[0] for item in cursor.description]
result = [dict(zip(columns, values)) for values in cursor.fetchall()]
rows = []
for row in result:
    def json_value(value):
        if value is None: return None
        if isinstance(value, str):
            try: return json.loads(value)
            except Exception: return value
        return value
    rows.append({
        'id': row.get('id'), 'name': row.get('name'), 'lat': row.get('lat'), 'lng': row.get('lng'),
        'category': row.get('primary_category') or row.get('basic_category'),
        'confidence': row.get('confidence'), 'operating_status': row.get('operating_status'),
        'websites': json_value(row.get('websites')), 'phones': json_value(row.get('phones')),
        'country': 'US', 'source_url': f"https://explore.overturemaps.org/places/{row.get('id')}"
    })
Path(args.output).write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'source': 'overture_places', 'release': release, 'rows': len(rows), 'output': args.output}))
