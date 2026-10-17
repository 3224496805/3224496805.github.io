import "./style.css";
import { DEFAULT_CONFIG } from "./defaults.js";
import { FIELD_GROUPS, SCHEMES, schemeConfig } from "./config.js";
import { Visuals } from "./visuals.js";

const $ = (selector) => document.querySelector(selector);
const number = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "暂无数据";
const percent = (value, digits = 1) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "暂无数据";
const options = (selected) =>
  Object.entries(SCHEMES)
    .map(
      ([key, value]) =>
        `<option value="${key}" ${key === selected ? "selected" : ""}>${value.name}</option>`,
    )
    .join("");
let config = { ...DEFAULT_CONFIG };
let snapshot = null,
  comparison = null,
  running = false,
  tab = "sim";
let schemes = ["elo", "full"];
let comparisonOverrides = [{}, {}];
let page = 1,
  sortKey = "rating",
  sortDirection = -1,
  lastTableUpdate = 0;
let lastRateTime = performance.now(),
  lastRateMatches = 0,
  rate = 0;
let toastTimer;

function field([key, label, min, max, step, unit = ""]) {
  if (typeof DEFAULT_CONFIG[key] === "boolean")
    return `<label class="switch-row" for="cfg-${key}"><span>${label}</span><input id="cfg-${key}" data-key="${key}" type="checkbox" role="switch" ${config[key] ? "checked" : ""}></label>`;
  return `<div class="field"><div class="field-label"><label for="cfg-${key}">${label}</label><output id="out-${key}" for="cfg-${key}">${config[key]}${unit ? ` ${unit}` : ""}</output></div><input id="cfg-${key}" data-key="${key}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}" value="${config[key]}"></div>`;
}

function comparisonTuning(index) {
  const cfg = {
    ...schemeConfig(config, schemes[index]),
    ...comparisonOverrides[index],
  };
  const keys = [
    "kBase",
    "formCorr",
    "osSigma0",
    "osZ",
    "streakBoost",
    "streakDamp",
    "perfBlend",
    "muCap",
    "psychoOn",
    "churnOn",
    "moodRate",
    "moodTol",
    "engageTilt",
    "shadowOn",
  ];
  return (
    FIELD_GROUPS.flatMap(([, fields]) => fields)
      .filter(
        ([key]) =>
          keys.includes(key) &&
          (["kBase"].includes(key)
            ? cfg.preset === "elo"
            : key === "formCorr"
              ? cfg.preset === "form"
              : ["osSigma0", "osZ", "muCap", "streakDamp"].includes(key)
                ? ["openskill", "full"].includes(cfg.preset)
                : true),
      )
      .map(([key, label, min, max, step]) => {
        const id = `cmp-${index}-${key}`;
        if (typeof cfg[key] === "boolean")
          return `<label class="switch-row" for="${id}"><span>${label}</span><input id="${id}" data-compare-key="${key}" data-side="${index}" type="checkbox" role="switch" ${cfg[key] ? "checked" : ""}></label>`;
        return `<div class="field"><div class="field-label"><label for="${id}">${label}</label><output id="out-${id}" for="${id}">${cfg[key]}</output></div><input id="${id}" data-compare-key="${key}" data-side="${index}" type="range" min="${min}" max="${max}" step="${step}" value="${cfg[key]}"></div>`;
      })
      .join("") +
    `<label class="select-label" for="cmp-${index}-policy">撮合策略</label><select id="cmp-${index}-policy" data-compare-policy="${index}"><option value="nearest" ${cfg.matchPolicy === "nearest" ? "selected" : ""}>优先分数接近</option><option value="engage" ${cfg.matchPolicy === "engage" ? "selected" : ""}>结合情绪撮合</option></select>`
  );
}

