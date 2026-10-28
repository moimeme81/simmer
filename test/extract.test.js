'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cheerio = require('cheerio');
const { fromJsonLd, parseDuration, isPrivateIp } = require('../src/extract');

const html = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Recipe"],"name":"Test &amp; Soup",
"image":["/img.jpg"],"author":{"name":"Ann"},"recipeYield":["4","4 servings"],"prepTime":"PT15M","cookTime":"PT1H30M",
"recipeIngredient":["1 onion","2 cups water"],
"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Chop."}]},{"@type":"HowToStep","text":"Boil."}]}]}
</script></head><body></body></html>`;

test('parses schema.org recipe from @graph', () => {
  const r = fromJsonLd(cheerio.load(html), 'https://example.com/x');
  assert.equal(r.title, 'Test & Soup');
  assert.deepEqual(r.steps, ['Chop.', 'Boil.']);
  assert.equal(r.ingredients.length, 2);
  assert.equal(r.cookMinutes, 90);
  assert.equal(r.image, 'https://example.com/img.jpg');
});
test('durations', () => { assert.equal(parseDuration('PT45M'), 45); assert.equal(parseDuration('nope'), null); });
test('private ip detection', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '169.254.1.1', '::1']) assert.ok(isPrivateIp(ip), ip);
  assert.ok(!isPrivateIp('8.8.8.8'));
});

test('list store: add, check, clear, idempotent import', () => {
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const { ListStore } = require('../src/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simmer-'));
  const ls = new ListStore(dir);
  const id = ls.all()[0].id;
  ls.addItems(id, [{ name: 'milk' }, { name: ' ' }, { name: 'eggs' }]);
  assert.equal(ls.all()[0].items.length, 2);
  ls.updateItem(id, ls.all()[0].items[0].id, { checked: true });
  assert.equal(ls.clearChecked(id).items.length, 1);
  ls.importList({ externalId: 'x', name: 'A', items: [{ name: 'a' }] });
  ls.importList({ externalId: 'x', name: 'A', items: [{ name: 'a' }, { name: 'b' }] });
  assert.equal(ls.all().filter((l) => l.externalId === 'x').length, 1);
  assert.equal(ls.all().find((l) => l.externalId === 'x').items.length, 2);
});
