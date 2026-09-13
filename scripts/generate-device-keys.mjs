import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { format: 'jwk' },
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
});

console.log('DEVICE_SERVER_PUBLIC_KEY_JWK=');
console.log(JSON.stringify(publicKey));
console.log('\nDEVICE_SERVER_PRIVATE_KEY=');
console.log(privateKey.replace(/\n/g, '\\n'));
console.log('\n请将私钥只保存到 VPS/GitHub Secret，不要提交到 Git。');
