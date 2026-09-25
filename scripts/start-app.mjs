import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, watchFile, unwatchFile } from 'node:fs';
import { loadEnv } from 'vite';

const root = process.cwd();
mkdirSync('.local', { recursive: true, mode: 0o700 });
let stopping = false;
let server;
let tunnel;
let serverTimer;
let tunnelTimer;
let serverFailures = 0;
let tunnelFailures = 0;
let runtime = { tunnel: 'starting', webhookUrl: null, temporaryUrl: true };
const saveStatus = () => writeFileSync('.local/runtime.json', JSON.stringify(runtime), { mode: 0o600 });
function startServer() {
  const env = loadEnv('development', root, '');
  server = spawn(process.execPath, ['packages/aitrack-server/dist/cli.js'], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { process.stdout.write(chunk); serverFailures = 0; });
  server.stderr.on('data', () => {}); // Never echo environment or request payloads.
  server.on('exit', () => { if (!stopping) serverTimer = setTimeout(startServer, Math.min(30000, 1000 * 2 ** Math.min(serverFailures++, 5))); });
}
function startTunnel() {
  if (process.argv.includes('--no-tunnel')) { runtime.tunnel = 'disabled'; saveStatus(); return; }
  const env = loadEnv('development', root, '');
  const port = env.WEBHOOK_PORT || '8788';
  // Quick tunnel publishes only POST /webhooks/aitrack, never the app or its API.
  tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const receive = chunk => {
    output = (output + chunk.toString()).slice(-8192);
    const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (url && runtime.webhookUrl !== `${url[0]}/webhooks/aitrack`) {
      runtime = { tunnel: 'ready', webhookUrl: `${url[0]}/webhooks/aitrack`, temporaryUrl: true }; saveStatus();
      console.log(`Endpoint webhook: ${runtime.webhookUrl}`);
      console.log('Registra questo URL nel pannello Aitrack. Il tunnel temporaneo cambia indirizzo se viene ricreato.');
      tunnelFailures = 0;
    }
  };
  tunnel.stdout.on('data', receive); tunnel.stderr.on('data', receive);
  tunnel.on('error', () => { runtime.tunnel = 'unavailable'; runtime.webhookUrl = null; saveStatus(); console.log('Tunnel non disponibile: la sincronizzazione adattiva locale resta attiva.'); });
  tunnel.on('close', () => {
    runtime.tunnel = 'reconnecting'; runtime.webhookUrl = null; saveStatus();
    if (!stopping) tunnelTimer = setTimeout(startTunnel, Math.min(60000, 5000 * 2 ** Math.min(tunnelFailures++, 4)));
  });
}
saveStatus(); startServer(); startTunnel();
watchFile('.env', { interval: 2000 }, () => { if (!stopping) server?.kill('SIGTERM'); });
const stop = () => {
  stopping = true; clearTimeout(serverTimer); clearTimeout(tunnelTimer); unwatchFile('.env');
  server?.kill('SIGTERM'); tunnel?.kill('SIGTERM');
  runtime.tunnel = 'stopped'; runtime.webhookUrl = null; saveStatus();
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
