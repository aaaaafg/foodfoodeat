const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  try {
    const { action, spaceId, date, items, docId, spaceName } = event

    if (!spaceId) return { error: 'missing spaceId' }

    if (action === 'load') {
      const res = await db.collection('menus')
        .where({ spaceId, date })
        .get()
      if (res.data.length > 0) {
        const doc = res.data[0]
        if (res.data.length > 1) {
          const merged = new Map()
          res.data.forEach(d => d.items.forEach(i => merged.set(i.id, i)))
          const allItems = [...merged.values()]
          const keepId = doc._id
          const delIds = res.data.slice(1).map(d => d._id)
          await Promise.all(delIds.map(id => db.collection('menus').doc(id).remove()))
          await db.collection('menus').doc(keepId).update({
            data: { items: allItems, updatedAt: Date.now() }
          })
          return { doc: { ...doc, items: allItems }, docId: keepId }
        }
        return { doc, docId: doc._id }
      }
      return { doc: null, docId: null }
    }

    if (action === 'save') {
      const saveData = { spaceId, spaceName: spaceName || '', date, items, updatedAt: Date.now() }
      if (docId) {
        await db.collection('menus').doc(docId).update({ data: saveData })
        return { success: true, docId }
      }
      const existing = await db.collection('menus').where({ spaceId, date }).get()
      if (existing.data.length > 0) {
        const doc = existing.data[0]
        const merged = new Map()
        doc.items.forEach(i => merged.set(i.id, i))
        items.forEach(i => merged.set(i.id, i))
        const allItems = [...merged.values()]
        await db.collection('menus').doc(doc._id).update({
          data: { ...saveData, items: allItems }
        })
        if (existing.data.length > 1) {
          const delIds = existing.data.slice(1).map(d => d._id)
          await Promise.all(delIds.map(id => db.collection('menus').doc(id).remove()))
        }
        return { success: true, docId: doc._id }
      }
      const res = await db.collection('menus').add({ data: saveData })
      return { success: true, docId: res._id }
    }

    if (action === 'history') {
      // 服务端单次最多 1000 条，循环取完
      const all = []
      let skip = 0
      while (true) {
        const res = await db.collection('menus')
          .where({ spaceId })
          .skip(skip)
          .limit(1000)
          .get()
        all.push(...res.data)
        if (res.data.length < 1000) break
        skip += 1000
      }
      return { list: all }
    }

    if (action === 'clearHistory') {
      const { target, clearDate } = event
      const today = event.today
      // 循环分批删除，避免单次查询上限导致漏删
      while (true) {
        const query = target === 'all'
          ? db.collection('menus').where({ spaceId, date: db.command.neq(today) })
          : db.collection('menus').where({ spaceId, date: clearDate })
        const res = await query.limit(100).get()
        if (res.data.length === 0) break
        await Promise.all(res.data.map(d => db.collection('menus').doc(d._id).remove()))
        if (res.data.length < 100) break
      }
      return { success: true }
    }

    return { error: 'unknown action: ' + action }
  } catch (err) {
    return { error: err.message || String(err) }
  }
}
