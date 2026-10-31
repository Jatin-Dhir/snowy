// Draws a shared trip from the address alone (src/lib/tripLink.ts writes it). Whatever is
// in the link is someone's typing, and this page shares an origin with Taily's web app:
// it only ever goes on the page as text, and colours are checked before they're used.
;(function () {
  'use strict'

  var COLORS = ['#E0784F', '#5FA463', '#C29A3A', '#6C7FE0', '#4FA3C7', '#B0764A', '#C75D8D', '#9A6FD0', '#4FAF9B', '#B65C50', '#4D82F3', '#7A8794']
  // the web app beside this page: Taily's Play listing is a dead page until the app goes public.
  // On launch day: https://play.google.com/store/apps/details?id=com.jatindhir.taily
  var GET_TAILY = './'

  function decode(hash) {
    var b64 = hash.replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/')
    var bin = atob(b64)
    var bytes = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }

  var int = function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v
  }
  var str = function (v) {
    return typeof v === 'string'
  }
  var iso = function (v) {
    return str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)
  }
  var color = function (v) {
    return str(v) && /^#[0-9a-fA-F]{6}$/.test(v)
  }
  var list = Array.isArray

  /** The whole shape or nothing: a damaged link says so rather than showing wrong money. */
  function valid(d) {
    if (!d || d.v !== 1 || !str(d.n) || !/^[A-Za-z]{3}$/.test(d.c) || !iso(d.s) || !int(d.a) || !int(d.t) || !int(d.m)) return false
    if (!(d.e === null || iso(d.e)) || !(d.b === null || int(d.b))) return false
    if (!list(d.p) || !list(d.x) || !list(d.g) || !list(d.l) || d.p.length === 0) return false
    var who = function (i) {
      return int(i) && i >= 0 && i < d.p.length
    }
    return (
      d.p.every(function (p) {
        return list(p) && str(p[0]) && int(p[1]) && int(p[2]) && int(p[3])
      }) &&
      d.x.every(function (x) {
        return list(x) && who(x[0]) && who(x[1]) && int(x[2])
      }) &&
      d.g.every(function (g) {
        return list(g) && str(g[0]) && color(g[1]) && int(g[2])
      }) &&
      d.l.every(function (l) {
        return list(l) && int(l[0]) && str(l[1]) && int(l[2]) && who(l[3]) && int(l[4]) && int(l[5])
      })
    )
  }

  function money(minor, currency) {
    var code = currency.toUpperCase()
    var abs = Math.abs(minor)
    var fraction = abs % 100 !== 0 ? 2 : 0
    var out
    try {
      out = new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction
      }).format(abs / 100)
    } catch (e) {
      out = code + ' ' + (abs / 100).toFixed(fraction)
    }
    return (minor < 0 ? '−' : '') + out
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  function dateOf(startISO, offset) {
    var parts = startISO.split('-').map(Number)
    return new Date(parts[0], parts[1] - 1, parts[2] + offset)
  }
  function shortDate(d) {
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short' })
  }

  /** The same name gets the same colour here as in the app. */
  function personColor(name) {
    var h = 0
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
    return COLORS[Math.abs(h) % COLORS.length]
  }
  function tile(name) {
    var c = personColor(name)
    var t = el('span', 'tile', (name.trim()[0] || '?').toUpperCase())
    t.style.background = c + '26'
    t.style.color = c
    t.setAttribute('aria-hidden', 'true')
    return t
  }

  function bar(fraction, background) {
    var track = el('div', 'track')
    var fill = el('div', 'fill')
    fill.style.width = Math.max(0, Math.min(100, fraction * 100)) + '%'
    fill.style.background = background
    track.appendChild(fill)
    return track
  }

  function card(label) {
    var c = el('section', 'card')
    c.appendChild(el('h2', 'label', label))
    return c
  }

  function draw(d, root) {
    var names = d.p.map(function (p) {
      return p[0]
    })
    var ended = d.e !== null
    document.title = d.n + ' on Taily'

    var brand = el('p', 'brand')
    var logo = el('img')
    logo.src = 'icons/icon-192.png'
    logo.alt = ''
    logo.width = 28
    logo.height = 28
    brand.appendChild(logo)
    brand.appendChild(document.createTextNode('Taily'))
    root.appendChild(brand)

    var head = el('header')
    head.appendChild(el('h1', '', d.n))
    var dates = shortDate(dateOf(d.s, 0)) + (ended && d.e !== d.s ? ' to ' + shortDate(dateOf(d.e, 0)) : ended ? '' : ' onwards')
    head.appendChild(el('p', 'sub', dates + ' · ' + names.length + ' people'))
    root.appendChild(head)

    var hero = el('div', 'hero')
    hero.appendChild(el('h2', 'label', ended ? 'Spent by everyone' : 'Spent so far'))
    hero.appendChild(el('span', 'num', money(d.t, d.c)))
    if (d.b !== null) {
      var left = d.b - d.t
      hero.appendChild(bar(d.b > 0 ? d.t / d.b : 0, left < 0 ? 'var(--red)' : 'var(--pos)'))
      hero.appendChild(
        el(
          'span',
          left < 0 ? 'caption over' : 'caption',
          left < 0 ? money(-left, d.c) + ' over the ' + money(d.b, d.c) + ' budget' : money(left, d.c) + ' left of ' + money(d.b, d.c)
        )
      )
    }
    root.appendChild(hero)

    var pays = card('Who pays whom')
    if (d.x.length === 0) pays.appendChild(el('p', 'square-note', 'All square. Nobody owes anybody.'))
    d.x.forEach(function (x) {
      var row = el('div', 'row')
      row.appendChild(tile(names[x[0]]))
      var main = el('div', 'main')
      main.appendChild(el('span', 'title', names[x[0]] + ' pays ' + names[x[1]]))
      row.appendChild(main)
      row.appendChild(el('span', 'amount', money(x[2], d.c)))
      pays.appendChild(row)
    })
    root.appendChild(pays)

    var everyone = card('Everyone')
    d.p.forEach(function (p) {
      var row = el('div', 'row')
      row.appendChild(tile(p[0]))
      var main = el('div', 'main')
      main.appendChild(el('span', 'title', p[0]))
      // money handed over outside any spend, so the line adds up to the number beside it
      var moved = p[3] - (p[1] - p[2])
      var movedText = moved >= 50 ? ' · gave ' + money(moved, d.c) : moved <= -50 ? ' · got ' + money(-moved, d.c) : ''
      main.appendChild(el('span', 'small', 'paid ' + money(p[1], d.c) + ' · share ' + money(p[2], d.c) + movedText))
      row.appendChild(main)
      var net = p[3]
      var square = Math.abs(net) < 50
      row.appendChild(el('span', 'amount ' + (square ? 'square' : net > 0 ? 'get' : 'owe'), square ? 'Square' : (net > 0 ? '+' : '−') + money(Math.abs(net), d.c)))
      everyone.appendChild(row)
    })
    root.appendChild(everyone)

    if (d.g.length > 0) {
      var where = card('Where it went')
      d.g.forEach(function (g) {
        var tag = el('div', 'tag')
        var row = el('div', 'row')
        var dot = el('span', 'dot')
        dot.style.background = g[1]
        row.appendChild(dot)
        var name = el('span', 'title', g[0])
        name.style.flex = '1'
        row.appendChild(name)
        row.appendChild(el('span', 'amount', money(g[2], d.c)))
        tag.appendChild(row)
        tag.appendChild(bar(d.t > 0 ? g[2] / d.t : 0, g[1]))
        where.appendChild(tag)
      })
      root.appendChild(where)
    }

    if (d.l.length > 0) {
      var spends = card('Every spend')
      var lastDay = null
      d.l.forEach(function (l) {
        if (l[0] !== lastDay) {
          lastDay = l[0]
          spends.appendChild(el('p', 'day', dateOf(d.s, l[0]).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })))
        }
        var row = el('div', 'row')
        var tag = l[5] >= 0 ? d.g[l[5]] : undefined
        var dot = el('span', 'dot')
        dot.style.background = tag ? tag[1] : '#7A8794'
        row.appendChild(dot)
        var main = el('div', 'main')
        main.appendChild(el('span', 'title', l[1]))
        var split = l[4] === names.length ? 'split ' + l[4] : l[4] === 1 ? 'for one person' : 'split ' + l[4] + ' of ' + names.length
        // the dot alone wouldn't say where it went
        main.appendChild(el('span', 'small', names[l[3]] + ' paid · ' + split + (tag && tag[0] !== l[1] ? ' · ' + tag[0] : '')))
        row.appendChild(main)
        row.appendChild(el('span', 'amount', money(l[2], d.c)))
        spends.appendChild(row)
      })
      if (d.m > 0) spends.appendChild(el('p', 'small', 'And ' + d.m + ' earlier ' + (d.m === 1 ? 'spend' : 'spends') + ', counted in the totals above.'))
      root.appendChild(spends)
    }

    var foot = el('footer')
    var asOf = new Date(d.a).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    foot.appendChild(el('p', '', 'This is the trip as of ' + asOf + '. A newer link shows anything added since. It isn’t stored on any server: everything here is inside the link.'))
    var app = el('a', 'get-app', 'Split your own trips with Taily, free')
    app.href = GET_TAILY
    foot.appendChild(app)
    root.appendChild(foot)
    root.hidden = false
  }

  var data = null
  try {
    data = decode(location.hash)
  } catch (e) {
    data = null
  }
  if (valid(data)) draw(data, document.getElementById('trip'))
  else document.getElementById('broken').hidden = false

  // another trip's link opened in this same tab
  window.addEventListener('hashchange', function () {
    location.reload()
  })
})()
