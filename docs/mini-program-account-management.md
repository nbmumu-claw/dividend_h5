# 账户资金与分红税管理（小程序移植说明）

本文定义账户内多币种现金的字段、存储、计算及同步规则。现金与持仓均按账户隔离。

## 1. 支持范围

- 币种：人民币 `CNY`、美元 `USD`、港币 `HKD`。
- 每种币种独立决定是否开始追踪交易现金流。
- 支持期初资金、资金转入、资金转出与现金校准。
- 买卖与税后分红自动更新所属币种的现金。

## 2. 账户数据结构

```ts
type CashCurrency = 'CNY' | 'USD' | 'HKD'

type CashBalances = Record<CashCurrency, number>
type CashFundingCurrencies = Record<CashCurrency, boolean>

interface CashCalibration {
  id: string
  currency: CashCurrency
  previousBalance: number // 校准前系统余额
  actualBalance: number   // 用户输入的券商实际余额
  difference: number      // actualBalance - previousBalance
  ts: number              // 毫秒时间戳
}

interface AccountCashData {
  cashBalance: CashBalances
  cashOpeningBalance: CashBalances
  cashFundingCurrencies: CashFundingCurrencies
  cashCalibrations: CashCalibration[]
}
```

默认值：

```ts
const EMPTY_CASH = { CNY: 0, USD: 0, HKD: 0 }
const EMPTY_CASH_FUNDING = { CNY: false, USD: false, HKD: false }
```

`cashBalance` 必须允许负数。负数可能来自已启用现金追踪后的买入、融资或券商实际负余额；读取缓存、云端数据与迁移数据时不得截断为 `0`。

## 3. 存储规则

### 3.1 本地存储

将 `AccountCashData` 嵌入对应账户记录，和账户持仓、费率一同保存。不要只使用一个全局现金字段，否则切换账户会串数据。

推荐结构：

```ts
interface Account {
  id: string
  name: string
  watchlist: WatchlistStock[]
  feeConfig: FeeConfig
  cash: AccountCashData
}
```

如果小程序采用“当前账户展开、其他账户存 map”的内存模型，也必须在落盘前还原为每个账户都携带完整 `cash` 数据的结构。

### 3.2 云端同步与导入导出

每个账户都必须同步以下字段：

```ts
cashBalance
cashOpeningBalance
cashFundingCurrencies
cashCalibrations
```

导入时对每个币种缺失值补 `0`，对追踪开关缺失值补 `false`。校准记录不是交易记录，不得转换为买卖或分红流水。

### 3.3 旧数据迁移

旧版本没有 `cashFundingCurrencies` 时，按已有期初资金恢复：

```ts
cashFundingCurrencies = {
  CNY: cashOpeningBalance.CNY > 0,
  USD: cashOpeningBalance.USD > 0,
  HKD: cashOpeningBalance.HKD > 0,
}
```

旧版本没有 `cashCalibrations` 时初始化为空数组。迁移完成后应立即以新版本结构持久化。

## 4. 标的与结算币种映射

| 标的类型 | 结算币种 |
| --- | --- |
| A 股 | CNY |
| 美股、沪市 B 股 | USD |
| 深市 B 股 | HKD |
| 普通港股（默认港股通） | CNY |
| 港户交易的港股 | HKD |

港股持仓需要保存结算方式，例如 `cashCurrency: 'CNY' | 'HKD'`；默认值为 `CNY`。

## 5. 交易现金流计算

先按标的获得结算币种 `currency`，再仅在 `cashFundingCurrencies[currency] === true` 时更新余额。

```ts
// 买入
delta = -成交金额 - 手续费

// 卖出
delta = 成交金额 - 手续费

// 分红
delta = 税后分红

if (cashFundingCurrencies[currency]) {
  cashBalance[currency] += delta
}
```

因此，只录入 CNY 期初而未录 USD 期初时，美股交易不会改变 USD 余额；待 USD 发生期初录入、转入或校准后，才开始追踪 USD 交易现金流。HKD 同理。

