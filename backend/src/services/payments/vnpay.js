import crypto from 'crypto';
import { env } from '../../lib/env.js';

function hmac(data) {
  return crypto.createHmac('sha512', env.vnpay.hashSecret).update(Buffer.from(data, 'utf-8')).digest('hex');
}

function sortAndEncode(payload) {
  const sorted = Object.keys(payload)
    .sort()
    .reduce((acc, key) => {
      if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
        acc[key] = payload[key];
      }
      return acc;
    }, {});

  const query = new URLSearchParams();
  let hashData = '';
  let first = true;

  for (const [key, value] of Object.entries(sorted)) {
    const encodedKey = encodeURIComponent(key);
    const encodedValue = encodeURIComponent(String(value)).replace(/%20/g, '+');
    query.append(key, String(value));
    hashData += `${first ? '' : '&'}${encodedKey}=${encodedValue}`;
    first = false;
  }

  return { query: query.toString(), hashData, sorted };
}

export function createPaymentUrl({ orderCode, amount, ipAddr = '127.0.0.1', orderInfo = 'Thanh toan don hang', bankCode = '', returnUrl = env.vnpay.returnUrl }) {
  if (!env.vnpay.tmnCode || !env.vnpay.hashSecret || !returnUrl) {
    throw new Error('VNPay environment variables are not configured');
  }

  const now = new Date();
  const createDate = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const payload = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: env.vnpay.tmnCode,
    vnp_Amount: Number(amount) * 100,
    vnp_CurrCode: 'VND',
    vnp_TxnRef: orderCode,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: createDate,
    vnp_BankCode: bankCode || undefined
  };

  const { query, hashData } = sortAndEncode(payload);
  const secureHash = hmac(hashData);
  return `${env.vnpay.paymentUrl}?${query}&vnp_SecureHash=${secureHash}`;
}

export function verifyVnpayPayload(params) {
  const clone = { ...params };
  const receivedHash = clone.vnp_SecureHash;
  delete clone.vnp_SecureHash;
  delete clone.vnp_SecureHashType;
  const { hashData } = sortAndEncode(clone);
  const expectedHash = hmac(hashData);
  return expectedHash === receivedHash;
}
