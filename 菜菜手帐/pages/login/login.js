const nicknames = ['小吃货', '小厨神', '美食家', '干饭人', '小当家', '甜品控', '吃货达人', '料理王', '家常菜高手', '零食收割机']

Page({
  data: {
    loading: false,
    nickname: '',
    avatarUrl: '',
    agreed: false,
    showTerms: false
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo')
    // 已是真实用户则直接返回个人主页
    if (userInfo && userInfo._openid && userInfo._openid !== 'guest_user') {
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    // 优先使用持久化个人资料中的昵称，其次使用游客信息，最后随机
    const persistentProfile = wx.getStorageSync('persistentProfile') || {}
    let savedNick = persistentProfile.nickName
    if (!savedNick && userInfo && userInfo.nickName && userInfo.nickName !== '游客') {
      savedNick = userInfo.nickName
    }
    this.setData({
      nickname: savedNick || nicknames[Math.floor(Math.random() * nicknames.length)],
      avatarUrl: persistentProfile.avatarUrl || ''
    })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (!avatarUrl) return
    this.setData({ avatarUrl })
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  showTermsDetail() {
    this.setData({ showTerms: true })
  },

  hideTermsDetail() {
    this.setData({ showTerms: false })
  },

  // 带重试的云函数调用
  callFunctionWithRetry(name, retries = 2) {
    const attempt = (n) => {
      return wx.cloud.callFunction({ name }).catch(err => {
        if (n > 0) {
          console.warn(`[login] callFunction ${name} retry, ${n} attempts left`)
          return new Promise(resolve => setTimeout(resolve, 1000)).then(() => attempt(n - 1))
        }
        throw err
      })
    }
    return attempt(retries)
  },

  // 带重试的数据库操作
  dbWithRetry(operation, retries = 2) {
    return operation().catch(err => {
      if (retries > 0) {
        console.warn(`[login] db operation retry, ${retries} attempts left`)
        return new Promise(resolve => setTimeout(resolve, 800)).then(() => this.dbWithRetry(operation, retries - 1))
      }
      throw err
    })
  },

  handleLogin() {
    if (this.data.loading) return
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意用户协议', icon: 'none' })
      return
    }
    // 云服务不可用：直接提示，不做注定失败的请求
    if (getApp().globalData.cloudBroken) {
      wx.showToast({ title: '云服务不可用，暂无法登录', icon: 'none' })
      return
    }
    this.setData({ loading: true })

    // 昵称和头像已通过页面顶部的 chooseAvatar 按钮和 input 组件收集
    // 带重试的云函数调用
    this.callFunctionWithRetry('getOpenid', 1)
      .then(res => {
        const openid = res.result.openid
        const db = wx.cloud.database()

        const nickname = this.data.nickname.trim() || nicknames[Math.floor(Math.random() * nicknames.length)]
        const localAvatar = this.data.avatarUrl

        const processAvatar = () => {
          if (!localAvatar) return Promise.resolve('')
          // 已是云存储文件 ID，直接使用
          if (localAvatar.startsWith('cloud://')) return Promise.resolve(localAvatar)
          const upload = (filePath) => wx.cloud.uploadFile({
            cloudPath: `avatars/${openid}_${Date.now()}.png`,
            filePath
          }).then(r => r.fileID).catch(() => '')
          // base64 头像（游客模式改过头像）：先写成临时文件再上传
          if (localAvatar.startsWith('data:image')) {
            const fs = wx.getFileSystemManager()
            const filePath = `${wx.env.USER_DATA_PATH}/avatar_${Date.now()}.png`
            try {
              fs.writeFileSync(filePath, localAvatar.split(',')[1], 'base64')
              return upload(filePath)
            } catch (e) {
              console.warn('[login] base64 头像写入失败:', e)
              return Promise.resolve('')
            }
          }
          // chooseAvatar 返回的临时文件路径，直接上传
          return upload(localAvatar)
        }

        processAvatar().then(avatarFileID => {
          this.dbWithRetry(() => db.collection('users').where({ _openid: openid }).get())
            .then(userRes => {
              if (userRes.data.length === 0) {
                const userData = { nickName: nickname, updatedAt: Date.now(), createdAt: Date.now() }
                if (avatarFileID) userData.avatarUrl = avatarFileID
                this.dbWithRetry(() => db.collection('users').add({ data: userData }))
                  .then(addRes => this.saveAndGo({ _id: addRes._id, _openid: openid, ...userData }))
                  .catch(() => this.loginFail())
              } else {
                const existing = userRes.data[0]
                const updateData = { updatedAt: Date.now() }
                if (avatarFileID) updateData.avatarUrl = avatarFileID
                this.dbWithRetry(() => db.collection('users').doc(existing._id).update({ data: updateData }))
                  .then(() => {
                    const saved = { ...existing }
                    if (avatarFileID) saved.avatarUrl = avatarFileID
                    this.saveAndGo(saved)
                  })
                  .catch(() => this.loginFail())
              }
            })
            .catch(() => this.loginFail())
        })
      })
      .catch(err => {
        console.error('[login] 云函数调用失败:', err)
        getApp().markCloudBroken()
        this.setData({ loading: false })
        wx.showToast({ title: '云服务不可用（环境可能已过期），可先用本地模式体验', icon: 'none', duration: 3000 })
      })
  },

  loginFail() {
    this.setData({ loading: false })
    wx.showToast({ title: '登录失败，请重试', icon: 'none' })
  },

  saveAndGo(userInfo) {
    wx.setStorageSync('userInfo', userInfo)
    getApp().globalData.userInfo = userInfo
    // 同步到持久化个人资料
    const storage = require('../../utils/storage')
    if (userInfo.nickName) storage.savePersistentProfile({ nickName: userInfo.nickName })
    if (userInfo.avatarUrl) storage.savePersistentProfile({ avatarUrl: userInfo.avatarUrl })
    this.setData({ loading: false })
    wx.showToast({ title: '登录成功', icon: 'success', duration: 800 })
    setTimeout(() => {
      wx.switchTab({ url: '/pages/profile/profile' })
    }, 900)
  },

  noop() {}
})
