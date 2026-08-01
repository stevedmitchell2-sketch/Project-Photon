import {
  ASSET_BUDGETS,
  ASSET_FILENAME,
  ANIMATED_PARTS,
  NODE_PREFIX,
  PREFERRED_FORMAT,
  REQUIRED_SOCKETS,
  TEXTURE_FILENAME,
  type AssetKind,
} from './contract';
import type { AssetEntry } from './manifest';

/**
 * Asset validation.
 *
 * Pure functions over plain descriptions of an asset — no Three.js, no DOM, no filesystem. That is
 * what lets the same rules run in three places without duplication:
 *
 *   1. `npm run asset-audit`, over the whole registry, in CI;
 *   2. the importer at runtime in development, warning as an asset loads;
 *   3. unit tests, which is how the rules themselves are kept honest.
 *
 * A validator that could only run inside the game would be a validator nobody ran.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  /** Asset id, or the manifest entry being checked. */
  asset: string;
  /** Short machine-ish code, so findings can be filtered and suppressed. */
  code: string;
  message: string;
}

/**
 * What the importer found inside a file.
 *
 * Deliberately a flat summary rather than a scene graph: validation should be possible from a glTF
 * parsed by any means, including a build-time script that never constructs Three.js objects.
 */
export interface AssetInspection {
  /** Node names present in the file, unmodified. */
  nodeNames: string[];
  /** Triangle count of the LOD0 (or only) representation. */
  triangles: number;
  /** Triangle counts per LOD level, index 0 being LOD0. Empty when the asset has no LOD groups. */
  lodTriangles: number[];
  /** Distinct material zones declared via `MAT_` nodes. */
  materialZones: string[];
  /** Texture file names referenced by the asset. */
  textures: string[];
  /** Largest texture edge in pixels, or 0 when unknown. */
  largestTexture: number;
  /** Total decoded texture memory in megabytes, or 0 when unknown. */
  textureMemoryMb: number;
}

const socketsIn = (nodeNames: string[]): string[] =>
  nodeNames.filter((n) => n.startsWith(NODE_PREFIX.socket)).map((n) => n.slice(NODE_PREFIX.socket.length));

const partsIn = (nodeNames: string[]): string[] =>
  nodeNames.filter((n) => n.startsWith(NODE_PREFIX.part)).map((n) => n.slice(NODE_PREFIX.part.length));

const zonesIn = (nodeNames: string[]): string[] =>
  nodeNames.filter((n) => n.startsWith(NODE_PREFIX.material)).map((n) => n.slice(NODE_PREFIX.material.length));

/**
 * Validates a manifest entry on its own, without the file.
 *
 * Runs even when the asset is missing from disk, because most naming and configuration mistakes are
 * visible in the manifest and it is far cheaper to catch them before an artist exports anything.
 */
export function validateEntry(entry: AssetEntry): Finding[] {
  const findings: Finding[] = [];
  const push = (severity: Severity, code: string, message: string) =>
    findings.push({ severity, asset: entry.id, code, message });

  if (!ASSET_FILENAME.test(entry.file)) {
    push(
      'error',
      'naming/file',
      `"${entry.file}" does not match PascalCaseName_vNN.ext — the version suffix is mandatory so an asset can be iterated without ambiguity about which file is current.`,
    );
  }

  if (entry.format !== PREFERRED_FORMAT) {
    push(
      'warning',
      'format/non-preferred',
      `${entry.format} is accepted but converted on import and loses material fidelity. Prefer ${PREFERRED_FORMAT}.`,
    );
  }

  if (!entry.file.toLowerCase().endsWith(`.${entry.format}`)) {
    push('error', 'format/mismatch', `declared format "${entry.format}" does not match the file extension.`);
  }

  const budget = ASSET_BUDGETS[entry.kind];
  const zoneNames = (entry.zones ?? []).map((z) => z.zone);

  if (zoneNames.length > budget.materials) {
    push(
      'error',
      'budget/materials',
      `${zoneNames.length} material zones exceeds the ${budget.materials} allowed for a ${entry.kind}. Every zone is a draw call per instance.`,
    );
  }

  const duplicateZones = zoneNames.filter((z, i) => zoneNames.indexOf(z) !== i);
  if (duplicateZones.length > 0) {
    push('error', 'zones/duplicate', `duplicate material zones: ${[...new Set(duplicateZones)].join(', ')}.`);
  }

  for (const zone of entry.zones ?? []) {
    if (zone.useSourceMaterial) {
      push(
        'info',
        'zones/source-material',
        `zone "${zone.zone}" keeps its authored material and will not follow the project's lighting response or team colour.`,
      );
    }
  }

  return findings;
}

/**
 * Validates a loaded asset against its manifest entry and its kind's budget.
 *
 * Separated from `validateEntry` because this half needs the file, and the audit tool has to be
 * useful for assets that do not exist yet.
 */
