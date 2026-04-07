// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const COLORS = {
  HY:   '#2eb8d4',
  BB:   '#34d27b',
  B:    '#e5a816',
  CCC:  '#e54d4d',
  EMHY: '#9b85f0',
  TEDRATE: '#e8853a',
  CP:      '#4b8ef5',
  SOFR:    '#34d27b',
  STLFSI:  '#9b85f0',
  BANK:    '#e8853a'
};

const LABELS = {
  HY:   'US HY (Total)',
  BB:   'BB',
  B:    'Single-B',
  CCC:  'CCC & Lower',
  EMHY: 'EM HY',
  TEDRATE: 'TED Spread',
  CP:      'CP Spread',
  SOFR:    'SOFR',
  STLFSI:  'StL FSI'
};

let allData = {};
let currentPeriod = '3y';
const parseDate = d3.timeParse('%Y-%m-%d');
const formatDate = d3.timeFormat('%Y-%m-%d');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════
async function startFetch() {
  try {
    const res = await fetch('./data/fred.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    Object.entries(json.series).forEach(([key, values]) => {
      allData[key] = values.map(d => ({ date: parseDate(d.date), value: d.value }));
    });
    document.getElementById('lastUpdate').textContent =
      `最終更新: ${json.lastUpdated.slice(0, 10)}`;
    renderAll();
  } catch (e) {
    console.error('データ読み込みエラー:', e.message);
    const logEl = document.getElementById('alertLog');
    logEl.innerHTML = `<div class="alert-item"><span class="alert-level alert-danger">エラー</span><span class="alert-msg">データの読み込みに失敗しました: ${e.message}</span></div>`;
    document.getElementById('overallLabel').textContent = 'ERROR';
  }
}

// ═══════════════════════════════════════════
// PERIOD FILTER
// ═══════════════════════════════════════════
function setPeriod(p, e) {
  currentPeriod = p;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  const target = e ? e.currentTarget : document.querySelector('.period-btn.active');
  if (target) {
    target.classList.add('active');
    target.setAttribute('aria-pressed', 'true');
  }
  if (Object.keys(allData).length) renderAll();
}

function filterByPeriod(data) {
  if (currentPeriod === 'all') return data;
  const years = { '1y': 1, '3y': 3, '5y': 5 };
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years[currentPeriod]);
  return data.filter(d => d.date >= cutoff);
}

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
function last(arr) { return arr[arr.length - 1]; }

function change20d(data) {
  if (data.length < 21) return null;
  // 直近値と20営業日前の差を%ptで求め、100倍してbpsに変換する。
  // 例: 4.20% -> 4.80% は 0.60%pt = 60bps。
  return (last(data).value - data[data.length - 21].value) * 100; // bps
}

function rollingChange(data, window = 20) {
  const result = [];
  for (let i = window; i < data.length; i++) {
    result.push({
      date: data[i].date,
      // 各日時点で「window日前から何bps動いたか」を系列化する。
      value: (data[i].value - data[i - window].value) * 100
    });
  }
  return result;
}

function spreadDiff(ccc, bb) {
  const bbMap = new Map(bb.map(d => [formatDate(d.date), d.value]));
  return ccc
    .filter(d => bbMap.has(formatDate(d.date)))
    // 同日のCCCとBBのOAS差。低格付けほど強く売られている局面で拡大しやすい。
    .map(d => ({ date: d.date, value: d.value - bbMap.get(formatDate(d.date)) }));
}

function rollingCorrelation(a, b, window = 30) {
  const bMap = new Map(b.map(d => [formatDate(d.date), d.value]));
  const aligned = a.filter(d => bMap.has(formatDate(d.date))).map(d => ({
    date: d.date, va: d.value, vb: bMap.get(formatDate(d.date))
  }));

  const result = [];
  for (let i = window; i < aligned.length; i++) {
    const slice = aligned.slice(i - window, i);
    // 30日窓の平均を引いて共分散・分散を作り、ピアソン相関係数を計算する。
    // +1に近いほど同方向に強く連動、0付近は無相関、-1に近いほど逆相関。
    const ma = d3.mean(slice, d => d.va);
    const mb = d3.mean(slice, d => d.vb);
    let num = 0, da = 0, db = 0;
    slice.forEach(d => {
      const a_ = d.va - ma, b_ = d.vb - mb;
      num += a_ * b_; da += a_ * a_; db += b_ * b_;
    });
    const corr = da && db ? num / Math.sqrt(da * db) : 0;
    result.push({ date: aligned[i].date, value: corr });
  }
  return result;
}

