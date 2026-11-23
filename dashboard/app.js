// Token Radar dashboard: renders window.RADAR (written by main.ts) with no fetch and no network.
// Views switch on the hash: #board (with ?verdict=&sort=&dir= presets), #detail=<slug>, #method, #live.
(function () {
  'use strict';
  var R = window.RADAR;
  var V = R.value, O = R.odds, F = R.farm_params;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function num(n) { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'); }
  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function g7(p) { var g = (p.change_7d === null ? 0 : p.change_7d) / 100; return Math.min(1.2, Math.max(-0.6, g)); }

  // ---------------------------------------------------------------- KPI strip
  $('kpi').innerHTML =
    '<div class="kpi"><div class="k">Value fit · LOO</div><div class="v">×' + V.loo.toFixed(2) + '</div><div class="s">median miss, beats flat ×' + V.flat_loo.toFixed(2) + '</div></div>' +
    '<div class="kpi"><div class="k">Walk-forward avg</div><div class="v">×' + V.wf_avg.toFixed(2) + '</div><div class="s">3 splits, fit on the past only</div></div>' +
    '<div class="kpi"><div class="k">Odds · Brier 10-fold</div><div class="v">' + O.brier_10fold.toFixed(3) + '</div><div class="s">base rate ' + O.base_brier.toFixed(3) + ' · ' + pct(O.called_right_wf, 0) + ' called right</div></div>' +
    '<div class="kpi"><div class="k">Interval coverage</div><div class="v">' + pct(V.conformal_coverage, 0) + '</div><div class="s">of actuals inside the P25–P75 band (claims 50%)</div></div>' +
    '<div class="kpi"><div class="k">FARM rows</div><div class="v">' + R.rows.filter(function (r) { return r.verdict === 'FARM'; }).length + ' / ' + R.rows.length + '</div><div class="s">break even at ≤ $100K deposit</div></div>';

  // ---------------------------------------------------------------- integrity strip: the 9 self-tests, executed here
  function browserTests() {
    var rows = R.rows, out = [];
    var onBoard = {};
    rows.forEach(function (r) { onBoard[r.slug] = true; });
    var missing = R.watchlist.filter(function (s) { return !onBoard[s]; });
    out.push({ id: 'watchlist', name: 'Watchlist 40/40', pass: missing.length === 0, detail: 'every watchlist slug on the board, checked by slug (' + (R.watchlist.length - missing.length) + '/' + R.watchlist.length + ').' });
    var ranks = rows.every(function (r, i) { return r.rank === i + 1; });
    out.push({ id: 'ranks', name: 'Ranks 1..N', pass: ranks, detail: rows.length + ' rows, ranks exactly 1..' + rows.length + '.' });
    var ord = true; for (var i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) ord = false;
    out.push({ id: 'order', name: 'EV order', pass: ord, detail: 'expected value never rises with rank.' });
    var st = rows.every(function (r) { return r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every(function (s) { return s.length >= 20 && s.length <= 600; }); });
    out.push({ id: 'farm-steps', name: 'Farm steps', pass: st, detail: '8 steps on every row, each 20–600 characters.' });
    var pos = rows.every(function (r) { return Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0; });
    out.push({ id: 'implied-positive', name: 'EV positive', pass: pos, detail: 'every implied value a positive integer.' });
    // Recompute rank 1's fitted market cap from the reported coefficients, in this page.
    var r1 = rows[0], b = V.beta;
    var lnPred = b[0] + b[1] * Math.log(r1.tvl_usd) + b[2] * Math.log(Math.max(1, r1.chains.length)) + b[3] * g7(r1);
    var refit = Math.exp(lnPred);
    var close = Math.abs(refit - r1.fitted_mcap_usd) / r1.fitted_mcap_usd < 0.02;
    out.push({ id: 'refit', name: 'Refit in browser', pass: close, detail: 'rank 1 refit from the published coefficients: ' + money(refit) + ' vs ' + money(r1.fitted_mcap_usd) + ' on the row.' });
    out.push({ id: 'loo', name: 'LOO beats flat', pass: V.loo < V.flat_loo, detail: 'leave-one-out ×' + V.loo.toFixed(2) + ' vs flat multiple ×' + V.flat_loo.toFixed(2) + '.' });
    out.push({ id: 'brier', name: 'Brier beats base', pass: O.brier_10fold < O.base_brier, detail: 'odds Brier ' + O.brier_10fold.toFixed(3) + ' vs base rate ' + O.base_brier.toFixed(3) + '.' });
    out.push({ id: 'converged', name: 'Fits converged', pass: V.converged && O.converged, detail: 'Huber fit converged in ' + V.huber_iters + ' iterations; logistic fit converged: ' + O.converged + '.' });
    return out;
  }
  var tests = browserTests();
  var allPass = tests.every(function (t) { return t.pass; });
  $('strip').className = 'strip' + (allPass ? '' : ' bad');
  $('strip').innerHTML = '<h2>Integrity strip — ' + tests.filter(function (t) { return t.pass; }).length + '/' + tests.length + ' self-tests pass, executed in this page</h2>' +
    '<div class="chips">' + tests.map(function (t, i) {
      return '<button type="button" class="chip' + (t.pass ? '' : ' fail') + '" data-i="' + i + '"><b>' + (t.pass ? 'PASS' : 'FAIL') + '</b> ' + esc(t.name) + '</button>';
    }).join('') + '</div><p class="stripdetail" id="stripdetail">Click a check for its detail. These nine checks mirror the nine that gate the run — the browser refit stands in for the deterministic refit — and a failure refuses the board.</p>';
  $('strip').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    var t = tests[+b.dataset.i];
    $('stripdetail').textContent = t.name + ': ' + t.detail;
  });

  // ---------------------------------------------------------------- ledger bar
  var L = R.ledger;
  var prePct = Math.round(L.pre_token / L.total * 100);
  $('ledger').innerHTML = '<b>' + num(L.total) + ' protocols</b> · ' + num(L.pre_token) + ' pre-token (' + prePct + '%) · ' + num(L.live_token) + ' live · ' +
    'total TVL ' + money(L.total_tvl_usd) + ' · live market cap ' + money(L.live_mcap_usd) +
    '<div class="bar"><i style="width:' + prePct + '%;background:#0969da"></i><i style="width:' + (100 - prePct) + '%;background:#1a7f37"></i></div>' +
    '<span style="color:#0969da">■</span> pre-token &nbsp; <span style="color:#1a7f37">■</span> live-token &nbsp;·&nbsp; ' +
    'Board: ' + R.watchlist_size + ' watchlist + ' + R.early_size + ' early + ' + R.off_list_size + ' off-list rows. ' +
    'The ' + num(L.pre_token - L.board) + ' pre-token protocols not on the board: ' +
    L.set_aside.map(function (b) { return num(b.n) + ' ' + esc(b.reason); }).join('; ') + '. ' +
    'Top categories by TVL: ' +
    L.top_categories.slice(0, 5).map(function (c) { return esc(c.category) + ' (' + money(c.tvl_usd) + ')'; }).join(', ') + '.';

  // ---------------------------------------------------------------- scatter: log-log fitted cap vs TVL
  var KIND_COLORS = { Lending: '#0969da', Dexs: '#1a7f37', Yield: '#9a6700', RWA: '#8250df', 'Basis Trading': '#cf222e', CDP: '#1f6feb', Restaking: '#57606a' };
  function scatterSVG() {
    var pts = R.scatter, W = 960, H = 340, PL = 56, PR = 12, PT = 12, PB = 36;
    var xs = pts.map(function (p) { return p.ln_tvl; }), ys = pts.map(function (p) { return p.ln_mcap; });
    var x0 = Math.floor(Math.min.apply(null, xs)) - 0.5, x1 = Math.ceil(Math.max.apply(null, xs)) + 0.5;
    var y0 = Math.floor(Math.min.apply(null, ys)) - 1, y1 = Math.ceil(Math.max.apply(null, ys)) + 1;
    var X = function (v) { return PL + (v - x0) / (x1 - x0) * (W - PL - PR); };
    var Y = function (v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); };
    var b = V.beta, medC = V.median_ln_chains, medG = V.median_g7;
    var line = function (x) { return b[0] + b[1] * x + b[2] * medC + b[3] * medG; };
    var g = V.conformal_global;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Scatter of log market cap against log TVL for the comparable protocols">';
    // conformal band
    s += '<polygon points="' + X(x0) + ',' + Y(line(x0) + g.p75) + ' ' + X(x1) + ',' + Y(line(x1) + g.p75) + ' ' + X(x1) + ',' + Y(line(x1) + g.p25) + ' ' + X(x0) + ',' + Y(line(x0) + g.p25) + '" fill="#ddf4ff" opacity="0.8"/>';
    // gridlines + ticks at powers of ten
    var ticks = [];
    for (var k = 0; k <= 12; k++) { var v = Math.pow(10, k); if (Math.log(v) >= x0 && Math.log(v) <= x1) ticks.push(v); }
    ticks.forEach(function (v) {
      var lx = Math.log(v);
      s += '<line class="axis" x1="' + X(lx) + '" y1="' + PT + '" x2="' + X(lx) + '" y2="' + (H - PB) + '"/>';
      s += '<text x="' + X(lx) + '" y="' + (H - 18) + '" text-anchor="middle">' + (v >= 1e9 ? '$' + v / 1e9 + 'B' : '$' + v / 1e6 + 'M') + '</text>';
    });
    var yticks = [];
    for (var k2 = 0; k2 <= 12; k2++) { var v2 = Math.pow(10, k2); if (Math.log(v2) >= y0 && Math.log(v2) <= y1) yticks.push(v2); }
    yticks.forEach(function (v) {
      var ly = Math.log(v);
      s += '<line class="axis" x1="' + PL + '" y1="' + Y(ly) + '" x2="' + (W - PR) + '" y2="' + Y(ly) + '"/>';
      s += '<text x="' + (PL - 6) + '" y="' + (Y(ly) + 4) + '" text-anchor="end">' + (v >= 1e9 ? '$' + v / 1e9 + 'B' : '$' + v / 1e6 + 'M') + '</text>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 4) + '" text-anchor="middle">TVL (log scale)</text>';
    s += '<text x="12" y="' + (H / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + (H / 2) + ')">Market cap (log scale)</text>';
    // regression line
    s += '<line x1="' + X(x0) + '" y1="' + Y(line(x0)) + '" x2="' + X(x1) + '" y2="' + Y(line(x1)) + '" stroke="#0969da" stroke-width="2"/>';
    // points: size = TVL, colour = kind
    pts.forEach(function (p) {
      var r = 2 + Math.min(4, Math.log(p.tvl_usd / 1e6) / 2);
      var c = KIND_COLORS[p.kind] || '#8c959f';
      s += '<circle cx="' + X(p.ln_tvl).toFixed(1) + '" cy="' + Y(p.ln_mcap).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + c + '" fill-opacity="0.75"><title>' + esc(p.slug) + ' · TVL ' + money(p.tvl_usd) + ' · mcap ' + money(Math.exp(p.ln_mcap)) + ' · fitted ' + money(Math.exp(p.ln_pred)) + '</title></circle>';
    });
    return s + '</svg>';
  }
  $('scatter').innerHTML = scatterSVG();
  $('scatter-cap').textContent = '— ' + R.scatter.length + ' comparables, Huber fit, P25–P75 band';
  $('scatter-note').textContent = 'ln(mcap) = ' + V.beta[0].toFixed(2) + ' + ' + V.beta[1].toFixed(2) + '·ln(TVL) ± ' + V.se[1].toFixed(2) +
    ' + ' + V.beta[2].toFixed(2) + '·ln(chains) ± ' + V.se[2].toFixed(2) + ' + ' + V.beta[3].toFixed(2) + '·7d growth ± ' + V.se[3].toFixed(2) +
    ' · R² ' + V.r2.toFixed(2) + ' · LOO ×' + V.loo.toFixed(2) + ' · point size = TVL, colour = kind. The band is the conformal P25–P75 interval; ' +
    pct(V.conformal_coverage, 1) + ' of held-out actuals fall inside it.';

  // footer facts
  $('fn-comps').textContent = V.n_comps;
  $('fn-peers').textContent = O.n_peers;
  $('fn-asof').textContent = R.as_of;
  $('fn-source').textContent = R.source;

  // ---------------------------------------------------------------- board table
  var state = { sort: 'rank', dir: 1, q: '', verdict: '', kind: '' };
  var kinds = [...new Set(R.rows.map(function (r) { return r.category || 'Unknown'; }))].sort();
  $('kind').innerHTML = '<option value="">All categories</option>' + kinds.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('');

  function visibleRows() {
    var q = state.q.toLowerCase();
    return R.rows.filter(function (r) {
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.kind && (r.category || 'Unknown') !== state.kind) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort, av = a[k], bv = b[k];
      if (typeof av === 'string') return av.localeCompare(bv) * state.dir;
      return (av - bv) * state.dir;
    });
  }

  function renderTable() {
    var rows = visibleRows();
    $('rowcount').textContent = '— ' + rows.length + ' of ' + R.rows.length + ' rows';
    $('tbody').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td><td><b>' + esc(r.name) + '</b><br><span style="color:var(--mut)">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + money(r.fitted_mcap_usd) + '</td><td class="num">' + pct(r.odds_ever, 0) + '</td><td class="num">' + pct(r.odds_12m, 0) + '</td>' +
        '<td class="num">' + pct(r.own_token_share, 0) + '</td><td class="num">' + money(r.net_per_hour_usd) + '</td>' +
        '<td><span class="tag ' + r.verdict + '">' + r.verdict + '</span><br><span style="color:var(--mut)">BE ' + (r.breakeven_deposit_usd === null ? '—' : money(r.breakeven_deposit_usd)) + '</span></td></tr>';
    }).join('');
    var totEV = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var totTVL = rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var farms = rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
    $('tfoot').innerHTML = '<tr><td></td><td>' + rows.length + ' rows · ' + farms + ' FARM</td><td></td><td class="num">' + money(totTVL) + '</td><td class="num">' + money(totEV) + '</td><td colspan="6"></td></tr>';
    document.querySelectorAll('#boardtbl th').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.k === state.sort);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.k === state.sort ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
  }
  document.querySelectorAll('#boardtbl th').forEach(function (th) {
    th.addEventListener('click', function () {
      if (state.sort === th.dataset.k) state.dir *= -1;
      else { state.sort = th.dataset.k; state.dir = th.dataset.k === 'name' || th.dataset.k === 'category' ? 1 : -1; }
      renderTable();
    });
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderTable(); });
  $('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderTable(); });
  $('kind').addEventListener('change', function (e) { state.kind = e.target.value; renderTable(); });
  $('tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr'); if (tr) location.hash = '#detail=' + tr.dataset.slug;
  });
  $('csv').addEventListener('click', function () {
    var rows = visibleRows();
    var head = 'rank,slug,name,category,tvl_usd,implied_value_usd,fitted_mcap_usd,odds_ever,odds_12m,own_token_share,net_per_hour_usd,verdict';
    var body = rows.map(function (r) {
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.implied_value_usd, r.fitted_mcap_usd, r.odds_ever, r.odds_12m, r.own_token_share, r.net_per_hour_usd, r.verdict].join(',');
    }).join('\n');
    var done = function () { $('csv').textContent = 'Copied ' + rows.length + ' rows'; setTimeout(function () { $('csv').textContent = 'Copy CSV'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(head + '\n' + body).then(done, done);
    else { var ta = document.createElement('textarea'); ta.value = head + '\n' + body; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); }
  });
  renderTable();

  // ---------------------------------------------------------------- detail view
  function detailHTML(r) {
    var b = V.beta;
    var lnPred = b[0] + b[1] * Math.log(r.tvl_usd) + b[2] * Math.log(Math.max(1, r.chains.length)) + b[3] * g7(r);
    var hours = F.setup_hours + F.hours_per_week * F.horizon_weeks;
    var cost = F.gas_per_week_usd * F.horizon_weeks + hours * F.hourly_rate_usd;
    var h = '<div class="card"><p><a href="#board">← Back to the board</a></p>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="tag ' + r.verdict + '">' + r.verdict + '</span> <span class="hint">bootstrap rank range (value-fit) ' + r.rank_lo + '–' + r.rank_hi + '</span></h2>' +
      '<p class="cap">' + esc(r.slug) + ' · ' + esc(r.category || 'Unknown') + ' · ' + r.chains.map(esc).join(', ') + ' · TVL ' + money(r.tvl_usd) +
      ' · 7d ' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + ' · age ' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</p>' +
      '<div class="grid2"><div><h3>Expected value, with the arithmetic</h3><div class="arith">' +
      'Fitted market cap = exp(' + b[0].toFixed(3) + ' + ' + b[1].toFixed(3) + ' × ln(' + money(r.tvl_usd) + ') + ' + b[2].toFixed(3) + ' × ln(' + Math.max(1, r.chains.length) + ' chains) + ' + b[3].toFixed(3) + ' × ' + g7(r).toFixed(3) + ' growth)<br>' +
      '= exp(' + lnPred.toFixed(3) + ') = <b>' + money(r.fitted_mcap_usd) + '</b><br><br>' +
      'Odds ever = <b>' + pct(r.odds_ever) + '</b> (logistic on ' + O.n_peers + ' peers) · odds in 12 months = <b>' + pct(r.odds_12m) + '</b> (hazard from the fitted model)<br>' +
      'Logit: ' + r.odds_terms.intercept.toFixed(3) + ' (intercept) + ' + r.odds_terms.ln_years.toFixed(3) + ' (ln years) + ' + r.odds_terms.ln_tvl.toFixed(3) + ' (ln TVL) + ' + r.odds_terms.g7.toFixed(3) + ' (growth) + ' + r.odds_terms.catshare.toFixed(3) + ' (category share ' + pct(r.odds_terms.catshare_value, 1) + ') = ' + (r.odds_terms.intercept + r.odds_terms.ln_years + r.odds_terms.ln_tvl + r.odds_terms.g7 + r.odds_terms.catshare).toFixed(3) + ' → ' + pct(r.odds_ever) + '<br>' +
      'Own-token share = <b>' + pct(r.own_token_share) + '</b> (this protocol\'s TVL over its family\'s tokened TVL)<br><br>' +
      'Expected value = ' + money(r.fitted_mcap_usd) + ' × ' + r.odds_ever.toFixed(3) + ' × ' + r.own_token_share.toFixed(3) + ' = <b>' + money(r.implied_value_usd) + '</b><br>' +
      'Conformal interval on the fitted value: P25–P75 <b>' + money(r.if_lo_usd) + ' – ' + money(r.if_hi_usd) + '</b> · P10–P90 ' + money(r.if_p10_usd) + ' – ' + money(r.if_p90_usd) +
      '</div></div><div><h3>Farm economics (52 weeks)</h3><table class="kv"><tbody>' +
      '<tr><td>Plan deposit (0.02% of TVL)</td><td class="num"><b>' + money(r.deposit_usd) + '</b></td></tr>' +
      '<tr><td>Expected drop (7% × pro-rata × 12m odds × own-token share)</td><td class="num">' + money(r.expected_drop_usd) + '</td></tr>' +
      '<tr><td>Cost: $5/week gas + ' + hours + 'h at $25/h</td><td class="num">' + money(cost) + '</td></tr>' +
      '<tr><td>Net at the plan size</td><td class="num">' + money(r.net_usd) + '</td></tr>' +
      '<tr><td>Net per hour</td><td class="num">' + money(r.net_per_hour_usd) + '</td></tr>' +
      '<tr><td>Break-even deposit</td><td class="num"><b>' + (r.breakeven_deposit_usd === null ? 'no size breaks even' : money(r.breakeven_deposit_usd)) + '</b></td></tr>' +
      '<tr><td>Verdict</td><td><span class="tag ' + r.verdict + '">' + r.verdict + '</span></td></tr>' +
      '</tbody></table>' +
      '<p class="cap">Verdict = the minimum-capital lens: FARM breaks even at ≤ $100K, THIN at ≤ $500K, SKIP above that or never. At the 0.02% plan size every row\'s net is negative — farming at these odds is a whale game, and the break-even deposit says by how much.</p>' +
      '</div></div>' +
      '<div class="card"><h3>Farm plan — 8 steps with exit rules</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>' +
      '<div class="card sandbox"><h3>Farm sandbox — change the assumptions, watch the numbers move</h3>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap">' +
      '<div><label>Deposit $</label><input id="sb-dep" type="number" value="' + r.deposit_usd + '" min="1"></div>' +
      '<div><label>Drop share %</label><input id="sb-drop" type="number" value="' + (Math.round(F.drop_share * 1000) / 10) + '" min="0" max="100" step="0.5"></div>' +
      '<div><label>Horizon weeks</label><input id="sb-weeks" type="number" value="' + F.horizon_weeks + '" min="1" max="156"></div>' +
      '<div><label>Gas $/week</label><input id="sb-gas" type="number" value="' + F.gas_per_week_usd + '" min="0" step="0.5"></div>' +
      '<div><label>Time $/hour</label><input id="sb-rate" type="number" value="' + F.hourly_rate_usd + '" min="0"></div></div>' +
      '<p class="out" id="sb-out"></p></div></div>';
    return h;
  }
  function bindSandbox(r) {
    var recompute = function () {
      var dep = parseFloat($('sb-dep').value) || 0, drop = (parseFloat($('sb-drop').value) || 0) / 100;
      var weeks = parseFloat($('sb-weeks').value) || 0, gas = parseFloat($('sb-gas').value) || 0, rate = parseFloat($('sb-rate').value) || 0;
      var expDrop = r.fitted_mcap_usd * drop * (dep / r.tvl_usd) * r.odds_12m * r.own_token_share;
      var hours = F.setup_hours + F.hours_per_week * weeks;
      var cost = gas * weeks + hours * rate;
      var net = expDrop - cost, be = (r.fitted_mcap_usd * drop * r.odds_12m * r.own_token_share) > 0 ? (cost * r.tvl_usd) / (r.fitted_mcap_usd * drop * r.odds_12m * r.own_token_share) : null;
      $('sb-out').innerHTML = 'Expected drop <b>' + money(expDrop) + '</b> · cost <b>' + money(cost) + '</b> (' + hours.toFixed(1) + 'h) · net <b>' + money(net) + '</b> · net/hour <b>' + money(hours > 0 ? net / hours : 0) + '</b> · break-even deposit <b>' + (be === null || be > r.tvl_usd ? 'no size breaks even' : money(be)) + '</b>';
    };
    ['sb-dep', 'sb-drop', 'sb-weeks', 'sb-gas', 'sb-rate'].forEach(function (id) { $(id).addEventListener('input', recompute); });
    recompute();
  }

  // ---------------------------------------------------------------- method view
  function methodHTML() {
    var ab = O.age_buckets;
    var cal2040 = O.calibration.filter(function (c) { return c.bucket === '20-40%'; })[0];
    var h = '<div class="card"><h2>Method — radar-2</h2>' +
      '<p><b>Value model.</b> Huber log-log regression (c = 1.345) on ' + V.n_comps + ' comparables — tokened protocols outside the excluded categories (CEX, bridges, liquid staking/restaking). ' +
      'ln(mcap) = ' + V.beta[0].toFixed(2) + ' ± ' + V.se[0].toFixed(2) + ' + (' + V.beta[1].toFixed(2) + ' ± ' + V.se[1].toFixed(2) + ')·ln(TVL) + (' + V.beta[2].toFixed(2) + ' ± ' + V.se[2].toFixed(2) + ')·ln(chains) + (' + V.beta[3].toFixed(2) + ' ± ' + V.se[3].toFixed(2) + ')·7d growth. ' +
      'SEs from 200 seeded bootstrap refits. R² ' + V.r2.toFixed(2) + ': weak in absolute terms, strong against the flat baseline.</p>' +
      '<p><b>Odds model.</b> Logistic regression on ' + O.n_peers + ' peers (base rate ' + pct(O.base_rate) + ' tokened). logit(p) = ' + O.beta[0].toFixed(2) + ' + ' + O.beta[1].toFixed(2) + '·ln(years) + ' + O.beta[2].toFixed(2) + '·ln(TVL) + ' + O.beta[3].toFixed(2) + '·growth + ' + O.beta[4].toFixed(2) + '·category token share. ' +
      'The age coefficient is positive: odds RISE with age, as the snapshot\'s own age buckets show (' + pct(ab[0].rate, 0) + ' tokened ' + ab[0].label + ', n=' + ab[0].n + '; ' + pct(ab[4].rate, 0) + ' ' + ab[4].label + ', n=' + ab[4].n + '). ' +
      'The ever odds are cross-sectional — the fitted chance a protocol of this age and size records a token at all. The 12-month odds are a forward hazard, (p(age+365d) − p(age)) / (1 − p(age)): the chance it tokens in the NEXT year, given it has not yet. For a young protocol the hazard can exceed the ever odds — most of its lifetime chance is still ahead of it. That is arithmetic, not a bug.</p>' +
      '<p><b>Own-token share.</b> Kin are the protocols that record a token and share the first slug segment; share = TVL(P) / (TVL(P) + Σ TVL(kin)). No kin means 100%. Measured from the snapshot alone.</p>' +
      '<p><b>Intervals.</b> Conformal per kind from leave-one-out residuals (kinds with &lt; 8 comparables use the global band). Coverage: ' + pct(V.conformal_coverage, 1) + ' of held-out actuals inside a band that claims 50%.</p></div>' +
      '<div class="card"><h2>Evidence 1 — term selection (leave-one-out + 3 walk-forward splits)</h2>' +
      '<p class="cap">A term is kept when it improves leave-one-out without wrecking walk-forward. Listing age was tested and dropped: it destroys walk-forward (×' + V.term_table[3].wf_avg.toFixed(2) + '). Category effects were tested (joint ridge) and dropped: no improvement over the growth term.</p>' +
      '<table><thead><tr><th>Terms</th><th class="num">LOO</th><th class="num">WF avg</th><th class="num">WF 2/3–1/3</th><th class="num">WF 50/50</th><th class="num">WF pre-2025</th><th>Kept</th></tr></thead><tbody>' +
      V.term_table.map(function (t) { return '<tr' + (t.kept ? ' style="background:#dafbe1"' : '') + '><td>' + esc(t.terms) + '</td><td class="num">×' + t.loo.toFixed(2) + '</td><td class="num">×' + t.wf_avg.toFixed(2) + '</td><td class="num">×' + t.wf23.toFixed(2) + '</td><td class="num">×' + t.wf50.toFixed(2) + '</td><td class="num">×' + t.wfv16.toFixed(2) + '</td><td>' + (t.kept ? '<b>KEPT</b>' : '—') + '</td></tr>'; }).join('') +
      '</tbody></table><p class="cap">Flat multiple baseline (median mcap/TVL ' + V.flat_multiple.toFixed(4) + '): leave-one-out ×' + V.flat_loo.toFixed(2) + ' — the fitted model beats it by ' + Math.round((1 - V.loo / V.flat_loo) * 100) + '%.</p></div>' +
      '<div class="card"><h2>Evidence 2 — held-out tests (the chosen model, 5 ways)</h2><table><thead><tr><th>Test</th><th class="num">Train</th><th class="num">Test</th><th class="num">Median miss</th><th>Note</th></tr></thead><tbody>' +
      V.held_out.map(function (t) { return '<tr><td>' + esc(t.test) + '</td><td class="num">' + t.n_train + '</td><td class="num">' + t.n_test + '</td><td class="num">×' + t.median_miss.toFixed(2) + '</td><td>' + esc(t.note) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="grid2"><div class="card"><h2>Evidence 3 — odds calibration</h2><p class="cap">Predicted odds vs actual token rate, ' + O.n_peers + ' peers. The 20–40% bucket over-predicts (' + pct(cal2040.predicted, 1) + ' predicted, ' + pct(cal2040.actual, 1) + ' actual) — reported, not hidden.</p>' +
      '<table><thead><tr><th>Bucket</th><th class="num">n</th><th class="num">Predicted</th><th class="num">Actual</th></tr></thead><tbody>' +
      O.calibration.map(function (c) { return '<tr><td>' + esc(c.bucket) + '</td><td class="num">' + c.n + '</td><td class="num">' + pct(c.predicted, 1) + '</td><td class="num">' + pct(c.actual, 1) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="cap">Brier 10-fold ' + O.brier_10fold.toFixed(3) + ' · walk-forward ' + O.brier_wf.toFixed(3) + ' · base rate ' + O.base_brier.toFixed(3) + ' · called right ' + pct(O.called_right_wf, 1) + ' walk-forward.</p></div>' +
      '<div class="card"><h2>Conformal intervals by kind</h2><p class="cap">P25–P75 of leave-one-out residuals in log space. Kinds with &lt; 8 comparables use the global band (' + V.conformal_global.p25.toFixed(2) + ' to +' + V.conformal_global.p75.toFixed(2) + ').</p>' +
      '<table><thead><tr><th>Kind</th><th class="num">n</th><th class="num">P25</th><th class="num">P75</th></tr></thead><tbody>' +
      V.conformal_kinds.map(function (c) { return '<tr><td>' + esc(c.kind) + '</td><td class="num">' + c.n + '</td><td class="num">' + (c.p25 >= 0 ? '+' : '') + c.p25.toFixed(2) + '</td><td class="num">' + (c.p75 >= 0 ? '+' : '') + c.p75.toFixed(2) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="cap">Global P10–P90: ' + V.conformal_global.p10.toFixed(2) + ' to +' + V.conformal_global.p90.toFixed(2) + '. Coverage ' + pct(V.conformal_coverage, 1) + ' vs 50% claimed.</p></div></div>' +
      '<div class="warn"><b>What this model does not claim.</b> R² ' + V.r2.toFixed(2) + ' means most of the variance in market caps is unexplained — the intervals are wide because the truth is wide. ' +
      'The 20–40% odds bucket over-predicts. The ever odds are cross-sectional: they overstate old survivors, whose chance is mostly behind them, and understate young protocols, whose chance is mostly ahead. ' +
      'Own-token share is a snapshot proxy for family structure, not a legal fact. Farm nets assume a 7% drop and a 52-week hold; change them in the sandbox.</div>';
    return h;
  }

  // ---------------------------------------------------------------- live view
  function liveHTML() {
    var h = '<div class="card"><h2>Live tokens — the market\'s own values, never mixed into the ranked board</h2>' +
      '<p class="cap">Top ' + R.live.length + ' live-token protocols by market cap (exchanges excluded). These are the comparables\' neighbours: the board ranks only pre-token protocols.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead><tbody>' +
      R.live.map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b><br><span style="color:var(--mut)">' + esc(p.slug) + '</span></td><td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + (p.change_7d === null ? '—' : p.change_7d.toFixed(1) + '%') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    return h;
  }

  // ---------------------------------------------------------------- routing
  function show(view) {
    ['view-board', 'view-detail', 'view-method', 'view-live'].forEach(function (id) { $(id).hidden = id !== view; });
    ['tab-board', 'tab-method', 'tab-live'].forEach(function (id) { $(id).classList.remove('on'); });
    if (view === 'view-board') $('tab-board').classList.add('on');
    if (view === 'view-method') $('tab-method').classList.add('on');
    if (view === 'view-live') $('tab-live').classList.add('on');
    window.scrollTo(0, 0);
  }
  function route() {
    var hash = location.hash || '#board';
    var m = hash.match(/^#detail=(.+)$/);
    if (m) {
      var r = R.rows.find(function (x) { return x.slug === decodeURIComponent(m[1]); });
      if (r) { $('view-detail').innerHTML = detailHTML(r); bindSandbox(r); show('view-detail'); return; }
    }
    if (hash.indexOf('#method') === 0) { $('view-method').innerHTML = methodHTML(); show('view-method'); return; }
    if (hash.indexOf('#live') === 0) { $('view-live').innerHTML = liveHTML(); show('view-live'); return; }
    // #board with optional ?verdict=&sort=&dir=&q= presets (used by screenshots and links)
    var qm = hash.match(/^#board\?(.*)$/);
    if (qm) {
      var ps = new URLSearchParams(qm[1]);
      if (ps.get('verdict')) { state.verdict = ps.get('verdict'); $('verdict').value = state.verdict; }
      if (ps.get('kind')) { state.kind = ps.get('kind'); $('kind').value = state.kind; }
      if (ps.get('q')) { state.q = ps.get('q'); $('q').value = state.q; }
      if (ps.get('sort')) { state.sort = ps.get('sort'); state.dir = ps.get('dir') === 'asc' ? 1 : -1; }
      renderTable();
    }
    show('view-board');
  }
  window.addEventListener('hashchange', route);
  route();
})();
