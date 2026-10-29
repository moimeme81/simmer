'use strict';
/**
 * Ingredient recognition. Turns "Gousses d'ail, dégermées - 4" or "1 ½ lb (675 g) poulet" into
 * { name, quantity, key, aisle }. The dictionary is bilingual: "broccoli", "brocoli", "garlic"
 * and "ail" all resolve to one canonical key, so the same item merges across languages.
 */

const AISLES = ['produce', 'meat', 'seafood', 'deli', 'dairy', 'bakery', 'frozen', 'canned', 'grains', 'baking', 'spices', 'condiments', 'breakfast', 'snacks', 'drinks', 'household', 'personal', 'pets', 'other'];

// aisle: group; group; ...   (a group is "english key|alias|alias", singular forms)
const DATA = `
produce: broccoli|brocoli; cauliflower|chou-fleur; carrot|carotte; celery|céleri|celeri; onion|oignon; green onion|scallion|oignon vert|échalote verte; shallot|échalote|echalote; garlic|ail; leek|poireau; potato|pomme de terre|patate; sweet potato|patate douce; tomato|tomate; cherry tomato|tomate cerise; cucumber|concombre; zucchini|courgette; eggplant|aubergine; bell pepper|poivron; jalapeno|jalapeño; chili pepper|piment; lettuce|laitue; romaine|romaine; spinach|épinard; kale|chou frisé|chou kale; arugula|roquette; cabbage|chou; red cabbage|chou rouge; brussels sprout|chou de bruxelles; asparagus|asperge; green bean|haricot vert; pea|petit pois|pois; corn|maïs|épi de maïs; mushroom|champignon; beet|betterave; radish|radis; turnip|navet; parsnip|panais; squash|courge; butternut squash|courge musquée|courge butternut; pumpkin|citrouille; fennel|fenouil; ginger|gingembre; avocado|avocat; lemon|citron; lime; orange; grapefruit|pamplemousse; apple|pomme; pear|poire; banana|banane; strawberry|fraise; blueberry|bleuet|myrtille; raspberry|framboise; blackberry|mûre; cranberry|canneberge; grape|raisin; cherry|cerise; peach|pêche; plum|prune; nectarine; apricot|abricot; mango|mangue; pineapple|ananas; watermelon|pastèque|melon d'eau; cantaloupe|melon; kiwi; pomegranate|grenade; fig|figue; cilantro|coriandre; parsley|persil; basil|basilic; mint|menthe; dill|aneth; chives|ciboulette; thyme|thym; rosemary|romarin; sage|sauge; tarragon|estragon; bean sprout|germe de soja; bok choy|pak choï|pak choi; microgreens|jeunes pousses; salad|salade; tofu
meat: chicken|poulet; chicken breast|poitrine de poulet|blanc de poulet; chicken thigh|haut de cuisse|cuisse de poulet; ground chicken|poulet haché; ground beef|boeuf haché|bœuf haché; beef|boeuf|bœuf; steak|bifteck|filet mignon; roast|rôti; pork|porc; pork chop|côtelette de porc; ground pork|porc haché; bacon|lard; sausage|saucisse; turkey|dinde; ground turkey|dinde hachée; lamb|agneau; veal|veau; duck|canard; rib|côte levée; meatball|boulette
seafood: salmon|saumon; shrimp|crevette; tuna|thon; cod|morue; haddock|aiglefin; tilapia; trout|truite; scallop|pétoncle; crab|crabe; lobster|homard; mussel|moule; fish|poisson; halibut|flétan
deli: ham|jambon; salami; prosciutto; deli turkey|dinde froide; hot dog|saucisse à hot-dog|hot-dog; smoked salmon|saumon fumé; deli meat|charcuterie
dairy: milk|lait; cream|crème|creme; heavy cream|crème 35|crème à fouetter|whipping cream; sour cream|crème sure|crème sûre; butter|beurre; cheese|fromage; parmesan|parmigiano; cheddar; mozzarella; feta; goat cheese|fromage de chèvre; cream cheese|fromage à la crème; cottage cheese|fromage cottage; ricotta; swiss cheese|gruyère|emmental; yogurt|yogourt|yaourt; egg|oeuf|œuf; margarine; buttermilk|babeurre; half and half|crème 15|crème 10; almond milk|lait d'amande; oat milk|lait d'avoine; soy milk|lait de soya; whipped cream|crème fouettée
bakery: bread|pain; baguette; bun|petit pain; hamburger bun|pain à hamburger; hot dog bun|pain à hot-dog; tortilla; wrap; pita; bagel; croissant; naan; english muffin|muffin anglais; cake|gâteau; pie crust|pâte à tarte; pizza dough|pâte à pizza; muffin
frozen: ice cream|crème glacée; frozen pizza|pizza surgelée; frozen vegetables|légumes surgelés; frozen fruit|fruits surgelés; fish stick|bâtonnet de poisson; frozen fries|frites surgelées; popsicle|sucette glacée; frozen waffles|gaufres surgelées
canned: canned tomatoes|tomates en dés|tomates en conserve|tomates concassées; tomato sauce|sauce tomate; tomato paste|pâte de tomate; chickpea|pois chiche; black bean|haricot noir; kidney bean|haricot rouge; white bean|haricot blanc; coconut milk|lait de coco; canned tuna|thon en conserve; broth|bouillon; chicken broth|bouillon de poulet; beef broth|bouillon de boeuf|bouillon de bœuf; vegetable broth|bouillon de légumes; stock|fond; soup|soupe; olive; pickle|cornichon; artichoke|artichaut; sardine; canned corn|maïs en grains; roasted red pepper|poivron rôti; baked beans|fèves au lard
grains: pasta|pâtes|pâte alimentaire; spaghetti; penne; fusilli; macaroni|macaroni; lasagna|lasagne; noodle|nouille; rice|riz; basmati rice|riz basmati; brown rice|riz brun; quinoa; couscous; oat|avoine|flocon d'avoine; barley|orge; lentil|lentille; breadcrumb|chapelure; bulgur; polenta; rice noodle|nouille de riz; orzo
baking: flour|farine; sugar|sucre; brown sugar|cassonade|sucre brun; icing sugar|sucre en poudre|sucre glace|powdered sugar; baking powder|poudre à pâte|poudre à pâte; baking soda|bicarbonate de soude|bicarbonate; yeast|levure; vanilla|vanille; cocoa|cacao; chocolate chip|pépite de chocolat; chocolate|chocolat; cornstarch|fécule de maïs; molasses|mélasse; shortening|shortening; raisin sec|raisins secs; walnut|noix de grenoble; almond|amande; pecan|pacane; cashew|noix de cajou; peanut|arachide|cacahuète; peanut butter|beurre d'arachide|beurre de peanut; sesame seed|graine de sésame; chia seed|graine de chia; flax|lin|graine de lin; pine nut|pignon; sunflower seed|graine de tournesol; nut|noix; date|datte; shredded coconut|noix de coco râpée|noix de coco; cream of tartar|crème de tartre; marshmallow|guimauve
spices: salt|sel; pepper|poivre; black pepper|poivre noir; paprika; cumin; cinnamon|cannelle; nutmeg|muscade; chili powder|poudre de chili; cayenne; turmeric|curcuma; oregano|origan; italian seasoning|assaisonnement italien; garlic powder|poudre d'ail; onion powder|poudre d'oignon; curry|cari; bay leaf|feuille de laurier|laurier; clove|clou de girofle; cardamom|cardamome; allspice|quatre-épices|toute-épice; garam masala; herbes de provence; chili flakes|flocons de piment; smoked paprika|paprika fumé; seasoning|assaisonnement; spice|épice; saffron|safran; vanilla extract|extrait de vanille
condiments: olive oil|huile d'olive; vegetable oil|huile végétale; canola oil|huile de canola; oil|huile; sesame oil|huile de sésame; vinegar|vinaigre; balsamic vinegar|vinaigre balsamique; soy sauce|sauce soya|sauce soja; mustard|moutarde; dijon|moutarde de dijon; ketchup; mayonnaise|mayo; hot sauce|sauce piquante; worcestershire|sauce worcestershire; bbq sauce|sauce barbecue; salsa; pesto; hummus|houmous; jam|confiture; maple syrup|sirop d'érable; honey|miel; relish; fish sauce|sauce de poisson; hoisin; sriracha; tahini|tahini; sauce; dressing|vinaigrette; caper|câpre; teriyaki; peanut sauce|sauce aux arachides
breakfast: cereal|céréale; granola; pancake mix|mélange à crêpes; coffee|café; tea|thé; syrup|sirop; oatmeal|gruau
snacks: chip|croustille; cracker|craquelin; popcorn|maïs soufflé; cookie|biscuit; granola bar|barre tendre; pretzel|bretzel; candy|bonbon; chocolate bar|tablette de chocolat
drinks: juice|jus; orange juice|jus d'orange; beer|bière; soda|boisson gazeuse; sparkling water|eau pétillante; wine|vin; white wine|vin blanc; red wine|vin rouge; cider|cidre; lemonade|limonade
household: paper towel|essuie-tout; toilet paper|papier hygiénique|papier de toilette; dish soap|savon à vaisselle; laundry detergent|savon à lessive|détergent à lessive; garbage bag|sac à ordures|sac à poubelle; aluminum foil|papier d'aluminium|papier aluminium; plastic wrap|pellicule plastique; parchment paper|papier parchemin|papier ciré; napkin|serviette de table; sponge|éponge; battery|pile; light bulb|ampoule; cleaner|nettoyant; tissue|mouchoir; freezer bag|sac de congélation; candle|chandelle
personal: shampoo|shampoing; conditioner|revitalisant; toothpaste|dentifrice; toothbrush|brosse à dents; soap|savon; deodorant|déodorant; razor|rasoir; diaper|couche; sunscreen|crème solaire
pets: dog food|nourriture pour chien; cat food|nourriture pour chat; cat litter|litière
skip: water|eau; ice|glace|glaçon; ice cube|cube de glace; tap water|eau du robinet
`;

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const singular = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const norm = (s) => fold(s).split(' ').map(singular).join(' ');

