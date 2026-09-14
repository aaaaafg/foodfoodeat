// 本地存储工具函数

function getTodayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function formatDate(dateKey) {
  const [y, m, d] = dateKey.split('-')
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const date = new Date(+y, +m - 1, +d)
  const weekDay = weekDays[date.getDay()]
  return `${y}年${m}月${d}日 星期${weekDay}`
}

// ========== 游客模式判断 ==========
function isGuest() {
  const userInfo = wx.getStorageSync('userInfo')
  return !!(userInfo && userInfo._openid === 'guest_user')
}

// ========== 本地存储命名空间 ==========
// 游客用 'guest'；登录用户云服务不可用时用 'offline_<openid>'，互不干扰
function localNs(userInfo) {
  if (!userInfo) userInfo = wx.getStorageSync('userInfo')
  if (userInfo && userInfo._openid && userInfo._openid !== 'guest_user') {
    return 'offline_' + userInfo._openid
  }
  return 'guest'
}

function menusKey(ns) { return (ns || 'guest') + '_menus' }
function spacesKey(ns) { return (ns || 'guest') + '_spaces' }

// ========== 游客模式 - 本地菜单数据 ==========

function guestGetMenu(spaceId, ns) {
  const todayKey = getTodayKey()
  const allMenus = wx.getStorageSync(menusKey(ns)) || {}
  const key = spaceId + '_' + todayKey
  if (allMenus[key]) {
    return { doc: allMenus[key], docId: key }
  }
  return { doc: null, docId: null }
}

function guestSaveMenu(spaceId, spaceName, items, ns) {
  const todayKey = getTodayKey()
  const allMenus = wx.getStorageSync(menusKey(ns)) || {}
  const key = spaceId + '_' + todayKey
  allMenus[key] = {
    spaceId,
    spaceName: spaceName || '',
    date: todayKey,
    items,
    updatedAt: Date.now()
  }
  wx.setStorageSync(menusKey(ns), allMenus)
}

function guestGetHistory(spaceId, ns) {
  const allMenus = wx.getStorageSync(menusKey(ns)) || {}
  const history = []
  for (const key in allMenus) {
    if (key.startsWith(spaceId + '_')) {
      const entry = allMenus[key]
      if (entry.items && entry.items.length > 0) {
        history.push(entry)
      }
    }
  }
  return history.sort((a, b) => b.date.localeCompare(a.date))
}

function guestClearHistory(spaceId, target, clearDate, ns) {
  const allMenus = wx.getStorageSync(menusKey(ns)) || {}
  const todayKey = getTodayKey()
  for (const key in allMenus) {
    if (key.startsWith(spaceId + '_')) {
      if (target === 'all' && allMenus[key].date !== todayKey) {
        delete allMenus[key]
      } else if (target === 'day' && allMenus[key].date === clearDate) {
        delete allMenus[key]
      }
    }
  }
  wx.setStorageSync(menusKey(ns), allMenus)
}

// ========== 游客模式 - 空间管理 ==========

function guestGetSpaces(ns) {
  return wx.getStorageSync(spacesKey(ns)) || []
}

function guestCreateSpace(name, type, ns) {
  const spaces = guestGetSpaces(ns)
  const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
  // 获取当前用户昵称
  const profile = getPersistentProfile() || {}
  const userInfo = wx.getStorageSync('userInfo')
  const nickName = profile.nickName || (userInfo && userInfo.nickName) || '游客'
  const space = {
    _id: 'guest_space_' + Date.now(),
    name,
    type: type || 'custom',
    inviteCode,
    memberCount: 1,
    role: 'owner',
    createdAt: Date.now(),
    members: [{ nickName, role: 'owner' }]
  }
  spaces.push(space)
  wx.setStorageSync(spacesKey(ns), spaces)
  // 自动设为活跃空间
  wx.setStorageSync('activeSpaceId', space._id)
  wx.setStorageSync('spaceInfo_' + space._id, space)
  return space
}

