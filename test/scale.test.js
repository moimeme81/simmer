'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scaleLine, parseYield } = require('../public/scale');

const cases = [
  // [line, factor, lang, expected]
  ['1 tasse (250 ml) de lait', 2, 'fr', '2 tasses (500 ml) de lait'],
  ['250 ml (1 cup) milk', 1.5, 'en', '375 ml (1 ½ cups) milk'],
  ['250 ml / 1 cup milk', 2, 'en', '500 ml / 2 cups milk'],
  ['1 tasse ou 250 ml de crème', 3, 'fr', '3 tasses ou 750 ml de crème'],
  ['1 cup, 250 ml water', 0.5, 'en', '½ cup, 125 ml water'],
  ['2 c. à soupe (30 ml) d\'huile d\'olive', 1.5, 'fr', '3 c. à soupe (45 ml) d\'huile d\'olive'],
  ['1 c. à thé (5 ml) de sel', 3, 'fr', '1 c. à soupe (15 ml) de sel'],
  ['2 cuillères à soupe (30 ml) de beurre', 0.5, 'fr', '1 cuillère à soupe (15 ml) de beurre'],
  ['1 tbsp (15 ml) butter', 4, 'en', '4 tbsp (60 ml) butter'],
  ['1 ½ lb (675 g) poulet', 2, 'fr', '3 lb (1,35 kg) poulet'],
  ['1 1/2 lb (675 g) chicken', 2, 'en', '3 lb (1.35 kg) chicken'],
  ['8 oz (225 g) pâtes', 2, 'fr', '1 lb (450 g) pâtes'],
  ['½ tasse (125 ml) de parmesan', 3, 'fr', '1 ½ tasse (375 ml) de parmesan'],
  ['½ cup (125 ml) parmesan', 3, 'en', '1 ½ cups (375 ml) parmesan'],
  ['1,5 l de bouillon', 2, 'fr', '3 l de bouillon'],
  ['2 à 3 gousses d\'ail', 2, 'fr', '4 à 6 gousses d\'ail'],
  ['2-3 cloves garlic', 2, 'en', '4-6 cloves garlic'],
  ['1 can (400 ml) coconut milk', 2, 'en', '2 cans (400 ml) coconut milk'],
  ['2 boîtes de conserve (540 ml chacune) de tomates', 2, 'fr', '4 boîtes de conserve (540 ml chacune) de tomates'],
  ['1 (14 oz) can tomatoes', 2, 'en', '2 (14 oz) can tomatoes'],
  ['3 poitrines de poulet (environ 450 g)', 2, 'fr', '6 poitrines de poulet (environ 900 g)'],
  ['1 oignon (150 g), haché', 2, 'fr', '2 oignons (300 g), haché'.replace('oignons', 'oignon')],
  ['1 tasse de lait 2 %', 2, 'fr', '2 tasses de lait 2 %'],
  ['2% milk, 1 cup', 2, 'en', '2% milk, 2 cups'],
  ['Sel et poivre', 2, 'fr', 'Sel et poivre'],
  ['Une pincée de sel', 2, 'fr', 'Une pincée de sel'],
  ['1 gros oignon', 2, 'fr', '2 gros oignon'],
  ['2 cups (500 ml) flour', 1, 'en', '2 cups (500 ml) flour'],
  ['1 tasse (250 ml) lait', 0.5, 'fr', '½ tasse (125 ml) lait'],
  ['3 tasses (750 ml)', 1.5, 'fr', '4 ½ tasses (1,13 L)'],
];

for (const [line, factor, lang, expected] of cases) {
  test(`${lang} x${factor}: ${line}`, () => assert.equal(scaleLine(line, factor, { lang }), expected));
}

test('yield parsing', () => {
  assert.equal(parseYield('4 portions'), 4);
  assert.equal(parseYield('Makes 24 cookies'), 24);
  assert.equal(parseYield('4-6 servings'), 4);
  assert.equal(parseYield('6'), 6);
  assert.equal(parseYield('Donne 1 ½ douzaine'), 1.5);
  assert.equal(parseYield('plusieurs'), null);
});
test('yield scaling', () => assert.equal(scaleLine('4 portions', 2, { lang: 'fr' }), '8 portions'));
