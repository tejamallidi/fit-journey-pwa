import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const ui=readFileSync('family.js','utf8'),api=readFileSync('worker/index.js','utf8');
test('invites are restricted to members and rotated on share',()=>{assert.match(api,/path==='\/api\/groups\/invite'/);assert.match(api,/Not a group member/);assert.match(api,/UPDATE family_groups SET invite_code_hash/);assert.match(ui,/Previously? invitation codes will no longer work/);});
test('individual and leaderboard streaks are exposed',()=>{assert.match(ui,/familyStreak/);assert.match(api,/streak:streakFor\(days\)/);assert.match(ui,/entry\.streak/);});
test('invitation URL is removed from history',()=>{assert.match(ui,/history\.replaceState/);assert.match(ui,/navigator\.share/);});
test('preferences are scoped to profile',()=>{assert.match(ui,/fitjourney\.prefs\./);assert.match(ui,/currentProfile/);});
