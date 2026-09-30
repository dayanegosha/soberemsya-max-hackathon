import test from 'node:test';import assert from 'node:assert/strict';
import {CITIES,cityAt,parseCoordinates} from './cities.js';
import {settingsSchema} from '../../../apps/server/src/schemas.js';
import {newDraft} from '../../../apps/bot/src/wizard.js';
test('location never falls back to another city and rejects malformed coordinates',()=>{
 assert.equal(cityAt({lat:59.94,lon:30.32})?.name,'Санкт-Петербург');assert.equal(cityAt({lat:55.79,lon:49.12})?.name,'Казань');
 assert.equal(cityAt({lat:55.75,lon:37.62})?.name,'Москва');assert.equal(cityAt({lat:NaN,lon:0}),undefined);
 assert.deepEqual(parseCoordinates('59.9386, 30.3141'),{lat:59.9386,lon:30.3141});assert.equal(parseCoordinates('91,30'),undefined);
 for(const c of CITIES)for(const p of c.points)assert.equal(cityAt(p)?.id,c.id);
});
test('server accepts geocoded cities and validates participant limit',()=>{
 const s=newDraft().settings;assert.equal(settingsSchema.safeParse({...s,city:'Москва',origin:{lat:55.75,lon:37.62},originName:'Геопозиция организатора'}).success,true);
 assert.equal(settingsSchema.safeParse({...s,city:''}).success,false);
 assert.equal(settingsSchema.safeParse({...s,expectedParticipants:20}).success,true);
 assert.equal(settingsSchema.safeParse({...s,expectedParticipants:51}).success,false);
});
