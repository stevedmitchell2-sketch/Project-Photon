import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { NODE_PREFIX } from './contract';
import { loadAsset, type LoadedAsset } from './AssetLoader';

/**
 * React binding for the asset registry.
 *
 * Returns `null` until an asset resolves, and keeps returning `null` when the file does not exist —
 * which is the normal state for most of the registry. Callers render their procedural fallback
 * while this is null and the imported asset when it is not.
 */
export function useAsset(id: string): LoadedAsset | null {
  const [asset, setAsset] = useState<LoadedAsset | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAsset(id).then((loaded) => {
      if (!cancelled) setAsset(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return asset;
}

/**
 * Collects `PART_` and `SOCKET_` nodes from any subtree.
 *
 * The same function the importer uses, deliberately exposed so **procedural geometry can follow the
 * asset contract too**. A hand-built fallback names its meshes `PART_core`, `PART_rail_00` and so
 * on, gets scanned by this, and produces a parts map indistinguishable from an imported asset's.
 *
 * That is what makes the swap genuinely free. There is no "imported path" and "procedural path" in
 * the animation code — there is one path, addressing parts by name, and the two sources of geometry
 * are interchangeable behind it. Dropping in `HeroLaserRifle_v01.glb` changes which branch supplies
 * the subtree and nothing else.
 */
export function scanRig(root: THREE.Object3D | null): {
  parts: Map<string, THREE.Object3D>;
  sockets: Map<string, THREE.Object3D>;
} {
  const parts = new Map<string, THREE.Object3D>();
  const sockets = new Map<string, THREE.Object3D>();
  if (!root) return { parts, sockets };

  root.traverse((node) => {
    if (node.name.startsWith(NODE_PREFIX.part)) {
      parts.set(node.name.slice(NODE_PREFIX.part.length), node);
    } else if (node.name.startsWith(NODE_PREFIX.socket)) {
      sockets.set(node.name.slice(NODE_PREFIX.socket.length), node);
      node.visible = false;
    }
  });

  return { parts, sockets };
}

/**
 * The standard material of a part, or null when it has none the runtime can drive.
 *
 * Animation that mutates emissive needs a `MeshStandardMaterial`; a part wearing a basic or
 * imported material is skipped rather than crashing, so an asset with unexpected materials degrades
 * to "renders but does not pulse" instead of failing.
 */
export function partMaterial(node: THREE.Object3D | undefined): THREE.MeshStandardMaterial | null {
  if (!node) return null;
  const mesh = node as THREE.Mesh;
  if (!mesh.isMesh) return null;
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return (material as THREE.MeshStandardMaterial)?.isMeshStandardMaterial
    ? (material as THREE.MeshStandardMaterial)
    : null;
}
