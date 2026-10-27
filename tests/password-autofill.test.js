import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const html=readFileSync('index.html','utf8'),family=readFileSync('family.js','utf8'),cloud=readFileSync('cloud.js','utf8');
test('sign in uses form with credential autocomplete',()=>{assert.match(html,/<form id="cloudLogin"/);assert.match(family,/email\.autocomplete='username'/);assert.match(html,/autocomplete="current-password"/);assert.match(cloud,/cloudLogin'\)\.onsubmit/);});
test('registration uses new password autocomplete',()=>{assert.match(family,/familyRegistrationForm/);assert.match(family,/autocomplete="new-password"/);assert.match(family,/familyRegistrationForm'\)\.onsubmit/);});
test('password change uses a real form',()=>{assert.match(family,/familyPasswordForm/);assert.match(family,/familyPasswordForm'\)\.onsubmit/);});
