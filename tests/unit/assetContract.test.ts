import { describe, expect, it } from 'vitest';
import {
  ANIMATED_PARTS,
  ASSET_BUDGETS,
  ASSET_FILENAME,
  NODE_PREFIX,
  REQUIRED_SOCKETS,
  TEXTURE_FILENAME,
  type AssetKind,
} from '@/assets/contract';
import { ASSET_MANIFEST, assetPath, findAsset } from '@/assets/manifest';
import { validateEntry, validateInspection, type AssetInspection } from '@/assets/validate';

/**
 * The asset contract, enforced.
 *
 * These tests are the reason the contract can be trusted by someone who has never read it. An
 * artist or a generative tool follows the naming rules, the audit tool reports compliance, and
 * these keep the rules themselves from silently changing underneath both.
 *
 * Everything here is pure — no Three.js, no DOM, no filesystem — which is what lets the same
 * validation run in CI, in the audit CLI, and in the browser as an asset loads.
 */

const kinds = Object.keys(ASSET_BUDGETS) as AssetKind[];

const inspection = (overrides: Partial<AssetInspection> = {}): AssetInspection => ({
  nodeNames: [],
  triangles: 100,
  lodTriangles: [],
  materialZones: [],
  textures: [],
  largestTexture: 0,
  textureMemoryMb: 0,
  ...overrides,
});

describe('asset naming', () => {
  it('requires PascalCase with a two-digit version suffix', () => {
    expect(ASSET_FILENAME.test('HeroLaserRifle_v01.glb')).toBe(true);
    expect(ASSET_FILENAME.test('WallPanelLarge_v12.gltf')).toBe(true);

    // The version suffix is what lets an artist drop _v02 beside _v01 and switch by one manifest
    // line, so a missing one is an error rather than a style preference.
    expect(ASSET_FILENAME.test('HeroLaserRifle.glb')).toBe(false);
    expect(ASSET_FILENAME.test('heroLaserRifle_v01.glb')).toBe(false);
    expect(ASSET_FILENAME.test('Hero_Laser_Rifle_v01.glb')).toBe(false);
    expect(ASSET_FILENAME.test('HeroLaserRifle_v1.glb')).toBe(false);
    expect(ASSET_FILENAME.test('HeroLaserRifle_v01.blend')).toBe(false);
  });

  it('requires textures to declare which map they are', () => {
    expect(TEXTURE_FILENAME.test('HeroLaserRifle_shell_BC.png')).toBe(true);
    expect(TEXTURE_FILENAME.test('HeroLaserRifle_shell_ORM.png')).toBe(true);
    expect(TEXTURE_FILENAME.test('HeroLaserRifle_shell_N.ktx2')).toBe(true);

    expect(TEXTURE_FILENAME.test('shell_diffuse.png')).toBe(false);
    expect(TEXTURE_FILENAME.test('HeroLaserRifle_shell.png')).toBe(false);
  });
});

