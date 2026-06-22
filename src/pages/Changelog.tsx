import { useNavigate } from 'react-router-dom'

const VERSIONS = [
  {
    version: 'v2.0',
    date: '2026-06',
    items: [
      'PC 端适配：手机框加宽居中，发现 / 自选页宽屏自动两列，弹窗居中，底部导航随页面宽度',
      '添加股票自动定位板块、预填每股红利（按名称 / 分红历史智能识别）',
      '持仓详情页每股红利显示 4 位小数并高亮「可修改」；自选每股红利默认跟随发现页（手动改过的除外）',
      '网格页新增「添加标的」：搜索即自动填板块 / 每股股息，「其他」兜底板块，重复提示',
      '网格页可自定义：买入 / 卖出网格的步长（0.25% / 0.5%）与档数（2/4/6/8）各自独立',
      '网格页新增自选星标与筛选、手动调整板块顺序、「水电」独立板块（长江 / 国投）',
      '网格页现价旁显示当日涨跌幅；盘中 / 收盘价标识 + 更新时间戳，盘后读缓存不刷新',
      '网格页银行新增北京银行、民生银行',
      '交易手续费「全佣含过户费」支持按沪深市场区分（不含 / 沪深都含 / 仅深市含）',
    ],
  },
  {
    version: 'v1.9',
    date: '2026-06',
    items: [
      '导出备份：弹窗显示备份摘要（账户 / 股票 / 板块数），一键复制或保存为文件',
      '导入备份：自动读取剪贴板并预览将恢复的内容（含导出时间），明确覆盖提示',
      '美股搜索补充 Cboe BZX / 纳斯达克资本市场交易所，修复部分 ETF（如 DRAM）搜不到',
    ],
  },
  {
    version: 'v1.8',
    date: '2026-06',
    items: [
      '决策矩阵「均每股派息」改为近 5 年（不足 5 年取实际年数）',
      '历史分红纳入「股东大会决议通过」的已公告待除息分红，年度统计更完整',
      '收益页持仓盈亏明细支持按盈亏正序 / 倒序切换',
    ],
  },
  {
    version: 'v1.7',
    date: '2026-06',
    items: [
      '新增多账户：一个应用管理多个独立账户，各自持仓互不影响，可切换 / 新建 / 改名 / 删除（自选页右上角账户胶囊，或「我的 → 账户管理」）',
      '仅持仓按账户隔离，板块顺序 / 汇率 / 三大类分类 / 手续费等设置全局共享',
      '收益页「持仓盈亏」支持明细：按盈亏排序，逐只显示市值 / 成本 / 盈亏 / 盈亏%',
      '备份升级支持多账户，兼容旧版单账户备份',
    ],
  },
  {
    version: 'v1.6',
    date: '2026-06',
    items: [
      '持仓改为「买入 / 卖出 / 分红」交易记录：自动算摊薄成本（已回本显示）、成本股息率、累计已收分红、浮动盈亏',
      '分红按分红日期当时的持仓计算，与录入顺序无关',
      '自选卡片持股数量 / 成本价改为按记录显示，点「记录」进持仓详情页增删改',
      '新增交易手续费：佣金（费率 / 免5 / 全佣 / 含过户费）+ 过户费 + 交易所规费 + 卖出印花税（ETF 免），自动计入成本',
      '「我的 → 交易手续费」可设置，开启或改费率后全部持仓成本自动重算（仅 A/B 股）',
    ],
  },
  {
    version: 'v1.5',
    date: '2026-06',
    items: [
      '收益页新增沪市 / 深市市值统计（仅 A 股，含占比）',
      '收益页分布图新增「三大类」占比：弱周期 / 强周期 / 消费，固定配色',
      '「我的 → 类别设置」可手动为标的归类，三大类占比实时联动（美股、ETF 不纳入）',
      '发现页保险新增新华保险；银行补齐中信银行、平安银行',
      '发现页 / 自选页板块顺序：白酒与能源对调',
      '中国移动 25 年股息修正为 4.704',
    ],
  },
  {
    version: 'v1.4',
    date: '2026-06',
    items: [
      '新增「股息率网格买卖价位表」：各档目标股息率对应买入/卖出价，发现页与「我的」页均可进入',
      '同一网址自适应：电脑端全宽表格，手机端卡片布局',
      '顶部板块过滤，可快速定位单个板块',
      '买入网格按个股区分：水电（国投、长江）从 4% 起，其余从 5% 起',
      '新增绿色卖出网格（普通股 4%/3.5%/3%，水电 3%/2.5%/2%），颜色越深信号越强',
      '买入已达档位底色随档位逐步加深；中国广核、中国核电卖出档仅显示价格不判信号',
      '自选页「CDY」改为中文「成本股息率」',
    ],
  },
  {
    version: 'v1.3',
    date: '2026-04',
    items: [
      '新增分红日历：月历宫格展示股权登记日，支持月份切换',
      '已确认事件显示绿色标签，预估事件根据近年规律推算并标注',
      '填写成本价后显示税后到手金额，支持隐私模式遮挡金额',
      '当月无事件时显示最近分红月份快捷跳转',
      '自选页新增 CDY（成本价股息率），与当前股息率同行对比展示',
      '成就移至「我的」页，收益页更聚焦财务数据',
    ],
  },
  {
    version: 'v1.2',
    date: '2026-04',
    items: [
      '发现页股票条目支持左滑显示编辑/删除操作，实时跟手动画',
      'PC 端改为右键菜单触发编辑/删除',
    ],
  },
  {
    version: 'v1.1',
    date: '2026-04',
    items: [
      '新增红利ETF板块，老用户自动迁移无需手动添加',
      '添加时切换至红利ETF板块自动勾选ETF标识',
      'ETF股票显示「每份红利」标签以区别普通股',
      '自选页股票卡片新增ETF蓝色标签',
      '修复代码搜索：纯数字搜索时过滤不相关结果，降级到东方财富接口',
      '修复搜索竞态：慢速输入时旧查询结果不再污染当前展示',
      '新增价格验证兜底：三个搜索API均无结果时直接验证代码有效性',
    ],
  },
  {
    version: 'v1.0',
    date: '2025-04',
    items: [
      '发现页：按板块浏览股票，支持添加、编辑、隐藏',
      '自选页：记录持股数量与成本，自动计算税后红利',
      '持仓页：汇总市值、盈亏与年度被动收入',
      '矩阵页：多档目标收益率反推买入参考价',
      '支持 A 股 / 港股，自动换算人民币',
      '红利税按账户类型（A股/港户/港通H股/港通非H股）自动扣除',
      '股价缓存至本地，切换页面无需重复请求',
      '数据备份与恢复（JSON 导入导出）',
    ],
  },
]

export default function Changelog() {
  const navigate = useNavigate()

  return (
    <div className="page-content">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">更新日志</h1>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-4">
        <button
          onClick={() => navigate('/support')}
          className="w-full card p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">☕</span>
            <div className="text-left">
              <div className="text-sm font-semibold text-gray-800">支持与联系</div>
              <div className="text-xs text-gray-400">如果有帮助，欢迎请我喝杯咖啡</div>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {VERSIONS.map(v => (
          <div key={v.version} className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-gray-900">{v.version}</span>
              <span className="text-xs text-gray-400">{v.date}</span>
              {v === VERSIONS[0] && (
                <span className="ml-auto text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">最新</span>
              )}
            </div>
            <ul className="space-y-1.5">
              {v.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
