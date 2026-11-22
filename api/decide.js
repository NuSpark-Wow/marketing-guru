// The Decision Room — server function (Vercel)
// One endpoint, four actions: scenario, advisors, reveal, followup.
// The hidden answer is created WITH the scenario and sealed (encrypted) so it
// can never shift to match or contradict the user's pick, and can't be peeked at.

const crypto = require('crypto');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.DR_MODEL || 'claude-sonnet-5-5';
const DAILY_LIMIT = parseInt(process.env.DR_DAILY_LIMIT || '150', 10); // API calls per visitor per day
const ALLOWED = (process.env.DR_ALLOWED_HOSTS ||
  'nusparklearnwow.com,nusparkpublishing.com,nusparkmarketing.com,vercel.app,localhost,127.0.0.1')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// ---------- Categories ----------
const STD = ['Best Call', 'Solid Call', 'Risky Call', 'Wrong Call'];
const KIDS = ['Best Call', 'Good Call', 'Try Again Call'];

const CATEGORIES = {
  final: {
    name: 'Final Seconds', ratings: STD, style: 'real', audience: 'general',
    brief: 'End-of-game sports decisions. The user is the coach, captain or player with the game on the line. Use real strategy, odds and how pros actually think. Fictional teams and players only.',
    seeds: ['basketball: down 2, final possession', 'football: 4th-and-goal from the 2, down 4', 'baseball: tie game, bottom of the 9th, runner on 2nd', 'soccer: choosing penalty shootout order', 'hockey: when to pull the goalie', 'football: go for 2 after a late touchdown', 'basketball: up 3, foul or defend?', 'baseball: intentionally walk the slugger?', 'tennis: serve choice at match point', 'football: onside kick or deep kick?']
  },
  founder: {
    name: "The Founder's Desk", ratings: STD, style: 'real', audience: 'general',
    brief: 'Startup and small-business founder decisions: launching, pitching, pricing, hiring, investors, go-to-market. Fictional companies only.',
    seeds: ['launch now with bugs vs wait vs soft launch', 'pricing the first product', 'splitting equity with a co-founder', 'a term sheet with tough terms', 'first key hire', 'a big customer demanding a custom feature', 'picking the first go-to-market channel', 'a bigger competitor copies your product', 'raise money or bootstrap', 'pivot after weak early sales', 'pitch meeting: the investor asks a question you cannot answer']
  },
  money: {
    name: 'Money Moves', ratings: STD, style: 'real', audience: 'general',
    disclaimer: 'Educational only — not financial advice.',
    brief: 'Everyday personal money decisions with real-world financial reasoning. No specific stocks, funds, brands or companies.',
    seeds: ['an unexpected windfall', 'buy vs lease a car', 'rent vs buy a home', 'a "too good to be true" investment offer', 'emergency fund vs paying down a credit card', 'a 0% balance transfer offer', 'starting a side hustle', 'the extended warranty at checkout', 'taking the full employer retirement match', 'lending money to a friend']
  },
  science: {
    name: 'Science Lab', ratings: STD, style: 'real', audience: 'general',
    brief: 'Science decisions: how real scientists handle experiments, data and discovery. Can be a fictional lab situation OR a real moment from science history (then the reveal says what actually happened).',
    seeds: ['an experiment gives an unexpected result before the science fair', 'real history: a moldy petri dish (Fleming, 1928)', 'real history: Apollo 13 needs a CO2 fix', 'one data point looks way off', 'lab safety: a strange smell during an experiment', 'testing a hypothesis with a small sample', 'real history: the Wright brothers and wind-tunnel data', 'choosing a control group', 'real history: Jonas Salk testing the polio vaccine']
  },
  history: {
    name: "History's Turning Points", ratings: STD, style: 'history', audience: 'general',
    brief: 'Put the user inside a REAL historical moment as the decision maker. Facts in the setup must be accurate. Keep it educational and politically neutral. The reveal must state what actually happened. Avoid graphic violence.',
    seeds: ['Washington before crossing the Delaware (1776)', 'Jefferson and the Louisiana Purchase offer (1803)', 'Lewis and Clark at the fork of the Missouri (1805)', 'Shackleton after the Endurance is crushed (1915)', 'NASA during Apollo 13 (1970)', 'Johnson & Johnson during the Tylenol crisis (1982)', 'Coca-Cola after the New Coke backlash (1985)', 'Edison choosing a filament for the light bulb (1879)', 'the Wright brothers choosing where to fly (1900)', 'Lincoln deciding when to announce emancipation (1862)']
  },
  law: {
    name: 'Law & Justice', ratings: STD, style: 'real', audience: 'general',
    disclaimer: 'Educational only — not legal advice. Laws vary by state; for your own situation, talk to a licensed attorney.',
    brief: 'Juror decisions on criminal trials (theft, burglary, DUI, vandalism, shoplifting, car break-ins), "is this legal?" situations, everyday disputes, know-your-rights moments, and occasionally white-collar red flags. NO murders or violent crime. Fictional people only. Teach concepts like reasonable doubt, burden of proof and evidence. Note when rules vary by state.',
    seeds: ['juror: shoplifting case with a shaky witness', 'small claims: landlord kept the deposit', 'is this legal? recording a phone call', 'fender bender: who is at fault?', 'juror: stolen bike, circumstantial evidence', 'white-collar red flags in the company books', 'a contract signed but never read', 'a neighbor\'s tree falls on your fence', 'juror: vandalism case with security footage']
  },
  detective: {
    name: "Detective's Choice", ratings: STD, style: 'real', audience: 'family',
    brief: 'Family-friendly mysteries (NO violence, nobody hurt). The user is the detective choosing which lead to follow or which conclusion to draw from clues. The setup must contain the clues needed to reason it out fairly.',
    seeds: ['the missing birthday cake', 'who switched the science fair projects?', 'the museum painting that looks slightly different', 'the lost dog and three sightings', 'the office stapler thief', 'the bakery\'s secret recipe went missing', 'muddy footprints in the library', 'the trophy vanished from the case']
  },
  ethics: {
    name: 'Everyday Ethics', ratings: STD, style: 'real', audience: 'general',
    brief: 'Everyday right-and-wrong dilemmas. Weigh honesty, kindness, fairness and consequences. Fictional people only.',
    seeds: ['you find a wallet with cash', 'the cashier gives you too much change', 'a friend tells you a secret that worries you', 'a coworker takes credit for your idea', 'a neighbor\'s package is delivered to you', 'the restaurant forgot to charge for dessert', 'you see a friend cheat on a test', 'you dislike a gift from someone close']
  },
  daily: {
    name: 'Daily Life', ratings: STD, style: 'real', audience: 'general',
    disclaimer: 'General info only — for your own health, diet or exercise needs, check with a doctor.',
    brief: 'Everyday practical choices: food pairings and healthier options, mattresses, clothing fit (like jeans), simple stretches, home and shopping choices. Compare TYPES, never brands. Keep health and fitness general — no personal weight targets, diets or numbers about the user.',
    seeds: ['the healthiest side vegetable with steak', 'firm, medium or soft mattress for a side sleeper', 'jeans fit for a desk job', 'a stretch for a tight lower back after a long drive', 'running shoe type for a beginner', 'a houseplant for a low-light apartment', 'TV size for a small living room', 'the best breakfast before a busy morning', 'packing for a rainy weekend trip', 'sunscreen choice for a beach day']
  },
  parenting: {
    name: 'Parenting Moments', ratings: STD, style: 'real', audience: 'general',
    brief: 'Common parenting decisions with what child-development experts generally suggest. Warm, non-judgmental, no single "perfect parent" answer unless clearly warranted.',
    seeds: ['screen time battles on a school night', 'a teen breaks curfew', 'siblings fighting over a game', 'a picky eater at dinner', 'homework meltdown', 'when to get a first phone', 'allowance: earned or given?', 'your kid wants to quit the team mid-season', 'a sleepover invite at a family you don\'t know']
  },
  kids: {
    name: "Kids' Corner", ratings: KIDS, style: 'real', audience: 'kids',
    brief: 'Simple everyday choices for kids ages 5–10: friendship, honesty, sharing, school. Very short sentences, simple words, warm and encouraging. Never shaming.',
    seeds: ['a friend is left out at recess', 'you broke something at home', 'you find a dollar on the playground', 'a new kid sits alone at lunch', 'your little brother wants your toy', 'homework or play first?', 'someone wants to trade lunches', 'you forgot your homework']
  },
  custom: {
    name: 'Your Topic', ratings: STD, style: 'real', audience: 'general',
    disclaimer: 'General info for learning, not professional advice.',
    brief: 'A scenario built around a topic the player typed in. Make it a realistic everyday, work, money, history, science, sports or family decision about that topic. If the topic is a real historical event, put the player in that moment and use real_world for what actually happened. If the topic is harmful, sexual, hateful, involves violence, self-harm or how to commit a crime, do NOT use it: write a gentle, family-friendly scenario on a safe, related everyday topic instead.',
    seeds: ['an everyday decision']
  },
  treasure: {
    name: 'The Treasure Hunt', ratings: STD, style: 'story', audience: 'family',
    brief: 'Imaginary family-friendly treasure adventures. Choices are paths, tools or clue readings. Outcomes are STORY consequences, but make the "best" choice fair: the setup contains clues (sounds, markings, weather, map notes) that reward careful thinking. No violence or scary gore.',
    seeds: ['three tunnels inside an ancient temple', 'a pirate map with a torn corner', 'the old lighthouse riddle', 'desert ruins at sunset', 'a rope bridge in the jungle', 'a sunken ship\'s cabin', 'a mountain cave with an echo', 'a mysterious mansion attic']
  }
};


