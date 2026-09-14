const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// TODO: 在微信公众平台申请「订阅消息」模板后，把模板 ID 填到这里，
// 并把 config.json 中的定时触发器加回来（当前已关闭，避免空跑报错）
const TEMPLATE_ID = 'YOUR_TEMPLATE_ID_HERE'
const DEBOUNCE_MS = 15 * 60 * 1000 // 15分钟

exports.main = async (event) => {
  // 模板未配置：直接返回，不发无效请求
  if (!TEMPLATE_ID || TEMPLATE_ID === 'YOUR_TEMPLATE_ID_HERE') {
    return { success: false, error: 'TEMPLATE_ID not configured' }
  }

  const now = Date.now()
  const threshold = now - DEBOUNCE_MS

  try {
    // 查找所有待发送且已过15分钟防抖期的记录
    const { data: pendingList } = await db.collection('notification_pending')
      .where({ sent: false })
      .get()

    for (const record of pendingList) {
      // 未到15分钟，跳过
      if (record.lastChangedAt > threshold) continue
      if (!record.spaceId || !record.changedBy) continue

      // 获取空间所有成员
      const { data: members } = await db.collection('space_members')
        .where({ spaceId: record.spaceId })
        .get()

      if (members.length === 0) {
        await db.collection('notification_pending').doc(record._id).update({
          data: { sent: true }
        })
        continue
      }

      const spaceName = record.spaceName || '菜单空间'

      // 逐用户发送订阅消息
      for (const member of members) {
        // 排除改动者本人、游客用户、无openid的用户
        if (member._openid === record.changedBy) continue
        if (!member._openid || member._openid === 'guest_user') continue

        try {
          await cloud.openapi.subscribeMessage.send({
            touser: member._openid,
            page: '/pages/space/space',
            data: {
              thing1: { value: spaceName.slice(0, 20) },
              thing2: { value: '今日菜单已更新' },
              time3: { value: record.date || '' }
            },
            templateId: TEMPLATE_ID
          })
        } catch (err) {
          // 单用户发送失败不中断整体流程
          console.warn('[notify] send fail for', member._openid, err.message)
        }
      }

      // 标记已发送
      await db.collection('notification_pending').doc(record._id).update({
        data: { sent: true }
      })
    }

    return { success: true, checked: pendingList.length }
  } catch (err) {
    console.error('[notify] main error:', err.message)
    return { error: err.message }
  }
}
