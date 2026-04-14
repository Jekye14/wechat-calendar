// pages/join/join.js  ── 通过邀请链接加入日历
const app = getApp()

Page({
  data: {
    token: '',
    status: 'loading',  // loading | success | error
    message: '',
    calendarName: '',
  },
  onLoad(options) {
    const token = options.token || ''
    if (!token) {
      this.setData({ status: 'error', message: '邀请链接无效' })
      return
    }
    this.setData({ token })
    
    if (!app.globalData.openid) {
      // 删去 wx.login 嵌套，直接请求
      app.request({
        url: '/auth/login',
        method: 'POST',
        data: { nick_name: '微信用户', avatar_url: '' }
      }).then(data => {
        app.globalData.openid = data.openid
        app.globalData.userInfo = data.user
        wx.setStorageSync('openid', data.openid)
        wx.setStorageSync('userInfo', data.user)
        this.doJoin(token)
      }).catch(() => {
        this.setData({ status: 'error', message: '自动登录失败' })
      })
    } else {
      this.doJoin(token)
    }
  },
//   onLoad(options) {
//     // 小程序码/分享链接带来的 query 参数
//     const token = options.token || ''
//     if (!token) {
//       this.setData({ status: 'error', message: '邀请链接无效' })
//       return
//     }
//     this.setData({ token })
//     if (!app.globalData.openid) {
//       // 先登录再加入
//       wx.login({
//         success: (res) => {
//           app.request({
//             url: '/auth/login',
//             method: 'POST',
//             data: { code: res.code, nick_name: '', avatar_url: '' }
//           }).then(data => {
//             app.globalData.openid = data.openid
//             app.globalData.userInfo = data.user
//             wx.setStorageSync('openid', data.openid)
//             wx.setStorageSync('userInfo', data.user)
//             this.doJoin(token)
//           })
//         }
//       })
//     } else {
//       this.doJoin(token)
//     }
//   },

  doJoin(token) {
    app.request({
      url: '/calendars/join',
      method: 'POST',
      data: { token }
    }).then(data => {
      this.setData({
        status: 'success',
        message: data.message,
        calendarName: data.calendar && data.calendar.name,
        calId: data.calendar && data.calendar.id,
      })
    }).catch(() => {
      this.setData({ status: 'error', message: '加入失败，邀请链接可能已过期' })
    })
  },

  goCalendar() {
    wx.redirectTo({ url: `/pages/calendar/calendar?id=${this.data.calId}` })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
