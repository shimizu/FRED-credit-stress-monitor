const fs = require('fs');
const path = require('path');

const API_KEY = process.env.FRED_API_KEY;

if (!API_KEY) {
  console.error('FRED_API_KEY が設定されていません');
  process.exit(1);
}

const SERIES = {
  HY: 'BAMLH0A0HYM2',
  BB: 'BAMLH0A1HYBB',
  B: 'BAMLH0A2HYB',
  CCC: 'BAMLH0A3HYC',
  EMHY: 'BAMLEMHBHYCRPIOAS',
  TEDRATE: 'TEDRATE',
  CP3M: 'CP3M',
  DTB3: 'DTB3',
  SOFR: 'SOFR',
  STLFSI: 'STLFSI4'
};

async function fetchSeries(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${API_KEY}&file_type=json&sort_order=asc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${seriesId}`);

  const json = await res.json();
  return json.observations
    .filter(d => d.value !== '.')
    .map(d => ({ date: d.date, value: parseFloat(d.value) }));
}

async function main() {
  const series = {};

  for (const [key, id] of Object.entries(SERIES)) {
    console.log(`Fetching ${key} (${id})...`);
    series[key] = await fetchSeries(id);
    console.log(`  -> ${series[key].length} observations`);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    series
  };

  const outDir = path.join('public', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'fred.json'),
    JSON.stringify(output)
  );

  console.log('public/data/fred.json を更新しました');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
