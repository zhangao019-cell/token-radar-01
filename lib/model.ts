// Token Radar, model radar-2: one snapshot in, one ranked board out.
//
// The board ranks protocols that record no token, by what a token would be worth if the
// protocol's record stayed as it is. It never predicts whether or when a token is issued.
// Every number below comes from the snapshot's own ten fields; no protocol name is ever
// special-cased, and the same function scores every row.
//
// Implied value (USD), all factors from the snapshot:
//
//   value  = round( 3000 * sqrt(tvl_usd) * growth * maturity * chains * category )
//
//   growth   = 1 + clamp(change_7d, -50, 100) / 100 * 0.6        (0.70 .. 1.60; no report: 1.00)
//   maturity = 0.70 + 0.30 * min(age_days, 1095) / 1095          (0.70 .. 1.00; age unknown: 0.78,
//                                                                below a known year of operation, so a
//                                                                missing listing date never outranks a
//                                                                proven one)
//   chains   = 1 + 0.05 * min(chains - 1, 4)                     (1.00 .. 1.20)
//   category = 1.25 fee-capturing, 1.10 yield-bearing, 0.55 pass-through, else 1.00
//
// Why these shapes: the square root is the log-scale term, so a protocol ten times larger in
// TVL is worth about three times more, not ten times more; growth rewards a rising TVL and
// punishes a falling one; maturity rewards a long run with no token, because a launch that
// has waited longest has the most pent-up value; chain breadth rewards a protocol live on
// more chains; the category tier separates businesses whose token can capture fees from
// pass-through plumbing (bridges, staking wrappers) whose token, if any, captures little.
//
// Selection: the 40 watchlist slugs, plus the 160 highest-TVL pre-token protocols below the
// watchlist floor. Centralised exchanges never rank, and neither do versioned pools or
// products named wrapped, staked or staking, or named after an exchange. Bridges and staking
// products that survive the cut carry the 0.55 pass-through tier, so they land at the bottom
// of the board, never near the top. Protocols whose token already trades are never ranked:
// they are set aside with their market cap shown, so the board stays a pre-token board.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  scale: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_factor: number;
  chain_step: number;
  chain_max_extra: number;
  tier_fee: number;
  tier_yield: number;
  tier_pass: number;
  tier_other: number;
}

