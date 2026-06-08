App({
  globalData: {
    userInfo: null,
    activeSpaceId: '',
    activeSpaceInfo: null
  },

  onLaunch() {
    // 始终初始化云开发环境，确保游客也能调用云函数完成登录
    wx.cloud.init({ traceUser: true })

    let userInfo = wx.getStorageSync('userInfo')
    // 无用户信息时自动创建游客身份
    if (!userInfo || !userInfo._openid) {
      userInfo = this.createGuestUser()
    }
    this.loadState()
  },

  createGuestUser() {
    // 优先读取持久化个人资料，保持用户修改过的昵称和头像
    const persistentProfile = wx.getStorageSync('persistentProfile') || {}
    const guestUser = {
      _openid: 'guest_user',
      nickName: persistentProfile.nickName || '游客',
      avatarUrl: persistentProfile.avatarUrl || '',
      role: 'guest',
      createdAt: Date.now()
    }
    wx.setStorageSync('userInfo', guestUser)

    // 仅在首次使用时创建演示空间和数据，避免覆盖用户真实数据
    if (!wx.getStorageSync('demoDataCreated')) {
      const demoSpace = {
        _id: 'guest_space_demo',
        name: '体验空间',
        type: 'family',
        inviteCode: 'REVIEW',
        memberCount: 1,
        role: 'owner',
        createdAt: Date.now(),
        members: [{ nickName: '游客', role: 'owner' }]
      }
      const existingSpaces = wx.getStorageSync('guest_spaces') || []
      if (existingSpaces.length === 0) {
        wx.setStorageSync('guest_spaces', [demoSpace])
        wx.setStorageSync('activeSpaceId', demoSpace._id)
        wx.setStorageSync('spaceInfo_' + demoSpace._id, demoSpace)
      }
      const existingMenus = wx.getStorageSync('guest_menus') || {}
      if (Object.keys(existingMenus).length === 0) {
        const todayKey = this.getTodayKey()
        const demoMenus = {}
        demoMenus[demoSpace._id + '_' + todayKey] = {
          spaceId: demoSpace._id,
          spaceName: demoSpace.name,
          date: todayKey,
          items: [
            { id: 'demo_1', name: '红烧排骨', note: '多放辣椒，少放盐', expanded: false, addedBy: '游客', addedAt: Date.now() },
            { id: 'demo_2', name: '清炒时蔬', note: '', expanded: false, addedBy: '游客', addedAt: Date.now() }
          ],
          updatedAt: Date.now()
        }
        wx.setStorageSync('guest_menus', demoMenus)
      }
      wx.setStorageSync('demoDataCreated', true)
    }

    // 确保游客有活跃空间
    const spaces = wx.getStorageSync('guest_spaces') || []
    const activeId = wx.getStorageSync('activeSpaceId')
    if (!activeId && spaces.length > 0) {
      wx.setStorageSync('activeSpaceId', spaces[0]._id)
      wx.setStorageSync('spaceInfo_' + spaces[0]._id, spaces[0])
    }

    return guestUser
  },

  loadState() {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo && userInfo._openid) {
      this.globalData.userInfo = userInfo
    }
    const activeSpaceId = wx.getStorageSync('activeSpaceId') || ''
    this.globalData.activeSpaceId = activeSpaceId
    if (activeSpaceId) {
      const spaceInfo = wx.getStorageSync('spaceInfo_' + activeSpaceId)
      if (spaceInfo) {
        this.globalData.activeSpaceInfo = spaceInfo
      }
    }
  },

  isGuest() {
    const userInfo = this.globalData.userInfo || wx.getStorageSync('userInfo')
    return !!(userInfo && userInfo._openid === 'guest_user')
  },

  setActiveSpace(spaceId, spaceInfo) {
    this.globalData.activeSpaceId = spaceId
    this.globalData.activeSpaceInfo = spaceInfo
    wx.setStorageSync('activeSpaceId', spaceId)
    if (spaceInfo) {
      wx.setStorageSync('spaceInfo_' + spaceId, spaceInfo)
    }
  },

  getTodayKey() {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }
})
