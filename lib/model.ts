// Token Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks genuine pre-token protocols: the snapshot's watchlist (the floor) plus every
// pre-token protocol below the floor that passes the house's own watchlist exclusion rule, applied
// to the whole board. A protocol is set aside, never ranked, when the rule excludes it:
//   - its category is Bridge, Canonical Bridge, Cross Chain Bridge, Liquid Staking,
//     Liquid Restaking, Restaked BTC or CEX (its TVL is another token's value, held or bridged);
//   - its name ends in a version marker (a pool of another protocol);
//   - its name carries a whole word wrapped, staked or staking;
//   - its name begins with an exchange's name.
// Nineteen protocols sit above the $50M floor yet are not on the watchlist; the snapshot does not
// carry the parent-protocol field the house used, so the reason is not visible here, but each reads
// as a product or vault of a larger protocol (Sentora Curator, Polymarket International, CIAN Yield
// Layer), so the radar sets them aside too rather than ranking a sub-product as a launch of its own.
// Every one of the snapshot's 758 protocols is accounted for: board + set aside + live token.
//
// Implied value follows only from the snapshot's own figures:
//
//   M = median(mcap_usd / tvl_usd) over the live-token protocols with a positive market cap
//       (128 of the 416 in this snapshot; the rest record a token but no market cap)
//   G = 1 + 0.5 * tanh(change_7d / 50)          (null change reads as 0)
//   T = 0.6 + 0.4 * log1p(min(age_days, 1825)) / log1p(1825)   (unknown age reads as 365 days)
//   implied = max(1, round(tvl_usd * M * G * T))
//
// The multiple is the market's own: the median ratio at which live protocols in this same snapshot
// are valued against their TVL, computed at runtime, never a hardcoded number. Growth is damped
// with tanh: near-linear for ordinary weeks, saturating at +/-50% so a launch-week spike (+4448%)
// cannot dominate the board. Maturity is tenure with no token, with diminishing returns: the gap
// between one year and two matters more than between four and five. No protocol name is ever
// special-cased: the same function scores every row.
//
// The model was tested against the market it calibrates from: applied to the live-token protocols
// as if they were pre-token, split-half so no protocol's own ratio calibrates its score, it
// predicts market cap with a median error of about 5x and no tested variant (per-category
// multiples, chain breadth, linear or square-root growth) improved on it. The dashboard states
// that plainly: an implied value is a snapshot estimate, not a launch-price forecast, and token
// allocation and dilution are unmodelled.

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