// Optional sub-choices for some categories (Mix = all seeds)
const SUBS = {
  final: {
    basketball: { label: 'Basketball', seeds: ['down 2, final possession', 'up 3 with 8 seconds left: foul or defend?', 'last shot: star player or open teammate?', 'timeout or push the ball after a rebound?', 'free-throw shooter is cold in the final minute'] },
    football: { label: 'Football', seeds: ['4th-and-goal from the 2, down 4', 'go for 2 after a late touchdown', 'onside kick or deep kick?', 'kneel down or try to score before halftime?', 'long field goal or punt on 4th-and-3'] },
    baseball: { label: 'Baseball', seeds: ['tie game, bottom of the 9th, runner on 2nd', 'intentionally walk the slugger?', 'bunt or swing away with no outs', 'pull the tiring starter or stay?', 'steal second with two outs in the 9th?'] },
    soccer: { label: 'Soccer', seeds: ['choosing penalty shootout order', 'up 1 with 5 minutes left: defend or keep attacking?', 'last substitution in stoppage time', 'your keeper vs their best penalty taker', 'free kick at the edge of the box'] },
    hockey: { label: 'Hockey', seeds: ['when to pull the goalie', 'challenge an offside call on a tying goal?', 'power play in overtime: who goes out?', 'shootout order', 'down 1 with a faceoff in their zone'] }
  },
  science: {
    experiments: { label: 'Experiments', seeds: ['an experiment gives an unexpected result before the science fair', 'one data point looks way off', 'lab safety: a strange smell during an experiment', 'testing a hypothesis with a small sample', 'choosing a control group', 'your results contradict the textbook'] },
    history: { label: 'Real History', history: true, seeds: ['real history: a moldy petri dish (Fleming, 1928)', 'real history: Apollo 13 needs a CO2 fix (1970)', 'real history: the Wright brothers and wind-tunnel data (1901)', 'real history: Jonas Salk testing the polio vaccine (1954)', 'real history: Marie Curie and the glowing samples (1898)', 'real history: Edward Jenner and the smallpox idea (1796)'] }
  },
  law: {
    juror: { label: "Juror's Seat", seeds: ['juror: shoplifting case with a shaky witness', 'juror: burglary case with fingerprints but no stolen items found', 'juror: DUI case with a disputed breath test', 'juror: car break-in caught on a blurry doorbell camera', 'juror: vandalism case with security footage', 'juror: stolen bike, circumstantial evidence'] },
    legal: { label: 'Is This Legal?', seeds: ['is this legal? recording a phone call', 'is this legal? keeping money you found on the sidewalk', 'is this legal? a neighbor\'s camera pointed at your yard', 'is this legal? reselling concert tickets above face value', 'is this legal? taking fruit from a tree hanging over your fence', 'is this legal? leaving a child in the car for two minutes'] },
    disputes: { label: 'Everyday Disputes', seeds: ['small claims: landlord kept the deposit', 'fender bender: who is at fault?', 'a contractor took the deposit and disappeared', 'a neighbor\'s tree falls on your fence', 'a dry cleaner ruined an expensive jacket', 'a friend never paid back a loan'] },
    rights: { label: 'Know Your Rights', seeds: ['a traffic stop: the officer asks to search your car', 'police knock and ask questions at your door', 'you get a jury duty summons during a busy week', 'filming police in public', 'a store employee wants to check your bag', 'you\'re asked for ID while walking downtown'] }
  },
  daily: {
    food: { label: 'Food', seeds: ['the healthiest side vegetable with steak', 'the best breakfast before a busy morning', 'healthiest way to cook chicken for the week', 'a smart snack for a long road trip', 'which cooking oil for high-heat cooking'] },
    home: { label: 'Home & Shopping', seeds: ['firm, medium or soft mattress for a side sleeper', 'TV size for a small living room', 'a houseplant for a low-light apartment', 'LED bulb color for a bedroom', 'vacuum type for a home with pets'] },
    clothing: { label: 'Clothing', seeds: ['jeans fit for a desk job', 'what to wear to a job interview at a casual company', 'layering for a cold, windy day', 'running shoe type for a beginner', 'packing clothes for a rainy weekend trip'] },
    fitness: { label: 'Stretches & Fitness', seeds: ['a stretch for a tight lower back after a long drive', 'warming up before a weekend pickup game', 'a beginner starting to walk for exercise', 'stretching for stiff shoulders from a desk job', 'how to start strength training at home'] }
  }
};

