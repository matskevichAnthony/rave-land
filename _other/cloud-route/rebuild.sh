#!/usr/bin/env bash
# Пересборка персонажа целиком: меш в бюджет и текстуру, риг, веса, mocap-клипы, GLB в игру.
set -euo pipefail
ROOT=/home/anton-matzkaim/rave-land
BLENDER="$ROOT/_other/auto-rig/blender-4.2.9-linux-x64/blender"
WORK="$ROOT/_other/cloud-route"
RIG="$WORK/techno-raver-rig"
BVH="$ROOT/_other/mocap/bandai"

"$BLENDER" -b --python "$WORK/prep_mesh.py" -- \
    "$WORK/techno-raver-raw.glb" "$ROOT/_other/incoming/techno-raver.png" \
    "$WORK/techno-raver-prepped.glb" 15000
"$BLENDER" -b --python "$RIG/step1_rig.py"
"$BLENDER" -b --python "$RIG/step2_weights.py"

rm -f "$RIG/clips.blend"
"$ROOT/tools/anim/bvh2clip" "$BVH/dataset-1_walk_normal_001.bvh" Walk \
    --start 1.2 --end 4.0 --rig-dir "$RIG" --out "$WORK/techno-raver-animated.glb"
"$ROOT/tools/anim/bvh2clip" "$BVH/dataset-1_run_normal_001.bvh" Run \
    --rig-dir "$RIG" --out "$WORK/techno-raver-animated.glb"
"$ROOT/tools/anim/bvh2clip" "$BVH/dataset-1_dance-short_normal_001.bvh" Dance \
    --start 51.0 --end 57.7 --rig-dir "$RIG" --out "$WORK/techno-raver-animated.glb"

cp "$WORK/techno-raver-animated.glb" "$ROOT/public/assets/models/techno-raver.glb"
echo "REBUILD DONE $(du -h "$ROOT/public/assets/models/techno-raver.glb" | cut -f1)"
