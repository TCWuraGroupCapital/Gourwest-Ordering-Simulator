// Samples land from Natural Earth (world-atlas land-110m) on an even lat/lon grid and writes
// src/data/land-points.json as a flat [lat, lon, lat, lon, …] array for the hero globe.
// Run once after changing STEP: npm run globe:points
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

const STEP = 1.6; // degrees between dots at the equator
const topology = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-110m.json', import.meta.url), 'utf8'));
const land = feature(topology, topology.objects.land);

const polygons = land.features.flatMap((f) =>
  f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
);

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const isLand = (lon, lat) => polygons.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)));

const points = [];
for (let lat = -58; lat <= 82; lat += STEP) {
  const lonStep = STEP / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  for (let lon = -180; lon < 180; lon += lonStep) {
    if (isLand(lon, lat)) points.push(Math.round(lat * 10) / 10, Math.round(lon * 10) / 10);
  }
}

writeFileSync(new URL('../src/data/land-points.json', import.meta.url), JSON.stringify(points));
console.log(`Wrote ${points.length / 2} land points.`);
