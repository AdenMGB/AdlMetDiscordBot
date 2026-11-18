#!/usr/bin/env python3
"""Build simplified Adelaide Metro rail polylines from GTFS shapes.txt + routes.txt."""

from __future__ import annotations

import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

GTFS_URL = "https://gtfs.adelaidemetro.com.au/v1/static/latest/google_transit.zip"
OUT = Path(__file__).resolve().parent.parent / "packages" / "rail-fleet-core" / "data" / "rail-line-tracks.json"

LINE_ROUTES: dict[str, list[str]] = {
    "gawler": ["GAW", "GAWC", "SALIS"],
    "seaford": ["SEAFRD", "NOAR"],
    "flinders": ["FLNDRS"],
    "outer-harbor": ["OUTHA", "OSBORN", "GLAN"],
    "grange": ["GRNG"],
    "port-dock": ["PTDOCK"],
    "belair": ["BEL"],
}


def parse_csv(name: str, zf: zipfile.ZipFile) -> list[dict[str, str]]:
    with zf.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def hex_color(route: dict[str, str], fallback: str) -> str:
    raw = (route.get("route_color") or "").strip()
    if not raw:
        return fallback
    if not raw.startswith("#"):
        raw = f"#{raw}"
    if len(raw) == 7:
        return raw.upper()
    return fallback


def downsample(points: list[dict[str, float]], max_pts: int) -> list[dict[str, float]]:
    if len(points) <= max_pts:
        return points
    step = len(points) / max_pts
    return [points[int(i * step)] for i in range(max_pts)]


def main() -> int:
    print(f"Downloading GTFS from {GTFS_URL} …")
    with urllib.request.urlopen(GTFS_URL, timeout=180) as resp:
        zdata = resp.read()

    zf = zipfile.ZipFile(io.BytesIO(zdata))
    routes = {r["route_id"]: r for r in parse_csv("routes.txt", zf)}
    trips = parse_csv("trips.txt", zf)

    shape_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in trips:
        rid = t.get("route_id", "")
        sid = t.get("shape_id", "")
        if rid and sid:
            shape_counts[rid][sid] += 1

    shapes_raw = parse_csv("shapes.txt", zf)
    by_shape: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for row in shapes_raw:
        sid = row.get("shape_id", "")
        if not sid:
            continue
        try:
            seq = int(row.get("shape_pt_sequence", "0"))
            lat = float(row["shape_pt_lat"])
            lon = float(row["shape_pt_lon"])
        except (KeyError, ValueError):
            continue
        by_shape[sid].append((seq, lat, lon))

    shape_points: dict[str, list[dict[str, float]]] = {}
    for sid, pts in by_shape.items():
        ordered = sorted(pts, key=lambda p: p[0])
        shape_points[sid] = [{"lat": lat, "lon": lon} for _, lat, lon in ordered]

    out_lines: list[dict] = []
    for line_id, route_ids in LINE_ROUTES.items():
        line_color = ""
        polylines: list[list[dict[str, float]]] = []
        seen_shape: set[str] = set()

        for rid in route_ids:
            route = routes.get(rid)
            if not route:
                continue
            if not line_color:
                line_color = hex_color(route, "#546E7A")

            counts = shape_counts.get(rid, {})
            if not counts:
                continue
            shape_id = max(counts.items(), key=lambda x: x[1])[0]
            if shape_id in seen_shape:
                continue
            seen_shape.add(shape_id)
            pts = shape_points.get(shape_id)
            if not pts or len(pts) < 2:
                continue
            polylines.append(downsample(pts, 450))

        if not line_color:
            line_color = "#546E7A"

        for pts in polylines:
            out_lines.append(
                {
                    "lineId": line_id,
                    "color": line_color,
                    "points": pts,
                }
            )

    payload = {
        "source": "gtfs.adelaidemetro.com.au static (shapes.txt, routes.txt)",
        "generatedFrom": GTFS_URL,
        "tracks": out_lines,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(out_lines)} polylines → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())