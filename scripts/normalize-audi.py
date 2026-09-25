"""Prepare the Sketchfab GLB for native Mapbox rendering, keeping visible geometry."""
from pathlib import Path
import json
import struct

root = Path(__file__).resolve().parents[1] / 'packages/vehicles-3d/assets/audi'
data = (root.parent.parent / 'originals/audi-a1-quattro.original.glb').read_bytes()
json_size = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + json_size])
if doc.get('animations') or doc.get('skins'):
    raise ValueError('This conversion expects a static, unskinned source model.')

# SketchUp exports invisible edge overlays as mode=LINES. The Mapbox native
# model layer treats those indices as triangles, producing white shards.
# Remove those helpers and alpha=0 primitives, not the actual car surfaces.
meshes = []
mesh_map = {}
removed = 0
for index, mesh in enumerate(doc['meshes']):
    primitives = []
    for primitive in mesh['primitives']:
        material = doc['materials'][primitive['material']]
        alpha = material.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[3]
        if primitive.get('mode', 4) != 4 or (material.get('alphaMode') == 'BLEND' and alpha == 0):
            removed += 1
        else:
            primitives.append(primitive)
    if primitives:
        mesh_map[index] = len(meshes)
        meshes.append({**mesh, 'primitives': primitives})
doc['meshes'] = meshes
for node in doc['nodes']:
    if 'mesh' in node:
        if node['mesh'] in mesh_map:
            node['mesh'] = mesh_map[node['mesh']]
        else:
            del node['mesh']

# Drop unused accessors/views where possible; shared binary views are retained.
used_accessors = set()
for mesh in meshes:
    for primitive in mesh['primitives']:
        used_accessors.update(primitive['attributes'].values())
        if 'indices' in primitive:
            used_accessors.add(primitive['indices'])
accessor_map = {old: new for new, old in enumerate(sorted(used_accessors))}
accessors = [doc['accessors'][old] for old in sorted(used_accessors)]
if any('sparse' in accessor for accessor in accessors):
    raise ValueError('Sparse accessors require a different packing path.')
for mesh in meshes:
    for primitive in mesh['primitives']:
        primitive['attributes'] = {key: accessor_map[value] for key, value in primitive['attributes'].items()}
        if 'indices' in primitive:
            primitive['indices'] = accessor_map[primitive['indices']]
doc['accessors'] = accessors
used_views = {accessor['bufferView'] for accessor in accessors}
used_views.update(image['bufferView'] for image in doc.get('images', []) if 'bufferView' in image)
view_map = {old: new for new, old in enumerate(sorted(used_views))}
old_binary = data[28 + json_size:]
packed = bytearray()
views = []
for old in sorted(used_views):
    view = doc['bufferViews'][old]
    if view.get('buffer', 0) != 0:
        raise ValueError('Expected one embedded binary buffer.')
    packed.extend(b'\0' * ((-len(packed)) % 4))
    start = view.get('byteOffset', 0)
    views.append({**view, 'buffer': 0, 'byteOffset': len(packed)})
    packed.extend(old_binary[start:start + view['byteLength']])
for accessor in accessors:
    accessor['bufferView'] = view_map[accessor['bufferView']]
for image in doc.get('images', []):
    if 'bufferView' in image:
        image['bufferView'] = view_map[image['bufferView']]
doc['bufferViews'] = views
doc['buffers'] = [{'byteLength': len(packed)}]
packed.extend(b'\0' * ((-len(packed)) % 4))
# This source is Z-up before its existing -90° X root transform. All meshes
# have no additional transforms. Compute bounds from every POSITION accessor.
mins = [float('inf')] * 3
maxs = [float('-inf')] * 3
for mesh in doc['meshes']:
    for primitive in mesh['primitives']:
        accessor = doc['accessors'][primitive['attributes']['POSITION']]
        for axis in range(3):
            mins[axis] = min(mins[axis], accessor['min'][axis])
            maxs[axis] = max(maxs[axis], accessor['max'][axis])
scale = 4.0 / (maxs[1] - mins[1])
wrapper = {
    'name': 'Map vehicle — normalized to 4m length, ground-centered pivot',
    'children': doc['scenes'][doc.get('scene', 0)]['nodes'],
    'scale': [scale] * 3,
    'translation': [-(mins[0] + maxs[0]) / 2 * scale, -mins[2] * scale, (mins[1] + maxs[1]) / 2 * scale],
}
doc['nodes'].append(wrapper)
doc['scenes'][doc.get('scene', 0)]['nodes'] = [len(doc['nodes']) - 1]
doc['asset']['extras']['modifications'] = 'Scale normalized to 4m length; ground-centered pivot. Invisible SketchUp line overlays and fully transparent helper geometry removed. Visible car surfaces and textures retained.'
encoded = json.dumps(doc, separators=(',', ':')).encode()
encoded += b' ' * ((-len(encoded)) % 4)
binary = struct.pack('<II', len(packed), 0x004E4942) + packed
output = struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(binary))
output += struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + binary
(root / 'audi-a1-quattro.glb').write_bytes(output)
print(f'Prepared Audi: {len(output):,} bytes, scale {scale:.6f}, removed {removed} invisible helper primitives')