export function validateInspection(entry: AssetEntry, inspection: AssetInspection): Finding[] {
  const findings: Finding[] = [];
  const push = (severity: Severity, code: string, message: string) =>
    findings.push({ severity, asset: entry.id, code, message });

  const budget = ASSET_BUDGETS[entry.kind];

  // --- Sockets -------------------------------------------------------------
  const sockets = socketsIn(inspection.nodeNames);
  for (const required of REQUIRED_SOCKETS[entry.kind]) {
    if (!sockets.includes(required)) {
      push(
        'error',
        'socket/missing',
        `missing required socket "${NODE_PREFIX.socket}${required}". The runtime attaches to it by name; without it the asset cannot be mounted.`,
      );
    }
  }
  for (const extra of entry.extraSockets ?? []) {
    if (!sockets.includes(extra)) {
      push('warning', 'socket/declared-missing', `manifest promises socket "${extra}" but the file does not contain it.`);
    }
  }

  // --- Animated parts ------------------------------------------------------
  const parts = partsIn(inspection.nodeNames);
  const expectedParts = ANIMATED_PARTS[entry.kind];
  const missingParts = expectedParts.filter((p) => !parts.includes(p));
  if (expectedParts.length > 0 && missingParts.length === expectedParts.length) {
    push(
      'warning',
      'parts/none',
      `no PART_ nodes found. The asset will render but nothing on it will animate; a ${entry.kind} normally exposes ${expectedParts.slice(0, 3).join(', ')}...`,
    );
  } else if (missingParts.length > 0) {
    push('info', 'parts/partial', `animated parts not present: ${missingParts.join(', ')}. These are skipped at runtime.`);
  }

  // --- Material zones ------------------------------------------------------
  const declared = new Set((entry.zones ?? []).map((z) => z.zone));
  const found = zonesIn(inspection.nodeNames);
  for (const zone of found) {
    if (!declared.has(zone)) {
      push(
        'warning',
        'zones/undeclared',
        `file contains zone "${zone}" with no mapping in the manifest — it will keep whatever material it shipped with.`,
      );
    }
  }
  for (const zone of declared) {
    if (found.length > 0 && !found.includes(zone)) {
      push('warning', 'zones/unused', `manifest maps zone "${zone}" but no ${NODE_PREFIX.material}${zone} node exists.`);
    }
  }

  // --- Budgets -------------------------------------------------------------
  if (inspection.triangles > budget.triangles) {
    push(
      'error',
      'budget/triangles',
      `${inspection.triangles.toLocaleString()} triangles exceeds the ${budget.triangles.toLocaleString()} budget for a ${entry.kind}.`,
    );
  }

  if (inspection.largestTexture > budget.textureSize) {
    push(
      'error',
      'budget/texture-size',
      `largest texture is ${inspection.largestTexture}px, over the ${budget.textureSize}px limit.`,
    );
  }

  if (inspection.textureMemoryMb > budget.textureMemoryMb) {
    push(
      'error',
      'budget/texture-memory',
      `${inspection.textureMemoryMb.toFixed(1)} MB of texture exceeds the ${budget.textureMemoryMb} MB budget. The frame is fragment-bound; texture memory is not free here.`,
    );
  }

  // --- LODs ----------------------------------------------------------------
  if (budget.lodLevels > 1) {
    if (inspection.lodTriangles.length < budget.lodLevels) {
      push(
        'warning',
        'lod/missing',
        `${inspection.lodTriangles.length || 1} LOD level(s) present, ${budget.lodLevels} expected. Name them ${NODE_PREFIX.lod}0, ${NODE_PREFIX.lod}1, ...`,
      );
    } else {
      for (let i = 1; i < inspection.lodTriangles.length; i++) {
        const previous = inspection.lodTriangles[i - 1];
        const current = inspection.lodTriangles[i];
        const drop = previous > 0 ? 1 - current / previous : 0;
        if (drop < budget.lodDrop) {
          push(
            'warning',
            'lod/insufficient-drop',
            `LOD${i} removes only ${Math.round(drop * 100)}% of LOD${i - 1}'s triangles; ${Math.round(budget.lodDrop * 100)}% expected. An LOD that saves nothing costs a draw call for nothing.`,
          );
        }
      }
    }
  }

  // --- Textures ------------------------------------------------------------
  for (const texture of inspection.textures) {
    const bare = texture.split('/').pop() ?? texture;
    if (!TEXTURE_FILENAME.test(bare)) {
      push(
        'warning',
        'naming/texture',
        `texture "${bare}" does not match AssetName_zone_MAP.ext (MAP is BC, N, ORM or E).`,
      );
    }
  }

  const hasSeparateRoughness = inspection.textures.some((t) => /_R\.|_Rough/i.test(t));
  const hasSeparateMetal = inspection.textures.some((t) => /_M\.|_Metal/i.test(t));
  if (hasSeparateRoughness || hasSeparateMetal) {
    push(
      'error',
      'texture/unpacked',
      'roughness and metalness must be packed into a single ORM texture. Three separate maps cost three samples per fragment instead of one.',
    );
  }

  return findings;
}

/** Convenience: everything checkable about an entry, with or without its file. */
export function validateAsset(entry: AssetEntry, inspection?: AssetInspection): Finding[] {
  const findings = validateEntry(entry);
  if (inspection) findings.push(...validateInspection(entry, inspection));
  return findings;
}

export const countBySeverity = (findings: Finding[]): Record<Severity, number> => ({
  error: findings.filter((f) => f.severity === 'error').length,
  warning: findings.filter((f) => f.severity === 'warning').length,
  info: findings.filter((f) => f.severity === 'info').length,
});

/** Budget summary for a kind, for the audit report header. */
export const budgetSummary = (kind: AssetKind): string => {
  const b = ASSET_BUDGETS[kind];
  return `${b.triangles.toLocaleString()} tris · ${b.materials} zones · ${b.textureSize}px · ${b.textureMemoryMb} MB · ${b.lodLevels} LODs`;
};