function rollingChangeCorrelation(a, b, changeWindow = 20, corrWindow = 30) {
  // 水準同士ではなく、一定期間の変化幅同士の連動をみる。
  return rollingCorrelation(rollingChange(a, changeWindow), rollingChange(b, changeWindow), corrWindow);
}

function latestWithin(series, targetDate, maxAgeDays) {
  let candidate = null;
  for (const point of series) {
    if (point.date > targetDate) break;
    candidate = point;
  }
  if (!candidate) return null;
  const ageDays = (targetDate - candidate.date) / MS_PER_DAY;
  return ageDays <= maxAgeDays ? candidate : null;
}

function sigma(data, lookbackDays = 252) {
  const recent = data.slice(-lookbackDays);
  const mean = d3.mean(recent, d => d.value);
  const std = d3.deviation(recent, d => d.value);
  const current = last(data).value;
  // 現在値が直近1年平均から何標準偏差ずれているかを測る。
  // 指標ごとの絶対水準ではなく、「その系列としてどれだけ異常か」を比較するために使う。
  return std ? (current - mean) / std : 0;
}

// ═══════════════════════════════════════════
// CHART HELPERS
// ═══════════════════════════════════════════
function createSVG(containerId, margin = { top: 10, right: 50, bottom: 30, left: 55 }) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const width = container.clientWidth;
  const height = container.clientHeight;
  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', width)
    .attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  return { svg, g, innerW, innerH, width, height, margin };
}

function addAxes(g, xScale, yScale, innerW, innerH, yFormat = '.1f', xTicks = 6) {
  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(xTicks).tickFormat(d3.timeFormat('%Y/%m')));

  g.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(yFormat)));

  g.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerW).tickFormat(''));
}

function addThresholdLine(g, yScale, innerW, value, label, color) {
  if (value < yScale.domain()[0] || value > yScale.domain()[1]) return;
  g.append('line')
    .attr('class', 'threshold-line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', yScale(value)).attr('y2', yScale(value))
    .attr('stroke', color);
  g.append('text')
    .attr('class', 'threshold-label')
    .attr('x', innerW + 4)
    .attr('y', yScale(value) + 3)
    .attr('fill', color)
    .text(label);
}

