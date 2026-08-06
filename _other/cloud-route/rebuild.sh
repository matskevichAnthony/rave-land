#!/usr/bin/env bash
# Персонаж целиком из сырого меша: бюджет с текстурой, риг, веса, mocap-клипы,
# готовый GLB в public/assets/models.
#
# Запуск: rebuild.sh <имя> [треугольников]
# Ждёт рядом <имя>-raw.glb (выход tools/gen/image2mesh.py)
# и _other/incoming/<имя>.png (концепт, с которого снимается текстура).
set -euo pipefail

NAME="${1:?usage: rebuild.sh <имя> [треугольников]}"
TARGET_TRIS="${2:-15000}"

ROOT=/home/anton-matzkaim/rave-land
BLENDER="$ROOT/_other/auto-rig/blender-4.2.9-linux-x64/blender"
WORK="$ROOT/_other/cloud-route"
RIG="$WORK/$NAME-rig"
BVH="$ROOT/_other/mocap/bandai"

"$BLENDER" -b --python "$WORK/prep_mesh.py" -- \
    "$WORK/$NAME-raw.glb" "$ROOT/_other/incoming/$NAME.png" \
    "$WORK/$NAME-prepped.glb" "$TARGET_TRIS"
"$BLENDER" -b --python "$WORK/step1_rig.py" -- "$RIG" "$WORK/$NAME-prepped.glb"
"$BLENDER" -b --python "$WORK/step2_weights.py" -- "$RIG"

# Хранилище клипов пересобирается с нуля: иначе в NLA попадут позы прошлой версии
# этого же скелета, посчитанные от другой rest-позы.
rm -f "$RIG/clips.blend"
"$ROOT/tools/anim/bvh2clip" "$BVH/dataset-1_walk_normal_001.bvh" Walk \
    --start 1.2 --end 4.0 --rig-dir "$RIG" --out "$WORK/$NAME-animated.glb"
"$ROOT/tools/anim/bvh2clip" "$BVH/dataset-1_run_normal_001.bvh" Run \
    --rig-dir "$RIG" --out "$WORK/$NAME-animated.glb"
"$ROOT/tools/anim/bvh2clip" "$BVH/dataset-1_dance-short_normal_001.bvh" Dance \
    --start 51.0 --end 57.7 --rig-dir "$RIG" --out "$WORK/$NAME-animated.glb"

cp "$WORK/$NAME-animated.glb" "$ROOT/public/assets/models/$NAME.glb"
echo "REBUILD DONE $NAME $(du -h "$ROOT/public/assets/models/$NAME.glb" | cut -f1)"