export const MODEL: ModelConstants = {
  scale: 3000,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_factor: 0.78,
  chain_step: 0.05,
  chain_max_extra: 4,
  tier_fee: 1.25,
  tier_yield: 1.1,
  tier_pass: 0.55,
  tier_other: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    scale: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    category_tier: string;
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
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
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
  token_status: 'live-token';
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
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

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category tier a protocol's category falls in, with its multiplier. */
export function categoryTier(category: string | null, model: ModelConstants): { tier: string; multiplier: number } {
  const c = (category ?? '').toLowerCase();
  if (c === 'bridge' || c === 'canonical bridge' || c === 'cross chain bridge' || c.includes('liquid staking') || c.includes('liquid restaking') || c === 'restaking' || c === 'staking pool' || c === 'cex') {
    return { tier: 'pass-through', multiplier: model.tier_pass };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('dex') || c.includes('derivative') || c.includes('risk curator') || c.includes('capital allocator') || c.includes('collateral market')) {
    return { tier: 'fee-capturing', multiplier: model.tier_fee };
  }
  if (c.includes('yield') || c.includes('basis trading') || c.includes('rwa') || c.includes('liquidity manager') || c.includes('leveraged farm') || c === 'farm' || c.includes('index') || c.includes('launchpad') || c.includes('prediction') || c.includes('token locker')) {
    return { tier: 'yield-bearing', multiplier: model.tier_yield };
  }
  return { tier: 'other', multiplier: model.tier_other };
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; categoryMult: number; tier: string; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = age === null ? model.unknown_age_factor : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = protocol.chains.length;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(chainCount - 1, 0), model.chain_max_extra);
  const { tier, multiplier: categoryMult } = categoryTier(protocol.category, model);
  const implied = Math.max(1, Math.round(model.scale * Math.sqrt(protocol.tvl_usd) * growthMult * maturityMult * chainMult * categoryMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, categoryMult, tier, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that carries a whole word wrapped, staked or staking, in any case. */
const WRAPPED = /(^|\s)(wrapped|staked|staking)(\s|$)/i;

/** A name that begins with an exchange's name. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol may rank at all: pre-token, not an exchange, not a versioned pool, not a wrapped or staked product of a token that trades, not named after an exchange. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !WRAPPED.test(p.name) && !EXCHANGE.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. A chosen
  // protocol stays chosen; bridges and staking products that fill the last rows carry the
  // pass-through tier, so the model itself puts them at the bottom.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      scale: model.scale,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.categoryMult),
      category_tier: s.tier,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $25 against it so both sides of the position are active.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $25 of USDC for the pool's other asset on ${name}, then provide $${capital} of liquidity to its main pool on ${chain}.`;
  if (c.includes('risk curator') || c.includes('capital allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares for the whole season.`;
  if (c.includes('yield') || c.includes('leveraged')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and enable auto-compounding if it offers it.`;
  if (c.includes('basis trading')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and check the funding rate once a week.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet for the full term.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, no more than 2x leverage.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the destination chain.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('launchpad')) return `Stake $${capital} of the launchpad's required asset on ${name} and join one token sale with the minimum ticket.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one market position, then leave the position open until it resolves.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} of USDC into ${name}'s managed range on ${chain} and let it rebalance for the season.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole cover period.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different touchpoint the same week. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay $10 of the borrow and borrow it again the next day, so the loan book shows repeat activity.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $10 back and forth through ${name}'s router on ${chain} once, paying the pool fee rather than routing elsewhere.`;
  if (c.includes('risk curator') || c.includes('capital allocator')) return `Allocate a second $25 deposit to a different ${name} vault on ${chain} so two vaults carry your wallet.`;
  if (c.includes('yield') || c.includes('basis trading')) return `Claim the vault's yield once, then redeposit the claim into the same vault instead of withdrawing it.`;
  if (c.includes('rwa')) return `Subscribe to a second ${name} issuance with $25 on ${chain} and hold both positions to maturity.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Close the hedge and open a fresh one the following week, keeping the margin balance above $${capital}.`;
  if (c.includes('bridge')) return `Bridge $25 back to the origin chain through ${name} so the round trip is recorded on both sides.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the staking rewards once instead of claiming them, so the stake compounds in the same wallet.`;
  if (c.includes('launchpad')) return `Vote in one ${name} governance poll or community round with the staked position.`;
  if (c.includes('prediction')) return `Place a second $10 position on a different ${name} market and hold it to resolution.`;
  return `Use ${name}'s second feature once, such as its rewards page or a vote, with the same wallet.`;
}

/** The category's weekly cadence action. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Once a week, top up the supply by $10 or adjust the borrow so the position moves every week.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Once a week, make one swap of at least $10 through ${name} so the router sees weekly volume.`;
  if (c.includes('bridge')) return `Once a month, bridge at least $25 through ${name} again rather than using another bridge.`;
  if (c.includes('staking') || c.includes('restak')) return `Once a month, check the staking rewards on ${name} and restake them instead of claiming.`;
  if (c.includes('prediction')) return `Once a week, settle or place one new ${name} market position while the season runs.`;
  return `Once a week, make one qualifying action on ${name}, such as a deposit, a claim, a swap or a vote.`;
}

/** The gas note for the protocol's main chain: mainnet costs more than a rollup. */
function gasNote(p: SnapshotProtocol): string {
  const chain = chainOf(p);
  const cheap = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BNB Chain', 'Sui', 'Aptos', 'zkSync Era', 'Scroll', 'Linea', 'Blast', 'Mode', 'World Chain'];
  if (cheap.includes(chain)) return `about $0.50 of gas on ${chain}`;
  if (chain === 'Ethereum') return `about $6 of gas on Ethereum mainnet, so batch the setup into one session`;
  return `about $2 of gas on ${chain}`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: 'about $25 of capital moved and $2 of gas',
      time: '10 minutes',
    },
    {
      text: weeklyAction(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
  ];
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
      token_status: 'live-token' as const,
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
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_multiplier: row.model.category_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
