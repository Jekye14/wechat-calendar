// pages/notification/notification.js
const app = getApp()

Page({
  data: {
    notifications: [],
    loading: true,
    subscribeConfig: null,
    subscribeStatusText: '未开启',
    subscribeStatusClass: 'status-off',
    subscribeButtonText: '开启审批通知',
    subscribeLoading: false,
  },

  onLoad() { this.load() },
  onShow() { this.load() },

  load() {
    this.loadSubscribeStatus()
    this.loadNotifications()
  },

  loadSubscribeStatus() {
    return Promise.all([
      app.request({ url: '/subscribe/config' }),
      app.request({ url: '/subscribe/status' }),
    ]).then(([config, statusRes]) => {
      this.updateSubscribeStatus(config, statusRes.status || {})
    }).catch(() => {
      this.setData({
        subscribeConfig: null,
        subscribeStatusText: '未开启',
        subscribeStatusClass: 'status-off',
        subscribeButtonText: '开启审批通知',
      })
    })
  },

  updateSubscribeStatus(config, statusMap) {
    const tmplIds = [
      config && config.approval_result_template_id,
      config && config.schedule_update_template_id,
      config && config.event_reminder_template_id,
    ].filter(Boolean)
    const states = tmplIds.map(id => statusMap[id] || 'unknown')

    let subscribeStatusText = '未开启'
    let subscribeStatusClass = 'status-off'
    let subscribeButtonText = '开启审批通知'
    if (tmplIds.length > 0 && states.every(state => state === 'accept')) {
      subscribeStatusText = '已开启'
      subscribeStatusClass = 'status-on'
      subscribeButtonText = '重新授权'
    } else if (states.some(state => state === 'reject' || state === 'ban')) {
      subscribeStatusText = '需重新授权'
      subscribeStatusClass = 'status-warn'
      subscribeButtonText = '重新授权'
    }

    this.setData({
      subscribeConfig: config,
      subscribeStatusText,
      subscribeStatusClass,
      subscribeButtonText,
    })
  },

  loadNotifications() {
    this.setData({ loading: true })
    app.request({ url: '/notifications' }).then(data => {
      const notifications = (data || []).map(item => ({
        ...item,
        created_at_text: formatDateTime(item.created_at),
      }))
      this.setData({ notifications, loading: false })
      // 标记全部已读
      app.request({ url: '/notifications/read-all', method: 'PUT' })
    }).catch(() => this.setData({ loading: false }))
  },

  requestSubscribe() {
    // 必须在用户 tap 的同步调用栈内直接调用 requestSubscribeMessage
    const config = this.data.subscribeConfig
    const tmplIds = [
      config && config.approval_result_template_id,
      config && config.schedule_update_template_id,
      config && config.event_reminder_template_id,
    ].filter(Boolean)
  
    if (!tmplIds.length) {
      wx.showToast({ title: '模板未配置', icon: 'none' })
      return
    }
  
    this.setData({ subscribeLoading: true })
  
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        // 这里再异步上报后端没问题
        app.request({
          url: '/subscribe/report',
          method: 'POST',
          data: { result: res },
        }).finally(() => {
          this.setData({ subscribeLoading: false })
          this.loadSubscribeStatus()
          wx.showToast({ title: '授权结果已更新', icon: 'none' })
        })
      },
      fail: (err) => {
        console.log('requestSubscribeMessage fail:', err)
        this.setData({ subscribeLoading: false })
        wx.showToast({ title: err?.errMsg || '订阅授权未完成', icon: 'none' })
      },
    })
  },

//   requestSubscribe() {
//     this.setData({ subscribeLoading: true })
//     app.request({ url: '/subscribe/config' }).then((config) => {
//       const tmplIds = [
//         config.approval_result_template_id,
//         config.schedule_update_template_id,
//       ].filter(Boolean)

//       if (!tmplIds.length) {
//         this.setData({ subscribeLoading: false })
//         wx.showToast({ title: '模板未配置', icon: 'none' })
//         return
//       }
// 
//       wx.requestSubscribeMessage({
//         tmplIds,
//         success: (res) => {
//           app.request({
//             url: '/subscribe/report',
//             method: 'POST',
//             data: { result: res },
//           }).finally(() => {
//             this.setData({ subscribeLoading: false })
//             this.loadSubscribeStatus()
//             wx.showToast({ title: '授权结果已更新', icon: 'none' })
//           })
//         },
//         fail: (err) => {
//           this.setData({ subscribeLoading: false })
//           console.log('requestSubscribeMessage fail:', err)
//           wx.showToast({ title: '订阅授权未完成', icon: 'none' })
//         },
//       })
//     }).catch(() => {
//       this.setData({ subscribeLoading: false })
//     })
//   },

  goToEvent(e) {
    const { eventId } = e.currentTarget.dataset
    if (eventId) {
      wx.navigateTo({ url: `/pages/event-detail/event-detail?id=${eventId}` })
    }
  },

  typeIcon(type) {
    return { new_event: '📋', approved: '✅', rejected: '❌', assigned: '📌' }[type] || '🔔'
  },
})

function formatDateTime(s) {
  if (!s) return ''
  var str = String(s)
  var isUtc = str.endsWith('Z') || str.endsWith('z')
  var dt = new Date(str.replace(' ', 'T'))
  if (Number.isNaN(dt.getTime())) {
    return str.replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/i, '')
  }
  var y = dt.getUTCFullYear()
  var M = String(dt.getUTCMonth() + 1).padStart(2, '0')
  var d = String(dt.getUTCDate()).padStart(2, '0')
  var hh = String(dt.getUTCHours()).padStart(2, '0')
  var mm = String(dt.getUTCMinutes()).padStart(2, '0')
  var ss = String(dt.getUTCSeconds()).padStart(2, '0')
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