document.getElementById("root").innerHTML = `
  <header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">3<span>v</span>3</span><div><h1>3v3 PvP 匹配机制模拟器</h1><p>让每一场对局，都有据可循。</p></div></div><div class="top-actions"><span class="engine-status" id="engine-status">正在载入引擎</span><button class="quiet" id="export" aria-label="导出实验"><span class="desktop-label">导出实验</span><span class="mobile-label">导出</span></button><button class="quiet mobile-settings" id="settings-toggle" aria-expanded="false">实验参数</button></div></header>
  <nav class="tabs" aria-label="主导航" role="tablist">
    <button id="tab-sim" role="tab" aria-controls="view-sim" aria-selected="true" data-tab="sim">模拟控制台</button>
    <button id="tab-players" role="tab" aria-controls="view-players" aria-selected="false" tabindex="-1" data-tab="players">玩家明细</button>
    <button id="tab-compare" role="tab" aria-controls="view-compare" aria-selected="false" tabindex="-1" data-tab="compare">A/B 方案对比</button>
    <button id="tab-fullplan" role="tab" aria-controls="view-fullplan" aria-selected="false" tabindex="-1" data-tab="fullplan">完整方案</button>
    <span class="nav-caption">3 人成队 · 真实过程 · 可复现实验</span>
  </nav>
  <div class="workspace"><aside class="sidebar" aria-label="实验参数">
    <div class="sidebar-title"><h2>实验参数</h2><span class="small-label">CONFIGURATION</span></div>
    <div class="primary-config"><label class="select-label" for="preset">评分方案</label><select id="preset"><option value="elo">经典 Elo</option><option value="form">纯表现分</option><option value="openskill" selected>OpenSkill ordinal</option><option value="full">完整方案</option></select>
      <p class="scheme-hint" id="scheme-hint">贝叶斯水平估计，兼顾实力与确定度。</p>
      ${field(["playerCount", "初始玩家数", 30, 1000, 10, "人"])}
      <div class="seed-row"><label for="seed">随机种子</label><input id="seed" type="number" min="0" max="2147483647" step="1" value="42"><button class="text-button" id="new-seed" aria-label="换一批玩家">换一批</button></div>
      <label class="select-label" for="skill-dist">玩家水平分布</label><select id="skill-dist"><option value="normal">正态分布</option><option value="uniform">均匀分布</option><option value="tiers">分层分布</option></select>
      <div class="world-presets"><button data-world="static" class="chip">静态世界</button><button data-world="drift" class="chip">漂移世界</button></div>
    </div>
    <p class="config-note">更换玩家群体或评分方案会重开实验。其他参数即时生效。</p>
    ${FIELD_GROUPS.map(([name, fields]) => `<details class="config-group"><summary>${name}<span aria-hidden="true">+</span></summary><div class="group-fields">${fields.map(field).join("")}${name === "匹配规则" ? '<label class="select-label" for="match-policy">撮合策略</label><select id="match-policy"><option value="nearest">优先分数接近</option><option value="engage">结合情绪撮合</option></select>' : ""}</div></details>`).join("")}
    <div class="sidebar-footer"><strong>同种子，可复现。</strong><p>世界随机事件独立于结算方案；模拟运算在后台进行。</p></div>
  </aside><main>
    <div class="page-heading"><div><p class="eyebrow">MATCHMAKING LAB</p><h2 id="page-title">观察一场好对局的形成</h2><p id="page-description">从玩家入队到评分收敛，把匹配机制放进同一个实验。</p></div><div class="run-state"><span id="state-light" class="state-light"></span><span id="run-label">已就绪</span></div></div>
    <section class="transport" aria-label="模拟运行控制"><div class="transport-buttons"><button id="run" class="primary" disabled><span aria-hidden="true">▶</span> 运行模拟</button><button id="step" class="secondary">步进 ×10</button><button id="reset" class="quiet">重置</button><button id="inject" class="quiet">注入 10 个新手</button></div><div class="speed-control"><label for="speed">模拟速度</label><input type="range" id="speed" min="10" max="400" step="10" value="100"><output id="speed-value" for="speed">100 <span>tick/s</span></output></div></section>

    <section id="view-sim" class="view" role="tabpanel" aria-labelledby="tab-sim">
      <div class="metrics"><article class="metric"><span>累计完成对局</span><strong id="metric-matches">0</strong><small id="metric-rate">等待开始模拟</small></article><article class="metric"><span>水平估计相关度</span><strong id="metric-corr">待采样</strong><small id="metric-sample">参赛满 8 场后纳入统计</small></article><article class="metric"><span>对局均衡度</span><strong id="metric-fair">待采样</strong><small>强队理论胜率，越接近 50% 越均衡</small></article><article class="metric"><span>平均排队时长</span><strong id="metric-wait">待采样</strong><small id="metric-p95">单位 tick，与播放速度无关</small></article></div>
      <article class="panel arena-panel"><div class="panel-heading"><div><h3>实时匹配</h3><p>最近完成对局的抽样回放</p></div><div class="arena-legend"><span class="legend-a">A 队</span><span class="legend-b">B 队</span><span id="arena-result">等待第一场对局</span></div></div><canvas id="arena" aria-label="玩家排队与 3v3 分队过程的实时动画" role="img"></canvas><div class="arena-footer"><span><i class="queue-dot"></i>待匹配 <b id="queue-count">0</b> 人</span><span>活跃 <b id="alive-count">300 / 300</b></span><span>模拟时间 <b id="tick-count">0</b> tick</span><span id="compute-cost">后台引擎已就绪</span></div></article>
      <div class="chart-grid"><article class="panel chart-panel"><div class="panel-heading"><div><h3>评分是否越来越准确</h3><p>水平估计与真实实力的相关度</p></div><span class="chart-value" id="chart-corr-value">待采样</span></div><canvas id="chart-corr" role="img" aria-label="评分相关度随累计对局数的变化"></canvas><div class="chart-foot"><span>累计对局</span><span>越接近 1 越准确</span></div></article><article class="panel chart-panel"><div class="panel-heading"><div><h3>胜率是否趋于均衡</h3><p>近期胜率偏离 50% 的平均幅度</p></div><span class="chart-value" id="chart-dev-value">待采样</span></div><canvas id="chart-dev" role="img" aria-label="近期胜率偏差的收敛曲线"></canvas><div class="chart-foot"><span>累计对局</span><span id="dev-target">目标 ≤ 7%</span></div></article><article class="panel chart-panel"><div class="panel-heading"><div><h3>玩家胜率分布</h3><p>参赛达到最低场次的玩家</p></div><span class="small-label" id="hist-sample">0 位玩家</span></div><canvas id="chart-hist" role="img" aria-label="玩家胜率区间直方图"></canvas><div class="chart-foot"><span>生涯胜率</span><span id="within-value">45-55% 占比：待采样</span></div></article><article class="panel chart-panel"><div class="panel-heading"><div><h3>真实实力与水平估计</h3><p>每个点代表一位已参赛玩家</p></div><span class="small-label" id="track-error">待采样</span></div><canvas id="chart-scatter" role="img" aria-label="真实水平与水平估计的散点图"></canvas><div class="chart-foot"><span>横轴：真实水平</span><span>纵轴：水平估计</span></div></article></div>
      <article class="panel diagnostics"><div class="panel-heading"><div><h3>玩家生态</h3><p>观察胜率之外的机制影响</p></div><span class="small-label" id="convergence">尚未收敛</span></div><div class="diagnostic-grid" id="diagnostics"></div></article>
    </section>

    <section id="view-players" class="view" role="tabpanel" aria-labelledby="tab-players" hidden><article class="panel players-panel"><div class="panel-heading"><div><h3>每一位玩家的轨迹</h3><p>匹配分与实际撮合保持一致；水平估计单独展示。</p></div><span class="small-label" id="player-total">300 位玩家</span></div><div class="table-controls"><label class="search-field"><span>搜索</span><input id="player-search" placeholder="输入玩家编号" type="search"></label><label class="filter-field"><span>状态</span><select id="player-filter"><option value="all">全部玩家</option><option value="queue">正在排队</option><option value="newbie">注入的新手</option><option value="flagged">隔离与过渡池</option><option value="inactive">已弃坑</option></select></label></div><div class="table-scroll"><table><thead><tr>${[
      ["id", "玩家"],
      ["ts", "真实水平"],
      ["rating", "匹配分"],
      ["estimate", "水平估计"],
      ["sigma", "σ"],
      ["g", "场次"],
      ["wr", "胜率"],
      ["streak", "连胜 / 连败"],
    ]
      .map(
        ([key, label]) =>
          `<th scope="col" data-sort="${key}"><button>${label}<span aria-hidden="true">${key === "rating" ? " ↓" : ""}</span></button></th>`,
      )
      .join(
        "",
      )}<th scope="col">近 10 场</th><th scope="col">状态</th></tr></thead><tbody id="player-rows"></tbody></table></div><div class="table-pagination"><span id="page-info"></span><div><button id="previous-page" class="quiet">上一页</button><button id="next-page" class="quiet">下一页</button></div></div></article></section>

    <section id="view-compare" class="view" role="tabpanel" aria-labelledby="tab-compare" hidden><div class="compare-note"><strong>同一批初始玩家，同一套世界参数。</strong><p>方案可以改变结算、撮合与情绪机制。更换方案会暂停并重开对比，结果按各自累计对局展示。</p></div><div class="comparison-cards">${["A", "B"].map((label, index) => `<article class="panel comparison-card side-${label.toLowerCase()}"><div class="comparison-title"><span class="team-letter">${label}</span><label for="scheme-${index}">方案 ${label}</label><select id="scheme-${index}" data-scheme="${index}">${options(schemes[index])}</select></div><div id="compare-stats-${index}" class="compare-stats"></div><details class="compare-tuning"><summary>微调方案参数</summary><div id="compare-tuning-${index}" class="group-fields">${comparisonTuning(index)}</div></details></article>`).join("")}</div><div class="chart-grid compare-charts">${[
      ["compare-corr", "水平估计相关度", "越接近 1 越准确"],
      ["compare-dev", "近期胜率偏差", "越低越均衡"],
      [
        "compare-retention",
        "活跃玩家占比",
        "当前活跃人数 / 初始群体与注入人数",
      ],
    ]
      .map(
        ([id, title, note]) =>
          `<article class="panel chart-panel"><div class="panel-heading"><div><h3>${title}</h3><p>${note}</p></div><div class="arena-legend"><span class="legend-a">A</span><span class="legend-b">B</span></div></div><canvas id="${id}" role="img" aria-label="A B 方案${title}对比曲线"></canvas><div class="chart-foot"><span>累计对局</span><span>同种子 ${config.seed}</span></div></article>`,
      )
      .join(
        "",
      )}</div><p class="method-note">这是机制模拟实验。单次运行用于观察趋势；对外报告结论时，请导出配置并用多个种子重复实验。</p></section>

    <section id="view-fullplan" class="view" role="tabpanel" aria-labelledby="tab-fullplan" hidden><article class="panel plan-intro"><p class="eyebrow">SCORING & MATCHMAKING</p><h3>把实力估计、段位体验和风险隔离分开设计。</h3><p>完整方案在 OpenSkill 水平估计之上，加入定段赛、段位地板、情绪修正与反作弊隔离。每一项都可以在实验参数中单独观察。</p><button id="use-full" class="primary">使用完整方案</button></article><div class="plan-grid"><article class="panel plan-section"><span class="plan-index">μ / σ</span><h3>先估计实力，再表达确定度</h3><p>μ 表示水平估计，σ 表示不确定度。OpenSkill 使用两支三人队伍的胜负更新这两个量。</p><code>R = μ − z × σ</code><p>β = σ₀ / 2，τ = σ₀ / 100。连胜与负面情绪可以向 σ 注入噪声；离线回涨后也立即同步 R。</p></article><article class="panel plan-section"><span class="plan-index">400 → 2400</span><h3>定段赛与正常段位</h3><p>定段赛从 400 开始，前段胜场 +160、败场不扣分；随后采用 +160 / −40。达到条件或参赛满 40 场后毕业。</p><p>正常区跟随底层 R 的变化，每场最多变动 200 分，段位地板为 1800。7000 分以上采用 +80 / −20，因此长期存在分数膨胀。</p></article><article class="panel plan-section"><span class="plan-index">3 个风险池</span><h3>正常、过渡与隔离</h3><p>检测首次命中进入过渡池，多次命中进入隔离池。相同风险池内撮合，正常玩家可通过申诉恢复。</p><p>“世界中存在作弊玩家”和“启用反作弊隔离池”独立控制，便于在相同作弊环境下比较防护效果。</p></article><article class="panel plan-section"><span class="plan-index">可复现实验</span><h3>让比较有共同起点</h3><p>每位玩家使用独立的初始随机流；入队、漂移、表现与检测使用按玩家和时间索引的随机事件。</p><p>双方初始实力与群体属性一致。匹配策略改变后的对手、参赛次数和情绪仍会自然分化，这是方案本身产生的结果。</p></article></div><details class="panel formula-details"><summary>查看经典 Elo 与纯表现分公式</summary><div><h3>经典团队 Elo</h3><code>E_A = 1 / (1 + 10 ^ (−(mean(R_A) − mean(R_B)) / scale))</code><p>两队使用同一份赛前期望，分别计算 K × (结果 − 期望) 后统一结算。没有额外加成且失分系数为 1 时，总分守恒。</p><h3>纯表现分</h3><p>用真实实力信号与单场发挥噪声的加权混合生成表现评分，再以 EMA 平滑。参数 formCorr 为混合权重，并非保证最终统计相关系数等于该值。</p></div></details></section>
    <footer class="workspace-footer"><span>所有运算在本地浏览器完成</span><span id="footer-config">种子 42 · OpenSkill ordinal</span></footer>
  </main></div><div id="toast" class="toast" role="status" aria-live="polite"></div>`;

