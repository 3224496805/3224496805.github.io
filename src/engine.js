import { rating, rate } from "openskill";
import { plackettLuce } from "openskill/models";

import { DEFAULT_CONFIG } from "./defaults.js";
export { DEFAULT_CONFIG } from "./defaults.js";

function randomSource(e) {
  let t = e >>> 0;
  return function () {
    ((t |= 0), (t = (t + 1831565813) | 0));
    let n = Math.imul(t ^ (t >>> 15), 1 | t);
    return (
      (n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n),
      ((n ^ (n >>> 14)) >>> 0) / 4294967296
    );
  };
}
export class Simulator {
  cfg;
  players = [];
  queue = [];
  tick = 0;
  matches = 0;
  history = [];
  convergedAt = null;
  waitSum = 0;
  waitCount = 0;
  favSumLive = 0;
  favCountLive = 0;
  lastSampled = 0;
  newbieIds = [];
  nbGames = 0;
  nbWins = 0;
  churnCount = 0;
  nbChurn = 0;
  flaggedCount = 0;
  fpTotal = 0;
  smurfGames = 0;
  smurfStomps = 0;
  smurfVictims = 0;
  smurfVictimMoodSum = 0;
  smurfNewbieVictims = 0;
  smurfChurn = 0;
  smurfExitSum = 0;
  smurfExitN = 0;
  smurfExited = new Set();
  constructor(config = {}) {
    this.cfg = validateConfig(config);
    this.initialConfig = { ...this.cfg };
    this.events = [];
    this.recentMatches = [];
    this.waitSamples = [];
    this.poolCache = null;
    this.spawnPlayers();
  }
  reset() {
    Object.assign(this, new Simulator(this.cfg));
  }
  updateConfig(patch) {
    const next = validateConfig({ ...this.cfg, ...patch });
    const changed = Object.fromEntries(
      Object.keys(next)
        .filter((key) => next[key] !== this.cfg[key])
        .map((key) => [key, next[key]]),
    );
    if (!Object.keys(changed).length) return { restarted: false };
    const restartKeys = [
      "seed",
      "playerCount",
      "skillDist",
      "skillMean",
      "skillSd",
      "initRating",
      "initSpread",
      "preset",
      "osSigma0",
      "smurfOn",
      "smurfRate",
      "cheatOn",
      "cheatRate",
    ];
    const restarted = restartKeys.some((key) => next[key] !== this.cfg[key]);
    this.cfg = next;
    this.poolCache = null;
    if (restarted) this.reset();
    else {
      this.events.push({
        type: "configure",
        tick: this.tick,
        matches: this.matches,
        patch: changed,
      });
      for (const player of this.players) {
        this.refreshRating(player);
        if (!next.shadowOn) {
          player.zone = 2;
          player.hits = 0;
        }
      }
      this.convergedAt = null;
    }
    return { restarted };
  }
  refreshRating(player) {
    if (this.isOS()) player.r = player.mu - this.cfg.osZ * player.sigma;
  }
  worldRandom(id, channel, tick = this.tick) {
    let value =
      this.cfg.seed ^
      Math.imul(id + 1, 0x9e3779b9) ^
      Math.imul(tick + 1, 0x85ebca6b) ^
      Math.imul(channel + 1, 0xc2b2ae35);
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }
  worldNormal(id, channel, tick = this.tick) {
    const u = Math.max(Number.EPSILON, this.worldRandom(id, channel, tick));
    return (
      Math.sqrt(-2 * Math.log(u)) *
      Math.cos(2 * Math.PI * this.worldRandom(id, channel + 1, tick))
    );
  }
  spawnPlayers() {
    this.players = Array.from({ length: this.cfg.playerCount }, (_, id) =>
      this.makePlayer(id),
    );
  }
  makePlayer(id) {
    const cfg = this.cfg;
    // Each account has its own fixed population stream. Optional mechanisms never shift other accounts.
    const random = randomSource(cfg.seed ^ Math.imul(id + 1, 0x9e3779b9));
    const normal = () =>
      Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) *
      Math.cos(2 * Math.PI * random());
    const normalSkill = normal(),
      uniformSkill = random(),
      tier = random();
    const initial = normal(),
      smurfRoll = random(),
      smurfSkill = normal(),
      cheatRoll = random();
    let skill =
      cfg.skillDist === "normal"
        ? cfg.skillMean + normalSkill * cfg.skillSd
        : cfg.skillDist === "tiers"
          ? [1300, 1450, 1600, 1800][Math.floor(tier * 4)] + normalSkill * 80
          : cfg.skillMean + (uniformSkill * 2 - 1) * cfg.skillSd * 1.8;
    const smurf = cfg.smurfOn && smurfRoll < cfg.smurfRate;
    if (smurf) skill = cfg.skillMean + 1.28 * cfg.skillSd + smurfSkill * 40;
    const mu = cfg.initRating + initial * cfg.initSpread;
    return {
      id,
      ts: skill,
      tsTarget: skill,
      mu,
      sigma: cfg.osSigma0,
      r: this.isOS() ? mu - cfg.osZ * cfg.osSigma0 : mu,
      formEma: mu,
      perfEma: 65,
      wrEma: 0.5,
      streak: 0,
      maxWin: 0,
      maxLose: 0,
      hiatus: 0,
      returnedAt: -1,
      frust: 0,
      mood: 0,
      alive: true,
      isNewbie: false,
      cheater: cfg.cheatOn && cheatRoll < cfg.cheatRate,
      smurf,
      smurfLosses: 0,
      hits: 0,
      zone: 2,
      everFlagged: false,
      g: 0,
      w: 0,
      wait: 0,
      inQueue: false,
      lastResults: "",
      placed: false,
      vScore: 400,
      sScore: 2400,
    };
  }
  reincarnateAsSmurf(t) {
    const n = this.cfg;
    ((t.alive = !0),
      (t.ts = n.skillMean + 1.28 * n.skillSd + this.worldNormal(t.id, 10) * 40),
      (t.tsTarget = t.ts),
      (t.mu = n.initRating),
      (t.sigma = n.osSigma0),
      (t.r = this.isOS() ? n.initRating - n.osZ * n.osSigma0 : n.initRating),
      (t.formEma = n.initRating),
      (t.perfEma = 65),
      (t.wrEma = 0.5),
      (t.streak = 0),
      (t.maxWin = 0),
      (t.maxLose = 0),
      (t.hiatus = 0),
      (t.returnedAt = -1),
      (t.zone = 2),
      (t.hits = 0),
      (t.everFlagged = false),
      (t.frust = 0),
      (t.mood = 0),
      (t.smurf = !0),
      (t.smurfLosses = 0),
      (t.g = 0),
      (t.w = 0),
      (t.wait = 0),
      (t.inQueue = !1),
      (t.lastResults = ""),
      (t.placed = !1),
      (t.vScore = 400),
      (t.sScore = 2400),
      this.smurfExited.delete(t.id));
  }
  injectNewbies(t) {
    t = Math.min(2000 - this.players.length, Math.max(0, Math.floor(t)));
    this.poolCache = null;
    if (t <= 0) return;
    this.events.push({
      type: "inject",
      tick: this.tick,
      matches: this.matches,
      count: t,
    });
    for (let n = 0; n < t; n++) {
      const r = this.makePlayer(this.players.length);
      ((r.isNewbie = !0),
        (r.mu = this.cfg.initRating),
        (r.r = this.isOS() ? r.mu - this.cfg.osZ * r.sigma : r.mu),
        this.newbieIds.push(r.id),
        this.players.push(r));
    }
  }
  effectiveR(t) {
    return this.cfg.preset === "full"
      ? t.placed
        ? t.sScore
        : t.vScore
      : t.r + this.cfg.perfBlend * (t.perfEma - 65) * 1.5;
  }
  metricR(t) {
    return this.cfg.preset === "full" ? t.r : this.effectiveR(t);
  }
  tolK() {
    return this.cfg.preset === "full" ? 2 : 1;
  }
  isOS() {
    return this.cfg.preset === "openskill" || this.cfg.preset === "full";
  }
  step(t) {
    for (let n = 0; n < t; n++) {
      this.poolCache = null;
      if ((this.tick++, this.cfg.driftMag > 0)) {
        for (const i of this.players)
          if (i.alive) {
            if (this.worldRandom(i.id, 0) < this.cfg.driftShift) {
              const s =
                this.cfg.learningLen > 0
                  ? this.cfg.driftMag * Math.exp(-i.g / this.cfg.learningLen)
                  : this.cfg.driftMag;
              i.tsTarget = i.ts + this.worldNormal(i.id, 1) * s;
            }
            i.ts += (i.tsTarget - i.ts) * this.cfg.driftPull;
          }
      }
      for (const i of this.players) {
        if (!i.alive) {
          this.cfg.churnOn &&
            this.worldRandom(i.id, 4) < this.cfg.churnReturn &&
            (this.cfg.smurfOn && this.worldRandom(i.id, 5) < this.cfg.smurfRate
              ? this.reincarnateAsSmurf(i)
              : ((i.alive = !0), (i.frust = 0), (i.mood = 0)));
          continue;
        }
        if (i.hiatus > 0) {
          (i.hiatus--,
            this.cfg.rustRate > 0 &&
              this.isOS() &&
              (i.sigma = Math.min(
                this.cfg.osSigma0,
                i.sigma + (this.cfg.osSigma0 - i.sigma) * this.cfg.rustRate,
              )),
            i.hiatus === 0 && (i.returnedAt = this.matches));
          this.refreshRating(i);
          continue;
        }
        if (
          (this.cfg.shadowOn &&
            !i.cheater &&
            i.zone < 2 &&
            this.worldRandom(i.id, 6) < this.cfg.appealRate &&
            ((i.hits = 0),
            (i.zone = 2),
            this.isOS() && (i.sigma = this.cfg.osSigma0),
            this.cfg.preset === "full" &&
              ((i.placed = !0), (i.sScore = Math.max(1800, 2 * i.r + 1e3)))),
          !i.inQueue &&
            this.cfg.hiatusRate > 0 &&
            this.worldRandom(i.id, 7) < this.cfg.hiatusRate)
        ) {
          i.hiatus = this.cfg.hiatusLen;
          continue;
        }
        this.cfg.rustRate > 0 &&
          this.isOS() &&
          !i.inQueue &&
          (i.sigma = Math.min(
            this.cfg.osSigma0,
            i.sigma + (this.cfg.osSigma0 - i.sigma) * this.cfg.rustRate,
          ));
        this.refreshRating(i);
        const s = this.cfg.psychoOn ? 1 + 0.25 * Math.tanh(i.mood / 4) : 1;
        !i.inQueue &&
          this.worldRandom(i.id, 8) < this.cfg.arrivalRate * s &&
          ((i.inQueue = !0), (i.wait = 0), this.queue.push(i.id));
      }
      for (const i of this.queue) this.players[i].wait++;
      let r = 0;
      for (
        ;
        this.queue.length >= 6 &&
        r < this.cfg.maxMatchesPerTick &&
        this.tryMatch();
      )
        r++;
    }
  }
  tryMatch() {
    const cfg = this.cfg;
    if (!this.poolCache) {
      const players = this.queue.map((id) => this.players[id]);
      const scores = new Map(
        players.map((player) => [player.id, this.effectiveR(player)]),
      );
      this.poolCache = {
        scores,
        sorted: [...players].sort(
          (a, b) => scores.get(a.id) - scores.get(b.id) || a.id - b.id,
        ),
        waiting: [...players].sort((a, b) => b.wait - a.wait || a.id - b.id),
      };
    }
    const { sorted, waiting, scores } = this.poolCache;
    const pool = sorted.filter(
      (player) => player.inQueue && player.alive && !player.hiatus,
    );
    if (pool.length < 6) return false;
    const meanMood =
      pool.reduce((sum, player) => sum + player.mood, 0) / pool.length;
    const moodTolerance = cfg.psychoOn
      ? 1 + cfg.moodTol * Math.min(1, Math.max(0, -meanMood) / 4)
      : 1;
    // ponytail: bounded 16-anchor search; widen only if sparse-pool benchmarks show starvation.
    const anchors = waiting
      .filter((player) => player.inQueue && player.alive && !player.hiatus)
      .slice(0, 16);
    for (const anchor of anchors) {
      const others = pool.filter(
        (player) =>
          player.id !== anchor.id &&
          (!cfg.shadowOn || player.zone === anchor.zone),
      );
      if (others.length < 5) continue;
      const distance = (player) =>
        Math.abs(scores.get(player.id) - scores.get(anchor.id)) +
        (cfg.smurfOn && anchor.smurf && !player.smurf ? 1e6 : 0);
      let first = null,
        second = null;
      for (const player of others) {
        if (!first || distance(player) < distance(first)) {
          second = first;
          first = player;
        } else if (!second || distance(player) < distance(second))
          second = player;
      }
      const teamA = [anchor, first, second];
      const sumA = teamA.reduce(
        (sum, player) => sum + scores.get(player.id),
        0,
      );
      const rest = others.filter(
        (player) => player !== first && player !== second,
      );
      const tolerance =
        (cfg.baseTolerance + cfg.toleranceGrowth * anchor.wait) *
        moodTolerance *
        this.tolK();
      let best = null;
      for (let index = 0; index + 2 < rest.length; index++) {
        const teamB = rest.slice(index, index + 3);
        const sumB = teamB.reduce(
          (sum, player) => sum + scores.get(player.id),
          0,
        );
        const difference = Math.abs(sumA - sumB);
        if (sumB > sumA + tolerance) break;
        if (difference > tolerance) continue;
        let cost = difference * 2;
        if (cfg.matchPolicy === "engage") {
          for (const [team, opponent] of [
            [teamA, sumB / 3],
            [teamB, sumA / 3],
          ])
            for (const player of team) {
              const weight = Math.min(1, Math.max(0, -player.mood) / 3);
              const target =
                scores.get(player.id) +
                (player.mood < 0 ? cfg.engageTilt * this.tolK() : 0);
              cost += weight * Math.abs(opponent - target);
            }
        }
        if (!best || cost < best.cost) best = { teamB, cost };
      }
      if (!best) continue;
      const selected = new Set(
        [...teamA, ...best.teamB].map((player) => player.id),
      );
      this.queue = this.queue.filter((id) => !selected.has(id));
      for (const player of [...teamA, ...best.teamB]) {
        player.inQueue = false;
        this.waitSum += player.wait;
        this.waitCount++;
        this.waitSamples.push(player.wait);
      }
      if (this.waitSamples.length > 1200)
        this.waitSamples.splice(0, this.waitSamples.length - 1200);
      this.resolveMatch(teamA, best.teamB);
      return true;
    }
    return false;
  }
  resolveMatch(t, n) {
    const r = this.cfg,
      i = 2 / (r.recentWin + 1),
      s = t.map(
        (E) =>
          E.ts +
          (E.cheater ? r.cheatBoost : 0) +
          (this.worldNormal(E.id, 40, E.g) * r.matchNoise) / Math.sqrt(3),
      ),
      l = n.map(
        (E) =>
          E.ts +
          (E.cheater ? r.cheatBoost : 0) +
          (this.worldNormal(E.id, 40, E.g) * r.matchNoise) / Math.sqrt(3),
      ),
      u = s.reduce((E, O) => E + O, 0),
      f = l.reduce((E, O) => E + O, 0),
      d = u >= f;
    this.matches++;
    this.recentMatches.push({
      id: this.matches,
      tick: this.tick,
      a: t.map((p) => p.id),
      b: n.map((p) => p.id),
      aWins: d,
      gap:
        Math.abs(
          t.reduce((s, p) => s + this.effectiveR(p), 0) -
            n.reduce((s, p) => s + this.effectiveR(p), 0),
        ) / 3,
    });
    if (this.recentMatches.length > 12) this.recentMatches.shift();
    const m = t.reduce((E, O) => E + O.ts + (O.cheater ? r.cheatBoost : 0), 0),
      p = n.reduce((E, O) => E + O.ts + (O.cheater ? r.cheatBoost : 0), 0),
      y =
        r.matchNoise > 0
          ? normalCdf((m - p) / (Math.sqrt(2) * r.matchNoise))
          : m === p
            ? 0.5
            : Number(m > p);
    ((this.favSumLive += Math.max(y, 1 - y)), this.favCountLive++);
    const x = t.some((E) => E.smurf) ? t : n.some((E) => E.smurf) ? n : null;
    x && this.smurfGames++;
    const w = Math.abs(m - p) / 3 >= 250 && x !== null && (x === t) === d;
    w && this.smurfStomps++;
    const b = [...t, ...n],
      P = new Map();
    b.forEach((E) => {
      const O = t.includes(E) ? d : !d;
      (P.set(E.id, E.streak),
        E.g++,
        O && E.w++,
        (E.wrEma = i * (O ? 1 : 0) + (1 - i) * E.wrEma),
        (E.lastResults = (O ? "W" : "L") + E.lastResults.slice(0, 9)),
        (E.streak = O
          ? E.streak > 0
            ? E.streak + 1
            : 1
          : E.streak < 0
            ? E.streak - 1
            : -1),
        E.streak > E.maxWin && (E.maxWin = E.streak),
        -E.streak > E.maxLose && (E.maxLose = -E.streak));
    });
    const A = !(r.shadowOn && t[0].zone === 0);
    if (r.preset === "full") {
      const E = [];
      if (r.shadowOn && A)
        for (const O of b) {
          const T = O.cheater ? r.detHitTP : r.detHitFP;
          this.worldRandom(O.id, 20) >= T ||
            (O.hits++,
            O.hits >= r.isoHits && O.zone !== 0
              ? ((O.zone = 0),
                (O.everFlagged = !0),
                this.flaggedCount++,
                O.cheater || this.fpTotal++,
                (O.mu = r.isoMu),
                (O.sigma = r.osSigma0),
                (O.r = O.mu - r.osZ * O.sigma),
                E.push(O))
              : O.hits >= 1 && O.zone === 2 && (O.zone = 1));
        }
      if (A)
        if (E.length) {
          const O = new Set(E.map((T) => T.id));
          for (const T of b) {
            if (O.has(T.id)) {
              this.cheatDeduct(T);
              continue;
            }
            (t.includes(T) && t.some((D) => O.has(D.id))) ||
              (n.includes(T) && n.some((D) => O.has(D.id))) ||
              this.addScore(T, 200);
          }
        } else this.updateFull(t, n, d);
      else for (const O of b) O.zone === 0 && this.cheatDeduct(O);
    } else
      A &&
        (this.isOS()
          ? this.updateOpenSkill(t, n, d)
          : r.preset === "form"
            ? this.updateForm(t, n, d, s, l)
            : this.updateElo(t, n, d));
    const C = [...s, ...l];
    if (
      (b.forEach((E, O) => {
        const T = t.includes(E) ? d : !d,
          M = (C[O] - r.skillMean) / (r.skillSd + r.matchNoise / Math.sqrt(3)),
          D = Math.max(5, Math.min(99, Math.round(65 + M * 18)));
        if (
          ((E.perfEma = 0.3 * D + 0.7 * E.perfEma),
          E.isNewbie && (this.nbGames++, T && this.nbWins++),
          r.psychoOn)
        ) {
          const N = Math.abs(u - f) / Math.max(1, 2 * r.matchNoise),
            L = Math.abs(u - f) <= r.matchNoise ? 0.6 : 0;
          let k;
          (T
            ? (k =
                1 +
                Math.min(4, Math.max(0, -(P.get(E.id) ?? 0))) * 1.2 +
                0.15 * Math.min(E.streak, 3) +
                L)
            : ((k = -(1 + 0.8 * N + 0.35 * Math.max(0, -E.streak))),
              E.isNewbie && E.g <= 20 && (k -= 0.8),
              L && (k += 1)),
            (k += 3 * Math.max(0, 0.45 - E.wrEma) * (T ? -1 : 1)),
            (E.mood = Math.max(
              -20,
              Math.min(20, (E.mood + r.churnSens * k) * 0.9),
            )),
            w &&
              !T &&
              (E.smurfLosses++,
              this.smurfVictims++,
              (this.smurfVictimMoodSum += E.mood),
              E.g <= 20 && this.smurfNewbieVictims++));
          const I = Math.min(0.05, Math.max(0, (-E.mood - 5) * 0.02));
          r.churnOn &&
            this.worldRandom(E.id, 30) < I &&
            ((E.alive = !1),
            (E.inQueue = !1),
            (E.hiatus = 0),
            this.churnCount++,
            E.smurfLosses >= 2 && this.smurfChurn++,
            E.isNewbie && this.nbChurn++);
        } else if (r.churnOn) {
          const N = Math.abs(u - f) / Math.max(1, 2 * r.matchNoise);
          let L = T ? -0.8 : 1 + 0.8 * N + 0.35 * Math.max(0, -E.streak);
          (E.isNewbie && !T && E.g <= 20 && (L += 0.8),
            (L += 3 * Math.max(0, 0.45 - E.wrEma)),
            (L += 0.02 * Math.min(E.wait, 50)),
            (E.frust = Math.max(0, (E.frust + r.churnSens * L) * 0.95)),
            w &&
              !T &&
              (E.smurfLosses++,
              this.smurfVictims++,
              E.g <= 20 && this.smurfNewbieVictims++));
          const k = Math.min(0.05, Math.max(0, (E.frust - 6) * 0.02));
          this.worldRandom(E.id, 30) < k &&
            ((E.alive = !1),
            (E.inQueue = !1),
            (E.hiatus = 0),
            this.churnCount++,
            E.smurfLosses >= 2 && this.smurfChurn++,
            E.isNewbie && this.nbChurn++);
        }
      }),
      r.smurfOn)
    )
      for (const E of b) {
        if (!E.smurf || this.smurfExited.has(E.id)) continue;
        (r.preset === "full" ? E.placed : this.effectiveR(E) >= 2400) &&
          (this.smurfExited.add(E.id),
          (this.smurfExitSum += E.g),
          this.smurfExitN++);
      }
    if (r.preset !== "full" && r.shadowOn && A)
      for (const E of b) {
        const O = E.cheater ? r.detHitTP : r.detHitFP;
        this.worldRandom(E.id, 20) >= O ||
          (E.hits++,
          E.hits >= r.isoHits
            ? E.zone !== 0 &&
              ((E.zone = 0),
              (E.everFlagged = !0),
              this.flaggedCount++,
              E.cheater || this.fpTotal++,
              this.isOS()
                ? ((E.mu = r.isoMu),
                  (E.sigma = r.osSigma0),
                  (E.r = E.mu - r.osZ * E.sigma))
                : (E.r = r.isoMu))
            : E.hits >= 1 && E.zone === 2 && (E.zone = 1));
      }
    if (this.matches - this.lastSampled >= this.cfg.sampleEvery) {
      this.lastSampled = this.matches;
      this.sample();
    }
  }
  streakFactor(t) {
    return t.streak / 5;
  }
  streakWeight(t) {
    const n = this.cfg;
    return n.streakDamp
      ? this.isOS()
        ? n.streakBoost * Math.min(1, t.sigma / n.osSigma0)
        : n.streakBoost * Math.min(1, 150 / (t.g + 50))
      : n.streakBoost;
  }
  updateElo(teamA, teamB, aWins) {
    const cfg = this.cfg;
    const mean = (team) =>
      team.reduce((sum, player) => sum + this.effectiveR(player), 0) /
      team.length;
    const expectedA =
      1 / (1 + 10 ** (-(mean(teamA) - mean(teamB)) / cfg.scale));
    // Both teams use the same pre-match expectation; never read a partially updated opponent.
    for (const [team, won, expected] of [
      [teamA, aWins, expectedA],
      [teamB, !aWins, 1 - expectedA],
    ]) {
      for (const player of team) {
        const k = Math.max(
          0,
          cfg.kBase *
            (1 +
              this.streakWeight(player) * this.streakFactor(player) +
              cfg.moodRate * Math.min(1, Math.max(0, -player.mood) / 5)),
        );
        player.r += k * ((won ? 1 : 0) - expected) * (won ? 1 : cfg.lossFactor);
      }
    }
  }
  updateForm(t, n, r, i, s) {
    const l = this.cfg,
      u = (f, d) => {
        const m = l.formCorr * ((f.ts - l.skillMean) / l.skillSd),
          p =
            (1 - l.formCorr) *
            ((d - f.ts) / (l.matchNoise / Math.sqrt(3))) *
            0.6,
          y = l.skillMean + (m + p) * l.skillSd;
        ((f.formEma = l.formAlpha * y + (1 - l.formAlpha) * f.formEma),
          (f.r = f.formEma));
      };
    (t.forEach((f, d) => u(f, i[d])), n.forEach((f, d) => u(f, s[d])));
  }
  updateOpenSkill(t, n, r) {
    const i = this.cfg,
      s = {
        model: plackettLuce,
        beta: i.osSigma0 / 2,
        tau: i.osSigma0 / 100,
        rank: r ? [1, 2] : [2, 1],
      },
      l = t.map((p) => rating({ mu: p.mu, sigma: p.sigma })),
      u = n.map((p) => rating({ mu: p.mu, sigma: p.sigma })),
      [f, d] = rate([[...l], [...u]], s),
      m = (p, y) => {
        const x =
          i.muCap > 0
            ? Math.max(-i.muCap, Math.min(i.muCap, y.mu - p.mu))
            : y.mu - p.mu;
        p.mu = p.mu + x;
        const _ = Math.max(0, Math.abs(p.streak) - 1) / 4,
          w = 0.25 * i.osSigma0 * this.streakWeight(p) * _,
          b = i.moodRate * i.osSigma0 * Math.min(1, Math.max(0, -p.mood) / 5);
        ((p.sigma = Math.sqrt(
          Math.min(i.osSigma0 ** 2, y.sigma ** 2 + w ** 2 + b ** 2),
        )),
          (p.r = p.mu - i.osZ * p.sigma));
      };
    (t.forEach((p, y) => m(p, f[y])), n.forEach((p, y) => m(p, d[y])));
  }
  addScore(t, n) {
    t.placed
      ? (t.sScore = Math.max(1800, t.sScore + n))
      : ((t.vScore = Math.min(2400, Math.max(400, t.vScore + n))),
        t.vScore >= 2400 && ((t.placed = !0), (t.sScore = t.vScore)));
  }
  cheatDeduct(t) {
    t.placed
      ? (t.sScore = Math.max(0, t.sScore - 200))
      : (t.vScore = Math.max(0, t.vScore - 200));
  }
  updateFull(t, n, r) {
    const i = new Map();
    for (const s of [...t, ...n]) i.set(s.id, s.r);
    this.updateOpenSkill(t, n, r);
    for (const s of [...t, ...n]) {
      const l = t.includes(s) ? r : !r,
        u = s.r - (i.get(s.id) ?? s.r);
      if (s.placed)
        s.sScore >= 7e3
          ? (s.sScore += l ? 80 : -20)
          : (s.sScore = Math.max(
              1800,
              s.sScore + Math.max(-200, Math.min(200, 2 * u)),
            ));
      else {
        (s.vScore < 800
          ? (s.vScore += l ? 160 : 0)
          : (s.vScore = Math.min(2400, s.vScore + (l ? 160 : -40))),
          (s.vScore = Math.max(400, s.vScore)));
        const f = 2 * s.r + 1e3;
        (s.vScore >= 2400 || Math.abs(f - s.vScore) <= 200 || s.g >= 40) &&
          ((s.placed = !0), (s.sScore = Math.max(1800, s.vScore)));
      }
    }
  }
  sample() {
    const t = this.cfg,
      n = this.players.filter((_) => _.g >= t.minGamesForMetric),
      r = this.players.filter((_) => _.g >= t.recentWin);
    let i = 0,
      s = 0,
      l = 0,
      u = 0,
      f = 0,
      d = 0;
    const m = [],
      p = [];
    for (const _ of n) {
      const w = _.w / _.g;
      ((i += Math.abs(w - 0.5)),
        Math.abs(w - 0.5) <= 0.05 && l++,
        m.push(this.metricR(_)),
        p.push(_.ts),
        (u += Math.abs(this.metricR(_) - _.ts)));
    }
    for (const _ of this.players)
      _.returnedAt >= 0 &&
        this.matches - _.returnedAt <= 300 &&
        ((f += Math.abs(this.metricR(_) - _.ts)), d++);
    for (const _ of r) s += Math.abs(_.wrEma - 0.5);
    const y = this.newbieIds.map((_) => this.players[_]).filter(Boolean);
    (this.history.push({
      matches: this.matches,
      meanAbsDev: n.length ? i / n.length : null,
      recentDev: r.length ? s / r.length : null,
      trackErr: n.length ? u / n.length : null,
      returnErr: d ? f / d : null,
      retention:
        this.players.filter((player) => player.alive).length /
        this.players.length,
      churn: this.churnCount,
      moodAvg: this.players.length
        ? this.players.reduce((_, w) => _ + w.mood, 0) / this.players.length
        : 0,
      withinBandPct: n.length ? l / n.length : null,
      corr: n.length >= 3 ? pearson(m, p) : null,
      favProb: this.favCountLive ? this.favSumLive / this.favCountLive : 0.5,
      newbieWr: this.nbGames ? this.nbWins / this.nbGames : null,
      newbieAvgR: y.length
        ? y.reduce((_, w) => _ + this.metricR(w), 0) / y.length
        : null,
    }),
      // Keep the beginning of the experiment instead of discarding convergence at high speeds.
      this.history.length > 600 &&
        (this.history = this.history.filter(
          (_, index) => index % 2 === 0 || index === this.history.length - 1,
        )));
    const x = this.history[this.history.length - 1];
    this.convergedAt === null &&
      this.history.length > 5 &&
      r.length >= 20 &&
      x.recentDev <= t.convDev &&
      x.withinBandPct >= t.convWithin &&
      (this.convergedAt = this.matches);
  }
  snapshot() {
    const t = this.cfg,
      n = this.players.filter((f) => f.g >= t.minGamesForMetric);
    let r = 0,
      i = 0,
      s = 0;
    for (const f of n) {
      const d = f.w / f.g;
      ((r += Math.abs(d - 0.5)),
        Math.abs(d - 0.5) <= 0.05 && i++,
        (s += f.sigma));
    }
    const l = new Array(10).fill(0);
    for (const f of n) {
      const d = f.g ? f.w / f.g : 0;
      l[Math.min(9, Math.max(0, Math.floor(d * 10)))]++;
    }
    const u = this.history[this.history.length - 1];
    return {
      tick: this.tick,
      matches: this.matches,
      initialConfig: { ...this.initialConfig },
      events: this.events.map((event) =>
        event.patch ? { ...event, patch: { ...event.patch } } : { ...event },
      ),
      queueLen: this.queue.length,
      history: this.history.map((point) => ({ ...point })),
      recentMatches: this.recentMatches.map((match) => ({
        ...match,
        a: [...match.a],
        b: [...match.b],
      })),
      avgWait: this.waitCount ? this.waitSum / this.waitCount : 0,
      p95Wait: percentile(this.waitSamples, 0.95),
      convergedAt: this.convergedAt,
      meanAbsDev: n.length ? r / n.length : 0,
      withinBandPct: n.length ? i / n.length : 0,
      corr: u ? u.corr : null,
      favProb: u ? u.favProb : 0.5,
      winBins: l.map((f, d) => ({
        bin: `${d * 10}–${d * 10 + 10}%`,
        count: f,
      })),
      players: this.players.map((player) => ({
        ...player,
        rating: this.effectiveR(player),
        estimate: this.metricR(player),
      })),
      metricsPlayers: n.length,
      avgSigma: n.length ? s / n.length : 0,
      recentDev: u ? u.recentDev : null,
      trackErr: u ? u.trackErr : null,
      returnErr: u ? u.returnErr : null,
      returnCount: this.players.filter(
        (f) => f.returnedAt >= 0 && this.matches - f.returnedAt <= 300,
      ).length,
      churnTotal: this.churnCount,
      newbieChurn: this.nbChurn,
      aliveCount: this.players.filter((f) => f.alive).length,
      moodAvg: u ? u.moodAvg : 0,
      newbieCount: this.newbieIds.length,
      newbieGames: this.nbGames,
      zoneCounts: this.players.reduce(
        (f, d) => (d.alive && f[d.zone]++, f),
        [0, 0, 0],
      ),
      cheaterAlive: this.players.filter((f) => f.alive && f.cheater).length,
      cheaterFlagged: this.flaggedCount,
      fpTotal: this.fpTotal,
      smurf: this.cfg.smurfOn
        ? {
            games: this.smurfGames,
            stomps: this.smurfStomps,
            victims: this.smurfVictims,
            victimMoodAvg: this.smurfVictims
              ? this.smurfVictimMoodSum / this.smurfVictims
              : 0,
            newbieVictims: this.smurfNewbieVictims,
            churn: this.smurfChurn,
            exitAvg: this.smurfExitN
              ? this.smurfExitSum / this.smurfExitN
              : null,
          }
        : null,
    };
  }
}
function pearson(e, t) {
  const n = e.length;
  if (n < 3) return 0;
  const r = e.reduce((f, d) => f + d, 0) / n,
    i = t.reduce((f, d) => f + d, 0) / n;
  let s = 0,
    l = 0,
    u = 0;
  for (let f = 0; f < n; f++) {
    const d = e[f] - r,
      m = t[f] - i;
    ((s += d * m), (l += d * d), (u += m * m));
  }
  return l && u ? s / Math.sqrt(l * u) : 0;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}
