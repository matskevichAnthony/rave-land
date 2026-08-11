#!/usr/bin/env python3
"""GTA San Andreas ped model -> game-ready GLB with skeleton, weights and skin.

    python3 tools/gta/dff2glb.py <model.dff> -o out.glb [--txd model.txd]

The .txd next to the model is picked up on its own; textures are unpacked to
PNG here because Pillow lives in the system Python, then handed to the Blender
pass as a name-to-file map. Shrinking and quantising the result is the same
postprocess.mjs the animation pipeline uses.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

TOOLS_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = TOOLS_DIR.parent
BLENDER = REPO_ROOT / '_other' / 'auto-rig' / 'blender-4.2.9-linux-x64' / 'blender'
POSTPROCESS = REPO_ROOT / '_other' / 'auto-rig' / 'postprocess.mjs'
BUILDER = TOOLS_DIR / 'gta' / 'dff_blender.py'


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('dff', type=Path, help='RenderWare model, e.g. maddogg.dff')
    parser.add_argument('-o', '--output', type=Path, required=True, help='GLB file to write')
    parser.add_argument('--txd', type=Path,
                        help='texture dictionary (default: the .txd beside the model)')
    parser.add_argument('--ifp', type=Path, help='animation package to take clips from')
    parser.add_argument('--clips', default='',
                        help='comma separated animation names, e.g. IDLE_stance,WALK_civi')
    parser.add_argument('--raw', action='store_true',
                        help='skip postprocess.mjs and keep the Blender export as it is')
    return parser.parse_args()


def unpack_textures(txd, directory):
    """Texture name (lowercased) -> PNG path, empty when there is no dictionary."""
    if txd is None or not txd.exists():
        return {}
    from gta.txd import load_txd
    written = {}
    for name, texture in load_txd(txd).items():
        png = directory / f'{name}.png'
        texture.save_png(png)
        written[name.lower()] = str(png)
    return written


def run(command):
    result = subprocess.run([str(part) for part in command], check=False)
    if result.returncode:
        raise SystemExit(f'{Path(command[0]).name} failed with code {result.returncode}')


def main():
    args = parse_args()
    if not args.dff.exists():
        raise SystemExit(f'no such model: {args.dff}')
    txd = args.txd if args.txd else args.dff.with_suffix('.txd')

    with tempfile.TemporaryDirectory(prefix='dff2glb-') as work:
        work = Path(work)
        textures = unpack_textures(txd, work)
        manifest = work / 'textures.json'
        manifest.write_text(json.dumps(textures))
        raw = args.output if args.raw else work / 'raw.glb'
        build = [BLENDER, '-b', '--python', BUILDER, '--',
                 '--dff', args.dff, '--glb', raw, '--textures', manifest]
        if args.clips:
            build += ['--ifp', args.ifp, '--clips', args.clips]
        run(build)
        if not args.raw:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            run(['node', POSTPROCESS, raw, args.output])
    print(f'{args.dff.name} -> {args.output} '
          f'({args.output.stat().st_size / 1024:.0f} KB, {len(textures)} textures)')


if __name__ == '__main__':
    main()
