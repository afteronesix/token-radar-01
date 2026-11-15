# Token Radar — make.fun token-radar-01

A program that reads a sealed DefiLlama snapshot and writes a token launch radar: a ranked
board of genuine pre-token protocols by implied launch value, each with a farm plan, plus a
static dashboard a reader can sort, filter and open per protocol.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, scores every genuine
pre-token protocol with the model in `lib/model.ts`, writes the ranked board to
`/output/board.json` and the dashboard's data to `/output/data.js`, copies `dashboard/` and
`screenshots/` to `/output`, and writes `/output/dossier.json` with the vendored make.fun
library. The run is deterministic: the same snapshot always writes the same bytes.

## The board

178 rows: the snapshot's 40-protocol watchlist plus all 138 pre-token protocols below the $50M
floor that pass the house's own watchlist exclusion rule, applied to the whole board. Wrapped,
staked and bridged products are set aside, not ranked — their TVL is another token's value.
164 protocols are set aside with a stated reason each (145 by the exclusion rule, 19 above the
floor but not on the watchlist — the snapshot does not carry the parent-protocol field the house
used, so each is set aside as a product or vault of a larger protocol). 416 live-token protocols
are shown separately with their real market caps. All 758 protocols are accounted for:
178 + 164 + 416.

## The value model

```
implied = round( tvl_usd × M × (1 + 0.5 × tanh(change_7d / 50)) × (0.6 + 0.4 × log1p(min(age_days, 1825)) / log1p(1825)) )
```

- **M** is the market's own multiple: the median mcap/TVL over the live-token protocols with a
  positive market cap (0.223 over 128 protocols in this snapshot), computed at runtime from the
  snapshot — never a hardcoded number.
- **Growth** is tanh-damped: near-linear for ordinary weeks, saturating at ±50%, so a launch-week
  spike (+4448% in this snapshot) cannot dominate the board.
- **Maturity** is tenure with no token, with diminishing returns over five years.

The model was tested against the market it calibrates from: applied to the live-token protocols
as if they were pre-token, split-half so no protocol's own ratio calibrates its score, it
predicts market cap with a median error of about 5×. Per-category multiples, chain-breadth
factors, and linear/square-root growth were tested and did not improve on it, so they are not
in it. The dashboard states the limits plainly: an implied value is a snapshot estimate, not a
launch-price forecast, and token allocation and dilution are unmodelled.

## The farm plans

Seven steps per protocol, derived from its own record: a category-specific action sequence
(supply → borrow → repay for lending, LP → swap for dexes, vault sequences for curators, and so
on), chain-specific gas costs, capital sized by TVL tier, and a hold window sized by age. Every
step carries its cost and time. The detail view adds a cost summary (gas, fees, yield given up)
and a break-even check: at your assumed chance of a launch, the allocation that pays for the farm.

## The dashboard

`dashboard/` is a static page with no network: search, category and chain filters, a
watchlist-only toggle, sortable columns, three views (pre-token board, set aside, live token),
and a detail view per protocol with the model's arithmetic, the farm plan and the break-even
check. The page recomputes the model from the snapshot figures it carries — the multiple from
the live rows, each row's implied value from its TVL, growth and age — and shows whether its
numbers match the board's.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## Layout

- `main.ts` — the entrypoint
- `lib/model.ts` — the model, the board, the farm plans
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the board, a protocol's detail view, a filtered view (1440×900)
