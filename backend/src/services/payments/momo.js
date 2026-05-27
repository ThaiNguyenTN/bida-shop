import crypto from 'crypto';
import { env } from '../../lib/env.js';

function sign(raw) {
  return crypto.createHmac('sha256', env.momo.secretKey).update(raw).digest('hex');
}

export function buildMomoSignature(payload) {
  const raw = [
    `accessKey=${env.momo.accessKey}`,
    `amount=${payload.amount}`,
    `extraData=${payload.extraData || ''}`,
    `ipnUrl=${payload.ipnUrl}`,
    `orderId=${payload.orderId}`,
    `orderInfo=${payload.orderInfo}`,
    `partnerCode=${payload.partnerCode}`,
    `redirectUrl=${payload.redirectUrl}`,
    `requestId=${payload.requestId}`,
    `requestType=${payload.requestType}`
  ].join('&');
  return sign(raw);
}

export function verifyMomoResult(payload) {
  const raw = [
    `accessKey=${env.momo.accessKey}`,
    `amount=${payload.amount}`,
    `extraData=${payload.extraData || ''}`,
    `message=${payload.message}`,
    `orderId=${payload.orderId}`,
    `orderInfo=${payload.orderInfo}`,
    `orderType=${payload.orderType}`,
    `partnerCode=${payload.partnerCode}`,
    `payType=${payload.payType}`,
    `requestId=${payload.requestId}`,
    `responseTime=${payload.responseTime}`,
    `resultCode=${payload.resultCode}`,
    `transId=${payload.transId}`
  ].join('&');
  return sign(raw) === payload.signature;
}

export async function createMomoPayment({ orderCode, amount, orderInfo, items = [] }) {
  if (!env.momo.partnerCode || !env.momo.accessKey || !env.momo.secretKey || !env.momo.redirectUrl || !env.momo.ipnUrl) {
    throw new Error('MoMo environment variables are not configured');
  }

  const requestId = crypto.randomUUID();
  const payload = {
    partnerCode: env.momo.partnerCode,
    accessKey: env.momo.accessKey,
    requestId,
    amount: String(amount),
    orderId: orderCode,
    orderInfo,
    redirectUrl: env.momo.redirectUrl,
    ipnUrl: env.momo.ipnUrl,
    requestType: 'captureWallet',
    extraData: '',
    lang: 'vi',
    items,
    autoCapture: true
  };

  payload.signature = buildMomoSignature(payload);

  const response = await fetch(`${env.momo.endpoint}/v2/gateway/api/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok || result.resultCode !== 0) {
    throw new Error(result.message || 'MoMo create payment failed');
  }

  return { requestId, result };
}
