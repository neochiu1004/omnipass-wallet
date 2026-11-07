import { generateId, normalizeDateInput, findTitleAutoTemplate, ticketUsesTemplateImage, deriveTicketDescription } from '../utils.js';
import { renderQrCanvas } from './barcodeService.js';

const batchTemplateImage = new URL('../../assets/batch-ticket-template.png', import.meta.url).href;

const BATCH_TAG = '批量生成';
export const BATCH_IMAGE_VERSION = 5;
const BASE_WIDTH = 944;
const BASE_HEIGHT = 2048;

export function validateBatchRows(data) {
  if (!Array.isArray(data)) return { success: false, error: '批量資料必須是 JSON 陣列' };
  const errors = [];
  const rows = data.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`第 ${index + 1} 筆不是物件`);
      return null;
    }
    const ticketNumber = typeof item.ticketNumber === 'string' ? item.ticketNumber.trim() : '';
    const productName = typeof item.productName === 'string' ? item.productName.trim() : '';
    const expiryDate = item.expiryDate == null ? '' : String(item.expiryDate).trim();
    const buyer = typeof item.buyer === 'string' ? item.buyer.trim() : '';
    if (!ticketNumber) errors.push(`第 ${index + 1} 筆缺少 ticketNumber`);
    if (!productName) errors.push(`第 ${index + 1} 筆缺少 productName`);
    return { ticketNumber, productName, expiryDate, buyer };
  }).filter(Boolean);

  if (errors.length) {
    return { success: false, error: errors.slice(0, 8).join('；') + (errors.length > 8 ? '；其餘錯誤略' : '') };
  }
  return { success: true, data: rows };
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('無法載入版型圖片'));
  image.src = src;
});

const drawContain = (ctx, image, x, y, width, height) => {
  const ratio = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
};

const fitFontSize = (ctx, text, maxWidth, initial) => {
  let size = initial;
  while (size > 16) {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
};

export async function renderBatchTicketImage(source = batchTemplateImage, name, serial, expiry, productImage = '') {
  const image = await loadImage(source);
  const scaleX = image.width / BASE_WIDTH;
  const scaleY = image.height / BASE_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援圖片產生');
  ctx.drawImage(image, 0, 0);
  ctx.save();
  ctx.scale(scaleX, scaleY);

  ctx.fillStyle = '#fff';
  ctx.fillRect(120, 805, 704, 105);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#222';
  ctx.font = `700 ${fitFontSize(ctx, name, 680, 38)}px Arial, sans-serif`;
  ctx.fillText(name, 472, 855, 680);

  ctx.fillStyle = '#fff';
  ctx.fillRect(300, 910, 344, 275);
  const qrCanvas = document.createElement('canvas');
  await renderQrCanvas(qrCanvas, serial, 245);
  ctx.drawImage(qrCanvas, 349, 920, 245, 245);

  ctx.fillStyle = '#fff';
  ctx.fillRect(180, 1190, 584, 82);
  ctx.fillStyle = '#333';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillText(`序號：${serial}`, 472, 1232, 570);

  if (productImage) {
    const customProductImage = await loadImage(productImage);
    ctx.fillStyle = '#fff';
    ctx.fillRect(100, 370, 750, 440);
    drawContain(ctx, customProductImage, 145, 410, 654, 360);
  }

  // 商品描述列是底圖截圖的固定文字（35元飲品任選一），依本票品名重繪，
  // 避免 50 元票券卻顯示 35 元描述。
  const description = deriveTicketDescription(name);
  if (description) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(215, 1320, 620, 66);
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '32px Arial, sans-serif';
    ctx.fillText(description, 229, 1353, 590);
  }

  ctx.fillStyle = '#fff';
  ctx.fillRect(190, 1400, 560, 150);
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  ctx.font = '700 34px Arial, sans-serif';
  const expiryText = normalizeDateInput(expiry || '').replace(/\//g, '.') || '無期限';
  ctx.fillText(expiryText, 225, 1490, 500);
  ctx.restore();
  return canvas.toDataURL('image/webp', 0.92);
}

export async function buildBatchTickets(rows, existingTickets = [], defaultRedeemUrl = '') {
  const existingSerials = new Set(existingTickets.filter((ticket) => !ticket.isDeleted && ticket.serial).map((ticket) => ticket.serial));
  const seen = new Set();
  let duplicates = 0;
  const tickets = [];
  for (const row of rows) {
    if (existingSerials.has(row.ticketNumber) || seen.has(row.ticketNumber)) duplicates += 1;
    seen.add(row.ticketNumber);
    const image = await renderBatchTicketImage(batchTemplateImage, row.productName, row.ticketNumber, row.expiryDate);
    tickets.push({
      id: generateId(),
      productName: row.productName,
      serial: row.ticketNumber,
      expiry: normalizeDateInput(row.expiryDate || ''),
      image,
      originalImage: batchTemplateImage,
      images: [image],
      batchProductImage: '',
      batchImageVersion: BATCH_IMAGE_VERSION,
      tags: [BATCH_TAG, ...(row.buyer ? [row.buyer] : [])],
      barcodeFormat: 'QR_CODE',
      redeemUrl: defaultRedeemUrl || '',
      completed: false,
      isDeleted: false,
      createdAt: Date.now(),
    });
  }
  return { tickets, duplicates };
}

export async function refreshBatchTicketImages(tasks) {
  let changed = false;
  const refreshedTasks = await Promise.all(tasks.map(async (ticket) => {
    if (ticket.isDeleted || !(ticket.tags || []).includes(BATCH_TAG) || !ticket.serial || ticket.batchImageVersion === BATCH_IMAGE_VERSION) {
      return ticket;
    }
    try {
      const image = await renderBatchTicketImage(undefined, ticket.productName || '', ticket.serial, ticket.expiry || '', ticket.batchProductImage || '');
      changed = true;
      return { ...ticket, image, images: [image], batchImageVersion: BATCH_IMAGE_VERSION };
    } catch (_error) {
      return ticket;
    }
  }));
  return { tasks: refreshedTasks, changed };
}

export async function personalizeBorrowedTemplateImages(tasks, templates, defaultTemplateId) {
  const template = findTitleAutoTemplate(templates || [], defaultTemplateId);
  if (!template?.originalImage) return { tasks, changed: 0 };
  let changed = 0;
  const next = await Promise.all((tasks || []).map(async (ticket) => {
    if (!ticketUsesTemplateImage(ticket, template.originalImage)) return ticket;
    try {
      const image = await renderBatchTicketImage(undefined, ticket.productName || '', ticket.serial, ticket.expiry || '', '');
      changed += 1;
      return { ...ticket, originalImage: image, originalImageGenerated: true };
    } catch (_error) {
      return ticket;
    }
  }));
  return { tasks: next, changed };
}

export async function refreshGeneratedTicketImages(tasks) {
  let changed = 0;
  const next = await Promise.all((tasks || []).map(async (ticket) => {
    if (ticket.isDeleted || !ticket.serial || !ticket.originalImageGenerated) return ticket;
    if ((ticket.tags || []).includes(BATCH_TAG)) return ticket;
    if (ticket.generatedImageVersion === BATCH_IMAGE_VERSION) return ticket;
    try {
      const image = await renderBatchTicketImage(undefined, ticket.productName || '', ticket.serial, ticket.expiry || '', '');
      changed += 1;
      return { ...ticket, originalImage: image, generatedImageVersion: BATCH_IMAGE_VERSION };
    } catch (_error) {
      return ticket;
    }
  }));
  return { tasks: next, changed };
}

