const COLORS = {
  text: "#8e9e95",
  grid: "#303b35",
  a: "#a0ddbf",
  b: "#9aaef1",
  base: "#50645a",
  panel: "#1c2420",
};
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ease = (value) => 1 - (1 - clamp(value)) ** 3;

export class Visuals {
  constructor() {
    this.tab = "sim";
    this.running = false;
    this.dirty = true;
    this.data = null;
    this.comparison = null;
    this.activeMatch = null;
    this.pending = [];
    this.seen = new Set();
    this.lastMatchId = 0;
    this.charts = new Map();
    this.raf = null;
    this.lastChartFrame = 0;
    this.poolDots = new Map();
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    for (const canvas of document.querySelectorAll("canvas")) {
      this.charts.set(canvas.id, {
        canvas,
        ctx: canvas.getContext("2d"),
        w: 0,
        h: 0,
      });
    }
    this.resize = new ResizeObserver(() => {
      this.dirty = true;
      this.kick();
    });
    for (const { canvas } of this.charts.values()) this.resize.observe(canvas);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.dirty = true;
        this.kick();
      }
    });
    this.reduced.addEventListener("change", () => {
      this.dirty = true;
      this.kick();
    });
    this.kick();
  }
  setTab(tab) {
    this.tab = tab;
    this.dirty = true;
    this.kick();
  }
  update({ snapshot, comparison, running, config }) {
    this.previous = this.data;
    this.data = snapshot;
    this.comparison = comparison;
    this.running = running;
    this.config = config;
    this.updatedAt = performance.now();
    if (snapshot) {
      this.players = new Map(
        snapshot.players.map((player) => [player.id, player]),
      );
      if (snapshot.matches < this.lastMatchId || !snapshot.matches) {
        this.pending = [];
        this.seen.clear();
        this.activeMatch = null;
        this.poolDots.clear();
      }
      const fresh = snapshot.recentMatches.filter(
        (match) => !this.seen.has(match.id),
      );
      for (const match of fresh) {
        this.seen.add(match.id);
        this.pending.push(match);
      }
      this.pending = this.pending.slice(-4);
      if (this.seen.size > 100)
        this.seen = new Set(snapshot.recentMatches.map((match) => match.id));
      this.lastMatchId = snapshot.matches;
      if (!running) {
        this.activeMatch = snapshot.recentMatches.at(-1) || null;
        this.matchStarted = -Infinity;
        this.pending = [];
      }
    }
    this.dirty = true;
    this.kick();
  }
  kick() {
    if (this.raf !== null || document.hidden) return;
    this.raf = requestAnimationFrame((time) => this.frame(time));
  }
  frame(time) {
    this.raf = null;
    if (document.hidden) return;
    if (this.tab !== "sim" && this.tab !== "compare") return;
    const moving = this.running && this.tab === "sim" && !this.reduced.matches;
    if (this.tab === "sim") this.arena(time);
    if (
      (this.dirty || time - this.lastChartFrame >= 65) &&
      (this.tab === "sim" || this.tab === "compare")
    ) {
      this.drawCharts(time);
      this.lastChartFrame = time;
    }
    this.dirty = false;
    if (
      moving ||
      (this.running && this.tab === "compare" && !this.reduced.matches) ||
      (time - (this.updatedAt || 0) < 180 && !this.reduced.matches)
    )
      this.kick();
  }
  surface(id) {
    const item = this.charts.get(id);
    const rect = item.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * ratio),
      height = Math.round(rect.height * ratio);
    if (item.canvas.width !== width || item.canvas.height !== height) {
      item.canvas.width = width;
      item.canvas.height = height;
    }
    item.w = rect.width;
    item.h = rect.height;
    item.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    item.ctx.clearRect(0, 0, item.w, item.h);
    return item;
  }
  arena(time) {
    const surface = this.surface("arena");
    if (!surface) return;
    const { ctx, w, h } = surface;
    const queueWidth = w * 0.42;
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.fillText("等待进入对局", 24, 24);
    ctx.fillText("A 队", w * 0.61 - 10, 24);
    ctx.fillText("B 队", w * 0.86 - 10, 24);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(queueWidth, 42);
    ctx.lineTo(queueWidth, h - 24);
    ctx.stroke();
    const queued =
      this.data?.players.filter((player) => player.inQueue && player.alive) ||
      [];
    const visible = queued.slice(0, 90);
    const cols = w < 550 ? 6 : 10;
    const dotPosition = (index) => [
      24 + (index % cols) * ((queueWidth - 48) / (cols - 1)),
      58 + Math.floor(index / cols) * ((h - 93) / Math.ceil(90 / cols)),
    ];
    if (!visible.length) {
      ctx.fillStyle = "#63776a";
      ctx.font = '12px "Segoe UI", sans-serif';
      if (w < 550 && !this.data?.matches) {
        ctx.fillText("运行模拟", 24, h / 2 - 8);
        ctx.fillText("玩家开始入队", 24, h / 2 + 12);
      } else
        ctx.fillText(
          this.data?.matches ? "等待下一批玩家" : "运行模拟，玩家开始入队",
          24,
          h / 2,
        );
    }
    for (const dot of this.poolDots.values()) dot.targetAlpha = 0;
    visible.forEach((player, index) => {
      const [x, y] = dotPosition(index);
      let dot = this.poolDots.get(player.id);
      if (!dot) {
        dot = { x, y, alpha: 0 };
        this.poolDots.set(player.id, dot);
      }
      Object.assign(dot, { targetX: x, targetY: y, targetAlpha: 1, player });
    });
    const smoothing = this.reduced.matches || !this.running ? 1 : 0.18;
    for (const [id, dot] of this.poolDots) {
      dot.x += (dot.targetX - dot.x) * smoothing;
      dot.y += (dot.targetY - dot.y) * smoothing;
      dot.alpha += (dot.targetAlpha - dot.alpha) * smoothing;
      if (dot.alpha < 0.01 && !dot.targetAlpha) {
        this.poolDots.delete(id);
        continue;
      }
      const { player } = dot;
      ctx.globalAlpha = dot.alpha;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, player.isNewbie ? 3.4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = player.smurf
        ? "#d6b783"
        : player.wait > 8
          ? COLORS.a
          : "#688573";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(
      queued.length > 90
        ? `展示前 90 位 / 共 ${queued.length} 位`
        : `${queued.length} 位玩家正在排队`,
      24,
      h - 10,
    );
    if (
      this.running &&
      (!this.activeMatch || time - this.matchStarted > 850) &&
      this.pending.length
    ) {
      this.activeMatch = this.pending.shift();
      this.matchStarted = time;
    }
    const match = this.activeMatch;
    const progress =
      this.reduced.matches || !this.running
        ? 1
        : ease((time - this.matchStarted) / 650);
    const targets = [w * 0.61, w * 0.86];
    ctx.textAlign = "center";
    ctx.fillStyle = "#718478";
    ctx.font = "12px monospace";
    ctx.fillText("vs", w * 0.735, h * 0.52);
    for (let side = 0; side < 2; side++) {
      const ids = match ? (side === 0 ? match.a : match.b) : [];
      const color = side === 0 ? COLORS.a : COLORS.b;
      for (let index = 0; index < 3; index++) {
        const tx = targets[side],
          ty = 65 + index * ((h - 115) / 2);
        ctx.beginPath();
        ctx.arc(tx, ty, 21, 0, Math.PI * 2);
        ctx.strokeStyle = "#3b4b41";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (ids[index] === undefined) {
          ctx.font = "12px monospace";
          ctx.fillStyle = "#4d6254";
          ctx.fillText("?", tx, ty + 4);
          continue;
        }
        const id = ids[index],
          [sx, sy] = dotPosition(id % 90);
        const x = sx + (tx - sx) * progress,
          y = sy + (ty - sy) * progress - Math.sin(progress * Math.PI) * 18;
        if (progress < 1 && !this.reduced.matches) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo((sx + tx) / 2, (sy + ty) / 2 - 30, x, y);
          ctx.strokeStyle = side === 0 ? "#38594a" : "#3d4865";
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, 19, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.panel;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = '10px "Consolas", monospace';
        ctx.fillStyle = color;
        ctx.fillText(`P${String(id).padStart(3, "0")}`, x, y + 3.5);
        if (progress > 0.98) {
          ctx.fillStyle = "#94a79a";
          ctx.font = '10px "Consolas", monospace';
          ctx.fillText(
            String(Math.round(this.players?.get(id)?.rating || 0)),
            tx,
            ty + 34,
          );
        }
      }
    }
    ctx.textAlign = "left";
    const result = document.getElementById("arena-result");
    const label = match
      ? `#${match.id.toLocaleString("zh-CN")} · ${match.aWins ? "A" : "B"} 队胜`
      : "等待第一场对局";
    if (result.textContent !== label) result.textContent = label;
  }
  axes(
    surface,
    {
      min = 0,
      max = 1,
      xMax = 100,
      format = (value) => value.toFixed(2),
      xMin = 0,
    } = {},
  ) {
    const { ctx, w, h } = surface,
      area = { left: 43, right: w - 18, top: 15, bottom: h - 27 };
    ctx.font = '10px "Consolas", monospace';
    ctx.fillStyle = COLORS.text;
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= 4; i++) {
      const y = area.bottom - ((area.bottom - area.top) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.strokeStyle = COLORS.grid;
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(format(min + ((max - min) * i) / 4), area.left - 9, y + 3);
    }
    for (let i = 0; i <= 3; i++) {
      const x = area.left + ((area.right - area.left) * i) / 3;
      ctx.textAlign = i === 0 ? "left" : i === 3 ? "right" : "center";
      ctx.fillText(
        Math.round(xMin + ((xMax - xMin) * i) / 3).toLocaleString("zh-CN"),
        x,
        area.bottom + 19,
      );
    }
    ctx.textAlign = "left";
    return {
      ...area,
      x: (value) =>
        area.left +
        ((value - xMin) / Math.max(1, xMax - xMin)) * (area.right - area.left),
      y: (value) =>
        area.bottom -
        ((value - min) / Math.max(0.0001, max - min)) *
          (area.bottom - area.top),
    };
  }
  line(id, series, settings, time) {
    const surface = this.surface(id);
    if (!surface) return;
    const { ctx, w, h } = surface;
    const xMax = Math.max(
      1,
      ...series.map((line) => line.points.at(-1)?.x || 0),
    );
    const axis = this.axes(surface, { ...settings, xMax });
    if (!series.some((line) => line.points.length)) {
      this.empty(surface);
      return;
    }
    if (settings.target !== undefined) {
      const y = axis.y(settings.target);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = "#637b6a";
      ctx.beginPath();
      ctx.moveTo(axis.left, y);
      ctx.lineTo(axis.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const t = this.reduced.matches ? 1 : ease((time - this.updatedAt) / 160);
    series.forEach(({ points, color, previous = [] }) => {
      if (!points.length) return;
      const old = new Map(previous.map((p) => [p.x, p.y]));
      const plotted = points.map((p) => ({
        x: p.x,
        y: (old.get(p.x) ?? previous.at(-1)?.y ?? p.y) * (1 - t) + p.y * t,
      }));
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        axis.left,
        axis.top,
        axis.right - axis.left + 3,
        axis.bottom - axis.top + 3,
      );
      ctx.clip();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      plotted.forEach((p, index) =>
        index
          ? ctx.lineTo(axis.x(p.x), axis.y(p.y))
          : ctx.moveTo(axis.x(p.x), axis.y(p.y)),
      );
      ctx.stroke();
      const last = plotted.at(-1);
      ctx.beginPath();
      ctx.arc(axis.x(last.x), axis.y(last.y), 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    });
  }
  empty({ ctx, w, h }) {
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("运行模拟，观察数据变化", w / 2, h / 2);
    ctx.textAlign = "left";
  }
  drawCharts(time) {
    const points = (snap, key) =>
      snap?.history
        .filter((p) => Number.isFinite(p[key]))
        .map((p) => ({ x: p.matches, y: p[key] })) || [];
    if (this.tab === "compare") {
      const data = this.comparison || [];
      for (const [id, key, settings] of [
        [
          "compare-corr",
          "corr",
          { min: -0.1, max: 1, format: (v) => v.toFixed(2) },
        ],
        [
          "compare-dev",
          "recentDev",
          {
            min: 0,
            max: 0.4,
            format: (v) => `${Math.round(v * 100)}%`,
            target: this.config?.convDev,
          },
        ],
        [
          "compare-retention",
          "retention",
          { min: 0, max: 1, format: (v) => `${Math.round(v * 100)}%` },
        ],
      ]) {
        this.line(
          id,
          data.length
            ? data.map((snap, i) => ({
                points: points(snap, key),
                color: i ? COLORS.b : COLORS.a,
              }))
            : [],
          settings,
          time,
        );
      }
      return;
    }
    const current = this.data,
      old = this.previous;
    this.line(
      "chart-corr",
      [
        {
          points: points(current, "corr"),
          previous: points(old, "corr"),
          color: COLORS.a,
        },
      ],
      { min: -0.1, max: 1, format: (v) => v.toFixed(2) },
      time,
    );
    this.line(
      "chart-dev",
      [
        {
          points: points(current, "recentDev"),
          previous: points(old, "recentDev"),
          color: COLORS.a,
        },
      ],
      {
        min: 0,
        max: Math.max(0.3, ...(current?.history.map((p) => p.recentDev) || [])),
        format: (v) => `${Math.round(v * 100)}%`,
        target: this.config?.convDev,
      },
      time,
    );
    this.histogram(time);
    this.scatter(time);
  }
  histogram(time) {
    const surface = this.surface("chart-hist");
    if (!surface) return;
    const bins = this.data?.winBins || [],
      max = Math.max(4, ...bins.map((bin) => bin.count));
    const { ctx } = surface,
      axis = this.axes(surface, {
        min: 0,
        max,
        xMax: 100,
        format: (v) => String(Math.round(v)),
      });
    if (!this.data?.metricsPlayers) {
      this.empty(surface);
      return;
    }
    const width = (axis.right - axis.left) / 10;
    const progress =
      this.reduced.matches || !this.running
        ? 1
        : ease((time - this.updatedAt) / 160);
    bins.forEach((bin, index) => {
      const previous = this.previous?.winBins[index]?.count ?? bin.count;
      const y = axis.y(previous + (bin.count - previous) * progress);
      ctx.fillStyle = index === 4 || index === 5 ? COLORS.a : COLORS.base;
      ctx.beginPath();
      ctx.roundRect(
        axis.left + index * width + 3,
        y,
        Math.max(1, width - 6),
        Math.max(0, axis.bottom - y),
        [3, 3, 0, 0],
      );
      ctx.fill();
    });
  }
  scatter(time) {
    const surface = this.surface("chart-scatter");
    if (!surface) return;
    const players =
      this.data?.players.filter(
        (p) => p.g >= (this.config?.minGamesForMetric || 8),
      ) || [];
    const skills = players.flatMap((p) => [p.ts, p.estimate]);
    const low = players.length
      ? Math.floor(Math.min(...skills) / 200) * 200
      : 500;
    const high = players.length
      ? Math.ceil(Math.max(...skills) / 200) * 200 + 1
      : 2500;
    const { ctx } = surface,
      axis = this.axes(surface, {
        min: low,
        max: high,
        xMin: low,
        xMax: high,
        format: (v) => String(Math.round(v)),
      });
    if (!players.length) {
      this.empty(surface);
      return;
    }
    ctx.strokeStyle = "#576e5e";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(axis.x(low), axis.y(low));
    ctx.lineTo(axis.x(high), axis.y(high));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.55;
    const progress =
      this.reduced.matches || !this.running
        ? 1
        : ease((time - this.updatedAt) / 160);
    const previous = new Map(
      this.previous?.players.map((player) => [player.id, player]) || [],
    );
    for (const player of players) {
      const old = previous.get(player.id) || player;
      ctx.beginPath();
      ctx.arc(
        axis.x(old.ts + (player.ts - old.ts) * progress),
        axis.y(old.estimate + (player.estimate - old.estimate) * progress),
        2.1,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = player.cheater ? "#d6b783" : COLORS.a;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
