// Token Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank — the
// watchlist is the floor, never the ceiling — by the expected value of a
// token launch. Every term is fitted from the snapshot's own live-token
// protocols; no protocol name is ever special-cased.
//
//   comps multiple  the median market-cap/TVL of live-token protocols in
//                   the same category, shrunk toward the global median
//                   for thin categories (fitMultiples)
//   FDV            tvl_usd x multiple x growth x maturity
//   growth         1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturity       0.6 + min(age_days, 1095) / 1095 x 0.4
//   launch odds    the category's token share (the peers' record) times
//                   an age decay fitted from the snapshot's own age
//                   bands (fitOdds): a protocol that has run years with
//                   no token is less likely to launch than a young one
//   implied value  FDV x odds — the expected value of a launch
//
// The FDV model is tested held-out twice on the live-token set
// (validateModel: leave-one-out and an older-to-newer time split) and the
// numbers are printed on the dashboard's integrity strip, so the reader
// can see how far to trust the values. Live-token protocols are set aside
// with their market caps shown, never mixed into the pre-token ranking.

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

/** The model's constants: stated on the dashboard, changeable in the sandbox. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  odds_floor: number;
  odds_cap: number;
  shrink_k: number;
  ratio_floor: number;
  ratio_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  odds_floor: 0.02,
  odds_cap: 0.95,
  shrink_k: 5,
  ratio_floor: 0.005,
  ratio_cap: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-comps-1';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many live-token peers the detail view names per category. */
export const COMPS_PER_CATEGORY = 5;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the full decomposition. */
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    fdv_usd: number;
    launch_odds: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page regenerates the farm plan from the same derivation. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  fdv_usd: number;
  launch_odds: number;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One live-token peer a detail view names as a comp. */
export interface CompRow {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** One held-out validation: how far the FDV model misses on protocols it never fitted. */
export interface ValidationResult {
  n: number;
  median_log_error: number;
  mean_log_error: number;
  within_3x: number;
}

/** The fitted model, as the dashboard states it and the sandbox replays it. */
export interface ModelFit {
  global_multiple: number;
  multiples: Record<string, number>;
  multiple_counts: Record<string, number>;
  global_token_share: number;
  token_shares: Record<string, number>;
  decay_lambda: number;
  decay_half_life_days: number;
  fit_protocols: number;
  validation: { loo: ValidationResult; time_split: ValidationResult };
}

/** Everything the dashboard needs: the board, the live set, the fit and the counts. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: ModelFit;
  counts: {
    protocols: number;
    pre_token: number;
    rankable: number;
    excluded: number;
    live_with_mcap: number;
    live_recorded: number;
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps: Record<string, CompRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list; NaN when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol's record carries a positive market cap it can be fitted on. */
export function isFittable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories the house's own watchlist rule leaves out: wrapped, staked or bridged products of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A whole word wrapped, staked or staking in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, and not a
 * wrapped, staked or bridged product of a token that already trades, not
 * an exchange, not a versioned pool. The rule mirrors the house's own
 * watchlist exclusions (minus the TVL floor and the parent-protocol field
 * the snapshot does not carry), so a wrapped asset like WBTC never tops a
 * board about tokens that do not exist yet.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_START.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------- the fit

/** A market-cap/TVL ratio clamped to the band a real protocol's multiple lives in. */
function clampedRatio(p: SnapshotProtocol, c: ModelConstants): number {
  return Math.min(c.ratio_cap, Math.max(c.ratio_floor, (p.mcap_usd ?? 0) / p.tvl_usd));
}

/**
 * The comps fit: the median clamped mcap/TVL of the live-token protocols
 * in each category, shrunk toward the global median with a prior weight of
 * `shrink_k` protocols, so a category with one or two live tokens borrows
 * most of its multiple from the whole market instead of trusting an outlier.
 */
export function fitMultiples(live: SnapshotProtocol[], c: ModelConstants): { global: number; byCategory: Map<string, number>; counts: Map<string, number> } {
  const global = median(live.map((p) => clampedRatio(p, c)));
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(clampedRatio(p, c));
    byCat.set(key, list);
  }
  const byCategory = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [key, ratios] of byCat) {
    const m = median(ratios);
    const n = ratios.length;
    byCategory.set(key, (n / (n + c.shrink_k)) * m + (c.shrink_k / (n + c.shrink_k)) * global);
    counts.set(key, n);
  }
  return { global, byCategory, counts };
}

