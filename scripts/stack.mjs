import {
  getDockerCommand,
  parseArgs,
  projectRoot,
  run,
  selfHostEnvFile,
} from './lib/runtime.mjs';

const docker = getDockerCommand();
const { values, flags } = parseArgs(process.argv.slice(2));
const action = values[0] || 'up';

const envFile = flags.has('--selfhost') ? selfHostEnvFile : undefined;
const composeArgs = ['compose'];
if (envFile) {
  composeArgs.push('--env-file', envFile);
}
composeArgs.push('-f', 'docker-compose.yml');

if (action === 'up') {
  const services = flags.has('--app') ? ['app', 'postgres', 'redis', 'minio'] : ['postgres', 'redis', 'minio'];
  await run(docker, [...composeArgs, 'up', '-d', ...services], { cwd: projectRoot });
} else if (action === 'down') {
  await run(docker, [...composeArgs, 'down'], { cwd: projectRoot });
} else if (action === 'logs') {
  await run(docker, [...composeArgs, 'logs', '-f', ...(flags.has('--app') ? ['app'] : [])], {
    cwd: projectRoot,
  });
} else {
  throw new Error(`Unsupported stack action: ${action}`);
}