function guestJoinSpace(code, ns) {
  const spaces = guestGetSpaces(ns)
  const space = spaces.find(s => s.inviteCode === code.toUpperCase())
  if (!space) return null
  // 检查是否已在空间中
  if (space.role) return 'already_joined'
  // 获取当前用户昵称
  const profile = getPersistentProfile() || {}
  const userInfo = wx.getStorageSync('userInfo')
  const nickName = profile.nickName || (userInfo && userInfo.nickName) || '游客'
  space.role = 'member'
  space.memberCount += 1
  if (!space.members) space.members = []
  space.members.push({ nickName, role: 'member' })
  wx.setStorageSync(spacesKey(ns), spaces)
  wx.setStorageSync('activeSpaceId', space._id)
  wx.setStorageSync('spaceInfo_' + space._id, space)
  return space
}

function guestLeaveSpace(spaceId, ns) {
  let spaces = guestGetSpaces(ns)
  spaces = spaces.filter(s => s._id !== spaceId)
  wx.setStorageSync(spacesKey(ns), spaces)
  const activeId = wx.getStorageSync('activeSpaceId')
  if (activeId === spaceId) {
    const newActive = spaces.length > 0 ? spaces[0]._id : ''
    wx.setStorageSync('activeSpaceId', newActive)
    if (newActive) {
      wx.setStorageSync('spaceInfo_' + newActive, spaces[0])
    }
  }
  return spaces
}

// ========== 获取今日菜单（游客+普通兼容） ==========
function getTodayMenu() {
  const saved = wx.getStorageSync('todayMenu')
  const todayKey = getTodayKey()
  if (saved && saved.date === todayKey) {
    return saved
  }
  return { date: todayKey, items: [] }
}

function saveTodayMenu(menuData) {
  menuData.date = getTodayKey()
  wx.setStorageSync('todayMenu', menuData)
}

function getHistory() {
  return wx.getStorageSync('menuHistory') || []
}

function saveHistory(history) {
  wx.setStorageSync('menuHistory', history)
}

// ========== 持久化个人资料（跨登录/登出保持） ==========
// 无论登录还是游客模式，修改过的昵称和头像都保存在此
// 退出登录后重建游客时优先读取此配置

const GUEST_PROFILE_KEY = 'persistentProfile'

function getPersistentProfile() {
  return wx.getStorageSync(GUEST_PROFILE_KEY) || null
}

function savePersistentProfile(profile) {
  const existing = getPersistentProfile() || {}
  const merged = { ...existing, ...profile }
  wx.setStorageSync(GUEST_PROFILE_KEY, merged)
}

// ========== 15天修改限制 ==========

const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000

function canUpdateField(userInfo, field) {
  const lastUpdate = userInfo && userInfo[field]
  if (!lastUpdate) return { can: true }
  const elapsed = Date.now() - lastUpdate
  if (elapsed >= FIFTEEN_DAYS) return { can: true }
  const nextDate = new Date(lastUpdate + FIFTEEN_DAYS)
  const m = nextDate.getMonth() + 1
  const d = nextDate.getDate()
  return { can: false, nextDate: m + '月' + d + '日' }
}

function getNextAvailableDate(timestamp) {
  if (!timestamp) return null
  const nextDate = new Date(timestamp + FIFTEEN_DAYS)
  const m = nextDate.getMonth() + 1
  const d = nextDate.getDate()
  return m + '月' + d + '日'
}

module.exports = {
  getTodayKey,
  formatDate,
  getTodayMenu,
  saveTodayMenu,
  getHistory,
  saveHistory,
  // 游客模式
  isGuest,
  localNs,
  guestGetMenu,
  guestSaveMenu,
  guestGetHistory,
  guestClearHistory,
  guestGetSpaces,
  guestCreateSpace,
  guestJoinSpace,
  guestLeaveSpace,
  // 持久化个人资料
  getPersistentProfile,
  savePersistentProfile,
  // 15天限制
  FIFTEEN_DAYS,
  canUpdateField,
  getNextAvailableDate
}
