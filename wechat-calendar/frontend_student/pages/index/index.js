// pages/index/index.js  ── 首页：日历列表 + 登录
const app = getApp()

Page({
  data: {
    calendars: [],
    userInfo: null,
    loading: true,
    showCreateModal: false,
    newName: '',
    newDesc: '',
  },

  onLoad() {
    if (!app.globalData.openid) {
      this.doLogin()
    } else {
      this.setData({ userInfo: app.globalData.userInfo })
      this.loadCalendars()
    }
  },

  onShow() {
    if (app.globalData.openid) this.loadCalendars()
  },

//   doLogin() {
//     wx.login({
//       success: (res) => {
//         wx.getUserProfile({
//           desc: '用于完善用户信息',
//           success: (profileRes) => {
//             app.request({
//               url: '/auth/login',
//               method: 'POST',
//               data: {
//                 code: res.code,
//                 nick_name: profileRes.userInfo.nickName,
//                 avatar_url: profileRes.userInfo.avatarUrl,
//               }
//             }).then(data => {
//               app.globalData.openid = data.openid
//               app.globalData.userInfo = data.user
//               wx.setStorageSync('openid', data.openid)
//               wx.setStorageSync('userInfo', data.user)
//               this.setData({ userInfo: data.user })
//               this.loadCalendars()
//             })
//           },
//           fail: () => {
//             wx.showToast({ title: '需要授权才能使用', icon: 'none' })
//           }
//         })
//       }
//     })
//   },

doLogin() {
    // 开发模式：直接用固定 openid 登录，无需真实微信授权
    const mockCode = 'student_001'  // 改成不同字符串可模拟不同用户
    app.request({
      url: '/auth/login',
      method: 'POST',
      data: {
        code: mockCode,
        nick_name: '测试用户',
        avatar_url: '',
      }
    }).then(data => {
      app.globalData.openid = data.openid
      app.globalData.userInfo = data.user
      wx.setStorageSync('openid', data.openid)
      wx.setStorageSync('userInfo', data.user)
      this.setData({ userInfo: data.user })
      this.loadCalendars()
    })
  },
  loadCalendars() {
    this.setData({ loading: true })
    app.request({ url: '/calendars' }).then(data => {
      const userId = app.globalData.userInfo && app.globalData.userInfo.id
      const list = data.map(c => ({
        ...c,
        isCreator: c.creator_id === userId
      }))
      this.setData({ calendars: list, loading: false })
    }).catch(() => this.setData({ loading: false }))
  },

  openCalendar(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/calendar/calendar?id=${id}` })
  },

  showCreate() {
    this.setData({ showCreateModal: true, newName: '', newDesc: '' })
  },
  closeCreate() {
    this.setData({ showCreateModal: false })
  },
  onNameInput(e) { this.setData({ newName: e.detail.value }) },
  onDescInput(e) { this.setData({ newDesc: e.detail.value }) },

  createCalendar() {
    const { newName, newDesc } = this.data
    if (!newName.trim()) {
      wx.showToast({ title: '请输入日历名称', icon: 'none' })
      return
    }
    app.request({
      url: '/calendars',
      method: 'POST',
      data: { name: newName.trim(), description: newDesc.trim() }
    }).then(cal => {
      this.setData({ showCreateModal: false })
      wx.navigateTo({ url: `/pages/calendar/calendar?id=${cal.id}` })
      this.loadCalendars()
    })
  },
})
