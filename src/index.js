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

// fred.jsonに含まれるべき系列。欠けていても描画は続行し、空配列で埋める。
const SERIES_KEYS = ['HY', 'BB', 'B', 'CCC', 'EMHY', 'TEDRATE', 'CP3M', 'DTB3', 'SOFR', 'STLFSI'];

// これらが欠けるとメトリクス・アラート・総合シグナルが成立しないため、
// 揃っていない場合は描画せずエラー表示へ倒す。
const REQUIRED_SERIES = ['HY', 'BB', 'CCC', 'EMHY'];

// 20営業日変化の算出に最低21点必要。それ未満の系列は必須要件を満たさないとみなす。
const MIN_POINTS = 21;

let allData = {};
let currentPeriod = '3y';
let bankStressCache = null;
const seriesTimeCache = new WeakMap();
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
// 有限な数値だけを通す。null・空文字・真偽値をNumber()に渡すと0になってしまい、
// 欠測が「0」という実データとして紛れ込むため、型を絞ってから変換する。
function toFiniteNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

// 1系列を{date: Date, value: number}へ正規化する。
// 日付としてパースできない点、数値でない点、無限大・NaNは黙って捨てる。
// FRED側の欠測は "." で返るため、そのまま数値化すると系列全体が壊れる。
function normalizeSeries(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(d => {
      if (!d || typeof d !== 'object') return null;
      const date = typeof d.date === 'string' ? parseDate(d.date) : null;
      const value = toFiniteNumber(d.value);
      if (!date || value === null) return null;
      return { date, value };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}

// 必須系列が揃っているかを検証し、不足していれば理由を返す。
function validateData(data) {
  const missing = REQUIRED_SERIES.filter(k => !data[k] || !data[k].length);
  if (missing.length) return `必須系列が取得できません: ${missing.join(', ')}`;

  const tooShort = REQUIRED_SERIES.filter(k => data[k].length < MIN_POINTS);
  if (tooShort.length) {
    return `データ件数が不足しています（各${MIN_POINTS}件必要）: ${tooShort.join(', ')}`;
  }
  return null;
}

function showDataError(message) {
  console.error('データ読み込みエラー:', message);
  const logEl = document.getElementById('alertLog');
  logEl.innerHTML = `<div class="alert-item"><span class="alert-level alert-danger">エラー</span><span class="alert-msg">${message}</span></div>`;
  document.getElementById('overallLabel').textContent = 'ERROR';
  ['chartOAS', 'chartSpread', 'chartVelocity', 'chartEM', 'chartBank']
    .forEach(id => renderEmptyState(id, 'データを表示できません'));
}

async function startFetch() {
  try {
    const res = await fetch('./data/fred.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (!json || typeof json !== 'object' || !json.series || typeof json.series !== 'object') {
      throw new Error('fred.jsonの形式が不正です（series が見つかりません）');
    }

    // 未知のキーが増えても拾えるよう、既知キーとJSON側のキーの和集合で正規化する。
    const keys = [...new Set([...SERIES_KEYS, ...Object.keys(json.series)])];
    const parsed = {};
    keys.forEach(key => { parsed[key] = normalizeSeries(json.series[key]); });

    const invalid = validateData(parsed);
    if (invalid) throw new Error(invalid);

    allData = parsed;
    bankStressCache = null;

    const lastUpdated = typeof json.lastUpdated === 'string' ? json.lastUpdated.slice(0, 10) : '不明';
    document.getElementById('lastUpdate').textContent = `最終更新: ${lastUpdated}`;
    renderAll();
  } catch (e) {
    showDataError(`データの読み込みに失敗しました: ${e.message}`);
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
  if (!Array.isArray(data)) return [];
  if (currentPeriod === 'all') return data;
  const years = { '1y': 1, '3y': 3, '5y': 5 };
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years[currentPeriod]);
  return data.filter(d => d.date >= cutoff);
}

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
// 空・未定義でも例外にせずnullを返す。呼び出し側は必ずnull判定すること。
function last(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

// ツールチップ用に指定日時へ最も近い点を返す。
// reduce()を初期値なしで空配列に使うとTypeErrorになるため、その回避も兼ねる。
function nearest(data, date) {
  if (!Array.isArray(data) || !data.length) return null;
  return data.reduce((a, b) => (Math.abs(b.date - date) < Math.abs(a.date - date) ? b : a));
}

function change20d(data) {
  if (!Array.isArray(data) || data.length < 21) return null;
  // 直近値と20営業日前の差を%ptで求め、100倍してbpsに変換する。
  // 例: 4.20% -> 4.80% は 0.60%pt = 60bps。
  return (last(data).value - data[data.length - 21].value) * 100; // bps
}

function rollingChange(data, window = 20) {
  if (!Array.isArray(data)) return [];
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
  if (!Array.isArray(ccc) || !Array.isArray(bb)) return [];
  const bbMap = new Map(bb.map(d => [formatDate(d.date), d.value]));
  return ccc
    .filter(d => bbMap.has(formatDate(d.date)))
    // 同日のCCCとBBのOAS差。低格付けほど強く売られている局面で拡大しやすい。
    .map(d => ({ date: d.date, value: d.value - bbMap.get(formatDate(d.date)) }));
}

function rollingCorrelation(a, b, window = 30) {
  if (!Array.isArray(a) || !Array.isArray(b)) return [];
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
  if (!Array.isArray(series) || !series.length) return null;
  let times = seriesTimeCache.get(series);
  if (!times) {
    times = series.map(point => point.date.getTime());
    seriesTimeCache.set(series, times);
  }

  const targetTime = targetDate.getTime();
  let lo = 0;
  let hi = times.length - 1;
  let candidateIndex = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] <= targetTime) {
      candidateIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (candidateIndex === -1) return null;
  const candidate = series[candidateIndex];
  const ageDays = (targetDate - candidate.date) / MS_PER_DAY;
  return ageDays <= maxAgeDays ? candidate : null;
}

function alignSeriesValues(series, targetDates, maxAgeDays) {
  const result = [];
  let index = 0;
  let latest = null;

  for (const targetDate of targetDates) {
    while (index < series.length && series[index].date <= targetDate) {
      latest = series[index];
      index += 1;
    }

    if (!latest) {
      result.push(undefined);
      continue;
    }

    const ageDays = (targetDate - latest.date) / MS_PER_DAY;
    result.push(ageDays <= maxAgeDays ? latest.value : undefined);
  }

  return result;
}

function sigma(data, lookbackDays = 252) {
  const current = last(data);
  if (!current) return null;
  const recent = data.slice(-lookbackDays);
  const mean = d3.mean(recent, d => d.value);
  const std = d3.deviation(recent, d => d.value);
  // 現在値が直近1年平均から何標準偏差ずれているかを測る。
  // 指標ごとの絶対水準ではなく、「その系列としてどれだけ異常か」を比較するために使う。
  return std ? (current.value - mean) / std : 0;
}

// ═══════════════════════════════════════════
// CHART HELPERS
// ═══════════════════════════════════════════
// 描画に必要なデータが無いチャートを、例外や空のSVGではなく明示的な文言で埋める。
function renderEmptyState(containerId, message = 'データがありません') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<div class="chart-empty">${message}</div>`;
}

// カード右上のシグナルバッジ。signalがnullならデータなしとして中立表示にする。
function setCardSignal(id, signal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = signal ? `card-signal ${signal.cls}` : 'card-signal signal-none';
  el.textContent = signal ? signal.label : '—';
}

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
  renderBankStress();
  renderAlerts();
  updateOverallSignal();
}

function setMetric(id, text, color = 'var(--text-muted)') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function renderMetrics() {
  const hy = allData.HY, bb = allData.BB, ccc = allData.CCC, emhy = allData.EMHY;

  // US HY OAS
  const hyLast = last(hy);
  const hyChg = change20d(hy);
  if (hyLast) {
    // HY全体のOAS水準で市場全体の信用プレミアムをざっくり判定する。
    // 5%超は警戒域、7%超は信用収縮がかなり進んだ局面として扱う。
    const hyVal = hyLast.value;
    const hyColor = hyVal > 7 ? 'var(--red)' : hyVal > 5 ? 'var(--yellow)' : 'var(--cyan)';
    setMetric('mHY', hyVal.toFixed(2) + '%', hyColor);
  } else {
    setMetric('mHY', '—');
  }
  if (hyChg !== null) {
    const cls = hyChg > 0 ? 'change-up' : 'change-down';
    document.getElementById('mHYchg').className = 'metric-change ' + cls;
    document.getElementById('mHYchg').textContent = `20d: ${hyChg > 0 ? '+' : ''}${hyChg.toFixed(0)}bps`;
  } else {
    document.getElementById('mHYchg').className = 'metric-change';
    document.getElementById('mHYchg').textContent = '20d: —';
  }

  // CCC-BB spread
  const diff = spreadDiff(ccc, bb);
  const spreadLast = last(diff);
  const spreadSig = sigma(diff);
  if (spreadLast && spreadSig !== null) {
    // CCC-BB差の拡大は「より弱い発行体だけが先に売られている」状態を示しやすい。
    // 水準そのものよりも、直近1年分布からの乖離度(σ)で異常値判定する。
    const spreadColor = spreadSig > 2 ? 'var(--red)' : spreadSig > 1 ? 'var(--yellow)' : 'var(--green)';
    setMetric('mSpread', spreadLast.value.toFixed(2) + '%', spreadColor);
    setMetric('mSpreadSigma', `σ: ${spreadSig.toFixed(2)} (1y)`, spreadColor);
  } else {
    setMetric('mSpread', '—');
    setMetric('mSpreadSigma', 'σ: — (1y)');
  }

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
  setMetric('mRatio', ratio, ratioColor);

  // US-EM correlation
  const corrLast = last(rollingChangeCorrelation(hy, emhy, 20, 30));
  if (corrLast) {
    const corrVal = corrLast.value;
    // 米国HYと新興国HYが同時に強く連動すると、ローカル要因ではなく
    // グローバルなリスクオフで広がっている可能性が高い。
    const corrColor = corrVal > 0.8 ? 'var(--red)' : corrVal > 0.6 ? 'var(--yellow)' : 'var(--green)';
    setMetric('mCorr', corrVal.toFixed(3), corrColor);
  } else {
    setMetric('mCorr', '—');
  }

  const bsiLast = last(getBankStressIndex().bsi);
  if (bsiLast) {
    const bankScore = 50 + 10 * bsiLast.value;
    const bankLevel = bankScoreLevel(bankScore);
    setMetric('mBankScore', bankScore.toFixed(1), bankLevel.color);
    setMetric('mBankLevel', bankLevel.label, bankLevel.color);
  } else {
    setMetric('mBankScore', '—');
    setMetric('mBankLevel', '—');
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

  const allDates = datasets.flatMap(d => d.data.map(v => v.date));
  const allVals = datasets.flatMap(d => d.data.map(v => v.value));
  // 期間フィルタ後に1点も残らないとd3.extent/d3.maxがundefinedを返し、
  // スケールのdomainがNaNになって無音で壊れる。先に空状態へ倒す。
  if (!allDates.length) {
    renderEmptyState('chartOAS');
    return;
  }

  const { g, innerW, innerH } = createSVG('chartOAS');
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
      const closest = nearest(datasets.find(ds => ds.key === k).data, date);
      if (!closest) return '';
      return `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS[k]}">${LABELS[k]}</span><span>${closest.value.toFixed(2)}%</span></div>`;
    }).join('');
  });
}