function addHoverOverlay(g, containerId, tooltipId, xScale, innerW, innerH, datasets, formatFn) {
  const container = document.getElementById(containerId);
  const tooltip = document.getElementById(tooltipId);
  if (!container || !tooltip) return;

  const overlay = g.append('rect')
    .attr('width', innerW).attr('height', innerH)
    .attr('fill', 'none')
    .attr('pointer-events', 'all')
    .style('cursor', 'crosshair');
  overlay.raise();

  const vLine = g.append('line')
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', 'rgba(255,255,255,0.15)')
    .attr('stroke-width', 1)
    .style('pointer-events', 'none')
    .style('display', 'none');

  overlay.on('mousemove', function (event) {
    const [mx] = d3.pointer(event);
    const date = xScale.invert(mx);
    vLine.attr('x1', mx).attr('x2', mx).style('display', null);

    let html = `<div class="tooltip-date">${d3.timeFormat('%Y-%m-%d')(date)}</div>`;
    html += formatFn(date);

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    const leftPadding = 12;
    const rightPadding = 12;
    const tooltipWidth = tooltip.offsetWidth || 180;
    const rect = container.getBoundingClientRect();
    let left = mx + 16;
    const maxLeft = rect.width - tooltipWidth - rightPadding;
    if (left > maxLeft) left = mx - tooltipWidth - 16;
    left = Math.max(leftPadding, left);

    tooltip.style.left = `${container.offsetLeft + left}px`;
    tooltip.style.top = `${container.offsetTop + 12}px`;
  });

  overlay.on('mouseleave', () => {
    vLine.style('display', 'none');
    tooltip.style.display = 'none';
  });
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
function renderAll() {
  renderMetrics();
  renderOASChart();
  renderSpreadChart();
  renderVelocityChart();
  renderEMChart();
  if (allData.TEDRATE) renderBankStress();
  renderAlerts();
  updateOverallSignal();
}

function renderMetrics() {
  const hy = allData.HY, bb = allData.BB, ccc = allData.CCC, emhy = allData.EMHY;

  // US HY OAS
  const hyVal = last(hy).value;
  const hyChg = change20d(hy);
  // HY全体のOAS水準で市場全体の信用プレミアムをざっくり判定する。
  // 5%超は警戒域、7%超は信用収縮がかなり進んだ局面として扱う。
  const hyColor = hyVal > 7 ? 'var(--red)' : hyVal > 5 ? 'var(--yellow)' : 'var(--cyan)';
  document.getElementById('mHY').textContent = hyVal.toFixed(2) + '%';
  document.getElementById('mHY').style.color = hyColor;
  if (hyChg !== null) {
    const cls = hyChg > 0 ? 'change-up' : 'change-down';
    document.getElementById('mHYchg').className = 'metric-change ' + cls;
    document.getElementById('mHYchg').textContent = `20d: ${hyChg > 0 ? '+' : ''}${hyChg.toFixed(0)}bps`;
  }

  // CCC-BB spread
  const diff = spreadDiff(ccc, bb);
  const spreadVal = last(diff).value;
  const spreadSig = sigma(diff);
  // CCC-BB差の拡大は「より弱い発行体だけが先に売られている」状態を示しやすい。
  // 水準そのものよりも、直近1年分布からの乖離度(σ)で異常値判定する。
  const spreadColor = spreadSig > 2 ? 'var(--red)' : spreadSig > 1 ? 'var(--yellow)' : 'var(--green)';
  document.getElementById('mSpread').textContent = spreadVal.toFixed(2) + '%';
  document.getElementById('mSpread').style.color = spreadColor;
  document.getElementById('mSpreadSigma').textContent = `σ: ${spreadSig.toFixed(2)} (1y)`;
  document.getElementById('mSpreadSigma').style.color = spreadColor;

  // CCC/BB velocity ratio
  const cccChg = change20d(ccc);
  const bbChg = change20d(bb);
  let ratio = '—', ratioColor = 'var(--text-muted)';
  if (cccChg !== null && bbChg !== null && bbChg !== 0) {
    // 低格付けCCCの拡大スピードがBBの何倍かを見る。
    // 絶対値で判定するのは、BBが縮小している局面でも「動きの非対称性」を拾いたいため。
    ratio = (cccChg / bbChg).toFixed(2) + 'x';
    const r = Math.abs(cccChg / bbChg);
    ratioColor = r > 3 ? 'var(--red)' : r > 2 ? 'var(--yellow)' : 'var(--green)';
  }
  document.getElementById('mRatio').textContent = ratio;
  document.getElementById('mRatio').style.color = ratioColor;

  // US-EM correlation
  const corrData = rollingChangeCorrelation(hy, emhy, 20, 30);
  if (corrData.length) {
    const corrVal = last(corrData).value;
    // 米国HYと新興国HYが同時に強く連動すると、ローカル要因ではなく
    // グローバルなリスクオフで広がっている可能性が高い。
    const corrColor = corrVal > 0.8 ? 'var(--red)' : corrVal > 0.6 ? 'var(--yellow)' : 'var(--green)';
    document.getElementById('mCorr').textContent = corrVal.toFixed(3);
    document.getElementById('mCorr').style.color = corrColor;
  }
}

function renderOASChart() {
  const keys = ['HY', 'BB', 'B', 'CCC'];
  const datasets = keys.map(k => ({ key: k, data: filterByPeriod(allData[k]) }));

  // Legend
  const legendEl = document.getElementById('legendMain');
  legendEl.innerHTML = keys.map(k =>
    `<div class="legend-item"><span class="legend-color" style="background:${COLORS[k]}"></span>${LABELS[k]}</div>`
  ).join('');

  const { g, innerW, innerH } = createSVG('chartOAS');
  const allDates = datasets.flatMap(d => d.data.map(v => v.date));
  const allVals = datasets.flatMap(d => d.data.map(v => v.value));

  const x = d3.scaleTime().domain(d3.extent(allDates)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, d3.max(allVals) * 1.1]).range([innerH, 0]);

  addAxes(g, x, y, innerW, innerH);
  addThresholdLine(g, y, innerW, 5, '注意', 'var(--yellow)');
  addThresholdLine(g, y, innerW, 7, '警戒', 'var(--red)');

  datasets.forEach(({ key, data }) => {
    const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', COLORS[key])
      .attr('stroke-width', key === 'HY' ? 2 : 1.2)
      .attr('opacity', key === 'HY' ? 1 : 0.7)
      .attr('d', line);
  });

  addHoverOverlay(g, 'chartOAS', 'tooltipOAS', x, innerW, innerH, datasets, (date) => {
    return keys.map(k => {
      const d = datasets.find(ds => ds.key === k).data;
      const closest = d.reduce((a, b) => Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a);
      return `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS[k]}">${LABELS[k]}</span><span>${closest.value.toFixed(2)}%</span></div>`;
    }).join('');
  });
}