const visuals = new Visuals();
const worker = new Worker(new URL("./simulation.worker.js", import.meta.url), {
  type: "module",
});
const send = (type, payload = {}) => worker.postMessage({ type, ...payload });

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3200);
}

function syncConfig() {
  for (const input of document.querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    if (input.type === "checkbox") input.checked = config[key];
    else {
      input.value = config[key];
      $(`#out-${key}`).textContent =
        `${config[key]}${input.dataset.unit ? ` ${input.dataset.unit}` : ""}`;
    }
  }
  const scoring = {
    elo: [
      "kBase",
      "scale",
      "lossFactor",
      "streakBoost",
      "streakDamp",
      "perfBlend",
    ],
    form: ["formCorr", "formAlpha", "perfBlend"],
    openskill: [
      "osSigma0",
      "osZ",
      "streakBoost",
      "streakDamp",
      "perfBlend",
      "muCap",
    ],
    full: ["osSigma0", "osZ", "streakBoost", "streakDamp", "muCap"],
  };
  for (const input of document
    .querySelector(".config-group")
    .querySelectorAll("[data-key]"))
    input.closest(".field, .switch-row").hidden = !scoring[
      config.preset
    ].includes(input.dataset.key);
  $(".config-note").textContent =
    tab === "compare"
      ? "两组共用世界参数。修改世界参数或任一方案，会暂停并重开对比。"
      : "更换玩家群体或评分方案会重开实验。其他参数即时生效。";
  $("#seed").value = config.seed;
  $("#preset").value = config.preset;
  $("#skill-dist").value = config.skillDist;
  $("#match-policy").value = config.matchPolicy;
  $("#scheme-hint").textContent = {
    elo: "胜负驱动的团队评分，使用赛前分数统一结算。",
    form: "从每场表现估计水平，不依赖胜负纠错。",
    openskill: "贝叶斯水平估计，兼顾实力与确定度。",
    full: "OpenSkill + 定段赛 + 情绪 + 风险隔离。",
  }[config.preset];
  $("#footer-config").textContent =
    `种子 ${config.seed} · ${$("#preset").selectedOptions[0].textContent}`;
  $("#dev-target").textContent = `目标 ≤ ${percent(config.convDev, 0)}`;
  document
    .querySelectorAll("#view-compare .chart-foot span:last-child")
    .forEach((el) => (el.textContent = `同种子 ${config.seed}`));
}

