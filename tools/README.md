# tools/ — карта команд для агента: «реализуй персонажа из картинки»

Когда владелец даёт картинку и говорит «сделай персонажа» — идти строго по этим
шагам. Стратегия и дерево выбора маршрутов: `docs/PIPELINE.md`. Журнал граблей:
`docs/FINDINGS.md` (прочитать ОБА перед стартом).

## Шаг 0. Проверить картинку

T-поза/A-поза, весь персонаж в кадре, светлый однотонный фон, ровный свет,
один персонаж. Если картинка не такая — попросить владельца перегенерировать
(шаблон промпта: `docs/PIPELINE.md` §0). Плохая картинка = плохой меш.

Картинку сохранить: `_other/incoming/<имя-персонажа>.png`.

## Шаг 1. Меш из картинки

```bash
pip install gradio_client   # один раз
python3 tools/gen/image2mesh.py _other/incoming/<имя>.png _other/<имя>-rig/mesh-raw.glb
# альтернативный провайдер: --space hunyuan
```

Если Space перегружен — второй провайдер, потом вручную через браузер
(agent-browser), потом Tripo API (маршрут B). Провайдера ЗАПИСАТЬ — он пойдёт
в `provenance.model`.

## Шаг 2. Авториг (17 костей, Blender headless)

Скопировать свежие версии скриптов из последнего рига (`_other/bold-raver-rig/`
новее, чем `auto-rig`) в `_other/<имя>-rig/` и выполнить по порядку:

```bash
cd _other/<имя>-rig
blender -b -P step1_rig.py        # скелет по landmarks
blender -b -P step2_weights.py    # веса; если есть голые вершины — step2b_fix_unweighted.py
blender -b -P step3_anim.py       # базовые Idle/Aim (самописные)
python3 verify_glb.py             # проверка костей/весов/клипов
```

`landmarks.json` — руками разметить 2D-координаты суставов по рендерам
`diag_render.py` (front/side). Это единственный ручной шаг рига.

## Шаг 3. Нормальные анимации (mocap, НЕ самописные)

```bash
tools/anim/bvh2clip _other/mocap/bandai/dataset-1_walk_normal_001.bvh Walk --rig-dir _other/<имя>-rig
tools/anim/bvh2clip _other/mocap/bandai/dataset-1_run_normal_001.bvh Run --rig-dir _other/<имя>-rig
tools/anim/bvh2clip _other/mocap/bandai/dataset-1_dance-short_normal_001.bvh Dance --rig-dir _other/<имя>-rig
```

Мержа клипов в один GLB: `_other/mocap/retarget/merge.py`. Новые CC0-источники
BVH (Mesh2Motion, Quaternius, CMU) — см. `docs/research/3d-services-2026.md`;
источник ЗАПИСАТЬ в `provenance.animations` вместе с лицензией.

## Шаг 4. Постобработка (обязательно)

```bash
cd tools && npm i   # один раз
node tools/postprocess.mjs <вход.glb> public/models/<имя>-final.glb
```

Без неё GLB весит десятки МБ; после — webp-текстуры + квантизация.

## Шаг 5. В игру + provenance

1. `public/world.json` → добавить NPC: `src`, позиция, `data`,
   **обязательно `provenance: { model, rig, animations }`** — выводится
   в карточке NPC для сравнения провайдеров.
2. Проверить в браузере: `/characters.html` (вьюер клипов) и спавн в игре.
   В браузере сбросить `localStorage['rave-land-world']`, иначе старый мир.
3. Отдельный коммит на персонажа. Скриншоты — в `_other/<имя>-rig/`.

## Известные ловушки

- `retarget.py` требует `rig.blend` в `--rig-dir` — его создаёт step1/step2.
- Bandai BVH — CC BY-NC: для коммерции заменить на CC0 (Mesh2Motion/Quaternius/CMU).
- Blender на этой машине: см. `tools/anim/build/` и F-005 в FINDINGS.
- gltf-transform деп ставится в `tools/` (`cd tools && npm i`), НЕ в корень игры.