function renderSpreadChart() {
  const diff = filterByPeriod(spreadDiff(allData.CCC, allData.BB));
  const { g, innerW, innerH } = createSVG('chartSpread');

  const x = d3.scaleTime().domain(d3.extent(diff, d => d.date)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, d3.max(diff, d => d.value) * 1.1]).range([innerH, 0]);

  addAxes(g, x, y, innerW, innerH);

  // 1y mean + 2σ
  const last252 = diff.slice(-252);
  const mean = d3.mean(last252, d => d.value);
  const std = d3.deviation(last252, d => d.value);
  if (mean && std) {
    // 直近1年の平均(μ)と+2σを引き、平常レンジからの上振れを可視化する。
    addThresholdLine(g, y, innerW, mean + 2 * std, '+2σ', 'var(--red)');
    addThresholdLine(g, y, innerW, mean, 'μ', 'var(--text-muted)');
  }

  const area = d3.area()
    .x(d => x(d.date))
    .y0(innerH)
    .y1(d => y(d.value))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(diff)
    .attr('fill', 'rgba(239, 68, 68, 0.08)')
    .attr('d', area);

  const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
  g.append('path')
    .datum(diff)
    .attr('fill', 'none')
    .attr('stroke', COLORS.CCC)
    .attr('stroke-width', 1.5)
    .attr('d', line);

  // Signal badge
  const sig = sigma(diff);
  const sigEl = document.getElementById('spreadSignal');
  if (sig > 2) { sigEl.className = 'card-signal signal-red'; sigEl.textContent = '警戒'; }
  else if (sig > 1) { sigEl.className = 'card-signal signal-yellow'; sigEl.textContent = '注意'; }
  else { sigEl.className = 'card-signal signal-green'; sigEl.textContent = '正常'; }

  addHoverOverlay(g, 'chartSpread', 'tooltipSpread', x, innerW, innerH, [diff], (date) => {
    const closest = diff.reduce((a, b) => Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a);
    return `<div class="tooltip-row"><span class="tooltip-label">CCC−BB</span><span>${closest.value.toFixed(2)}%</span></div>`;
  });
}

