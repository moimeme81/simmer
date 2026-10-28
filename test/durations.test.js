'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findDurations, clock } = require('../public/durations');

const secs = (t) => findDurations(t).map((d) => d.seconds);

test('single times in French and English', () => {
  assert.deepEqual(secs('Faire cuire 6 minutes à feu moyen.'), [360]);
  assert.deepEqual(secs('Cook for 6 min until golden.'), [360]);
  assert.deepEqual(secs('Rest for 30 seconds.'), [30]);
  assert.deepEqual(secs('Laisser reposer 45 secondes'), [45]);
});
test('ranges use the lower bound and are flagged', () => {
  const [d] = findDurations('Bake 20 to 25 minutes.');
  assert.equal(d.seconds, 1200); assert.equal(d.ranged, true);
  assert.deepEqual(secs('Cuire 15 à 20 minutes'), [900]);
  assert.deepEqual(secs('Mijoter 15-20 min'), [900]);
});
test('hours and combinations', () => {
  assert.deepEqual(secs('Laisser lever 1 h 30'), [5400]);
  assert.deepEqual(secs('Mijoter 1 heure et 30 minutes'), [5400]);
  assert.deepEqual(secs('Roast 2 hours'), [7200]);
  assert.deepEqual(secs('Réfrigérer 1½ heure'), [5400]);
  assert.deepEqual(secs('Cook 1.5 hours'), [5400]);
});
test('spoken amounts', () => {
  assert.deepEqual(secs('Laisser mijoter une demi-heure'), [1800]);
  assert.deepEqual(secs('Chill for an hour'), [3600]);
  assert.deepEqual(secs('Cuire un quart d’heure'), [900]);
});
test('ignores things that are not times', () => {
  assert.deepEqual(secs('Ajouter 2 c. à soupe de sucre et 250 ml de lait'), []);
  assert.deepEqual(secs('Préchauffer le four à 350 °F'), []);
  assert.deepEqual(secs('Serves 4 minutes'.replace('Serves 4 minutes', 'Serve with 4 slices')), []);
});
test('several times in one step, in order', () => {
  assert.deepEqual(secs('Saisir 2 minutes de chaque côté, puis cuire 10 à 12 minutes.'), [120, 600]);
});
test('clock formatting', () => {
  assert.equal(clock(45), '0:45'); assert.equal(clock(754), '12:34'); assert.equal(clock(3900), '1:05:00'); assert.equal(clock(0.2), '0:01');
});
