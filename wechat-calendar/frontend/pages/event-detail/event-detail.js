// pages/event-detail/event-detail.js  ── 事件详情/审批
const app = getApp()
const i18n = require('../../utils/i18n')

Page({
  data: {
    calId: null,
    eventId: null,
    event: null,
    calendar: null,
    loading: true,
    isDeleted: false,
    isCreator: false,
    isEventOwner: false,
    showRejectModal: false,
    rejectReason: '',
    showRejectDeletionModal: false,
    rejectDeletionReason: '',
    t: {},
    updateApprovalDescText: '',
  },

  onLoad(options) {
    const t = i18n.getLocale()
    this.setData({
      calId: options.calId ? parseInt(options.calId, 10) : null,
      eventId: parseInt(options.eventId || options.id, 10),
      t,
    })
    this.loadEvent()
  },

  onShow() {
    if (this.data.eventId) this.loadEvent()
  },

  load() {
    this.loadEvent()
  },

  loadEvent() {
    const { calId, eventId } = this.data
    this.setData({ loading: true, isDeleted: false })

    const loadPromise = calId
      ? Promise.all([
          app.request({ url: `/calendars/${calId}` }),
          app.request({ url: `/calendars/${calId}/events/${eventId}` }),
        ]).then(([cal, ev]) => ({ cal, ev }))
      : app.request({ url: `/events/${eventId}` }).then(ev =>
          app.request({ url: `/calendars/${ev.calendar_id}` }).then(cal => ({ cal, ev }))
        )

    loadPromise.then(({ cal, ev }) => {
      const event = {
        ...ev,
        created_at_text: formatDateTime(ev.created_at),
      }
      // 格式化 pending_revision 的时间
      if (event.pending_revision) {
        event.pending_revision.created_at_text = formatDateTime(event.pending_revision.created_at)
      }
      // 生成修改审批描述文本
      const t = this.data.t
      let updateApprovalDescText = ''
      if (event.pending_revision) {
        const template = t.detail.updateApprovalDesc || '成员「{{name}}」于 {{time}} 提交了修改'
        updateApprovalDescText = template
          .replace('{{name}}', event.pending_revision.editor_name || '')
          .replace('{{time}}', event.pending_revision.created_at_text || '')
      }
      const userId = app.globalData.userInfo && app.globalData.userInfo.id
      this.setData({
        calId: event.calendar_id,
        calendar: cal,
        event,
        loading: false,
        isDeleted: false,
        isCreator: cal.creator_id === userId,
        isEventOwner: event.creator_id === userId,
        updateApprovalDescText,
      })
      wx.setNavigationBarTitle({ title: event.title })
    }).catch((err) => {
      if (err && err.statusCode === 404) {
        this.setData({
          calendar: null,
          event: null,
          loading: false,
          isDeleted: true,
          isCreator: false,
          isEventOwner: false,
        })
        wx.setNavigationBarTitle({ title: this.data.t.nav.eventDetail })
        return
      }
      this.setData({ loading: false })
    })
  },

  approveEvent() {
    const status = this.data.event && this.data.event.status
    const isUpdatePending = status === 'update_pending'
    const isDeletePending = status === 'delete_pending'
    const t = this.data.t
    wx.showModal({
      title: t.detail.approveTitle,
      content: isUpdatePending ? t.detail.approveUpdate : isDeletePending ? t.detail.approveDelete : t.detail.approveNew,
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}/approve`,
            method: 'POST',
          }).then((res) => {
            app.sendSubscribePayloads(res.subscribe_to_send_list)
            wx.showToast({ title: t.detail.approved })
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
    }).then((res) => {
      app.sendSubscribePayloads(res.subscribe_to_send_list)
      this.setData({ showRejectModal: false })
      wx.showToast({ title: this.data.t.detail.rejected })
      this.load()
    })
  },

  editEvent() {
    wx.navigateTo({
      url: `/pages/event/event?calId=${this.data.calId}&eventId=${this.data.eventId}`
    })
  },
  approveDeletion() {
    const t = this.data.t
    wx.showModal({
      title: t.detail.deleteApproveTitle,
      content: t.detail.deleteApproveConfirm,
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}/approve`,
            method: 'POST',
          }).then((res) => {
            app.sendSubscribePayloads(res.subscribe_to_send_list)
            wx.showToast({ title: t.detail.deleteApproved })
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
    }).then((res) => {
      app.sendSubscribePayloads(res.subscribe_to_send_list)
      this.setData({ showRejectDeletionModal: false })
      wx.showToast({ title: this.data.t.detail.rejected2 })
      this.load()
    })
  },
  deleteEvent() {
    const { event } = this.data
    const isCreator = this.data.isCreator
    const isEventOwner = this.data.isEventOwner
    const t = this.data.t
    
    // 判断是否需要审批
    const needsApproval = !isCreator && event.status !== 'rejected'
    const contentMsg = needsApproval 
      ? t.detail.deleteNeedApproval
      : t.detail.deleteConfirm
    
    wx.showModal({
      title: t.detail.deleteEventTitle,
      content: contentMsg,
      success: (res) => {
        if (res.confirm) {
          app.request({
            url: `/calendars/${this.data.calId}/events/${this.data.eventId}`,
            method: 'DELETE'
          }).then((response) => {
            app.sendSubscribePayloads(response.subscribe_to_send_list)
            const msg = needsApproval ? t.detail.deleteSubmitted : t.detail.deleteSuccess
            wx.showToast({ title: msg })
            setTimeout(() => wx.navigateBack(), 1000)
          })
        }
      }
    })
  },
})

function formatDateTime(s) {
  if (!s) return ''
  var str = String(s)
  // 如果是 UTC 时间（末尾带 Z），转换为北京时间 (UTC+8)
  var isUtc = str.endsWith('Z') || str.endsWith('z')
  var dt = new Date(str.replace(' ', 'T'))
  if (Number.isNaN(dt.getTime())) {
    // 回退：简单格式化
    return str.replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/i, '')
  }
  var y = dt.getUTCFullYear()
  var M = String(dt.getUTCMonth() + 1).padStart(2, '0')
  var d = String(dt.getUTCDate()).padStart(2, '0')
  var hh = String(dt.getUTCHours()).padStart(2, '0')
  var mm = String(dt.getUTCMinutes()).padStart(2, '0')
  var ss = String(dt.getUTCSeconds()).padStart(2, '0')
  // UTC → 北京时间: 加 8 小时，跨天自动进位
  var utcTs = Date.UTC(y, parseInt(M) - 1, parseInt(d), parseInt(hh), parseInt(mm), parseInt(ss))
  var beijingTs = utcTs + 8 * 3600 * 1000
  var beijingDt = new Date(beijingTs)
  var by = beijingDt.getUTCFullYear()
  var bM = String(beijingDt.getUTCMonth() + 1).padStart(2, '0')
  var bd = String(beijingDt.getUTCDate()).padStart(2, '0')
  var bh = String(beijingDt.getUTCHours()).padStart(2, '0')
  var bm = String(beijingDt.getUTCMinutes()).padStart(2, '0')
  return by + '-' + bM + '-' + bd + ' ' + bh + ':' + bm
}
