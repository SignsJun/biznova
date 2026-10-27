# BizNova — Growth Overview

根据提供的 [Figma 原型](https://www.figma.com/proto/hxovmgyfemgTMiBxvJBzp1/Biznova?node-id=5-720) 实现第一个 Dashboard。源码、前端、服务端 API、SQLite 数据库结构及迁移均在此目录。

## 本地运行

需要 Node.js 22.13+（推荐 24）和 npm。

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_yellow_prodigy.sql
npm start
```

打开终端输出的本地地址，默认 http://127.0.0.1:8787 。SQL 迁移只在新数据库上执行一次。后续修改源码后运行 `npm run build`，再启动 `npm start`；数据保留在 `.wrangler/state`，无需重新建表。开发时也可使用 `npm run dev`，但首次验证数据库请使用上面的构建预览方式。

## 本期实现

- 保留原型的背景渐变、顶部导航、侧栏、卡片布局、产品图片与主要数据。
- 热门商品、收入、广告 ROAS/支出、订单、最佳广告、平台排行、小时受众活动、10 天趋势、收入日历。
- 日期快捷范围/自定义范围、平台筛选，各卡片和 CSV 统一口径。
- 商品搜索与详情、店铺预览、受众放大、图表提示、日历单日详情、日收入 CSV 导出。
- 浅色/深色主题、键盘可用的原生对话框、加载/错误/空数据状态及移动端布局。
- AI Chatbot 和独立 Analytics 模块属于后续阶段，目前导航标明暂未开放。店铺仅展示商品预览，不含结算。

## 技术结构

React 19 + TypeScript，Vinext 的 App Router，服务端运行于 Cloudflare Workers。D1 是兼容 SQLite 的持久化数据库；本地使用 Wrangler 提供的 SQLite 数据库。保留 Sites starter 的构建集成，可部署为私有站点。

| 路径 | 职责 |
| --- | --- |
| `app/page.tsx` / `app/globals.css` | Dashboard UI、交互和响应式样式 |
| `app/api/dashboard/route.ts` | 日期、平台校验与统计 JSON API |
| `app/api/dashboard/export/route.ts` | 同口径日收入 CSV |
| `app/api/health/route.ts` | 数据库健康检查 |
| `lib/dashboard-data.ts` | 类型、演示数据、整数金额分配与聚合规则 |
| `lib/dashboard-repository.ts` | 数据库查询与幂等演示初始化 |
| `db/schema.ts` / `drizzle/` | 数据库表定义与迁移 |
| `tests/dashboard.test.mjs` | 金额对账、分区筛选、日期与输入校验测试 |

## API

```text
GET /api/dashboard?from=2026-09-12&to=2026-10-11&platform=all
GET /api/dashboard/export?from=2026-10-02&to=2026-10-11&platform=tiktok
GET /api/health
```

`platform` 支持 `all`、`tiktok`、`meta`、`google`。日期使用 UTC、包含起止日期，最多 366 天。非法参数返回 400；数据库故障返回 503。数据集以外的日期返回零值；同比区间采用等长的上一期间，上一期间营收为零时增长率为 `null`。金额以整数美分保存和分配，JSON 中以美元返回。

## 数据说明和后续接入

当前是**明确标注的演示数据**，未连接商店、付款、广告账户或真实用户系统。首次调用统计 API 时，幂等写入演示记录（商品日记录 540 条、广告日记录 180 条），后续从数据库查询；不是前端硬编码汇总。`dataset` 标记初始化完成，数据本地重启后保留。

默认期间是原型中的 2026-09-12 至 2026-10-11，合计收入 $18,612.85、915 单、广告支出 $2,028.60；最后 10 天收入 $6,869、326 单。商品收入与订单数、广告平台支出及归因收入参考原型。原型日历显示金额合计为 $18,631，与营收卡相差 $18.15；本实现将差额放在首日调整，保持总额与 10 天趋势完全对账。ROAS 使用广告归因收入 / 广告支出，与店铺总收入分开计算。演示商品到日期/平台的分配、上一期间细分数据、点击/曝光量均为合成记录。受众小时分布为演示估算，随所选期间订单量变化，不能作为真实分析结论。

产品和头像素材从用户提供的原型可见画面截取，分辨率受原型预览限制；拿到 Figma 原始导出素材后可直接替换 `public/images/` 文件。

真实集成时需增加店铺和广告导入任务，将订单/广告指标映射至相应事实表，并移除演示初始化。多店铺/多用户上线前需增加账户鉴权、租户字段和按租户授权查询。当前部署为站点所有者私有访问，不是多租户生产系统。

## 验证

```sh
node --test tests/dashboard.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

已验证默认指标跨商品、平台、日历对账，平台分区总额，单日/10 天/空区间，日期和平台参数校验，以及 HTTP API 和 CSV 金额。
