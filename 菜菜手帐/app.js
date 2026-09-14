const storage = require('./utils/storage')

App({
  globalData: {
    profile: null,
    activeSpaceId: ''
  },

  onLaunch() {
    // 一次性迁移旧版数据
    storage.migrateLegacyData()

    // 确保个人资料存在
    let profile = storage.getProfile()
    if (!profile || !profile.nickName) {
      const nicknames = ['小吃货', '小厨神', '美食家', '干饭人', '小当家', '甜品控', '吃货达人', '料理王', '家常菜高手']
      profile = storage.saveProfile({
        nickName: nicknames[Math.floor(Math.random() * nicknames.length)],
        avatarUrl: ''
      })
    }

    // 首次使用：建一个默认分组 + 示例菜单，让新用户进来就知道怎么玩
    if (!wx.getStorageSync('demoV2')) {
      let spaces = storage.getSpaces()
      if (spaces.length === 0) {
        const space = storage.createSpace('我们的菜单', '🏠')
        spaces = storage.getSpaces()
        storage.saveMenu(space.id, space.name, [
          { id: 'demo_1', name: '红烧排骨', note: '多放辣椒，少放盐', addedAt: Date.now() },
          { id: 'demo_2', name: '清炒时蔬', note: '蒜蓉，大火快炒', addedAt: Date.now() },
          { id: 'demo_3', name: '番茄炒蛋', note: '要甜口的', addedAt: Date.now() }
        ])
      }
      wx.setStorageSync('demoV2', true)
    }

    this.loadState()
  },

  loadState() {
    this.globalData.profile = storage.getProfile()
    this.globalData.activeSpaceId = storage.getActiveSpaceId()
  },

  setActiveSpace(id) {
    this.globalData.activeSpaceId = id || ''
    storage.setActiveSpace(id)
  },

  getTodayKey() {
    return storage.getTodayKey()
  }
})
