# Installing @paragon-ux/capn-hook (for agents)

You are being asked to install capn-hook — deterministic chart/ask memory for coding
agents — into the project you're currently working in. Follow these steps yourself;
don't just print them for the human.

## 1. Check if capn is already installed

```sh
command -v capn
```

If this prints a path, skip to step 4.

## 2. Install the CLI

```sh
npm install -g @paragon-ux/capn-hook
```

Or with Bun:

```sh
bun install -g @paragon-ux/capn-hook
```

## 3. Build and link from source (only if not installed from npm)

```sh
git clone https://github.com/paragon-ux/capn-hook ~/.local/share/capn-hook
cd ~/.local/share/capn-hook
just install
```

Requires [bun](https://bun.sh). Do not use `bun link` — it does not put `capn` on PATH.

## 4. Initialize the target project

```sh
capn init
```

Sets up `.capn/`, the QMD BM25 index, and the `.capn/` gitignore line. **No hooks are
installed and no flags are needed** — recall is always deterministic BM25 lexical
search; the embedding path does not exist in this fork.

## 5. Verify

```sh
capn context
```

should print the ask-first charting contract. Also check that `.capn/` exists in the
target project and `.capn/` is gitignored.

capn-hook is now live in this project. See [README.md](README.md) for the full command
reference (`capn init`, `capn context`, `capn ask`, `capn chart`, `capn unchart`,
`capn bust`, `capn prune`, `capn list`).
