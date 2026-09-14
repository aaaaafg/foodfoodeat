// 本地存储工具（纯本地单机版，无任何云端依赖）
// 数据模型：
//   profile  : { nickName, avatarUrl }
//   spaces   : [{ id, name, icon, createdAt }]
//   menus    : { [spaceId_date]: { spaceId, spaceName, date, items: [{id,name,note,addedAt}], updatedAt } }
//   activeSpaceId : 当前分组

const SPACES_KEY = 'spaces'
const MENUS_KEY = 'menus'
const ACTIVE_KEY = 'activeSpaceId'
const PROFILE_KEY = 'profile'

function getTodayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// 把 "2026-5-9" 这类日期键转成可比较的数字，
// 避免字符串排序把 5-9 排在 5-10 后面、11月排在2月前面
function dateKeyToNum(key) {
  if (!key) return 0
  const parts = key.split('-')
  return (+parts[0] || 0) * 10000 + (+parts[1] || 0) * 100 + (+parts[2] || 0)
}

// ========== 个人资料 ==========

function getProfile() {
  return wx.getStorageSync(PROFILE_KEY) || null
}

function saveProfile(patch) {
  const p = Object.assign({}, getProfile() || {}, patch)
  wx.setStorageSync(PROFILE_KEY, p)
  return p
}

// ========== 分组管理 ==========

function getSpaces() {
  return wx.getStorageSync(SPACES_KEY) || []
}

function createSpace(name, icon) {
  const spaces = getSpaces()
  const space = {
    id: 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || '我的菜单',
    icon: icon || '✨',
    createdAt: Date.now()
  }
  spaces.push(space)
  wx.setStorageSync(SPACES_KEY, spaces)
  setActiveSpace(space.id)
  return space
}

// 删除分组：同时删除该分组的全部菜单记录
function deleteSpace(id) {
  const spaces = getSpaces().filter(s => s.id !== id)
  wx.setStorageSync(SPACES_KEY, spaces)
  const menus = getMenusMap()
  for (const key in menus) {
    if (key.indexOf(id + '_') === 0) delete menus[key]
  }
  wx.setStorageSync(MENUS_KEY, menus)
  if (getActiveSpaceId() === id) {
    setActiveSpace(spaces.length > 0 ? spaces[0].id : '')
  }
  return spaces
}

function getActiveSpaceId() {
  return wx.getStorageSync(ACTIVE_KEY) || ''
}

function setActiveSpace(id) {
  wx.setStorageSync(ACTIVE_KEY, id || '')
}

// ========== 菜单 ==========

function getMenusMap() {
  return wx.getStorageSync(MENUS_KEY) || {}
}

function getMenu(spaceId) {
  const todayKey = getTodayKey()
  const menus = getMenusMap()
  return menus[spaceId + '_' + todayKey] || null
}

function saveMenu(spaceId, spaceName, items) {
  const todayKey = getTodayKey()
  const menus = getMenusMap()
  menus[spaceId + '_' + todayKey] = {
    spaceId,
    spaceName: spaceName || '',
    date: todayKey,
    items: items || [],
    updatedAt: Date.now()
  }
  wx.setStorageSync(MENUS_KEY, menus)
}

function getHistory(spaceId) {
  const menus = getMenusMap()
  const list = []
  for (const key in menus) {
    if (key.indexOf(spaceId + '_') === 0) {
      const entry = menus[key]
      if (entry.items && entry.items.length > 0) {
        list.push(entry)
      }
    }
  }
  return list.sort((a, b) => dateKeyToNum(b.date) - dateKeyToNum(a.date))
}

// target: 'all' 清空历史（保留今天） | 'day' 删除某一天
function clearHistory(spaceId, target, clearDate) {
  const menus = getMenusMap()
  const todayKey = getTodayKey()
  for (const key in menus) {
    if (key.indexOf(spaceId + '_') === 0) {
      if (target === 'all' && menus[key].date !== todayKey) {
        delete menus[key]
      } else if (target === 'day' && menus[key].date === clearDate) {
        delete menus[key]
      }
    }
  }
  wx.setStorageSync(MENUS_KEY, menus)
}

// ========== 旧版数据迁移（一次性） ==========
// 旧版（游客/云时代）把数据存在 guest_spaces / guest_menus / persistentProfile，
// 新版改用新 key。首次启动时自动搬运，避免用户丢数据。

function migrateLegacyData() {
  if (wx.getStorageSync('v2Migrated')) return
  try {
    const hasNewSpaces = wx.getStorageSync(SPACES_KEY)
    const hasNewMenus = wx.getStorageSync(MENUS_KEY)

    // 个人资料
    if (!getProfile()) {
      const oldProfile = wx.getStorageSync('persistentProfile')
      if (oldProfile && oldProfile.nickName) {
        wx.setStorageSync(PROFILE_KEY, {
          nickName: oldProfile.nickName,
          avatarUrl: oldProfile.avatarUrl || ''
        })
      }
    }

    // 分组
    if (!hasNewSpaces) {
      const oldSpaces = wx.getStorageSync('guest_spaces') || []
      if (oldSpaces.length > 0) {
        const spaces = oldSpaces.map(s => ({
          id: s._id,
          name: s.name || '我的菜单',
          icon: s.type === 'couple' ? '💑' : s.type === 'family' ? '🏠' : s.type === 'friends' ? '🍚' : '✨',
          createdAt: s.createdAt || Date.now()
        }))
        wx.setStorageSync(SPACES_KEY, spaces)
        const oldActive = wx.getStorageSync('activeSpaceId')
        if (oldActive && spaces.some(s => s.id === oldActive)) {
          wx.setStorageSync(ACTIVE_KEY, oldActive)
        } else if (spaces.length > 0) {
          wx.setStorageSync(ACTIVE_KEY, spaces[0].id)
        }
      }
    }

    // 菜单（key 中的分组 id 与旧版一致，直接复用）
    if (!hasNewMenus) {
      const oldMenus = wx.getStorageSync('guest_menus') || {}
      const keys = Object.keys(oldMenus)
      if (keys.length > 0) {
        const menus = {}
        keys.forEach(key => {
          const entry = oldMenus[key]
          if (entry && entry.items && entry.items.length > 0) {
            menus[key] = {
              spaceId: entry.spaceId,
              spaceName: entry.spaceName || '',
              date: entry.date,
              items: entry.items.map(it => ({
                id: it.id || Date.now().toString() + Math.random().toString(36).slice(2, 6),
                name: it.name,
                note: it.note || '',
                addedAt: it.addedAt || Date.now()
              })),
              updatedAt: entry.updatedAt || Date.now()
            }
          }
        })
        wx.setStorageSync(MENUS_KEY, menus)
      }
    }
  } catch (err) {
    console.warn('[storage] 旧数据迁移失败（不影响使用）:', err)
  }
  wx.setStorageSync('v2Migrated', true)
}

module.exports = {
  getTodayKey,
  dateKeyToNum,
  getProfile,
  saveProfile,
  getSpaces,
  createSpace,
  deleteSpace,
  getActiveSpaceId,
  setActiveSpace,
  getMenusMap,
  getMenu,
  saveMenu,
  getHistory,
  clearHistory,
  migrateLegacyData
}
