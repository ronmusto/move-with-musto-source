import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Override Next's public integration configuration in the child process. This
// takes precedence over .env files without modifying any developer settings.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
for (const name of [
    'NEXT_PUBLIC_MLS_DATA_ORIGIN', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
    'NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'NEXT_PUBLIC_INQUIRY_FORM_ACTION',
    'NEXT_PUBLIC_COMING_SOON_SIGNUP_ACTION', 'NEXT_PUBLIC_REAL_ESTATE_UNSUBSCRIBE_ACTION',
    'NEXT_PUBLIC_COMING_SOON_UNSUBSCRIBE_ACTION',
]) env[name] = '';

const args = process.argv.slice(2);
env.E2E_EXTENDED = args.includes('--extended') ? '1' : '0';
env.REQUIRE_GOOGLE_MAPS = '0';
env.E2E_LIVE_MAPS = '0';
env.NEXT_PUBLIC_COMMERCIAL_PUBLIC = 'false';

function run(script, scriptArgs) {
    const result = spawnSync(process.execPath, [resolve(script), ...scriptArgs], {
        env, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

run('scripts/check-amplify-hosting-config.mjs', []);
run('node_modules/next/dist/bin/next', ['build']);
run('node_modules/@playwright/test/cli.js', ['test', ...args.filter((arg) => arg !== '--extended')]);
