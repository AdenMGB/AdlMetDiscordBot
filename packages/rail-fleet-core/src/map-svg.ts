import {
	type FleetVehicle,
	formatAdelaideDateTime,
	LINE_LABELS,
	lineColorForLine,
	lineColorForRoute,
	lineIdForRoute,
} from "./index.js";

type Point = { lat: number; lon: number };

export type FleetMapLineTrack = {
	lineId: string;
	color: string;
	points: Point[];
};

export type MapBaseLayer = "osm";

export type BuildFleetMapSvgOptions = {
	title: string;
	baseLayer?: MapBaseLayer;
	/** When the map snapshot was generated (defaults to Adelaide “now”). */
	generatedAt?: Date;
};

const TILE_SIZE = 256;
const MAP_WIDTH = 1280;
const MAP_HEIGHT = 900;
const FOOTER_H = 22;
const MAX_TILES = 80;

const ADELAIDE_METRO_BOX: Point[] = [
	{ lat: -34.75, lon: 138.48 },
	{ lat: -35.12, lon: 138.72 },
];

const FONT =
	'font-family="DejaVu Sans, Liberation Sans, Noto Sans, Arial, Helvetica, sans-serif"';

function lonLatToPixel(
	lat: number,
	lon: number,
	zoom: number,
): { px: number; py: number } {
	const scale = TILE_SIZE * 2 ** zoom;
	const px = ((lon + 180) / 360) * scale;
	const latRad = (lat * Math.PI) / 180;
	const py =
		((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
		scale;
	return { px, py };
}

type GeoBounds = {
	minLat: number;
	maxLat: number;
	minLon: number;
	maxLon: number;
};

function viewBoundsFromMarkers(markers: Point[]): GeoBounds {
	if (markers.length === 0) {
		return {
			minLat: ADELAIDE_METRO_BOX[0].lat,
			maxLat: ADELAIDE_METRO_BOX[1].lat,
			minLon: ADELAIDE_METRO_BOX[0].lon,
			maxLon: ADELAIDE_METRO_BOX[1].lon,
		};
	}
	let minLat = markers[0].lat;
	let maxLat = markers[0].lat;
	let minLon = markers[0].lon;
	let maxLon = markers[0].lon;
	for (const m of markers) {
		minLat = Math.min(minLat, m.lat);
		maxLat = Math.max(maxLat, m.lat);
		minLon = Math.min(minLon, m.lon);
		maxLon = Math.max(maxLon, m.lon);
	}
	const latSpan = Math.max(maxLat - minLat, 0.008);
	const lonSpan = Math.max(maxLon - minLon, 0.012);
	const padLat = Math.max(latSpan * 0.45, 0.022);
	const padLon = Math.max(lonSpan * 0.45, 0.028);
	return {
		minLat: minLat - padLat,
		maxLat: maxLat + padLat,
		minLon: minLon - padLon,
		maxLon: maxLon + padLon,
	};
}

function boundsCorners(b: GeoBounds): Point[] {
	return [
		{ lat: b.maxLat, lon: b.minLon },
		{ lat: b.minLat, lon: b.maxLon },
	];
}

type MapLayout = {
	zoom: number;
	offsetX: number;
	offsetY: number;
	minTileX: number;
	maxTileX: number;
	minTileY: number;
	maxTileY: number;
	viewBounds: GeoBounds;
};

function buildLayout(viewBounds: GeoBounds): MapLayout {
	const innerH = MAP_HEIGHT - FOOTER_H;
	const corners = boundsCorners(viewBounds);

	for (let zoom = 13; zoom >= 11; zoom--) {
		const pixels = corners.map((p) => lonLatToPixel(p.lat, p.lon, zoom));
		const minPx = Math.min(...pixels.map((p) => p.px));
		const maxPx = Math.max(...pixels.map((p) => p.px));
		const minPy = Math.min(...pixels.map((p) => p.py));
		const maxPy = Math.max(...pixels.map((p) => p.py));
		const spanW = maxPx - minPx;
		const spanH = maxPy - minPy;
		if (spanW >= MAP_WIDTH - 8 || spanH >= innerH - 8) continue;

		const offsetX = (MAP_WIDTH - spanW) / 2 - minPx;
		const offsetY = (innerH - spanH) / 2 - minPy;

		const minTileX = Math.floor(-offsetX / TILE_SIZE);
		const maxTileX = Math.floor((MAP_WIDTH - offsetX - 1) / TILE_SIZE);
		const minTileY = Math.floor(-offsetY / TILE_SIZE);
		const maxTileY = Math.floor((innerH - offsetY - 1) / TILE_SIZE);
		const tileCount =
			(maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
		if (tileCount > MAX_TILES) continue;

		return {
			zoom,
			offsetX,
			offsetY,
			minTileX,
			maxTileX,
			minTileY,
			maxTileY,
			viewBounds,
		};
	}

	const zoom = 11;
	const pixels = corners.map((p) => lonLatToPixel(p.lat, p.lon, zoom));
	const minPx = Math.min(...pixels.map((p) => p.px));
	const maxPx = Math.max(...pixels.map((p) => p.px));
	const minPy = Math.min(...pixels.map((p) => p.py));
	const maxPy = Math.max(...pixels.map((p) => p.py));
	const spanW = maxPx - minPx;
	const spanH = maxPy - minPy;
	const offsetX = (MAP_WIDTH - spanW) / 2 - minPx;
	const offsetY = (innerH - spanH) / 2 - minPy;
	return {
		zoom,
		offsetX,
		offsetY,
		minTileX: Math.floor(-offsetX / TILE_SIZE),
		maxTileX: Math.floor((MAP_WIDTH - offsetX - 1) / TILE_SIZE),
		minTileY: Math.floor(-offsetY / TILE_SIZE),
		maxTileY: Math.floor((innerH - offsetY - 1) / TILE_SIZE),
		viewBounds,
	};
}

function projectPoint(
	lat: number,
	lon: number,
	layout: MapLayout,
): { x: number; y: number } {
	const { px, py } = lonLatToPixel(lat, lon, layout.zoom);
	return { x: px + layout.offsetX, y: py + layout.offsetY };
}

function tileHref(z: number, x: number, y: number): string {
	return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function tileImages(layout: MapLayout): string {
	const tiles: string[] = [];
	for (let tx = layout.minTileX; tx <= layout.maxTileX; tx++) {
		for (let ty = layout.minTileY; ty <= layout.maxTileY; ty++) {
			const x = tx * TILE_SIZE + layout.offsetX;
			const y = ty * TILE_SIZE + layout.offsetY;
			const href = tileHref(layout.zoom, tx, ty);
			tiles.push(
				`<image href="${href}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${TILE_SIZE}" height="${TILE_SIZE}"/>`,
			);
		}
	}
	return tiles.join("\n");
}

function pointInView(p: Point, b: GeoBounds, margin: number): boolean {
	return (
		p.lat >= b.minLat - margin &&
		p.lat <= b.maxLat + margin &&
		p.lon >= b.minLon - margin &&
		p.lon <= b.maxLon + margin
	);
}

function clipTrackPoints(points: Point[], bounds: GeoBounds): Point[] {
	const margin = 0.06;
	return points.filter((p) => pointInView(p, bounds, margin));
}

function polylineSvg(
	points: Point[],
	layout: MapLayout,
	color: string,
): string {
	const clipped = clipTrackPoints(points, layout.viewBounds);
	if (clipped.length < 2) return "";
	const pts = clipped
		.map((p) => {
			const { x, y } = projectPoint(p.lat, p.lon, layout);
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(" ");
	return `<polyline fill="none" stroke="#fff" stroke-width="6" stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>
<polyline fill="none" stroke="${color}" stroke-width="3.5" stroke-opacity="0.95" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>`;
}

export function buildFleetMapSvg(
	vehicles: FleetVehicle[],
	lineTracks: FleetMapLineTrack[],
	opts: BuildFleetMapSvgOptions,
): string {
	const markers = vehicles
		.filter((v) => v.last_lat != null && v.last_lon != null)
		.map((v) => ({ lat: v.last_lat as number, lon: v.last_lon as number }));

	const tracks = lineTracks.map((t) => ({
		...t,
		color: t.color || lineColorForLine(t.lineId),
	}));

	const gtfsColorByLine = new Map(tracks.map((t) => [t.lineId, t.color]));

	const viewBounds = viewBoundsFromMarkers(markers);
	const layout = buildLayout(viewBounds);

	const markersSvg = vehicles
		.map((v) => {
			if (v.last_lat == null || v.last_lon == null) return "";
			const { x, y } = projectPoint(v.last_lat, v.last_lon, layout);
			const route = v.last_route_id ?? "?";
			const lineId = lineIdForRoute(route);
			const color =
				(lineId && gtfsColorByLine.get(lineId)) || lineColorForRoute(route);
			const lineTag = lineId ? (LINE_LABELS[lineId] ?? lineId) : route;
			return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
			<circle r="16" fill="${color}" stroke="#111" stroke-width="1.5"/>
			<text y="5" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" ${FONT}>${escapeXml(v.set_id)}</text>
			<rect x="-24" y="12" width="48" height="17" rx="4" fill="#ffffff" stroke="#333" stroke-width="1"/>
			<text y="24" text-anchor="middle" font-size="10" font-weight="700" fill="#111111" ${FONT}>${escapeXml(lineTag)}</text>
		</g>`;
		})
		.join("\n");

	const tracksSvg = tracks.map((t) => polylineSvg(t.points, layout, t.color)).join("\n");

	const when = formatAdelaideDateTime(opts.generatedAt);
	const trainWord = vehicles.length === 1 ? "train" : "trains";
	const footerMain = `${opts.title} · ${vehicles.length} ${trainWord} · ${when}`;

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">
  <rect width="100%" height="100%" fill="#ebe9e5"/>
  ${tileImages(layout)}
  ${tracksSvg}
  ${markersSvg}
  <rect x="0" y="${MAP_HEIGHT - FOOTER_H}" width="100%" height="${FOOTER_H}" fill="rgba(255,255,255,0.92)"/>
  <text x="12" y="${MAP_HEIGHT - 7}" font-size="11" font-weight="600" fill="#333" ${FONT}>${escapeXml(footerMain)}</text>
  <text x="${MAP_WIDTH - 8}" y="${MAP_HEIGHT - 7}" text-anchor="end" font-size="7" fill="#888" ${FONT}>© OSM</text>
</svg>`;
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}