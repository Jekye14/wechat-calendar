// pages/notification/notification.js
const app = getApp()

Page({
  data: {
    notifications: [],
    loading: true,
  },

  onLoad() { this.load() },
  onShow() { this.load() },

  load() {
    this.setData({ loading: true })
    app.request({ url: '/notifications' }).then(data => {
      this.setData({ notifications: data, loading: false })
      // 标记全部已读
      app.request({ url: '/notifications/read-all', method: 'PUT' })
    }).catch(() => this.setData({ loading: false }))
  },

  goToEvent(e) {
    const { calId, eventId } = e.currentTarget.dataset
    if (calId && eventId) {
      wx.navigateTo({ url: `/pages/event-detail/event-detail?calId=${calId}&eventId=${eventId}` })
    }
  },

  typeIcon(type) {
    return { new_event: '📋', approved: '✅', rejected: '❌', assigned: '📌' }[type] || '🔔'
  },
})
