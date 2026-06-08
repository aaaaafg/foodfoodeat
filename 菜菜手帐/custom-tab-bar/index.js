Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/space/space', text: '菜单空间', icon: '📋' },
      { pagePath: '/pages/history/history', text: '历史记录', icon: '🕐' },
      { pagePath: '/pages/profile/profile', text: '用户中心', icon: '👤' }
    ]
  },

  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      const idx = Number(index)
      if (this.data.selected === idx) return
      wx.switchTab({ url: path })
    }
  }
})
