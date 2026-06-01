// app.js
const zh = require('./locales/zh')
const en = require('./locales/en')

App({
  globalData: {
    openid: '',
    userInfo: null,
    lang: 'zh',  // 默认中文，onLaunch 中根据微信语言自动检测

    // 云托管配置
    cloudEnv: 'prod-0g6c5yfpa326bfaf',
    resourceEnv: 'cloud1-d2gadtxsif7c3d56f',
    serviceName: 'django-ifdx',

    // 不再需要走域名/baseUrl
    // baseUrl: 'http://localhost:8080',
  },

  onLaunch() {
    // 检测微信语言并设置全局语言
    const appBaseInfo = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
    const wxLang = (appBaseInfo.language || '').toLowerCase()
    this.globalData.lang = wxLang.startsWith('zh') ? 'zh' : 'en'

    // 动态更新 tabBar 和导航栏标题（随语言切换）
    this._updateStaticText()

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

  /**
   * 动态更新 app.json 中静态文本（tabBar 文字、导航栏标题）。
   * app.json 不支持运行时表达式，因此通过 API 动态设置。
   */
  _updateStaticText() {
    const locales = { zh, en }
    const lang = this.globalData.lang
    const t = locales[lang] || locales.zh

    // 导航栏标题：马上升效，覆盖 app.json 默认值
    wx.setNavigationBarTitle({ title: t.nav.teamCalendar })

    // tabBar 文字：延迟执行确保 tabBar 已完成初始化
    setTimeout(() => {
      wx.setTabBarItem({ index: 0, text: t.nav.calendar })
      wx.setTabBarItem({ index: 1, text: t.nav.notification })
      wx.setTabBarItem({ index: 2, text: t.nav.captured })
    }, 300)
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
      this.subscribeCloud.callFunction({
        name: 'sendSubscribe',
        data: payload,
      }).then(res => {
        if (!res || !res.result) {
          console.error('[订阅消息] 云函数返回异常:', res)
          return
        }
        // ok 但 sent=false：用户未订阅该模板（正常情况，不需要报警）
        if (res.result.ok && res.result.sent === false) {
          console.log('[订阅消息] 用户未订阅此模板, 跳过:', {
            template_id: payload.template_id,
            openid: payload.openid,
          })
          return
        }
        // ok 且 sent=true：发送成功
        if (res.result.ok && res.result.sent === true) {
          console.log('[订阅消息] 发送成功:', {
            template_id: payload.template_id,
            openid: payload.openid,
          })
          return
        }
        // ok 但 sent 未定义（兼容旧版云函数）且 result 有 errcode 检查
        if (res.result.ok && res.result.result && res.result.result.errCode !== 0) {
          console.warn('[订阅消息] 微信API返回错误:', {
            errCode: res.result.result.errCode,
            errMsg: res.result.result.errMsg,
            template_id: payload.template_id,
            openid: payload.openid,
          })
          return
        }
        // ok=false：云函数执行失败
        console.error('[订阅消息] 云函数执行失败:', res.result.err, payload)
      }).catch(err => {
        console.error('[订阅消息] 云函数调用失败:', err, payload)
      })
    )
    return Promise.all(tasks)
  },
})
