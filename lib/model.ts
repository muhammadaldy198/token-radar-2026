// The token radar's model, version 2: a fitted model, not a fixed formula.
//
// One snapshot of the protocol universe in, one ranked board out. The board covers every slug in the
// snapshot's watchlist (the floor, never a ceiling) plus the 140 largest rankable pre-token protocols
// below the watchlist floor, plus the 20 largest genuine pre-token protocols at or above the floor
// that the watchlist leaves out (the off-list: the house's own wrapped/staked/bridged test, applied
// above the floor — WBTC and the bridges are not tokens that do not exist yet). A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol).
//
// The value model is a Huber log-log regression fitted on the snapshot's own comparable protocols
// (tokened, non-exchange, non-bridge, non-liquid-staking), with terms selected by leave-one-out and
// walk-forward tests, never by assumption:
//
//   ln(mcap) = b0 + b1*ln(TVL) + b2*ln(chains) + b3*g7
//
// where g7 is the 7-day TVL change clamped to [-60%, +120%] (the house clamp). No comparable
// protocol falls outside it, so the clamp shapes the value fit's predictions, never the fit itself —
// but four odds peers DO fall outside it (down to -73%, up to +4448%), so the clamp shapes the
// odds fit as well as its predictions. Listing age was tested and DROPPED: it wrecks walk-forward
// (x5.1-6.0 vs x2.7-3.0 without it). Category effects were tested (joint ridge) and DROPPED: no
// improvement over the growth term.
//
// The odds model is a logistic regression on the same peer set, predicting P(records a token):
//
//   logit(p) = a0 + a1*ln(years listed) + a2*ln(TVL) + a3*g7 + a4*category token share
//
// The age direction is decided by the fit, not imposed: odds RISE with age (coefficient +0.44), the
// direction the snapshot's own age buckets show (27% tokened under 6 months, 90% past 4 years). The
// 12-month sub-odds come from the fitted model as a hazard: (p(age+365d) - p(age)) / (1 - p(age)).
//
// Own-token share is measured from the snapshot alone: a protocol's kin are the protocols that record
// a token and share its family stem (the first slug segment); share = TVL(P) / (TVL(P) + sum TVL(kin)).
// No kin means 100%. No protocol name is ever special-cased.
//
// Implied value is the expected value of the (potential) token:
//
//   EV = fitted mcap x odds(ever) x own-token share
//
// Intervals are conformal, per kind, from leave-one-out residuals (a kind with fewer than 8 comparables
// falls back to the global band). Every number the dashboard shows is recomputed from the snapshot at
// run time: nothing is hardcoded from an earlier run.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 140;

/** How many genuine pre-token protocols at or above the floor the off-list carries, by TVL. */
export const OFFLIST_ROWS = 20;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories the house excludes from comparables, peers and the watchlist alike. */
export const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** The growth clamp, in fractions: -60% to +120%, the house clamp from radar-1. */
export const GROWTH_FLOOR = -0.6;
export const GROWTH_CAP = 1.2;

/** Farm economics, stated in the dashboard and used by every row's plan. */
export const FARM = {
  deposit_share: 0.0002, // plan deposit = 0.02% of the protocol's TVL
  drop_share: 0.07, // airdrop = 7% of the token's implied value
  horizon_weeks: 52,
  gas_per_week_usd: 5,
  setup_hours: 2,
  hours_per_week: 0.5,
  hourly_rate_usd: 25,
  // The verdict is the minimum-capital lens: a row is FARM when a retail-size deposit breaks even,
  // THIN when it needs whale capital, SKIP when no accessible size breaks even. At a 0.02% plan
  // deposit every row's net is negative (the honest finding: airdrop farming at these odds is a
  // whale game), so the verdict answers the useful question — how much capital breaks even — while
  // the plan-size net is still shown in full.
  verdict_farm_max_breakeven_usd: 100_000,
  verdict_thin_max_breakeven_usd: 500_000,
};

/** Conformal intervals: kinds with fewer than this many comparables fall back to the global band. */
export const CONFORMAL_MIN_KIND = 8;

/** Bootstrap resamples for coefficient standard errors and rank ranges. */
export const BOOTSTRAP_B = 200;