编辑一笔交易时，必须计算“编辑后该股票现金流 - 编辑前该股票现金流”的差额，避免重复记账。

## 6. 资金操作写入规则

所有更新应对“目标账户 + 目标币种”原子写入，避免切换账户或并发保存造成串账。

### 6.1 录入/修改期初资金

```ts
// 首次补录
cashBalance[currency] += amount
cashOpeningBalance[currency] = amount

// 已有期初后修改
cashBalance[currency] += newAmount - cashOpeningBalance[currency]
cashOpeningBalance[currency] = newAmount

cashFundingCurrencies[currency] = true
```

首次补录采用“加到当前余额”的方式，不能直接覆盖当前余额，以保留之前已经存在的卖出回款。

### 6.2 资金转入/转出

```ts
// 转入：amount 为正数
cashBalance[currency] += amount

// 转出：amount 为正数
cashBalance[currency] -= amount

cashFundingCurrencies[currency] = true
```

### 6.3 现金校准

“现金校准”用于将系统余额对齐到券商当前实际余额，不回写历史交易。

```ts
const previousBalance = cashBalance[currency]
const actualBalance = userInput

cashBalance[currency] = actualBalance
cashFundingCurrencies[currency] = true
cashCalibrations.push({
  id: createId(),
  currency,
  previousBalance,
  actualBalance,
  difference: actualBalance - previousBalance,
  ts: Date.now(),
})
```

校准只改选定币种；其他币种、持仓交易、成本、收益与分红记录均不改变。校准差额属于对账修正，不应计为真实转入、转出或投资收益。

## 7. 资产和仓位统计

现金应纳入总资产与仓位占比。按收益统计范围纳入不同现金：

| 收益统计范围 | 纳入现金 |
| --- | --- |
| 全部 | CNY + USD + HKD |
| 只看美股 | USD |
| 只看非美股 | CNY + HKD |

换算为人民币：

```ts
all = CNY + USD * usdCnyRate + HKD * hkdCnyRate
us = USD * usdCnyRate
nonUs = CNY + HKD * hkdCnyRate
```

## 8. 小程序页面建议

账户管理页展示三币种当前余额，并提供“资金管理”入口。资金管理弹窗或页面包含：

1. 操作类型：期初现金、资金转入、资金转出、现金校准。
2. 币种选择：CNY、USD、HKD。
3. 金额输入：现金校准允许负数，其他操作通常仅允许非负输入。
4. 校准提示：说明输入的是券商当前实际余额，系统会记录差额且不修改历史交易。
5. 最近校准摘要：展示最近一笔的币种与差额；完整 `cashCalibrations` 保留用于后续审计页。

## 9. 最小验收用例

1. 未录任何资金时，录入美股买入，USD 现金不变。
2. 仅录 CNY 期初后，A 股卖出增加 CNY；美股买入不改变 USD。
3. 录 USD 期初或 USD 转入后，美股买卖、分红开始自动改变 USD。
4. 当前 `USD = -3921`，校准为 `500` 后，USD 为 `500`，新增差额 `+4421` 的校准记录；CNY、HKD、交易记录不变。
5. 导出再导入后，三币种余额、追踪开关和校准记录一致。
6. 切换账户后，各账户的现金余额、校准记录互不影响。

---

# 分红税功能（小程序移植说明）

本文补充分红税记录、预估和提醒流程。分红税是 **A 股卖出后可能补缴的已收分红个人所得税**，不是交易手续费，也不改变持仓股数。

## 1. 支持范围与口径

