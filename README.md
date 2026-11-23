# token-radar-2026

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/muhammadaldy198/token-radar-2026/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/muhammadaldy198/token-radar-2026/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for [Build the best token launch radar](https://make.fun/bounty/token-radar-01) on
[make.fun](https://make.fun): a pre-token protocol radar that ranks 200 protocols by the expected value
of a token that does not exist yet — fitted market cap × odds of ever tokening × own-token share.
The board covers the 40-protocol watchlist, the 140 largest rankable pre-token protocols below
the floor, and the 20 largest genuine pre-token protocols the watchlist leaves out (the off-list,
led by Sentora at #23 — a wrapped or staked product is not a token that does not exist yet, so
WBTC and the bridges are not on it).

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot, fits two models on the
snapshot's own data, and writes the ranked board, the dashboard data, and the dossier:

- **Value model** — Huber log-log regression on 94 comparables (tokened protocols outside the
  excluded categories): ln(mcap) = 9.10 + 0.41·ln(TVL) − 0.21·ln(chains) + 0.29·7d growth.
  Leave-one-out median miss ×3.22 (flat multiple: ×4.60); walk-forward average ×2.67 across three
  splits. Listing age and category effects were tested and dropped — age destroys walk-forward,
  category adds nothing over the growth term.
- **Odds model** — logistic regression on 525 peers: P(records a token) from years listed, TVL,
  growth, and shrunk category token share. Brier 0.202 (10-fold) vs 0.241 base rate; 65% called
  right walk-forward. The age coefficient is positive — odds rise with age, as the snapshot's own
  age buckets show. The 12-month sub-odds are the hazard from the fitted model: a forward
  conditional rate, not a slice of the ever odds — so for a young protocol the 12-month odds can
  exceed the ever odds, and that is arithmetic, not a bug.
- **Own-token share** — measured from the snapshot alone: a protocol's kin are the protocols that
  record a token and share its family stem (first slug segment); share = TVL(P) / (TVL(P) + Σ
  TVL(kin)). No kin means 100%.
- **Intervals** — conformal per kind from leave-one-out residuals (kinds with < 8 comparables fall
  back to the global band). Coverage 48.9% of held-out actuals inside a band that claims 50%.
- **Farm economics** — plan deposit 0.02% of TVL, 7% drop share, 52-week horizon, $5/week gas,
  28 hours at $25/hour. The verdict is the minimum-capital lens: FARM breaks even at ≤ $100K,
  THIN at ≤ $500K, SKIP above that or never. 7 FARM / 116 THIN / 77 SKIP. The expected drop
  multiplies by the protocol's own-token share — a family that holds 89% of the TVL keeps 89% of
  the drop. Every row carries an 8-step farm plan with exit rules.
- **Self-test** — 9 checks gate the run (watchlist coverage, ranks, order, farm steps, positive
  implied values, both fits converged, LOO beats flat, Brier beats base, deterministic refit).
  The dashboard re-executes the same 9 checks in the browser as an active integrity strip.

No protocol name is ever special-cased. Every number recomputes from the snapshot at run time;
nothing is hardcoded from an earlier run.

## The dashboard

`dashboard/` (index.html + app.css + app.js, 40 KB total) renders `data.js` with no fetch and no
network: KPI strip, active integrity strip, 758-protocol ledger, hand-drawn SVG scatter (log-log
cap vs TVL, Huber line + conformal band, point size = TVL, colour = kind), a sortable /
filterable / searchable 200-row board with CSV export, a full-page detail view with complete
checkable arithmetic and a farm sandbox, a method view with the three evidence tables
(term selection, held-out tests, odds calibration), and a live-token view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Two runs write byte-identical output (verified). Runtime ~10 s on one CPU. The dossier is
540 KB (4 screenshots at 1024×1024, JPEG quality 50 — the dossier embeds them base64, so every
raw byte costs 1.33 dossier bytes).

## Verification (local, before submit)

- `main.ts` twice from fresh output dirs: byte-identical (`diff -r` clean).
- Kit `check --worktree`: 4 pass (`competition_open`, `snapshot`, `license_osi`,
  `entrypoint`); `transcripts_present` fails as expected before bundling (the Orchestrator
  bundles the builder sessions); the rest skip or check at submission.
- Board: 200 rows (40 watchlist + 140 early + 20 off-list), watchlist 40/40, ranks 1..200,
  implied value non-increasing, 8 farm steps per row (each 20–600 chars), 9/9 self-tests pass.
  The 142 pre-token protocols not on the board are accounted for in the ledger by reason
  (42 exchanges, 57 wrapped/staked/bridged products, 11 versioned pools, 32 below the cutoff).
- Dossier text 40,778 bytes (cap 65,536, no cut); all four screenshots ≤ 512 KiB.

## Layout

- `main.ts` — entrypoint: reads the snapshot, gates on the board shape and the 9 self-tests,
  writes `board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`.
- `lib/model.ts` — the fitted model: Huber + logistic IRLS, term selection, held-out tests,
  conformal intervals, seeded bootstrap, farm economics, self-test.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied verbatim from the kit.
- `dashboard/` — the static page. `screenshots/` — the four 1024×1024 captures.
- `.makefun/owner.json` — the entry's wallet claim file.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=3p0axm2p&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