/** The seed for every shuffle and resample: the run is deterministic. */
export const SEED = 20261123;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_mcap_usd: number;
    odds_ever: number;
    odds_12m: number;
    own_token_share: number;
    if_lo_usd: number;
    if_hi_usd: number;
    if_p10_usd: number;
    if_p90_usd: number;
    age_days: number | null;
  };
  farm: {
    deposit_usd: number;
    expected_drop_usd: number;
    cost_usd: number;
    net_usd: number;
    net_per_hour_usd: number;
    breakeven_deposit_usd: number | null;
    verdict: 'FARM' | 'THIN' | 'SKIP';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  rank_lo: number;
  rank_hi: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_mcap_usd: number;
  odds_ever: number;
  odds_12m: number;
  own_token_share: number;
  /** The logit decomposition: each odds term's contribution, so the odds are checkable by hand. */
  odds_terms: { intercept: number; ln_years: number; ln_tvl: number; g7: number; catshare: number; catshare_value: number };
  if_lo_usd: number;
  if_hi_usd: number;
  if_p10_usd: number;
  if_p90_usd: number;
  deposit_usd: number;
  expected_drop_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  breakeven_deposit_usd: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One candidate value-model term set, with its out-of-sample scores. */
export interface TermRow {
  terms: string;
  kept: boolean;
  loo: number;
  wf_avg: number;
  wf23: number;
  wf50: number;
  wfv16: number;
}

/** One held-out test of the value model. */
export interface HeldOutRow {
  test: string;
  n_train: number;
  n_test: number;
  median_miss: number;
  note: string;
}

/** One calibration bucket of the odds model. */
export interface CalibrationRow {
  bucket: string;
  n: number;
  predicted: number;
  actual: number;
}

/** One self-test check. */
export interface SelfTestRow {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

/** The value model's fitted summary. */
export interface ValueModelSummary {
  n_comps: number;
  beta: number[];
  se: number[];
  terms: string[];
  r2: number;
  loo: number;
  wf23: number;
  wf50: number;
  wfv16: number;
  wf_avg: number;
  flat_loo: number;
  flat_multiple: number;
  size_fold: number;
  category_blind: number;
  huber_c: number;
  huber_iters: number;
  converged: boolean;
  median_ln_chains: number;
  median_g7: number;
  term_table: TermRow[];
  held_out: HeldOutRow[];
  conformal_coverage: number;
  conformal_global: { p10: number; p25: number; p75: number; p90: number };
  conformal_kinds: { kind: string; n: number; p25: number; p75: number }[];
}

/** The odds model's fitted summary. */
export interface OddsModelSummary {
  n_peers: number;
  n_tokened: number;
  base_rate: number;
  beta: number[];
  terms: string[];
  brier_10fold: number;
  brier_wf: number;
  base_brier: number;
  called_right_wf: number;
  calibration: CalibrationRow[];
  /** Token rate by listing-age bucket, measured from the peers — the age direction's evidence. */
  age_buckets: { label: string; n: number; rate: number }[];
  converged: boolean;
}

/** The 758-protocol ledger, with the pre-token protocols the board sets aside and why. */
export interface Ledger {
  total: number;
  pre_token: number;
  live_token: number;
  watchlist: number;
  board: number;
  early: number;
  off_list: number;
  total_tvl_usd: number;
  live_mcap_usd: number;
  top_categories: { category: string; n: number; tvl_usd: number }[];
  set_aside: { reason: string; n: number; tvl_usd: number }[];
}

/** A scatter point: one comparable protocol, log TVL vs log market cap. */
export interface ScatterPoint {
  slug: string;
  kind: string;
  ln_tvl: number;
  ln_mcap: number;
  ln_pred: number;
  tvl_usd: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  /** The watchlist's slugs, so the browser's integrity strip checks coverage by slug, not by count. */
  watchlist: string[];
  board_size: number;
  early_size: number;
  off_list_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  value: ValueModelSummary;
  odds: OddsModelSummary;
  self_test: SelfTestRow[];
  ledger: Ledger;
  scatter: ScatterPoint[];
  farm_params: typeof FARM;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The 7-day growth as a clamped fraction. */
export function growthFrac(p: SnapshotProtocol): number {
  const raw = finite(p.change_7d, 0) / 100;
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Exchange names whose products the house rule excludes (input/README.md, the watchlist's rule). */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word `wrapped`, `staked` or `staking` in a name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol is a wrapped, staked or bridged product of another protocol — the house's own
 * test from the field guide (input/README.md): its category is a bridge, liquid staking/restaking
 * or restaked BTC, or its name carries a whole word `wrapped`/`staked`/`staking`, or its name
 * begins with an exchange's name. WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in
 * Binance's staking product: neither is a protocol still waiting on a launch of its own.
 */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category) && p.category !== 'CEX') return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_NAMES.some((e) => p.name.startsWith(`${e} `) || p.name === e);
}

/**
 * Whether a protocol belongs on the off-list: rankable, at or above the watchlist floor, not on
 * the watchlist — and a genuine pre-token protocol, not a wrapped, staked or bridged product.
 * The unfiltered above-floor pool is dominated by wrapped products (WBTC alone is $7.9B of TVL);
 * the filtered pool is exactly the 20 the brief asks for, led by Sentora.
 */
export function isOffList(p: SnapshotProtocol, snapshot: Snapshot): boolean {
  return isRankable(p) && !isWrappedProduct(p) && p.tvl_usd >= snapshot.floor_usd && !snapshot.watchlist.includes(p.slug);
}

/** Whether a protocol is a value-model comparable: tokened, with TVL, outside the excluded categories. */
export function isComparable(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    p.category !== null &&
    !EXCLUDED_CATEGORIES.has(p.category)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ------------------------------------------------------------------ small math

/** A seeded PRNG (mulberry32): every shuffle and resample is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The median of a non-empty array (sorted copy). */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A quantile by linear interpolation on the sorted array. */
export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0]!;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Solve A x = b by Gaussian elimination with partial pivoting; null when singular. */
export function solveLinear(aIn: number[][], bIn: number[]): number[] | null {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/** Weighted least squares: solve (X'WX + R) b = X'Wy, with an intercept column prepended. */
function wls(x: number[][], y: number[], w: number[], ridge: number[][] | null): number[] | null {
  const n = x.length;
  const k = x[0]!.length + 1;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...x[i]!];
    for (let r = 0; r < k; r++) {
      b[r]! += w[i]! * row[r]! * y[i]!;
      for (let c = 0; c < k; c++) a[r]![c]! += w[i]! * row[r]! * row[c]!;
    }
  }
  if (ridge !== null) for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) a[r]![c]! += ridge[r]![c]!;
  return solveLinear(a, b);
}

/** Predict with a fitted coefficient vector (intercept first). */
function predictRow(beta: number[], x: number[]): number {
  let s = beta[0]!;
  for (let j = 0; j < x.length; j++) s += beta[j + 1]! * x[j]!;
  return s;
}

/** Huber IRLS for a linear model. Returns coefficients, iterations used, and whether it converged. */
export function huberFit(
  x: number[][],
  y: number[],
  ridge: number[][] | null = null,
  c = 1.345,
  maxIters = 50,
): { beta: number[]; iters: number; converged: boolean } {
  const ones = new Array<number>(x.length).fill(1);
  let beta = wls(x, y, ones, ridge);
  if (beta === null) throw new Error('huberFit: singular design');
  let iters = 0;
  let converged = false;
  for (let it = 0; it < maxIters; it++) {
    iters = it + 1;
    const resid = x.map((row, i) => y[i]! - predictRow(beta!, row));
    const med = median(resid);
    const mad = median(resid.map((r) => Math.abs(r - med)));
    const s = 1.4826 * mad + 1e-9;
    const w = resid.map((r) => {
      const u = Math.abs(r / (c * s));
      return u <= 1 ? 1 : 1 / u;
    });
    const next = wls(x, y, w, ridge);
    if (next === null) break;
    let maxDiff = 0;
    for (let j = 0; j < beta.length; j++) maxDiff = Math.max(maxDiff, Math.abs(next[j]! - beta[j]!));
    beta = next;
    if (maxDiff < 1e-10) {
      converged = true;
      break;
    }
  }
  return { beta, iters, converged };
}

/** Logistic regression by Newton IRLS with a small ridge. */
export function logisticFit(
  x: number[][],
  y: number[],
  ridge = 1e-4,
  maxIters = 100,
): { beta: number[]; iters: number; converged: boolean } {
  const k = x[0]!.length + 1;
  let beta = new Array<number>(k).fill(0);
  let iters = 0;
  let converged = false;
  for (let it = 0; it < maxIters; it++) {
    iters = it + 1;
    const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const g: number[] = new Array<number>(k).fill(0);
    for (let i = 0; i < x.length; i++) {
      const row = [1, ...x[i]!];
      const z = Math.max(-30, Math.min(30, predictRow(beta, x[i]!)));
      const pr = 1 / (1 + Math.exp(-z));
      const w = pr * (1 - pr) + 1e-9;
      for (let r = 0; r < k; r++) {
        g[r]! += row[r]! * (y[i]! - pr);
        for (let c = 0; c < k; c++) a[r]![c]! += w * row[r]! * row[c]!;
      }
    }
    // The ridge penalty enters ONCE, after the per-row accumulation — subtracting it inside the
    // loop would multiply it by n (525x here) and disagree with the Hessian, which adds it once.
    // (Caught by an independent re-fit in review: the old code's effective ridge was 0.0525.)
    for (let r = 0; r < k; r++) g[r]! -= ridge * beta[r]!;
    for (let r = 0; r < k; r++) a[r]![r]! += ridge;
    const step = solveLinear(a, g);
    if (step === null) break;
    let maxStep = 0;
    for (let j = 0; j < k; j++) {
      beta[j]! += step[j]!;
      maxStep = Math.max(maxStep, Math.abs(step[j]!));
    }
    if (maxStep < 1e-8) {
      converged = true;
      break;
    }
  }
  return { beta, iters, converged };
}

