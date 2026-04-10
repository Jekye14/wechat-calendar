// pages/event-detail/event-detail.js  ── 事件详情/审批
const app = getApp()

Page({
  data: {
    calId: null,
    eventId: null,
    event: null,
    calendar: null,
    isCreator: false,
    isEventOwner: false,
    showRejectModal: false,
    rejectReason: '',
  },

  onLoad(options) {
    this.setData({
      calId: parseInt(options.calId),
      eventId: parseInt(options.eventId),
    })
    this.load()
  },

  load() {
    const { calId, eventId } = this.data
    Promise.all([
      app.request({ url: `/calendars/${calId}` }),
      app.request({ url: `/calendars/${calId}/events/${eventId}` }),
    ]).then(([cal, ev]) => {
      const userId = app.globalData.userInfo && app.globalData.userInfo.id
      this.setData({
        calendar: cal,
        event: ev,
        isCreator: cal.creator_id === userId,
        isEventOwner: ev.creator_id === userId,
      })
      wx.setNavigationBarTitle({ title: ev.title })
    })
  },

  approveEvent() {
    wx.showModal({
      title: '确认审批',
      content: '确认通过该事件？',
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}/approve`,
            method: 'PUT',
          }).then(() => {
            wx.showToast({ title: '已通过' })
            this.load()
          })
        }
      }
    })
  },

  showReject() { this.setData({ showRejectModal: true, rejectReason: '' }) },
  closeReject() { this.setData({ showRejectModal: false }) },
  onReasonInput(e) { this.setData({ rejectReason: e.detail.value }) },

  rejectEvent() {
    app.request({
      url: `/calendars/${this.data.calId}/events/${this.data.eventId}/reject`,
      method: 'PUT',
      data: { reason: this.data.rejectReason },
    }).then(() => {
      this.setData({ showRejectModal: false })
      wx.showToast({ title: '已拒绝' })
      this.load()
    })
  },

  editEvent() {
    wx.navigateTo({
      url: `/pages/event/event?calId=${this.data.calId}&eventId=${this.data.eventId}`
    })
  },

  deleteEvent() {
    wx.showModal({
      title: '删除事件',
      content: '确认删除该事件？',
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}`,
            method: 'DELETE'
          }).then(() => {
            wx.navigateBack()
          })
        }
      }
    })
  },
})