describe('manifest', () => {
  it('has unique ids', () => {
    const ids = ASSET_MANIFEST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every asset in its kind directory', () => {
    for (const entry of ASSET_MANIFEST) {
      expect(assetPath(entry)).toMatch(/^public\/assets\/[a-z]+\//);
    }
  });

  it('passes its own validation', () => {
    // The manifest is the specification artists work to. If it violates the contract, every asset
    // authored against it inherits the violation.
    for (const entry of ASSET_MANIFEST) {
      const errors = validateEntry(entry).filter((f) => f.severity === 'error');
      expect(errors, `${entry.id}: ${errors.map((e) => e.message).join('; ')}`).toEqual([]);
    }
  });

  it('resolves known ids and rejects unknown ones', () => {
    expect(findAsset('hero_rifle')?.kind).toBe('weapon');
    expect(findAsset('does_not_exist')).toBeUndefined();
  });
});

describe('budgets', () => {
  it('gives instanced kinds tighter material budgets than the single-instance weapon', () => {
    // A weapon zone costs one draw call per frame; a character zone costs one per player per frame.
    expect(ASSET_BUDGETS.character.materials).toBeLessThan(ASSET_BUDGETS.weapon.materials);
    expect(ASSET_BUDGETS.module.materials).toBeLessThan(ASSET_BUDGETS.character.materials);
  });

  it('requires LODs for kinds that appear at distance', () => {
    expect(ASSET_BUDGETS.character.lodLevels).toBeGreaterThan(1);
    expect(ASSET_BUDGETS.module.lodLevels).toBeGreaterThan(1);
    // A view model is never seen at distance, so it needs fewer.
    expect(ASSET_BUDGETS.weapon.lodLevels).toBeLessThanOrEqual(ASSET_BUDGETS.character.lodLevels);
  });
});

describe('inspection validation', () => {
  const rifle = findAsset('hero_rifle')!;

  it('fails an asset missing a required socket', () => {
    const findings = validateInspection(rifle, inspection({ nodeNames: ['PART_core'] }));
    const missing = findings.filter((f) => f.code === 'socket/missing');
    expect(missing.length).toBe(REQUIRED_SOCKETS.weapon.length);
    expect(missing[0].severity).toBe('error');
  });

  it('accepts an asset that declares every required socket', () => {
    const nodeNames = REQUIRED_SOCKETS.weapon.map((s) => `${NODE_PREFIX.socket}${s}`);
    const findings = validateInspection(rifle, inspection({ nodeNames }));
    expect(findings.filter((f) => f.code === 'socket/missing')).toEqual([]);
  });

  it('warns when an asset has no animated parts at all', () => {
    const nodeNames = REQUIRED_SOCKETS.weapon.map((s) => `${NODE_PREFIX.socket}${s}`);
    const findings = validateInspection(rifle, inspection({ nodeNames }));
    expect(findings.some((f) => f.code === 'parts/none')).toBe(true);
  });

  it('enforces the triangle budget', () => {
    const findings = validateInspection(
      rifle,
      inspection({ triangles: ASSET_BUDGETS.weapon.triangles + 1 }),
    );
    const over = findings.find((f) => f.code === 'budget/triangles');
    expect(over?.severity).toBe('error');
  });

  it('rejects unpacked roughness and metalness maps', () => {
    // Three separate maps cost three samples per fragment instead of one, on a frame that is
    // already fragment-bound. This is the rule most likely to be broken by an external tool's
    // default export settings, so it is an error rather than a warning.
    const findings = validateInspection(
      rifle,
      inspection({ textures: ['Rifle_shell_R.png', 'Rifle_shell_M.png'] }),
    );
    const unpacked = findings.find((f) => f.code === 'texture/unpacked');
    expect(unpacked?.severity).toBe('error');
  });

  it('warns when an LOD saves nothing', () => {
    const findings = validateInspection(
      rifle,
      inspection({ lodTriangles: [10_000, 9_800] }),
    );
    expect(findings.some((f) => f.code === 'lod/insufficient-drop')).toBe(true);
  });

  it('warns about zones the file has but the manifest does not map', () => {
    const nodeNames = [
      ...REQUIRED_SOCKETS.weapon.map((s) => `${NODE_PREFIX.socket}${s}`),
      `${NODE_PREFIX.material}mystery`,
    ];
    const findings = validateInspection(rifle, inspection({ nodeNames }));
    expect(findings.some((f) => f.code === 'zones/undeclared')).toBe(true);
  });
});

describe('contract completeness', () => {
  it('defines budgets, sockets and parts for every asset kind', () => {
    for (const kind of kinds) {
      expect(ASSET_BUDGETS[kind]).toBeDefined();
      expect(REQUIRED_SOCKETS[kind]).toBeDefined();
      expect(ANIMATED_PARTS[kind]).toBeDefined();
    }
  });

  it('keeps node prefixes mutually unambiguous', () => {
    // A prefix that is a prefix of another prefix would make node classification order-dependent.
    const prefixes = Object.values(NODE_PREFIX);
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a === b) continue;
        expect(a.startsWith(b), `"${a}" starts with "${b}"`).toBe(false);
      }
    }
  });
});
