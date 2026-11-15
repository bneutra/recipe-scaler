// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const RS = require('./recipe-scaler.js');

// Parse a line and return just the bits we usually care about.
function p(line) {
    const r = RS.parseLine(line);
    return r && { qty: r.quantity, unit: r.unit, ingredient: r.ingredient };
}

// Scale a single line and return "qty | unit | ingredient".
function s(line, multiplier) {
    const r = RS.scaleLine(RS.parseLine(line), multiplier);
    return [r.quantity, r.unitText, r.ingredient].join(' | ');
}

test('plain numbers', () => {
    assert.deepEqual(p('2 cups flour'), { qty: [2], unit: 'cup', ingredient: 'flour' });
    assert.deepEqual(p('1.5 cups sugar'), { qty: [1.5], unit: 'cup', ingredient: 'sugar' });
    assert.deepEqual(p('.5 tsp salt'), { qty: [0.5], unit: 'tsp', ingredient: 'salt' });
});

test('ascii fractions and mixed numbers', () => {
    assert.deepEqual(p('1/2 tsp salt').qty, [0.5]);
    assert.deepEqual(p('1 1/2 cups milk').qty, [1.5]);
    assert.deepEqual(p('1-1/2 cups milk').qty, [1.5]);
    assert.deepEqual(p('2 3/4 cups water').qty, [2.75]);
});

test('unicode vulgar fractions', () => {
    const cases = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8,
        '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅕': 1 / 5, '⅙': 1 / 6, '⅚': 5 / 6 };
    for (const [glyph, value] of Object.entries(cases)) {
        assert.deepEqual(p(`${glyph} cup oil`).qty, [value], glyph);
    }
    assert.deepEqual(p('1½ cups flour').qty, [1.5]);
    assert.deepEqual(p('1 ½ cups flour').qty, [1.5]);
    assert.deepEqual(p('2¼ tsp yeast').qty, [2.25]);
});

test('fraction slash and odd whitespace from copy/paste', () => {
    assert.deepEqual(p('1⁄2 cup butter').qty, [0.5]);          // U+2044
    assert.deepEqual(p('1 1/2 cups milk').qty, [1.5]); // non-breaking spaces
    assert.deepEqual(p('2 tbsp honey'), { qty: [2], unit: 'tbsp', ingredient: 'honey' });
});

test('leading bullets and checkboxes are stripped', () => {
    for (const bullet of ['•', '-', '*', '▢', '☐', '□', '◦', '·']) {
        assert.deepEqual(p(`${bullet} 2 cups flour`),
            { qty: [2], unit: 'cup', ingredient: 'flour' }, bullet);
    }
    assert.deepEqual(p('▢1 tsp vanilla').qty, [1]);
});

test('ranges', () => {
    assert.deepEqual(p('2-3 cloves garlic').qty, [2, 3]);
    assert.deepEqual(p('2–3 cloves garlic').qty, [2, 3]);   // en dash
    assert.deepEqual(p('2 to 3 tbsp water').qty, [2, 3]);
    assert.deepEqual(p('½-1 tsp chili flakes').qty, [0.5, 1]);
    assert.equal(s('2-3 cloves garlic', 2), '4–6 |  | cloves garlic');
});

test('lines without a leading quantity are kept, unscaled', () => {
    assert.deepEqual(RS.parseLine('salt to taste'), { quantity: null, unit: null, unitText: '', ingredient: 'salt to taste' });
    assert.equal(RS.parseLine('For the sauce:').ingredient, 'For the sauce:');
    assert.equal(s('salt to taste', 2), ' |  | salt to taste');
});

test('blank lines are dropped by parseIngredients', () => {
    const rows = RS.parseIngredients('2 cups flour\n\n   \nsalt to taste\n');
    assert.equal(rows.length, 2);
});