const ADVISORS = {
  gus: 'Gus, The Gut — trusts instincts, decides fast, folksy and upbeat. Catchphrase vibe: "Feels right. Go with it!"',
  brainerd: 'Dr. Brainerd, The Brain — careful, evidence-first, a little professorial. "What do the facts actually say?"',
  sunny: 'Sunny, The Optimist — cheerful, sees what could go right, encouraging.',
  doubt: 'Doubt, The Skeptic — dry and witty, pokes holes, asks "what could go wrong?"',
  ace: 'Ace, The Risk-Taker — bold, confident, loves a big swing. "Fortune favors the brave."',
  pops: 'Pops, The Wise Old-Timer — warm grandpa energy, short folksy stories, "back in my day…"'
};

// ---------- Helpers ----------
function secretKey() {
  return crypto.createHash('sha256').update((process.env.DR_SECRET || API_KEY || 'dr') + '|decision-room').digest();
}
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
function unseal(token) {
  const b = Buffer.from(String(token || ''), 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }
function rankOf(r) { return { 'Best Call': 4, 'Solid Call': 3, 'Good Call': 3, 'Risky Call': 2, 'Wrong Call': 1, 'Try Again Call': 1 }[r] || 0; }

function parseJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('No JSON in reply');
  return JSON.parse(text.slice(s, e + 1));
}

