# 独立股息预测云函数

## 范围与发布状态

第一步已发布：将预测页的基础数据获取与 2026 年预测计算封装为独立函数，原预测页使用新接口。第二步已在本地完成：收益率矩阵新增 26 年股息、批量查询、本地缓存和手动修改；尚未提交或发布。

- CloudBase 环境：`vercel-dividend-d8faqegf03442b6c`，上海。
- 函数：`dividendForecast`，HTTP，`Nodejs20.19`，45 秒超时，端口 9000；代码和运行配置已上传。
- 管理入口：https://tcb.cloud.tencent.com/dev?envId=vercel-dividend-d8faqegf03442b6c#/scf
- CloudBase 网关路由 `/dividendForecast` 已启用身份鉴权；无凭据访问已验证返回 401。
- 网页仅调用本站 `/api/dividend-forecast`。Vercel 服务端代理持有 Publishable Key 和函数专用内部密钥，二者都不会进入本次前端代码或请求。
- CloudBase 函数会再次校验内部密钥，即使取得公开 Publishable Key，也不能绕过本站代理直接获得预测结果。
- Vercel 的 Production 和 Preview 环境变量已配置；推送 `main` 后由 Git 集成自动发布。

## 接口

网页调用：`GET /api/dividend-forecast?code=600941&year=2026`

收益率矩阵批量调用：`GET /api/dividend-forecast?codes=600941,601728&year=2026`

批量模式单次最多接收 100 个 A 股代码，内部最多并发计算 4 只；成功项只返回 `code` 和 `annualDps`，单只数据不足会记录在 `errors`，不会导致整批失败。单股接口及其完整返回结构保持不变。

本站服务端代理再调用受保护的 CloudBase 路由。CloudBase 地址不属于前端接口契约。

| 参数 | 含义 | 默认值 |
| --- | --- | --- |
| code | 6 位 A 股代码 | 必填 |
| year | 预测财年，当前仅支持 2026 | 2026 |
| profitRatio | H1 / 全年利润比例，大于 0 且不超过 1，例如 0.5 | 历史三年中位数 |
| payoutMethod | auto / average / median / latest | auto |
| forecastMethod | auto / profit / interim / policy | auto |

金额为人民币税前元/股，`annualDps` 包含该财年中期及末期股息。`interim` 为已公告中期息，`terminalDps` 为预计末期息；中期息缺失时返回 null。

返回完整预测及依据，包括 `annualDps`、`profitDps`、`interimAnchor`、`policyDpsFloor`、`forecastMethod`、`payoutMethod`、`systemPayoutMethod`、`profitRatio`、`medianProfitRatio`、股本来源日期、历史利润/派息率/股息、分红承诺。`modelVersion` 为 `2026-v1`，`calculatedAt` 为计算时间，不能当作财报披露日期。

行情与股息率不在此接口中：页面继续独立查询股价，按 `annualDps / price` 展示股息率。完整前端类型见 `src/utils/dividendForecast.ts`。

HTTP 状态：非法参数 400；跨站浏览器请求 403；服务端凭据未配置 503；非有限数值结果 422；基础数据缺失或上游故障 502，并返回 `{ "error": "原因" }`。

## 计算与数据复用

- `model.js` 是从原页面提取的纯计算模块，保留利润法、中期息同比锚定、有效量化承诺及自动选择阈值。
- `data.js` 在服务端调用既有 `stockPrice` 的 `forecastData`、`dividendPayout`、`dividendHistory`，避免复制分红承诺库和派息率数据修正规则。它是独立部署的预测服务，基础数据仍依赖既有数据网关。
- 历史股息沿用原页面财年聚合、四位小数和云南白药补录规则；历史接口不可用时仍可使用利润模型，与原页一致。
- 基础数据在单个函数实例中缓存 5 分钟，最多 300 只股票，同代码的并发查询合并。冷启动或其他实例仍会重新取数；这不是持久缓存或定时更新。
- 个人参数只用于当次计算，不写云数据库。HTTP 响应不缓存个人计算结果。
- 本站代理只转发经过白名单校验的参数；CloudBase 凭据和内部密钥仅通过服务端环境变量注入。
- 原页面继续保存个人模型/利润比例偏好。手动调整时沿用首次查询选定的派息率算法，避免因调整利润比例而意外改变派息率方法。

## 收益率矩阵缓存与手动值

- 成功的算法预测保存在浏览器 `localStorage`，不设置时间过期，刷新页面不会再次查询。查询失败或暂时缺少数据的股票不写入持久缓存，下次刷新会自动重试，避免一次上游故障长期显示“暂无预测”。
- 预测缓存带有 `modelVersion`。算法变更时，CloudBase 函数的版本和前端 `DIVIDEND_FORECAST_MODEL_VERSION` 必须在同一次发布中同步提升；版本不一致时旧预测缓存自动失效并重新查询。
- 手动修改值显示时优先于算法预测。算法升级不会删除手动值；用户可在编辑弹窗中恢复算法预测。
- 网格设置可在 25 年股息与 26 年预测股息之间切换计算基准，默认使用 25 年。选择 26 年后，股息率、排序筛选、除息提醒、BOLL 轨道股息率、网格目标价及“已达”判定统一切换；无 26 年值时自动沿用 25 年并显示标记。该选择随现有网格偏好持久化和账号同步。
- 算法预测缓存只保存在当前浏览器。未登录时，手动修改值也只保存在当前浏览器；登录后手动修改值会随 `gridPrefs.forecastOverrides` 写入用户云端数据并同步到其他设备。旧版浏览器里的手动值会在登录同步完成后自动并入当前账号。

## 本地验证

```bash
node --test cloudfunctions/dividendForecast/model.node-test.js
npm test
npx tsc --noEmit
npx vite build --outDir /tmp/dividend-forecast-build
```

本地端到端验证（两个终端）：

```bash
FORECAST_PROXY_SECRET=本地测试值 node -e "require('./cloudfunctions/dividendForecast').createServer().listen(9000, '127.0.0.1')"
FORECAST_PROXY_SECRET=本地测试值 npm run dev -- --host 127.0.0.1 --port 5178
```

访问 `http://127.0.0.1:5178/dividend-forecast`。本地测试值只需保证两个进程一致，不要复用或提交生产密钥。

验证记录：原页面算法与新模块在同一组输入下完成 96 组场景对照，所有已有结果字段一致。浏览器使用真实数据验证中国移动默认预测、最近一年派息率、手动利润比例、恢复中位数和切换中期模型。该次默认预测为 4.574687921 元/股，最近一年派息率预测为 4.663 元/股（页面显示值）；数值随基础数据变化，以接口实际结果为准。

## 发布与验收

推送 `main` 后由 Vercel Git 集成自动部署。线上验收包括本站 API 默认预测、参数校验、跨站 Origin 拒绝，以及原预测页的默认查询和手动调整。

函数部署目录为 `cloudfunctions/`，`scf_bootstrap` 已包含与 Node.js 20 匹配的启动路径。打包时排除 `*.node-test.js`，无需第三方运行时依赖。
