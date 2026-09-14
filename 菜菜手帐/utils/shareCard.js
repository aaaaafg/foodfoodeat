// 苹果风分享卡片生成器（canvas 2d）
// 输出 500×400（5:4）图片：头像、昵称、日期、分组名、菜品+备注、品牌尾注
// 用法：shareCard.buildShareCard(page, data) -> Promise<tempFilePath>
//   data: { nickName, avatarUrl, spaceName, spaceIcon, dateText, weekdayText, items: [{name, note}] }

const CARD_W = 500
const CARD_H = 400

function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

// 圆角矩形路径
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 绘制圆形头像；无头像时画首字圆形占位。返回 Promise（图片异步加载）
function drawAvatar(canvasNode, ctx, data, x, y, r) {
  return new Promise((resolve) => {
    const char = (data.nickName || '我').charAt(0) || '👤'
    const fallback = () => {
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#007aff'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 ' + Math.round(r) + 'px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(char, x, y + 1)
      ctx.restore()
      resolve()
    }
    if (!data.avatarUrl) {
      fallback()
      return
    }
    const img = canvasNode.createImage()
    img.onload = () => {
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.clip()
      try {
        ctx.drawImage(img, x - r, y - r, r * 2, r * 2)
      } catch (e) {
        fallback()
        return
      }
      ctx.restore()
      resolve()
    }
    img.onerror = fallback
    img.src = data.avatarUrl
  })
}

function drawBase(ctx, data) {
  // 背景（浅灰，苹果官网风）
  ctx.fillStyle = '#f5f5f7'
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // 白色主卡片
  roundRect(ctx, 24, 22, CARD_W - 48, CARD_H - 44, 24)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
}

function drawHeader(ctx, data) {
  // 昵称
  ctx.fillStyle = '#1c1c1e'
  ctx.font = '600 20px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(truncate(data.nickName || '我', 8) + ' 的今日菜单', 118, 72)

  // 分组 + 日期 + 星期
  ctx.fillStyle = '#8e8e93'
  ctx.font = '12px sans-serif'
  const sub = `${data.spaceIcon || '🏠'} ${truncate(data.spaceName || '我的菜单', 10)} · ${data.dateText || ''} ${data.weekdayText || ''}`
  ctx.fillText(truncate(sub, 40), 118, 94)

  // 分割线
  ctx.strokeStyle = '#e5e5ea'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(56, 118)
  ctx.lineTo(CARD_W - 56, 118)
  ctx.stroke()
}

function drawDishes(ctx, data) {
  const items = data.items || []
  if (items.length === 0) {
    ctx.fillStyle = '#1c1c1e'
    ctx.font = '600 17px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('🍽️ 今天还没点菜', CARD_W / 2, 210)
    ctx.fillStyle = '#aeaeb2'
    ctx.font = '13px sans-serif'
    ctx.fillText('点「添加菜品」开始记录吧', CARD_W / 2, 238)
    return
  }

  const MAX_SHOW = 5
  const LINE_H = 40
  const startY = 148
  const shown = items.slice(0, MAX_SHOW)

  shown.forEach((it, idx) => {
    const y = startY + idx * LINE_H
    // 序号
    ctx.fillStyle = '#007aff'
    ctx.font = '600 12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(idx + 1), 66, y + 2)
    // 菜名
    ctx.fillStyle = '#1c1c1e'
    ctx.font = '600 17px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(truncate(it.name || '', 10), 88, y + 2)
    // 备注
    if (it.note) {
      ctx.fillStyle = '#8e8e93'
      ctx.font = '13px sans-serif'
      ctx.fillText(truncate(it.note, 24), 88, y + 24)
    }
  })

  // 超出提示
  if (items.length > MAX_SHOW) {
    ctx.fillStyle = '#aeaeb2'
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`还有 ${items.length - MAX_SHOW} 道菜…`, 88, startY + MAX_SHOW * LINE_H + 12)
  }
}

function drawFooter(ctx) {
  ctx.fillStyle = '#aeaeb2'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('菜菜手帐 · 好好吃饭，好好生活 ❤️', CARD_W / 2, CARD_H - 34)
}

function buildShareCard(page, data) {
  return new Promise((resolve, reject) => {
    page.createSelectorQuery()
      .select('#shareCardCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0]
        if (!info || !info.node) {
          reject(new Error('canvas not found'))
          return
        }
        const canvasNode = info.node
        // 固定 2 倍分辨率：保证文字清晰，又不会因高倍屏占用过多内存
        const dpr = 2
        canvasNode.width = CARD_W * dpr
        canvasNode.height = CARD_H * dpr
        const ctx = canvasNode.getContext('2d')
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, CARD_W, CARD_H)

        drawBase(ctx, data)
        drawHeader(ctx, data)
        drawDishes(ctx, data)
        drawFooter(ctx)
        drawAvatar(canvasNode, ctx, data, 78, 66, 27).then(() => {
          wx.canvasToTempFilePath({
            canvas: canvasNode,
            destWidth: CARD_W,
            destHeight: CARD_H,
            success: (r) => resolve(r.tempFilePath),
            fail: (err) => reject(err)
          })
        })
      })
  })
}

module.exports = { buildShareCard }
