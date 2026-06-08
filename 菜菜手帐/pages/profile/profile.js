const storage = require('../../utils/storage')

Page({
  data: {
    userInfo: null,
    avatarUrl: '',
    nickName: '',
    editingNickname: false,
    editNickValue: '',
    showLogoutConfirm: false,
    spaceCount: 0,
    isGuest: false,
    enableNotify: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadProfile()
  },

  loadProfile() {
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo._openid) {
      // 无用户信息（app.js 已保证不会发生，但保留兜底）
      return
    }

    // 游客模式：直接使用本地数据
    if (storage.isGuest()) {
      this.setData({
        userInfo,
        avatarUrl: userInfo.avatarUrl || '',
        nickName: userInfo.nickName || '游客',
        spaceCount: (wx.getStorageSync('guest_spaces') || []).length,
        isGuest: true,
        enableNotify: false
      })
      return
    }

    // 真实用户：从云端拉取
    const db = wx.cloud.database()
    db.collection('users').where({ _openid: userInfo._openid }).get()
      .then(res => {
        if (res.data.length > 0) {
          const u = res.data[0]
          // 更新本地缓存
          wx.setStorageSync('userInfo', u)
          getApp().globalData.userInfo = u
          this.setData({
            userInfo: u,
            avatarUrl: u.avatarUrl || '',
            nickName: u.nickName || '未命名'
          })
        } else {
          this.setData({ userInfo, nickName: userInfo.nickName || '未命名' })
        }
      })
      .catch(() => {
        this.setData({ userInfo, nickName: userInfo.nickName || '未命名' })
      })

    db.collection('space_members').where({ _openid: userInfo._openid }).count()
      .then(res => this.setData({ spaceCount: res.total || 0 }))
      .catch(() => {})

    this.setData({ enableNotify: !!wx.getStorageSync('notifyEnabled') })
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    // 用户取消选择
    if (!avatarUrl) return
    // 游客模式：本地头像，转为 base64 持久化存储
    if (storage.isGuest()) {
      this.persistGuestAvatar(avatarUrl)
      return
    }
    // 真实用户：上传到云存储
    wx.cloud.uploadFile({
      cloudPath: 'avatars/' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.png',
      filePath: avatarUrl
    }).then(res => {
      const fileID = res.fileID
      this.setData({ avatarUrl: fileID })
      this.updateUserField('avatarUrl', fileID)
      // 同步到持久化个人资料
      storage.savePersistentProfile({ avatarUrl: fileID })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    }).catch(() => {
      wx.showToast({ title: '上传失败', icon: 'none' })
    })
  },

  // 游客头像持久化：将临时文件转为 base64 存储，避免重启后丢失
  persistGuestAvatar(tempPath) {
    const fs = wx.getFileSystemManager()
    try {
      // 读取临时文件为 base64
      const data = fs.readFileSync(tempPath, 'base64')
      // 推断图片格式，默认 png
      const ext = (tempPath.match(/\.(\w+)(?:\?|$)/) || [])[1] || 'png'
      const base64Url = `data:image/${ext};base64,${data}`
      this.setData({ avatarUrl: base64Url })
      const userInfo = wx.getStorageSync('userInfo')
      userInfo.avatarUrl = base64Url
      wx.setStorageSync('userInfo', userInfo)
      // 同步到持久化个人资料
      storage.savePersistentProfile({ avatarUrl: base64Url })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err) {
      console.error('[profile] 头像持久化失败:', err)
      // 降级：仍保存临时路径（至少本次会话可用）
      this.setData({ avatarUrl: tempPath })
      const userInfo = wx.getStorageSync('userInfo')
      userInfo.avatarUrl = tempPath
      wx.setStorageSync('userInfo', userInfo)
      storage.savePersistentProfile({ avatarUrl: tempPath })
      wx.showToast({ title: '头像已更新（重启后可能失效）', icon: 'none' })
    }
  },

  startEditNickname() {
    this.setData({ editingNickname: true, editNickValue: this.data.nickName })
  },
  cancelEditNickname() {
    this.setData({ editingNickname: false })
  },
  onNicknameInput(e) {
    this.setData({ editNickValue: e.detail.value })
  },
  confirmEditNickname() {
    const name = this.data.editNickValue.trim()
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    this.setData({ nickName: name, editingNickname: false })
    this.updateUserField('nickName', name)
    const userInfo = wx.getStorageSync('userInfo')
    userInfo.nickName = name
    wx.setStorageSync('userInfo', userInfo)
    getApp().globalData.userInfo = userInfo
    // 同步到持久化个人资料
    storage.savePersistentProfile({ nickName: name })
    wx.showToast({ title: '昵称已更新', icon: 'success' })
  },

  updateUserField(field, value) {
    if (storage.isGuest()) return
    const userInfo = this.data.userInfo
    if (!userInfo || !userInfo._id) return
    const db = wx.cloud.database()
    db.collection('users').doc(userInfo._id).update({
      data: { [field]: value, updatedAt: Date.now() }
    }).catch(() => {})
  },

  // 游客跳转登录页
  goToLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  showLogout() {
    this.setData({ showLogoutConfirm: true })
  },
  hideLogoutConfirm() {
    this.setData({ showLogoutConfirm: false })
  },
  confirmLogout() {
    // 清理登录态数据（保留本地空间和菜单数据）
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('activeSpaceId')
    getApp().globalData.userInfo = null
    getApp().globalData.activeSpaceId = ''
    getApp().globalData.activeSpaceInfo = null
    this.setData({ showLogoutConfirm: false })
    // 退出后重建游客身份（保留持久化资料和本地数据）
    const app = getApp()
    app.createGuestUser()
    app.loadState()
    wx.showToast({ title: '已退出，回到游客模式', icon: 'success', duration: 1200 })
    setTimeout(() => {
      wx.switchTab({ url: '/pages/space/space' })
    }, 1300)
  },

  requestNotification() {
    if (this.data.isGuest) {
      wx.showToast({ title: '游客模式不支持通知', icon: 'none' })
      return
    }
    // 替换为微信公众平台申请的订阅消息模板ID
    const TMPL_ID = 'YOUR_TEMPLATE_ID_HERE'
    wx.requestSubscribeMessage({
      tmplIds: [TMPL_ID],
      success: (res) => {
        if (res[TMPL_ID] === 'accept') {
          this.setData({ enableNotify: true })
          wx.setStorageSync('notifyEnabled', true)
          wx.showToast({ title: '订阅成功', icon: 'success' })
        } else if (res[TMPL_ID] === 'reject') {
          this.setData({ enableNotify: false })
          wx.setStorageSync('notifyEnabled', false)
          wx.showToast({ title: '已取消订阅', icon: 'none' })
        }
      },
      fail: () => {
        wx.showToast({ title: '订阅失败，请稍后重试', icon: 'none' })
      }
    })
  },

  goToSpace() {
    wx.switchTab({ url: '/pages/space/space' })
  },

  noop() {}
})