async function claude(system, user, maxTokens) {
  if (!API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens + 6000, system, messages: [{ role: 'user', content: user }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'AI service error');
  return (j.content || []).map(c => c.text || '').join('');
}

// Asks Claude for structured data using a forced tool call, so the reply is
// always a clean JSON object (no stray text, no parsing guesswork).
async function claudeJSON(system, user, maxTokens) {
  if (!API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens + 6000, system: system + '\n\nIMPORTANT: Always answer by calling the respond tool. Do not reply with plain text.',
      tools: [{ name: 'respond', description: 'Return your answer as a JSON object in the exact shape described in the instructions.', input_schema: { type: 'object', additionalProperties: true } }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: user }]
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'AI service error');
  const blocks = j.content || [];
  const tool = blocks.find(b => b.type === 'tool_use');
  if (tool && tool.input && typeof tool.input === 'object') return tool.input;
  const text = blocks.map(b => b.text || '').join('');
  try { return parseJSON(text); } catch (e) {
    console.error('decision-room raw reply:', j.stop_reason, JSON.stringify(blocks).slice(0, 400));
    throw new Error('No JSON in reply (stop: ' + j.stop_reason + ')');
  }
}

function hostAllowed(req) {
  const src = req.headers.origin || req.headers.referer || '';
  if (!src) return false;
  let host = '';
  try { host = new URL(src).hostname.toLowerCase(); } catch (e) { return false; }
  return ALLOWED.some(a => host === a || host.endsWith('.' + a));
}

