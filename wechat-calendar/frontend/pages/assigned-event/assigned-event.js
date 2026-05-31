// pages/assigned-event/assigned-event.js  ── 创建指派事件（仅创建者）
const app = getApp()
const i18n = require('../../utils/i18n')

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
    t: {},
    assignMembersText: '',
  },

  onLoad(options) {
    const t = i18n.getLocale()
    const calId = parseInt(options.calId)
    const date = options.date || this.todayStr()
    this.setData({ calId, startDate: date, endDate: date, t, assignMembersText: this.formatAssignMembersText(0) })
    wx.setNavigationBarTitle({ title: t.nav.createAssignedEvent })
    this.loadMembers()
  },

  formatAssignMembersText(count) {
    const t = this.data.t
    const template = t.event.assignMembers || '选择指派成员 *（已选 {{count}} 人）'
    return template.replace('{{count}}', count)
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
    this.setData({
      members,
      selectedIds,
      assignMembersText: this.formatAssignMembersText(selectedIds.length),
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
    const { title, startDate, startTime, endDate, endTime, location, content, calId, selectedIds, submitting, t } = this.data
    if (submitting) return
    if (!title.trim()) return wx.showToast({ title: t.event.pleaseEnterTitle, icon: 'none' })
    if (!startDate || !endDate) return wx.showToast({ title: t.event.pleaseSelectTime, icon: 'none' })
    if (selectedIds.length === 0) return wx.showToast({ title: t.event.pleaseSelectMember, icon: 'none' })

    const startFull = `${startDate} ${startTime}:00`
    const endFull   = `${endDate} ${endTime}:00`
    if (startFull >= endFull) return wx.showToast({ title: t.event.endBeforeStart, icon: 'none' })

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
      wx.showToast({ title: t.event.assignedCreated })
      setTimeout(() => wx.navigateBack(), 1500)
    }).catch(() => this.setData({ submitting: false }))
  },

  todayStr() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  },
})