- 仅对沪深北普通 A 股启用：6 位数字代码，且不是港股、美股、ETF、场外基金或 B 股。
- 仅使用用户已经录入的买入、卖出和分红流水估算；没有录入的历史分红不会被推测。
- 卖出批次按先进先出（FIFO）匹配最早取得的股票。
- 同日买入先抵扣同日卖出数量；只有“当日净卖出”部分继续参与分红税估算。
- 税率按卖出日期与买入日期的自然月/年边界判断：
  - 持有 1 个月以内（含边界）：分红毛额 × 20%。
  - 持有 1 个月至 1 年（含边界）：分红毛额 × 10%。
  - 持有超过 1 年：免税。
- 结果只能标记为“预估、待审核”，用户可修改金额，应以券商实际扣缴为准。

## 2. 交易流水字段

所有记录都存储在标的的 `transactions` 数组。分红税沿用交易流水模型，不另建持仓字段。

```ts
type TxType = 'buy' | 'sell' | 'dividend' | 'dividendTax'

interface Transaction {
  type: TxType
  qty: number
  price: number
  ts: number
  gross?: number
}

interface WatchlistStock {
  code: string
  name: string
  // ...其他行情和持仓字段
  transactions?: Transaction[]
}
```

字段语义：

| `type` | `qty` | `price` | `gross` | `ts` |
| --- | --- | --- | --- | --- |
| `buy` | 买入股数 | 买入价 | 不使用 | 买入时间（毫秒） |
| `sell` | 卖出股数 | 卖出价 | 不使用 | 卖出时间（毫秒） |
| `dividend` | 记录时的持股数 | 税后每股分红 | 税前每股分红，供分红税估算使用 | 分红日期（毫秒） |
| `dividendTax` | 对应卖出日的卖出总股数 | **分红税总金额**，不是每股价格 | 不使用 | 对应卖出日期/时间（毫秒） |

例如：2026-07-24 卖出 200 股，确认分红税 ¥40.32：

```ts
{
  type: 'dividendTax',
  qty: 200,
  price: 40.32,
  ts: new Date('2026-07-24T15:00:00').getTime(),
}
```

## 3. 数据存储、同步与导入导出

### 3.1 正式分红税记录

确认后把 `dividendTax` 追加到对应标的的 `transactions`，与买入、卖出和分红一起持久化。Web 版本通过 Zustand `persist` 保存到 localStorage 键 `dividend-h5-store`；小程序应把它保存到对应账户的持仓数据中。

```ts
account.watchlist[].transactions[]
```

因为它属于正常交易流水，云端同步、备份导出和恢复时必须原样保留 `type: 'dividendTax'`、`qty`、`price`、`ts`。不要只同步累计税额，否则无法编辑、删除或避免重复提醒。

### 3.2 忽略提醒状态

忽略提醒不写入交易流水。Web 版本使用本地存储键：

```ts
const DISMISS_KEY = 'dividend-tax-dismissed'
// 内容：['600000@2026-07-24', '600938@2026-07-22']
```

键格式为 `${code}@${YYYY-MM-DD}`。当前实现中此状态仅保存在本机，不随云同步或备份迁移；小程序如需跨设备一致，可将 `dismissedDividendTaxKeys: string[]` 纳入账户偏好同步，但仍不要把它当作已缴税记录。

## 4. 预估算法

### 4.1 输入和输出

```ts
interface DividendTaxEstimate {
  tax: number           // 预估总税额
  withinMonth: number   // 持有 1 个月内的应税分红毛额
  withinYear: number    // 持有 1 个月至 1 年的应税分红毛额
  dividendCount: number // 实际参与估算的已录入分红笔数
  availableQty: number  // 卖出日可用于核验的持股数量
}

function estimateDividendTax(
  transactions: Transaction[],
  saleTs: number,
  saleQty: number,
): DividendTaxEstimate
```

### 4.2 处理步骤

1. 取卖出日期（按自然日，不比较当天的具体时分秒）。
2. 汇总同日全部买入股数 `sameDayBuyQty`。
3. 从卖出日前一天及更早的流水重建 FIFO 持仓批次：买入增加批次，卖出按 FIFO 消耗批次，分红将税前每股分红写入当时仍持有的批次。
4. 计算 `netSaleQty = max(0, saleQty - sameDayBuyQty)`。
5. 用 `netSaleQty` 按 FIFO 消耗剩余批次；每个批次把已关联分红毛额归入“1 个月内”“1 个月至 1 年”或免税。
6. 计算：

