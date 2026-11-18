import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const TILE_FETCH_MS = 12_000;
const TILE_FETCH_CONCURRENCY = 8;

async function resolveMapImages(resvg: Resvg): Promise<void> {
	const hrefs = resvg.imagesToResolve();
	for (let i = 0; i < hrefs.length; i += TILE_FETCH_CONCURRENCY) {
		const batch = hrefs.slice(i, i + TILE_FETCH_CONCURRENCY);
		await Promise.all(
			batch.map(async (href) => {
				try {
					const response = await fetch(href, {
						signal: AbortSignal.timeout(TILE_FETCH_MS),
						headers: { "User-Agent": "MetroMateBot/1.0 (fleet map)" },
					});
					if (!response.ok) return;
					const buffer = Buffer.from(await response.arrayBuffer());
					resvg.resolveImage(href, buffer);
				} catch {
					// Trains/paths still render if a tile fails.
				}
			}),
		);
	}
}

export async function fleetMapSvgToWebp(
	svg: string,
	opts?: { width?: number; quality?: number },
): Promise<Buffer> {
	const width = opts?.width ?? 1400;
	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: width },
		background: "#e8eef4",
		font: {
			loadSystemFonts: true,
			defaultFontFamily: "DejaVu Sans",
		},
	});
	await resolveMapImages(resvg);
	const rendered = resvg.render();
	const png = rendered.asPng();
	const webp = await sharp(png).webp({ quality: opts?.quality ?? 82 }).toBuffer();
	rendered.free?.();
	resvg.free?.();
	return webp;
}