async function underLimit(req) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return true; // no database connected = no per-visitor cap (Anthropic spend limit still applies)
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const key = 'dr:' + new Date().toISOString().slice(0, 10) + ':' + ip;
  try {
    const r = await fetch(url + '/pipeline', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, 90000]])
    });
    const j = await r.json();
    const count = j && j[0] && j[0].result;
    return !(count > DAILY_LIMIT);
  } catch (e) { return true; }
}

function audienceRules(cat) {
  if (cat.audience === 'kids') return 'AUDIENCE: kids ages 5–10. Very short sentences, simple words, gentle and encouraging. Never shame.';
  if (cat.audience === 'family') return 'AUDIENCE: families (kids and adults together). Family-friendly, no violence.';
  return 'AUDIENCE: adults and teens. Clear, engaging, everyday language.';
}

// ---------- Actions ----------
async function makeScenario(body) {
  const cat = CATEGORIES[body.category];
  if (!cat) throw new Error('Unknown category');
  const seen = (Array.isArray(body.seen) ? body.seen : []).slice(-20).map(s => clip(s, 120));
  const target = (() => { const x = Math.random(); return x < 0.45 ? 'one' : x < 0.8 ? 'two' : 'all'; })();
  const subs = SUBS[body.category] || {};
  const sub = subs[body.sub] ? body.sub : 'mix';
  const subDef = subs[sub];
  const custom = body.category === 'custom' ? clip(body.topic, 120).trim() : '';
  if (body.category === 'custom' && !custom) throw new Error('Type a topic first');
  const pool = custom ? [custom] : subDef ? subDef.seeds : cat.seeds.concat(...Object.values(subs).map(x => x.seeds));
  const seed = pick(pool);
  const historyMode = cat.style === 'history' || !!(subDef && subDef.history) || /^real history/i.test(seed);
  const r = cat.ratings;
  const goodSet = r === KIDS ? '"Best Call" or "Good Call"' : '"Best Call" or "Solid Call"';
  const targetText = target === 'one'
    ? 'Exactly ONE option is right (rated "Best Call"); the other two are weaker (' + r.slice(2).map(x => '"' + x + '"').join(' / ') + ').'
    : target === 'two'
      ? 'TWO options are right (one "Best Call" and one ' + goodSet.split(' or ')[1] + ', or both reasonable for different reasons); the third is weaker.'
      : 'ALL THREE options are reasonable (one "Best Call", the others ' + goodSet.split(' or ')[1] + '); the lesson is that it depends on what matters most.';

  const system = [
    'You write scenarios for "The Decision Room," a learning game. A scenario sets up a realistic decision with exactly 3 possible choices. The correct outcome is hidden from the player until after they choose.',
    'CATEGORY: ' + cat.name + '. ' + cat.brief,
    audienceRules(cat),
    'RULES:',
    '- Original and fictional (except real historical facts where the category calls for them). No real living private people. No brands.',
    '- Examples and settings should be national/general, not tied to one city.',
    '- The three choices must be similar in length and all sound plausible. Do not make the best one obviously longer or more detailed.',
    '- The setup must give the player enough information to reason toward the best answer.',
    '- Allowed ratings: ' + r.map(x => '"' + x + '"').join(', ') + '.',
    '- ' + targetText,
    '- Be accurate. If unsure of a fact, leave it out.',
    'Call the respond tool with an object in this exact shape:',
    '{"title":"short catchy title (max 8 words)","setup":"the situation in 2 short paragraphs (separate with \\n\\n)' + (cat.audience === 'kids' ? ', under 70 words total' : ', under 170 words total') + '","question":"the decision question, one sentence","options":[{"id":"A","text":"choice, max 22 words"},{"id":"B","text":"..."},{"id":"C","text":"..."}],"answers":{"A":{"rating":"one of the allowed ratings","why":"1-2 sentence private reason"},"B":{...},"C":{...}},"verdict":"1-2 sentence overall verdict","real_world":"' + (historyMode ? 'what actually happened in history, 2-4 sentences' : cat.style === 'story' ? '' : 'what usually happens in real life / what experts say, 1-3 sentences') + '"}'
  ].join('\n');

  const user = 'Write one new scenario.' + (subDef ? ' Focus: ' + subDef.label + '.' : '') + (custom ? ' The player chose this topic (stay on it unless it breaks the rules): ' + custom : ' Topic idea to build from (adapt freely): ' + seed) +
    (seen.length ? '\nDo NOT repeat or closely resemble these titles already played: ' + seen.join(' | ') : '');

  let data, attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      data = await claudeJSON(system, user, 2000);
      if (Array.isArray(data.options) && data.options.length === 3 && data.answers) break;
    } catch (e) { if (attempt >= 2) throw e; }
  }

  // Normalize + enforce ratings
  let opts = data.options.slice(0, 3).map(o => ({ old: String(o.id || '').trim().toUpperCase(), text: clip(o.text, 260) }));
  opts.forEach(o => {
    const a = data.answers[o.old] || {};
    o.rating = r.includes(a.rating) ? a.rating : r[r.length - 1];
    o.why = clip(a.why, 500);
  });
  if (!opts.some(o => o.rating === 'Best Call')) {
    opts.sort((a, b) => rankOf(b.rating) - rankOf(a.rating))[0].rating = 'Best Call';
  }
  // Shuffle positions so the right answer isn't always in the same spot
  opts = shuffle(opts).map((o, i) => ({ id: 'ABC'[i], text: o.text, rating: o.rating, why: o.why }));
  const goodCount = opts.filter(o => rankOf(o.rating) >= 3).length;
  const verdictType = goodCount <= 1 ? 'one' : goodCount === 2 ? 'two' : 'all';

  const pub = {
    category: body.category,
    title: clip(data.title, 120),
    setup: clip(data.setup, 1800),
    question: clip(data.question, 300),
    options: opts.map(o => ({ id: o.id, text: o.text }))
  };
  const hidden = {
    ...pub,
    answers: Object.fromEntries(opts.map(o => [o.id, { rating: o.rating, why: o.why }])),
    verdict: clip(data.verdict, 600),
    verdictType,
    realWorld: clip(data.real_world, 900),
    history: historyMode,
    t: Date.now()
  };
  return { ...pub, sub, subLabel: subDef ? subDef.label : '', token: seal(hidden), disclaimer: cat.disclaimer || '' };
}

