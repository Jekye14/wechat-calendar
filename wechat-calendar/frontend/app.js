// app.js
App({
  globalData: {
    openid: '',
    userInfo: null,
    baseUrl: 'http://localhost:8080',  // 替换为你的服务器地址
  },

  onLaunch() {
    const openid = wx.getStorageSync('openid')
    const userInfo = wx.getStorageSync('userInfo')
    if (openid) {
      this.globalData.openid = openid
      this.globalData.userInfo = userInfo
    }
  },

  request(options) {
    const openid = this.globalData.openid
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.globalData.baseUrl + options.url,
        method: options.method || 'GET',
        data: options.data,
        header: {
          'Content-Type': 'application/json',
          'x-user-openid': openid,
          ...options.header,
        },
        success(res) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data)
          } else {
            const msg = res.data?.detail || '请求失败'
            wx.showToast({ title: msg, icon: 'none' })
            reject(res)
          }
        },
        fail(err) {
          wx.showToast({ title: '网络错误', icon: 'none' })
          reject(err)
        }
      })
    })
  }
})
