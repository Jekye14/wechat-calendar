// pages/event/event.js  ── 创建/编辑普通事件
const app = getApp()

Page({
  data: {
    calId: null,
    eventId: null,   // 有值则为编辑模式
    isEdit: false,
    title: '',
    startDate: '',
    startTime: '09:00',
    endDate: '',
    endTime: '10:00',
    location: '',
    content: '',
    submitting: false,
  },

  onLoad(options) {
    const calId = parseInt(options.calId)
    const eventId = options.eventId ? parseInt(options.eventId) : null
    const date = options.date || this.todayStr()
    this.setData({
      calId, eventId, isEdit: !!eventId,
      startDate: date, endDate: date,
    })
    wx.setNavigationBarTitle({ title: eventId ? '编辑事件' : '创建事件' })
    if (eventId) this.loadEvent(eventId)
  },

  loadEvent(eventId) {
    app.request({ url: `/calendars/${this.data.calId}/events/${eventId}` }).then(ev => {
      const [sd, st] = ev.start_time.split(' ')
      const [ed, et] = ev.end_time.split(' ')
      this.setData({
        title: ev.title,
        startDate: sd, startTime: st.substring(0,5),
        endDate: ed, endTime: et.substring(0,5),
        location: ev.location,
        content: ev.content,
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

  submit() {
    const { title, startDate, startTime, endDate, endTime, location, content, calId, eventId, isEdit, submitting } = this.data
    if (submitting) return
    if (!title.trim()) return wx.showToast({ title: '请输入主题', icon: 'none' })
    if (!startDate || !endDate) return wx.showToast({ title: '请选择时间', icon: 'none' })

    const startFull = `${startDate} ${startTime}:00`
    const endFull   = `${endDate} ${endTime}:00`
    if (startFull >= endFull) return wx.showToast({ title: '结束时间须晚于开始时间', icon: 'none' })

    this.setData({ submitting: true })
    const method = isEdit ? 'PUT' : 'POST'
    const url = isEdit
      ? `/calendars/${calId}/events/${eventId}`
      : `/calendars/${calId}/events`

    app.request({
      url, method,
      data: {
        title: title.trim(),
        start_time: startFull,
        end_time: endFull,
        location: location.trim(),
        content: content.trim(),
      }
    }).then(() => {
      wx.showToast({ title: isEdit ? '修改成功' : '创建成功，等待审批' })
      setTimeout(() => wx.navigateBack(), 1200)
    }).catch(() => {
      this.setData({ submitting: false })
    })
  },

  todayStr() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  },
})
