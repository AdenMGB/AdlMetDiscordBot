#!/usr/bin/env python3
"""Build D1 SQL for Adelaide Metro rail departures from static GTFS."""

from __future__ import annotations

import csv
import io
import subprocess
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

GTFS_URL = "https://gtfs.adelaidemetro.com.au/v1/static/latest/google_transit.zip"
TZ = ZoneInfo("Australia/Adelaide")
DAYS_AHEAD = 14
OUT_SQL = Path(__file__).resolve().parent.parent / "data" / "rail-gtfs-import.sql"

LINE_ROUTES = {
    "gawler": {"GAW", "GAWC", "SALIS"},
    "seaford": {"SEAFRD", "NOAR"},
    "flinders": {"FLNDRS"},
    "outer-harbor": {"OUTHA", "OSBORN", "GLAN"},
    "grange": {"GRNG"},
    "port-dock": {"PTDOCK"},
    "belair": {"BEL"},
}


def is_city_headsign(headsign: str) -> bool:
    h = headsign.strip()
    return bool(__import__("re").search(r"\bcity\b", h, __import__("re").I)) or h.lower().startswith(
        "adelaide"
    )


def parse_csv(name: str, zf: zipfile.ZipFile) -> list[dict[str, str]]:
    with zf.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def active_dates(
    service_id: str,
    start: date,
    days: int,
    calendar: dict[str, dict[str, str]],
    calendar_dates: dict[str, list[tuple[date, int]]],
) -> list[date]:
    out: list[date] = []
    cal = calendar.get(service_id)
    if not cal:
        return out
    cal_start = datetime.strptime(cal["start_date"], "%Y%m%d").date()
    cal_end = datetime.strptime(cal["end_date"], "%Y%m%d").date()
    exceptions = {d: t for d, t in calendar_dates.get(service_id, [])}
    for i in range(days):
        d = start + timedelta(days=i)
        if d < cal_start or d > cal_end:
            if exceptions.get(d) == 1:
                out.append(d)
            continue
        wd = d.weekday()  # Mon=0
        cols = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        if cal.get(cols[wd]) != "1":
            if exceptions.get(d) == 1:
                out.append(d)
            continue
        if exceptions.get(d) == 2:
            continue
        out.append(d)
    return out


