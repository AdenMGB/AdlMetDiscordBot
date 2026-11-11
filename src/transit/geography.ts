const EARTH_R = 6_371_000;

export function haversineM(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const rlat1 = (lat1 * Math.PI) / 180;
	const rlat2 = (lat2 * Math.PI) / 180;
	const dlat = ((lat2 - lat1) * Math.PI) / 180;
	const dlon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dlat / 2) ** 2 +
		Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2;
	return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

export function pointToSegmentMeters(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const latScale = Math.cos(((ay + by) / 2) * (Math.PI / 180));
	const mx = (px - ax) * latScale * 111_320;
	const my = (py - ay) * 110_540;
	const vx = (bx - ax) * latScale * 111_320;
	const vy = (by - ay) * 110_540;
	const len2 = vx * vx + vy * vy;
	if (len2 === 0) return Math.hypot(mx, my);
	let t = (mx * vx + my * vy) / len2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(mx - t * vx, my - t * vy);
}

export type LatLon = { lat: number; lon: number; name: string; stopId: string };

export function locateBetweenStops(
	lat: number,
	lon: number,
	stops: LatLon[],
): { from: LatLon; to: LatLon; atStation: boolean } | null {
	if (stops.length < 2) return null;

	let bestDist = Infinity;
	let bestIdx = 0;
	for (let i = 0; i < stops.length - 1; i++) {
		const d = pointToSegmentMeters(
			lon,
			lat,
			stops[i].lon,
			stops[i].lat,
			stops[i + 1].lon,
			stops[i + 1].lat,
		);
		if (d < bestDist) {
			bestDist = d;
			bestIdx = i;
		}
	}

	const from = stops[bestIdx];
	const to = stops[bestIdx + 1];
	const nearFrom = haversineM(lat, lon, from.lat, from.lon);
	const nearTo = haversineM(lat, lon, to.lat, to.lon);
	const atStation = nearFrom < 120 || nearTo < 120;
	return { from, to, atStation };
}