function renderVelocityChart() {
  const keys = ['HY', 'CCC', 'BB'];
  const datasets = keys.map(k => ({ key: k, data: filterByPeriod(rollingChange(allData[k])) }));

  const { g, innerW, innerH } = createSVG('chartVelocity');
  const allDates = datasets.flatMap(d => d.data.map(v => v.date));
  const allVals = datasets.flatMap(d => d.data.map(v => v.value));

  const x = d3.scaleTime().domain(d3.extent(allDates)).range([0, innerW]);
  const yMax = Math.max(d3.max(allVals), 100) * 1.1;
  const yMin = Math.min(d3.min(allVals), -50) * 1.1;
  const y = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

  addAxes(g, x, y, innerW, innerH, '.0f');
  addThresholdLine(g, y, innerW, 100, '+100', 'var(--red)');
  addThresholdLine(g, y, innerW, 0, '0', 'var(--text-muted)');

  datasets.forEach(({ key, data }) => {
    const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', COLORS[key])
      .attr('stroke-width', key === 'HY' ? 1.8 : 1.2)
      .attr('opacity', key === 'HY' ? 1 : 0.6)
      .attr('d', line);
  });

  // Signal
  const hyVel = last(datasets[0].data)?.value || 0;
  const velEl = document.getElementById('velocitySignal');
  // HY OASの20日変化が+100bpsを超えると、短期間のストレス増幅として強い警戒を出す。
  if (hyVel > 100) { velEl.className = 'card-signal signal-red'; velEl.textContent = '警戒'; }
  else if (hyVel > 50) { velEl.className = 'card-signal signal-yellow'; velEl.textContent = '注意'; }
  else { velEl.className = 'card-signal signal-green'; velEl.textContent = '正常'; }

  addHoverOverlay(g, 'chartVelocity', 'tooltipVelocity', x, innerW, innerH, datasets, (date) => {
    return keys.map(k => {
      const d = datasets.find(ds => ds.key === k).data;
      if (!d.length) return '';
      const closest = d.reduce((a, b) => Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a);
      return `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS[k]}">${LABELS[k]}</span><span>${closest.value.toFixed(0)}bps</span></div>`;
    }).join('');
  });
}

function renderEMChart() {
  const usData = filterByPeriod(allData.HY);
  const emData = filterByPeriod(allData.EMHY);

  const legendEl = document.getElementById('legendEM');
  legendEl.innerHTML = [
    `<div class="legend-item"><span class="legend-color" style="background:${COLORS.HY}"></span>米国HY</div>`,
    `<div class="legend-item"><span class="legend-color" style="background:${COLORS.EMHY}"></span>新興国HY</div>`,
  ].join('');

  const { g, innerW, innerH } = createSVG('chartEM');
  const allDates = [...usData, ...emData].map(d => d.date);
  const allVals = [...usData, ...emData].map(d => d.value);

  const x = d3.scaleTime().domain(d3.extent(allDates)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, d3.max(allVals) * 1.1]).range([innerH, 0]);

  addAxes(g, x, y, innerW, innerH);

  [{ data: usData, color: COLORS.HY, w: 2 }, { data: emData, color: COLORS.EMHY, w: 1.5 }].forEach(({ data, color, w }) => {
    const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
    g.append('path').datum(data).attr('fill', 'none').attr('stroke', color).attr('stroke-width', w).attr('d', line);
  });

  // Signal
  const corrData = rollingChangeCorrelation(allData.HY, allData.EMHY, 20, 30);
  const corrVal = corrData.length ? last(corrData).value : 0;
  const bothExpanding = change20d(allData.HY) > 0 && change20d(allData.EMHY) > 0;
  const emEl = document.getElementById('emSignal');
  // 相関が高いだけでなく、両系列とも拡大していることを条件にして
  // 「一緒に悪化している」局面だけを全面警戒にする。
  if (corrVal > 0.8 && bothExpanding) { emEl.className = 'card-signal signal-red'; emEl.textContent = '全面警戒'; }
  else if (corrVal > 0.6) { emEl.className = 'card-signal signal-yellow'; emEl.textContent = '注意'; }
  else { emEl.className = 'card-signal signal-green'; emEl.textContent = '正常'; }

  addHoverOverlay(g, 'chartEM', 'tooltipEM', x, innerW, innerH, [], (date) => {
    const closestUS = usData.reduce((a, b) => Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a);
    const closestEM = emData.reduce((a, b) => Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a);
    return `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS.HY}">米国HY</span><span>${closestUS.value.toFixed(2)}%</span></div>` +
      `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS.EMHY}">新興国HY</span><span>${closestEM.value.toFixed(2)}%</span></div>`;
  });
}

// ═══════════════════════════════════════════
// BANK STRESS INDEX
// ═══════════════════════════════════════════
function computeCPSpread(cp3m, dtb3) {
  const dtb3Map = new Map(dtb3.map(d => [formatDate(d.date), d.value]));
  return cp3m
    .filter(d => dtb3Map.has(formatDate(d.date)))
    // CP金利から3カ月T-Billを引いた短期資金調達プレミアム。
    // 銀行・企業の短期資金市場が詰まり始めると上がりやすい。
    .map(d => ({ date: d.date, value: d.value - dtb3Map.get(formatDate(d.date)) }));
}

