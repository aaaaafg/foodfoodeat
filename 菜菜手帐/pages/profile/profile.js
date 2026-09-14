const storage = require('../../utils/storage')

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    nickInitial: '👤',
    editingNickname: false,
    editNickValue: '',
    spaceCount: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.load()
  },

  load() {
    const profile = storage.getProfile() || {}
    const nick = profile.nickName || '我'
    this.setData({
      avatarUrl: profile.avatarUrl || '',
      nickName: nick,
      nickInitial: nick.charAt(0) || '👤',
      spaceCount: storage.getSpaces().length
    })
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    // 用户取消选择
    if (!avatarUrl) return
    this.persistAvatar(avatarUrl)
  },

  // 头像持久化：先压缩再转 base64，避免原图超出本地存储 1MB 限制导致保存失败
  persistAvatar(tempPath) {
    wx.compressImage({
      src: tempPath,
      quality: 60,
      success: (res) => this.readAvatarAsBase64(res.tempFilePath),
      // 压缩失败（个别机型/格式）：直接用原图兜底
      fail: () => this.readAvatarAsBase64(tempPath)
    })
  },

  readAvatarAsBase64(path) {
    const fs = wx.getFileSystemManager()
    try {
      const data = fs.readFileSync(path, 'base64')
      // 压缩后的图片可能没有扩展名，统一按 jpg 处理（compressImage 输出 jpg）
      const ext = (path.match(/\.(\w+)(?:\?|$)/) || [])[1] || 'jpg'
      const base64Url = `data:image/${ext};base64,${data}`
      this.setData({ avatarUrl: base64Url })
      storage.saveProfile({ avatarUrl: base64Url })
      getApp().globalData.profile = storage.getProfile()
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (err) {
      console.error('[profile] 头像持久化失败:', err)
      // 降级：仍保存临时路径（至少本次会话可用）
      this.setData({ avatarUrl: path })
      storage.saveProfile({ avatarUrl: path })
      getApp().globalData.profile = storage.getProfile()
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
    this.setData({
      nickName: name,
      nickInitial: name.charAt(0) || '👤',
      editingNickname: false
    })
    storage.saveProfile({ nickName: name })
    getApp().globalData.profile = storage.getProfile()
    wx.showToast({ title: '昵称已更新', icon: 'success' })
  },

  goToSpace() {
    wx.switchTab({ url: '/pages/space/space' })
  },

  // 使用说明：跳到菜单页并触发新手引导
  showGuide() {
    wx.setStorageSync('showGuideFlag', true)
    wx.switchTab({ url: '/pages/space/space' })
  },

  noop() {}
})
