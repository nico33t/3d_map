/** Calibration for the bundled Audi GLB, in its original mesh coordinates. */
export function blackAudiBadges(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer), jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binStart = 28 + jsonLength, binLength = view.getUint32(20 + jsonLength, true);
  const material = json.materials.findIndex((m: { name: string }) => m.name === '2021_Audi_A1_S-Line_ChromeTrims');
  const mesh = json.meshes.find((m: { primitives: { material: number }[] }) => m.primitives.some(p => p.material === material));
  if (material < 0 || !mesh || mesh.primitives.length !== 1) throw Error('Audi badge geometry unavailable');
  const primitive = mesh.primitives[0];
  const pos = json.accessors[primitive.attributes.POSITION], idx = json.accessors[primitive.indices];
  if (pos.componentType !== 5126 || pos.type !== 'VEC3' || ![5123, 5125].includes(idx.componentType)) throw Error('Unsupported Audi geometry');
  const pv = json.bufferViews[pos.bufferView], iv = json.bufferViews[idx.bufferView];
  const width = idx.componentType === 5123 ? 2 : 4;
  const positionOffset = binStart + (pv.byteOffset ?? 0) + (pos.byteOffset ?? 0);
  const indexOffset = binStart + (iv.byteOffset ?? 0) + (idx.byteOffset ?? 0);
  const badge = (i: number) => {
    const offset = positionOffset + i * (pv.byteStride ?? 12);
    const x = view.getFloat32(offset, true), y = view.getFloat32(offset + 4, true), z = view.getFloat32(offset + 8, true);
    return (x > 37 && x < 50 && y > .9 && y < 2.1 && z > 24 && z < 28.3)
      || (x > 38 && x < 48 && y > 175 && y < 176.6 && z > 40 && z < 42.9);
  };
  const rings: number[] = [], trim: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const triangle = [0, 1, 2].map(k => width === 2 ? view.getUint16(indexOffset + (i + k) * width, true) : view.getUint32(indexOffset + (i + k) * width, true));
    (triangle.every(badge) ? rings : trim).push(...triangle);
  }
  if (!rings.length || !trim.length) throw Error('Audi rings could not be isolated');
  const extra = new Uint32Array([...trim, ...rings]);
  const offset = Math.ceil(binLength / 4) * 4;
  const addIndices = (count: number, start: number) => {
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset + start * 4, byteLength: count * 4, target: 34963 });
    const accessor = json.accessors.length;
    json.accessors.push({ bufferView, componentType: 5125, type: 'SCALAR', count });
    return accessor;
  };
  const black = json.materials.length;
  json.materials.push({ ...json.materials[material], name: 'Audi front and rear rings — black', pbrMetallicRoughness: { ...json.materials[material].pbrMetallicRoughness, baseColorFactor: [.004, .004, .004, 1], metallicFactor: .25, roughnessFactor: .3 } });
  mesh.primitives = [{ ...primitive, indices: addIndices(trim.length, 0) }, { ...primitive, indices: addIndices(rings.length, trim.length), material: black }];
  json.buffers[0].byteLength = offset + extra.byteLength;
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const out = new ArrayBuffer(28 + paddedLength + offset + extra.byteLength);
  const bytes = new Uint8Array(out), header = new DataView(out);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, out.byteLength, true);
  header.setUint32(12, paddedLength, true); header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + paddedLength); bytes.set(encoded, 20);
  header.setUint32(20 + paddedLength, offset + extra.byteLength, true); header.setUint32(24 + paddedLength, 0x004e4942, true);
  bytes.set(new Uint8Array(buffer, binStart, binLength), 28 + paddedLength);
  bytes.set(new Uint8Array(extra.buffer), 28 + paddedLength + offset);
  return out;
}