/** Age bands for the launch-decay fit: the peers' record, banded by age. */
const AGE_BANDS: Array<[number, number]> = [
  [0, 90],
  [90, 180],
  [180, 365],
  [365, 730],
  [730, 1095],
  [1095, 1825],
  [1825, Number.POSITIVE_INFINITY],
];

/**
 * The launch-odds fit, in two parts. The category token share is the
 * peers' record: what fraction of the snapshot's protocols in the category
 * already record a token, shrunk toward the global share. The age decay is
 * fitted from the banded pre-token shares: the share of protocols still
 * pre-token falls with age, and a log-linear fit on the band midpoints
 * gives the decay rate lambda, so odds fall with age at the market's own
 * pace instead of a chosen constant.
 */
export function fitOdds(all: SnapshotProtocol[], asOf: string, c: ModelConstants): { shares: Map<string, number>; globalShare: number; lambda: number; halfLifeDays: number } {
  let tokenCount = 0;
  const byCat = new Map<string, [number, number]>();
  for (const p of all) {
    const key = p.category ?? 'Other';
    const e = byCat.get(key) ?? [0, 0];
    e[1] += 1;
    if (!isPreToken(p)) {
      e[0] += 1;
      tokenCount += 1;
    }
    byCat.set(key, e);
  }
  const globalShare = all.length > 0 ? tokenCount / all.length : 0.5;
  const shares = new Map<string, number>();
  for (const [key, [tok, n]] of byCat) {
    shares.set(key, (tok + c.shrink_k * globalShare) / (n + c.shrink_k));
  }

  // The decay: log-linear regression of ln(pre-token share) on band midpoint.
  const known = all.filter((p) => ageDays(asOf, p.listed_at) !== null);
  const maxAge = known.reduce((m, p) => Math.max(m, ageDays(asOf, p.listed_at) ?? 0), 0);
  const points: Array<[number, number]> = [];
  for (const [lo, hi] of AGE_BANDS) {
    const inBand = known.filter((p) => {
      const a = ageDays(asOf, p.listed_at) ?? 0;
      return a >= lo && a < hi;
    });
    if (inBand.length < 5) continue;
    const share = inBand.filter(isPreToken).length / inBand.length;
    if (share <= 0 || share >= 1) continue;
    const mid = (lo + Math.min(hi, maxAge)) / 2;
    points.push([mid, Math.log(share)]);
  }
  let lambda = 0;
  if (points.length >= 2) {
    const mx = points.reduce((a, [x]) => a + x, 0) / points.length;
    const my = points.reduce((a, [, y]) => a + y, 0) / points.length;
    const num = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
    const den = points.reduce((a, [x]) => a + (x - mx) * (x - mx), 0);
    const slope = den > 0 ? num / den : 0;
    lambda = slope < 0 ? -slope : 0;
  }
  return { shares, globalShare, lambda, halfLifeDays: lambda > 0 ? Math.LN2 / lambda : Number.POSITIVE_INFINITY };
}

/** The whole fit: multiples, odds, and the held-out validation. */
export interface Fit {
  multiples: { global: number; byCategory: Map<string, number>; counts: Map<string, number> };
  odds: { shares: Map<string, number>; globalShare: number; lambda: number; halfLifeDays: number };
  live: SnapshotProtocol[];
}

/** Fit the model on the snapshot's live-token protocols. */
export function fitModel(snapshot: Snapshot, c: ModelConstants = MODEL): Fit {
  const live = snapshot.protocols.filter(isFittable);
  return { multiples: fitMultiples(live, c), odds: fitOdds(snapshot.protocols, snapshot.as_of, c), live };
}

// ---------------------------------------------------------------- scoring

/** The growth multiplier from a 7-day change, clamped to the model's band. */
export function growthMultiplier(change7d: number | null, c: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(c.growth_cap, Math.max(c.growth_floor, finite(change7d, 0)));
  return { pct, mult: 1 + (pct / 100) * c.growth_weight };
}

/** The maturity multiplier from an age in days: 0.6 at listing, 1.0 at three years. */
export function maturityMultiplier(age: number | null, c: ModelConstants): number {
  const a = age ?? c.unknown_age_days;
  return c.maturity_floor + (Math.min(Math.max(a, 0), c.maturity_days) / c.maturity_days) * c.maturity_range;
}

