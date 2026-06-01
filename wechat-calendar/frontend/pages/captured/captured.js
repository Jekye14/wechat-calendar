const app = getApp()
const i18n = require('../../utils/i18n')

Page({
  data: {
    loading: true,
    list: [],
    t: {},
  },

  onLoad() {
    this.setData({ t: i18n.getLocale() })
    this.load()
  },
  onShow() { this.load() },

  load() {
    this.setData({ loading: true })
    app.request({ url: '/captured-notifications' })
      .then(data => this.setData({ list: data || [], loading: false }))
      .catch(() => this.setData({ loading: false }))
  },

  dismissItem(e) {
    const id = e.currentTarget.dataset.id
    const t = this.data.t
    wx.showModal({
      title: t.captured.ignoreTitle,
      content: t.captured.ignoreDesc,
      success: (res) => {
        if (!res.confirm) return
        app.request({
          url: `/captured-notifications/${id}/dismiss`,
          method: 'POST'
        }).then(() => {
          wx.showToast({ title: t.captured.ignored })
          this.load()
        })
      }
    })
  },

  createFromCaptured(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/event/event?fromCaptured=1&capturedId=${id}`
    })
  },
})