test('unit recognition', () => {
    assert.equal(p('1 Tbsp oil').unit, 'tbsp');
    assert.equal(p('1 tablespoon oil').unit, 'tbsp');
    assert.equal(p('1 T oil').unit, 'tbsp');
    assert.equal(p('1 t salt').unit, 'tsp');
    assert.equal(p('1 teaspoons salt').unit, 'tsp');
    assert.equal(p('1 c. milk').unit, 'cup');
    assert.equal(p('8 oz cream cheese').unit, 'oz');
    assert.equal(p('8 fl oz cream').unit, 'floz');
    assert.equal(p('8 fl. oz. cream').unit, 'floz');
    assert.equal(p('2 lbs chicken').unit, 'lb');
    assert.equal(p('250 g butter').unit, 'g');
    assert.equal(p('250g butter').unit, 'g');
    assert.equal(p('1 kg potatoes').unit, 'kg');
    assert.equal(p('500 ml stock').unit, 'ml');
    assert.equal(p('500mL stock').unit, 'ml');
    assert.equal(p('1 L water').unit, 'l');
});

test('unknown units are fine: everything after the quantity is the ingredient', () => {
    assert.deepEqual(p('2 large eggs'), { qty: [2], unit: null, ingredient: 'large eggs' });
    assert.deepEqual(p('1 (14 oz) can tomatoes'), { qty: [1], unit: null, ingredient: '(14 oz) can tomatoes' });
    // "garlic" starts with letters but is not a unit
    assert.deepEqual(p('3 garlic cloves'), { qty: [3], unit: null, ingredient: 'garlic cloves' });
});

test('unit text keeps the original spelling', () => {
    assert.equal(RS.parseLine('1 Tbsp oil').unitText, 'Tbsp');
    assert.equal(RS.parseLine('1 c. milk').unitText, 'c.');
});

test('fraction formatting for US units and counts', () => {
    assert.equal(RS.formatQuantity(1.5, 'cup'), '1 ½');
    assert.equal(RS.formatQuantity(0.5, 'tsp'), '½');
    assert.equal(RS.formatQuantity(3, 'cup'), '3');
    assert.equal(RS.formatQuantity(1 / 3, 'cup'), '⅓');
    assert.equal(RS.formatQuantity(2 / 3, 'cup'), '⅔');
    assert.equal(RS.formatQuantity(0.333, 'cup'), '⅓');
    assert.equal(RS.formatQuantity(0.75 * 1.5, 'cup'), '1 ⅛');
    assert.equal(RS.formatQuantity(0.98, 'cup'), '1');
    assert.equal(RS.formatQuantity(1.97, null), '2');
    assert.equal(RS.formatQuantity(2.25, null), '2 ¼');
    // too small for a kitchen fraction: fall back to a decimal
    assert.equal(RS.formatQuantity(0.05, 'tsp'), '0.05');
});

test('decimal formatting for metric units', () => {
    assert.equal(RS.formatQuantity(375, 'g'), '375');
    assert.equal(RS.formatQuantity(187.5, 'g'), '188');
    assert.equal(RS.formatQuantity(2.5, 'g'), '2.5');
    assert.equal(RS.formatQuantity(1.25, 'kg'), '1.25');
    assert.equal(RS.formatQuantity(0.333333, 'l'), '0.33');
    assert.equal(RS.formatQuantity(750, 'ml'), '750');
});

test('scaling whole lines', () => {
    assert.equal(s('1½ cups all-purpose flour, sifted', 2), '3 | cups | all-purpose flour, sifted');
    assert.equal(s('¾ cup milk', 0.5), '⅜ | cup | milk');
    assert.equal(s('1/3 cup sugar', 1.5), '½ | cup | sugar');
    assert.equal(s('250 g butter', 1.5), '375 | g | butter');
    assert.equal(s('3 large eggs', 0.5), '1 ½ |  | large eggs');
    assert.equal(s('1 (14 oz) can tomatoes', 2), '2 |  | (14 oz) can tomatoes');
    assert.equal(s('2 cups flour', 1), '2 | cups | flour');
});

test('a realistic pasted block', () => {
    const pasted = [
        '▢ 2 ¼ cups all-purpose flour',
        '▢ 1 teaspoon baking soda',
        '▢ ½ teaspoon salt',
        '▢ 1 cup unsalted butter, softened',
        '▢ ¾ cup granulated sugar',
        '▢ 2 large eggs',
        '▢ 2 cups chocolate chips',
        'Flaky sea salt, for topping',
    ].join('\n');
    const rows = RS.parseIngredients(pasted).map(r => RS.scaleLine(r, 0.5));
    assert.deepEqual(rows.map(r => r.quantity), ['1 ⅛', '½', '¼', '½', '⅜', '1', '1', '']);
    assert.equal(rows[7].ingredient, 'Flaky sea salt, for topping');
});