function changeTab(next) {
  const previousMode = tab === "compare" ? "compare" : "sim";
  tab = next;
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", active);
    button.tabIndex = active ? 0 : -1;
  }
  for (const view of document.querySelectorAll(".view"))
    view.hidden = view.id !== `view-${tab}`;
  const headings = {
    sim: [
      "观察一场好对局的形成",
      "从玩家入队到评分收敛，把匹配机制放进同一个实验。",
    ],
    players: [
      "从群体曲线，走近每位玩家",
      "查看真实实力、匹配分和近期表现，理解个体差异。",
    ],
    compare: [
      "让两个方案，站在同一起点",
      "用可复现的玩家群体，观察不同机制带来的变化。",
    ],
    fullplan: [
      "读懂每一项机制的取舍",
      "从实力估计到段位体验，了解完整方案如何运作。",
    ],
  };
  $("#page-title").textContent = headings[tab][0];
  $("#page-description").textContent = headings[tab][1];
  $(".transport").hidden = tab === "fullplan";
  const nextMode = tab === "compare" ? "compare" : "sim";
  if (previousMode !== nextMode) send("mode", { mode: nextMode });
  if (tab === "fullplan") send("run", { running: false });
  if (tab === "players") renderPlayers();
  $("#preset").disabled = tab === "compare";
  document.querySelector(".config-group").hidden = tab === "compare";
  syncConfig();
  visuals.setTab(tab);
}

