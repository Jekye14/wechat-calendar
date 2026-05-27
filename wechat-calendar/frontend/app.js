// app.js
App({
  globalData: {
    openid: '',
    userInfo: null,

    // 云托管配置
    cloudEnv: 'prod-0g6c5yfpa326bfaf',
    resourceEnv: 'cloud1-d2gadtxsif7c3d56f',
    serviceName: 'django-ifdx',

    // 不再需要走域名/baseUrl
    // baseUrl: 'http://localhost:8080',
  },

  onLaunch() {
    // 新增：初始化云环境（只需要一次）
    wx.cloud.init({
      env: this.globalData.cloudEnv
    })
    // 2. 为订阅消息创建一个新的实例，用于访问云开发环境
    this.subscribeCloud = new wx.cloud.Cloud({
      resourceEnv: this.globalData.resourceEnv,
    })
    // 实例创建后必须调用 init 方法
    this.subscribeCloud.init()

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
  },

  sendSubscribePayloads(subscribeToSendList) {
    const list = Array.isArray(subscribeToSendList) ? subscribeToSendList : []
    if (!list.length || !this.subscribeCloud) return Promise.resolve()

    const tasks = list.map(payload =>
      this.subscribeCloud.callHTTPFunction({
        name: 'sendSubscribe',
        path: '/send',
        method: 'POST',
        data: payload,
      }).catch(err => {
        console.log('callHTTPFunction sendSubscribe fail:', err, payload)
      })
    )
    return Promise.all(tasks)
  },
})
