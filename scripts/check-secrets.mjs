import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Never print matching contents: file names and rule names are sufficient.
const git = args => execFileSync('git', args, { maxBuffer: 200 * 1024 * 1024 });
const staged = process.argv.includes('--staged');
const paths = git(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
const knownSecrets = [];
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
    if (!match || !/key|token|secret|password|imei/i.test(match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12) knownSecrets.push(Buffer.from(value));
  }
}
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['Mapbox token', /\b[ps]k\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{15,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['credential assignment', /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*['"]?\s*[:=]\s*['"](?:sk_live_|sk-proj-|aitrack_|ait_)[A-Za-z0-9_-]{16,}/i],
];
const failures = [];
for (const path of paths) {
  const basename = path.split('/').at(-1);
  if ((basename.startsWith('.env') && !basename.endsWith('.example')) || /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(path) || /(?:^|\/)(?:\.npmrc|credentials[^/]*\.json|service-account[^/]*\.json)$/.test(path)) {
    failures.push(`${path}: sensitive file`); continue;
  }
  const bytes = staged ? git(['show', `:${path}`]) : readFileSync(path);
  if (knownSecrets.some(secret => bytes.includes(secret))) failures.push(`${path}: matches a local environment credential`);
  if (!bytes.includes(0)) {
    const text = bytes.toString('utf8');
    for (const [name, pattern] of rules) if (pattern.test(text)) failures.push(`${path}: ${name}`);
  }
}
if (failures.length) {
  console.error('Secret check failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Secret check passed: ${paths.length} ${staged ? 'staged' : 'workspace'} files; no local credentials or recognized secrets found.`);
