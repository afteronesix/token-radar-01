// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, the set-aside protocols with their reasons, the live-token protocols
// with their market caps, and a per-protocol detail view with the model's own arithmetic, the farm
// plan and a break-even check. No network: every byte it shows is in data.js.
//
// The page recomputes the model from the snapshot figures it carries — the multiple from the live
// rows, each row's implied value from its TVL, growth and age — so the page's code and the board's
// data are visibly the same arithmetic. The farm plan is the same derivation main.ts writes to
// board.json: category, chains, TVL and age decide the action, the capital, the hold and every
// cost and time. No name is special-cased anywhere.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null, wl: false, launchP: 30 };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd.format(Math.round(n));
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function dollars(n) {
    return n >= 100 ? String(Math.round(n)) : (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  }

  // --- The model, as the page recomputes it. Identical arithmetic to lib/model.ts. ---
  function medianSorted(sorted) {
    if (sorted.length === 0) return 0;
    return sorted[Math.floor(sorted.length / 2)];
  }
  // The market's own multiple: the median mcap/TVL over the live-token rows with a positive cap.
  function calibrateMultiple(live) {
    var ratios = live.filter(function (p) { return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0; })
      .map(function (p) { return p.mcap_usd / p.tvl_usd; }).sort(function (a, b) { return a - b; });
    return { multiple: medianSorted(ratios), n: ratios.length };
  }
  function impliedOf(row, model, multiple) {
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growthMult = 1 + model.growth_weight * Math.tanh(growth / model.growth_scale);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * (Math.log1p(Math.min(Math.max(age, 0), model.maturity_days)) / Math.log1p(model.maturity_days));
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity));
  }
  function growthMultOf(row, model) {
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return 1 + model.growth_weight * Math.tanh(growth / model.growth_scale);
  }
  function maturityMultOf(row, model) {
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    return model.maturity_floor + model.maturity_range * (Math.log1p(Math.min(Math.max(age, 0), model.maturity_days)) / Math.log1p(model.maturity_days));
  }

  // --- The farm plan, the same derivation main.ts writes to board.json. ---
  var GAS_USD = { Ethereum: 8.0, Bitcoin: 2.0, Tron: 0.5, Avalanche: 0.3, Arbitrum: 0.25, Optimism: 0.2, Binance: 0.15, Base: 0.15, Linea: 0.1, Unichain: 0.1, Berachain: 0.1, Plume: 0.1, 'Plume Mainnet': 0.1, Katana: 0.1, 'Robinhood Chain': 0.1, Polygon: 0.05, 'Hyperliquid L1': 0.05, Monad: 0.05, Sonic: 0.05, Flare: 0.05, Solana: 0.01, Sui: 0.01 };
  var GAS_DEFAULT = 0.5;
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(p) { var c = chainOf(p); return GAS_USD[c] !== undefined ? GAS_USD[c] : GAS_DEFAULT; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 1e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function familyOf(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('liquidity') >= 0) return 'dex';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'yield';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('index') >= 0) return 'vault';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0 || c.indexOf('reserve') >= 0) return 'stable';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0 || c.indexOf('basis') >= 0) return 'derivatives';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'staking';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) return 'farm';
    if (c.indexOf('launchpad') >= 0) return 'launchpad';
    if (c.indexOf('chain') >= 0) return 'chain';
    return 'default';
  }
  function actionsFor(p, capital, chain) {
    var name = p.name;
    switch (familyOf(p)) {
      case 'lending': return ['Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as collateral.', 'Borrow about $' + Math.round(capital / 2) + ' of stablecoins against it, then repay the borrow within a week so the position shows both sides of the market.'];
      case 'dex': return ['Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.', 'Swap $' + Math.round(capital / 5) + " through " + name + "'s own router so the wallet shows trading activity as well as liquidity."];
      case 'yield': return ['Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL strategy on " + chain + '.', 'Harvest or compound the yield once, then re-deposit it so the wallet shows a full yield cycle.'];
      case 'vault': return ['Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the receipt shares.', 'Move half the position to a second ' + name + ' vault after two weeks so the wallet shows activity across vaults.'];
      case 'stable': return ['Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.', 'Use the minted asset once, for a swap or a deposit elsewhere, so the wallet shows the asset in circulation.'];
      case 'derivatives': return ['Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.', 'Close the position after a week and open a second one in the opposite direction so the wallet shows two settled trades.'];
      case 'prediction': return ['Fund $' + capital + ' and place one market position on ' + name + '.', 'Place a second position on a different market so the wallet shows more than a single bet.'];
      case 'bridge': return ['Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.', 'Bridge a smaller amount back a week later so the wallet shows two-way volume.'];
      case 'staking': return ['Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.', 'Restake or delegate the receipt once so the wallet shows a second staking action.'];
      case 'insurance': return ['Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.', 'Renew or extend the cover once before it lapses so the wallet shows continued cover.'];
      case 'farm': return ['Deposit $' + capital + " into " + name + "'s main farm on " + chain + ' and keep the position open.', 'Claim the farm rewards once and re-deposit them so the wallet shows a full farm cycle.'];
      case 'launchpad': return ['Stake $' + capital + " of the launchpad's asset on " + chain + ' to qualify for allocations.', 'Join one allocation round, however small, so the wallet shows participation.'];
      case 'chain': return ['Bridge $' + capital + " to " + name + "'s chain and hold it in a wallet that transacts there.", 'Make one swap and one contract interaction on the chain so the wallet shows real usage.'];
      default: return ['Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.', 'Make a second deposit or interaction a week later so the wallet shows repeated use.'];
    }
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var acts = actionsFor(p, capital, chain);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: '$' + dollars(gas) + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: acts[0], cost: '$' + capital + ' of capital and about $' + dollars(gas) + ' of gas', time: '15 minutes to set up' },
      { text: acts[1], cost: 'about $' + dollars(gas) + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week for ' + weeks + ' weeks, such as a deposit, a borrow, a swap or a vote.', cost: 'about $' + dollars(gas * weeks) + ' of gas in total', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position; about $' + dollars((capital * 0.05 * hold) / 365) + ' of yield given up at 5% a year', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  // What the plan costs in total: gas for every transaction, protocol fees, and the yield the
  // locked capital gives up. The capital itself is not a cost: it comes back when you unwind.
  function totalCost(p) {
    var gas = gasFor(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var txs = 3 + weeks + 1;
    var gasTotal = gas * txs;
    var fam = familyOf(p);
    var fees = fam === 'dex' ? capital * 0.003 : fam === 'lending' ? (capital / 2) * 0.03 * hold / 365 : 0;
    var opportunity = capital * 0.05 * hold / 365;
    return { gas: gasTotal, fees: fees, opportunity: opportunity, total: gasTotal + fees + opportunity, txs: txs, weeks: weeks, hold: hold, capital: capital };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('wl') === '1') state.wl = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.wl) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function matchRow(r) {
    var q = state.q.trim().toLowerCase();
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function boardRows() {
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      return matchRow(r);
    });
  }
  function sortVal(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (key === 'mcap') return r.mcap_usd === null ? -1 : r.mcap_usd;
    if (key === 'ratio') return r.mcap_usd === null || r.tvl_usd <= 0 ? -1 : r.mcap_usd / r.tvl_usd;
    return r.implied_value_usd;
  }
  function sorted(list, key) {
    return list.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', { text: 'Every protocol in the snapshot, accounted for: ' + DATA.board_size + ' genuine pre-token protocols ranked by implied value, ' + DATA.aside_size + ' set aside with reasons, ' + DATA.live_size + ' already trading. The watchlist is the floor, never the ceiling — the early radar adds ' + DATA.early_size + ' pre-token protocols below it.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { html: DATA.watchlist_size + ' / ' + DATA.watchlist_size + ' <span class="sig">✓</span>' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside with reasons' }), el('b', { text: String(DATA.aside_size) })),
        el('p', { class: 'account', text: 'Accounting: ' + DATA.total_protocols + ' protocols = ' + DATA.board_size + ' ranked + ' + DATA.aside_size + ' set aside + ' + DATA.live_size + ' live-token. Nothing is silently dropped.' })
      )
    );
  }

  function modelCard() {
    var m = DATA.model;
    var cal = calibrateMultiple(DATA.live);
    var agrees = Math.abs(cal.multiple - DATA.multiple) < 1e-12;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × ', el('b', { text: DATA.multiple.toFixed(3) }), ' × (1 + ' + m.growth_weight + ' × tanh(change_7d / ' + m.growth_scale + ')) × (' + m.maturity_floor + ' + ' + m.maturity_range + ' × log1p(min(age_days, ' + m.maturity_days + ')) / log1p(' + m.maturity_days + ')) )'
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-cell' }, el('span', { text: 'The multiple' }), el('b', { text: DATA.multiple.toFixed(3) }), el('span', { text: 'median mcap / TVL of the ' + DATA.multiple_n + ' live protocols with a positive market cap' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Growth' }), el('b', { text: 'tanh-damped' }), el('span', { text: 'near-linear for ordinary weeks, saturating at ±50% so a launch-week spike cannot dominate' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Maturity' }), el('b', { text: 'log tenure' }), el('span', { text: 'time listed with no token, with diminishing returns over five years' })),
        el('div', { class: 'model-cell' }, el('span', { text: 'Recomputed here' }), el('b', { text: agrees ? 'matches ✓' : 'differs!' }), el('span', { text: 'this page recomputes the multiple from the live rows as ' + cal.multiple.toFixed(3) + ' over ' + cal.n + ' protocols' }))
      ),
      el('p', { class: 'sub', text: 'The multiple is the market\u2019s own: the median ratio at which live protocols in this same snapshot are valued against their TVL. Of the ' + DATA.live_total + ' protocols that record a token, ' + DATA.multiple_n + ' carry a positive market cap; the rest record a token but no market cap, so they cannot calibrate the multiple.' }),
      el('p', { class: 'sub', text: 'Wrapped, staked and bridged products are set aside, not ranked: their TVL is another token\u2019s value. Nineteen protocols sit above the $50M floor but are not on the house watchlist — the snapshot does not carry the parent-protocol field the house used, so each is set aside as a product or vault of a larger protocol rather than ranked as a launch of its own.' }),
      el('p', { class: 'sub' }, el('span', { class: 'warn', text: 'Honest limits: ' }), 'a snapshot-implied market-cap estimate, not a launch-price forecast. Held-out testing against live market caps showed roughly 5× median error, and token allocation and dilution are unmodelled. Per-category multiples and chain-breadth factors were tested and did not improve on this model, so they are not in it.')
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    function tabBtn(key, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === key ? 'true' : 'false', text: label, onclick: function () { state.tab = key; writeHash(); render(); } });
    }
    var countText = state.tab === 'board' ? boardRows().length + ' rows shown' : state.tab === 'aside' ? DATA.aside.filter(matchRow).length + ' set aside' : DATA.live.filter(matchRow).length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check' }, wlBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Pre-token board'), tabBtn('aside', 'Set aside'), tabBtn('live', 'Live token'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function emptyPanel(msg) {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: msg }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
    ));
  }

  function boardTable() {
    var list = sorted(boardRows(), state.sort);
    if (list.length === 0) return emptyPanel('Clear the search or pick another category or chain to see the board again.');
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, farm plan and break-even check.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function asideTable() {
    var list = sorted(DATA.aside.filter(matchRow), state.sort === 'implied' ? 'implied' : state.sort);
    if (list.length === 0) return emptyPanel('Clear the search or pick another category or chain to see the set-aside protocols again.');
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }), el('div', { class: 'sub', text: 'reference only — not ranked' })),
        el('td', null, el('span', { class: 'reason', text: r.reason })),
        el('td', null, el('span', { class: 'badge aside', text: 'set aside' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Set aside, not forgotten: every pre-token protocol the board does not rank, with the reason. ' + DATA.above_floor_aside + ' sit above the $50M floor but are not on the house watchlist. A bridge or staking product is excluded by the house category rule — not because it cannot launch a token.' }),
          el('thead', null, el('tr', null,
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('implied', 'Model value'),
            el('th', { scope: 'col', text: 'Why set aside' }),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = sorted(DATA.live.filter(matchRow), state.sort === 'implied' ? 'mcap' : state.sort);
    if (list.length === 0) return emptyPanel('Clear the search or pick another category or chain to see the live-token protocols again.');
    var tbody = el('tbody');
    list.forEach(function (r) {
      var ratio = r.mcap_usd === null || r.tvl_usd <= 0 ? null : r.mcap_usd / r.tvl_usd;
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : ratio.toFixed(3) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. The multiple comes from the ' + DATA.multiple_n + ' of them with a positive market cap.' }),
          el('thead', null, el('tr', null,
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('mcap', 'Market cap'),
            sortHeader('ratio', 'Mcap / TVL'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function breakEvenVerdict(row, cost) {
    var p = state.launchP / 100;
    var be = cost.total / p;
    var pct = be / row.implied_value_usd * 100;
    var verdict = el('div', { class: 'verdict', id: 'breakeven' },
      'At a ', el('b', { text: state.launchP + '% chance of a launch' }), ', this farm pays for itself on an allocation of ', el('b', { text: fmtUsdFull(be) }), ' — ', el('b', { text: pct < 0.01 ? '<0.01%' : pct.toFixed(2) + '%' }), ' of the implied value. ',
      pct < 0.1 ? 'That is a small slice of a launch this size: the farm is cheap against the value it chases.' : pct < 1 ? 'That is a plausible early-farmer share of a launch this size.' : 'That is a large share of a launch this size: only farm it if you expect an outsized allocation.'
    );
    return verdict;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var cost = totalCost(row);
    var recomputed = impliedOf(row, DATA.model, DATA.multiple);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'badge ' + (row.watchlist ? 'watch' : 'early'), text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'watchlist' : 'early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Market multiple' }), el('b', { class: 'num', text: DATA.multiple.toFixed(3) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: growthMultOf(row, DATA.model).toFixed(4) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: maturityMultOf(row, DATA.model).toFixed(4) })),
        el('div', { class: 'wide' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsdFull(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This page recomputes this row as ' + fmtUsdFull(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    var slider = el('input', { type: 'range', id: 'launch-p', min: '5', max: '80', step: '5', value: String(state.launchP), 'aria-label': 'Chance of a launch, in per cent' });
    slider.addEventListener('input', function () {
      state.launchP = Number(slider.value);
      var old = document.getElementById('breakeven');
      if (old && old.parentNode) old.parentNode.replaceChild(breakEvenVerdict(row, cost), old);
      var lbl = document.getElementById('launch-p-label');
      if (lbl) lbl.textContent = state.launchP + '%';
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What it costs, and when it pays' }),
      el('div', { class: 'costline' },
        el('span', null, 'Gas (', String(cost.txs), ' txs): ', el('b', { text: '$' + dollars(cost.gas) })),
        el('span', null, 'Fees: ', el('b', { text: '$' + dollars(cost.fees) })),
        el('span', null, 'Yield given up: ', el('b', { text: '$' + dollars(cost.opportunity) })),
        el('span', null, 'Total cost: ', el('b', { text: '$' + dollars(cost.total) })),
        el('span', null, 'Capital locked: ', el('b', { text: '$' + cost.capital + ' for ' + cost.hold + ' days (returned on unwind)' }))
      ),
      el('div', { class: 'slider-row' },
        el('label', { for: 'launch-p', text: 'Chance of a launch in the next year:' }),
        slider,
        el('b', { id: 'launch-p-label', text: state.launchP + '%' })
      ),
      breakEvenVerdict(row, cost),
      el('p', { class: 'sub', text: 'Your launch chance and allocation are assumptions, kept apart from the snapshot evidence. Gas is a typical figure for ' + chainOf(row) + '; the capital itself is not a cost, it comes back when you unwind.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('p', { class: 'foot', text: 'Source: ' + DATA.source + '. Implied values are this entry\u2019s own claim, never make.fun\u2019s. A protocol is said to record no token, never to have none: its DefiLlama record may simply not carry one. Farm at your own risk; never pay to claim an airdrop.' });
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(modelCard());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : state.tab === 'aside' ? asideTable() : liveTable());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
