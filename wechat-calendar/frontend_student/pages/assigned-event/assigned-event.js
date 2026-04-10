// pages/assigned-event/assigned-event.js  ── 创建指派事件（仅创建者）
const app = getApp()

Page({
  data: {
    calId: null,
    members: [],
    selectedIds: [],
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
    const date = options.date || this.todayStr()
    this.setData({ calId, startDate: date, endDate: date })
    wx.setNavigationBarTitle({ title: '创建指派事件' })
    this.loadMembers()
  },

  loadMembers() {
    app.request({ url: `/calendars/${this.data.calId}` }).then(data => {
      const members = data.members.map(m => ({ ...m, selected: false }))
      this.setData({ members })
    })
  },

  toggleMember(e) {
    const idx = e.currentTarget.dataset.index
    const members = this.data.members
    members[idx].selected = !members[idx].selected
    const selectedIds = members.filter(m => m.selected).map(m => m.id)
    this.setData({ members, selectedIds })
  },

  onTitleInput(e)    { this.setData({ title: e.detail.value }) },
  onLocationInput(e) { this.setData({ location: e.detail.value }) },
  onContentInput(e)  { this.setData({ content: e.detail.value }) },
  onStartDateChange(e) { this.setData({ startDate: e.detail.value }) },
  onStartTimeChange(e) { this.setData({ startTime: e.detail.value }) },
  onEndDateChange(e)   { this.setData({ endDate: e.detail.value }) },
  onEndTimeChange(e)   { this.setData({ endTime: e.detail.value }) },

  submit() {
    const { title, startDate, startTime, endDate, endTime, location, content, calId, selectedIds, submitting } = this.data
    if (submitting) return
    if (!title.trim()) return wx.showToast({ title: '请输入主题', icon: 'none' })
    if (!startDate || !endDate) return wx.showToast({ title: '请选择时间', icon: 'none' })
    if (selectedIds.length === 0) return wx.showToast({ title: '请至少选择一名成员', icon: 'none' })

    const startFull = `${startDate} ${startTime}:00`
    const endFull   = `${endDate} ${endTime}:00`
    if (startFull >= endFull) return wx.showToast({ title: '结束时间须晚于开始时间', icon: 'none' })

    this.setData({ submitting: true })
    app.request({
      url: `/calendars/${calId}/assigned-events`,
      method: 'POST',
      data: {
        title: title.trim(),
        start_time: startFull,
        end_time: endFull,
        location: location.trim(),
        content: content.trim(),
        assigned_member_ids: selectedIds,
      }
    }).then(() => {
      wx.showToast({ title: '指派事件已创建并通知成员' })
      setTimeout(() => wx.navigateBack(), 1500)
    }).catch(() => this.setData({ submitting: false }))
  },

  todayStr() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  },
})
