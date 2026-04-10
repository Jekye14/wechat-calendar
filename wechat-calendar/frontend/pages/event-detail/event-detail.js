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
    showRejectDeletionModal: false,
    rejectDeletionReason: '',
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
            method: 'POST',
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
      method: 'POST',
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
  approveDeletion() {
    wx.showModal({
      title: '确认同意删除',
      content: '确认同意该成员删除此事件？',
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}/approve`,
            method: 'POST',
          }).then(() => {
            wx.showToast({ title: '已同意删除' })
            this.load()
          })
        }
      }
    })
  },
  
  showRejectDeletion() { 
    this.setData({ showRejectDeletionModal: true, rejectDeletionReason: '' }) 
  },
  
  closeRejectDeletion() { 
    this.setData({ showRejectDeletionModal: false }) 
  },
  
  onRejectDeletionInput(e) { 
    this.setData({ rejectDeletionReason: e.detail.value }) 
  },
  
  rejectDeletion() {
    app.request({
      url: `/calendars/${this.data.calId}/events/${this.data.eventId}/reject`,
      method: 'POST',
      data: { reason: this.data.rejectDeletionReason },
    }).then(() => {
      this.setData({ showRejectDeletionModal: false })
      wx.showToast({ title: '已驳回' })
      this.load()
    })
  },
  deleteEvent() {
    const { event } = this.data
    const isCreator = this.data.isCreator
    const isEventOwner = this.data.isEventOwner
    
    // 判断是否需要审批
    const needsApproval = !isCreator && event.status !== 'rejected'
    const contentMsg = needsApproval 
      ? '删除需要创建者审批，确认提交删除申请？' 
      : '确认删除该事件？'
    
    wx.showModal({
      title: '删除事件',
      content: contentMsg,
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}`,
            method: 'DELETE'
          }).then((response) => {
            const msg = needsApproval ? '删除申请已提交，等待创建者审批' : '删除成功'
            wx.showToast({ title: msg })
            setTimeout(() => wx.navigateBack(), 1000)
          })
        }
      }
    })
  },
})