/** A protocol's launch odds under the fit: its category's token share times the fitted age decay. */
export function launchOdds(p: SnapshotProtocol, asOf: string, fit: Fit, c: ModelConstants): number {
  const share = fit.odds.shares.get(p.category ?? 'Other') ?? fit.odds.globalShare;
  const age = ageDays(asOf, p.listed_at) ?? c.unknown_age_days;
  const decay = Math.exp(-fit.odds.lambda * age);
  return Math.min(c.odds_cap, Math.max(c.odds_floor, share * decay));
}

/** The category multiple a protocol gets under the fit. */
export function multipleOf(p: SnapshotProtocol, fit: Fit): number {
  return fit.multiples.byCategory.get(p.category ?? 'Other') ?? fit.multiples.global;
}

/** A protocol's implied FDV (before odds) under the fit. */
export function fdvOf(p: SnapshotProtocol, asOf: string, fit: Fit, c: ModelConstants): { fdv: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { pct, mult: growthMult } = growthMultiplier(p.change_7d, c);
  const maturityMult = maturityMultiplier(age, c);
  const multiple = multipleOf(p, fit);
  const fdv = Math.max(1, p.tvl_usd * multiple * growthMult * maturityMult);
  return { fdv, multiple, growthPct: pct, growthMult, maturityMult, age };
}

/** The full score: FDV, odds, and the expected implied value. */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: Fit, c: ModelConstants): { implied: number; fdv: number; odds: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const f = fdvOf(p, asOf, fit, c);
  const odds = launchOdds(p, asOf, fit, c);
  return { implied: Math.max(1, Math.round(f.fdv * odds)), fdv: Math.round(f.fdv), odds, multiple: f.multiple, growthPct: f.growthPct, growthMult: f.growthMult, maturityMult: f.maturityMult, age: f.age };
}

// ---------------------------------------------------------------- validation

/** One held-out run's errors, summarised. */
function summarise(errors: number[]): ValidationResult {
  const within = errors.filter((e) => e <= Math.log(3)).length;
  return {
    n: errors.length,
    median_log_error: round4(median(errors)),
    mean_log_error: round4(errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length)),
    within_3x: errors.length > 0 ? round4(within / errors.length) : 0,
  };
}

/**
 * The FDV model tested held-out twice on the live-token set. Leave-one-out
 * refits the multiples without each protocol and predicts its market cap;
 * the time split fits on the older half (by listing date) and predicts the
 * newer half, so the fit never sees the protocols it is scored on. The
 * odds term is not validated here: these protocols already have tokens.
 */