async function advisorTalk(body) {
  const h = unseal(body.token);
  const cat = CATEGORIES[h.category];
  const choice = String(body.choice || '').toUpperCase();
  const chosen = h.options.find(o => o.id === choice);
  if (!chosen) throw new Error('Pick an option first');
  const ids = (Array.isArray(body.advisors) ? body.advisors : []).filter(id => ADVISORS[id]).slice(0, 2);
  if (!ids.length) return { comments: [] };
  // Second opinion: one new advisor reacts to the pick AND to what was already said
  const earlier = (Array.isArray(body.earlier) ? body.earlier : []).slice(0, 6)
    .filter(c => ADVISORS[c.id]).map(c => ({ id: c.id, text: clip(c.text, 600) }));
  const second = body.mode === 'second' && earlier.length > 0;

  let shape, plan;
  if (second) {
    plan = 'A NEW advisor (' + ids[0] + ') joins as a second opinion. Write ONE comment from ' + ids[0] + ' that reacts to the player\'s pick AND responds directly to what the earlier advisor said (agree on something, push back on something). 2–4 sentences.';
    shape = '{"comments":[{"id":"' + ids[0] + '","text":"..."}]}';
  } else if (ids.length === 2) {
    plan = 'Write a quick 4-line debate, in this exact order: (1) ' + ids[0] + ' reacts to the pick; (2) ' + ids[1] + ' reacts to the pick; (3) ' + ids[0] + ' responds directly to what ' + ids[1] + ' just said; (4) ' + ids[1] + ' responds directly to what ' + ids[0] + ' said. Lines 1–2: 2–3 sentences. Lines 3–4: 1–2 sentences, playful back-and-forth.';
    shape = '{"comments":[{"id":"' + ids[0] + '","text":"..."},{"id":"' + ids[1] + '","text":"..."},{"id":"' + ids[0] + '","text":"..."},{"id":"' + ids[1] + '","text":"..."}]}';
  } else {
    plan = 'Write ONE comment from ' + ids[0] + ' reacting to the pick. 2–3 sentences.';
    shape = '{"comments":[{"id":"' + ids[0] + '","text":"..."}]}';
  }

  // Advisors are NOT told the hidden answer — so they truly can't give it away.
  const system = [
    'You voice on-screen advisor characters in "The Decision Room," a decision game. The player has picked an answer but has NOT locked it in. The advisors react before the player decides "Are you sure?"',
    'Advisors:', ...Array.from(new Set(ids.concat(earlier.map(c => c.id)))).map(id => '- ' + id + ': ' + ADVISORS[id]),
    audienceRules(cat),
    'RULES:',
    '- Nobody knows the correct answer. Never claim the pick is right or wrong, and never reveal or hint at a final answer.',
    '- Across their lines, each advisor gives BOTH something that supports the pick AND a doubt or question to consider, in their own personality.',
    '- Punchy, fun, in character. Do not use the other options\' letters to steer the player. Stay neutral.',
    '- Do not end with "your turn" — the game adds that.',
    'PLAN: ' + plan,
    'Call the respond tool with: ' + shape
  ].join('\n');
  const user = 'SCENARIO: ' + h.title + '\n' + h.setup + '\nQUESTION: ' + h.question + '\nOPTIONS:\n' +
    h.options.map(o => o.id + ') ' + o.text).join('\n') + '\n\nPLAYER\'S PICK: ' + chosen.id + ') ' + chosen.text +
    (earlier.length ? '\n\nWHAT THE EARLIER ADVISOR(S) SAID:\n' + earlier.map(c => c.id + ': ' + c.text).join('\n') : '');
  const data = await claudeJSON(system, user, second ? 500 : 1200);
  const comments = (data.comments || []).filter(c => ADVISORS[c.id] && ids.includes(c.id))
    .slice(0, second || ids.length === 1 ? 1 : 4).map(c => ({ id: c.id, text: clip(c.text, 700) }));
  return { comments };
}

