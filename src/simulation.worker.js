import { Simulator } from "./engine.js";
import { schemeConfig } from "./config.js";

let main = new Simulator();
let comparison = null;
let schemes = ["elo", "full"];
let overrides = [{}, {}];
let mode = "sim";
let running = false;
let speed = 100;
let credit = 0;
let lastTime = performance.now();
let lastSnapshot = 0;
let computeMs = 0;

function resetComparison() {
  comparison = schemes.map(
    (key, index) =>
      new Simulator({ ...schemeConfig(main.cfg, key), ...overrides[index] }),
  );
}

function publish(extra = {}) {
  self.postMessage({
    type: "snapshot",
    mode,
    running,
    speed,
    config: main.cfg,
    schemes,
    overrides,
    computeMs,
    snapshot: mode === "compare" ? null : main.snapshot(),
    comparison:
      mode === "compare" ? comparison.map((engine) => engine.snapshot()) : null,
    ...extra,
  });
  lastSnapshot = performance.now();
}

self.onmessage = ({ data }) => {
  try {
    const { type } = data;
    if (type === "init") main = new Simulator(data.config);
    if (type === "mode") {
      mode = data.mode;
      running = false;
      credit = 0;
      if (mode === "compare" && !comparison) resetComparison();
    }
    if (type === "run") {
      running = data.running;
      credit = 0;
      lastTime = performance.now();
    }
    if (type === "speed")
      speed = Math.max(1, Math.min(400, Number(data.speed) || 100));
    if (type === "configure") {
      const { restarted } = main.updateConfig(data.patch);
      if (restarted || mode === "compare") running = false;
      if (comparison) resetComparison();
      publish({ restarted, configured: true });
      return;
    }
    if (type === "schemes") {
      schemes = data.schemes;
      overrides = data.overrides || [{}, {}];
      running = false;
      resetComparison();
    }
    if (type === "reset") {
      running = false;
      credit = 0;
      if (mode === "compare") resetComparison();
      else main.reset();
    }
    if (type === "inject") {
      if (mode === "compare")
        comparison.forEach((engine) => engine.injectNewbies(10));
      else main.injectNewbies(10);
    }
    if (type === "step") {
      const engines = mode === "compare" ? comparison : [main];
      engines.forEach((engine) => engine.step(10));
    }
    publish();
  } catch (error) {
    running = false;
    self.postMessage({ type: "error", message: error.message });
  }
};

setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min(100, now - lastTime);
  lastTime = now;
  if (!running) return;
  credit = Math.min(40, credit + (elapsed * speed) / 1000);
  const start = performance.now();
  const engines = mode === "compare" ? comparison : [main];
  // Yield regularly so pause/configuration messages remain responsive even at 1000 players.
  while (credit >= 1 && performance.now() - start < 8) {
    engines.forEach((engine) => engine.step(1));
    credit--;
  }
  computeMs = computeMs * 0.8 + (performance.now() - start) * 0.2;
  if (now - lastSnapshot >= 100) publish();
}, 16);