const INDEX = new Map(); // normalized alias -> { key, aisle }
const KEYS = new Map();  // canonical key -> aisle
for (const line of DATA.trim().split('\n')) {
  const i = line.indexOf(':');
  const aisle = line.slice(0, i).trim();
  for (const group of line.slice(i + 1).split(';')) {
    const names = group.split('|').map((x) => x.trim()).filter(Boolean);
    if (!names.length) continue;
    const key = norm(names[0]);
    KEYS.set(key, aisle);
    for (const n of names) {
      // Index English plural forms too (potatoes, cherries, peaches) because the matcher only strips a trailing "s".
      const f = fold(n);
      const forms = [f, `${f}s`, `${f}es`, f.endsWith('y') ? `${f.slice(0, -1)}ies` : null];
      for (const v of forms) if (v && !INDEX.has(norm(v))) INDEX.set(norm(v), { key, aisle });
    }
  }
}

/** Longest dictionary phrase found anywhere in a name: "Parmesan fraîchement râpé" -> parmesan. */
function recognize(name) {
  const words = fold(name).split(' ').filter(Boolean).map(singular);
  for (let n = Math.min(5, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const hit = INDEX.get(words.slice(i, i + n).join(' '));
      if (hit) return hit;
    }
  }
  return null;
}

/* ---------- parsing a line ---------- */
const FRAC = '¼½¾⅓⅔⅛⅜⅝⅞';
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?\\s*[${FRAC}]?|[${FRAC}])`;
const QTY_RE = new RegExp(`^${NUM}(?:\\s*(?:-|–|à|to)\\s*${NUM})?`, 'i');
const UNITS = new Set(`g kg mg ml l dl cl lb lbs oz tasse cup tbsp tsp cs cc cas cac cuillere pincee pinch gousse clove boite can conserve paquet package sac bag bunch botte tranche slice morceau piece feuille leaf branche sprig tete head pot jar bouteille bottle stick baton filet brin litre livre once ounce gallon quart pint pt qt portion c`.split(' '));
const UNIT_RE = /^(c\.?\s*à\s*(?:soupe|thé|café|s|c)(?![A-Za-zÀ-ÿ])\.?|cuillères?\s+à\s+(?:soupe|thé|café)|[A-Za-zÀ-ÿ]+\.?)/i;
const LOOSE = /^(au go[uû]t|to taste|quelques?(?:-\w+)?|un peu|a few|some|a pinch|une? pinc[ée]e|pour servir|for serving|selon (?:le )?go[uû]t)$/i;

function takeUnit(rest) {
  const m = rest.match(UNIT_RE);
  if (!m) return 0;
  const raw = m[1];
  const f = fold(raw).replace(/\s+/g, ' ');
  const first = f.split(' ')[0];
  const ok = /^c a (soupe|the|cafe|s|c)$/.test(f) || /^cuilleres? a/.test(f) || UNITS.has(first) || UNITS.has(singular(first)) || UNITS.has(first.replace(/es$/, ''));
  return ok ? raw.length : 0;
}

/** Split "350 g (¾ lb) de pâtes" into { quantity: "350 g (¾ lb)", name: "pâtes" }. */
function splitLine(line) {
  const s = String(line || '').replace(/^[\s•*·\-–]+/, '').replace(/\s+/g, ' ').trim();
  // "Name - quantity" (Radio-Canada Mordu and similar sites)
  const dash = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && (QTY_RE.test(dash[2]) || LOOSE.test(dash[2].trim()))) return { name: dash[1], quantity: dash[2].trim() };

  const q = s.match(QTY_RE);
  if (!q) return { name: s, quantity: '' };
  let i = q[0].length;
  const grabParens = () => { const m = s.slice(i).match(/^\s*\([^)]*\)/); if (m) i += m[0].length; return !!m; };
  grabParens();
  const rest = s.slice(i).replace(/^\s+/, '');
  const u = takeUnit(rest);
  if (u) { i = s.length - rest.length + u; while (grabParens()); }
  const name = s.slice(i).replace(/^\s*(?:de la |de l[’']|de |d[’']|du |des |of )/i, '').trim();
  return { name, quantity: s.slice(0, i).trim() };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * learned: optional { key: aisle } overrides the dictionary (things the family has corrected).
 * Returns { name, quantity, key, aisle, skip }.
 */
function parseIngredient(line, learned = {}) {
  const { name: rawName, quantity } = splitLine(line);
  const display = rawName.replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim() || rawName.trim();
  const hit = recognize(display) || recognize(rawName);
  const key = hit ? hit.key : norm(display);
  const aisle = learned[key] || (hit ? hit.aisle : 'other');
  return { name: cap(display), quantity, key, aisle: aisle === 'skip' ? 'other' : aisle, skip: aisle === 'skip' && !learned[key] };
}

module.exports = { AISLES, parseIngredient, recognize, splitLine, norm, KEYS };