/** The model's constants: the shape of the formula, not its numbers. The multiple comes from the snapshot. */
export interface ModelConstants {
  growth_weight: number;
  growth_scale: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_scale: 50,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1825,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
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
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
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
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A protocol set aside from the board, with the reason it was set aside. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
  /** The model value it would carry, for reference only: never ranked. */
  implied_value_usd: number;
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

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiple: number;
  multiple_n: number;
  live_total: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  aside_size: number;
  above_floor_aside: number;
  live_size: number;
  total_protocols: number;
  rows: RadarRow[];
  aside: SetAsideRow[];
  live: LiveRow[];
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

/** The median of a sorted array: the element at floor(n/2). The page uses the same definition. */
export function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The market's own multiple: the median mcap/TVL over the live-token protocols that carry a
 * positive market cap. Returns the multiple and the count it was taken over.
 */
export function calibrateMultiple(protocols: SnapshotProtocol[]): { multiple: number; n: number } {
  const ratios = protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
  return { multiple: medianSorted(ratios), n: ratios.length };
}

/** The three multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = finite(protocol.change_7d, 0);
  const growthMult = 1 + model.growth_weight * Math.tanh(growthPct / model.growth_scale);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range * (Math.log1p(Math.min(Math.max(ageForModel, 0), model.maturity_days)) / Math.log1p(model.maturity_days));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose TVL is another token's value, held, staked or bridged. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names beginning with an exchange's name are that exchange's product, not a standalone protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why the board sets a pre-token protocol aside, or null when it may be ranked. The reason is
 * written for the reader: the rule that excluded it, never a verdict that it cannot launch.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  const cat = p.category ?? '';
  if (EXCLUDED_CATEGORIES.has(cat)) {
    if (cat === 'CEX') return 'Centralised exchange: its TVL is custodied funds, not a protocol to farm.';
    if (cat === 'Bridge' || cat === 'Canonical Bridge' || cat === 'Cross Chain Bridge')
      return 'Bridge: its TVL is other tokens locked in transit, not its own launch value. Excluded by the house category rule, not because a bridge cannot launch a token.';
    return 'Staking product: its TVL is staked assets of a token that already trades.';
  }
  if (VERSIONED.test(p.name)) return 'Versioned pool: a release of another protocol, not a standalone launch.';
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped or staked product of a token that already trades.';
  if (EXCHANGE_PREFIX.test(p.name)) return 'An exchange product, not a standalone protocol.';
  return null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, multiple: number, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol below the watchlist floor that the exclusion rule
  // keeps. No cap: the radar exists to find them all.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!isPreToken(p)) continue;
    if (exclusionReason(p) !== null) continue;
    chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple,
      multiple_n: 0, // filled by buildRadar, which knows the calibration count
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The set-aside protocols: every pre-token protocol the board does not rank, with its reason. */
export function setAsideRows(snapshot: Snapshot, multiple: number, model: ModelConstants = MODEL): { rows: SetAsideRow[]; aboveFloor: number } {
  const boardSlugs = new Set(buildBoard(snapshot, multiple, model).map((r) => r.slug));
  const watchlist = new Set(snapshot.watchlist);
  const rows: SetAsideRow[] = [];
  let aboveFloor = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || boardSlugs.has(p.slug)) continue;
    const reason = exclusionReason(p);
    if (reason !== null) {
      const { implied } = impliedValue(p, snapshot.as_of, multiple, model);
      rows.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        reason,
        implied_value_usd: implied,
      });
    } else if (p.tvl_usd >= snapshot.floor_usd && !watchlist.has(p.slug)) {
      // Above the floor, pre-token, not excluded by any visible rule, yet not on the watchlist:
      // the house's parent-protocol field is not in the snapshot, so the reason is not visible
      // here. Each reads as a product or vault of a larger protocol, so it is set aside rather
      // than ranked as a launch of its own.
      aboveFloor += 1;
      const { implied } = impliedValue(p, snapshot.as_of, multiple, model);
      rows.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        reason:
          'Above the $50M floor but not on the house watchlist: the snapshot does not carry the parent-protocol field the house used, so the reason is not visible here. It reads as a product or vault of a larger protocol, so the radar sets it aside rather than ranking a sub-product as a launch of its own.',
        implied_value_usd: implied,
      });
    }
  }
  rows.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { rows, aboveFloor };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Typical gas for one transaction on each chain, in USD (November 2026; an estimate, stated as one). */
export const GAS_USD: Record<string, number> = {
  Ethereum: 8.0,
  Bitcoin: 2.0,
  Tron: 0.5,
  Avalanche: 0.3,
  Arbitrum: 0.25,
  Optimism: 0.2,
  Binance: 0.15,
  Base: 0.15,
  Linea: 0.1,
  Unichain: 0.1,
  Berachain: 0.1,
  Plume: 0.1,
  'Plume Mainnet': 0.1,
  Katana: 0.1,
  'Robinhood Chain': 0.1,
  Polygon: 0.05,
  'Hyperliquid L1': 0.05,
  Monad: 0.05,
  Sonic: 0.05,
  Flare: 0.05,
  Solana: 0.01,
  Sui: 0.01,
};
export const GAS_DEFAULT_USD = 0.5;