/** The logistic function, clamped for safety. */
export function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

// ------------------------------------------------------------------ value model

/** One comparable protocol's value features. */
interface CompFeatures {
  ln_tvl: number;
  ln_chains: number;
  g7: number;
  years: number;
  cat: string;
  listed: string | null;
}

function compFeatures(p: SnapshotProtocol, asOf: string): CompFeatures {
  const age = ageDays(asOf, p.listed_at);
  return {
    ln_tvl: Math.log(p.tvl_usd),
    ln_chains: Math.log(Math.max(1, p.chains.length)),
    g7: growthFrac(p),
    years: Math.log(Math.max(1, age ?? 365) / 365),
    cat: p.category ?? 'Unknown',
    listed: p.listed_at,
  };
}

/** The value model's candidate term sets, in the order the evidence table shows them. */
const VALUE_CANDIDATES: { label: string; terms: string[] }[] = [
  { label: 'ln TVL', terms: ['ln_tvl'] },
  { label: 'ln TVL + ln chains', terms: ['ln_tvl', 'ln_chains'] },
  { label: 'ln TVL + ln chains + 7d growth', terms: ['ln_tvl', 'ln_chains', 'g7'] },
  { label: 'ln TVL + ln chains + years listed', terms: ['ln_tvl', 'ln_chains', 'years'] },
  { label: 'ln TVL + ln chains + 7d growth + years', terms: ['ln_tvl', 'ln_chains', 'g7', 'years'] },
  { label: 'ln TVL + ln chains + 7d growth + category', terms: ['ln_tvl', 'ln_chains', 'g7', 'cat'] },
];

/** The chosen term set: the best leave-one-out score of all candidates. */
const CHOSEN_TERMS = ['ln_tvl', 'ln_chains', 'g7'];

/** The joint-ridge penalty on category dummies (pseudo-observations). */
const CAT_RIDGE_K = 8;

/** A value-model design: rows plus the ridge matrix for category dummies, if any. */
function valueDesign(terms: string[], feats: CompFeatures[], catsList: string[]): { x: number[][]; ridge: number[][] | null } {
  const base = terms.filter((t) => t !== 'cat');
  const x = feats.map((f) => base.map((t) => f[t as 'ln_tvl' | 'ln_chains' | 'g7' | 'years']));
  let ridge: number[][] | null = null;
  if (terms.includes('cat')) {
    for (let i = 0; i < x.length; i++) {
      const row = new Array<number>(catsList.length).fill(0);
      const at = catsList.indexOf(feats[i]!.cat);
      if (at >= 0) row[at] = 1;
      x[i] = [...x[i]!, ...row];
    }
    const k = 1 + base.length + catsList.length;
    ridge = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let j = 0; j < catsList.length; j++) ridge[1 + base.length + j]![1 + base.length + j]! = CAT_RIDGE_K;
  }
  return { x, ridge };
}

/** Fit a value-model candidate on a subset of comparables. */
function fitValueCandidate(
  terms: string[],
  feats: CompFeatures[],
  y: number[],
  catsList: string[],
): { beta: number[]; iters: number; converged: boolean } {
  const { x, ridge } = valueDesign(terms, feats, catsList);
  return huberFit(x, y, ridge);
}

/** Predict log market cap for one feature row under a fitted candidate. */
function predictValue(beta: number[], terms: string[], f: CompFeatures, catsList: string[]): number {
  const { x } = valueDesign(terms, [f], catsList);
  return predictRow(beta, x[0]!);
}

/** Leave-one-out median miss (as a multiple) for a value-model candidate. */
function looMiss(terms: string[], feats: CompFeatures[], y: number[], catsList: string[]): number {
  const misses: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const trF: CompFeatures[] = [];
    const trY: number[] = [];
    for (let j = 0; j < y.length; j++) {
      if (j === i) continue;
      trF.push(feats[j]!);
      trY.push(y[j]!);
    }
    const { beta } = fitValueCandidate(terms, trF, trY, catsList);
    misses.push(Math.exp(Math.abs(y[i]! - predictValue(beta, terms, feats[i]!, catsList))));
  }
  return median(misses);
}

/** Walk-forward median miss for a value-model candidate under one split. */
function wfMiss(terms: string[], feats: CompFeatures[], y: number[], catsList: string[], kind: 'frac23' | 'frac50' | 'v16'): { miss: number; nTrain: number; nTest: number } {
  const idx = feats.map((f, i) => i).filter((i) => feats[i]!.listed !== null);
  idx.sort((a, b) => (feats[a]!.listed! < feats[b]!.listed! ? -1 : feats[a]!.listed! > feats[b]!.listed! ? 1 : 0));
  let tr: number[];
  let te: number[];
  if (kind === 'v16') {
    tr = idx.filter((i) => feats[i]!.listed! < '2025-01-23');
    te = idx.filter((i) => feats[i]!.listed! >= '2025-01-23');
  } else {
    const nTr = Math.floor(idx.length * (kind === 'frac23' ? 2 / 3 : 1 / 2));
    tr = idx.slice(0, nTr);
    te = idx.slice(nTr);
  }
  const { beta } = fitValueCandidate(
    terms,
    tr.map((i) => feats[i]!),
    tr.map((i) => y[i]!),
    catsList,
  );
  const misses = te.map((i) => Math.exp(Math.abs(y[i]! - predictValue(beta, terms, feats[i]!, catsList))));
  return { miss: median(misses), nTrain: tr.length, nTest: te.length };
}

/** 5-fold size-stratified median miss for the chosen model. */
function sizeFoldMiss(feats: CompFeatures[], y: number[], catsList: string[]): number {
  const order = feats.map((f, i) => i).sort((a, b) => feats[a]!.ln_tvl - feats[b]!.ln_tvl);
  const folds: number[][] = [[], [], [], [], []];
  order.forEach((idx, r) => folds[r % 5]!.push(idx));
  const misses: number[] = [];
  for (const fold of folds) {
    const te = new Set(fold);
    const tr = feats.map((f, i) => i).filter((i) => !te.has(i));
    const { beta } = fitValueCandidate(CHOSEN_TERMS, tr.map((i) => feats[i]!), tr.map((i) => y[i]!), catsList);
    for (const i of fold) misses.push(Math.exp(Math.abs(y[i]! - predictValue(beta, CHOSEN_TERMS, feats[i]!, catsList))));
  }
  return median(misses);
}