function zscoreArray(data) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const history = data.slice(0, i + 1);
    const mean = d3.mean(history, d => d.value);
    const std = d3.deviation(history, d => d.value);
    // 将来データを使わず、その時点までの履歴だけで標準化する。
    result.push({
      date: data[i].date,
      value: std ? (data[i].value - mean) / std : 0
    });
  }
  return result;
}

function computeBankStressIndex() {
  const ted = allData.TEDRATE;
  const cp = computeCPSpread(allData.CP3M, allData.DTB3);
  const sofr = allData.SOFR;
  const stlfsi = allData.STLFSI;

  const zTED = zscoreArray(ted);
  const zCP = zscoreArray(cp);
  const zSOFR = zscoreArray(sofr);
  const zSTLFSI = zscoreArray(stlfsi);
  // TED、CPスプレッド、SOFR、水準化済みFSIを同じ土俵に乗せる。
  // それぞれ短期金融市場、資金調達環境、政策金利近辺の逼迫、金融環境全体の歪みを代表する。

  const maps = [
    new Map(zTED.map(d => [formatDate(d.date), d.value])),
    new Map(zCP.map(d => [formatDate(d.date), d.value])),
    new Map(zSOFR.map(d => [formatDate(d.date), d.value])),
    new Map(zSTLFSI.map(d => [formatDate(d.date), d.value]))
  ];

  const availability = [
    { raw: ted, maxAgeDays: 10 },
    { raw: cp, maxAgeDays: 40 },
    { raw: sofr, maxAgeDays: 10 },
    { raw: stlfsi, maxAgeDays: 10 }
  ];
  const allDates = [...new Set([
    ...zTED.map(d => formatDate(d.date)),
    ...zCP.map(d => formatDate(d.date)),
    ...zSOFR.map(d => formatDate(d.date)),
    ...zSTLFSI.map(d => formatDate(d.date))
  ])].sort();

  const result = [];
  for (const dateStr of allDates) {
    const date = parseDate(dateStr);
    const vals = maps
      .map((m, index) => {
        const activePoint = latestWithin(availability[index].raw, date, availability[index].maxAgeDays);
        return activePoint ? m.get(formatDate(activePoint.date)) : undefined;
      })
      .filter(v => v !== undefined);

    // 週次・月次系列は短期間だけ直近値を引き継ぎ、古すぎる系列は除外する。
    if (vals.length >= 2) {
      const bsi = d3.mean(vals);
      result.push({ date, value: bsi });
    }
  }
  return { bsi: result, components: { TEDRATE: zTED, CP: zCP, SOFR: zSOFR, STLFSI: zSTLFSI } };
}

function bankScoreLevel(score) {
  if (score >= 65) return { label: '危機', color: 'var(--red)', cls: 'signal-red' };
  if (score >= 55) return { label: '警戒', color: 'var(--yellow)', cls: 'signal-yellow' };
  if (score >= 45) return { label: '注意', color: 'var(--yellow)', cls: 'signal-yellow' };
  return { label: '正常', color: 'var(--green)', cls: 'signal-green' };
}

