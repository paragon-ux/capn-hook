# 🧢🪝 cap'n hook (lexical-only fork)

*Don't grep the same mystery twice.*

Deterministic memory for coding agents. When your agent spends ten minutes figuring out where something lives in your codebase, capn saves the files that answer the question. The next session gets them back in one command instead of re-exploring — and the moment the underlying files change, the saved answer deletes itself.

**This is a fork of [`CyrusNuevoDia/capn-hook`](https://github.com/CyrusNuevoDia/capn-hook) maintained by [paragon-ux](https://github.com/paragon-ux) with one hard change: recall is lexical-only (BM25/FTS5).** The upstream QMD hybrid path — embedding-model downloads (300MB–2GB), RRF fusion, non-deterministic scores — has been removed at the source, along with agent-hook installation (`capn init` no longer touches `.claude/`, `.codex/`, or git hooks). What remains is the same chart/ask surface, fully deterministic.

## The loop is three moves

**1. Ask before searching.**

```sh
capn ask "where are payment webhooks handled?"
```

A hit returns JSONL with the exact files that answer the question, skipping the whole search. A miss exits 1 with a nudge on stderr to explore and chart what it finds — a miss costs seconds; re-exploring costs minutes.

**2. Chart what was expensive to learn.**

```sh
capn chart "where are payment webhooks handled?" \
  --files src/api/webhooks.ts,src/billing/handlers/stripe.ts \
  --details "Router starts near line 40; Stripe handler owns signature checks."
```

Each backing file is fingerprinted (sha256) at save time. Good charts are atomic — split separable facts into separate charts, include multiple files only when they jointly answer one focused question.

**3. Stale answers delete themselves.** If any backing file changes or disappears, the entry is removed before it can ever answer again. Answers are never edited — either still true, or worthless. That's why the commands are `chart` and `unchart`, not `add` and `update`: the codebase is a coastline, and capn re-charts when it shifts.

## Install

```sh
npm install -g @paragon-ux/capn-hook
# or
bun install -g @paragon-ux/capn-hook

cd /path/to/your/project
capn init            # .capn/ storage + QMD BM25 index + .gitignore line (no hooks)
```

## Commands

| Command | Description |
| :--- | :--- |
| `capn init` | Set up `.capn/`, the QMD BM25 index, and the `.capn/` gitignore line |
| `capn context` | Print the ask-first charting contract |
| `capn ask "<question>"` | Print JSONL hits for relevant charted answers after pruning stale entries first |
| `capn chart "<question>" --files <a,b> [--details "<extra context>"]` | Record a discovery, hashing each backing file |
| `capn unchart <id>` | Manually delete one chart entry |
| `capn bust <path>` | Delete every chart entry backed by one file |
| `capn prune` | Delete every chart entry whose files changed or vanished |
| `capn list` | Print charted entries, human-readable |

## The chart

`.capn/entries/<id>.md` — one local markdown file per question. Entries are plain text you can open and read. `capn init` gitignores `.capn/`, so memory stays local to the working copy.

```md
---
capn: 1
id: 9f3a1c2e
at: 2026-07-03T18:00:00.000Z
files:
  src/api/webhooks.ts: 2f4c0b9c3e0a0c7b5d5d7f8f0a6e2d1c4b8a6f1e2d3c4b5a6978877665544332
---

# Where are payment webhooks handled?

Router starts near line 40; Stripe handler owns signature checks.
```

## Design principles

- **Chart or unchart, never update.** Staleness is decided by content hashes, not judgment calls.
- **Answers are never stale.** `capn ask` removes invalid entries before returning anything.
- **The chart is disposable.** Any entry can be deleted at any time; the worst case is the agent re-explores.
- **Deterministic recall.** BM25 lexical search only — no embedding models, no downloads, no GPU, stable scores run to run.
- **No hooks.** capn is a CLI, not a harness plug-in. Agents call it; it never rewrites agent configuration.
- **Local-first.** The QMD index runs in-process against `.capn/qmd/index.sqlite`. No daemon, no server.

## License

MIT (inherited from the upstream capn-hook project).
