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
  doLogin() {
    // 直接发起请求，网关会自动鉴权并把 X-WX-OPENID 传给后端
    app.request({
      url: '/auth/login',
      method: 'POST',
      data: {
        // code 已经不需要传了
        nick_name: '微信用户',
        avatar_url: '',
      }
    }).then(data => {
      app.globalData.openid = data.openid
      app.globalData.userInfo = data.user
      wx.setStorageSync('openid', data.openid)
      wx.setStorageSync('userInfo', data.user)
      this.setData({ userInfo: data.user })
      this.loadCalendars()
    }).catch((e) => {
      console.log('login failed:', e)
      wx.showToast({ title: '登录失败', icon: 'none' })
    })
  },
//   doLogin() {
//     wx.login({
//       success: (res) => {
//         if (!res.code) {
//           wx.showToast({ title: '登录失败：无code', icon: 'none' })
//           return
//         }
  
//         app.request({
//           url: '/auth/login',
//           method: 'POST',
//           data: {
//             code: res.code,
//             nick_name: '',
//             avatar_url: '',
//           }
//         }).then(data => {
//           app.globalData.openid = data.openid
//           app.globalData.userInfo = data.user
//           wx.setStorageSync('openid', data.openid)
//           wx.setStorageSync('userInfo', data.user)
//           this.setData({ userInfo: data.user })
//           this.loadCalendars()
//         }).catch((e) => {
//           console.log('login failed:', e)
//           wx.showToast({ title: '登录失败', icon: 'none' })
//         })
//       },
//       fail: (err) => {
//         console.log('wx.login fail:', err)
//         wx.showToast({ title: '微信登录失败', icon: 'none' })
//       }
//     })
//   },

// doLogin() {
//     // 开发模式：直接用固定 openid 登录，无需真实微信授权
//     const mockCode = 'user_001'  // 改成不同字符串可模拟不同用户
//     app.request({
//       url: '/auth/login',
//       method: 'POST',
//       data: {
//         code: mockCode,
//         nick_name: '测试用户',
//         avatar_url: '',
//       }
//     }).then(data => {
//       app.globalData.openid = data.openid
//       app.globalData.userInfo = data.user
//       wx.setStorageSync('openid', data.openid)
//       wx.setStorageSync('userInfo', data.user)
//       this.setData({ userInfo: data.user })
//       this.loadCalendars()
//     })
//   },
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
  // 新增：生成绑定码（给 Android App 绑定用）
  generateBindCode() {
    app.request({
      url: '/app/bind-code',
      method: 'POST',
      data: {} // 保持对象，别传空字符串
    }).then(res => {
      const code = res && res.bind_code
      const expiresAt = res && (res.expires_at || res.expiresAt)
      if (!code) {
        wx.showToast({ title: '未获取到 bind_code', icon: 'none' })
        return
      }

      // 复制到剪贴板，方便粘贴到 Android App
      wx.setClipboardData({
        data: code,
        success: () => {
          wx.showModal({
            title: '绑定码已生成（已复制）',
            content: `bind_code: ${code}\nexpires_at: ${expiresAt || ''}`,
            showCancel: false
          })
          console.log(`bind_code: ${code}\nexpires_at: ${expiresAt || ''}`)
        },
        fail: () => {
          wx.showModal({
            title: '绑定码已生成',
            content: `bind_code: ${code}\nexpires_at: ${expiresAt || ''}\n（复制失败，请手动复制）`,
            showCancel: false
          })
        }
      })
    }).catch(e => {
      console.log('bind-code failed:', e)
      wx.showToast({ title: '生成绑定码失败', icon: 'none' })
    })
  },
})