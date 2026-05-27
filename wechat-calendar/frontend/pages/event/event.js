// pages/event/event.js  ── 创建/编辑普通事件
const app = getApp()

Page({
  data: {
    calId: null,
    eventId: null,   // 有值则为编辑模式
    isEdit: false,
    fromCaptured: false,
    capturedId: null,
    title: '',
    startDate: '',
    startTime: '09:00',
    endDate: '',
    endTime: '10:00',
    location: '',
    content: '',
    remindOptions: [
      { label: '不提醒', value: 'null' },
      { label: '到点提醒(0分钟)', value: '0' },
      { label: '提前5分钟', value: '5' },
      { label: '提前10分钟', value: '10' },
      { label: '提前15分钟', value: '15' },
      { label: '提前30分钟', value: '30' },
      { label: '提前60分钟', value: '60' },
    ],
    remindOptionIndex: 3,
    remindSubscribeHint: true,
    calendars: [],
    selectedCalendarIds: [],
    submitting: false,
  },

  onLoad(options) {
    const calId = options.calId ? parseInt(options.calId) : null
    const eventId = options.eventId ? parseInt(options.eventId) : null
    const fromCaptured = options.fromCaptured === '1'
    const capturedId = options.capturedId ? parseInt(options.capturedId) : null
    this.setData({
      calId, eventId, isEdit: !!eventId, fromCaptured, capturedId,
    })
    wx.setNavigationBarTitle({ title: eventId ? '编辑事件' : '创建事件' })

    const selectedCalendarIds = calId ? [String(calId)] : []
    this.loadCalendars(selectedCalendarIds, () => {
      if (!eventId && !fromCaptured) {
        this.setData({ ...this.getDefaultTimeRange() })
      }
    })

    if (eventId) this.loadEvent(eventId)
    if (fromCaptured && capturedId) this.loadCaptured(capturedId)
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

  parseDateTime(dtStr) {
    if (!dtStr) return null
    const normalized = dtStr.replace(/\//g, '-').replace('T', ' ')
    const [datePart, timePart = '00:00:00'] = normalized.split(' ')
    const [y, m, d] = datePart.split('-').map(v => parseInt(v))
    const [hh, mm] = timePart.split(':').map(v => parseInt(v))
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0)
  },

  formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },

  formatClock(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  },

  getDefaultTimeRange() {
    const now = new Date()
    const start = new Date(now)
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    return {
      startDate: this.formatDate(start),
      startTime: this.formatClock(start),
      endDate: this.formatDate(end),
      endTime: this.formatClock(end),
    }
  },

  loadCalendars(selectedCalendarIds, done) {
    app.request({ url: '/calendars' }).then(data => {
      const calendars = (data || []).map(item => ({ ...item, idStr: String(item.id) }))
      const update = { calendars }
      if (selectedCalendarIds !== undefined) {
        update.selectedCalendarIds = selectedCalendarIds
      }
      this.setData(update, () => {
        if (update.selectedCalendarIds) {
          this.setData({ selectedCalendarIds: update.selectedCalendarIds })
        }
        done && done()
      })
    }).catch(() => done && done())
  },

  loadCaptured(capturedId) {
    app.request({ url: '/captured-notifications' }).then(list => {
      const captured = (list || []).find(item => item.id === capturedId)
      if (!captured) {
        wx.showToast({ title: '捕获记录不存在', icon: 'none' })
        return
      }
      const defaults = this.getDefaultTimeRange()
      const startDt = this.parseDateTime(captured.suggested_start_time)
      const endDt = this.parseDateTime(captured.suggested_end_time)
      this.setData({
        title: captured.title || '',
        content: captured.text || '',
        startDate: startDt ? this.formatDate(startDt) : defaults.startDate,
        startTime: startDt ? this.formatClock(startDt) : defaults.startTime,
        endDate: endDt ? this.formatDate(endDt) : defaults.endDate,
        endTime: endDt ? this.formatClock(endDt) : defaults.endTime,
        selectedCalendarIds: [],
      })
    })
  },

  loadEvent(eventId) {
    app.request({ url: `/calendars/${this.data.calId}/events/${eventId}` }).then(event => {
      const start = this.parseDateTime(event.start_time)
      const end = this.parseDateTime(event.end_time)
      this.setData({
        title: event.title || '',
        location: event.location || '',
        content: event.content || '',
        remindOptionIndex: this.findRemindOptionIndex(event.remind_before_minutes),
        remindSubscribeHint: event.remind_before_minutes !== null,
        startDate: start ? this.formatDate(start) : this.todayStr(),
        startTime: start ? this.formatClock(start) : '09:00',
        endDate: end ? this.formatDate(end) : this.todayStr(),
        endTime: end ? this.formatClock(end) : '10:00',
        selectedCalendarIds: this.data.calId ? [String(this.data.calId)] : [],
      })
    })
  },

  onTitleInput(e)    { this.setData({ title: e.detail.value }) },
  onLocationInput(e) { this.setData({ location: e.detail.value }) },
  onContentInput(e)  { this.setData({ content: e.detail.value }) },

  onStartDateChange(e) { this.setData({ startDate: e.detail.value }) },
  onStartTimeChange(e) { this.setData({ startTime: e.detail.value }) },
  onEndDateChange(e)   { this.setData({ endDate: e.detail.value }) },
  onEndTimeChange(e)   { this.setData({ endTime: e.detail.value }) },
  onRemindChange(e) {
    const remindOptionIndex = parseInt(e.detail.value, 10) || 0
    const remindValue = this.getRemindBeforeMinutes(remindOptionIndex)
    this.setData({ remindOptionIndex, remindSubscribeHint: remindValue !== null })
  },
  goSubscribeSettings() {
    wx.navigateTo({ url: '/pages/notification/notification' })
  },
//   onCalendarChange(e) {
//     this.data.selectedCalendarIds = e.detail.value || []
//     console.log(this.data.selectedCalendarIds)
//   },
  onCalendarChange(e) {
    const rawValues = (e && e.detail && e.detail.value) ? e.detail.value : []
    const selectedCalendarIds = Array.from(new Set((rawValues || []).map(v => String(v))))
    this.setData({ selectedCalendarIds })
  },
  

  showBatchResult(result) {
    const failed = (result.results || []).filter(r => !r.ok)
    if (!failed.length) return Promise.resolve()
    const lines = failed.map(r => `日历 ${r.calendar_name} 创建失败：${r.error || '未知错误'}`)
    return new Promise(resolve => {
      wx.showModal({
        title: '部分创建失败',
        content: lines.join('\n'),
        showCancel: false,
        success: () => resolve()
      })
    })
  },

  submit() {
    const {
      title, startDate, startTime, endDate, endTime, location, content,
      calId, eventId, isEdit, fromCaptured, capturedId, submitting, selectedCalendarIds, remindOptionIndex
    } = this.data
    console.log('SUBMIT', Date.now())
    if (submitting) return
    if (!title.trim()) return wx.showToast({ title: '请输入主题', icon: 'none' })
    if (!startDate || !endDate) return wx.showToast({ title: '请选择时间', icon: 'none' })

    const startFull = `${startDate} ${startTime}:00`
    const endFull   = `${endDate} ${endTime}:00`
    const remindBeforeMinutes = this.getRemindBeforeMinutes(remindOptionIndex)
    if (startFull >= endFull) return wx.showToast({ title: '结束时间须晚于开始时间', icon: 'none' })
    if (!isEdit && (!selectedCalendarIds || selectedCalendarIds.length === 0)) {
      return wx.showToast({ title: '请至少选择一个日历', icon: 'none' })
    }

    this.setData({ submitting: true })
    if (isEdit) {
      app.request({
        url: `/calendars/${calId}/events/${eventId}`,
        method: 'PUT',
        data: {
          title: title.trim(),
          start_time: startFull,
          end_time: endFull,
          location: location.trim(),
          content: content.trim(),
          remind_before_minutes: remindBeforeMinutes,
        }
      }).then((res) => {
        app.sendSubscribePayloads(res.subscribe_to_send_list)
        wx.showToast({ title: '修改成功' })
        setTimeout(() => wx.navigateBack(), 1200)
      }).catch(() => this.setData({ submitting: false }))
      return
    }

    const body = {
      calendar_ids: (selectedCalendarIds || [])
        .map(v => parseInt(v, 10))
        .filter(v => !Number.isNaN(v)),
      title: title.trim(),
      start_time: startFull,
      end_time: endFull,
      location: location.trim(),
      content: content.trim(),
      remind_before_minutes: remindBeforeMinutes,
    }
    const url = fromCaptured
      ? `/captured-notifications/${capturedId}/create-events`
      : '/events/batch-create'

    app.request({ url, method: 'POST', data: body }).then((result) => {
      app.sendSubscribePayloads(result.subscribe_to_send_list)
      this.showBatchResult(result).then(() => {
        if (result.all_ok) {
          wx.showToast({ title: fromCaptured ? '创建并确认成功' : '创建成功' })
          setTimeout(() => wx.navigateBack(), 1200)
        } else {
          this.setData({ submitting: false })
        }
      })
    }).catch(() => this.setData({ submitting: false }))
    console.log('selectedCalendarIds', selectedCalendarIds)
    console.log('body.calendar_ids', body.calendar_ids)
  },

  todayStr() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  },

  getRemindBeforeMinutes(index) {
    const option = this.data.remindOptions[index] || this.data.remindOptions[3]
    return option.value === 'null' ? null : parseInt(option.value, 10)
  },

  findRemindOptionIndex(value) {
    const normalized = value === null || value === undefined ? 'null' : String(value)
    const idx = this.data.remindOptions.findIndex(item => item.value === normalized)
    return idx >= 0 ? idx : 3
  },
})
