// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the
// model's own inputs and the protocol's farm plan, and the live-token view set aside from
// the ranking. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. Square root of TVL is the log-scale term.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? null : row.age_days;
    var maturity = age === null ? model.unknown_age_factor : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + model.chain_step * Math.min(Math.max(chains - 1, 0), model.chain_max_extra);
    var cat = categoryTier(row.category, model);
    return Math.max(1, Math.round(model.scale * Math.sqrt(row.tvl_usd) * growthMult * maturity * chainMult * cat.multiplier));
  }
  function categoryTier(category, model) {
    var c = (category || '').toLowerCase();
    if (c === 'bridge' || c === 'canonical bridge' || c === 'cross chain bridge' || c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c === 'restaking' || c === 'staking pool' || c === 'cex') return { tier: 'pass-through', multiplier: model.tier_pass };
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('dex') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('risk curator') >= 0 || c.indexOf('capital allocator') >= 0 || c.indexOf('collateral market') >= 0) return { tier: 'fee-capturing', multiplier: model.tier_fee };
    if (c.indexOf('yield') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('rwa') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0 || c === 'farm' || c.indexOf('index') >= 0 || c.indexOf('launchpad') >= 0 || c.indexOf('prediction') >= 0 || c.indexOf('token locker') >= 0) return { tier: 'yield-bearing', multiplier: model.tier_yield };
    return { tier: 'other', multiplier: model.tier_other };
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function coreAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $25 against it so both sides of the position are active.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $25 of USDC for the pool\u2019s other asset on ' + name + ', then provide $' + capital + ' of liquidity to its main pool on ' + chain + '.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('capital allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the vault shares for the whole season.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\u2019s highest-TVL vault on ' + chain + ' and enable auto-compounding if it offers it.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\u2019s basis vault on ' + chain + ' and check the funding rate once a week.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + '\u2019s yield-bearing asset on ' + chain + ' and hold it in the same wallet for the full term.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position, no more than 2x leverage.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in one app on the destination chain.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain\u2019s staking asset through ' + name + ' on ' + chain + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('launchpad') >= 0) return 'Stake $' + capital + ' of the launchpad\u2019s required asset on ' + name + ' and join one token sale with the minimum ticket.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one market position, then leave the position open until it resolves.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\u2019s managed range on ' + chain + ' and let it rebalance for the season.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the whole cover period.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay $10 of the borrow and borrow it again the next day, so the loan book shows repeat activity.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $10 back and forth through ' + name + '\u2019s router on ' + chain + ' once, paying the pool fee rather than routing elsewhere.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('capital allocator') >= 0) return 'Allocate a second $25 deposit to a different ' + name + ' vault on ' + chain + ' so two vaults carry your wallet.';
    if (c.indexOf('yield') >= 0 || c.indexOf('basis trading') >= 0) return 'Claim the vault\u2019s yield once, then redeposit the claim into the same vault instead of withdrawing it.';
    if (c.indexOf('rwa') >= 0) return 'Subscribe to a second ' + name + ' issuance with $25 on ' + chain + ' and hold both positions to maturity.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Close the hedge and open a fresh one the following week, keeping the margin balance above $' + capital + '.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $25 back to the origin chain through ' + name + ' so the round trip is recorded on both sides.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the staking rewards once instead of claiming them, so the stake compounds in the same wallet.';
    if (c.indexOf('launchpad') >= 0) return 'Vote in one ' + name + ' governance poll or community round with the staked position.';
    if (c.indexOf('prediction') >= 0) return 'Place a second $10 position on a different ' + name + ' market and hold it to resolution.';
    return 'Use ' + name + '\u2019s second feature once, such as its rewards page or a vote, with the same wallet.';
  }
  function weeklyAction(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Once a week, top up the supply by $10 or adjust the borrow so the position moves every week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Once a week, make one swap of at least $10 through ' + name + ' so the router sees weekly volume.';
    if (c.indexOf('bridge') >= 0) return 'Once a month, bridge at least $25 through ' + name + ' again rather than using another bridge.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Once a month, check the staking rewards on ' + name + ' and restake them instead of claiming.';
    if (c.indexOf('prediction') >= 0) return 'Once a week, settle or place one new ' + name + ' market position while the season runs.';
    return 'Once a week, make one qualifying action on ' + name + ', such as a deposit, a claim, a swap or a vote.';
  }
  function gasNote(p) {
    var chain = chainOf(p);
    var cheap = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BNB Chain', 'Sui', 'Aptos', 'zkSync Era', 'Scroll', 'Linea', 'Blast', 'Mode', 'World Chain'];
    if (cheap.indexOf(chain) >= 0) return 'about $0.50 of gas on ' + chain;
    if (chain === 'Ethereum') return 'about $6 of gas on Ethereum mainnet, so batch the setup into one session';
    return 'about $2 of gas on ' + chain;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasNote(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: coreAction(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondAction(p, capital, chain), cost: 'about $25 of capital moved and $2 of gas', time: '10 minutes' },
      { text: weeklyAction(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes; never pay a fee to claim.', cost: 'no fee to check', time: '10 minutes' }
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
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = a.chains ? a.chains.length : 0; bv = b.chains ? b.chains.length : 0; }
      else if (key === 'mcap') { av = a.mcap_usd === null ? -Infinity : a.mcap_usd; bv = b.mcap_usd === null ? -Infinity : b.mcap_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortButton(key, label) {
    var arrow = state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null;
    return el('button', {
      type: 'button',
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); }
    }, label, arrow);
  }

  function tierBadge(row) {
    var cat = categoryTier(row.category, DATA.model);
    var cls = cat.tier === 'fee-capturing' ? 'tier fee' : cat.tier === 'pass-through' ? 'tier pass' : 'tier';
    return el('span', { class: cls, text: cat.tier });
  }

  function renderHead() {
    var thead = document.querySelector('#board-table thead');
    thead.textContent = '';
    var cells;
    if (state.tab === 'pre-token') {
      cells = [
        el('th', { scope: 'col' }, sortButton('implied', 'Rank')),
        el('th', { scope: 'col' }, sortButton('name', 'Protocol')),
        el('th', { scope: 'col' }, sortButton('tvl', 'TVL')),
        el('th', { scope: 'col' }, sortButton('growth', '7d')),
        el('th', { scope: 'col' }, sortButton('age', 'Age')),
        el('th', { scope: 'col' }, sortButton('chains', 'Chains')),
        el('th', { scope: 'col' }, sortButton('implied', 'Implied value')),
        el('th', { scope: 'col', text: 'Token' })
      ];
    } else {
      cells = [
        el('th', { scope: 'col', text: 'Status' }),
        el('th', { scope: 'col' }, sortButton('name', 'Protocol')),
        el('th', { scope: 'col' }, sortButton('tvl', 'TVL')),
        el('th', { scope: 'col' }, sortButton('growth', '7d')),
        el('th', { scope: 'col' }, sortButton('mcap', 'Market cap')),
        el('th', { scope: 'col' }, sortButton('chains', 'Chains')),
        el('th', { scope: 'col', text: 'Token' })
      ];
    }
    thead.appendChild(el('tr', null, cells));
  }

  function renderBody() {
    var tbody = document.getElementById('board-body');
    var empty = document.getElementById('empty');
    tbody.textContent = '';
    if (state.tab === 'pre-token') {
      var list = sortedRows(filteredRows());
      document.getElementById('board-caption').textContent = 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.';
      document.getElementById('count').textContent = list.length + ' rows shown';
      empty.hidden = list.length !== 0;
      var max = list.length ? (list[0].implied_value_usd || 1) : 1;
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
          el('td', { class: 'num', text: String(r.chains ? r.chains.length : 0) }),
          el('td', null, el('div', { class: 'implied' },
            el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          )),
          el('td', null, el('span', { class: 'status', text: 'no token' }), ' ', tierBadge(r))
        );
        tbody.appendChild(tr);
      });
    } else {
      var live = sortedRows(DATA.live.slice());
      document.getElementById('board-caption').textContent = 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
      document.getElementById('count').textContent = live.length + ' live-token protocols';
      empty.hidden = true;
      live.forEach(function (r) {
        tbody.appendChild(el('tr', null,
          el('td', { class: 'num', text: 'live' }),
          el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: String(r.chains ? r.chains.length : 0) }),
          el('td', null, el('span', { class: 'status live', text: 'already trades' }))
        ));
      });
    }
  }

  var dialog = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    detailBody.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var cat = categoryTier(row.category, DATA.model);
    detailBody.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + cat.tier }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    detailBody.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (√ scale)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → ×' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → ×' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains ? row.chains.length : 0) + ')' }), el('b', { class: 'num', text: '×' + row.chain_multiplier })),
        el('div', null, el('span', { text: 'Category tier (' + cat.tier + ')' }), el('b', { class: 'num', text: '×' + row.category_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    detailBody.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 6 steps' }),
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

  function renderStatic() {
    document.getElementById('top-meta').innerHTML = '';
    var meta = document.getElementById('top-meta');
    meta.appendChild(el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })));
    meta.appendChild(el('span', null, 'DefiLlama protocol index'));
    meta.appendChild(el('span', null, el('b', { text: DATA.model_version }), ' model'));
    document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('lede-text').textContent = 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, and the live-token protocols are set aside with their market caps shown. The board is sorted by implied value; sort any column to re-rank it.';
    var facts = document.getElementById('facts');
    facts.textContent = '';
    facts.appendChild(el('div', { class: 'fact' }, el('dt', { text: 'Watchlist covered' }), el('dd', null, el('em', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }))));
    facts.appendChild(el('div', { class: 'fact' }, el('dt', { text: 'Pre-token rows scored' }), el('dd', { text: String(DATA.board_size) })));
    facts.appendChild(el('div', { class: 'fact' }, el('dt', { text: 'Early rows below the floor' }), el('dd', { text: String(DATA.early_size) })));
    facts.appendChild(el('div', { class: 'fact' }, el('dt', { text: 'Live-token protocols set aside' }), el('dd', { text: String(DATA.live_size) })));
    var m = DATA.model;
    document.getElementById('formula').innerHTML = '';
    var formula = document.getElementById('formula');
    formula.appendChild(el('div', null, el('b', { text: 'implied = round( ' + m.scale + ' × √(tvl_usd) × growth × maturity × chains × category )' })));
    formula.appendChild(el('div', null, 'growth   = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + '   (0.70 – 1.60)'));
    formula.appendChild(el('div', null, 'maturity = ' + m.maturity_floor + ' + 0.30 × min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + '   (0.70 – 1.00; age unknown: ×' + m.unknown_age_factor + ')'));
    formula.appendChild(el('div', null, 'chains   = 1 + ' + m.chain_step + ' × min(chains − 1, ' + m.chain_max_extra + ')   (1.00 – 1.20)'));
    formula.appendChild(el('div', null, 'category = fee-capturing ×' + m.tier_fee + ' · yield-bearing ×' + m.tier_yield + ' · pass-through ×' + m.tier_pass + ' · other ×' + m.tier_other));
    document.getElementById('model-notes').textContent = 'TVL enters as a square root, so a protocol ten times larger in TVL is worth about three times more, not ten times more. Growth rewards a rising TVL and punishes a falling one; maturity rewards a long run with no token; chain breadth rewards being live on more chains; the category tier separates businesses whose token can capture fees from pass-through plumbing (bridges, staking wrappers) whose token captures little. Centralised exchanges, versioned pools and wrapped or staked products never rank.';
    document.getElementById('foot-asof').textContent = DATA.as_of;
  }

  function renderControls() {
    var select = document.getElementById('category');
    if (select.options.length === 0) {
      var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
      select.appendChild(el('option', { value: 'all', text: 'All categories' }));
      categories.forEach(function (c) { select.appendChild(el('option', { value: c, text: c })); });
      select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
      var search = document.getElementById('q');
      search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
      document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; render(); });
      document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; render(); });
      document.getElementById('clear-filters').addEventListener('click', function () { state.q = ''; state.category = 'all'; writeHash(); render(); });
    }
    select.value = state.category;
    document.getElementById('q').value = state.q;
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function render() {
    renderStatic();
    renderControls();
    renderHead();
    renderBody();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  // A hash change is a new view, not a page reload: re-read the state, close a detail
  // view the new hash no longer names, and render the filtered board it asks for.
  window.addEventListener('hashchange', function () {
    var hadDetail = dialog.open;
    state.q = '';
    state.category = 'all';
    state.tab = 'pre-token';
    state.selected = null;
    readHash();
    if (hadDetail && !state.selected) dialog.close();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
