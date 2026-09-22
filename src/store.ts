import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createRequire } from "node:module";
import { entriesDir, qmdDBPath, qmdDir } from "./project.ts";
import { fail } from "./util.ts";

const require = createRequire(import.meta.url);

export type SearchHit = { file?: string; filepath?: string; score?: number };
export type CapnStore = {
  addContext: (
    collectionName: string,
    pathPrefix: string,
    contextText: string
  ) => Promise<boolean>;
  close: () => Promise<void>;
  listContexts: () => Promise<
    Array<{ collection: string; path: string; context: string }>
  >;
  searchLex: (
    query: string,
    options: { collection: string; limit: number }
  ) => Promise<SearchHit[]>;
  update: (options?: Record<string, unknown>) => Promise<unknown>;
};
const markdownExtensionPattern = /\.md$/;

export function hitId(hit: SearchHit) {
  const file = hit.file || hit.filepath || "";
  return basename(file).replace(markdownExtensionPattern, "");
}

type SqliteRow = Record<string, unknown>;

type Driver = {
  kind: "better" | "bun" | "native";
  exec: (sql: string) => void;
  all: (sql: string, params?: unknown[]) => SqliteRow[];
  run: (sql: string, params?: unknown[]) => void;
  close: () => void;
};

/**
 * Resolve a SQLite driver at runtime. better-sqlite3 (pinned 12.10.0) is the
 * primary under Node; bun:sqlite covers the Bun runtime (tests); node:sqlite is
 * the zero-native-dep fallback for Node >= 22.5. Whichever loads first wins.
 */
async function openDriver(dbPath: string): Promise<Driver> {
  try {
    const mod = require("better-sqlite3") as { default?: unknown };
    const Database = (mod.default ?? mod) as new (path: string) => {
      exec(sql: string): unknown;
      prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
      close(): unknown;
    };
    const db = new Database(dbPath);
    return {
      kind: "better",
      exec: (sql) => db.exec(sql),
      all: (sql, params = []) => db.prepare(sql).all(...params) as SqliteRow[],
      run: (sql, params = []) => db.prepare(sql).run(...params),
      close: () => db.close(),
    };
  } catch {
    // better-sqlite3 native binding unavailable (e.g. under Bun) — try bun:sqlite.
  }

  try {
    const bunSpecifier = "bun:sqlite";
    const { Database } = (await import(bunSpecifier)) as {
      Database: new (path: string) => {
        exec(sql: string): unknown;
        query(sql: string): { all(...p: unknown[]): unknown[] };
        run(sql: string, ...p: unknown[]): unknown;
        close(): unknown;
      };
    };
    const db = new Database(dbPath);
    return {
      kind: "bun",
      exec: (sql) => db.exec(sql),
      all: (sql, params = []) => db.query(sql).all(...params) as SqliteRow[],
      run: (sql, params = []) => db.run(sql, ...params),
      close: () => db.close(),
    };
  } catch {
    // Not Bun, or bun:sqlite unavailable — try node:sqlite.
  }

  try {
    const { DatabaseSync } = (await import("node:sqlite")) as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): unknown;
        prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
        close(): unknown;
      };
    };
    const db = new DatabaseSync(dbPath);
    return {
      kind: "native",
      exec: (sql) => db.exec(sql),
      all: (sql, params = []) => db.prepare(sql).all(...params) as SqliteRow[],
      run: (sql, params = []) => db.prepare(sql).run(...params),
      close: () => db.close(),
    };
  } catch {
    // fall through to fail
  }

  fail(
    "capn: no SQLite driver available. Install better-sqlite3 (Node) or run under Bun / Node >= 22.5.\n"
  );
}

function probeFts5(driver: Driver): boolean {
  try {
    driver.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS _capn_fts_probe USING fts5(x);"
    );
    driver.exec("DROP TABLE IF EXISTS _capn_fts_probe;");
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a safe FTS5 MATCH expression from arbitrary user text. Tokenize on
 * non-word boundaries, quote every term, and OR them together so raw input can
 * never inject FTS5 query syntax (unbalanced quotes, brackets, or operators).
 */
function buildMatchQuery(query: string): string | null {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(" OR ");
}

function rebuildIndex(driver: Driver, root: string) {
  const dir = entriesDir(root);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .sort()
    : [];
  driver.exec("DELETE FROM capn_fts;");
  for (const file of files) {
    const body = readFileSync(resolve(dir, file), "utf8");
    driver.run("INSERT INTO capn_fts (path, body) VALUES (?, ?)", [file, body]);
  }
}

export async function openStore(root: string): Promise<CapnStore> {
  mkdirSync(qmdDir(root), { recursive: true });
  const driver = await openDriver(qmdDBPath(root));
  const hasFts5 = probeFts5(driver);

  if (hasFts5) {
    driver.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS capn_fts USING fts5(path UNINDEXED, body);"
    );
    driver.exec(
      "CREATE TABLE IF NOT EXISTS contexts(collection TEXT NOT NULL, path TEXT NOT NULL, context TEXT NOT NULL, PRIMARY KEY (collection, path));"
    );
  }

  let degradedWarned = false;
  const warnDegraded = () => {
    if (!degradedWarned) {
      process.stderr.write(
        "capn: FTS5 unavailable in this SQLite driver — lexical recall disabled (AST/literal routing still active)\n"
      );
      degradedWarned = true;
    }
  };

  return {
    async addContext(collectionName, pathPrefix, contextText) {
      if (!hasFts5) return false;
      driver.run(
        "INSERT OR REPLACE INTO contexts (collection, path, context) VALUES (?, ?, ?)",
        [collectionName, pathPrefix, contextText]
      );
      return true;
    },
    async close() {
      driver.close();
    },
    async listContexts() {
      if (!hasFts5) return [];
      return driver
        .all("SELECT collection, path, context FROM contexts")
        .map((row) => ({
          collection: String(row.collection),
          path: String(row.path),
          context: String(row.context),
        }));
    },
    async searchLex(query, options) {
      if (!hasFts5) {
        warnDegraded();
        return [];
      }
      const match = buildMatchQuery(query);
      if (!match) return [];
      let rows: SqliteRow[];
      try {
        rows = driver.all(
          "SELECT path AS file, bm25(capn_fts) AS rank FROM capn_fts WHERE capn_fts MATCH ? ORDER BY rank LIMIT ?",
          [match, options.limit]
        );
      } catch {
        return [];
      }
      return rows.map((row) => {
        const rank = Number(row.rank);
        // bm25() is lower-is-better and unbounded; sigmoid maps it to a
        // deterministic (0, 1) score where higher is better, keeping the
        // existing `score <= 1` display normalization in commands.ts intact.
        return { file: String(row.file), score: 1 / (1 + Math.exp(rank)) };
      });
    },
    async update() {
      if (!hasFts5) {
        warnDegraded();
        return;
      }
      rebuildIndex(driver, root);
    },
  };
}

export async function syncIndex(root: string, warn = false) {
  if (!existsSync(qmdDir(root))) {
    if (warn) {
      process.stderr.write(
        "capn storage updated; run capn init to enable lexical recall\n"
      );
    }
    return;
  }
  const store = await openStore(root);
  try {
    await store.update({});
  } finally {
    await store.close();
  }
}