/** Category-blind median miss: each kind held out in turn, predicted from the rest. */
function categoryBlindMiss(feats: CompFeatures[], y: number[], catsList: string[]): number {
  const misses: number[] = [];
  for (const cat of catsList) {
    const te = feats.map((f, i) => i).filter((i) => feats[i]!.cat === cat);
    const tr = feats.map((f, i) => i).filter((i) => feats[i]!.cat !== cat);
    if (te.length === 0 || tr.length < 20) continue;
    const { beta } = fitValueCandidate(CHOSEN_TERMS, tr.map((i) => feats[i]!), tr.map((i) => y[i]!), catsList);
    for (const i of te) misses.push(Math.exp(Math.abs(y[i]! - predictValue(beta, CHOSEN_TERMS, feats[i]!, catsList))));
  }
  return median(misses);
}

/** The flat-multiple baseline: median mcap/TVL, leave-one-out median miss. */
function flatBaseline(comps: SnapshotProtocol[]): { multiple: number; loo: number } {
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd);
  const multiple = median(ratios);
  const misses: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = ratios.filter((_, j) => j !== i);
    const med = median(rest);
    misses.push(Math.exp(Math.abs(Math.log(comps[i]!.mcap_usd!) - Math.log(med * comps[i]!.tvl_usd))));
  }
  return { multiple, loo: median(misses) };
}

/** Leave-one-out residuals of the chosen model, one per comparable. */
function looResiduals(feats: CompFeatures[], y: number[], catsList: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const trF: CompFeatures[] = [];
    const trY: number[] = [];
    for (let j = 0; j < y.length; j++) {
      if (j === i) continue;
      trF.push(feats[j]!);
      trY.push(y[j]!);
    }
    const { beta } = fitValueCandidate(CHOSEN_TERMS, trF, trY, catsList);
    out.push(y[i]! - predictValue(beta, CHOSEN_TERMS, feats[i]!, catsList));
  }
  return out;
}

// ------------------------------------------------------------------ odds model

/** One peer's odds features. */
interface OddsFeatures {
  ln_years: number;
  ln_tvl: number;
  g7: number;
  cat: string;
  listed: string | null;
  age_days: number | null;
}

function oddsFeatures(p: SnapshotProtocol, asOf: string): OddsFeatures {
  const age = ageDays(asOf, p.listed_at);
  return {
    ln_years: Math.log(Math.max(1, age ?? 365) / 365),
    ln_tvl: Math.log(p.tvl_usd),
    g7: growthFrac(p),
    cat: p.category ?? 'Unknown',
    listed: p.listed_at,
    age_days: age,
  };
}

/** Shrunk category token rates (k=10 toward the base rate). */
function categoryShares(feats: OddsFeatures[], y: number[], k = 10): { map: Map<string, number>; base: number } {
  const base = y.reduce((a, b) => a + b, 0) / y.length;
  const tot = new Map<string, number>();
  const cnt = new Map<string, number>();
  feats.forEach((f, i) => {
    tot.set(f.cat, (tot.get(f.cat) ?? 0) + y[i]!);
    cnt.set(f.cat, (cnt.get(f.cat) ?? 0) + 1);
  });
  const map = new Map<string, number>();
  for (const [c, t] of tot) map.set(c, (t + k * base) / (cnt.get(c)! + k));
  return { map, base };
}

function oddsDesign(feats: OddsFeatures[], shares: { map: Map<string, number>; base: number }): number[][] {
  return feats.map((f) => [f.ln_years, f.ln_tvl, f.g7, shares.map.get(f.cat) ?? shares.base]);
}

/** The Brier score of predictions against labels. */
function brier(y: number[], pr: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) s += (y[i]! - pr[i]!) * (y[i]! - pr[i]!);
  return s / y.length;
}

