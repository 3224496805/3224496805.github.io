import test from "node:test";
import assert from "node:assert/strict";
import { Simulator, DEFAULT_CONFIG } from "../src/engine.js";
import { schemeConfig } from "../src/config.js";

function decisiveMatch(sim) {
  const a = sim.players.slice(0, 3),
    b = sim.players.slice(3, 6);
  a.forEach((player) => (player.ts = 3000));
  b.forEach((player) => (player.ts = 1000));
  sim.worldNormal = () => 0;
  return [a, b];
}

test("all A/B schemes start with identical population and world draws", () => {
  const base = { seed: 46, smurfOn: true, cheatOn: true, playerCount: 150 };
  const a = new Simulator(schemeConfig(base, "elo"));
  for (const key of [
    "form",
    "openskill",
    "streak",
    "mood",
    "combined",
    "full",
  ]) {
    const b = new Simulator(schemeConfig(base, key));
    const population = (sim) =>
      sim.players.map((p) => [
        p.id,
        p.ts,
        p.tsTarget,
        p.mu,
        p.smurf,
        p.cheater,
      ]);
    assert.deepEqual(population(a), population(b));
    assert.equal(a.worldRandom(30, 8, 500), b.worldRandom(30, 8, 500));
  }
});

test("reset reproduces a fresh experiment including population, counters, and snapshots", () => {
  const cfg = { seed: 46, smurfOn: true, playerCount: 150 };
  const sim = new Simulator(cfg);
  sim.step(80);
  sim.injectNewbies(10);
  sim.reset();
  assert.deepEqual(sim.snapshot(), new Simulator(cfg).snapshot());
});

test("hot settings preserve progress; population changes restart", () => {
  const sim = new Simulator();
  sim.step(30);
  const matches = sim.matches;
  assert.equal(
    sim.updateConfig({ ...sim.cfg, baseTolerance: 90 }).restarted,
    false,
  );
  assert.equal(sim.matches, matches);
  sim.updateConfig({ osZ: 1.5 });
  assert.equal(
    sim.players[0].r,
    sim.players[0].mu - 1.5 * sim.players[0].sigma,
  );
  assert.equal(sim.updateConfig({ seed: 80 }).restarted, true);
  assert.equal(sim.matches, 0);
});

test("classic team Elo conserves points and is symmetric under swapping teams", () => {
  const sim = new Simulator({ preset: "elo", playerCount: 6, initSpread: 0 });
  const [a, b] = decisiveMatch(sim);
  sim.resolveMatch(a, b);
  assert.equal(
    sim.players.reduce((sum, p) => sum + p.r, 0),
    9000,
  );
  assert.equal(a[0].r, 1516);
  assert.equal(b[0].r, 1484);
  const reverse = new Simulator({
    preset: "elo",
    playerCount: 6,
    initSpread: 0,
  });
  const [ra, rb] = decisiveMatch(reverse);
  reverse.resolveMatch(rb, ra);
  assert.deepEqual(
    reverse.players.map((p) => p.r),
    sim.players.map((p) => p.r),
  );
});

test("a win breaks a losing streak and a loss breaks a winning streak", () => {
  const sim = new Simulator({ preset: "elo", playerCount: 6 });
  const [a, b] = decisiveMatch(sim);
  a.forEach((p) => (p.streak = -3));
  b.forEach((p) => (p.streak = 4));
  sim.resolveMatch(a, b);
  assert.ok(a.every((p) => p.streak === 1));
  assert.ok(b.every((p) => p.streak === -1));
});

test("an unmatched outlier does not block the rest of the queue", () => {
  const sim = new Simulator({ preset: "elo", playerCount: 9 });
  sim.queue = sim.players.map((p) => p.id);
  sim.players.forEach((p, i) => {
    p.r = i === 0 ? 10000 : 1500;
    p.wait = i === 0 ? 100 : 10;
    p.inQueue = true;
  });
  assert.equal(sim.tryMatch(), true);
  assert.equal(sim.matches, 1);
  assert.equal(sim.players[0].inQueue, true);
});