// --- Splitting ingredients from instructions ---

const DUTCH_BABY = [
    '3 large eggs ',
    '.7 cup all-purpose flour, spooned into',
    'measuring cup and leveled-off',
    '1/2 cup milk ',
    '1 tablespoon maple syrup, plus more for',
    'serving',
    '1/4 teaspoon salt',
    '1/2 teaspoon vanilla extract',
    '3 tablespoons butter',
    '',
    'preheat 425',
    'heat 10” cast pan on stovetop to 400',
    'butter in',
    'batter in',
    '15m',
].join('\n');

test('instructions start at the first quantity-less line after a blank line', () => {
    const { ingredients, instructions } = RS.parseRecipe(DUTCH_BABY);
    assert.equal(ingredients.length, 7);
    assert.deepEqual(instructions, [
        'preheat 425',
        'heat 10” cast pan on stovetop to 400',
        'butter in',
        'batter in',
        '15m',
    ]);
});

test('wrapped ingredient lines are joined onto the line above', () => {
    const { ingredients } = RS.parseRecipe(DUTCH_BABY);
    assert.equal(ingredients[1].ingredient, 'all-purpose flour, spooned into measuring cup and leveled-off');
    assert.equal(ingredients[3].ingredient, 'maple syrup, plus more for serving');
});

test('a standalone lowercase line is not joined when the line above has no comma', () => {
    const { ingredients } = RS.parseRecipe('1 tbsp olive oil\nsalt to taste');
    assert.equal(ingredients.length, 2);
    assert.equal(ingredients[1].ingredient, 'salt to taste');
});

test('everything after the split stays in instructions, even lines with numbers', () => {
    const { instructions } = RS.parseRecipe('2 cups flour\n\nMix well.\n2 eggs go in next\n\nBake 20 min');
    assert.deepEqual(instructions, ['Mix well.', '2 eggs go in next', '', 'Bake 20 min']);
});

test('blank lines inside the ingredient list do not end it', () => {
    const { ingredients, instructions } = RS.parseRecipe('2 cups flour\n\n1 tsp salt\n\nStir.');
    assert.equal(ingredients.length, 2);
    assert.deepEqual(instructions, ['Stir.']);
});

test('a "For the x:" sub-heading after a blank line stays with the ingredients', () => {
    const { ingredients, instructions } = RS.parseRecipe(
        '2 cups flour\n\nFor the glaze:\n1 cup powdered sugar\n\nWhisk the glaze.');
    assert.deepEqual(ingredients.map(i => i.ingredient), ['flour', 'For the glaze:', 'powdered sugar']);
    assert.deepEqual(instructions, ['Whisk the glaze.']);
});

test('numbered steps after a blank line are instructions, not quantities', () => {
    const { ingredients, instructions } = RS.parseRecipe('2 cups flour\n\n1. Preheat the oven.\n2) Mix.');
    assert.equal(ingredients.length, 1);
    assert.deepEqual(instructions, ['1. Preheat the oven.', '2) Mix.']);
});

test('no blank line means no instructions', () => {
    const { ingredients, instructions } = RS.parseRecipe('2 cups flour\nsalt to taste');
    assert.equal(ingredients.length, 2);
    assert.deepEqual(instructions, []);
});

test('quantities typed as decimals stay decimals when scaled', () => {
    assert.equal(s('.7 cup flour', 1), '0.7 | cup | flour');
    assert.equal(s('.7 cup flour', 2), '1.4 | cup | flour');
    assert.equal(s('1.5 cups sugar', 0.5), '0.75 | cups | sugar');
    assert.equal(s('0.7 cup flour', 1 / 3), '0.23 | cup | flour');
    assert.equal(s('1.5-2.5 tbsp water', 2), '3–5 | tbsp | water');
    // fractions and whole numbers still become kitchen fractions
    assert.equal(s('1/3 cup sugar', 1.5), '½ | cup | sugar');
    assert.equal(s('3 large eggs', 0.5), '1 ½ |  | large eggs');
});
