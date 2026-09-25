import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const git = args => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
const history = process.argv.includes('--history');
const ref = process.argv.find(arg => arg.startsWith('--ref='))?.slice(6);
const privateValues = new Set();
const add = value => { if (typeof value === 'string' && value.length >= 6) privateValues.add(value); };
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
  if (match && /key|token|secret|password|imei/i.test(match[1])) add(match[2].replace(/^(['"])(.*)\1$/, '$2'));
}
if (existsSync('.local/public-audit-values.json')) for (const value of JSON.parse(readFileSync('.local/public-audit-values.json', 'utf8'))) add(value);
if (existsSync('.local/cameras.json')) for (const camera of JSON.parse(readFileSync('.local/cameras.json', 'utf8')).cameras ?? []) {
  add(camera.rtspUrl); add(camera.name);
  add(String(camera.latitude)); add(String(camera.longitude));
  if (camera.rtspUrl) { const url = new URL(camera.rtspUrl); add(url.hostname); add(decodeURIComponent(url.password)); }
}
const failures = new Set();
function scan(label, bytes) {
  for (const value of privateValues) if (bytes.includes(Buffer.from(value))) failures.add(`${label}: known private value`);
  const glb = bytes.toString('ascii', 0, 4) === 'glTF';
  const text = glb ? bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)) : bytes.includes(0) ? '' : bytes.toString('utf8');
  if (/\b[ps]k\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{15,}|\bgh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.add(`${label}: credential pattern`);
  if (/["'](?!0000000000000[0-9]{2})[0-9]{15}["']/.test(text)) failures.add(`${label}: non-fixture device identifier`);
  if (/\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\//.test(text)) failures.add(`${label}: personal filesystem path`);
}
const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
for (const file of files) {
  if (/(^|\/)(\.env(?!.*\.example$)|\.local|\.tmp|screenshots|logs)(\/|$)/.test(file)) failures.add(`${file}: private file path`);
  scan(file, readFileSync(file));
}
let objects = 0;
if (history) {
  for (const line of git(['rev-list', '--objects', ...(ref ? [ref] : ['--branches', '--tags', '--remotes'])]).toString().trim().split('\n').filter(Boolean)) {
    const [oid, ...path] = line.split(' ');
    const type = git(['cat-file', '-t', oid]).toString().trim();
    if (type === 'blob' || type === 'commit' || type === 'tag') {
      const bytes = git(['cat-file', type, oid]); scan(path.join(' ') || `${type} ${oid.slice(0, 8)}`, bytes); objects++;
      if (type === 'commit') for (const match of bytes.toString().matchAll(/^(?:author|committer) .* <([^>]+)>/gm)) {
        if (!match[1].endsWith('@users.noreply.github.com')) failures.add(`commit ${oid.slice(0, 8)}: non-private author email`);
      }
    }
  }
}
if (failures.size) { console.error([...failures].join('\n')); process.exitCode = 1; }
else console.log(`Public audit passed: ${files.length} files${history ? ` and ${objects} reachable historical objects` : ''}; no known private values detected. Manual review is still required.`);