function renderBankStress() {
  const { bsi, components } = computeBankStressIndex();
  if (!bsi.length) return;

  const currentBSI = last(bsi).value;
  // 標準化平均の0を50点に置き、1σを10点としてスコア化する。
  // 直感的に読めるようにするための表示用変換で、相対比較の順位はBSI本体と同じ。
  const score = 50 + 10 * currentBSI;
  const level = bankScoreLevel(score);

  document.getElementById('mBankScore').textContent = score.toFixed(1);
  document.getElementById('mBankScore').style.color = level.color;
  document.getElementById('mBankLevel').textContent = level.label;
  document.getElementById('mBankLevel').style.color = level.color;

  const sigEl = document.getElementById('bankSignal');
  sigEl.className = 'card-signal ' + level.cls;
  sigEl.textContent = level.label;

  // コンポーネント値の表示
  const latestDate = last(bsi).date;
  const tedPoint = latestWithin(allData.TEDRATE, latestDate, 10);
  const cpData = computeCPSpread(allData.CP3M, allData.DTB3);
  const cpPoint = latestWithin(cpData, latestDate, 40);
  const sofrPoint = latestWithin(allData.SOFR, latestDate, 10);
  const stlfsiPoint = latestWithin(allData.STLFSI, latestDate, 10);

  document.getElementById('bcTED').textContent = tedPoint ? tedPoint.value.toFixed(2) : '—';
  document.getElementById('bcCP').textContent = cpPoint ? cpPoint.value.toFixed(2) : '—';
  document.getElementById('bcSOFR').textContent = sofrPoint ? sofrPoint.value.toFixed(2) : '—';
  document.getElementById('bcSTLFSI').textContent = stlfsiPoint ? stlfsiPoint.value.toFixed(2) : '—';

  // チャート描画: BSIスコア推移
  const filtered = filterByPeriod(bsi);
  const scoreData = filtered.map(d => ({ date: d.date, value: 50 + 10 * d.value }));

  const { g, innerW, innerH } = createSVG('chartBank');

  const x = d3.scaleTime().domain(d3.extent(scoreData, d => d.date)).range([0, innerW]);
  const yMin = Math.min(d3.min(scoreData, d => d.value), 30);
  const yMax = Math.max(d3.max(scoreData, d => d.value), 70);
  const y = d3.scaleLinear().domain([yMin, yMax * 1.05]).range([innerH, 0]);

  addAxes(g, x, y, innerW, innerH, '.0f', 3);
  addThresholdLine(g, y, innerW, 45, '注意', 'var(--yellow)');
  addThresholdLine(g, y, innerW, 55, '警戒', 'var(--yellow)');
  addThresholdLine(g, y, innerW, 65, '危機', 'var(--red)');
  addThresholdLine(g, y, innerW, 50, '基準', 'var(--text-muted)');

  // エリア（危機ゾーン）
  const areaAbove = d3.area()
    .x(d => x(d.date))
    .y0(d => y(Math.min(d.value, 55)))
    .y1(d => y(Math.max(d.value, 55)))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(scoreData.filter(d => d.value > 55))
    .attr('fill', 'rgba(239, 68, 68, 0.08)')
    .attr('d', areaAbove);

  const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
  g.append('path')
    .datum(scoreData)
    .attr('fill', 'none')
    .attr('stroke', COLORS.BANK)
    .attr('stroke-width', 2)
    .attr('d', line);

  addHoverOverlay(g, 'chartBank', 'tooltipBank', x, innerW, innerH, [scoreData], (date) => {
    const closest = scoreData.reduce((a, b) => Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a);
    const lvl = bankScoreLevel(closest.value);
    return `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS.BANK}">Score</span><span>${closest.value.toFixed(1)}</span></div>` +
      `<div class="tooltip-row"><span class="tooltip-label">判定</span><span style="color:${lvl.color}">${lvl.label}</span></div>`;
  });
}

