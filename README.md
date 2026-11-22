# Token Radar

[![make.fun](https://make.fun/api/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/api/badge/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/api/badge/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: pre-token protocols ranked by expected implied value,
with a costed farm plan for each one. Built for the
[make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).

## The model

Every term is fitted from the sealed snapshot's own 144 live-token
protocols — no protocol name is ever special-cased:

- **Comps multiple**: the median market-cap/TVL of live-token protocols
  in the same category, shrunk toward the global median for thin
  categories. Implied FDV = TVL x category multiple.
- **Growth**: the protocol's 7-day TVL change, clamped to [-60, +120]%,
  at half weight.
- **Maturity**: how long the protocol has run with no token, 0.6 at
  listing rising to 1.0 at three years.
- **Launch odds**: the category's token share (peers' record) times an
  age decay fitted from the snapshot's own age bands — a protocol that
  has run years with no token is less likely to launch than a young one.
- **Implied value** = FDV x odds: the expected value of a launch.

The board ranks every rankable pre-token protocol (198 rows, all 40
watchlist protocols covered), never a capped sample. Live-token protocols
are set aside with their market caps shown, never mixed into the ranking.

## Validation

The FDV model is tested held-out twice on the live-token set and the
numbers are printed on the dashboard's integrity strip: leave-one-out
and an older-to-newer time split, both reporting median absolute log
error. See `lib/model.ts` (`validateModel`).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. Deterministic: no clock, no randomness —
age is computed from the snapshot's fixed `as_of` date.
