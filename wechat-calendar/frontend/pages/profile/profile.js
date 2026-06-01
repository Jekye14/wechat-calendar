const app = getApp()
const i18n = require('../../utils/i18n')

Page({
  data: {
    t: {},
    avatarUrl: '',
    nickName: '',
    saving: false,
  },

  onLoad() {
    this.setData({ t: i18n.getLocale() })
    wx.setNavigationBarTitle({ title: this.data.t.profile.title })
    this.loadUserInfo()
  },

  onShow() {
    this.loadUserInfo()
  },

  loadUserInfo() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {}
    this.setData({
      avatarUrl: userInfo.avatar_url || '',
      nickName: userInfo.nick_name || '',
    })
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    this.setData({ avatarUrl })
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  onUseWechatInfo() {
    // 微信原生组件 <button open-type="chooseAvatar"> 会弹出微信头像选择器
    // <input type="nickname"> 会自动填充微信昵称
    // 这里作为备选提示
    wx.showToast({ title: this.data.t.profile.tapToChangeAvatar, icon: 'none', duration: 1500 })
  },

  async onSave() {
    const { nickName, avatarUrl } = this.data
    if (!nickName.trim()) {
      wx.showToast({ title: this.data.t.profile.nicknamePlaceholder, icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      const res = await app.request({
        url: '/auth/profile',
        method: 'PUT',
        data: { nick_name: nickName.trim(), avatar_url: avatarUrl },
      })
      if (res.ok && res.user) {
        app.globalData.userInfo = res.user
        wx.setStorageSync('userInfo', res.user)
        wx.showToast({ title: this.data.t.profile.saveProfileSuccess, icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1200)
      }
    } catch (_) {
      // error handled by app.request
    } finally {
      this.setData({ saving: false })
    }
  },
})
