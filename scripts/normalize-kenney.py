"""Normalize bundled static Kenney vehicles; preserve source files and external textures."""
from pathlib import Path
import json
import struct

root = Path(__file__).resolve().parents[1] / 'packages/vehicles-3d'
lengths = {'sedan': 4.4, 'suv': 4.5, 'suv-luxury': 4.8, 'hatchback-sports': 4.0, 'van': 5.0}
originals = root / 'originals/kenney'
originals.mkdir(parents=True, exist_ok=True)
for name, length in lengths.items():
    output = root / f'assets/kenney/{name}.glb'
    original = originals / f'{name}.glb'
    if not original.exists():
        original.write_bytes(output.read_bytes())
    data = original.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    assert not doc.get('animations') and not doc.get('skins')
    scene = doc['scenes'][doc.get('scene', 0)]
    lo, hi = [float('inf')] * 3, [float('-inf')] * 3
    def visit(index, parent):
        node = doc['nodes'][index]
        # These source assets contain translations only. Fail on changed inputs.
        assert not any(key in node for key in ('matrix', 'rotation', 'scale'))
        offset = [a + b for a, b in zip(parent, node.get('translation', [0, 0, 0]))]
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                bounds = doc['accessors'][primitive['attributes']['POSITION']]
                for axis in range(3):
                    lo[axis] = min(lo[axis], bounds['min'][axis] + offset[axis])
                    hi[axis] = max(hi[axis], bounds['max'][axis] + offset[axis])
        for child in node.get('children', []):
            visit(child, offset)
    for node in scene['nodes']:
        visit(node, [0, 0, 0])
    scale = length / (hi[2] - lo[2])
    # Y-up, nose +Z. Keep every part under one shared ground-centered pivot.
    doc['nodes'].append({
        'name': 'Vehicle ground-centered meter root', 'children': scene['nodes'],
        'scale': [scale] * 3,
        'translation': [-(lo[0] + hi[0]) / 2 * scale, -lo[1] * scale, -(lo[2] + hi[2]) / 2 * scale],
        'extras': {'lengthMeters': length, 'forwardAxis': '+Z', 'upAxis': '+Y'},
    })
    scene['nodes'] = [len(doc['nodes']) - 1]
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary_chunks = data[20 + size:]
    output.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(binary_chunks))
                       + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + binary_chunks)
    print(f'{name}: {length} m, centered pivot, grounded wheels')
