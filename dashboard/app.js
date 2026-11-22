// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, filters, a per-protocol detail
// drawer, and a model sandbox. No network: every byte it shows is in data.js.
//
// The model lives here in the open, so the page and the board can be checked
// against each other: impliedOf recomputes a row from the snapshot figures
// and the fitted multiples, and farmSteps derives the plan from the same
// category, chains, TVL and age main.ts used. No name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var FIT = DATA.fit;
  var BASE = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tvlFloor: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
    sandbox: { growthWeight: BASE.growth_weight, maturityFloor: BASE.maturity_floor, multScale: 1, oddsOn: true } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  function fmtMult(n) { return 'x' + n.toFixed(3); }
  function fmtOdds(n) { return (n * 100).toFixed(1) + '%'; }
  function fmtErr(n) { return 'x' + Math.exp(n).toFixed(1); }

  // The model in one function, mirroring lib/model.ts: the page recomputes a
  // row from the snapshot figures and the fitted multiples, so the page's
  // code and the board's data are visibly the same arithmetic. `over` lets
  // the sandbox change the constants; with no override it is the board.
  function impliedOf(row, over) {
    var o = over || {};
    var growthWeight = o.growthWeight !== undefined ? o.growthWeight : BASE.growth_weight;
    var maturityFloor = o.maturityFloor !== undefined ? o.maturityFloor : BASE.maturity_floor;
    var multScale = o.multScale !== undefined ? o.multScale : 1;
    var oddsOn = o.oddsOn !== undefined ? o.oddsOn : true;
    var multiple = (FIT.multiples[row.category || 'Other'] !== undefined ? FIT.multiples[row.category || 'Other'] : FIT.global_multiple) * multScale;
    var growth = Math.min(BASE.growth_cap, Math.max(BASE.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * growthWeight;
    var age = row.age_days === null || row.age_days === undefined ? BASE.unknown_age_days : row.age_days;
    var maturity = maturityFloor + (Math.min(Math.max(age, 0), BASE.maturity_days) / BASE.maturity_days) * BASE.maturity_range;
    var fdv = Math.max(1, row.tvl_usd * multiple * growthMult * maturity);
    if (!oddsOn) return { fdv: fdv, odds: 1, implied: Math.max(1, Math.round(fdv)), multiple: multiple, growthMult: growthMult, maturityMult: maturity };
    var share = FIT.token_shares[row.category || 'Other'] !== undefined ? FIT.token_shares[row.category || 'Other'] : FIT.global_token_share;
    var odds = Math.min(BASE.odds_cap, Math.max(BASE.odds_floor, share * Math.exp(-FIT.decay_lambda * age)));
    return { fdv: fdv, odds: odds, implied: Math.max(1, Math.round(fdv * odds)), multiple: multiple, growthMult: growthMult, maturityMult: maturity };
  }
  function sandboxActive() {
    var s = state.sandbox;
    return s.growthWeight !== BASE.growth_weight || s.maturityFloor !== BASE.maturity_floor || s.multScale !== 1 || s.oddsOn !== true;
  }
  function shownImplied(row) {
    return sandboxActive() ? impliedOf(row, state.sandbox).implied : row.implied_value_usd;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. Gas follows the protocol's main chain.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return { perTx: '$8', weekly: '$8' };
    if (c === 'bitcoin') return { perTx: '$4', weekly: '$4' };
    if (['solana', 'sui', 'aptos', 'sei', 'movement', 'near'].indexOf(c) >= 0) return { perTx: '$0.02', weekly: '$0.02' };
    if (['base', 'arbitrum', 'optimism', 'unichain', 'ink', 'blast', 'linea', 'scroll', 'zksync era', 'polygon', 'mantle', 'mode', 'fraxtal', 'berachain', 'monad', 'hyperliquid l1', 'plasma', 'abstract', 'soneium', 'world chain'].indexOf(c) >= 0) return { perTx: '$0.30', weekly: '$0.30' };
    return { perTx: '$2', weekly: '$2' };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('interest rate') >= 0) return 'Deposit $' + capital + " into " + name + "'s rate market on " + chain + ' and hold the position through one rate cycle.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + " and keep the shares; the vault is the protocol's own product.";
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it so the wallet counts as an active user.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s main yield strategy on " + chain + ' and let it compound.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s basis vault on " + chain + ' and hold it through one funding cycle.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds in its app.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' on a real payment, not a wash trade.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + "'s chain and use one of its native apps for a week.";
    if (c.indexOf('otc') >= 0) return 'Place one $' + capital + ' order through ' + name + "'s OTC desk on " + chain + '.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' and cast one vote through ' + name + "'s governance on " + chain + '.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline — never in a screenshot or a chat.', cost: 'about ' + gas.perTx + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital plus about ' + gas.perTx + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action each week — a deposit, a borrow, a swap, or a vote — so the activity spans several snapshots.', cost: 'about ' + gas.weekly + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days; snapshots usually reward wallets that stayed, not wallets that passed through.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; ignore airdrop links from search results or DMs.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log the wallet, the dates, and every transaction hash, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
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
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (r.tvl_usd < state.tvlFloor) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var sandbox = sandboxActive();
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else if (key === 'fdv') { av = a.fdv_usd; bv = b.fdv_usd; }
      else { av = sandbox ? impliedOf(a, state.sandbox).implied : a.implied_value_usd; bv = sandbox ? impliedOf(b, state.sandbox).implied : b.implied_value_usd; }
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
    var v = FIT.validation;
    return el('div', null,
      el('section', { class: 'lede' },
        el('h1', { text: 'Every pre-token protocol, ranked by the expected value of its launch' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The board adds every other rankable pre-token protocol — no cap, no hand-picked sample. Implied value is a fitted model, not a promise.' })
      ),
      el('div', { class: 'strip' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist protocol ranked' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Live comps fitted' }), el('b', { text: String(FIT.fit_protocols) }), el('small', { text: 'median mcap/TVL per category' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Leave-one-out check' }), el('b', { text: fmtErr(v.loo.median_log_error) }), el('small', { text: 'median held-out error, n=' + v.loo.n })),
        el('div', { class: 'kpi' }, el('span', { text: 'Time-split check' }), el('b', { text: fmtErr(v.time_split.median_log_error) }), el('small', { text: 'older half fits, newer half scored' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Launch half-life' }), el('b', { text: FIT.decay_half_life_days > 0 ? Math.round(FIT.decay_half_life_days) + 'd' : 'n/a' }), el('small', { text: 'odds halve per half-life with no token' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var floorSelect = el('select', { id: 'floor', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.tvlFloor) === o[0] ? 'selected' : null });
      })
    );
    floorSelect.addEventListener('change', function () { state.tvlFloor = Number(floorSelect.value); render(); });
    var watchCheck = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null });
    watchCheck.addEventListener('change', function () { state.watchlistOnly = watchCheck.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'floor', text: 'TVL floor' }), floorSelect),
      el('label', { class: 'check', for: 'watchlist' }, watchCheck, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
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

  function boardTable() {
    var list = sortedRows(rows());
    var sandbox = sandboxActive();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.tvlFloor = 0; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { max = Math.max(max, shownImplied(r)); });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var implied = shownImplied(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'watch', text: 'watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.fdv_usd) }),
        el('td', { class: 'num', text: fmtOdds(r.launch_odds) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(implied) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sandbox ? 'Sandbox active: implied values recomputed with your constants; board ranks unchanged. Select a row for its model and farm plan.' : 'Pre-token protocols, highest expected implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('fdv', 'Implied FDV'),
            sortHeader('odds', 'Launch odds'),
            sortHeader('implied', sandbox ? 'Implied (sandbox)' : 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd !== null && r.tvl_usd > 0 ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap/TVL ratios are the comps the model is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var v = FIT.validation;
    var c = DATA.counts;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one fitted function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The multiples and the odds are fitted from the snapshot at run time — change the snapshot and the model changes with it.' }),
      el('div', { class: 'formula' },
        'multiple   = median mcap/TVL of live-token peers in the category\n' +
        '             (shrunk toward the global median ' + fmtMult(FIT.global_multiple) + ' for thin categories)\n' +
        'FDV        = tvl_usd x multiple x (1 + clamp(change_7d, -60, 120) / 100 x ' + BASE.growth_weight + ')\n' +
        '             x (' + BASE.maturity_floor + ' + min(age_days, 1095) / 1095 x ' + BASE.maturity_range + ')\n' +
        'odds       = category token share x exp(-lambda x age_days), lambda fitted from the age bands\n' +
        'implied    = FDV x odds  (expected value of a launch)'
      ),
      el('p', { class: 'sub', text: 'Validation, held out twice on the ' + FIT.fit_protocols + ' live-token protocols the model is fitted on: leave-one-out median error ' + fmtErr(v.loo.median_log_error) + ' (' + Math.round(v.loo.within_3x * 100) + '% within 3x), older-to-newer time split ' + fmtErr(v.time_split.median_log_error) + ' (' + Math.round(v.time_split.within_3x * 100) + '% within 3x). The market itself is dispersed — live mcap/TVL spans three orders of magnitude — so treat every value as an order of magnitude, not a price.' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + c.protocols + ' protocols: ' + c.rankable + ' rankable pre-token rows on this board, ' + c.excluded + ' pre-token protocols left out as wrapped, staked or bridged products of a token that already trades, versioned pools or exchanges, and ' + c.live_recorded + ' that already record a token (' + c.live_with_mcap + ' with a market cap, fitted as comps).' })
    );
  }

  function sandboxPanel() {
    var s = state.sandbox;
    function slider(id, label, min, max, step, value, fmt, oninput) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      var out = el('output', { for: id, text: fmt(value) });
      input.addEventListener('input', function () { oninput(Number(input.value)); out.textContent = fmt(Number(input.value)); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), input, out);
    }
    var oddsCheck = el('input', { type: 'checkbox', id: 'odds-on', checked: s.oddsOn ? 'checked' : null });
    oddsCheck.addEventListener('change', function () { state.sandbox.oddsOn = oddsCheck.checked; render(); });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the board', onclick: function () { state.sandbox = { growthWeight: BASE.growth_weight, maturityFloor: BASE.maturity_floor, multScale: 1, oddsOn: true }; render(); } });
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Change the constants and the board re-sorts on the recomputed values. The fitted multiples and odds stay as fitted — only the weights move.' }),
      el('div', { class: 'sliders' },
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, s.growthWeight, function (v) { return v.toFixed(2); }, function (v) { state.sandbox.growthWeight = v; }),
        slider('sb-maturity', 'Maturity floor', 0, 1, 0.05, s.maturityFloor, function (v) { return v.toFixed(2); }, function (v) { state.sandbox.maturityFloor = v; }),
        slider('sb-mult', 'Multiple scale', 0.5, 2, 0.05, s.multScale, function (v) { return 'x' + v.toFixed(2); }, function (v) { state.sandbox.multScale = v; }),
        el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Launch odds' }), el('label', { class: 'check', for: 'odds-on' }, oddsCheck, 'Apply odds (off = FDV only)'))
      ),
      el('div', { class: 'note' }, reset, sandboxActive() ? el('span', { class: 'sub', text: ' Sandbox active — the Implied column shows recomputed values.' }) : null)
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var steps = farmSteps(row);
    var comps = DATA.comps[row.category || 'Other'] || [];
    var multN = FIT.multiple_counts[row.category || 'Other'] || 0;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' and ' + (row.chains.length - 4) + ' more' : '') : 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, step by step' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.multiple) + (multN > 0 ? ' (n=' + multN + ')' : ' (global)') })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → x' + row.growth_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → x' + row.maturity_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Implied FDV' }), el('b', { class: 'num', text: fmtUsd(row.fdv_usd) })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: fmtOdds(row.launch_odds) })),
        el('div', null, el('span', { text: 'Expected implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': FDV x odds. The page recomputes this row as ' + fmtUsd(recomputed.implied) + (recomputed.implied === row.implied_value_usd ? ', the same number board.json carries.' : ' — the board carries ' + fmtUsd(row.implied_value_usd) + '; the data would be stale.') + ' An estimate, not a price.' })
    ));
    var compBody = comps.length > 0
      ? el('table', { class: 'comps' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live-token peer' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
        el('tbody', null, comps.map(function (c) {
          return el('tr', null, el('td', { text: c.name }), el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }), el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }), el('td', { class: 'num', text: fmtMult(c.ratio) }));
        }))
      )
      : el('p', { class: 'sub', text: 'No live-token protocol in this category — the multiple falls back to the global median ' + fmtMult(FIT.global_multiple) + '.' });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Comps — the live-token peers the multiple comes from' }),
      compBody
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
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(sandboxPanel());
    }
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
