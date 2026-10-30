/* Offline address and intersection search for the citywide precinct pages. Generated data, hand-written reader.
   window.AddrSearch.suggest(query, limit = 8) -> Promise<[{ label, lon, lat, pct, kind: "address"|"intersection", note? }]>
   Loads streets.json (next to this script) on the first call and s/<shard>.json files on demand. No network service:
   only files from this folder are fetched. Street-name normalisation mirrors build/geo_names.py (keep the two in step);
   it is ported from midtown-categories/index.html. */
(function (root) {
  "use strict";
  var BASE = (function () {
    try {
      var cs = typeof document !== "undefined" && document.currentScript;
      if (cs && cs.src) return cs.src.replace(/[^\/]*(\?.*)?$/, "");
    } catch (e) {}
    return root.ADDR_SEARCH_BASE || "data/addr/";
  })();

  var SYN = { W:"WEST", E:"EAST", N:"NORTH", S:"SOUTH", ST:"STREET", STR:"STREET", STS:"STREET",
    AVE:"AVENUE", AV:"AVENUE", AVES:"AVENUE", AVN:"AVENUE", AVENU:"AVENUE",
    BWAY:"BROADWAY", BDWY:"BROADWAY", BRDWY:"BROADWAY", BRDWAY:"BROADWAY",
    SQ:"SQUARE", PL:"PLACE", PLZ:"PLAZA", PLZA:"PLAZA", CIR:"CIRCLE", LEX:"LEXINGTON",
    CTR:"CENTER", CNTR:"CENTER", CENTRE:"CENTER", STA:"STATION", STN:"STATION", TERM:"TERMINAL",
    RD:"ROAD", DR:"DRIVE", BLVD:"BOULEVARD", BLV:"BOULEVARD", BL:"BOULEVARD",
    PKWY:"PARKWAY", PKY:"PARKWAY", PY:"PARKWAY", PARKWY:"PARKWAY",
    EXPY:"EXPRESSWAY", EXPWY:"EXPRESSWAY", EXWY:"EXPRESSWAY", EXPRESSWY:"EXPRESSWAY",
    TPKE:"TURNPIKE", TPK:"TURNPIKE", HWY:"HIGHWAY", LN:"LANE", CT:"COURT", CRT:"COURT",
    TER:"TERRACE", TERR:"TERRACE", BCH:"BEACH", CONC:"CONCOURSE", MT:"MOUNT", FT:"FORT",
    BRG:"BRIDGE", BRDG:"BRIDGE", TUNL:"TUNNEL", XING:"CROSSING", CRES:"CRESCENT",
    ALY:"ALLEY", GDNS:"GARDENS", HTS:"HEIGHTS", PT:"POINT", EST:"ESTATES",
    EXT:"EXTENSION", EXTE:"EXTENSION", EXTN:"EXTENSION",
    FIRST:"1", SECOND:"2", THIRD:"3", FOURTH:"4", FIFTH:"5", SIXTH:"6", SEVENTH:"7",
    EIGHTH:"8", NINTH:"9", TENTH:"10", ELEVENTH:"11", TWELFTH:"12" };
  var DIRS = { WEST:1, EAST:1, NORTH:1, SOUTH:1 };
  var GENERIC = { STREET:1, AVENUE:1 };
  var BOROS = ["Manhattan", "Bronx", "Brooklyn", "Queens", "Staten Island"];
  /* Ranking when a query fits streets in several boroughs and names no borough: best name fit first (a typed
     direction such as "W 44" only fits West 44th St); among equal fits Manhattan first, then the other boroughs by
     how many tax lots with an address the street has there. */
  function countOf(i, b) {
    var loc = IDX.loc[i];
    for (var k = 0; k < loc.length; k += 3) if (loc[k] === b) return loc[k + 2];
    return 0;
  }
  function boroRank(b, lots) { return b === 0 ? -1e9 : -lots; }
  var BORO_ALIAS = { "MANHATTAN":0, "NEW YORK NY":0, "MN":0, "BRONX":1, "THE BRONX":1, "BX":1,
    "BROOKLYN":2, "BKLYN":2, "BK":2, "QUEENS":3, "QN":3, "STATEN ISLAND":4, "SI":4, "STATEN IS":4 };
  var IGNORE_PART = /^(NY|NYC|NEW YORK|NEW YORK CITY|USA|US|UNITED STATES|NY \d{5}|NEW YORK NY \d{5}|\d{5}(-\d{4})?)$/;

  function normTokens(s) {
    s = String(s).toUpperCase().replace(/[’'`.]/g, "").replace(/[&@\/,;+]/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ");
    var raw = s.split(/\s+/).filter(Boolean), t = [];
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i], m = w.match(/^(\d+)(ST|ND|RD|TH)$/);
      if (m) { t.push(m[1]); continue; }
      if (w === "ST" && i < raw.length - 1 && (i === 0 || DIRS[SYN[raw[i - 1]] || raw[i - 1]]) &&
          !/^\d/.test(raw[i + 1]) && raw[i + 1] !== "AND") { t.push("SAINT"); continue; }
      t.push(SYN[w] || w);
    }
    for (var k = 0; k < t.length - 1; k++) {
      if (t[k] === "MC" && /^[A-Z]/.test(t[k + 1])) t.splice(k, 2, "MC" + t[k + 1]);
    }
    var j = " " + t.join(" ") + " ";
    j = j.replace(/ AVENUE OF (THE )?AMERICAS /g, " 6 AVENUE ").replace(/ AVENUE AMERICAS /g, " 6 AVENUE ");
    return j.trim().split(" ").filter(Boolean);
  }

  var IDX = null, IDXP = null, SHARDS = {};
  function getJSON(path) {
    return fetch(BASE + path).then(function (r) {
      if (!r.ok) throw new Error("AddrSearch: could not load " + path);
      return r.json();
    });
  }
  function index() {
    if (IDXP) return IDXP;
    IDXP = getJSON("streets.json").then(function (d) {
      d.toks = d.names.map(normTokens);
      IDX = d; return d;
    });
    IDXP.catch(function () { IDXP = null; });
    return IDXP;
  }
  function shard(id) {
    if (!SHARDS[id]) {
      SHARDS[id] = getJSON("s/" + id + ".json");
      SHARDS[id].catch(function () { delete SHARDS[id]; });
    }
    return SHARDS[id];
  }

  /* how well query tokens q fit street-name tokens name: null = no match, else a score (higher is better) */
  function fit(q, name, partial) {
    if (!q.length) return null;
    var used = new Array(name.length), pen = 0;
    for (var i = 0; i < q.length; i++) {
      var t = q[i], last = partial && i === q.length - 1, hit = -1;
      for (var j = 0; j < name.length; j++) if (!used[j] && name[j] === t) { hit = j; break; }
      if (hit < 0 && last) for (j = 0; j < name.length; j++) if (!used[j] && name[j].indexOf(t) === 0) { hit = j; pen += 0.1; break; }
      if (hit < 0) return null;
      used[hit] = true;
    }
    for (j = 0; j < name.length; j++) {
      if (used[j]) continue;
      if (DIRS[name[j]] && /^\d/.test(name[j + 1] || "")) continue;  // "44th St" fits "West 44th St"
      pen += 1;
    }
    return -pen;
  }

  /* street entries [{i, b, shard, score}] matching tokens, optionally limited to one borough */
  function streetsFor(q, partial, boro, max) {
    var out = [];
    for (var i = 0; i < IDX.names.length; i++) {
      var sc = fit(q, IDX.toks[i], partial); if (sc === null) continue;
      var loc = IDX.loc[i];
      for (var k = 0; k < loc.length; k += 3) {
        if (boro != null && loc[k] !== boro) continue;
        out.push({ i:i, b:loc[k], shard:loc[k + 1], lots:loc[k + 2], score:sc });
      }
    }
    out.sort(function (a, c) { return c.score - a.score || boroRank(a.b, a.lots) - boroRank(c.b, c.lots) || IDX.names[a.i].length - IDX.names[c.i].length; });
    return out.slice(0, max || 12);
  }

  function decode(flat) {   // [n, dlon, dlat, pct, ...] -> [{n, lon, lat, pct}]
    var out = [], lo = 0, la = 0;
    for (var k = 0; k < flat.length; k += 4) {
      lo += flat[k + 1]; la += flat[k + 2];
      out.push({ n:flat[k], lon:lo / 1e5, lat:la / 1e5, pct:flat[k + 3] });
    }
    return out;
  }
  function loadEntries(cands) {
    var ids = {}; cands.forEach(function (c) { ids[c.shard] = 1; });
    return Promise.all(Object.keys(ids).map(function (id) { return shard(id).then(function (s) { return [id, s]; }); }))
      .then(function (arr) {
        var m = {}; arr.forEach(function (p) { m[p[0]] = p[1]; });
        cands.forEach(function (c) { c.entry = m[c.shard][c.i + "." + c.b] || {}; });
        return cands;
      });
  }
  function hyphLabel(n) { var a = Math.floor(n / 1000), b = n % 1000; return a + "-" + (b < 10 ? "0" + b : b); }

  /* split the raw query into main text, borough filter and extra cross-street parts */
  function parse(query) {
    var parts = String(query).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var main = parts.shift() || "", boro = null, extra = [];
    parts.forEach(function (p) {
      var t = normTokens(p).join(" ");
      if (t in BORO_ALIAS) { boro = BORO_ALIAS[t]; return; }
      var m = t.match(/^(.*?)\s*(NY|NEW YORK)?\s*(\d{5})?$/);   // "Brooklyn NY 11201"
      if (m && m[1] in BORO_ALIAS) { boro = BORO_ALIAS[m[1]]; return; }
      if (IGNORE_PART.test(t)) return;
      if (/\d/.test(t) || /\b(STREET|AVENUE|ROAD|PLACE|BOULEVARD|DRIVE|PARKWAY|LANE|COURT|BROADWAY)\b/.test(t)) extra.push(p);
    });
    if (extra.length) main += " and " + extra.join(" and ");
    return { main:main, boro:boro };
  }
  function stripBoro(toks, boro) {
    for (var n = 2; n >= 1; n--) {
      if (toks.length > n) {
        var tail = toks.slice(-n).join(" ");
        if (tail in BORO_ALIAS) return { toks:toks.slice(0, -n), boro:boro != null ? boro : BORO_ALIAS[tail] };
      }
    }
    while (toks.length > 1 && /^(NY|NYC|\d{5})$/.test(toks[toks.length - 1])) toks = toks.slice(0, -1);
    return { toks:toks, boro:boro };
  }

  function addressSearch(num, rest, partial, boro, limit) {
    var cands = streetsFor(rest, partial, boro, 12);
    if (!cands.length) return Promise.resolve([]);
    return loadEntries(cands).then(function (cs) {
      var out = [];
      cs.forEach(function (c) {
        var name = IDX.names[c.i], bname = BOROS[c.b];
        var lists = [];
        if (num.h != null) lists.push(["h", num.a * 1000 + num.h, num.h]);
        else {
          lists.push(["a", num.a, num.a]);
          if (num.a >= 100 && !c.entry.a) lists.push(["h", Math.floor(num.a / 100) * 1000 + num.a % 100, num.a % 100]);  // "3710 82nd St" = 37-10
        }
        for (var L = 0; L < lists.length; L++) {
          var kind = lists[L][0], n = lists[L][1], par = lists[L][2] % 2, arr = c.entry[kind];
          if (!arr) continue;
          var recs = decode(arr), exact = null, best = null, bd = Infinity;
          for (var r = 0; r < recs.length; r++) {
            var a = recs[r];
            if (a.n === n) { exact = a; break; }
            var ap = kind === "h" ? (a.n % 1000) % 2 : a.n % 2;
            if (ap !== par) continue;
            if (kind === "h" && Math.floor(a.n / 1000) !== Math.floor(n / 1000) && Math.abs(a.n - n) > 1100) continue;
            var d = Math.abs(a.n - n);
            if (kind === "h" && Math.floor(a.n / 1000) !== Math.floor(n / 1000)) d += 500;  // prefer the same block
            if (d < bd) { bd = d; best = a; }
          }
          var lab = (kind === "h" ? hyphLabel(n) : String(n)) + " " + name;
          if (exact) { out.push({ label:lab + ", " + bname, lon:exact.lon, lat:exact.lat, pct:exact.pct, kind:"address", _s:10 + c.score, _b:c.b, _r:boroRank(c.b, c.lots) }); break; }
          if (best && bd <= (kind === "h" ? 1100 : 100)) {
            var bl = (kind === "h" ? hyphLabel(best.n) : String(best.n)) + " " + name;
            out.push({ label:lab + ", " + bname, lon:best.lon, lat:best.lat, pct:best.pct, kind:"address", _s:c.score - bd / 1000 - 0.5, _b:c.b, _r:boroRank(c.b, c.lots),
              note:"No exact match for " + lab + " in the city’s tax-lot list, so this uses the nearest listed address on the same side of the street, " + bl + "." });
            break;
          }
        }
      });
      return finish(out, limit);
    });
  }

  function intersectionSearch(p1, p2, partial, boro, limit) {
    var c1 = streetsFor(p1, false, boro, 40), c2 = streetsFor(p2, partial, boro, 40);
    if (!c1.length || !c2.length) return Promise.resolve([]);
    var primary = c1.length <= c2.length ? c1 : c2, other = primary === c1 ? p2 : p1, opart = primary === c1 ? partial : false;
    primary = primary.slice(0, 12);
    return loadEntries(primary).then(function (cs) {
      var out = [], seen = {};
      cs.forEach(function (c) {
        if (!c.entry.x) return;
        decode(c.entry.x).forEach(function (x) {
          var sc = fit(other, IDX.toks[x.n], opart); if (sc === null) return;
          var a = IDX.names[c.i], b = IDX.names[x.n];
          var lab = (primary === c1 ? a + " & " + b : b + " & " + a) + ", " + BOROS[c.b];
          var key = lab + "|" + Math.round(x.lon * 1e3) + "|" + Math.round(x.lat * 1e3);
          if (seen[key]) return; seen[key] = 1;
          out.push({ label:lab, lon:x.lon, lat:x.lat, pct:x.pct, kind:"intersection", _s:c.score + sc, _b:c.b, _r:boroRank(c.b, c.lots + countOf(x.n, c.b)) });
        });
      });
      return finish(out, limit);
    });
  }

  function finish(out, limit) {
    out.sort(function (a, b) { return b._s - a._s || a._r - b._r || (a.label < b.label ? -1 : 1); });
    return out.slice(0, limit).map(function (r) {
      var o = { label:r.label, lon:r.lon, lat:r.lat, pct:r.pct, kind:r.kind };
      if (r.note) o.note = r.note;
      return o;
    });
  }

  function search(main, boro, limit) {
    var partial = !/\s$/.test(main);
    var up = main.toUpperCase().trim();
    var toks = normTokens(up);
    var sb = stripBoro(toks, boro); toks = sb.toks; boro = sb.boro;
    var ai = toks.indexOf("AND"); if (ai < 0) ai = toks.indexOf("AT");
    if (ai > 0 && ai < toks.length - 1) {
      var p1 = toks.slice(0, ai), p2 = toks.slice(ai + 1).filter(function (t) { return t !== "AND" && t !== "AT"; });
      return intersectionSearch(p1, p2, partial, boro, limit);
    }
    var m = up.match(/^(\d+)(?:\s*-\s*(\d+))?([A-Z](?![A-Z0-9]))?\s+(.+)$/);
    if (m) {
      var rt0 = normTokens(m[4]);
      if (rt0.length > 1 && /^[A-Z]$/.test(rt0[0])) rt0 = rt0.slice(1);   // "10 A Richmond Ter": letter suffix after a space
      var rest = stripBoro(rt0, boro);
      if (rest.toks.length && !rest.toks.every(function (t) { return GENERIC[t]; })) {
        var num = { a:parseInt(m[1], 10), h:m[2] != null ? parseInt(m[2], 10) : null };
        var tryRest = function (rt) {
          return addressSearch(num, rt, partial, rest.boro, limit).then(function (res) {
            // "37-10 82nd St Jackson Heights": drop trailing words that aren't part of a street name
            if (!res.length && rt.length > 1) return tryRest(rt.slice(0, -1));
            return res;
          });
        };
        return tryRest(rest.toks);
      }
    }
    return Promise.resolve([]);   // a bare street name: ask for a house number or a cross street
  }

  function suggest(query, limit) {
    limit = limit || 8;
    var q = String(query || "").trim();
    if (q.length < 2) return Promise.resolve([]);
    return index().then(function () {
      var p = parse(query);
      return search(p.main + (/\s$/.test(String(query)) ? " " : ""), p.boro, limit);
    });
  }

  root.AddrSearch = { suggest:suggest, _normTokens:normTokens };
})(typeof window !== "undefined" ? window : globalThis);