```ts
tax = withinMonth * 0.20 + withinYear * 0.10
```

自然月边界示例：1 月 1 日买入，2 月 1 日卖出仍属于“1 个月以内”；实现时应先把时间戳归一到本地日期零点再比较。

## 5. 填写页预填规则

进入“分红税”填写页/弹窗时：

1. 查找最近一笔卖出记录，自动填入该卖出日期。
2. 汇总该日期全部 `sell.qty`，自动填入“数量（股）”。
3. 调用 `estimateDividendTax(transactions, saleTs, saleQty)`，将 `tax.toFixed(2)` 自动填入“税额”。
4. 用户修改日期或数量时，只要税额尚未被手动编辑，就重新预填税额。
5. 用户手动修改税额后，不再自动覆盖；确认时以用户填写的金额为准。
6. 数量超过 `availableQty` 时禁止确认并提示可用数量；税额小于等于 0 时提示核对历史分红或无需记录。

填写页应展示但不遮挡编辑的审核信息：参与的分红笔数、1 个月内分红毛额 × 20%、1 个月至 1 年分红毛额 × 10%、以及“以券商实际扣缴为准”的提示。

## 6. 详情页提醒

### 6.1 触发条件

详情页从卖出记录中按日期分组，按日期倒序查找第一笔满足以下条件的卖出日：

1. 该标的是普通 A 股；
2. 该日期未被用户忽略；
3. 该日期尚未存在 `dividendTax` 记录；
4. 该日期汇总卖出数量经估算后的 `tax > 0`。

提醒展示：卖出日、该日卖出总股数、预估补缴税额。点击提醒卡的非按钮区域，应跳转/打开分红税填写页，并预填同一组日期、股数和金额。

### 6.2 用户操作

| 操作 | 结果 |
| --- | --- |
| 确认记录 | 直接写入一笔 `dividendTax`；下次计算时因已有记录不再提醒。 |
| 点击提醒卡 | 打开可修改的分红税填写页；确认后按编辑结果写入。 |
| 忽略 | 写入本地忽略键；不产生交易、现金或成本变化。 |

## 7. 对现金、成本和收益的影响

分红税不改变股数，也不参与买卖手续费计算。

```ts
// 现金流：税额为支出
cashDelta -= dividendTax.price

// 摊薄成本：税额增加剩余净投入
netAmount = buySellAmount - dividendAmount + dividendTaxAmount
costPrice = netAmount / shares
```

清仓时仍保留 `netAmount`，因此累计盈亏会包含已确认的分红税。编辑或删除分红税记录时，应像编辑其他交易一样，用“新流水现金流 - 旧流水现金流”的差额更新现金，避免重复扣款。

## 8. 最小验收用例

1. 买入 1000 股、收到每股 ¥1 分红、10 天后卖出 500 股：预估税额 ¥100（500 × 1 × 20%）。
2. 买入 1000 股、收到每股 ¥1 分红、2 个月后卖出 500 股：预估税额 ¥50（500 × 1 × 10%）。
3. 买入满 1 年后卖出：预估税额为 0，不显示提醒。
4. 同日买入 200 股、卖出 200 股：净卖出为 0，预估税额为 0，不显示提醒。
5. 同日买入 50 股、卖出 80 股：仅对净卖出的 30 股按 FIFO 估税。
6. 同日两笔卖出 300 股和 200 股：提醒预填 500 股，确认后仅写入一笔税记录。
7. 确认后刷新、导出再导入、云同步后：`dividendTax` 记录、现金和成本结果一致，且该卖出日不再提醒。
8. 忽略后刷新页面：该卖出日不再提醒；清除本地忽略键后可以再次出现。
