'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseIngredient: p, AISLES, KEYS } = require('../src/ingredients');

// [line, name, quantity, key, aisle]
const cases = [
  // Radio-Canada Mordu: "Name - quantity"
  ['Pâtes, au choix - 350 g (¾ lb)', 'Pâtes', '350 g (¾ lb)', 'pasta', 'grains'],
  ['Petits pois, frais ou surgelés - 270 g (2 tasses)', 'Petits pois', '270 g (2 tasses)', 'pea', 'produce'],
  ['Beurre non salé - 40 g (3 c. à soupe), divisé', 'Beurre non salé', '40 g (3 c. à soupe), divisé', 'butter', 'dairy'],
  ['Poulet (haut de cuisse, poitrine, etc.), coupé en lanières - 375 g (¾ lb)', 'Poulet', '375 g (¾ lb)', 'chicken', 'meat'],
  ['Blanc de poireau, finement haché - 1', 'Blanc de poireau', '1', 'leek', 'produce'],
  ['Gousses d’ail, dégermées et finement hachées - 4', 'Gousses d’ail', '4', 'garlic', 'produce'],
  ['Vin blanc, bouillon ou eau - 60 ml (¼ tasse)', 'Vin blanc', '60 ml (¼ tasse)', 'white wine', 'drinks'],
  ['Moutarde forte de Dijon - 10 ml (2 c. à thé)', 'Moutarde forte de Dijon', '10 ml (2 c. à thé)', 'mustard', 'condiments'],
  ['Sel et poivre du moulin - Au goût', 'Sel et poivre du moulin', 'Au goût', 'salt', 'spices'],
  // Leading quantity, French and English
  ['25 g (3 c. à soupe) de farine tout usage non blanchie', 'Farine tout usage non blanchie', '25 g (3 c. à soupe)', 'flour', 'baking'],
  ['1/4 c. à thé de poudre à pâte', 'Poudre à pâte', '1/4 c. à thé', 'baking powder', 'baking'],
  ['3 gousses d’ail', 'Ail', '3 gousses', 'garlic', 'produce'],
  ['1 ½ lb (675 g) poulet', 'Poulet', '1 ½ lb (675 g)', 'chicken', 'meat'],
  ['2 cans (400 ml) coconut milk', 'Coconut milk', '2 cans (400 ml)', 'coconut milk', 'canned'],
  ['2 tbsp olive oil', 'Olive oil', '2 tbsp', 'olive oil', 'condiments'],
  ['1 can chickpeas, drained and rinsed', 'Chickpeas', '1 can', 'chickpea', 'canned'],
  // Bare names: the same item in both languages resolves to one key
  ['broccoli', 'Broccoli', '', 'broccoli', 'produce'],
  ['brocoli', 'Brocoli', '', 'broccoli', 'produce'],
  ['Pommes de terre', 'Pommes de terre', '', 'potato', 'produce'],
  ['potatoes', 'Potatoes', '', 'potato', 'produce'],
  ['tomatoes', 'Tomatoes', '', 'tomato', 'produce'],
  ['2 cherries', 'Cherries', '2', 'cherry', 'produce'],
  ['peaches', 'Peaches', '', 'peach', 'produce'],
  ['Pâte à pizza', 'Pâte à pizza', '', 'pizza dough', 'bakery'],
  ['Lait 2%', 'Lait 2%', '', 'milk', 'dairy'],
  ['xylophone wax', 'Xylophone wax', '', 'xylophone wax', 'other'],
];

for (const [line, name, quantity, key, aisle] of cases) {
  test(`recognize: ${line}`, () => {
    const r = p(line);
    assert.deepEqual([r.name, r.quantity, r.key, r.aisle], [name, quantity, key, aisle]);
  });
}

test('water is flagged as a staple to skip, but only when nothing overrides it', () => {
  assert.equal(p('1 tasse d’eau').skip, true);
  assert.equal(p('2 cups water').skip, true);
  assert.equal(p('eau pétillante').skip, false);
});

test('a learned correction beats the dictionary', () => {
  assert.equal(p('Poulet', { chicken: 'frozen' }).aisle, 'frozen');
});

test('every dictionary aisle is a real aisle', () => {
  for (const a of KEYS.values()) assert.ok(AISLES.includes(a) || a === 'skip', a);
});
