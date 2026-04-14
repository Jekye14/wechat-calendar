// app.js
App({
  globalData: {
    openid: '',
    userInfo: null,

    // 云托管配置
    cloudEnv: 'prod-0g6c5yfpa326bfaf',
    serviceName: 'django-ifdx',

    // 不再需要走域名/baseUrl
    // baseUrl: 'http://localhost:8080',
  },

  onLaunch() {
    // 新增：初始化云环境（只需要一次）
    wx.cloud.init({
      env: this.globalData.cloudEnv
    })

    const openid = wx.getStorageSync('openid')
    const userInfo = wx.getStorageSync('userInfo')
    if (openid) {
      this.globalData.openid = openid
      this.globalData.userInfo = userInfo
    }
  },

  request(options) {
    // 这里的 const openid = this.globalData.openid 可以删掉了
    return new Promise((resolve, reject) => {
      wx.cloud.callContainer({
        config: { env: this.globalData.cloudEnv },
        path: options.url,
        method: options.method || 'GET',
        data: options.data,
        header: {
          'Content-Type': 'application/json',
          'X-WX-SERVICE': this.globalData.serviceName,
          // 删除 'x-user-openid': openid, <--- 把这行删掉！
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