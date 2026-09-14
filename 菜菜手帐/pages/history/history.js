const storage = require('../../utils/storage')

Page({
  data: {
    history: [],
    spaceName: '',
    spaceIcon: '🏠',
    showClearConfirm: false,
    clearTarget: 'all',
    clearDate: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.refresh()
  },

  refresh() {
    getApp().loadState()
    const spaceId = storage.getActiveSpaceId()
    const space = storage.getSpaces().find(s => s.id === spaceId) || null
    this.setData({
      spaceName: space ? space.name : '',
      spaceIcon: space ? space.icon : '🏠'
    })
    if (!spaceId) {
      this.setData({ history: [] })
      return
    }
    const history = storage.getHistory(spaceId).map(entry => ({
      ...entry,
      formatted: this.formatDate(entry.date),
      expanded: false
    }))
    this.setData({ history })
  },

  formatDate(dateKey) {
    const [y, m, d] = dateKey.split('-')
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const date = new Date(+y, +m - 1, +d)
    const weekDay = weekDays[date.getDay()]
    const mm = ('0' + m).slice(-2)
    const dd = ('0' + d).slice(-2)
    return `${y}年${mm}月${dd}日 星期${weekDay}`
  },

  toggleExpand(e) {
    const { date } = e.currentTarget.dataset
    const history = this.data.history.map(item => {
      if (item.date === date) return { ...item, expanded: !item.expanded }
      return item
    })
    this.setData({ history })
  },

  deleteDay(e) {
    const { date } = e.currentTarget.dataset
    this.setData({ showClearConfirm: true, clearTarget: 'day', clearDate: date })
  },

  hideClearConfirm() { this.setData({ showClearConfirm: false }) },

  confirmClear() {
    const spaceId = storage.getActiveSpaceId()
    if (spaceId) {
      storage.clearHistory(spaceId, this.data.clearTarget, this.data.clearDate)
    }
    this.setData({ showClearConfirm: false })
    this.refresh()
    wx.showToast({
      title: this.data.clearTarget === 'all' ? '已清空' : '已删除',
      icon: 'success',
      duration: 900
    })
  },

  clearAll() {
    this.setData({ showClearConfirm: true, clearTarget: 'all' })
  },

  goToSpace() {
    wx.switchTab({ url: '/pages/space/space' })
  },

  noop() {}
})
