import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root=new URL('../',import.meta.url);
test('source package excludes private operator scripts while retaining infrastructure algorithms',()=>{
    for(const file of ['deploy.ps1','deploy-portal.ps1','bootstrap-deployment-access.ps1','create-operator.ps1','seed-coordinate-cache.ps1'])assert.equal(existsSync(fileURLToPath(new URL(file,root))),false,file);
    for(const file of ['template.yaml','handlers/runs.mjs','handlers/contact.mjs','persist-coordinate-cache.mjs'])assert.equal(existsSync(fileURLToPath(new URL(file,root))),true,file);
});
test('portal has no active cloud integration by default',async()=>{
    const config=await readFile(new URL('portal/config.js',root),'utf8');
    assert.match(config,/apiBaseUrl: ''/);
    assert.match(config,/cognitoDomain: ''/);
    assert.match(config,/clientId: ''/);
});