function renderMetrics(data) {
  const sampled = data.metricsPlayers > 0 && Number.isFinite(data.corr);
  $("#metric-matches").textContent = number(data.matches);
  $("#metric-rate").textContent = running
    ? `${number(rate)} 场 / 秒 · 实时计算`
    : data.matches
      ? "实验已暂停，可继续运行"
      : "等待开始模拟";
  $("#metric-corr").textContent = sampled ? data.corr.toFixed(3) : "待采样";
  $("#metric-sample").textContent =
    `${data.metricsPlayers} 位达标玩家 · 最少 ${config.minGamesForMetric} 场`;
  $("#metric-fair").textContent = data.history.length
    ? percent(data.favProb)
    : "待采样";
  $("#metric-wait").innerHTML = data.matches
    ? `${number(data.avgWait, 1)}<em> tick</em>`
    : "待采样";
  $("#metric-p95").textContent =
    data.p95Wait !== null
      ? `近期 P95 排队 ${number(data.p95Wait)} tick`
      : "单位 tick，与播放速度无关";
  $("#queue-count").textContent = number(data.queueLen);
  $("#alive-count").textContent = `${data.aliveCount} / ${data.players.length}`;
  $("#tick-count").textContent = number(data.tick);
  $("#chart-corr-value").textContent = sampled
    ? data.corr.toFixed(3)
    : "待采样";
  $("#chart-dev-value").textContent = data.players.some(
    (p) => p.g >= config.recentWin,
  )
    ? percent(data.recentDev)
    : "待采样";
  $("#hist-sample").textContent = `${data.metricsPlayers} 位玩家`;
  $("#within-value").textContent =
    `45-55% 占比：${sampled ? percent(data.withinBandPct, 0) : "待采样"}`;
  $("#track-error").textContent = sampled
    ? `平均误差 ${number(data.trackErr)} 分`
    : "待采样";
  $("#convergence").textContent =
    data.convergedAt !== null
      ? `第 ${number(data.convergedAt)} 场达到收敛条件`
      : "尚未收敛";
  const newbieWr = data.history.at(-1)?.newbieWr;
  $("#diagnostics").innerHTML = [
    [
      "活跃玩家",
      `${data.aliveCount} / ${data.players.length}`,
      `累计弃坑事件 ${data.churnTotal}`,
    ],
    [
      "平均情绪",
      config.psychoOn ? number(data.moodAvg, 1) : "未启用",
      "负值表示挫败，正值表示兴奋",
    ],
    [
      "新手群体",
      data.newbieCount ? `${data.newbieCount} 人` : "尚未注入",
      data.newbieCount
        ? `累计参赛 ${data.newbieGames} 人次 · 胜率 ${percent(newbieWr)}`
        : "可在工具栏注入 10 个新手",
    ],
    [
      "回坑定位误差",
      data.returnErr !== null ? `${number(data.returnErr)} 分` : "暂无样本",
      `全服最近 300 场内回归 ${data.returnCount} 人`,
    ],
    [
      "风险池",
      config.shadowOn ? data.zoneCounts.join(" / ") : "未启用",
      `隔离 / 过渡 / 正常 · 误伤 ${data.fpTotal}`,
    ],
    [
      "炸鱼影响",
      data.smurf ? `${data.smurf.stomps} 场碾压` : "未启用",
      data.smurf
        ? `受害 ${data.smurf.victims} 人次 · 关联弃坑 ${data.smurf.churn}`
        : "在实验参数中单独开启",
    ],
  ]
    .map(
      ([label, value, note]) =>
        `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
    )
    .join("");
}

function renderComparison() {
  if (!comparison) return;
  comparison.forEach((data, index) => {
    const sampled = data.metricsPlayers > 0 && Number.isFinite(data.corr);
    $(`#compare-stats-${index}`).innerHTML = [
      ["完成对局", number(data.matches)],
      ["评分相关度", sampled ? data.corr.toFixed(3) : "待采样"],
      [
        "近期偏差",
        data.players.some((p) => p.g >= config.recentWin)
          ? percent(data.recentDev)
          : "待采样",
      ],
      ["平均等待", data.matches ? `${number(data.avgWait, 1)} tick` : "待采样"],
      ["活跃占比", percent(data.aliveCount / data.players.length)],
      [
        "收敛对局",
        data.convergedAt === null ? "未收敛" : number(data.convergedAt),
      ],
    ]
      .map(
        ([label, value]) =>
          `<div><span>${label}</span><strong>${value}</strong></div>`,
      )
      .join("");
  });
}

