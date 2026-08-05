import { createHeightAt } from './heightfield.js';
import { buildTerrainMesh } from './mesh.js';

export function createTerrain({ RAPIER, physicsWorld, scene, params }) {
  let currentParams = { ...params };
  let heightFn = null;
  let mesh = null;
  let body = null;

  function rebuild(nextParams = {}) {
    currentParams = { ...currentParams, ...nextParams };
    heightFn = createHeightAt(currentParams);

    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    if (body) physicsWorld.removeRigidBody(body);

    const built = buildTerrainMesh(currentParams, heightFn);
    mesh = built.mesh;
    scene.add(mesh);

    body = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.trimesh(built.colliderVertices, built.colliderIndices),
      body,
    );
  }

  rebuild();

  return {
    rebuild,
    heightAt: (x, z) => heightFn(x, z),
    get mesh() {
      return mesh;
    },
    get params() {
      return { ...currentParams };
    },
  };
}