async function reveal(body) {
  const h = unseal(body.token);
  const cat = CATEGORIES[h.category];
  const choice = String(body.choice || '').toUpperCase();
  if (!h.options.find(o => o.id === choice)) throw new Error('Pick an option first');
  const order = h.options.filter(o => o.id !== choice).concat(h.options.filter(o => o.id === choice));

  const system = [
    'You write the reveal for "The Decision Room," a decision game. The ratings below are FINAL and LOCKED — never change them, never contradict them.',
    'CATEGORY: ' + cat.name + '. ' + cat.brief,
    audienceRules(cat),
    cat.style === 'story' ? 'This is a story category: describe story consequences of each path, and point to the clues that made the best path the smart one.' : 'Explain real-world reasoning: what tends to happen and why.',
    'For EACH option give: what could go right (2–3 bullets), what could go wrong (2–3 bullets), and "how it plays out" — a vivid mini-story of the outcome' + (cat.audience === 'kids' ? ' (3–4 short sentences)' : ' (4–6 sentences)') + '.',
    'Then a "takeaway": the big lesson in 2–3 sentences' + (cat.audience === 'kids' ? ', simple and kind.' : '.'),
    'Accurate facts only. No brands. Talk to the player as "you".',
    'Call the respond tool with: {"sections":[{"id":"A","right":["..."],"wrong":["..."],"playsOut":"..."}],"takeaway":"..."}'
  ].join('\n');
  const user = 'SCENARIO: ' + h.title + '\n' + h.setup + '\nQUESTION: ' + h.question + '\n\nOPTIONS WITH LOCKED RATINGS:\n' +
    h.options.map(o => o.id + ') ' + o.text + ' — ' + h.answers[o.id].rating + ' (reason: ' + h.answers[o.id].why + ')').join('\n') +
    '\n\nOVERALL VERDICT: ' + h.verdict + (h.realWorld ? '\nREAL WORLD NOTE: ' + h.realWorld : '') +
    '\n\nThe player chose ' + choice + '. Write sections in this order: ' + order.map(o => o.id).join(', ') + ' (player\'s choice last).';
  const data = await claudeJSON(system, user, 4000);
  const byId = {};
  (data.sections || []).forEach(s => { byId[String(s.id || '').toUpperCase()] = s; });
  const sections = order.map(o => {
    const s = byId[o.id] || {};
    return {
      id: o.id, text: o.text, rating: h.answers[o.id].rating, mine: o.id === choice,
      right: (Array.isArray(s.right) ? s.right : []).slice(0, 4).map(x => clip(x, 300)),
      wrong: (Array.isArray(s.wrong) ? s.wrong : []).slice(0, 4).map(x => clip(x, 300)),
      playsOut: clip(s.playsOut, 1400)
    };
  });
  return {
    sections, verdict: h.verdict, verdictType: h.verdictType, realWorld: h.realWorld, history: !!h.history,
    takeaway: clip(data.takeaway, 800), myRating: h.answers[choice].rating, disclaimer: cat.disclaimer || ''
  };
}