function renderAlerts() {
  const alerts = [];
  const hy = allData.HY, bb = allData.BB, ccc = allData.CCC, emhy = allData.EMHY;
  const hyVal = last(hy).value;
  const hyChg = change20d(hy);
  const diff = spreadDiff(ccc, bb);
  const spreadSig = sigma(diff);
  const cccChg = change20d(ccc);
  const bbChg = change20d(bb);
  const corrData = rollingChangeCorrelation(hy, emhy, 20, 30);
  const corrVal = corrData.length ? last(corrData).value : 0;

  if (hyVal > 7) alerts.push({ level: 'danger', msg: `US HY OAS ${hyVal.toFixed(2)}% — 700bps超、信用収縮ゾーン` });
  else if (hyVal > 5) alerts.push({ level: 'warn', msg: `US HY OAS ${hyVal.toFixed(2)}% — 500bps超、警戒ゾーン` });
  else alerts.push({ level: 'ok', msg: `US HY OAS ${hyVal.toFixed(2)}% — 平常レンジ` });

  // 水準だけでなくスピードも見る。短期急拡大はイベントドリブンな悪化を示しやすい。
  if (hyChg !== null && hyChg > 100) alerts.push({ level: 'danger', msg: `20日変化 +${hyChg.toFixed(0)}bps — 急速な拡大` });
  else if (hyChg !== null && hyChg > 50) alerts.push({ level: 'warn', msg: `20日変化 +${hyChg.toFixed(0)}bps — 拡大傾向` });

  // CCC-BB差のσ判定で、信用市場の中で弱い銘柄だけが先に崩れる兆候を拾う。
  if (spreadSig > 2) alerts.push({ level: 'danger', msg: `CCC-BBスプレッド差 ${spreadSig.toFixed(2)}σ — 質への逃避が加速` });
  else if (spreadSig > 1) alerts.push({ level: 'warn', msg: `CCC-BBスプレッド差 ${spreadSig.toFixed(2)}σ — 信用差別化の兆候` });

  if (cccChg !== null && bbChg !== null && bbChg !== 0 && Math.abs(cccChg / bbChg) > 3) {
    alerts.push({ level: 'danger', msg: `CCC/BB変化率比 ${(cccChg / bbChg).toFixed(1)}x — パニック初期段階の可能性` });
  }

  if (corrVal > 0.8 && change20d(hy) > 0 && change20d(emhy) > 0) {
    alerts.push({ level: 'danger', msg: `US-EM相関 ${corrVal.toFixed(3)} かつ両方拡大中 — システミックリスク` });
  }

  // 銀行ストレス指数アラート
  if (allData.TEDRATE) {
    const { bsi } = computeBankStressIndex();
    if (bsi.length) {
      const bankScore = 50 + 10 * last(bsi).value;
      if (bankScore >= 65) alerts.push({ level: 'danger', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 危機水準` });
      else if (bankScore >= 55) alerts.push({ level: 'warn', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 警戒水準` });
      else if (bankScore >= 45) alerts.push({ level: 'warn', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 注意水準` });
      else alerts.push({ level: 'ok', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 正常` });
    }
  }

  if (!alerts.some(a => a.level === 'danger' || a.level === 'warn')) {
    alerts.push({ level: 'ok', msg: '全指標が平常レンジ内 — 信用市場は安定' });
  }

  const logEl = document.getElementById('alertLog');
  logEl.innerHTML = alerts.map(a => {
    const cls = a.level === 'danger' ? 'alert-danger' : a.level === 'warn' ? 'alert-warn' : 'alert-ok';
    const label = a.level === 'danger' ? '警戒' : a.level === 'warn' ? '注意' : '正常';
    return `<div class="alert-item"><span class="alert-level ${cls}">${label}</span><span class="alert-msg">${a.msg}</span></div>`;
  }).join('');
}

function updateOverallSignal() {
  const hy = allData.HY;
  const hyVal = last(hy).value;
  const hyChg = change20d(hy);
  const diff = spreadDiff(allData.CCC, allData.BB);
  const spreadSig = sigma(diff);

  let level = 'green';
  let label = '安定';

  let bankScore = 0;
  if (allData.TEDRATE) {
    const { bsi } = computeBankStressIndex();
    if (bsi.length) bankScore = 50 + 10 * last(bsi).value;
  }

  // 総合判定は複数指標のOR条件。HY全体、悪化速度、低格付け差、銀行ストレスの
  // どれかが閾値を超えたら段階的に色を引き上げる設計にしている。
  if (hyVal > 5 || (hyChg && hyChg > 50) || spreadSig > 1 || bankScore >= 45) { level = 'yellow'; label = '注意'; }
  if (hyVal > 7 || (hyChg && hyChg > 100) || spreadSig > 2 || bankScore >= 65) { level = 'red'; label = '警戒'; }

  const el = document.getElementById('overallSignal');
  el.className = `overall-signal signal-${level}`;
  document.getElementById('overallDot').className = `signal-dot dot-${level}`;
  document.getElementById('overallLabel').textContent = label;
}

// Resize handler
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (Object.keys(allData).length) renderAll(); }, 200);
});

// HTMLのonclick属性からアクセスできるようグローバルに公開
window.setPeriod = setPeriod;

// ページロード時に自動でデータ取得を開始
startFetch();