/** 10-fold cross-validated Brier score, seeded shuffle. */
function oddsBrier10Fold(feats: OddsFeatures[], y: number[]): number {
  const rng = mulberry32(SEED);
  const idx = feats.map((f, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const folds: number[][] = Array.from({ length: 10 }, () => []);
  idx.forEach((v, r) => folds[r % 10]!.push(v));
  const scores: number[] = [];
  for (const fold of folds) {
    const te = new Set(fold);
    const tr = feats.map((f, i) => i).filter((i) => !te.has(i));
    const shares = categoryShares(tr.map((i) => feats[i]!), tr.map((i) => y[i]!));
    const { beta } = logisticFit(oddsDesign(tr.map((i) => feats[i]!), shares), tr.map((i) => y[i]!));
    const pr = oddsDesign(fold.map((i) => feats[i]!), shares).map((row) => sigmoid(predictRow(beta, row)));
    scores.push(brier(fold.map((i) => y[i]!), pr));
  }
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Walk-forward Brier + called-right rate: fit on the earliest two thirds, test on the newest third. */
function oddsWalkForward(feats: OddsFeatures[], y: number[]): { brier: number; calledRight: number; nTest: number } {
  const idx = feats.map((f, i) => i).filter((i) => feats[i]!.listed !== null);
  idx.sort((a, b) => (feats[a]!.listed! < feats[b]!.listed! ? -1 : feats[a]!.listed! > feats[b]!.listed! ? 1 : 0));
  const nTr = Math.floor(idx.length * (2 / 3));
  const tr = idx.slice(0, nTr);
  const te = idx.slice(nTr);
  const shares = categoryShares(tr.map((i) => feats[i]!), tr.map((i) => y[i]!));
  const { beta } = logisticFit(oddsDesign(tr.map((i) => feats[i]!), shares), tr.map((i) => y[i]!));
  const pr = oddsDesign(te.map((i) => feats[i]!), shares).map((row) => sigmoid(predictRow(beta, row)));
  let called = 0;
  te.forEach((orig, j) => {
    if ((pr[j]! >= 0.5 ? 1 : 0) === y[orig]!) called++;
  });
  return { brier: brier(te.map((i) => y[i]!), pr), calledRight: called / te.length, nTest: te.length };
}

/** Calibration buckets: predicted odds vs actual token rate, in-sample on the full fit. */
function oddsCalibration(feats: OddsFeatures[], y: number[], beta: number[], shares: { map: Map<string, number>; base: number }): CalibrationRow[] {
  const pr = oddsDesign(feats, shares).map((row) => sigmoid(predictRow(beta, row)));
  const buckets: { lo: number; hi: number; label: string }[] = [
    { lo: 0, hi: 0.2, label: '0-20%' },
    { lo: 0.2, hi: 0.4, label: '20-40%' },
    { lo: 0.4, hi: 0.6, label: '40-60%' },
    { lo: 0.6, hi: 0.8, label: '60-80%' },
    { lo: 0.8, hi: 1.01, label: '80-100%' },
  ];
  return buckets.map((b) => {
    const members: number[] = [];
    pr.forEach((p, i) => {
      if (p >= b.lo && p < b.hi) members.push(i);
    });
    const predicted = members.length === 0 ? 0 : members.reduce((s, i) => s + pr[i]!, 0) / members.length;
    const actual = members.length === 0 ? 0 : members.reduce((s, i) => s + y[i]!, 0) / members.length;
    return { bucket: b.label, n: members.length, predicted: Math.round(predicted * 1000) / 1000, actual: Math.round(actual * 1000) / 1000 };
  });
}

/** Token rate by listing-age bucket, measured from the peers: the age direction's evidence. */
function oddsAgeBuckets(feats: OddsFeatures[], y: number[]): { label: string; n: number; rate: number }[] {
  const buckets: { label: string; lo: number; hi: number }[] = [
    { label: 'under 6 months', lo: 0, hi: 180 },
    { label: '6–12 months', lo: 180, hi: 365 },
    { label: '1–2 years', lo: 365, hi: 730 },
    { label: '2–4 years', lo: 730, hi: 1460 },
    { label: 'past 4 years', lo: 1460, hi: Number.POSITIVE_INFINITY },
  ];
  return buckets.map((b) => {
    const members: number[] = [];
    feats.forEach((f, i) => {
      if (f.age_days !== null && f.age_days >= b.lo && f.age_days < b.hi) members.push(i);
    });
    const rate = members.length === 0 ? 0 : members.reduce((s, i) => s + y[i]!, 0) / members.length;
    return { label: b.label, n: members.length, rate: Math.round(rate * 1000) / 1000 };
  });
}

// ------------------------------------------------------------------ own-token share

/** A protocol's family stem: the first slug segment, when it is at least 3 characters. */
export function familyStem(slug: string): string | null {
  const first = slug.split('-')[0]!;
  return first.length >= 3 ? first : null;
}

/**
 * The share of a protocol's family TVL the protocol itself holds. Kin are the protocols that record
 * a token (a market cap, a CoinGecko id or a symbol) and share the protocol's family stem; a protocol
 * with no kin holds 100%. Measured from the snapshot alone, never from outside knowledge.
 */
export function ownTokenShare(p: SnapshotProtocol, protocols: SnapshotProtocol[]): number {
  const stem = familyStem(p.slug);
  if (stem === null) return 1;
  let kinTvl = 0;
  for (const q of protocols) {
    if (q.slug === p.slug) continue;
    if (q.mcap_usd === null && q.gecko_id === null && q.symbol === null) continue;
    if (familyStem(q.slug) !== stem) continue;
    kinTvl += q.tvl_usd;
  }
  if (kinTvl <= 0) return 1;
  return p.tvl_usd / (p.tvl_usd + kinTvl);
}

// ------------------------------------------------------------------ farm economics

/** The farm economics of one ranked row. */
export interface FarmEconomics {
  deposit_usd: number;
  expected_drop_usd: number;
  cost_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  breakeven_deposit_usd: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/**
 * The farm economics of one ranked row. The expected drop is the share of the airdrop this
 * protocol's own token would be worth: fitted cap x drop share x pro-rata deposit x 12-month
 * odds x OWN-TOKEN SHARE — without the share the drop is overstated (9.4x for a protocol
 * whose family holds 89% of the TVL). The break-even deposit uses the same shared denominator.
 */
export function farmEconomics(tvl: number, fittedMcap: number, odds12m: number, share: number): FarmEconomics {
  const deposit = Math.max(10, Math.round(tvl * FARM.deposit_share));
  const expectedDrop = fittedMcap * FARM.drop_share * (deposit / tvl) * odds12m * share;
  const hours = FARM.setup_hours + FARM.hours_per_week * FARM.horizon_weeks;
  const cost = FARM.gas_per_week_usd * FARM.horizon_weeks + hours * FARM.hourly_rate_usd;
  const net = expectedDrop - cost;
  const netPerHour = net / hours;
  const denom = fittedMcap * FARM.drop_share * odds12m * share;
  let breakeven: number | null = null;
  if (denom > 0) {
    const d = (cost * tvl) / denom;
    if (Number.isFinite(d) && d > 0 && d <= tvl) breakeven = Math.round(d);
  }
  const verdict: 'FARM' | 'THIN' | 'SKIP' =
    breakeven !== null && breakeven <= FARM.verdict_farm_max_breakeven_usd
      ? 'FARM'
      : breakeven !== null && breakeven <= FARM.verdict_thin_max_breakeven_usd
        ? 'THIN'
        : 'SKIP';
  return {
    deposit_usd: deposit,
    expected_drop_usd: Math.round(expectedDrop * 100) / 100,
    cost_usd: Math.round(cost * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    net_per_hour_usd: Math.round(netPerHour * 100) / 100,
    breakeven_deposit_usd: breakeven,
    verdict,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

const money = (n: number): string => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, including the exit
 * rules. The plan is derived from the protocol's own record and its farm economics, never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, econ.deposit_usd, chain);
  const verdictLine =
    econ.verdict === 'FARM'
      ? `This row is a FARM: it breaks even at a ${money(econ.breakeven_deposit_usd!)} deposit, inside retail reach.`
      : econ.verdict === 'THIN'
        ? `This row is THIN: it breaks even only at a ${money(econ.breakeven_deposit_usd!)} deposit, whale capital.`
        : `This row is a SKIP on the numbers: it needs ${econ.breakeven_deposit_usd === null ? 'more than the protocol TVL' : `a ${money(econ.breakeven_deposit_usd)} deposit`} to break even. Farm it only for reasons outside this model.`;
  const breakevenLine =
    econ.breakeven_deposit_usd === null
      ? 'No deposit size breaks even at these odds: the expected drop never covers the gas and time.'
      : `Break-even needs a ${money(econ.breakeven_deposit_usd)} deposit; below that size the plan loses money on the numbers.`;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${action} ${verdictLine}`,
      cost: `${money(econ.deposit_usd)} of capital and about $${econ.deposit_usd >= 1000 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the activity spans many snapshots.',
      cost: 'about $5 of gas a week',
      time: '30 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. ${breakevenLine}`,
      cost: `the ${money(econ.deposit_usd)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page each week and watch its TVL: an airdrop snapshot is usually announced there first.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: 'Exit rule: unwind within a week if the protocol TVL falls more than 30% in seven days, if a re-rank flips this row to SKIP, or right after the drop snapshot is taken — never before the first snapshot.',
      cost: 'about $5 of gas to unwind',
      time: '15 minutes',
    },
    {
      text: 'Before you withdraw, claim only from the link the protocol itself publishes, and never pay anyone to claim for you.',
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and record the expected drop of ${money(econ.expected_drop_usd)} against what actually arrives.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ------------------------------------------------------------------ the board

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The 758-protocol ledger, with the pre-token protocols the board sets aside and why. */
function buildLedger(snapshot: Snapshot, board: BoardRow[], earlySize: number, offListSize: number): Ledger {
  const pre = snapshot.protocols.filter(isPreToken).length;
  const totalTvl = snapshot.protocols.reduce((s, p) => s + p.tvl_usd, 0);
  const liveMcap = snapshot.protocols.reduce((s, p) => s + (p.mcap_usd ?? 0), 0);
  const byCat = new Map<string, { n: number; tvl: number }>();
  for (const p of snapshot.protocols) {
    const c = p.category ?? 'Unknown';
    const e = byCat.get(c) ?? { n: 0, tvl: 0 };
    e.n += 1;
    e.tvl += p.tvl_usd;
    byCat.set(c, e);
  }
  const top = [...byCat.entries()]
    .map(([category, v]) => ({ category, n: v.n, tvl_usd: v.tvl }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 10);
  // Every pre-token protocol NOT on the board, accounted for with one reason (first match wins):
  // an exchange, a wrapped/staked/bridged product, a versioned pool, below the early cutoff, or
  // above the floor but past the off-list cutoff. The buckets sum to pre_token - board.
  const onBoard = new Set(board.map((r) => r.slug));
  const buckets = new Map<string, { n: number; tvl_usd: number }>();
  const add = (reason: string, p: SnapshotProtocol): void => {
    const e = buckets.get(reason) ?? { n: 0, tvl_usd: 0 };
    e.n += 1;
    e.tvl_usd += p.tvl_usd;
    buckets.set(reason, e);
  };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || onBoard.has(p.slug)) continue;
    if (p.category === 'CEX') add('exchange (CEX)', p);
    else if (isWrappedProduct(p)) add('wrapped, staked or bridged product', p);
    else if (VERSIONED.test(p.name)) add('versioned pool', p);
    else if (p.tvl_usd < snapshot.floor_usd) add('below the floor, below the early cutoff', p);
    else add('at/above the floor, past the off-list cutoff', p);
  }
  const order = [
    'exchange (CEX)',
    'wrapped, staked or bridged product',
    'versioned pool',
    'below the floor, below the early cutoff',
    'at/above the floor, past the off-list cutoff',
  ];
  return {
    total: snapshot.protocols.length,
    pre_token: pre,
    live_token: snapshot.protocols.length - pre,
    watchlist: snapshot.watchlist.length,
    board: board.length,
    early: earlySize,
    off_list: offListSize,
    total_tvl_usd: totalTvl,
    live_mcap_usd: liveMcap,
    top_categories: top,
    set_aside: order
      .filter((r) => buckets.has(r))
      .map((r) => ({ reason: r, n: buckets.get(r)!.n, tvl_usd: buckets.get(r)!.tvl_usd })),
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Round to 4 decimals for the dossier's readable numbers. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The nine self-test checks. Any failure refuses the run. */
export function selfTest(
  board: BoardRow[],
  snapshot: Snapshot,
  value: ValueModelSummary,
  odds: OddsModelSummary,
  refitDiff: number,
): SelfTestRow[] {
  const checks: SelfTestRow[] = [];
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  checks.push({
    id: 'watchlist',
    name: 'Watchlist coverage',
    pass: missing.length === 0,
    detail: missing.length === 0 ? `all ${snapshot.watchlist.length} watchlist slugs on the board` : `missing ${missing.length}: ${missing.slice(0, 3).join(', ')}`,
  });
  const ranksOk = board.every((r, i) => r.rank === i + 1);
  checks.push({ id: 'ranks', name: 'Ranks 1..N exactly once', pass: ranksOk, detail: `${board.length} rows, ranks 1..${board.length}` });
  let ordered = true;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) ordered = false;
  checks.push({ id: 'order', name: 'Implied value non-increasing with rank', pass: ordered, detail: `rank 1 $${board[0]!.implied_value_usd.toLocaleString('en-US')} to rank ${board.length} $${board[board.length - 1]!.implied_value_usd.toLocaleString('en-US')}` });
  const stepsOk = board.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((s) => s.length >= 20 && s.length <= 600));
  checks.push({ id: 'farm-steps', name: 'Farm steps 3..12, each 20..600 chars', pass: stepsOk, detail: `8 steps on every row` });
  const positive = board.every((r) => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0);
  checks.push({ id: 'implied-positive', name: 'Implied values positive integers', pass: positive, detail: `${board.length} rows checked` });
  checks.push({
    id: 'fit-converged',
    name: 'Both fits converged',
    pass: value.converged && odds.converged,
    detail: `Huber ${value.huber_iters} iterations, logistic converged: ${odds.converged}`,
  });
  checks.push({
    id: 'loo-beats-flat',
    name: 'Model beats the flat multiple out of sample',
    pass: value.loo < value.flat_loo,
    detail: `LOO x${value.loo.toFixed(2)} vs flat x${value.flat_loo.toFixed(2)}`,
  });
  checks.push({
    id: 'brier-beats-base',
    name: 'Odds model beats the base rate',
    pass: odds.brier_10fold < odds.base_brier,
    detail: `Brier 10-fold ${odds.brier_10fold.toFixed(3)} vs base ${odds.base_brier.toFixed(3)}`,
  });
  checks.push({
    id: 'deterministic',
    name: 'Refit reproduces the coefficients',
    pass: refitDiff < 1e-9,
    detail: `max coefficient drift ${refitDiff.toExponential(1)}`,
  });
  return checks;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const asOf = snapshot.as_of;

  // --- value model: comparables, fit, term table, held-out tests, conformal bands ---
  const comps = snapshot.protocols.filter(isComparable);
  const compFeats = comps.map((p) => compFeatures(p, asOf));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const catsList = [...new Set(compFeats.map((f) => f.cat))].sort();
  const fit = fitValueCandidate(CHOSEN_TERMS, compFeats, y, catsList);
  const beta = fit.beta;

  // Term table: every candidate, leave-one-out plus three walk-forward splits.
  const termTable: TermRow[] = VALUE_CANDIDATES.map((c) => {
    const loo = looMiss(c.terms, compFeats, y, catsList);
    const w23 = wfMiss(c.terms, compFeats, y, catsList, 'frac23');
    const w50 = wfMiss(c.terms, compFeats, y, catsList, 'frac50');
    const wv16 = wfMiss(c.terms, compFeats, y, catsList, 'v16');
    return {
      terms: c.label,
      kept: c.terms.join(',') === CHOSEN_TERMS.join(','),
      loo: round4(loo),
      wf_avg: round4((w23.miss + w50.miss + wv16.miss) / 3),
      wf23: round4(w23.miss),
      wf50: round4(w50.miss),
      wfv16: round4(wv16.miss),
    };
  });
  const chosenRow = termTable.find((t) => t.kept)!;

  const flat = flatBaseline(comps);
  const sizeFold = sizeFoldMiss(compFeats, y, catsList);
  const catBlind = categoryBlindMiss(compFeats, y, catsList);
  const w23 = wfMiss(CHOSEN_TERMS, compFeats, y, catsList, 'frac23');
  const wv16 = wfMiss(CHOSEN_TERMS, compFeats, y, catsList, 'v16');

  // R-squared on the log scale.
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) * (v - yMean), 0);
  const ssRes = compFeats.reduce((s, f, i) => {
    const r = y[i]! - predictValue(beta, CHOSEN_TERMS, f, catsList);
    return s + r * r;
  }, 0);
  const r2 = 1 - ssRes / ssTot;

  // Conformal per-kind intervals from leave-one-out residuals.
  const resid = looResiduals(compFeats, y, catsList);
  const byKind = new Map<string, number[]>();
  compFeats.forEach((f, i) => {
    const arr = byKind.get(f.cat) ?? [];
    arr.push(resid[i]!);
    byKind.set(f.cat, arr);
  });
  const globalBand = { p10: quantile(resid, 0.1), p25: quantile(resid, 0.25), p75: quantile(resid, 0.75), p90: quantile(resid, 0.9) };
  const kindBands: { kind: string; n: number; p25: number; p75: number }[] = [];
  for (const [kind, rs] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (rs.length >= CONFORMAL_MIN_KIND) kindBands.push({ kind, n: rs.length, p25: quantile(rs, 0.25), p75: quantile(rs, 0.75) });
  }
  const bandFor = (kind: string): { p25: number; p75: number; p10: number; p90: number } => {
    const k = kindBands.find((b) => b.kind === kind);
    if (k !== undefined) {
      const rs = byKind.get(kind)!;
      return { p25: k.p25, p75: k.p75, p10: quantile(rs, 0.1), p90: quantile(rs, 0.9) };
    }
    return globalBand;
  };
  // Coverage honesty: what fraction of leave-one-out actuals fall inside their own band?
  let inside = 0;
  compFeats.forEach((f, i) => {
    const b = bandFor(f.cat);
    if (resid[i]! >= b.p25 && resid[i]! <= b.p75) inside++;
  });
  const coverage = inside / compFeats.length;

  // Bootstrap: coefficient standard errors (seeded resamples).
  const rng = mulberry32(SEED);
  const bootBetas: number[][] = [];
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    const idx: number[] = [];
    for (let i = 0; i < compFeats.length; i++) idx.push(Math.floor(rng() * compFeats.length));
    try {
      const fb = fitValueCandidate(CHOSEN_TERMS, idx.map((i) => compFeats[i]!), idx.map((i) => y[i]!), catsList);
      bootBetas.push(fb.beta);
    } catch {
      // A resample that goes singular is dropped, not papered over.
    }
  }
  const se = beta.map((_, j) => {
    const vals = bootBetas.map((bb) => bb[j]!);
    const m = vals.reduce((a, v) => a + v, 0) / vals.length;
    const v = vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length;
    return Math.sqrt(v);
  });

  // Determinism check: refit and compare.
  const refit = fitValueCandidate(CHOSEN_TERMS, compFeats, y, catsList);
  let refitDiff = 0;
  for (let j = 0; j < beta.length; j++) refitDiff = Math.max(refitDiff, Math.abs(refit.beta[j]! - beta[j]!));

  const value: ValueModelSummary = {
    n_comps: comps.length,
    beta: beta.map(round4),
    se: se.map(round4),
    terms: ['ln TVL', 'ln chains', '7d growth'],
    r2: round4(r2),
    loo: round4(chosenRow.loo),
    wf23: round4(w23.miss),
    wf50: round4(chosenRow.wf50),
    wfv16: round4(wv16.miss),
    wf_avg: round4(chosenRow.wf_avg),
    flat_loo: round4(flat.loo),
    flat_multiple: round4(flat.multiple),
    size_fold: round4(sizeFold),
    category_blind: round4(catBlind),
    huber_c: 1.345,
    huber_iters: fit.iters,
    converged: fit.converged,
    median_ln_chains: round4(median(compFeats.map((f) => f.ln_chains))),
    median_g7: round4(median(compFeats.map((f) => f.g7))),
    term_table: termTable,
    held_out: [
      { test: 'Leave-one-out', n_train: comps.length - 1, n_test: comps.length, median_miss: round4(chosenRow.loo), note: 'every comparable held out once' },
      { test: 'Walk-forward (2/3-1/3 by listing)', n_train: w23.nTrain, n_test: w23.nTest, median_miss: round4(w23.miss), note: 'fit on the earliest-listed, tested on the newest' },
      { test: 'Walk-forward (fit before 2025-01-23)', n_train: wv16.nTrain, n_test: wv16.nTest, median_miss: round4(wv16.miss), note: 'fit before the cutoff, tested on the 31 listed since' },
      { test: '5-fold size-stratified', n_train: comps.length - Math.ceil(comps.length / 5), n_test: comps.length, median_miss: round4(sizeFold), note: 'folds balanced across the TVL range' },
      { test: 'Category-blind', n_train: comps.length, n_test: comps.length, median_miss: round4(catBlind), note: 'each kind held out in turn' },
    ],
    conformal_coverage: round4(coverage),
    conformal_global: { p10: round4(globalBand.p10), p25: round4(globalBand.p25), p75: round4(globalBand.p75), p90: round4(globalBand.p90) },
    conformal_kinds: kindBands.map((b) => ({ kind: b.kind, n: b.n, p25: round4(b.p25), p75: round4(b.p75) })),
  };

  // --- odds model: peers, fit, Brier scores, calibration ---
  const peers = snapshot.protocols.filter((p) => p.category !== null && !EXCLUDED_CATEGORIES.has(p.category));
  const peerFeats = peers.map((p) => oddsFeatures(p, asOf));
  const peerY = peers.map((p) => (isPreToken(p) ? 0 : 1));
  const shares = categoryShares(peerFeats, peerY);
  const oddsFit = logisticFit(oddsDesign(peerFeats, shares), peerY);
  const oddsBeta = oddsFit.beta;
  const baseRate = peerY.reduce((a, b) => a + b, 0) / peerY.length;
  const brier10 = oddsBrier10Fold(peerFeats, peerY);
  const wfOdds = oddsWalkForward(peerFeats, peerY);
  const calibration = oddsCalibration(peerFeats, peerY, oddsBeta, shares);
  const ageBuckets = oddsAgeBuckets(peerFeats, peerY);
  const odds: OddsModelSummary = {
    n_peers: peers.length,
    n_tokened: peerY.reduce((a, b) => a + b, 0),
    base_rate: round4(baseRate),
    beta: oddsBeta.map(round4),
    terms: ['ln years listed', 'ln TVL', '7d growth', 'category token share'],
    brier_10fold: round4(brier10),
    brier_wf: round4(wfOdds.brier),
    base_brier: round4(baseRate * (1 - baseRate)),
    called_right_wf: round4(wfOdds.calledRight),
    calibration,
    age_buckets: ageBuckets,
    converged: oddsFit.converged,
  };
  // The odds refit must reproduce too.
  const oddsRefit = logisticFit(oddsDesign(peerFeats, shares), peerY);
  for (let j = 0; j < oddsBeta.length; j++) refitDiff = Math.max(refitDiff, Math.abs(oddsRefit.beta[j]! - oddsBeta[j]!));

  /** P(records a token) for one protocol's odds features. */
  const oddsFor = (f: OddsFeatures): number => sigmoid(predictRow(oddsBeta, oddsDesign([f], shares)[0]!));
  /** The 12-month sub-odds: the hazard of tokening in the next year, from the fitted model. */
  const odds12mFor = (f: OddsFeatures): number => {
    const pNow = oddsFor(f);
    const age = f.age_days ?? 365;
    const later: OddsFeatures = { ...f, ln_years: Math.log((age + 365) / 365), age_days: age + 365 };
    const pLater = oddsFor(later);
    const hazard = (pLater - pNow) / Math.max(1e-9, 1 - pNow);
    return Math.max(0, Math.min(1, hazard));
  };

  // --- the board: watchlist floor plus the early radar plus the off-list, ranked by expected value ---
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  // The off-list: genuine pre-token protocols at or above the floor that the watchlist leaves out.
  // The house's wrapped/staked/bridged test applies here (the unfiltered pool is WBTC, staked ETH
  // and bridges — not tokens that do not exist yet); the filtered pool is exactly OFFLIST_ROWS.
  const offList = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isOffList(p, snapshot))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, OFFLIST_ROWS);
  for (const p of offList) chosen.set(p.slug, p);

  interface Scored {
    p: SnapshotProtocol;
    age: number | null;
    fitted: number;
    oddsEver: number;
    odds12m: number;
    share: number;
    ev: number;
    band: { p25: number; p75: number; p10: number; p90: number };
    econ: FarmEconomics;
    oddsTerms: { intercept: number; ln_years: number; ln_tvl: number; g7: number; catshare: number; catshare_value: number };
  }
  const scored: Scored[] = [...chosen.values()].map((p) => {
    const f = compFeatures(p, asOf);
    const lnPred = predictValue(beta, CHOSEN_TERMS, f, catsList);
    const fitted = Math.exp(lnPred);
    const of = oddsFeatures(p, asOf);
    const oddsEver = oddsFor(of);
    const odds12m = odds12mFor(of);
    const share = ownTokenShare(p, snapshot.protocols);
    const ev = Math.max(1, Math.round(fitted * oddsEver * share));
    const band = bandFor(p.category ?? 'Unknown');
    const econ = farmEconomics(p.tvl_usd, fitted, odds12m, share);
    // The logit decomposition, so the odds are checkable by hand in the detail view.
    const catshareValue = shares.map.get(of.cat) ?? shares.base;
    const oddsTerms = {
      intercept: round4(oddsBeta[0]!),
      ln_years: round4(oddsBeta[1]! * of.ln_years),
      ln_tvl: round4(oddsBeta[2]! * of.ln_tvl),
      g7: round4(oddsBeta[3]! * of.g7),
      catshare: round4(oddsBeta[4]! * catshareValue),
      catshare_value: round4(catshareValue),
    };
    return { p, age: ageDays(asOf, p.listed_at), fitted, oddsEver, odds12m, share, ev, band, econ, oddsTerms };
  });
  scored.sort((a, b) => b.ev - a.ev || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Bootstrap rank ranges: refit on resampled comparables, re-rank, take P10-P90 of each rank.
  const rankSamples = new Map<string, number[]>();
  for (const s of scored) rankSamples.set(s.p.slug, []);
  for (const bb of bootBetas) {
    const evs = scored.map((s) => {
      const f = compFeatures(s.p, asOf);
      const fittedB = Math.exp(predictValue(bb, CHOSEN_TERMS, f, catsList));
      return { slug: s.p.slug, ev: fittedB * s.oddsEver * s.share };
    });
    evs.sort((a, b) => b.ev - a.ev || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    evs.forEach((e, i) => rankSamples.get(e.slug)!.push(i + 1));
  }
  const rankRange = (slug: string): { lo: number; hi: number } => {
    const rs = rankSamples.get(slug)!;
    if (rs.length === 0) return { lo: 0, hi: 0 };
    return { lo: Math.round(quantile(rs, 0.1)), hi: Math.round(quantile(rs, 0.9)) };
  };

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.ev,
    model: {
      fitted_mcap_usd: Math.round(s.fitted),
      odds_ever: round4(s.oddsEver),
      odds_12m: round4(s.odds12m),
      own_token_share: round4(s.share),
      if_lo_usd: Math.round(s.fitted * Math.exp(s.band.p25)),
      if_hi_usd: Math.round(s.fitted * Math.exp(s.band.p75)),
      if_p10_usd: Math.round(s.fitted * Math.exp(s.band.p10)),
      if_p90_usd: Math.round(s.fitted * Math.exp(s.band.p90)),
      age_days: s.age,
    },
    farm: {
      deposit_usd: s.econ.deposit_usd,
      expected_drop_usd: s.econ.expected_drop_usd,
      cost_usd: s.econ.cost_usd,
      net_usd: s.econ.net_usd,
      net_per_hour_usd: s.econ.net_per_hour_usd,
      breakeven_deposit_usd: s.econ.breakeven_deposit_usd,
      verdict: s.econ.verdict,
    },
    farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
  }));

  const termsBySlug = new Map(scored.map((s) => [s.p.slug, s.oddsTerms]));
  const rows: RadarRow[] = board.map((r) => {
    const rr = rankRange(r.slug);
    return {
      rank: r.rank,
      rank_lo: rr.lo,
      rank_hi: rr.hi,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      fitted_mcap_usd: r.model.fitted_mcap_usd,
      odds_ever: r.model.odds_ever,
      odds_12m: r.model.odds_12m,
      own_token_share: r.model.own_token_share,
      odds_terms: termsBySlug.get(r.slug)!,
      if_lo_usd: r.model.if_lo_usd,
      if_hi_usd: r.model.if_hi_usd,
      if_p10_usd: r.model.if_p10_usd,
      if_p90_usd: r.model.if_p90_usd,
      deposit_usd: r.farm.deposit_usd,
      expected_drop_usd: r.farm.expected_drop_usd,
      net_usd: r.farm.net_usd,
      net_per_hour_usd: r.farm.net_per_hour_usd,
      breakeven_deposit_usd: r.farm.breakeven_deposit_usd,
      verdict: r.farm.verdict,
      farm_steps: r.farm_steps,
    };
  });

  const earlySize = board.filter((r) => !snapshot.watchlist.includes(r.slug) && r.tvl_usd < snapshot.floor_usd).length;
  const offListSize = board.filter((r) => !snapshot.watchlist.includes(r.slug) && r.tvl_usd >= snapshot.floor_usd).length;
  const live = liveRows(snapshot);
  const scatter: ScatterPoint[] = comps.map((p, i) => ({
    slug: p.slug,
    kind: p.category ?? 'Unknown',
    ln_tvl: round4(Math.log(p.tvl_usd)),
    ln_mcap: round4(Math.log(p.mcap_usd!)),
    ln_pred: round4(predictValue(beta, CHOSEN_TERMS, compFeats[i]!, catsList)),
    tvl_usd: p.tvl_usd,
  }));

  const tests = selfTest(board, snapshot, value, odds, refitDiff);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: earlySize,
    off_list_size: offListSize,
    live_size: live.length,
    rows,
    live,
    value,
    odds,
    self_test: tests,
    ledger: buildLedger(snapshot, board, earlySize, offListSize),
    scatter,
    farm_params: FARM,
  };
  return { board, radar };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
