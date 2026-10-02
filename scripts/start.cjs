const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.env.PORT ||= '7860';
process.env.HOSTNAME = '0.0.0.0';
process.env.NODE_ENV = 'production';
const standalone = path.join(root, '.next/standalone');
if (fs.existsSync(path.join(standalone, 'server.js'))) {
  // Next standalone does not copy these assets automatically for a Node-service launch.
  for (const [from, to] of [['public', 'public'], ['.next/static', '.next/static']]) {
    const source = path.join(root, from);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(standalone, to), { recursive: true, force: true });
  }
  require(path.join(standalone, 'server.js'));
} else {
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '0.0.0.0', '-p', process.env.PORT], { cwd: root, env: process.env, stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code || 0));
}
