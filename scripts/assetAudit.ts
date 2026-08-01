import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_BUDGETS, ASSET_DIRECTORIES, type AssetKind } from '../src/assets/contract';
import { ASSET_MANIFEST, assetPath, type AssetEntry } from '../src/assets/manifest';
import { budgetSummary, countBySeverity, validateEntry, type Finding } from '../src/assets/validate';

/**
 * Asset audit.
 *
 * Reports the state of the content pipeline: which specified assets exist, which are still to be
 * made, and which of the ones that exist break the rules in `src/assets/contract.ts`.
 *
 * Runs headless with no Three.js and no browser, so it works in CI and on a machine with no GPU.
 * That is why validation lives in pure functions — see `src/assets/validate.ts`.
 *
 * **The missing-asset list is the content backlog.** Every entry in the manifest is a specification
 * an artist can work to, and this tool is the report of how much of it exists. It is expected to
 * show mostly "not yet authored" for some time; that is not a failure state.
 *
 *   npm run asset-audit
 *   npm run asset-audit -- --strict     # exit non-zero on warnings as well as errors
 */

interface Row {
  entry: AssetEntry;
  present: boolean;
  sizeMb: number;
  findings: Finding[];
}

function parseArgs(argv: string[]) {
  return {
    strict: argv.includes('--strict'),
    quiet: argv.includes('--quiet'),
  };
}

/** Files sitting in an asset directory that no manifest entry claims. */
function findOrphans(): string[] {
  const orphans: string[] = [];
  const claimed = new Set(ASSET_MANIFEST.map((e) => assetPath(e)));

  for (const directory of Object.values(ASSET_DIRECTORIES)) {
    const path = join('public', 'assets', directory);
    if (!existsSync(path)) continue;
    for (const file of readdirSync(path)) {
      if (file.startsWith('.')) continue;
      const full = `public/assets/${directory}/${file}`;
      // Textures live beside their meshes and are referenced from inside them, not the manifest.
      if (/\.(png|jpg|ktx2|exr)$/i.test(file)) continue;
      if (!claimed.has(full)) orphans.push(full);
    }
  }
  return orphans;
}

const SEVERITY_MARK = { error: 'ERROR  ', warning: 'WARN   ', info: 'note   ' } as const;

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const rows: Row[] = ASSET_MANIFEST.map((entry) => {
    const path = assetPath(entry);
    const present = existsSync(path);
    const sizeMb = present ? statSync(path).size / 1024 / 1024 : 0;
    // Only manifest-level rules can run without the file. Geometry, texture and socket checks need
    // an importer, and run in the browser as the asset loads — see `AssetLoader`.
    return { entry, present, sizeMb, findings: validateEntry(entry) };
  });

  console.log('\n=== PHOTON ASSET AUDIT ===\n');

  // --- Budgets -------------------------------------------------------------
  console.log('  Budgets by kind');
  for (const kind of Object.keys(ASSET_BUDGETS) as AssetKind[]) {
    console.log(`    ${kind.padEnd(10)} ${budgetSummary(kind)}`);
  }

  // --- Inventory -----------------------------------------------------------
  const present = rows.filter((r) => r.present);
  const missing = rows.filter((r) => !r.present);

  console.log(`\n  Registry: ${rows.length} assets specified, ${present.length} present, ${missing.length} to author\n`);

  const byKind = new Map<AssetKind, Row[]>();
  for (const row of rows) {
    const list = byKind.get(row.entry.kind) ?? [];
    list.push(row);
    byKind.set(row.entry.kind, list);
  }

  for (const [kind, list] of byKind) {
    console.log(`  ${kind.toUpperCase()}`);
    for (const row of list) {
      const mark = row.present ? `${row.sizeMb.toFixed(1)} MB`.padStart(9) : '  — absent';
      console.log(`    ${mark}  ${row.entry.id.padEnd(24)} ${row.entry.file}`);
      if (!args.quiet && !row.present) {
        console.log(`               ${row.entry.description}`);
      }
    }
    console.log('');
  }

  // --- Findings ------------------------------------------------------------
  const allFindings = rows.flatMap((r) => r.findings);
  if (allFindings.length > 0) {
    console.log('  Findings\n');
    for (const finding of allFindings) {
      console.log(`    ${SEVERITY_MARK[finding.severity]} ${finding.asset} [${finding.code}]`);
      console.log(`             ${finding.message}`);
    }
    console.log('');
  }

  // --- Orphans -------------------------------------------------------------
  const orphans = findOrphans();
  if (orphans.length > 0) {
    console.log('  Unclaimed files (present on disk, absent from the manifest)\n');
    for (const orphan of orphans) console.log(`    ${orphan}`);
    console.log('\n    Add a manifest entry or delete the file. An asset nothing references still\n    ships in the build and still costs download size.\n');
  }

  // --- Verdict -------------------------------------------------------------
  const counts = countBySeverity(allFindings);
  console.log('  ---');
  console.log(
    `  ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} note(s), ${orphans.length} unclaimed file(s)`,
  );

  if (missing.length === rows.length) {
    console.log(
      '\n  No assets authored yet. The manifest is the specification; every entry above is a\n' +
        '  brief an artist or generator can work to, and the runtime falls back to procedural\n' +
        '  geometry until the file appears. See docs/CONTENT_ROADMAP.md for the order.\n',
    );
  }

  const failed = counts.error > 0 || (args.strict && counts.warning > 0);
  console.log(failed ? '  AUDIT FAILED\n' : '  AUDIT PASSED\n');
  process.exit(failed ? 1 : 0);
}

main();
