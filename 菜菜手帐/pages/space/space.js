const storage = require('../../utils/storage')

Page({
  data: {
    // 菜单
    todayDate: '',
    todayWeekday: '',
    menu: { date: '', items: [] },
    showModal: false,
    showClearConfirm: false,
    newDishName: '',
    newDishNote: '',
    menuDocId: null,
    watcherReady: false,

    // 游客模式
    isGuest: false,
    // 云服务不可用时自动降级为本地模式
    cloudOffline: false,

    // 空间
    spaceList: [],
    activeSpaceId: '',
    spaceName: '',
    showSpaceManager: false,
    showCreate: false,
    showJoin: false,
    showLeaveConfirm: false,
    showInvite: false,
    showMembers: false,
    selectedSpace: null,
    members: [],
    newSpaceName: '',
    spaceType: '',
    joinCode: '',
    submitting: false,
    spaceTypes: [
      { key: 'couple', label: '情侣空间', icon: '💑' },
      { key: 'family', label: '家庭空间', icon: '👨‍👩‍👧‍👦' },
      { key: 'friends', label: '好友饭搭子', icon: '🍚' },
      { key: 'custom', label: '自定义', icon: '✨' }
    ]
  },

  onLoad() {
    this._pageActive = true
    this._menuLoaded = false
    this._lastSpaceId = null
    this._guest = storage.isGuest()
    this._cloudOffline = false
    // 菜单加载统一由 onShow 处理，避免 onLoad + onShow 双重加载
  },

  onShow() {
    this._pageActive = true
    // 每次显示都重新读取游客状态：退出登录后会从真实用户变回游客，
    // 若沿用旧状态会继续走云路径导致持续超时报错
    this._guest = storage.isGuest()
    this._cloudOffline = !this._guest && !!getApp().globalData.cloudBroken
    this.setData({ isGuest: this._guest, cloudOffline: this._cloudOffline })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    const currentSpaceId = getApp().globalData.activeSpaceId
    const spaceChanged = currentSpaceId !== this._lastSpaceId
    const todayKey = getApp().getTodayKey()
    const dateChanged = this.data.menu.date && this.data.menu.date !== todayKey

    // Clear menu when switching to a different space, or when date changed
    if ((spaceChanged || dateChanged) && currentSpaceId) {
      this.stopWatcher()
      this._lastSpaceId = currentSpaceId
      this._menuLoaded = false
      this.setData({ menu: { date: '', items: [] }, menuDocId: null })
    }

    this.loadSpaces()

    // Reload from DB if space changed, date changed, or menu never loaded.
    // On simple tab switch, local state is still valid — skip reload.
    if ((spaceChanged || dateChanged || !this._menuLoaded) && this.checkLoginAndSpace()) {
      this.loadMenu()
    } else if (!spaceChanged && !dateChanged && this._menuLoaded && this.checkLoginAndSpace()) {
      // Tab switch with menu already loaded — restart watcher for real-time sync
      this.startWatcher()
    }
  },

  onPullDownRefresh() {
    if (this._cloudOffline) {
      // 离线模式下拉：尝试重连云端
      this.retryCloud()
    } else {
      this.loadMenu()
    }
    wx.stopPullDownRefresh()
  },

  onHide() {
    this._pageActive = false
    this.stopWatcher()
  },

  onUnload() {
    this._pageActive = false
    this.stopWatcher()
  },

  // ========== 本地模式辅助 ==========

  // 本地存储命名空间：游客为 'guest'，登录用户离线为 'offline_<openid>'
  localNs() {
    return storage.localNs()
  },

  // 云调用失败时进入本地降级模式（幂等）
  enterOfflineMode(reason, skipReload) {
    console.warn('[space] 进入本地模式:', reason || '云调用失败')
    getApp().markCloudBroken()
    this.stopWatcher()
    if (!this._cloudOffline) {
      this._cloudOffline = true
      this.setData({ cloudOffline: true })
      wx.showToast({ title: '云服务不可用，已切换本地模式', icon: 'none', duration: 2500 })
    }
    if (!skipReload) {
      this._menuLoaded = false
      this.loadSpaces()
    }
  },

  // 手动重试恢复云端连接
  retryCloud() {
    const app = getApp()
    app.clearCloudBroken()
    this._cloudOffline = false
    this.setData({ cloudOffline: false })
    this.stopWatcher()
    this._menuLoaded = false
    this.loadSpaces()
  },

  // ========== 登录/空间检查 ==========

  checkLoginAndSpace() {
    if (this._redirecting) return false
    const userInfo = wx.getStorageSync('userInfo')
    // 无用户信息时由 app.js 保证已创建游客，此处直接返回 true
    if (!userInfo || !userInfo._openid) {
      this._redirecting = false
      return true
    }
    // 游客模式/离线本地模式：有用户即可，无空间也可浏览（会引导创建）
    if (this._guest || this._cloudOffline) {
      this._redirecting = false
      return true
    }
    const activeId = getApp().globalData.activeSpaceId
    if (!activeId) return false
    this._redirecting = false
    return true
  },

  // ========== 菜单加载 ==========

  loadMenu() {
    if (!this.checkLoginAndSpace()) return
    const activeId = getApp().globalData.activeSpaceId
    if (!activeId) return
    const spaceInfo = getApp().globalData.activeSpaceInfo
    const todayKey = getApp().getTodayKey()

    this.setData({ spaceName: spaceInfo ? spaceInfo.name : '' })
    this._lastSpaceId = activeId
    this._lastMenuSpaceId = activeId
    this._menuLoaded = true
    this.updateDateDisplay(todayKey)

    // 游客/离线模式：从本地存储加载
    if (this._guest || this._cloudOffline) {
      const { doc } = storage.guestGetMenu(activeId, this.localNs())
      if (doc) {
        this.setData({
          menu: { date: doc.date, items: doc.items || [] },
          menuDocId: activeId + '_' + todayKey,
          watcherReady: true
        })
      } else {
        this.setData({
          menu: { date: todayKey, items: [] },
          menuDocId: null,
          watcherReady: true
        })
      }
      return
    }

    const db = wx.cloud.database()
    db.collection('menus')
      .where({ spaceId: activeId, date: todayKey })
      .get()
      .then(res => {
        // Guard: space may have changed while query was in-flight;
        // 已降级本地模式时忽略迟到的云端结果
        if (this._cloudOffline) return
        if (getApp().globalData.activeSpaceId !== activeId) return
        if (res.data.length > 0) {
          const doc = res.data[0]
          if (res.data.length > 1) {
            const merged = new Map()
            res.data.forEach(d => (d.items || []).forEach(i => merged.set(i.id, i)))
            const allItems = [...merged.values()]
            const keepId = doc._id
            const delIds = res.data.slice(1).map(d => d._id)
            Promise.all(delIds.map(id => db.collection('menus').doc(id).remove()))
            db.collection('menus').doc(keepId).update({
              data: { items: allItems, updatedAt: Date.now() }
            })
            this.setData({
              menu: { date: doc.date, items: allItems },
              menuDocId: keepId,
              watcherReady: true
            })
          } else {
            this.setData({
              menu: { date: doc.date, items: doc.items || [] },
              menuDocId: doc._id,
              watcherReady: true
            })
          }
          this.startWatcher()
        } else {
          this.setData({
            menu: { date: todayKey, items: [] },
            menuDocId: null,
            watcherReady: true
          })
          this.startWatcher()
        }
      })
      .catch(err => {
        console.error('[space] load fail:', err)
        this.setData({ watcherReady: true })
        this.enterOfflineMode('菜单加载失败: ' + (err && err.errMsg ? err.errMsg : ''))
      })
  },

  updateDateDisplay(dateKey) {
    const [y, m, d] = dateKey.split('-')
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']
    const date = new Date(+y, +m - 1, +d)
    this.setData({
      todayDate: `${y}年${+m}月${+d}日`,
      todayWeekday: `星期${weekDays[date.getDay()]}`
    })
  },

  startWatcher() {
    if (this._guest || this._cloudOffline) return
    this.stopWatcher()
    const activeId = getApp().globalData.activeSpaceId
    if (!activeId) return
    const todayKey = getApp().getTodayKey()
    const db = wx.cloud.database()

    this._watcherFailCount = 0

    this._watcher = db.collection('menus')
      .where({ spaceId: activeId, date: todayKey })
      .watch({
        onChange: (snapshot) => {
          if (!this._pageActive) return
          if (getApp().globalData.activeSpaceId !== activeId) {
            this.stopWatcher()
            return
          }
          this._watcherFailCount = 0
          if (snapshot.docs.length > 0) {
            const doc = snapshot.docs[0]
            if (doc.items) {
              this.setData({
                menu: { date: doc.date, items: doc.items },
                menuDocId: doc._id
              })
            }
          } else {
            this.setData({
              menu: { date: todayKey, items: [] },
              menuDocId: null
            })
          }
        },
        onError: (err) => {
          console.error('[space] watcher error:', err)
          if (!this._pageActive) return
          this.stopWatcher()
          this._watcherFailCount = (this._watcherFailCount || 0) + 1
          // 连续失败 3 次说明云服务不可用（环境过期/网络中断），
          // 降级本地模式并停止无限重试，避免报错风暴
          if (this._watcherFailCount >= 3) {
            this.enterOfflineMode('实时监听连续失败')
            return
          }
          if (!this._pageActive) return
          this._watcherTimer = setTimeout(() => {
            this._watcherTimer = null
            if (!this._pageActive) return
            if (this._cloudOffline) return
            if (getApp().globalData.activeSpaceId === activeId) {
              this.startWatcher()
            }
          }, 5000)
        }
      })
  },

  stopWatcher() {
    if (this._watcherTimer) {
      clearTimeout(this._watcherTimer)
      this._watcherTimer = null
    }
    if (this._watcher) {
      try {
        this._watcher.close()
      } catch (e) {
        // watcher 可能已关闭，忽略错误
        console.warn('[space] watcher close error (ignored):', e.message)
      }
      this._watcher = null
    }
  },

  // ========== 空间管理 ==========

  loadSpaces() {
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo._openid) return

    // 游客/离线模式：从本地存储加载
    if (this._guest || this._cloudOffline) {
      const ns = this.localNs()
      const spaces = storage.guestGetSpaces(ns)
      const activeId = wx.getStorageSync('activeSpaceId')
      let validActiveId = activeId && spaces.find(s => s._id === activeId) ? activeId : (spaces[0] ? spaces[0]._id : '')
      const active = spaces.find(s => s._id === validActiveId)
      this.setData({
        spaceList: spaces,
        activeSpaceId: validActiveId,
        spaceName: active ? active.name : ''
      })
      if (validActiveId && active) {
        getApp().setActiveSpace(validActiveId, active)
      } else {
        getApp().setActiveSpace('', null)
      }
      const spaceChanged = validActiveId !== this._lastMenuSpaceId
      if (spaceChanged || !this._menuLoaded) {
        if (this.checkLoginAndSpace()) {
          this.loadMenu()
        }
      }
      return
    }

    const db = wx.cloud.database()
    db.collection('space_members').where({ _openid: userInfo._openid }).get()
      .then(res => {
        // 已降级本地模式：忽略迟到的云端结果
        if (this._cloudOffline) return
        const memberEntries = res.data
        if (memberEntries.length === 0) {
          this.setData({ spaceList: [], activeSpaceId: '', spaceName: '' })
          return
        }
        const spaceIds = memberEntries.map(m => m.spaceId)
        Promise.all([
          db.collection('spaces').where({ _id: db.command.in(spaceIds) }).get(),
          db.collection('space_members').where({ spaceId: db.command.in(spaceIds) }).get()
        ]).then(([spaceRes, allMembersRes]) => {
            const spaces = spaceRes.data
            const allMembers = allMembersRes.data
            const countMap = {}
            allMembers.forEach(m => {
              countMap[m.spaceId] = (countMap[m.spaceId] || 0) + 1
            })
            const activeId = wx.getStorageSync('activeSpaceId')
            let validActiveId = activeId && spaces.find(s => s._id === activeId) ? activeId : (spaces[0] ? spaces[0]._id : '')
            const list = spaces.map(s => {
              const member = memberEntries.find(m => m.spaceId === s._id)
              return { ...s, memberCount: countMap[s._id] || 0, role: member ? member.role : 'member' }
            })
            const active = list.find(s => s._id === validActiveId)
            this.setData({
              spaceList: list,
              activeSpaceId: validActiveId,
              spaceName: active ? active.name : ''
            })
            if (validActiveId && active) {
              getApp().setActiveSpace(validActiveId, active)
            }
            const spaceChanged = validActiveId !== this._lastMenuSpaceId
            if (spaceChanged || !this._menuLoaded) {
              if (this.checkLoginAndSpace()) {
                this.loadMenu()
              }
            }
          })
          .catch(() => {})
      })
      .catch(err => {
        console.error('[space] 加载空间失败:', err)
        this.enterOfflineMode('加载空间失败')
      })
  },

  switchSpace(e) {
    const { id } = e.currentTarget.dataset
    if (id === this.data.activeSpaceId) {
      this.setData({ showSpaceManager: false })
      return
    }
    const space = this.data.spaceList.find(s => s._id === id)
    if (space) {
      this.stopWatcher()
      this.setData({ activeSpaceId: id, spaceName: space.name, showSpaceManager: false })
      getApp().setActiveSpace(id, space)
      this._menuLoaded = false
      this.setData({ menu: { date: '', items: [] }, menuDocId: null })
      this.loadMenu()
      wx.showToast({ title: `已切换到「${space.name}」`, icon: 'success', duration: 1000 })
    }
  },

  toggleSpaceManager() {
    this.setData({ showSpaceManager: !this.data.showSpaceManager })
  },

  hideSpaceManager() { this.setData({ showSpaceManager: false }) },

  // 查看成员
  showSpaceDetail(e) {
    const { id } = e.currentTarget.dataset
    const space = this.data.spaceList.find(s => s._id === id)
    if (!space) return
    this.setData({ showMembers: true, selectedSpace: space, showSpaceManager: false })
    this.fetchMembers(id)
  },

  hideMembers() { this.setData({ showMembers: false }) },

  fetchMembers(spaceId) {
    if (this._guest || this._cloudOffline) {
      // 从空间的 members 数组读取，若无则从用户信息构造
      const space = this.data.spaceList.find(s => s._id === spaceId)
      const userInfo = wx.getStorageSync('userInfo')
      if (space && space.members && space.members.length > 0) {
        this.setData({ members: space.members })
      } else {
        const profile = wx.getStorageSync('persistentProfile') || {}
        this.setData({
          members: [{
            nickName: profile.nickName || userInfo.nickName || '游客',
            role: (space && space.role) || 'owner'
          }]
        })
      }
      return
    }
    const db = wx.cloud.database()
    db.collection('space_members').where({ spaceId }).get()
      .then(res => this.setData({ members: res.data }))
      .catch(() => {})
  },

  // 创建
  startCreate() { this.setData({ showCreate: true, newSpaceName: '', spaceType: '', showSpaceManager: false }) },
  cancelCreate() { this.setData({ showCreate: false }) },
  selectType(e) {
    const { type } = e.currentTarget.dataset
    const preset = this.data.spaceTypes.find(t => t.key === type)
    this.setData({ spaceType: type, newSpaceName: preset.key !== 'custom' ? preset.label : '' })
  },
  onSpaceNameInput(e) { this.setData({ newSpaceName: e.detail.value }) },

  confirmCreate() {
    if (this.data.submitting) return
    const name = this.data.newSpaceName.trim()
    if (!name) { wx.showToast({ title: '请输入空间名称', icon: 'none' }); return }
    this.setData({ submitting: true })

    // 游客/离线模式：本地创建
    if (this._guest || this._cloudOffline) {
      const space = storage.guestCreateSpace(name, this.data.spaceType || 'custom', this.localNs())
      const list = [...this.data.spaceList, space]
      this.stopWatcher()
      this.setData({ showCreate: false, spaceList: list, activeSpaceId: space._id, spaceName: name, submitting: false })
      getApp().setActiveSpace(space._id, space)
      this._menuLoaded = false
      this.setData({ menu: { date: '', items: [] }, menuDocId: null })
      this.loadMenu()
      wx.showToast({ title: '创建成功', icon: 'success' })
      return
    }

    const userInfo = wx.getStorageSync('userInfo')
    const db = wx.cloud.database()
    const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()

    db.collection('spaces').add({
      data: { name, type: this.data.spaceType || 'custom', inviteCode, memberCount: 1, createdAt: Date.now() }
    }).then(res => {
      const spaceId = res._id
      db.collection('space_members').add({
        data: { spaceId, nickName: userInfo.nickName, role: 'owner', joinedAt: Date.now() }
      }).then(() => {
        const space = { _id: spaceId, name, type: this.data.spaceType || 'custom', inviteCode, memberCount: 1, role: 'owner' }
        const list = [...this.data.spaceList, space]
        this.stopWatcher()
        this.setData({ showCreate: false, spaceList: list, activeSpaceId: spaceId, spaceName: name, submitting: false })
        getApp().setActiveSpace(spaceId, space)
        this._menuLoaded = false
        this.setData({ menu: { date: '', items: [] }, menuDocId: null })
        this.loadMenu()
        wx.showToast({ title: '创建成功', icon: 'success' })
      }).catch(err => {
        console.error('创建成员记录失败:', err)
        db.collection('spaces').doc(spaceId).remove().catch(() => {})
        this.setData({ submitting: false })
        this.enterOfflineMode('创建空间失败')
      })
    }).catch(err => {
      console.error('创建空间失败:', err)
      this.setData({ submitting: false })
      this.enterOfflineMode('创建空间失败')
    })
  },

  // 加入
  startJoin() { this.setData({ showJoin: true, joinCode: '', showSpaceManager: false }) },
  cancelJoin() { this.setData({ showJoin: false }) },
  onJoinCodeInput(e) { this.setData({ joinCode: e.detail.value.toUpperCase() }) },

  confirmJoin() {
    if (this.data.submitting) return
    const code = this.data.joinCode.trim().toUpperCase()
    if (!code) { wx.showToast({ title: '请输入邀请码', icon: 'none' }); return }
    this.setData({ submitting: true })

    // 游客/离线模式：本地加入
    if (this._guest || this._cloudOffline) {
      const result = storage.guestJoinSpace(code, this.localNs())
      if (!result) {
        this.setData({ submitting: false })
        wx.showToast({ title: '邀请码无效', icon: 'none' })
        return
      }
      if (result === 'already_joined') {
        this.setData({ submitting: false })
        wx.showToast({ title: '你已在该空间中', icon: 'none' })
        return
      }
      const space = result
      const list = [...this.data.spaceList, space]
      this.stopWatcher()
      this.setData({ showJoin: false, spaceList: list, activeSpaceId: space._id, spaceName: space.name, submitting: false })
      getApp().setActiveSpace(space._id, space)
      this._menuLoaded = false
      this.setData({ menu: { date: '', items: [] }, menuDocId: null })
      this.loadMenu()
      wx.showToast({ title: '加入成功', icon: 'success' })
      return
    }

    const userInfo = wx.getStorageSync('userInfo')
    const db = wx.cloud.database()

    db.collection('spaces').where({ inviteCode: code }).get()
      .then(res => {
        if (res.data.length === 0) {
          this.setData({ submitting: false })
          wx.showToast({ title: '邀请码无效', icon: 'none' })
          return
        }
        const space = res.data[0]
        return db.collection('space_members').where({ spaceId: space._id, _openid: userInfo._openid }).get()
          .then(memberRes => {
            if (memberRes.data.length > 0) {
              this.setData({ submitting: false })
              wx.showToast({ title: '你已在该空间中', icon: 'none' })
              return
            }
            return db.collection('space_members').add({
              data: { spaceId: space._id, nickName: userInfo.nickName, role: 'member', joinedAt: Date.now() }
            }).then(() => {
              return db.collection('spaces').doc(space._id).update({
                data: { memberCount: db.command.inc(1) }
              })
            }).then(() => {
              space.memberCount += 1
              space.role = 'member'
              const list = [...this.data.spaceList, space]
              this.stopWatcher()
              this.setData({ showJoin: false, spaceList: list, activeSpaceId: space._id, spaceName: space.name, submitting: false })
              getApp().setActiveSpace(space._id, space)
              this._menuLoaded = false
              this.setData({ menu: { date: '', items: [] }, menuDocId: null })
              this.loadMenu()
              wx.showToast({ title: '加入成功', icon: 'success' })
            })
          })
      })
      .catch(err => {
        console.error('加入空间失败:', err)
        this.setData({ submitting: false })
        this.enterOfflineMode('加入空间失败')
      })
  },

  // 邀请
  showInvite(e) {
    const { id } = e.currentTarget.dataset
    const space = this.data.spaceList.find(s => s._id === id)
    if (space) this.setData({ showInvite: true, selectedSpace: space, showSpaceManager: false })
  },
  hideInviteModal() { this.setData({ showInvite: false }) },
  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.selectedSpace.inviteCode,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' })
    })
  },

  // 退出
  showLeave(e) {
    const { id } = e.currentTarget.dataset
    const space = this.data.spaceList.find(s => s._id === id)
    if (space) this.setData({ showLeaveConfirm: true, selectedSpace: space, showSpaceManager: false })
  },
  hideLeaveConfirm() { this.setData({ showLeaveConfirm: false }) },

  confirmLeave() {
    if (this.data.submitting) return
    this.setData({ submitting: true })

    // 游客/离线模式：本地退出
    if (this._guest || this._cloudOffline) {
      const spaceId = this.data.selectedSpace._id
      const list = storage.guestLeaveSpace(spaceId, this.localNs())
      const newActiveId = wx.getStorageSync('activeSpaceId')
      const newActive = list.find(s => s._id === newActiveId) || null
      this.setData({
        showLeaveConfirm: false, spaceList: list,
        activeSpaceId: newActiveId, spaceName: newActive ? newActive.name : '',
        submitting: false
      })
      if (newActiveId && newActive) {
        this.stopWatcher()
        getApp().setActiveSpace(newActiveId, newActive)
        this._menuLoaded = false
        this.setData({ menu: { date: '', items: [] }, menuDocId: null })
        this.loadMenu()
      } else {
        getApp().setActiveSpace('', null)
      }
      wx.showToast({ title: '已退出', icon: 'success' })
      return
    }

    const userInfo = wx.getStorageSync('userInfo')
    const db = wx.cloud.database()
    const spaceId = this.data.selectedSpace._id

    db.collection('space_members').where({ spaceId, _openid: userInfo._openid }).get()
      .then(res => {
        if (res.data.length === 0) return
        const memberId = res.data[0]._id
        return db.collection('space_members').doc(memberId).remove().then(() => {
          return db.collection('spaces').doc(spaceId).update({
            data: { memberCount: db.command.inc(-1) }
          })
        })
      })
      .then(() => {
        const list = this.data.spaceList.filter(s => s._id !== spaceId)
        const newActiveId = list.length > 0 ? list[0]._id : ''
        const newActive = list.length > 0 ? list[0] : null
        this.setData({
          showLeaveConfirm: false, spaceList: list,
          activeSpaceId: newActiveId, spaceName: newActive ? newActive.name : '',
          submitting: false
        })
        if (newActiveId && newActive) {
          this.stopWatcher()
          getApp().setActiveSpace(newActiveId, newActive)
          this._menuLoaded = false
          this.setData({ menu: { date: '', items: [] }, menuDocId: null })
          this.loadMenu()
        } else {
          getApp().setActiveSpace('', null)
        }
        wx.showToast({ title: '已退出', icon: 'success' })
      })
      .catch(err => {
        console.error('退出空间失败:', err)
        this.setData({ submitting: false })
        this.enterOfflineMode('退出空间失败')
      })
  },

  getTypeIcon(type) {
    const t = this.data.spaceTypes.find(s => s.key === type)
    return t ? t.icon : '✨'
  },

  // ========== 菜品操作 ==========

  toggleNote(e) {
    const { id } = e.currentTarget.dataset
    const items = this.data.menu.items.map(item => {
      if (item.id === id) return { ...item, expanded: !item.expanded }
      return item
    })
    this.setData({ 'menu.items': items })
    this.saveMenuToCloud(items)
  },

  showAddModal() { this.setData({ showModal: true, newDishName: '', newDishNote: '' }) },
  hideAddModal() { this.setData({ showModal: false }) },
  onNameInput(e) { this.setData({ newDishName: e.detail.value }) },
  onNoteInput(e) { this.setData({ newDishNote: e.detail.value }) },

  addDish() {
    const name = this.data.newDishName.trim()
    if (!name) { wx.showToast({ title: '请输入菜品名称', icon: 'none' }); return }
    const userInfo = wx.getStorageSync('userInfo')
    const item = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      name, note: this.data.newDishNote.trim(), expanded: false,
      addedBy: (userInfo && userInfo.nickName) || '匿名', addedAt: Date.now()
    }
    const items = [...this.data.menu.items, item]
    this.setData({ 'menu.items': items, showModal: false })
    this.saveMenuToCloud(items)
    wx.showToast({ title: '添加成功', icon: 'success', duration: 1000 })
  },

  deleteDish(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '删除菜品', content: '确定要删除这道菜吗？', confirmColor: '#ff3b30',
      success: (res) => {
        if (res.confirm) {
          const items = this.data.menu.items.filter(item => item.id !== id)
          this.setData({ 'menu.items': items })
          this.saveMenuToCloud(items)
          wx.showToast({ title: '已删除', icon: 'success', duration: 1000 })
        }
      }
    })
  },

  clearAll() {
    if (this.data.menu.items.length === 0) { wx.showToast({ title: '菜单已经是空的', icon: 'none' }); return }
    this.setData({ showClearConfirm: true })
  },
  hideClearConfirm() { this.setData({ showClearConfirm: false }) },

  confirmClear() {
    this.setData({ 'menu.items': [], showClearConfirm: false })
    this.saveMenuToCloud([])
    wx.showToast({ title: '已清空', icon: 'success', duration: 1000 })
  },

  // ========== 云端保存 ==========

  saveMenuToCloud(items) {
    const spaceId = getApp().globalData.activeSpaceId
    if (!spaceId) {
      console.error('[space] save aborted: no spaceId')
      return
    }
    const spaceInfo = getApp().globalData.activeSpaceInfo

    // 游客/离线模式：存本地
    if (this._guest || this._cloudOffline) {
      storage.guestSaveMenu(spaceId, spaceInfo ? spaceInfo.name : '', items, this.localNs())
      console.log('[space] local save ok')
      return
    }

    const todayKey = getApp().getTodayKey()
    const db = wx.cloud.database()

    const saveData = { spaceId, spaceName: spaceInfo ? spaceInfo.name : '', date: todayKey, items, updatedAt: Date.now() }

    if (this.data.menuDocId) {
      db.collection('menus').doc(this.data.menuDocId).update({ data: saveData })
        .then(() => {
          console.log('[space] save ok, docId:', this.data.menuDocId)
        })
        .catch(err => {
          console.error('[space] save fail:', err)
          this.saveFailFallback(spaceId, spaceInfo, items)
        })
      return
    }

    db.collection('menus').where({ spaceId, date: todayKey }).get()
      .then(res => {
        if (res.data.length > 0) {
          const doc = res.data[0]
          const merged = new Map()
          ;(doc.items || []).forEach(i => merged.set(i.id, i))
          items.forEach(i => merged.set(i.id, i))
          const allItems = [...merged.values()]
          db.collection('menus').doc(doc._id).update({
            data: { ...saveData, items: allItems }
          }).then(() => {
            this.setData({ menuDocId: doc._id })
            console.log('[space] save ok (merged), docId:', doc._id)
          }).catch(err => {
            console.error('[space] save fail:', err)
            this.saveFailFallback(spaceId, spaceInfo, items)
          })
          if (res.data.length > 1) {
            const delIds = res.data.slice(1).map(d => d._id)
            Promise.all(delIds.map(id => db.collection('menus').doc(id).remove()))
          }
        } else {
          db.collection('menus').add({ data: saveData })
            .then(addRes => {
              this.setData({ menuDocId: addRes._id })
              console.log('[space] save ok (new), docId:', addRes._id)
            })
            .catch(err => {
              console.error('[space] save fail:', err)
              this.saveFailFallback(spaceId, spaceInfo, items)
            })
        }
      })
      .catch(err => {
        console.error('[space] save fail:', err)
        this.saveFailFallback(spaceId, spaceInfo, items)
      })
  },

  // 云保存失败：先写入本地兜底，再切换离线模式，避免用户数据丢失
  saveFailFallback(spaceId, spaceInfo, items) {
    storage.guestSaveMenu(spaceId, spaceInfo ? spaceInfo.name : '', items, this.localNs())
    this.enterOfflineMode('云端保存失败', true)
  },

  // ========== 分享 ==========

  // 点击游客提示条 → 跳转个人主页
  goToProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  onShareAppMessage() {
    const items = this.data.menu.items
    const summary = items.length > 0 ? items.map(i => i.name).join('、') : '还没有点菜'
    const spaceName = this.data.spaceName || '菜菜手帐'
    return {
      title: `「${spaceName}」今日菜单 - ${summary}`,
      path: '/pages/space/space'
    }
  },

  noop() {}
})