function renderSpreadChart() {
  const diff = filterByPeriod(spreadDiff(allData.CCC, allData.BB));
  if (!diff.length) {
    renderEmptyState('chartSpread');
    setCardSignal('spreadSignal', null);
    return;
  }

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
  if (sig === null) setCardSignal('spreadSignal', null);
  else if (sig > 2) setCardSignal('spreadSignal', { cls: 'signal-red', label: '警戒' });
  else if (sig > 1) setCardSignal('spreadSignal', { cls: 'signal-yellow', label: '注意' });
  else setCardSignal('spreadSignal', { cls: 'signal-green', label: '正常' });

  addHoverOverlay(g, 'chartSpread', 'tooltipSpread', x, innerW, innerH, [diff], (date) => {
    const closest = nearest(diff, date);
    if (!closest) return '';
    return `<div class="tooltip-row"><span class="tooltip-label">CCC−BB</span><span>${closest.value.toFixed(2)}%</span></div>`;
  });
}

function renderVelocityChart() {
  const keys = ['HY', 'CCC', 'BB'];
  const datasets = keys.map(k => ({ key: k, data: filterByPeriod(rollingChange(allData[k])) }));

  const allDates = datasets.flatMap(d => d.data.map(v => v.date));
  const allVals = datasets.flatMap(d => d.data.map(v => v.value));
  if (!allDates.length) {
    renderEmptyState('chartVelocity');
    setCardSignal('velocitySignal', null);
    return;
  }

  const { g, innerW, innerH } = createSVG('chartVelocity');
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
  const hyVelPoint = last(datasets[0].data);
  // HY OASの20日変化が+100bpsを超えると、短期間のストレス増幅として強い警戒を出す。
  if (!hyVelPoint) setCardSignal('velocitySignal', null);
  else if (hyVelPoint.value > 100) setCardSignal('velocitySignal', { cls: 'signal-red', label: '警戒' });
  else if (hyVelPoint.value > 50) setCardSignal('velocitySignal', { cls: 'signal-yellow', label: '注意' });
  else setCardSignal('velocitySignal', { cls: 'signal-green', label: '正常' });

  addHoverOverlay(g, 'chartVelocity', 'tooltipVelocity', x, innerW, innerH, datasets, (date) => {
    return keys.map(k => {
      const closest = nearest(datasets.find(ds => ds.key === k).data, date);
      if (!closest) return '';
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

  const allDates = [...usData, ...emData].map(d => d.date);
  const allVals = [...usData, ...emData].map(d => d.value);
  if (!allDates.length) {
    renderEmptyState('chartEM');
    setCardSignal('emSignal', null);
    return;
  }

  const { g, innerW, innerH } = createSVG('chartEM');
  const x = d3.scaleTime().domain(d3.extent(allDates)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, d3.max(allVals) * 1.1]).range([innerH, 0]);

  addAxes(g, x, y, innerW, innerH);

  [{ data: usData, color: COLORS.HY, w: 2 }, { data: emData, color: COLORS.EMHY, w: 1.5 }].forEach(({ data, color, w }) => {
    const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
    g.append('path').datum(data).attr('fill', 'none').attr('stroke', color).attr('stroke-width', w).attr('d', line);
  });

  // Signal
  const corrPoint = last(rollingChangeCorrelation(allData.HY, allData.EMHY, 20, 30));
  const corrVal = corrPoint ? corrPoint.value : 0;
  const bothExpanding = change20d(allData.HY) > 0 && change20d(allData.EMHY) > 0;
  // 相関が高いだけでなく、両系列とも拡大していることを条件にして
  // 「一緒に悪化している」局面だけを全面警戒にする。
  if (!corrPoint) setCardSignal('emSignal', null);
  else if (corrVal > 0.8 && bothExpanding) setCardSignal('emSignal', { cls: 'signal-red', label: '全面警戒' });
  else if (corrVal > 0.6) setCardSignal('emSignal', { cls: 'signal-yellow', label: '注意' });
  else setCardSignal('emSignal', { cls: 'signal-green', label: '正常' });

  addHoverOverlay(g, 'chartEM', 'tooltipEM', x, innerW, innerH, [], (date) => {
    const closestUS = nearest(usData, date);
    const closestEM = nearest(emData, date);
    const rows = [];
    if (closestUS) rows.push(`<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS.HY}">米国HY</span><span>${closestUS.value.toFixed(2)}%</span></div>`);
    if (closestEM) rows.push(`<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS.EMHY}">新興国HY</span><span>${closestEM.value.toFixed(2)}%</span></div>`);
    return rows.join('');
  });
}

// ═══════════════════════════════════════════
// BANK STRESS INDEX
// ═══════════════════════════════════════════
function computeCPSpread(cp3m, dtb3) {
  if (!Array.isArray(cp3m) || !Array.isArray(dtb3)) return [];
  const dtb3Map = new Map(dtb3.map(d => [formatDate(d.date), d.value]));
  return cp3m
    .filter(d => dtb3Map.has(formatDate(d.date)))
    .map(d => ({ date: d.date, value: d.value - dtb3Map.get(formatDate(d.date)) }));
}

function zscoreArray(data) {
  if (!Array.isArray(data)) return [];
  const result = [];
  let count = 0;
  let sum = 0;
  let sumSq = 0;

  for (const point of data) {
    count += 1;
    sum += point.value;
    sumSq += point.value * point.value;

    const mean = sum / count;
    const variance = count > 1 ? (sumSq - (sum * sum) / count) / (count - 1) : 0;
    const std = variance > 0 ? Math.sqrt(variance) : 0;

    result.push({
      date: point.date,
      value: std ? (point.value - mean) / std : 0
    });
  }

  return result;
}

function computeBankStressIndex() {
  const ted = allData.TEDRATE || [];
  const cp = computeCPSpread(allData.CP3M || [], allData.DTB3 || []);
  const sofr = allData.SOFR || [];
  const stlfsi = allData.STLFSI || [];

  const zTED = zscoreArray(ted);
  const zCP = zscoreArray(cp);
  const zSOFR = zscoreArray(sofr);
  const zSTLFSI = zscoreArray(stlfsi);

  const allDates = [...new Set([
    ...zTED.map(d => d.date.getTime()),
    ...zCP.map(d => d.date.getTime()),
    ...zSOFR.map(d => d.date.getTime()),
    ...zSTLFSI.map(d => d.date.getTime())
  ])]
    .sort((a, b) => a - b)
    .map(ts => new Date(ts));

  const alignedValues = [
    alignSeriesValues(zTED, allDates, 10),
    alignSeriesValues(zCP, allDates, 40),
    alignSeriesValues(zSOFR, allDates, 10),
    alignSeriesValues(zSTLFSI, allDates, 10)
  ];

  const bsi = [];
  for (let i = 0; i < allDates.length; i++) {
    const vals = alignedValues
      .map(values => values[i])
      .filter(v => v !== undefined);

    if (vals.length >= 2) {
      bsi.push({ date: allDates[i], value: d3.mean(vals) });
    }
  }

  return {
    bsi,
    components: { TEDRATE: zTED, CP: zCP, SOFR: zSOFR, STLFSI: zSTLFSI }
  };
}

function getBankStressIndex() {
  if (!bankStressCache) bankStressCache = computeBankStressIndex();
  return bankStressCache;
}

function bankScoreLevel(score) {
  if (score >= 65) return { label: '危機', color: 'var(--red)', cls: 'signal-red' };
  if (score >= 55) return { label: '警戒', color: 'var(--yellow)', cls: 'signal-yellow' };
  if (score >= 45) return { label: '注意', color: 'var(--yellow)', cls: 'signal-yellow' };
  return { label: '正常', color: 'var(--green)', cls: 'signal-green' };
}

function renderBankStress() {
  const { bsi } = getBankStressIndex();
  const latest = last(bsi);
  if (!latest) {
    // 構成系列が1本以下しか無い場合はBSI自体が作れない。
    document.getElementById('bcSOFR').textContent = '—';
    document.getElementById('bcSTLFSI').textContent = '—';
    setCardSignal('bankSignal', null);
    renderEmptyState('chartBank');
    return;
  }

  const score = 50 + 10 * latest.value;
  const level = bankScoreLevel(score);

  setMetric('mBankScore', score.toFixed(1), level.color);
  setMetric('mBankLevel', level.label, level.color);
  setCardSignal('bankSignal', level);

  const sofrPoint = latestWithin(allData.SOFR, latest.date, 10);
  const stlfsiPoint = latestWithin(allData.STLFSI, latest.date, 10);
  document.getElementById('bcSOFR').textContent = sofrPoint ? sofrPoint.value.toFixed(2) : '—';
  document.getElementById('bcSTLFSI').textContent = stlfsiPoint ? stlfsiPoint.value.toFixed(2) : '—';

  const scoreData = filterByPeriod(bsi).map(d => ({ date: d.date, value: 50 + 10 * d.value }));
  if (!scoreData.length) {
    renderEmptyState('chartBank', '選択期間にデータがありません');
    return;
  }

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
    const closest = nearest(scoreData, date);
    if (!closest) return '';
    const lvl = bankScoreLevel(closest.value);
    return `<div class="tooltip-row"><span class="tooltip-label" style="color:${COLORS.BANK}">Score</span><span>${closest.value.toFixed(1)}</span></div>` +
      `<div class="tooltip-row"><span class="tooltip-label">判定</span><span style="color:${lvl.color}">${lvl.label}</span></div>`;
  });
}

function renderAlerts() {
  const alerts = [];
  const hy = allData.HY, bb = allData.BB, ccc = allData.CCC, emhy = allData.EMHY;
  const hyLast = last(hy);
  const hyChg = change20d(hy);
  const diff = spreadDiff(ccc, bb);
  const spreadSig = sigma(diff);
  const cccChg = change20d(ccc);
  const bbChg = change20d(bb);
  const corrPoint = last(rollingChangeCorrelation(hy, emhy, 20, 30));
  const corrVal = corrPoint ? corrPoint.value : 0;

  if (!hyLast) {
    alerts.push({ level: 'danger', msg: 'US HY OASのデータが取得できていません' });
  } else {
    const hyVal = hyLast.value;
    if (hyVal > 7) alerts.push({ level: 'danger', msg: `US HY OAS ${hyVal.toFixed(2)}% — 700bps超、信用収縮ゾーン` });
    else if (hyVal > 5) alerts.push({ level: 'warn', msg: `US HY OAS ${hyVal.toFixed(2)}% — 500bps超、警戒ゾーン` });
    else alerts.push({ level: 'ok', msg: `US HY OAS ${hyVal.toFixed(2)}% — 平常レンジ` });
  }

  // 水準だけでなくスピードも見る。短期急拡大はイベントドリブンな悪化を示しやすい。
  if (hyChg !== null && hyChg > 100) alerts.push({ level: 'danger', msg: `20日変化 +${hyChg.toFixed(0)}bps — 急速な拡大` });
  else if (hyChg !== null && hyChg > 50) alerts.push({ level: 'warn', msg: `20日変化 +${hyChg.toFixed(0)}bps — 拡大傾向` });

  // CCC-BB差のσ判定で、信用市場の中で弱い銘柄だけが先に崩れる兆候を拾う。
  if (spreadSig !== null && spreadSig > 2) alerts.push({ level: 'danger', msg: `CCC-BBスプレッド差 ${spreadSig.toFixed(2)}σ — 質への逃避が加速` });
  else if (spreadSig !== null && spreadSig > 1) alerts.push({ level: 'warn', msg: `CCC-BBスプレッド差 ${spreadSig.toFixed(2)}σ — 信用差別化の兆候` });

  if (cccChg !== null && bbChg !== null && bbChg !== 0 && Math.abs(cccChg / bbChg) > 3) {
    alerts.push({ level: 'danger', msg: `CCC/BB変化率比 ${(cccChg / bbChg).toFixed(1)}x — パニック初期段階の可能性` });
  }

  if (corrVal > 0.8 && change20d(hy) > 0 && change20d(emhy) > 0) {
    alerts.push({ level: 'danger', msg: `US-EM相関 ${corrVal.toFixed(3)} かつ両方拡大中 — システミックリスク` });
  }

  const bsiLast = last(getBankStressIndex().bsi);
  if (bsiLast) {
    const bankScore = 50 + 10 * bsiLast.value;
    if (bankScore >= 65) alerts.push({ level: 'danger', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 危機水準` });
    else if (bankScore >= 55) alerts.push({ level: 'warn', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 警戒水準` });
    else if (bankScore >= 45) alerts.push({ level: 'warn', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 注意水準` });
    else alerts.push({ level: 'ok', msg: `銀行ストレス指数 ${bankScore.toFixed(1)} — 正常` });
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
  const hyLast = last(hy);
  const hyChg = change20d(hy);
  const spreadSig = sigma(spreadDiff(allData.CCC, allData.BB));

  const el = document.getElementById('overallSignal');
  if (!hyLast) {
    el.className = 'overall-signal signal-none';
    document.getElementById('overallDot').className = 'signal-dot dot-none';
    document.getElementById('overallLabel').textContent = 'データなし';
    return;
  }

  let level = 'green';
  let label = '安定';

  const bsiLast = last(getBankStressIndex().bsi);
  const bankScore = bsiLast ? 50 + 10 * bsiLast.value : 0;
  const hyVal = hyLast.value;

  // 総合判定は複数指標のOR条件。HY全体、悪化速度、低格付け差、銀行ストレスの
  // どれかが閾値を超えたら段階的に色を引き上げる設計にしている。
  if (hyVal > 5 || (hyChg && hyChg > 50) || spreadSig > 1 || bankScore >= 45) { level = 'yellow'; label = '注意'; }
  if (hyVal > 7 || (hyChg && hyChg > 100) || spreadSig > 2 || bankScore >= 65) { level = 'red'; label = '警戒'; }

  el.className = `overall-signal signal-${level}`;
  document.getElementById('overallDot').className = `signal-dot dot-${level}`;
  document.getElementById('overallLabel').textContent = label;
}

// ═══════════════════════════════════════════
// GUIDE DIALOG (解説)
// ═══════════════════════════════════════════
// 各カードの「?」ボタンから開く解説。docs/credit_stress_monitor_guid.md の
// 内容を指標ごとに要約したもの。閾値やロジックを変えたら両方更新すること。
const GUIDES = {
  overview: {
    title: 'このダッシュボードの読み方',
    body: `
      <p><strong>「世の中のお金の貸し借りがヤバくなりそうかどうか」を監視する画面</strong>です。経済危機の前には「お金を貸している人たちの不安」が先に数字へ表れます。それをリアルタイムで可視化しています。</p>
      <p><strong>スプレッドとは</strong>：信用が低い企業の金利と、最も安全な金利（米国債）の差。スプレッドの拡大は「お金を貸すのが怖い」と感じる人が増えていることを意味します。</p>
      <p><strong>アラートログ</strong>：すべての指標を自動判定し、<span style="color:var(--green)">正常</span> / <span style="color:var(--yellow)">注意</span> / <span style="color:var(--red)">警戒</span> の3段階で表示します。</p>
      <div class="guide-note">右上の総合バッジの判定にはHY水準・20日変化・CCC-BBスプレッド差・銀行Scoreの4つだけが使われ、CCC/BB変化率比とUS-EM相関は含まれません。アラートログに赤い「警戒」があってもバッジが「安定」になる場合があります（既知の問題として修正予定）。バッジだけでなくアラートログも確認してください。</div>
    `
  },
  oas: {
    title: '米国HY OAS',
    body: `
      <p>「HY」はHigh Yield（ハイイールド）の略で、信用が低い企業の債券のこと。OASはその上乗せ金利（スプレッド）で、<strong>市場全体の信用プレミアム</strong>を示します。</p>
      <ul>
        <li><span style="color:var(--green)">5%以下</span>：平常レンジ（歴史的には3%前後が安心の目安）</li>
        <li><span style="color:var(--yellow)">5%超え</span>：注意</li>
        <li><span style="color:var(--red)">7%超え</span>：警戒（信用収縮ゾーン）</li>
      </ul>
      <p>「20d」は20営業日（約1ヶ月）前からの変化。<strong>+50bps超で注意、+100bps超で警戒</strong>です。</p>
      <p><strong>チャートの見方</strong>：線と線の間隔が一定なら市場は落ち着いています。CCC（赤）だけが上へ離れていったら「弱い企業から信用が剥がれ始めている」サイン。点線は注意ライン（5%）と警戒ライン（7%）です。</p>
      <div class="guide-note">データ提供元（FRED）の仕様変更により、OAS系列は直近約3年分しか取得できません。「5年」「全期間」を選んでも約3年分しか表示されません。</div>
    `
  },
  spread: {
    title: 'CCC-BBスプレッド差',
    body: `
      <p>「かなり危ない企業（CCC）」と「まあまあの企業（BB）」の金利差です。急に広がると<strong>市場が一番弱いところから見捨て始めている</strong>ことを意味します。</p>
      <ul>
        <li><span style="color:var(--yellow)">1σ超え</span>：注意（信用差別化の兆候）</li>
        <li><span style="color:var(--red)">2σ超え</span>：警戒（普段ではありえないレベルの異常値）</li>
      </ul>
      <p>σ（シグマ）は「過去1年の普段の振れ幅からどれだけ外れているか」。水準そのものではなく異常度で判定します。</p>
      <p><strong>チャートの見方</strong>：点線のμは過去1年の平均、+2σは「これ以上は異常」のライン。赤い面積が大きくなるほど弱い企業と強い企業の差が広がっています。</p>
    `
  },
  ratio: {
    title: 'CCC / BB 変化率比',
    body: `
      <p>CCCのスプレッドの動きが、BBの<strong>何倍の速さ</strong>で動いているかを示します。全体の平均は変わっていないのに弱い企業だけが崩れ始める異変を捉えるための指標です。</p>
      <ul>
        <li><span style="color:var(--green)">1倍前後</span>：全体が均等に動いている（正常）</li>
        <li><span style="color:var(--yellow)">2倍超え</span>：弱い企業の動きが目立ち始めた（注意）</li>
        <li><span style="color:var(--red)">3倍超え</span>：弱い企業だけが急速に悪化（パニック初期の可能性・警戒）</li>
      </ul>
      <div class="guide-note"><strong>この指標は単独で信用しないでください。</strong>判定は比率の絶対値で行われるため、CCCが改善している局面でも警戒表示になることがあります。また分母（BBの変化）がゼロに近いと比率だけが極端に大きく出ます。数字が大きいときは20日変化幅チャートでCCCの実際の動き（bps）を必ず確認してください。計算方法は既知の問題として見直し予定です。</div>
    `
  },
  em: {
    title: '米国-新興国 相関',
    body: `
      <p>米国と新興国の信用市場が<strong>同じ方向に動いているか</strong>を示す数値です。1に近いほど「世界中で同時にお金の貸し借りがおかしくなっている」危険な状態です。</p>
      <ul>
        <li><span style="color:var(--yellow)">0.6超え</span>：連動が強まってきた（注意）</li>
        <li><span style="color:var(--red)">0.8超え＋両方悪化中</span>：世界同時の信用不安（システミックリスク・警戒）</li>
        <li><span style="color:var(--green)">低い値</span>：問題が一部の地域に限定されている</li>
      </ul>
      <p><strong>チャートの見方</strong>：2本の線が同じ方向に同じタイミングで動いていたら要注意です。</p>
      <div class="guide-note">数字カードの色は相関値が0.8を超えただけで赤になりますが、チャートとアラートの「全面警戒」は「両方のスプレッドが拡大中」も条件です。カードが赤でもアラートに出ていなければ、相関は高いがどちらかが改善方向ということです。</div>
    `
  },
  velocity: {
    title: '20日変化幅',
    body: `
      <p>スプレッドが20営業日（約1ヶ月）でどれだけ動いたかをbps（0.01%）で表示します。<strong>水準ではなくスピードを見るチャート</strong>です。じわじわ上がるのと急に上がるのでは意味が全く違います。</p>
      <ul>
        <li><span style="color:var(--yellow)">+50bps超え</span>：拡大傾向（注意）</li>
        <li><span style="color:var(--red)">+100bps超え</span>：異常な速さで悪化中（警戒）</li>
      </ul>
      <p>短期間の急拡大は、イベントドリブンな悪化（何か起きた）を示しやすいシグナルです。</p>
    `
  },
  bank: {
    title: '銀行ストレス Score',
    body: `
      <p>銀行間の資金調達ストレスを数値化した指標です。企業の信用スプレッドが「一般企業の健康診断」なら、これは「銀行という血管の健康診断」。構成指標をZスコア化して平均し、<strong>Score = 50 + 10 × BSI</strong> として表示します。</p>
      <ul>
        <li><span style="color:var(--green)">45未満</span>：正常</li>
        <li><span style="color:var(--yellow)">45以上55未満</span>：注意</li>
        <li><span style="color:var(--yellow)">55以上65未満</span>：警戒</li>
        <li><span style="color:var(--red)">65以上</span>：危機</li>
      </ul>
      <div class="guide-note">4指標のうちTED Spreadは2022年、CP Spreadの元データは1997年にFRED側で提供終了しており、<strong>現在のScoreはSOFRとSt.Louis FSIの2指標だけで算出</strong>されています。構成数が時期で変わるため、昔と今のScoreは厳密には同じものさしではありません。</div>
      <div class="guide-note">定義上「完全に平均的な状態」がちょうど50ですが、45以上が「注意」のため、<strong>市場が普通でも「注意」と表示されます</strong>。50前後の「注意」は実質的に平常と考えてください（既知の問題として見直し予定）。</div>
    `
  }
};

const guideDialog = document.getElementById('guideDialog');

function openGuide(key) {
  const guide = GUIDES[key];
  if (!guide || !guideDialog) return;
  document.getElementById('guideTitle').textContent = guide.title;
  document.getElementById('guideBody').innerHTML = guide.body;
  guideDialog.showModal();
  // 前回のスクロール位置を持ち越さない
  document.getElementById('guideBody').scrollTop = 0;
}

if (guideDialog) {
  // 「?」ボタンはイベント委譲でまとめて拾う（Escで閉じるのはdialog標準機能）
  document.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('.help-btn') : null;
    if (btn && btn.dataset.guide) openGuide(btn.dataset.guide);
  });

  document.getElementById('guideClose').addEventListener('click', () => guideDialog.close());

  // ダイアログ外（backdrop）クリックで閉じる。パネル内はヘッダー・本文が
  // 全面を覆っているため、e.targetがdialog自身になるのは外側クリックのみ。
  guideDialog.addEventListener('click', (e) => {
    if (e.target === guideDialog) guideDialog.close();
  });
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