test("emotion model respects disabled churn", () => {
  const sim = new Simulator({
    preset: "elo",
    playerCount: 6,
    psychoOn: true,
    churnOn: false,
  });
  const [a, b] = decisiveMatch(sim);
  b.forEach((p) => (p.mood = -20));
  sim.worldRandom = () => 0;
  sim.resolveMatch(a, b);
  assert.equal(sim.churnCount, 0);
  assert.ok(sim.players.every((p) => p.alive));
});

test("ordinal is consistent at initialization, injection, and offline sigma changes", () => {
  const sim = new Simulator({ initSpread: 0, rustRate: 0.05, arrivalRate: 0 });
  assert.equal(sim.players[0].r, 700);
  sim.injectNewbies(10);
  assert.equal(sim.players.at(-1).r, 700);
  sim.players[0].sigma = 100;
  sim.step(1);
  assert.equal(sim.players[0].r, sim.players[0].mu - 2 * sim.players[0].sigma);
});

test("snapshot is immutable and full-plan match rating is explicit", () => {
  const sim = new Simulator({ preset: "full", playerCount: 6 });
  sim.step(30);
  const snap = sim.snapshot(),
    frozen = JSON.stringify(snap);
  sim.step(30);
  assert.equal(JSON.stringify(snap), frozen);
  for (const p of sim.snapshot().players)
    assert.equal(p.rating, p.placed ? p.sScore : p.vScore);
});

test("invalid numeric input cannot hang the sampler or corrupt ratings", () => {
  for (const cfg of [
    { sampleEvery: 0 },
    { playerCount: NaN },
    { osSigma0: 0 },
    { matchNoise: -1 },
  ])
    assert.throws(() => new Simulator(cfg));
});

test("all scoring schemes maintain finite ratings and queue integrity", () => {
  for (const scheme of [
    "elo",
    "form",
    "openskill",
    "streak",
    "mood",
    "combined",
    "full",
  ]) {
    const sim = new Simulator(
      schemeConfig(
        {
          ...DEFAULT_CONFIG,
          playerCount: 150,
          driftMag: 80,
          smurfOn: true,
          cheatOn: true,
        },
        scheme,
      ),
    );
    sim.step(160);
    assert.ok(sim.matches > 0);
    assert.equal(new Set(sim.queue).size, sim.queue.length);
    for (const p of sim.players) {
      assert.ok(
        Number.isFinite(p.r) &&
          Number.isFinite(p.mu) &&
          Number.isFinite(p.sigma),
      );
      assert.equal(p.inQueue, sim.queue.includes(p.id));
    }
  }
});

test("exported hot parameter changes can replay the same experiment", () => {
  const sim = new Simulator({ playerCount: 100 });
  sim.step(20);
  sim.updateConfig({ driftMag: 80, baseTolerance: 100 });
  sim.step(30);
  sim.injectNewbies(10);
  sim.updateConfig({ osZ: 1.5 });
  sim.step(20);
  const snapshot = sim.snapshot();
  const replay = new Simulator(snapshot.initialConfig);
  for (const event of snapshot.events) {
    replay.step(event.tick - replay.tick);
    if (event.type === "inject") replay.injectNewbies(event.count);
    else replay.updateConfig(event.patch);
  }
  replay.step(snapshot.tick - replay.tick);
  assert.deepEqual(replay.snapshot(), snapshot);
});

test("sampling has unique match positions and preserves the start of long experiments", () => {
  const sim = new Simulator({
    preset: "elo",
    sampleEvery: 1,
    playerCount: 100,
  });
  sim.step(200);
  assert.ok(sim.matches > 600);
  assert.ok(sim.history.length <= 600);
  assert.equal(sim.history[0].matches, 1);
  assert.equal(sim.history.at(-1).matches, sim.matches);
  assert.equal(
    new Set(sim.history.map((point) => point.matches)).size,
    sim.history.length,
  );
});
