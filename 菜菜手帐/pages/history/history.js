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
    pageSize: 20,
    cloudOffline: false
  },

  onLoad() {
    this._guest = storage.isGuest()
    this._cloudOffline = false
    this._skip = 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    // 每次显示重新读取游客/离线状态（退出登录、云端恢复后状态都会变化）
    this._guest = storage.isGuest()
    this._cloudOffline = !this._guest && !!getApp().globalData.cloudBroken
    this.setData({ cloudOffline: this._cloudOffline })
    this.refreshHistory()
  },

  // 本地存储命名空间
  localNs() {
    return storage.localNs()
  },

  // 云调用失败：标记云不可用并切换到本地历史
  enterOfflineMode() {
    console.warn('[history] 进入本地模式')
    getApp().markCloudBroken()
    if (!this._cloudOffline) {
      this._cloudOffline = true
      this.setData({ cloudOffline: true })
      wx.showToast({ title: '云服务不可用，已切换本地模式', icon: 'none', duration: 2500 })
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

    // 游客/离线模式：从本地加载（数据量小，一次全加载）
    if (this._guest || this._cloudOffline) {
      const history = (storage.guestGetHistory(activeId, this.localNs()) || [])
        .map(entry => ({
          ...entry,
          spaceName: entry.spaceName || '',
          formatted: this.formatDate(entry.date),
          peopleSummary: this.peopleSummary(entry),
          expanded: false
        }))
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
            peopleSummary: this.peopleSummary(entry),
            expanded: false
          }))
        this._skip += items.length
        this.setData({ history, loading: false, hasMore })
      })
      .catch(err => {
        console.error('[history] 加载失败:', err)
        this.setData({ loading: false })
        this.enterOfflineMode()
      })
  },

  // 加载更多（仅真实用户分页）
  loadMoreHistory() {
    if (this._guest || this._cloudOffline || !this.data.hasMore || this.data.loading) return
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
            peopleSummary: this.peopleSummary(entry),
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
        this.enterOfflineMode()
      })
  },

  formatDate(dateKey) {
    const [y, m, d] = dateKey.split('-')
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const date = new Date(+y, +m - 1, +d)
    const weekDay = weekDays[date.getDay()]
    return `${y}年${m}月${d}日 星期${weekDay}`
  },

  // 这一天谁点了什么：按人统计，如「小明 3 道 · 小美 2 道」
  peopleSummary(entry) {
    const map = {}
    ;(entry.items || []).forEach(it => {
      const who = it.addedBy || '未标注'
      map[who] = (map[who] || 0) + 1
    })
    return Object.keys(map).map(k => `${k} ${map[k]} 道`).join(' · ')
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

    // 游客/离线模式：本地清除
    if (this._guest || this._cloudOffline) {
      storage.guestClearHistory(activeId, this.data.clearTarget, this.data.clearDate, this.localNs())
      this.finishClear(this.data.clearTarget === 'all' ? '已清空' : '已删除')
      return
    }

    const db = wx.cloud.database()

    // 循环分页删除：客户端 .get() 单次最多返回 20 条，
    // 只删一批会漏掉 20 条之后的记录
    const buildQuery = () => {
      if (this.data.clearTarget === 'all') {
        const today = getApp().getTodayKey()
        return db.collection('menus').where({ spaceId: activeId, date: db.command.neq(today) })
      }
      return db.collection('menus').where({ spaceId: activeId, date: this.data.clearDate })
    }

    const removePage = (res) => {
      if (!res.data.length) return Promise.resolve()
      return Promise.all(res.data.map(d => db.collection('menus').doc(d._id).remove()))
        .then(() => {
          // 重新查询下一页（删除后从头取即可）
          return buildQuery().limit(100).get().then(next => removePage(next))
        })
    }

    const doClear = () => buildQuery().limit(100).get().then(res => removePage(res))

    doClear()
      .then(() => {
        this.finishClear(this.data.clearTarget === 'all' ? '已清空' : '已删除')
      })
      .catch(err => {
        console.error('[history] clear fail:', err)
        this.setData({ submitting: false })
        if (err && err.errMsg && /cloud|network|timeout|env/i.test(err.errMsg)) {
          this.enterOfflineMode()
        } else {
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
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
