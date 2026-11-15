// Recipe scaler: parse pasted ingredient lines, scale the leading quantity,
// and format results the way a cook would write them.
// Works in the browser (window.RecipeScaler) and in Node (require).
(function (root) {
    'use strict';

    const VULGAR = {
        '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
        '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
        '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
    };

    // Canonical unit -> spellings. Matching is case-insensitive except T / t.
    const UNIT_ALIASES = {
        cup: ['cup', 'cups', 'c'],
        tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tbls', 'tb', 'tablespoon', 'tablespoons'],
        tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
        oz: ['oz', 'ounce', 'ounces'],
        lb: ['lb', 'lbs', 'pound', 'pounds'],
        pint: ['pint', 'pints', 'pt', 'pts'],
        quart: ['quart', 'quarts', 'qt', 'qts'],
        gallon: ['gallon', 'gallons', 'gal'],
        pinch: ['pinch', 'pinches'],
        dash: ['dash', 'dashes'],
        stick: ['stick', 'sticks'],
        mg: ['mg', 'milligram', 'milligrams'],
        g: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'],
        kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
        ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
        cl: ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres'],
        dl: ['dl', 'deciliter', 'deciliters', 'decilitre', 'decilitres'],
        l: ['l', 'liter', 'liters', 'litre', 'litres'],
    };
    const UNIT_LOOKUP = {};
    for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) {
        for (const a of aliases) UNIT_LOOKUP[a] = unit;
    }

    // Metric units show decimals; everything else (US units, counts) shows fractions.
    const METRIC_SMALL = new Set(['mg', 'g', 'ml', 'cl']);
    const METRIC_LARGE = new Set(['kg', 'l', 'dl']);

    // Fractions a cook would actually measure.
    const FRACTIONS = [
        [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
        [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, ''],
    ];

    const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+-\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
    const QTY_RE = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|\bto\b)\s*(${NUM}))?(?![\d\/])\s*`);
    const BULLETS_RE = /^[\s•·▪▫◦‣⁃∙*\-▢☐□■✓✔]+/;

    function normalize(line) {
        return line
            .replace(/[  -​  　\t]/g, ' ')
            .replace(/[⁄∕]/g, '/')
            .replace(/[‐-―−]/g, '-')
            .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, ch => ' ' + VULGAR[ch])
            .replace(BULLETS_RE, '')
            .replace(/ {2,}/g, ' ')
            .trim();
    }

    function numberValue(text) {
        let m;
        if ((m = text.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
        if ((m = text.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
        return parseFloat(text);
    }

    function matchUnit(rest) {
        let m = rest.match(/^fl\.?\s*oz\.?(?=\s|$|[,;()])/i);
        if (m) return { unit: 'floz', text: m[0] };
        m = rest.match(/^([A-Za-z]+)\.?(?=\s|$|[,;()])/);
        if (!m) return null;
        const word = m[1];
        const unit = word === 'T' ? 'tbsp' : word === 't' ? 'tsp' : UNIT_LOOKUP[word.toLowerCase()];
        return unit ? { unit, text: m[0] } : null;
    }

    function parseLine(line) {
        const clean = normalize(line);
        const q = clean.match(QTY_RE);
        if (!q) return { quantity: null, unit: null, unitText: '', ingredient: clean };

        const quantity = [numberValue(q[1])];
        if (q[2]) quantity.push(numberValue(q[2]));

        let rest = clean.slice(q[0].length);
        const u = matchUnit(rest);
        if (u) rest = rest.slice(u.text.length).trim();

        return {
            quantity,
            unit: u ? u.unit : null,
            unitText: u ? u.text : '',
            ingredient: rest,
            // Typed as a decimal (".7 cup")? Keep decimals so we don't lose precision.
            decimal: /\./.test(q[1] + (q[2] || '')),
        };
    }

    function parseIngredients(text) {
        return text.split(/\r?\n/).filter(l => normalize(l)).map(parseLine);
    }

    // Does this line start with something that looks like an ingredient quantity?
    // "1. Preheat..." / "2) Mix" are numbered steps, not quantities.
    function hasQuantity(line) {
        const clean = normalize(line);
        return !/^\d+[.)]\s/.test(clean) && QTY_RE.test(clean);
    }

    // Split pasted text into ingredients and instructions. Instructions begin at
    // the first line after a blank line that has no quantity (unless it is a
    // "For the glaze:" style sub-heading followed by more ingredients).
    // Lowercase lines that continue a wrapped ingredient note ("..., plus more
    // for" / "serving") are joined onto the ingredient above.
    function parseRecipe(text) {
        const lines = text.split(/\r?\n/);
        const ingredients = [];
        let instructions = [];
        let afterBlank = false;

        for (let i = 0; i < lines.length; i++) {
            const clean = normalize(lines[i]);
            if (!clean) {
                if (ingredients.length) afterBlank = true;
                continue;
            }

            if (afterBlank && !hasQuantity(clean)) {
                const next = lines.slice(i + 1).find(l => normalize(l));
                const isSubHeading = clean.endsWith(':') && next !== undefined && hasQuantity(next);
                if (!isSubHeading) {
                    instructions = lines.slice(i).map(l => l.trim());
                    while (instructions.length && !instructions[instructions.length - 1]) instructions.pop();
                    break;
                }
            }

            const parsed = parseLine(lines[i]);
            const prev = ingredients[ingredients.length - 1];
            const isContinuation = !afterBlank && !parsed.quantity && prev && prev.quantity
                && prev.ingredient.includes(',') && /^[a-z]/.test(clean);
            if (isContinuation) prev.ingredient += ' ' + clean;
            else ingredients.push(parsed);
            afterBlank = false;
        }

        return { ingredients, instructions };
    }

    function trimDecimal(value, places) {
        return String(Number(value.toFixed(places)));
    }

    function formatQuantity(value, unit, decimal) {
        if (METRIC_SMALL.has(unit)) return trimDecimal(value, value >= 10 ? 0 : 1);
        if (METRIC_LARGE.has(unit) || decimal) return trimDecimal(value, 2);

        let whole = Math.floor(value);
        const frac = value - whole;
        let best = FRACTIONS[0];
        for (const f of FRACTIONS) {
            if (Math.abs(frac - f[0]) < Math.abs(frac - best[0])) best = f;
        }
        if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }

        if (whole === 0 && !best[1]) {
            return value > 0 ? String(Number(value.toPrecision(2))) : '0';
        }
        if (!best[1]) return String(whole);
        return whole ? `${whole} ${best[1]}` : best[1];
    }

    function scaleLine(parsed, multiplier) {
        const quantity = parsed.quantity
            ? parsed.quantity.map(v => formatQuantity(v * multiplier, parsed.unit, parsed.decimal)).join('–')
            : '';
        return { quantity, unit: parsed.unit, unitText: parsed.unitText, ingredient: parsed.ingredient };
    }

    const api = { normalize, parseLine, parseIngredients, parseRecipe, formatQuantity, scaleLine };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RecipeScaler = api;
})(typeof window !== 'undefined' ? window : this);