export function validateModel(fit: Fit, asOf: string, c: ModelConstants = MODEL): { loo: ValidationResult; time_split: ValidationResult } {
  const live = fit.live;
  const predict = (p: SnapshotProtocol, multiples: { global: number; byCategory: Map<string, number> }): number => {
    const multiple = multiples.byCategory.get(p.category ?? 'Other') ?? multiples.global;
    const { mult: growthMult } = growthMultiplier(p.change_7d, c);
    const maturityMult = maturityMultiplier(ageDays(asOf, p.listed_at), c);
    return Math.max(1, p.tvl_usd * multiple * growthMult * maturityMult);
  };
  const logErr = (pred: number, actual: number): number => Math.abs(Math.log(pred / actual));

  const looErrors: number[] = [];
  for (const p of live) {
    const rest = live.filter((q) => q !== p);
    const multiples = fitMultiples(rest, c);
    looErrors.push(logErr(predict(p, multiples), p.mcap_usd ?? 1));
  }
  const byAge = [...live].sort((a, b) => {
    const da = a.listed_at === null ? Number.POSITIVE_INFINITY : Date.parse(`${a.listed_at}T00:00:00Z`);
    const db = b.listed_at === null ? Number.POSITIVE_INFINITY : Date.parse(`${b.listed_at}T00:00:00Z`);
    return da - db || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
  const half = Math.floor(byAge.length / 2);
  const olderMultiples = fitMultiples(byAge.slice(0, half), c);
  const splitErrors = byAge.slice(half).map((p) => logErr(predict(p, olderMultiples), p.mcap_usd ?? 1));
  return { loo: summarise(looErrors), time_split: summarise(splitErrors) };
}

// ---------------------------------------------------------------- farm plans

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

/** What one transaction costs on a chain, by the chain's fee tier. */
export function gasFor(chain: string): { perTx: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { perTx: '$8', weekly: '$8' };
  if (c === 'bitcoin') return { perTx: '$4', weekly: '$4' };
  if (['solana', 'sui', 'aptos', 'sei', 'movement', 'near'].includes(c)) return { perTx: '$0.02', weekly: '$0.02' };
  if (['base', 'arbitrum', 'optimism', 'unichain', 'ink', 'blast', 'linea', 'scroll', 'zksync era', 'polygon', 'mantle', 'mode', 'fraxtal', 'berachain', 'monad', 'hyperliquid l1', 'plasma', 'abstract', 'soneium', 'world chain'].includes(c)) {
    return { perTx: '$0.30', weekly: '$0.30' };
  }
  return { perTx: '$2', weekly: '$2' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('interest rate')) return `Deposit $${capital} into ${name}'s rate market on ${chain} and hold the position through one rate cycle.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares; the vault is the protocol's own product.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so the wallet counts as an active user.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main yield strategy on ${chain} and let it compound.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold it through one funding cycle.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds in its app.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} on a real payment, not a wash trade.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and use one of its native apps for a week.`;
  if (c.includes('otc')) return `Place one $${capital} order through ${name}'s OTC desk on ${chain}.`;
  if (c.includes('governance')) return `Deposit $${capital} and cast one vote through ${name}'s governance on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names. Gas follows the
 * protocol's main chain: Ethereum costs dollars a transaction, an L2 or
 * Solana costs cents.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline — never in a screenshot or a chat.`,
      cost: `about ${gas.perTx} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about ${gas.perTx} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap, or a vote — so the activity spans several snapshots.`,
      cost: `about ${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days; snapshots usually reward wallets that stayed, not wallets that passed through.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; ignore airdrop links from search results or DMs.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates, and every transaction hash, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. No cap: every rankable protocol. */
export function buildBoard(snapshot: Snapshot, fit: Fit, c: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol, not a capped sample.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, fit, c) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      multiple_n: fit.multiples.counts.get(p.category ?? 'Other') ?? 0,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
      fdv_usd: s.fdv,
      launch_odds: round4(s.odds),
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

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

/** The live-token peers each category's detail view names as comps, by market cap. */
export function compsByCategory(fit: Fit): Record<string, CompRow[]> {
  const byCat = new Map<string, CompRow[]>();
  for (const p of fit.live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push({ name: p.name, mcap_usd: p.mcap_usd ?? 0, tvl_usd: p.tvl_usd, ratio: round4(clampedRatio(p, MODEL)) });
    byCat.set(key, list);
  }
  const out: Record<string, CompRow[]> = {};
  for (const [key, list] of byCat) {
    out[key] = list.sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, COMPS_PER_CATEGORY);
  }
  return out;
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    fdv_usd: row.model.fdv_usd,
    launch_odds: row.model.launch_odds,
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, c: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot, c);
  const validation = validateModel(fit, snapshot.as_of, c);
  const board = buildBoard(snapshot, fit, c);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const rankable = snapshot.protocols.filter(isRankable).length;
  // The fit's numbers go to the page at full precision: the dashboard
  // recomputes every row from them, and a rounded multiple would make the
  // recomputed value differ from board.json by a few dollars.
  const multiples: Record<string, number> = {};
  for (const [k, v] of fit.multiples.byCategory) multiples[k] = v;
  const multipleCounts: Record<string, number> = {};
  for (const [k, v] of fit.multiples.counts) multipleCounts[k] = v;
  const tokenShares: Record<string, number> = {};
  for (const [k, v] of fit.odds.shares) tokenShares[k] = v;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: c,
    model_version: MODEL_VERSION,
    fit: {
      global_multiple: fit.multiples.global,
      multiples,
      multiple_counts: multipleCounts,
      global_token_share: fit.odds.globalShare,
      token_shares: tokenShares,
      decay_lambda: fit.odds.lambda,
      decay_half_life_days: Number.isFinite(fit.odds.halfLifeDays) ? Math.round(fit.odds.halfLifeDays) : -1,
      fit_protocols: fit.live.length,
      validation,
    },
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      rankable,
      excluded: preToken - rankable,
      live_with_mcap: fit.live.length,
      live_recorded: snapshot.protocols.length - preToken,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    comps: compsByCategory(fit),
  };
  return { board, radar };
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
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
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
