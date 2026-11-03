#!/usr/bin/env node
/**
 * Dependency DP-5: get one real DONKI event for the replay.
 * Usage: NASA_API_KEY=xxxx node scripts/fetch-donki.mjs 2024-05-08 2024-05-14 > donki-raw.json
 * Then copy the FLR, CME, and SEP records you choose into src/data/replay-donki.json,
 * and set "day" and "hhmm" to the mission time for the demo.
 */
const [start, end] = process.argv.slice(2);
if (!start || !end) {
  console.error('Usage: node scripts/fetch-donki.mjs <startDate YYYY-MM-DD> <endDate YYYY-MM-DD>');
  process.exit(1);
}
const key = process.env.NASA_API_KEY || 'DEMO_KEY';
const out = {};
for (const t of ['FLR', 'CME', 'SEP']) {
  const r = await fetch(`https://api.nasa.gov/DONKI/${t}?startDate=${start}&endDate=${end}&api_key=${key}`);
  if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
  const txt = await r.text();
  out[t] = txt ? JSON.parse(txt) : [];
}
console.log(JSON.stringify(out, null, 2));
