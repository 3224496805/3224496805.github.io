# 3v3 匹配模拟器（静态站点）

纯前端 3v3 PvP 匹配机制模拟器：经典 Elo / 纯表现分 / OpenSkill ordinal（含连胜 streak-τ、情绪 τ_mood 注入）三种结算方案同批玩家对比。

访问地址：https://3224496805.github.io/

## 部署/更新

1. 本地 `npm run build` 生成 `dist/`（Vite，已配置 `base: './'`）。
2. 把 `dist/` 里的 **所有文件**（保持目录结构，含 `assets/` 子目录）上传到本仓库根目录（GitHub 网页 Upload files 或 `git push`）。
3. 约 1 分钟后线上自动更新，无需其他设置。

**.nojekyll** 已提交，防止 GitHub Pages 跳过下划线开头的文件（未来如需）。
