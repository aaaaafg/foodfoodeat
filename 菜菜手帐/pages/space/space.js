const storage = require('../../utils/storage')
const shareCard = require('../../utils/shareCard')

const SPACE_ICONS = [
  { key: 'home', icon: '🏠', label: '家庭' },
  { key: 'couple', icon: '💑', label: '情侣' },
  { key: 'friends', icon: '🍚', label: '饭搭子' },
  { key: 'fitness', icon: '🥗', label: '减脂' },
  { key: 'star', icon: '✨', label: '自定义' }
]

Page({
  data: {
    // 日期
    todayDate: '',
    todayWeekday: '',

    // 菜单
    menu: { date: '', items: [] },

    // 分组
    spaceList: [],
    activeSpaceId: '',
    spaceName: '',
    spaceIcon: '🏠',
    showSpaceManager: false,
    showCreate: false,
    newSpaceName: '',
    newSpaceIcon: '🏠',
    spaceIcons: SPACE_ICONS,

    // 菜品弹窗（新增/编辑共用）
    showDishModal: false,
    dishName: '',
    dishNote: '',
    editingDishId: '',

    // 清空确认
    showClearConfirm: false,

    // 分享卡片
    showSharePreview: false,
    shareCardPath: '',
    generatingCard: false,

    // 新手引导
    showGuide: false
  },

  onLoad() {
    this._expandedIds = new Set()
    this._menuLoaded = false
    this._lastMenuSpaceId = null
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    getApp().loadState()
    // 跨天后（小程序一直开着）：强制重载今日菜单
    const todayKey = storage.getTodayKey()
    if (this.data.menu.date && this.data.menu.date !== todayKey) {
      this._menuLoaded = false
      this._expandedIds = new Set()
    }
    this.loadSpaces()
    this.maybeShowGuide()
  },

  onPullDownRefresh() {
    this.loadSpaces()
    wx.stopPullDownRefresh()
  },

  // ========== 日期 ==========

  updateDateDisplay(dateKey) {
    const [y, m, d] = dateKey.split('-')
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const date = new Date(+y, +m - 1, +d)
    this.setData({
      todayDate: `${y}年${+m}月${+d}日`,
      todayWeekday: `星期${weekDays[date.getDay()]}`
    })
  },

  // ========== 分组 ==========

  loadSpaces() {
    const spaces = storage.getSpaces()
    const storedActive = storage.getActiveSpaceId()
    const validActiveId = storedActive && spaces.some(s => s.id === storedActive)
      ? storedActive
      : (spaces[0] ? spaces[0].id : '')
    if (validActiveId !== storedActive) storage.setActiveSpace(validActiveId)
    getApp().globalData.activeSpaceId = validActiveId
    const active = spaces.find(s => s.id === validActiveId) || null
    this.setData({
      spaceList: spaces,
      activeSpaceId: validActiveId,
      spaceName: active ? active.name : '',
      spaceIcon: active ? active.icon : '🏠'
    })
    const spaceChanged = validActiveId !== this._lastMenuSpaceId
    if (spaceChanged || !this._menuLoaded) {
      this.loadMenu()
    }
  },

  loadMenu() {
    const spaceId = getApp().globalData.activeSpaceId
    const todayKey = storage.getTodayKey()
    this._lastMenuSpaceId = spaceId
    this._menuLoaded = true
    this.updateDateDisplay(todayKey)
    if (!spaceId) {
      this.applyMenu(todayKey, [])
      return
    }
    const menu = storage.getMenu(spaceId)
    this.applyMenu(todayKey, menu ? menu.items : [])
  },

  // 渲染用视图：items 附带本地展开状态；保存时会剥离 expanded
  applyMenu(date, items) {
    const view = (items || []).map(it => ({ ...it, expanded: this._expandedIds.has(it.id) }))
    this.setData({ menu: { date, items: view } })
  },

  rawItems() {
    return this.data.menu.items.map(({ expanded, ...rest }) => rest)
  },

  saveMenuItems(items) {
    const spaceId = getApp().globalData.activeSpaceId
    if (!spaceId) return
    const space = storage.getSpaces().find(s => s.id === spaceId)
    storage.saveMenu(spaceId, space ? space.name : '', items)
  },

  toggleSpaceManager() {
    this.setData({ showSpaceManager: !this.data.showSpaceManager })
  },

  hideSpaceManager() { this.setData({ showSpaceManager: false }) },

  switchSpace(e) {
    const { id } = e.currentTarget.dataset
    if (id === this.data.activeSpaceId) {
      this.setData({ showSpaceManager: false })
      return
    }
    storage.setActiveSpace(id)
    getApp().globalData.activeSpaceId = id
    this._menuLoaded = false
    this._expandedIds = new Set()
    this.setData({ showSpaceManager: false })
    this.loadSpaces()
    wx.showToast({ title: '已切换分组', icon: 'success', duration: 800 })
  },

  startCreate() {
    this.setData({ showCreate: true, newSpaceName: '', newSpaceIcon: '🏠', showSpaceManager: false })
  },

  cancelCreate() { this.setData({ showCreate: false }) },

  selectSpaceIcon(e) {
    this.setData({ newSpaceIcon: e.currentTarget.dataset.icon })
  },

  onSpaceNameInput(e) { this.setData({ newSpaceName: e.detail.value }) },

  confirmCreate() {
    const name = this.data.newSpaceName.trim()
    if (!name) {
      wx.showToast({ title: '请输入分组名称', icon: 'none' })
      return
    }
    if (storage.getSpaces().some(s => s.name === name)) {
      wx.showToast({ title: '已有同名分组', icon: 'none' })
      return
    }
    const space = storage.createSpace(name, this.data.newSpaceIcon)
    getApp().globalData.activeSpaceId = space.id
    this._menuLoaded = false
    this._expandedIds = new Set()
    this.setData({ showCreate: false })
    this.loadSpaces()
    wx.showToast({ title: '创建成功', icon: 'success' })
  },

  deleteSpace(e) {
    const { id } = e.currentTarget.dataset
    const space = this.data.spaceList.find(s => s.id === id)
    if (!space) return
    wx.showModal({
      title: '删除分组',
      content: `删除「${space.name}」后，该分组的所有菜单和记录都会一起删除，无法恢复。`,
      confirmText: '删除',
      confirmColor: '#ff3b30',
      success: (res) => {
        if (!res.confirm) return
        storage.deleteSpace(id)
        getApp().globalData.activeSpaceId = storage.getActiveSpaceId()
        this._menuLoaded = false
        this._expandedIds = new Set()
        this.loadSpaces()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  // ========== 菜品操作 ==========

  // 展开/收起备注：纯视图状态，不写存储
  toggleNote(e) {
    const { id } = e.currentTarget.dataset
    if (this._expandedIds.has(id)) this._expandedIds.delete(id)
    else this._expandedIds.add(id)
    this.applyMenu(this.data.menu.date, this.rawItems())
  },

  showAddModal() {
    this.setData({ showDishModal: true, dishName: '', dishNote: '', editingDishId: '' })
  },

  showEditDish(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.menu.items.find(it => it.id === id)
    if (!item) return
    this.setData({ showDishModal: true, dishName: item.name, dishNote: item.note || '', editingDishId: id })
  },

  hideDishModal() { this.setData({ showDishModal: false }) },
  onDishNameInput(e) { this.setData({ dishName: e.detail.value }) },
  onDishNoteInput(e) { this.setData({ dishNote: e.detail.value }) },

  submitDish() {
    const name = this.data.dishName.trim()
    if (!name) {
      wx.showToast({ title: '请输入菜品名称', icon: 'none' })
      return
    }
    const note = this.data.dishNote.trim()
    const editingId = this.data.editingDishId

    if (editingId) {
      // 编辑：改成别的菜名时检查重名
      const dup = this.rawItems().find(it =>
        it.id !== editingId && it.name.trim().toLowerCase() === name.toLowerCase()
      )
      if (dup) {
        wx.showToast({ title: '已经有同名的菜了', icon: 'none' })
        return
      }
      const items = this.rawItems().map(it =>
        it.id === editingId ? { ...it, name, note } : it
      )
      this.setData({ showDishModal: false })
      this.applyMenu(this.data.menu.date, items)
      this.saveMenuItems(items)
      wx.showToast({ title: '已更新', icon: 'success', duration: 900 })
      return
    }

    // 新增：同名提醒，确认后再加
    const dup = this.rawItems().find(it => it.name.trim().toLowerCase() === name.toLowerCase())
    const doAdd = () => {
      const item = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        name,
        note,
        addedAt: Date.now()
      }
      const items = [...this.rawItems(), item]
      this.setData({ showDishModal: false })
      this.applyMenu(this.data.menu.date, items)
      this.saveMenuItems(items)
      wx.showToast({ title: '添加成功', icon: 'success', duration: 900 })
    }
    if (dup) {
      wx.showModal({
        title: '重复的菜',
        content: `今天已经点过「${name}」了，还要再加一份吗？`,
        confirmColor: '#007aff',
        success: (res) => { if (res.confirm) doAdd() }
      })
      return
    }
    doAdd()
  },

  deleteDish(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.menu.items.find(it => it.id === id)
    if (!item) return
    wx.showModal({
      title: '删除菜品',
      content: `确定删除「${item.name}」吗？`,
      confirmColor: '#ff3b30',
      success: (res) => {
        if (!res.confirm) return
        const items = this.rawItems().filter(it => it.id !== id)
        this._expandedIds.delete(id)
        this.applyMenu(this.data.menu.date, items)
        this.saveMenuItems(items)
        wx.showToast({ title: '已删除', icon: 'success', duration: 900 })
      }
    })
  },

  clearAll() {
    if (this.data.menu.items.length === 0) {
      wx.showToast({ title: '菜单已经是空的', icon: 'none' })
      return
    }
    this.setData({ showClearConfirm: true })
  },

  hideClearConfirm() { this.setData({ showClearConfirm: false }) },

  confirmClear() {
    this.setData({ showClearConfirm: false })
    this._expandedIds = new Set()
    this.applyMenu(this.data.menu.date, [])
    this.saveMenuItems([])
    wx.showToast({ title: '已清空', icon: 'success', duration: 900 })
  },

  // ========== 分享卡片 ==========

  cardData() {
    const profile = storage.getProfile() || {}
    return {
      nickName: profile.nickName || '我',
      avatarUrl: profile.avatarUrl || '',
      spaceName: this.data.spaceName || '我的菜单',
      spaceIcon: this.data.spaceIcon || '🏠',
      dateText: this.data.todayDate,
      weekdayText: this.data.todayWeekday,
      items: this.rawItems().map(it => ({ name: it.name, note: it.note || '' }))
    }
  },

  shareTitle() {
    const me = (storage.getProfile() || {}).nickName || '我'
    const names = this.rawItems().map(i => i.name).join('、')
    return names ? `${me}的今日菜单：${names}` : `${me}的今日菜单`
  },

  // 生成卡片并弹出预览（保存到相册 / 转发）
  openSharePreview() {
    if (this.data.generatingCard) return
    this.setData({ generatingCard: true })
    wx.showLoading({ title: '生成卡片中…', mask: true })
    shareCard.buildShareCard(this, this.cardData())
      .then(path => {
        wx.hideLoading()
        this.setData({ generatingCard: false, shareCardPath: path, showSharePreview: true })
      })
      .catch(err => {
        wx.hideLoading()
        console.error('[space] 分享卡片生成失败:', err)
        this.setData({ generatingCard: false })
        wx.showToast({ title: '生成失败，请重试', icon: 'none' })
      })
  },

  hideSharePreview() { this.setData({ showSharePreview: false }) },

  saveShareCard() {
    wx.saveImageToPhotosAlbum({
      filePath: this.data.shareCardPath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('auth') > -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许「保存到相册」，才能保存菜单卡片',
            confirmText: '去设置',
            confirmColor: '#007aff',
            success: (res) => { if (res.confirm) wx.openSetting() }
          })
        }
      }
    })
  },

  // 右上角分享：带上生成的卡片图（返回 Promise，微信会显示“正在准备”）
  onShareAppMessage() {
    const title = this.shareTitle()
    return shareCard.buildShareCard(this, this.cardData())
      .then(path => ({
        title,
        path: '/pages/space/space',
        imageUrl: path
      }))
      .catch(() => ({ title, path: '/pages/space/space' }))
  },

  // ========== 新手引导 ==========

  maybeShowGuide() {
    // 「使用说明」入口的标记优先：每次点击都要能打开引导
    if (wx.getStorageSync('showGuideFlag')) {
      wx.removeStorageSync('showGuideFlag')
      this.setData({ showGuide: true })
      return
    }
    if (this._guideChecked) return
    this._guideChecked = true
    if (!wx.getStorageSync('guideShown')) {
      wx.setStorageSync('guideShown', true)
      this.setData({ showGuide: true })
    }
  },

  closeGuide() {
    wx.setStorageSync('guideShown', true)
    this.setData({ showGuide: false })
  },

  noop() {}
})