function renderPlayers() {
  if (!snapshot) return;
  const query = $("#player-search").value.trim(),
    filter = $("#player-filter").value;
  let players = snapshot.players.filter(
    (p) =>
      (!query || String(p.id).includes(query)) &&
      (filter === "all" ||
        (filter === "queue" && p.inQueue) ||
        (filter === "newbie" && p.isNewbie) ||
        (filter === "flagged" && p.zone < 2) ||
        (filter === "inactive" && !p.alive)),
  );
  const value = (p) => (sortKey === "wr" ? (p.g ? p.w / p.g : 0) : p[sortKey]);
  players.sort((a, b) => sortDirection * (value(a) - value(b)) || a.id - b.id);
  const pages = Math.max(1, Math.ceil(players.length / 50));
  page = Math.min(page, pages);
  $("#player-total").textContent = `${snapshot.players.length} 位玩家`;
  $("#player-rows").innerHTML =
    players
      .slice((page - 1) * 50, page * 50)
      .map(
        (p) =>
          `<tr><td class="player-name">P${String(p.id).padStart(3, "0")}${p.isNewbie ? '<span class="newbie-tag">新手</span>' : ""}</td><td>${number(p.ts)}</td><td class="rating-cell">${number(p.rating)}</td><td>${number(p.estimate)}</td><td>${number(p.sigma)}</td><td>${p.g}</td><td>${p.g ? percent(p.w / p.g, 0) : "未参赛"}</td><td class="${p.streak > 0 ? "positive" : p.streak < 0 ? "negative" : ""}">${p.streak > 0 ? `${p.streak} 连胜` : p.streak < 0 ? `${-p.streak} 连败` : "0"}</td><td class="results">${p.lastResults
            .split("")
            .map(
              (r) =>
                `<i class="${r === "W" ? "won" : "lost"}" title="${r === "W" ? "胜" : "负"}">${r}</i>`,
            )
            .join(
              "",
            )}</td><td><span class="player-state ${p.inQueue ? "queued" : ""}">${!p.alive ? "已弃坑" : p.hiatus ? "休止" : p.zone === 0 ? "隔离池" : p.zone === 1 ? "过渡池" : p.inQueue ? `排队 ${p.wait}` : "空闲"}</span></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="10" class="empty-row">没有符合条件的玩家</td></tr>';
  $("#page-info").textContent =
    `第 ${page} / ${pages} 页 · ${players.length} 位玩家 · 每页 50 人`;
  $("#previous-page").disabled = page <= 1;
  $("#next-page").disabled = page >= pages;
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.setAttribute(
      "aria-sort",
      th.dataset.sort === sortKey
        ? sortDirection < 0
          ? "descending"
          : "ascending"
        : "none",
    );
    th.querySelector("span").textContent =
      th.dataset.sort === sortKey ? (sortDirection < 0 ? " ↓" : " ↑") : "";
  });
  lastTableUpdate = performance.now();
}

worker.onmessage = ({ data }) => {
  if (data.type === "error") {
    toast(data.message);
    running = false;
    $("#run").disabled = false;
    $("#engine-status").textContent = "引擎已暂停";
    $("#run").textContent = "▶ 运行模拟";
    return;
  }
  const configChanged = JSON.stringify(config) !== JSON.stringify(data.config);
  config = data.config;
  running = data.running;
  comparison = data.comparison;
  if (configChanged) syncConfig();
  $("#run").disabled = false;
  $("#run").innerHTML = running
    ? '<span aria-hidden="true">Ⅱ</span> 暂停模拟'
    : `<span aria-hidden="true">▶</span> ${tab === "compare" ? "运行对比" : "运行模拟"}`;
  $("#step").disabled = running;
  $("#run-label").textContent = running ? "正在模拟" : "已暂停";
  $("#state-light").classList.toggle("running", running);
  $("#engine-status").textContent = "后台引擎已连接";
  $("#compute-cost").textContent = `计算批次 ${number(data.computeMs, 1)} ms`;
  if (data.snapshot) {
    const now = performance.now();
    if (data.snapshot.matches < lastRateMatches) {
      lastRateMatches = 0;
      lastRateTime = now;
      rate = 0;
    }
    if (now - lastRateTime > 500) {
      rate =
        ((data.snapshot.matches - lastRateMatches) * 1000) /
        (now - lastRateTime);
      lastRateMatches = data.snapshot.matches;
      lastRateTime = now;
    }
    snapshot = data.snapshot;
    renderMetrics(snapshot);
    if (tab === "players" && performance.now() - lastTableUpdate > 300)
      renderPlayers();
  }
  if (data.comparison) renderComparison();
  visuals.update({ snapshot, comparison, running, config });
  if (data.configured)
    toast(
      data.restarted
        ? "群体或评分方案已更新，实验重新开始。"
        : tab === "compare"
          ? "参数已应用，对比已重开。"
          : "参数已生效，保留当前模拟进度。",
    );
};
worker.onerror = () => {
  $("#engine-status").textContent = "引擎载入失败";
  toast("模拟引擎载入失败，请刷新页面重试。");
};

$("#run").addEventListener("click", () => send("run", { running: !running }));
$("#step").addEventListener("click", () => send("step"));
$("#reset").addEventListener("click", () => {
  page = 1;
  send("reset");
  toast("已按相同种子重置实验。");
});
$("#inject").addEventListener("click", () => send("inject"));
$("#new-seed").addEventListener("click", () =>
  send("configure", { patch: { seed: Math.floor(Math.random() * 1e6) } }),
);
$("#seed").addEventListener("change", (event) => {
  const seed = Number(event.target.value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    event.target.value = config.seed;
    toast("种子请输入 0 到 2147483647 的整数。");
    return;
  }
  send("configure", { patch: { seed } });
});
$("#speed").addEventListener("input", (event) => {
  const speed = Number(event.target.value);
  $("#speed-value").innerHTML = `${speed} <span>tick/s</span>`;
  send("speed", { speed });
});
$(".sidebar").addEventListener("input", (event) => {
  const key = event.target.dataset.key;
  if (key && event.target.type === "range")
    $(`#out-${key}`).textContent =
      `${Number(event.target.value)}${event.target.dataset.unit ? ` ${event.target.dataset.unit}` : ""}`;
});
$(".sidebar").addEventListener("change", (event) => {
  const key = event.target.dataset.key;
  if (key)
    send("configure", {
      patch: {
        [key]:
          event.target.type === "checkbox"
            ? event.target.checked
            : Number(event.target.value),
      },
    });
});
$("#preset").addEventListener("change", (event) =>
  send("configure", { patch: schemeConfig(config, event.target.value) }),
);
$("#skill-dist").addEventListener("change", (event) =>
  send("configure", { patch: { skillDist: event.target.value } }),
);
$("#match-policy").addEventListener("change", (event) =>
  send("configure", { patch: { matchPolicy: event.target.value } }),
);
document.querySelectorAll("[data-world]").forEach((button) =>
  button.addEventListener("click", () =>
    send("configure", {
      patch:
        button.dataset.world === "static"
          ? { driftMag: 0, rustRate: 0, hiatusRate: 0 }
          : { driftMag: 80, rustRate: 0.008, hiatusRate: 0.001 },
    }),
  ),
);
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => changeTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll("[data-tab]")];
    const index = buttons.indexOf(button);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next].focus();
    changeTab(buttons[next].dataset.tab);
  });
});
document.querySelectorAll("[data-scheme]").forEach((select) =>
  select.addEventListener("change", () => {
    const side = Number(select.dataset.scheme);
    schemes[side] = select.value;
    comparisonOverrides[side] = {};
    $(`#compare-tuning-${side}`).innerHTML = comparisonTuning(side);
    send("schemes", { schemes, overrides: comparisonOverrides });
    toast("方案已更新，对比重新开始。");
  }),
);
$("#use-full").addEventListener("click", () => {
  send("configure", { patch: schemeConfig(config, "full") });
  changeTab("sim");
});
$("#player-search").addEventListener("input", () => {
  page = 1;
  renderPlayers();
});
$("#player-filter").addEventListener("change", () => {
  page = 1;
  renderPlayers();
});
document.querySelector("thead").addEventListener("click", (event) => {
  const th = event.target.closest("[data-sort]");
  if (!th) return;
  if (sortKey === th.dataset.sort) sortDirection *= -1;
  else {
    sortKey = th.dataset.sort;
    sortDirection = -1;
  }
  renderPlayers();
});
$("#previous-page").addEventListener("click", () => {
  page--;
  renderPlayers();
});
$("#next-page").addEventListener("click", () => {
  page++;
  renderPlayers();
});
$("#settings-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("settings-open");
  $("#settings-toggle").setAttribute("aria-expanded", open);
});
$("#export").addEventListener("click", () => {
  if (!snapshot) {
    toast("引擎准备完成后即可导出。");
    return;
  }
  const content = {
    version: 3,
    exportedAt: new Date().toISOString(),
    mode: tab === "compare" ? "compare" : "sim",
    config,
    schemes,
    comparisonOverrides,
    results: tab === "compare" ? comparison : snapshot,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `3v3-seed-${config.seed}-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("已导出配置、种子和本次实验结果。");
});

$(".comparison-cards").addEventListener("input", (event) => {
  const key = event.target.dataset.compareKey;
  if (key && event.target.type === "range")
    $(`#out-${event.target.id}`).textContent = Number(event.target.value);
});
$(".comparison-cards").addEventListener("change", (event) => {
  const key = event.target.dataset.compareKey,
    policy = event.target.dataset.comparePolicy;
  if (key)
    comparisonOverrides[Number(event.target.dataset.side)][key] =
      event.target.type === "checkbox"
        ? event.target.checked
        : Number(event.target.value);
  else if (policy !== undefined)
    comparisonOverrides[Number(policy)].matchPolicy = event.target.value;
  else return;
  send("schemes", { schemes, overrides: comparisonOverrides });
  toast("参数已更新，对比重新开始。");
});
syncConfig();
send("init", { config });
