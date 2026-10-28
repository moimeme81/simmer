/* Simmer UI strings, English and Quebec French. Language is remembered per browser. */
(function () {
  'use strict';
  const D = {
    en: {
      'nav.recipes': 'Recipes', 'nav.lists': 'Lists', 'nav.import': 'Import', 'lang.other': 'Français',
      'home.placeholder': 'Paste a recipe link…', 'home.import': 'Import', 'home.importing': 'Importing…',
      'home.empty': 'No recipes yet. Paste a link above to save your first one.',
      'recipe.back': '← All recipes', 'recipe.from': 'from', 'recipe.prep': 'Prep', 'recipe.cook': 'Cook', 'recipe.total': 'Total', 'recipe.serves': 'Serves',
      'recipe.cookBtn': 'Start cooking', 'recipe.toList': 'Add ingredients to list', 'recipe.added': 'Added {n} to {list} ✓',
      'recipe.delete': 'Delete', 'recipe.confirmDelete': 'Delete this recipe?',
      'recipe.ingredients': 'Ingredients', 'recipe.method': 'Method', 'recipe.notes': 'Notes', 'recipe.notesPh': 'Your notes…',
      'recipe.servings': 'Servings', 'recipe.original': 'original: {n}', 'recipe.reset': 'Reset', 'recipe.scaleBy': 'Scale', 'recipe.pickList': 'Add to which list?',
      'recipe.decrease': 'Fewer servings', 'recipe.increase': 'More servings',
      'time.min': '{n} min', 'time.hm': '{h} h {m} min', 'time.h': '{h} h',
      'lists.new': '+ New list', 'lists.newName': 'List name?', 'lists.addPh': 'Add an item…', 'lists.add': 'Add', 'lists.nothing': 'Nothing to buy.',
      'lists.inCart': 'In the cart ({n})', 'lists.clear': 'Clear', 'lists.remove': 'Remove', 'lists.delete': 'Delete this list',
      'lists.confirmDelete': 'Delete "{name}"?', 'lists.groceries': 'Groceries',
      'import.title': 'Import', 'import.anylist': 'From AnyList',
      'import.blurb': 'Copies your recipes (with photos) and shopping lists into Simmer. Safe to run again: nothing is duplicated. Your login is sent only to this Simmer server, used for this import, and never saved.',
      'import.email': 'AnyList email', 'import.password': 'AnyList password', 'import.start': 'Start import',
      'import.note': 'Uses an unofficial connection to AnyList, which has no public export. Meal plans, recipe collections and list categories are not copied.',
      'import.starting': 'Starting…', 'import.login': 'Signing in to AnyList…', 'import.fetching': 'Reading your account…',
      'import.recipes': 'Importing recipes {n} of {total}', 'import.lists': 'Importing shopping lists…', 'import.done': 'Finished',
      'import.stats': '{done} recipes imported · {photos} photos · {lists} lists', 'import.failed': '{n} failed', 'import.skipped': '{n} empty skipped', 'import.view': 'View recipes',
      'cook.step': 'Step {n} of {m}', 'cook.back': 'Back', 'cook.next': 'Next', 'cook.close': 'Close',
      'foot.auto': 'auto-update on', 'foot.off': 'auto-update off', 'foot.check': 'Check now', 'foot.checking': 'checking…',
      'foot.updated': 'updated, restarting…', 'foot.idle': 'up to date', 'foot.rebuild': 'a newer version needs a rebuild', 'foot.builtin': 'built-in',
      'home.search': 'Search your recipes', 'home.count': '{n} recipes', 'home.noMatch': 'No recipe matches “{q}”.', 'home.emptyTitle': 'Your recipe box is empty',
      'cook.ingredients': 'Ingredients', 'cook.addTimer': 'Add a timer', 'cook.minutes': 'min', 'cook.custom': 'Minutes', 'cook.start': 'Start', 'cook.finish': 'Done cooking', 'cook.presets': 'Quick timers',
      'timer.pause': 'Pause', 'timer.resume': 'Resume', 'timer.plus': '+1 min', 'timer.restart': 'Restart', 'timer.dismiss': 'Remove', 'timer.stop': 'Stop', 'timer.ready': 'Time’s up', 'timer.label': 'Timer', 'timer.stepLabel': 'Step {n}: {time}',
      'import.cRecipes': '{n} recipes', 'import.cPhotos': '{n} photos', 'import.cLists': '{n} lists',
      'foot.version': 'Simmer {v}',
    },
    fr: {
      'nav.recipes': 'Recettes', 'nav.lists': 'Listes', 'nav.import': 'Importer', 'lang.other': 'English',
      'home.placeholder': 'Collez un lien de recette…', 'home.import': 'Importer', 'home.importing': 'Importation…',
      'home.empty': 'Aucune recette pour l’instant. Collez un lien ci-dessus pour sauvegarder la première.',
      'recipe.back': '← Toutes les recettes', 'recipe.from': 'de', 'recipe.prep': 'Préparation', 'recipe.cook': 'Cuisson', 'recipe.total': 'Total', 'recipe.serves': 'Portions',
      'recipe.cookBtn': 'Commencer à cuisiner', 'recipe.toList': 'Ajouter les ingrédients à une liste', 'recipe.added': '{n} ajouté(s) à {list} ✓',
      'recipe.delete': 'Supprimer', 'recipe.confirmDelete': 'Supprimer cette recette ?',
      'recipe.ingredients': 'Ingrédients', 'recipe.method': 'Étapes', 'recipe.notes': 'Notes', 'recipe.notesPh': 'Vos notes…',
      'recipe.servings': 'Portions', 'recipe.original': 'original : {n}', 'recipe.reset': 'Réinitialiser', 'recipe.scaleBy': 'Échelle', 'recipe.pickList': 'Ajouter à quelle liste ?',
      'recipe.decrease': 'Moins de portions', 'recipe.increase': 'Plus de portions',
      'time.min': '{n} min', 'time.hm': '{h} h {m} min', 'time.h': '{h} h',
      'lists.new': '+ Nouvelle liste', 'lists.newName': 'Nom de la liste ?', 'lists.addPh': 'Ajouter un article…', 'lists.add': 'Ajouter', 'lists.nothing': 'Rien à acheter.',
      'lists.inCart': 'Dans le panier ({n})', 'lists.clear': 'Vider', 'lists.remove': 'Retirer', 'lists.delete': 'Supprimer cette liste',
      'lists.confirmDelete': 'Supprimer « {name} » ?', 'lists.groceries': 'Épicerie',
      'import.title': 'Importer', 'import.anylist': 'Depuis AnyList',
      'import.blurb': 'Copie vos recettes (avec photos) et vos listes d’épicerie dans Simmer. Vous pouvez relancer l’importation sans créer de doublons. Vos identifiants sont envoyés uniquement à ce serveur Simmer, servent à cette importation et ne sont jamais sauvegardés.',
      'import.email': 'Courriel AnyList', 'import.password': 'Mot de passe AnyList', 'import.start': 'Lancer l’importation',
      'import.note': 'Utilise une connexion non officielle à AnyList, qui n’offre pas d’exportation. Les menus de la semaine, les collections de recettes et les catégories de listes ne sont pas copiés.',
      'import.starting': 'Démarrage…', 'import.login': 'Connexion à AnyList…', 'import.fetching': 'Lecture de votre compte…',
      'import.recipes': 'Importation des recettes : {n} sur {total}', 'import.lists': 'Importation des listes d’épicerie…', 'import.done': 'Terminé',
      'import.stats': '{done} recettes importées · {photos} photos · {lists} listes', 'import.failed': '{n} en échec', 'import.skipped': '{n} vides ignorées', 'import.view': 'Voir les recettes',
      'cook.step': 'Étape {n} de {m}', 'cook.back': 'Précédent', 'cook.next': 'Suivant', 'cook.close': 'Fermer',
      'foot.auto': 'mises à jour automatiques activées', 'foot.off': 'mises à jour automatiques désactivées', 'foot.check': 'Vérifier maintenant', 'foot.checking': 'vérification…',
      'foot.updated': 'mis à jour, redémarrage…', 'foot.idle': 'à jour', 'foot.rebuild': 'une version plus récente demande une reconstruction', 'foot.builtin': 'intégrée',
      'home.search': 'Chercher dans vos recettes', 'home.count': '{n} recettes', 'home.noMatch': 'Aucune recette ne correspond à « {q} ».', 'home.emptyTitle': 'Votre boîte à recettes est vide',
      'cook.ingredients': 'Ingrédients', 'cook.addTimer': 'Ajouter une minuterie', 'cook.minutes': 'min', 'cook.custom': 'Minutes', 'cook.start': 'Démarrer', 'cook.finish': 'Terminé', 'cook.presets': 'Minuteries rapides',
      'timer.pause': 'Pause', 'timer.resume': 'Reprendre', 'timer.plus': '+1 min', 'timer.restart': 'Recommencer', 'timer.dismiss': 'Retirer', 'timer.stop': 'Arrêter', 'timer.ready': 'Temps écoulé', 'timer.label': 'Minuterie', 'timer.stepLabel': 'Étape {n} : {time}',
      'import.cRecipes': '{n} recettes', 'import.cPhotos': '{n} photos', 'import.cLists': '{n} listes',
      'foot.version': 'Simmer {v}',
    },
  };

  // Messages that come from the server in English, shown in the chosen language.
  const ERRORS = [
    [/No structured recipe found/i, { en: null, fr: 'Aucune recette structurée trouvée sur cette page. Ajoutez ANTHROPIC_API_KEY pour activer l’extraction par IA.' }],
    [/No recipe could be found/i, { en: null, fr: 'Aucune recette trouvée sur cette page.' }],
    [/Refusing to fetch private/i, { en: null, fr: 'Adresse privée ou interne refusée. Activez ALLOW_PRIVATE_URLS pour autoriser le réseau local.' }],
    [/Site returned HTTP (\d+)/i, { en: null, fr: 'Le site a répondu avec l’erreur HTTP $1.' }],
    [/Invalid URL/i, { en: null, fr: 'Ce lien n’est pas valide.' }],
    [/Enter your AnyList email/i, { en: null, fr: 'Entrez votre courriel et votre mot de passe AnyList.' }],
    [/AnyList rejected/i, { en: null, fr: 'AnyList a refusé ce courriel ou ce mot de passe.' }],
    [/could not reach AnyList/i, { en: null, fr: 'Simmer ne peut pas joindre AnyList. Vérifiez la connexion Internet du serveur.' }],
    [/already running/i, { en: null, fr: 'Une importation est déjà en cours.' }],
    [/Auto-update is off/i, { en: null, fr: 'Les mises à jour automatiques sont désactivées. Réglez AUTO_UPDATE à true sur le conteneur.' }],
    [/Not found/i, { en: null, fr: 'Introuvable.' }],
  ];

  let lang = 'en';
  try { const s = localStorage.getItem('simmer-lang'); lang = s === 'fr' || s === 'en' ? s : (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'; } catch { lang = (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'; }
  document.documentElement.lang = lang;

  window.I18n = {
    get lang() { return lang; },
    set(l) { lang = l === 'fr' ? 'fr' : 'en'; try { localStorage.setItem('simmer-lang', lang); } catch { /* private mode */ } document.documentElement.lang = lang; },
    t(key, vars) {
      let s = D[lang][key] ?? D.en[key] ?? key;
      if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
      return s;
    },
    err(msg) {
      msg = String(msg || '');
      if (lang === 'fr') for (const [re, tr] of ERRORS) { const m = msg.match(re); if (m && tr.fr) return tr.fr.replace('$1', m[1] || ''); }
      return msg;
    },
  };
})();