async function followup(body) {
  const h = unseal(body.token);
  const cat = CATEGORIES[h.category];
  const q = clip(body.question, 800).trim();
  if (!q) throw new Error('Type a question first');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
    .map(m => (m.role === 'user' ? 'PLAYER: ' : 'YOU: ') + clip(m.text, 1200)).join('\n');
  const system = [
    'You answer follow-up questions after a round of "The Decision Room." The outcome has been revealed, so you may discuss everything.',
    'CATEGORY: ' + cat.name + '. ' + audienceRules(cat),
    'Be accurate and friendly. 1–3 short paragraphs. If the question is unclear or you need a detail to answer correctly, ask ONE short clarifying question instead of guessing.',
    cat.disclaimer ? 'Keep it general and remind briefly when relevant: ' + cat.disclaimer : '',
    'Plain text only, no markdown headings.'
  ].join('\n');
  const user = 'ROUND: ' + h.title + '\n' + h.setup + '\nQUESTION: ' + h.question + '\nOPTIONS: ' +
    h.options.map(o => o.id + ') ' + o.text + ' [' + h.answers[o.id].rating + ']').join(' | ') +
    '\nVERDICT: ' + h.verdict + (h.realWorld ? '\nREAL WORLD: ' + h.realWorld : '') +
    '\nPlayer chose: ' + clip(body.choice, 2) + (history ? '\n\nCONVERSATION SO FAR:\n' + history : '') + '\n\nNEW QUESTION: ' + q;
  return { answer: clip(await claude(system, user, 900), 4000) };
}

// ---------- Handler ----------
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!hostAllowed(req)) return res.status(403).json({ error: 'This tool only runs on NuSpark sites.' });
  if (!(await underLimit(req))) return res.status(429).json({ error: "You've reached today's limit. Come back tomorrow!" });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  try {
    let out;
    if (body.action === 'scenario') out = await makeScenario(body);
    else if (body.action === 'advisors') out = await advisorTalk(body);
    else if (body.action === 'reveal') out = await reveal(body);
    else if (body.action === 'followup') out = await followup(body);
    else return res.status(400).json({ error: 'Unknown action' });
    return res.status(200).json(out);
  } catch (e) {
    const msg = /Unsupported state|auth|decipher/i.test(String(e.message)) ? 'That round expired. Start a new scenario.' : 'Something went wrong. Please try again.';
    console.error('decision-room error:', e.message);
    return res.status(500).json({ error: msg });
  }
};

module.exports._test = { seal, unseal, CATEGORIES, makeScenario, reveal, advisorTalk, followup };