function normalCdf(value) {
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + (value < 0 ? -erf : erf));
}
export function validateConfig(config) {
  const result = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (config[key] === undefined) continue;
    if (typeof DEFAULT_CONFIG[key] === "number") {
      if (!Number.isFinite(config[key]))
        throw new Error(`参数 ${key} 必须为有限数字`);
      result[key] = config[key];
    } else if (typeof config[key] !== typeof DEFAULT_CONFIG[key])
      throw new Error(`参数 ${key} 类型错误`);
    else result[key] = config[key];
  }
  const integers = {
    playerCount: [6, 1000],
    seed: [0, 2147483647],
    sampleEvery: [1, 10000],
    recentWin: [1, 1000],
    minGamesForMetric: [1, 1000],
    maxMatchesPerTick: [1, 200],
    isoHits: [1, 20],
    hiatusLen: [1, 100000],
    learningLen: [0, 100000],
  };
  for (const [key, [min, max]] of Object.entries(integers))
    if (
      !Number.isInteger(result[key]) ||
      result[key] < min ||
      result[key] > max
    )
      throw new Error(`参数 ${key} 超出范围`);
  for (const key of [
    "arrivalRate",
    "smurfRate",
    "cheatRate",
    "detHitTP",
    "detHitFP",
    "appealRate",
    "churnReturn",
    "hiatusRate",
    "driftShift",
    "formCorr",
    "formAlpha",
    "convWithin",
  ])
    if (result[key] < 0 || result[key] > 1)
      throw new Error(`参数 ${key} 必须在 0 到 1 之间`);
  for (const key of ["skillSd", "osSigma0", "scale"])
    if (result[key] <= 0) throw new Error(`参数 ${key} 必须大于 0`);
  for (const key of [
    "initSpread",
    "matchNoise",
    "baseTolerance",
    "toleranceGrowth",
    "driftMag",
    "driftPull",
    "rustRate",
    "churnSens",
    "engageTilt",
    "moodRate",
    "moodTol",
    "kBase",
    "lossFactor",
    "streakBoost",
    "perfBlend",
    "muCap",
    "convDev",
    "osZ",
    "cheatBoost",
  ])
    if (result[key] < 0) throw new Error(`参数 ${key} 不能为负数`);
  if (!["elo", "form", "openskill", "full"].includes(result.preset))
    throw new Error("未知评分方案");
  if (!["normal", "tiers", "uniform"].includes(result.skillDist))
    throw new Error("未知玩家分布");
  if (!["nearest", "engage"].includes(result.matchPolicy))
    throw new Error("未知匹配策略");
  return result;
}
