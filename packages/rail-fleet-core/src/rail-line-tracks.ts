import tracksJson from "../data/rail-line-tracks.json" with { type: "json" };
import { lineColorForLine, lineIdForRoute } from "./index.js";
import type { FleetMapLineTrack } from "./map-svg.js";

type TrackFile = {
	tracks: { lineId: string; color: string; points: { lat: number; lon: number }[] }[];
};

const ALL_TRACKS: FleetMapLineTrack[] = (tracksJson as TrackFile).tracks.map((t) => ({
	lineId: t.lineId,
	color: t.color?.startsWith("#") ? t.color : lineColorForLine(t.lineId),
	points: t.points,
}));

/** GTFS shape polylines (official route colors), not live GPS traces. */
export function getRailLineTracks(filter?: {
	line?: string;
	routeId?: string;
}): FleetMapLineTrack[] {
	let tracks = ALL_TRACKS;
	if (filter?.line) {
		tracks = tracks.filter((t) => t.lineId === filter.line);
	}
	// route-level filters still use whole line geometry (same corridor)
	if (filter?.routeId) {
		const lid = lineIdForRoute(filter.routeId);
		if (lid) tracks = tracks.filter((t) => t.lineId === lid);
	}
	return tracks;
}