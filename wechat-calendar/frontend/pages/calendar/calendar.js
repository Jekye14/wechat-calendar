// pages/calendar/calendar.js  ── 周视图日历
const app = getApp()

// 每个用户分配一个固定颜色（创建者用特殊色，成员按顺序分配）
const MEMBER_COLORS = [
  '#E53935', // 红
  '#8E24AA', // 紫
  '#1E88E5', // 蓝
  '#00897B', // 青绿
  '#F4511E', // 深橙
  '#6D4C41', // 棕
  '#039BE5', // 浅蓝
  '#7CB342', // 绿
  '#FB8C00', // 橙
  '#D81B60', // 粉红
]
const CREATOR_COLOR = '#4A90D9'  // 创建者固定蓝色

// 每小时行高 (rpx)，24行
const HOUR_HEIGHT = 100

Page({
  data: {
    calId: null,
    calendar: null,
    members: [],
    isCreator: false,
    currentUserId: null,

    // 周视图
    weekStart: '',      // 本周一 yyyy-mm-dd
    weekDays: [],       // 7天 [{date, label, isToday}]
    hourLabels: [],     // ['00:00','01:00',...,'23:00']
    eventBlocks: [],    // 渲染用事件块列表

    // 颜色映射 {userId: color}
    colorMap: {},

    activeTab: 'calendar',
    loading: true,
  },

  onLoad(options) {
    const calId = parseInt(options.id)
    const userId = app.globalData.userInfo && app.globalData.userInfo.id
    this.setData({ calId, currentUserId: userId })

    // 生成小时标签
    const hourLabels = []
    for (let h = 0; h < 24; h++) hourLabels.push(String(h).padStart(2,'0') + ':00')
    this.setData({ hourLabels })

    // 定位到本周
    const today = new Date()
    const monday = this.getMondayOf(today)
    this.setData({ weekStart: this.fmt(monday) })

    this.loadCalendar()
  },

  onShow() {
    if (this.data.calId) this.loadAll()
  },

  loadAll() {
    this.loadCalendar()
  },

  loadCalendar() {
    app.request({ url: `/calendars/${this.data.calId}` }).then(data => {
      const userId = this.data.currentUserId
      const isCreator = data.creator_id === userId

      // 构建颜色映射：创建者固定色，成员按加入顺序分配色
      const colorMap = {}
      colorMap[data.creator_id] = CREATOR_COLOR
      data.members.forEach((m, i) => {
        colorMap[m.id] = MEMBER_COLORS[i % MEMBER_COLORS.length]
      })

      this.setData({
        calendar: data,
        members: data.members,
        isCreator,
        colorMap,
      })
      wx.setNavigationBarTitle({ title: data.name })
      this.loadEvents()
    })
  },

  loadEvents() {
    app.request({ url: `/calendars/${this.data.calId}/events` }).then(rawEvents => {
      const { isCreator, currentUserId, calendar } = this.data

      // 可见性过滤：成员只能看自己的 + 创建者的事件
      let visible
      if (isCreator) {
        visible = rawEvents
      } else {
        visible = rawEvents.filter(ev =>
          ev.creator_id === currentUserId ||
          ev.creator_id === calendar.creator_id
        )
      }

      this.setData({ loading: false }, () => {
        this.buildWeek(visible)
      })
    }).catch(() => this.setData({ loading: false }))
  },

  // ── 周视图核心 ────────────────────────────────────────────

  buildWeek(events) {
    const { weekStart, colorMap, calendar } = this.data
    const today = this.fmt(new Date())

    // 生成7天
    const weekDays = []
    for (let i = 0; i < 7; i++) {
      const d = this.addDays(new Date(weekStart), i)
      const dateStr = this.fmt(d)
      weekDays.push({
        dateStr,
        label: ['一','二','三','四','五','六','日'][i],
        dayNum: d.getDate(),
        isToday: dateStr === today,
      })
    }

    const weekEnd = this.addDays(new Date(weekStart), 7)
    const weekEndStr = this.fmt(weekEnd)

    // 筛选本周事件
    const weekEvents = events.filter(ev => {
      const s = ev.start_time.substring(0,10)
      return s >= weekStart && s < weekEndStr
    })

    // 计算每个事件的渲染位置
    // 先按时长降序排（时长长的先放底层，时长短的在上层）
    const withDuration = weekEvents.map(ev => {
      const start = this.parseTime(ev.start_time)
      const end   = this.parseTime(ev.end_time)
      const startMin = start.h * 60 + start.m
      const endMin   = Math.min(end.h * 60 + end.m, 24 * 60)
      const duration = endMin - startMin
      const dateStr  = ev.start_time.substring(0,10)
      const dayIdx   = weekDays.findIndex(d => d.dateStr === dateStr)
      const color    = colorMap[ev.creator_id] || '#999'
      return { ...ev, startMin, endMin, duration, dayIdx, color }
    })

    // 按时长降序排列（时长长的先渲染 → zIndex低）
    withDuration.sort((a, b) => b.duration - a.duration)

    // 构建事件块（转为rpx单位的top/height，用于内联样式）
    // HOUR_HEIGHT rpx = 1小时
    const CELL_WIDTH_PCT = 100 / 7  // 每列占总宽百分比

    // 检测同一列内的重叠，给重叠事件分配左偏移
    // 按列分组
    const columns = Array.from({length:7}, () => [])
    withDuration.forEach((ev, idx) => {
      if (ev.dayIdx < 0) return
      columns[ev.dayIdx].push({ ...ev, _idx: idx })
    })

    const eventBlocks = []
    columns.forEach((col, colIdx) => {
      // 对本列事件做重叠分组，分配子列
      const placed = this.assignSubColumns(col)
      placed.forEach(({ ev, subCol, totalSubCols }) => {
        const topRpx    = (ev.startMin / 60) * HOUR_HEIGHT
        const heightRpx = Math.max((ev.duration / 60) * HOUR_HEIGHT, 30)
        // 水平：整列宽度 / totalSubCols
        const leftPct  = (colIdx / 7 * 100) + (subCol / totalSubCols) * (100 / 7)
        const widthPct = (1 / totalSubCols) * (100 / 7)
        // zIndex：时长越短越靠上
        const zIndex   = Math.round(1000 / (ev.duration || 1))

        eventBlocks.push({
          id: ev.id,
          title: ev.title,
          startLabel: this.minToLabel(ev.startMin),
          endLabel:   this.minToLabel(ev.endMin),
          color: ev.color,
          status: ev.status,
          event_type: ev.event_type,
          topRpx,
          heightRpx,
          leftPct,
          widthPct,
          zIndex,
          // 内联样式字符串
          style: `top:${topRpx}rpx;height:${heightRpx}rpx;left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%;z-index:${zIndex};background:${ev.color};opacity:${ev.status==='rejected'?0.4:ev.status==='pending'?0.75:1}`,
        })
      })
    })

    this.setData({ weekDays, eventBlocks })
  },

  // 给同列事件分配子列（处理重叠）
  assignSubColumns(events) {
    if (!events.length) return []
    // 贪心：每个事件找第一个不冲突的子列
    const result = []
    const subColEnds = []  // 每个子列当前最大endMin

    events.forEach(ev => {
      let placed = false
      for (let s = 0; s < subColEnds.length; s++) {
        if (subColEnds[s] <= ev.startMin) {
          subColEnds[s] = ev.endMin
          result.push({ ev, subCol: s })
          placed = true
          break
        }
      }
      if (!placed) {
        result.push({ ev, subCol: subColEnds.length })
        subColEnds.push(ev.endMin)
      }
    })

    const totalSubCols = subColEnds.length
    return result.map(r => ({ ...r, totalSubCols }))
  },

  // ── 周导航 ────────────────────────────────────────────────

  prevWeek() {
    const d = this.addDays(new Date(this.data.weekStart), -7)
    this.setData({ weekStart: this.fmt(d) }, () => this.loadEvents())
  },

  nextWeek() {
    const d = this.addDays(new Date(this.data.weekStart), 7)
    this.setData({ weekStart: this.fmt(d) }, () => this.loadEvents())
  },

  goToday() {
    const monday = this.getMondayOf(new Date())
    this.setData({ weekStart: this.fmt(monday) }, () => this.loadEvents())
  },

  // ── 事件交互 ──────────────────────────────────────────────

  openEvent(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/event-detail/event-detail?calId=${this.data.calId}&eventId=${id}` })
  },

  goCreateEvent() {
    const date = this.data.weekDays[0] && this.data.weekDays[0].dateStr
    wx.navigateTo({ url: `/pages/event/event?calId=${this.data.calId}&date=${date}` })
  },

  goCreateAssigned() {
    const date = this.data.weekDays[0] && this.data.weekDays[0].dateStr
    wx.navigateTo({ url: `/pages/assigned-event/assigned-event?calId=${this.data.calId}&date=${date}` })
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
    if (e.currentTarget.dataset.tab === 'calendar') {
      this.loadEvents()
    }
  },

  // ── 成员管理 ──────────────────────────────────────────────

  shareInvite() {
    app.request({ url: `/calendars/${this.data.calId}/invite-token` })// shareInvite() 里 app.request(...) 的 then
    .then(data => {
      console.log('invite-token response:', data)   // <— 加这一行
      app.globalData.inviteToken = data.token
      wx.showShareMenu({ withShareTicket: true })
      wx.showToast({ title: '请点击右上角分享', icon: 'none' })
    })
  },

  onShareAppMessage() {
    const token = app.globalData.inviteToken || ''
    return {
      title: `邀请你加入日历「${this.data.calendar && this.data.calendar.name}」`,
      path: `/pages/join/join?token=${token}`,
    }
  },

  removeMember(e) {
    const memberId = e.currentTarget.dataset.id
    const memberName = e.currentTarget.dataset.name
    wx.showModal({
      title: '移除成员',
      content: `确认移除成员「${memberName}」？`,
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/members/${memberId}`,
            method: 'DELETE'
          }).then(() => {
            wx.showToast({ title: '已移除' })
            this.loadCalendar()
          })
        }
      }
    })
  },

  deleteCalendar() {
    wx.showModal({
      title: '删除日历',
      content: '删除后所有事件将丢失，确认删除？',
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}`,
            method: 'DELETE'
          }).then(() => wx.navigateBack())
        }
      }
    })
  },

  // ── 工具函数 ──────────────────────────────────────────────

  getMondayOf(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = (day === 0 ? -6 : 1 - day)
    d.setDate(d.getDate() + diff)
    return d
  },

  addDays(date, n) {
    const d = new Date(date)
    d.setDate(d.getDate() + n)
    return d
  },

  fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  },

  parseTime(dtStr) {
    // 支持 "2025-03-15 09:30:00" 和 ISO "2025-03-15T09:30:00"
    if (!dtStr) return { h: 0, m: 0 }
  
    let timePart = ''
    if (dtStr.includes('T')) {
      timePart = dtStr.split('T')[1] || ''
    } else {
      timePart = dtStr.split(' ')[1] || ''
    }
  
    const tp = (timePart || '00:00:00').split(':')
    return { h: parseInt(tp[0] || 0), m: parseInt(tp[1] || 0) }
  },

  minToLabel(mins) {
    const h = Math.floor(mins / 60) % 24
    const m = mins % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  },
})
