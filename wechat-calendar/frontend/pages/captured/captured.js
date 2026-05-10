const app = getApp()

Page({
  data: {
    loading: true,
    list: [],
  },

  onLoad() { this.load() },
  onShow() { this.load() },

  load() {
    this.setData({ loading: true })
    app.request({ url: '/captured-notifications' })
      .then(data => this.setData({ list: data || [], loading: false }))
      .catch(() => this.setData({ loading: false }))
  },

  dismissItem(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '忽略该捕获？',
      content: '忽略后将不会出现在捕获列表',
      success: (res) => {
        if (!res.confirm) return
        app.request({
          url: `/captured-notifications/${id}/dismiss`,
          method: 'POST'
        }).then(() => {
          wx.showToast({ title: '已忽略' })
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
