// pages/notification/notification.js
const app = getApp()

Page({
  data: {
    notifications: [],
    loading: true,
    subscribeConfig: null,
    subscribeStatusMap: {},
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
    // console.log("updateSubscribeStatus: " + config)
    // console.log("updateSubscribeStatus: " + tmplIds)
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
      subscribeStatusMap: statusMap,
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

    // 统一逻辑：始终先调用 requestSubscribeMessage
    // 拿到的结果与后端记录的 subscribeStatusMap 比对，
    // 完全一致 = 弹窗不会出现 → 引导去设置页管理
    // 不一致 = 弹窗正常出现 → 上报结果
    this.setData({ subscribeLoading: true })
    const backendMap = this.data.subscribeStatusMap || {}

    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        // 比对微信返回结果与后端记录是否完全一致
        const allMatch = tmplIds.every(id => {
          const wxResult = (res[id] || '').trim()
          const backendResult = (backendMap[id] || '').trim()

          // 微信返回 reject/ban 都对应后端的 reject
          if (backendResult === 'reject' && (wxResult === 'reject' || wxResult === 'ban')) return true
          // 微信返回 accept 对应后端的 accept
          if (backendResult === 'accept' && wxResult === 'accept') return true
          // 其余情况视为不一致（包括后端 unknown、两侧不同等）
          return false
        })

        if (allMatch) {
          // 完全一致：弹窗不会出现，引导去设置页
          this.setData({ subscribeLoading: false })
          wx.showModal({
            title: '管理订阅消息',
            content: '您已授权过订阅消息且设置未变更。要修改设置，请前往小程序设置页面的「订阅消息」进行管理。',
            confirmText: '前往设置',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: () => { this.loadSubscribeStatus() }
                })
              } else {
                this.loadSubscribeStatus()
              }
            }
          })
          return
        }

        // 不一致：弹窗正常出现，上报结果到后端
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

        // 20004: 微信订阅消息总开关被关闭
        if (err && err.errCode === 20004) {
          wx.showModal({
            title: '订阅消息已关闭',
            content: '您已关闭微信的订阅消息总开关，无法弹出授权窗口。请前往小程序设置页面打开「订阅消息」开关后再试。',
            confirmText: '前往设置',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: () => { this.loadSubscribeStatus() }
                })
              }
            }
          })
          return
        }

        wx.showToast({ title: err?.errMsg || '订阅授权未完成', icon: 'none' })
      },
    })
  },

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
