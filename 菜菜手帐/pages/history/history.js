const storage = require('../../utils/storage')

Page({
  data: {
    history: [],
    spaceName: '',
    showClearConfirm: false,
    clearTarget: 'all',
    clearDate: '',
    submitting: false,
    loading: false,
    hasMore: false,
    pageSize: 20
  },

  onLoad() {
    this._guest = storage.isGuest()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.refreshHistory()
  },

  refreshHistory() {
    const activeId = getApp().globalData.activeSpaceId
    if (!activeId) {
      this.setData({ history: [], spaceName: '', loading: false })
      return
    }
    const spaceInfo = getApp().globalData.activeSpaceInfo
    this.setData({ spaceName: spaceInfo ? spaceInfo.name : '', loading: true, history: [] })

    // 游客模式：从本地加载（数据量小，一次全加载）
    if (this._guest) {
      const history = (storage.guestGetHistory(activeId) || [])
        .map(entry => ({
          ...entry,
          spaceName: entry.spaceName || '',
          formatted: this.formatDate(entry.date),
          expanded: false
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
      this.setData({ history, loading: false, hasMore: false })
      return
    }

    // 真实用户：分页加载第一页
    this._skip = 0
    const db = wx.cloud.database()
    db.collection('menus')
      .where({ spaceId: activeId })
      .orderBy('date', 'desc')
      .skip(this._skip)
      .limit(this.data.pageSize + 1)  // 多取一条判断是否有更多
      .get()
      .then(res => {
        const hasMore = res.data.length > this.data.pageSize
        const items = res.data.slice(0, this.data.pageSize)
        const history = items
          .filter(entry => entry.items && entry.items.length > 0)
          .map(entry => ({
            ...entry,
            spaceName: entry.spaceName || '',
            formatted: this.formatDate(entry.date),
            expanded: false
          }))
        this._skip += items.length
        this.setData({ history, loading: false, hasMore })
      })
      .catch(err => {
        console.error('[history] 加载失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      })
  },

  // 加载更多（仅真实用户分页）
  loadMoreHistory() {
    if (this._guest || !this.data.hasMore || this.data.loading) return
    const activeId = getApp().globalData.activeSpaceId
    if (!activeId) return

    this.setData({ loading: true })
    const db = wx.cloud.database()
    db.collection('menus')
      .where({ spaceId: activeId })
      .orderBy('date', 'desc')
      .skip(this._skip)
      .limit(this.data.pageSize + 1)
      .get()
      .then(res => {
        const hasMore = res.data.length > this.data.pageSize
        const items = res.data.slice(0, this.data.pageSize)
        const newHistory = items
          .filter(entry => entry.items && entry.items.length > 0)
          .map(entry => ({
            ...entry,
            spaceName: entry.spaceName || '',
            formatted: this.formatDate(entry.date),
            expanded: false
          }))
        this._skip += items.length
        this.setData({
          history: [...this.data.history, ...newHistory],
          loading: false,
          hasMore
        })
      })
      .catch(err => {
        console.error('[history] 加载更多失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      })
  },

  formatDate(dateKey) {
    const [y, m, d] = dateKey.split('-')
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const date = new Date(+y, +m - 1, +d)
    const weekDay = weekDays[date.getDay()]
    return `${y}年${m}月${d}日 星期${weekDay}`
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
    if (this.data.submitting) return
    this.setData({ submitting: true })
    const activeId = getApp().globalData.activeSpaceId

    // 游客模式：本地清除
    if (this._guest) {
      storage.guestClearHistory(activeId, this.data.clearTarget, this.data.clearDate)
      this.finishClear(this.data.clearTarget === 'all' ? '已清空' : '已删除')
      return
    }

    const db = wx.cloud.database()

    const doClear = () => {
      if (this.data.clearTarget === 'all') {
        const today = getApp().getTodayKey()
        return db.collection('menus')
          .where({ spaceId: activeId, date: db.command.neq(today) })
          .get()
          .then(res => {
            return Promise.all(res.data.map(d => db.collection('menus').doc(d._id).remove()))
          })
      }
      return db.collection('menus')
        .where({ spaceId: activeId, date: this.data.clearDate })
        .get()
        .then(res => {
          if (res.data.length > 0) {
            return Promise.all(res.data.map(d => db.collection('menus').doc(d._id).remove()))
          }
        })
    }

    doClear()
      .then(() => {
        this.finishClear(this.data.clearTarget === 'all' ? '已清空' : '已删除')
      })
      .catch(err => {
        console.error('[history] clear fail:', err)
        this.setData({ submitting: false })
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
  },

  finishClear(msg) {
    this.setData({ showClearConfirm: false, submitting: false })
    this.refreshHistory()
    wx.showToast({ title: msg, icon: 'success', duration: 1000 })
  },

  clearAll() { this.setData({ showClearConfirm: true, clearTarget: 'all' }) },
  noop() {}
})