def gtfs_time_to_unix(d: date, gtfs_time: str) -> int:
    parts = gtfs_time.split(":")
    h, m, s = int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0
    extra = h // 24
    h = h % 24
    dt = datetime(d.year, d.month, d.day, h, m, s, tzinfo=TZ) + timedelta(days=extra)
    return int(dt.timestamp())


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    print(f"Downloading GTFS from {GTFS_URL} ...")
    with urllib.request.urlopen(GTFS_URL, timeout=120) as resp:
        zdata = resp.read()

    zf = zipfile.ZipFile(io.BytesIO(zdata))
    routes = parse_csv("routes.txt", zf)
    train_routes = {
        r["route_id"]: r
        for r in routes
        if "Train service" in (r.get("route_desc") or "")
    }

    trips = parse_csv("trips.txt", zf)
    rail_trips: dict[str, tuple[str, str, str]] = {}
    trip_to_line: dict[str, str] = {}
    for t in trips:
        rid = t["route_id"]
        matched_line = None
        for line_id, rids in LINE_ROUTES.items():
            if rid in rids:
                matched_line = line_id
                break
        if matched_line:
            rail_trips[t["trip_id"]] = (rid, t["trip_headsign"], t.get("direction_id", "0"))
            trip_to_line[t["trip_id"]] = matched_line

    stop_rows = parse_csv("stops.txt", zf)
    stops = {s["stop_id"]: s["stop_name"] for s in stop_rows}
    stop_coords = {
        s["stop_id"]: (s["stop_name"], float(s["stop_lat"]), float(s["stop_lon"]))
        for s in stop_rows
    }

    # One GTFS stop_id per platform/direction — deduped by name when listing stations.
    line_stations: dict[str, dict[str, str]] = defaultdict(dict)
    line_station_names: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    calendar = {c["service_id"]: c for c in parse_csv("calendar.txt", zf)}
    calendar_dates: dict[str, list[tuple[date, int]]] = defaultdict(list)
    for row in parse_csv("calendar_dates.txt", zf):
        d = datetime.strptime(row["date"], "%Y%m%d").date()
        calendar_dates[row["service_id"]].append((d, int(row["exception_type"])))

    today = datetime.now(TZ).date()
    service_days: dict[str, list[date]] = {}
    for sid in {t["service_id"] for t in trips if t["trip_id"] in rail_trips}:
        service_days[sid] = active_dates(sid, today, DAYS_AHEAD, calendar, calendar_dates)

    departures: list[tuple[str, int, str, str, str]] = []
    trip_service = {t["trip_id"]: t["service_id"] for t in trips}

    print("Parsing stop_times (this may take a minute) ...")
    with zf.open("stop_times.txt") as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig")
        for row in csv.DictReader(text):
            tid = row["trip_id"]
            if tid not in rail_trips:
                continue
            rid, headsign, _ = rail_trips[tid]
            line_id = trip_to_line[tid]
            stop_id = row["stop_id"]
            stop_name = stops.get(stop_id, stop_id)
            line_stations[line_id][stop_id] = stop_name
            line_station_names[line_id][stop_name].add(stop_id)

            sid = trip_service[tid]
            dep_time = row["departure_time"]
            if not dep_time:
                continue
            kind = "city" if is_city_headsign(headsign) else "outbound"
            for d in service_days.get(sid, []):
                ts = gtfs_time_to_unix(d, dep_time)
                departures.append((stop_id, ts, headsign, kind, rid))

    trip_stop_rows: list[tuple[str, int, str]] = []
    used_stop_ids: set[str] = set()
    print("Building trip stop sequences ...")
    with zf.open("stop_times.txt") as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig")
        for row in csv.DictReader(text):
            tid = row["trip_id"]
            if tid not in rail_trips:
                continue
            seq = int(row["stop_sequence"])
            sid = row["stop_id"]
            trip_stop_rows.append((tid, seq, sid))
            used_stop_ids.add(sid)

    departures.sort(key=lambda x: (x[0], x[1]))
    OUT_SQL.parent.mkdir(parents=True, exist_ok=True)

    with OUT_SQL.open("w", encoding="utf-8") as out:
        out.write("DELETE FROM rail_departures;\n")
        out.write("DELETE FROM rail_stations;\n")
        out.write("DELETE FROM rail_trip_stops;\n")
        out.write("DELETE FROM rail_trips;\n")
        out.write("DELETE FROM rail_stops;\n")
        out.write("DELETE FROM gtfs_meta;\n")

        for line_id, by_name in sorted(line_station_names.items()):
            for name, stop_ids in sorted(by_name.items(), key=lambda x: x[0]):
                for stop_id in sorted(stop_ids):
                    out.write(
                        f"INSERT INTO rail_stations (line_id, stop_id, name) VALUES "
                        f"({sql_literal(line_id)}, {sql_literal(stop_id)}, {sql_literal(name)});\n"
                    )

        batch: list[str] = []
        for stop_id, ts, headsign, kind, rid in departures:
            batch.append(
                f"({sql_literal(stop_id)}, {ts}, {sql_literal(headsign)}, {sql_literal(kind)}, {sql_literal(rid)})"
            )
            if len(batch) >= 400:
                out.write(
                    "INSERT INTO rail_departures (stop_id, depart_at, headsign, direction_kind, route_id) VALUES\n"
                )
                out.write(",\n".join(batch))
                out.write(";\n")
                batch = []

        if batch:
            out.write(
                "INSERT INTO rail_departures (stop_id, depart_at, headsign, direction_kind, route_id) VALUES\n"
            )
            out.write(",\n".join(batch))
            out.write(";\n")

        for tid, (rid, headsign, _) in sorted(rail_trips.items()):
            out.write(
                f"INSERT INTO rail_trips (trip_id, route_id, headsign) VALUES "
                f"({sql_literal(tid)}, {sql_literal(rid)}, {sql_literal(headsign)});\n"
            )

        for sid in sorted(used_stop_ids):
            name, lat, lon = stop_coords[sid]
            out.write(
                f"INSERT INTO rail_stops (stop_id, name, lat, lon) VALUES "
                f"({sql_literal(sid)}, {sql_literal(name)}, {lat}, {lon});\n"
            )

        trip_batch: list[str] = []
        for tid, seq, sid in sorted(trip_stop_rows, key=lambda x: (x[0], x[1])):
            trip_batch.append(f"({sql_literal(tid)}, {seq}, {sql_literal(sid)})")
            if len(trip_batch) >= 500:
                out.write(
                    "INSERT INTO rail_trip_stops (trip_id, stop_sequence, stop_id) VALUES\n"
                )
                out.write(",\n".join(trip_batch))
                out.write(";\n")
                trip_batch = []
        if trip_batch:
            out.write("INSERT INTO rail_trip_stops (trip_id, stop_sequence, stop_id) VALUES\n")
            out.write(",\n".join(trip_batch))
            out.write(";\n")

        imported = datetime.now(TZ).strftime("%Y-%m-%d %H:%M %Z")
        out.write(
            f"INSERT INTO gtfs_meta (key, value) VALUES ('imported_at', {sql_literal(imported)});\n"
        )

    print(
        f"Wrote {OUT_SQL} ({len(departures):,} departures, "
        f"{len(trip_stop_rows):,} trip stops, {len(used_stop_ids)} stop coords)"
    )
    return 0


def run_wrangler_migrations(local: bool) -> None:
    flag = [] if local else ["--remote"]
    cmd = [
        "pnpm",
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "adlmetbot-gtfs",
        *flag,
    ]
    print("Ensuring schema:", " ".join(cmd))
    subprocess.check_call(cmd, cwd=OUT_SQL.parent.parent)


def run_wrangler_execute(remote: bool) -> None:
    if not remote:
        run_wrangler_migrations(local=True)
    flag = "--remote" if remote else "--local"
    cmd = [
        "pnpm",
        "exec",
        "wrangler",
        "d1",
        "execute",
        "adlmetbot-gtfs",
        flag,
        "--file",
        str(OUT_SQL),
        "--yes",
    ]
    print("Running:", " ".join(cmd))
    subprocess.check_call(cmd, cwd=OUT_SQL.parent.parent)


if __name__ == "__main__":
    rc = main()
    if rc != 0:
        raise SystemExit(rc)
    if "--apply-local" in sys.argv or "--apply-remote" in sys.argv:
        run_wrangler_execute("--apply-remote" in sys.argv)