/** Gas for one transaction on a protocol's first chain. */
export function gasFor(p: SnapshotProtocol): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A dollar figure with at most two decimals, trimmed. */
function dollars(n: number): string {
  return n >= 100 ? String(Math.round(n)) : (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** The category family a protocol's farm plan follows. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('liquidity')) return 'dex';
  if (c.includes('yield aggregator') || c.includes('yield')) return 'yield';
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator') || c.includes('index')) return 'vault';
  if (c.includes('rwa') || c.includes('stable') || c.includes('reserve')) return 'stable';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('synthetic') || c.includes('basis')) return 'derivatives';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('farm') || c.includes('leveraged')) return 'farm';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('chain')) return 'chain';
  return 'default';
}

/** The plan's protocol-specific actions: a primary action and a second qualifying action. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const name = p.name;
  const f = familyOf(p);
  switch (f) {
    case 'lending':
      return [
        `Supply $${capital} of USDC to ${name} on ${chain} as collateral.`,
        `Borrow about $${Math.round(capital / 2)} of stablecoins against it, then repay the borrow within a week so the position shows both sides of the market.`,
      ];
    case 'dex':
      return [
        `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
        `Swap $${Math.round(capital / 5)} through ${name}'s own router so the wallet shows trading activity as well as liquidity.`,
      ];
    case 'yield':
      return [
        `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain}.`,
        `Harvest or compound the yield once, then re-deposit it so the wallet shows a full yield cycle.`,
      ];
    case 'vault':
      return [
        `Deposit $${capital} into a ${name} vault on ${chain} and keep the receipt shares.`,
        `Move half the position to a second ${name} vault after two weeks so the wallet shows activity across vaults.`,
      ];
    case 'stable':
      return [
        `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`,
        `Use the minted asset once, for a swap or a deposit elsewhere, so the wallet shows the asset in circulation.`,
      ];
    case 'derivatives':
      return [
        `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
        `Close the position after a week and open a second one in the opposite direction so the wallet shows two settled trades.`,
      ];
    case 'prediction':
      return [
        `Fund $${capital} and place one market position on ${name}.`,
        `Place a second position on a different market so the wallet shows more than a single bet.`,
      ];
    case 'bridge':
      return [
        `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
        `Bridge a smaller amount back a week later so the wallet shows two-way volume.`,
      ];
    case 'staking':
      return [
        `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
        `Restake or delegate the receipt once so the wallet shows a second staking action.`,
      ];
    case 'insurance':
      return [
        `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
        `Renew or extend the cover once before it lapses so the wallet shows continued cover.`,
      ];
    case 'farm':
      return [
        `Deposit $${capital} into ${name}'s main farm on ${chain} and keep the position open.`,
        `Claim the farm rewards once and re-deposit them so the wallet shows a full farm cycle.`,
      ];
    case 'launchpad':
      return [
        `Stake $${capital} of the launchpad's asset on ${chain} to qualify for allocations.`,
        `Join one allocation round, however small, so the wallet shows participation.`,
      ];
    case 'chain':
      return [
        `Bridge $${capital} to ${name}'s chain and hold it in a wallet that transacts there.`,
        `Make one swap and one contract interaction on the chain so the wallet shows real usage.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
        `Make a second deposit or interaction a week later so the wallet shows repeated use.`,
      ];
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [primary, second] = actionsFor(p, capital, chain);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `$${dollars(gas)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: primary,
      cost: `$${capital} of capital and about $${dollars(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${dollars(gas)} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week for ${weeks} weeks, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${dollars(gas * weeks)} of gas in total`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position; about $${dollars((capital * 0.05 * hold) / 365)} of yield given up at 5% a year`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, all of them, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd)
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
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { multiple, n } = calibrateMultiple(snapshot.protocols);
  const board = buildBoard(snapshot, multiple, model);
  for (const row of board) row.model.multiple_n = n;
  const { rows: aside, aboveFloor } = setAsideRows(snapshot, multiple, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiple,
    multiple_n: n,
    live_total: live.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    aside_size: aside.length,
    above_floor_aside: aboveFloor,
    live_size: live.length,
    total_protocols: snapshot.protocols.length,
    rows: board.map(radarRow),
    aside,
    live,
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
  if (slugs.size !== board.length) return 'the board repeats a slug';
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
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
