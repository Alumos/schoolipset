using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace SchoolIpSet.Client
{
    internal static class ClientCrypto
    {
        public sealed class Envelope
        {
            public int v { get; set; }
            public string keyId { get; set; }
            public string oaep { get; set; }
            public string encryptedKey { get; set; }
            public string iv { get; set; }
            public string ciphertext { get; set; }
            public string tag { get; set; }
        }

        public static string CreateDeviceKey(out string privateXml)
        {
            using (var rsa = new RSACryptoServiceProvider(2048))
            {
                rsa.PersistKeyInCsp = false;
                privateXml = rsa.ToXmlString(true);
                return ToPublicJwk(rsa.ExportParameters(false));
            }
        }

        public static string Encrypt(object payload, string serverPublicKeyJwk, string keyId = "default")
        {
            if (string.IsNullOrWhiteSpace(serverPublicKeyJwk) || serverPublicKeyJwk.StartsWith("__"))
                throw new InvalidOperationException("客户端未内置服务端加密公钥，请使用已配置密钥的发布包");
            var aesKey = RandomBytes(32);
            var iv = RandomBytes(16);
            byte[] ciphertext;
            using (var aes = Aes.Create())
            {
                aes.Key = aesKey;
                aes.IV = iv;
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                using (var stream = new MemoryStream())
                using (var crypto = new CryptoStream(stream, aes.CreateEncryptor(), CryptoStreamMode.Write))
                {
                    var plain = Encoding.UTF8.GetBytes(Json.Serialize(payload));
                    crypto.Write(plain, 0, plain.Length);
                    crypto.FlushFinalBlock();
                    ciphertext = stream.ToArray();
                }
            }
            byte[] encryptedKey;
            using (var rsa = CreateRsaFromJwk(serverPublicKeyJwk))
            {
                encryptedKey = rsa.Encrypt(aesKey, RSAEncryptionPadding.OaepSHA256);
            }
            var envelope = new Envelope
            {
                v = 1,
                keyId = keyId,
                oaep = "sha256",
                encryptedKey = Convert.ToBase64String(encryptedKey),
                iv = Convert.ToBase64String(iv),
                ciphertext = Convert.ToBase64String(ciphertext),
            };
            envelope.tag = Convert.ToBase64String(Hmac(aesKey, Canonical(envelope)));
            return Json.Serialize(new Dictionary<string, object> { { "envelope", envelope } });
        }

        public static string DecryptResponse(string responseJson, string privateXml)
        {
            var root = Json.DeserializeObject(responseJson);
            if (root == null) throw new InvalidOperationException("服务端响应不是 JSON 对象");
            if (!root.ContainsKey("envelope")) return responseJson;
            var envelope = Json.Deserialize<Envelope>(Json.Serialize(root["envelope"]));
            var aesKey = DecryptRsa(Convert.FromBase64String(envelope.encryptedKey), privateXml);
            var expected = Hmac(aesKey, Canonical(envelope));
            var actual = Convert.FromBase64String(envelope.tag);
            if (!FixedEquals(expected, actual)) throw new CryptographicException("服务端响应签名校验失败");
            byte[] plaintext;
            using (var aes = Aes.Create())
            {
                aes.Key = aesKey;
                aes.IV = Convert.FromBase64String(envelope.iv);
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                using (var input = new MemoryStream(Convert.FromBase64String(envelope.ciphertext)))
                using (var crypto = new CryptoStream(input, aes.CreateDecryptor(), CryptoStreamMode.Read))
                using (var output = new MemoryStream())
                {
                    crypto.CopyTo(output);
                    plaintext = output.ToArray();
                }
            }
            return Encoding.UTF8.GetString(plaintext);
        }

        private static string Canonical(Envelope envelope) =>
            string.Join(".", envelope.v, envelope.keyId, envelope.iv, envelope.ciphertext);

        private static byte[] Hmac(byte[] key, string value)
        {
            using (var hmac = new HMACSHA256(key)) return hmac.ComputeHash(Encoding.UTF8.GetBytes(value));
        }

        private static byte[] DecryptRsa(byte[] encrypted, string privateXml)
        {
            using (var rsa = new RSACng())
            {
                using (var source = new RSACryptoServiceProvider())
                {
                    source.FromXmlString(privateXml);
                    rsa.ImportParameters(source.ExportParameters(true));
                }
                return rsa.Decrypt(encrypted, RSAEncryptionPadding.OaepSHA256);
            }
        }

        private static RSACng CreateRsaFromJwk(string json)
        {
            var values = Json.Deserialize<Dictionary<string, object>>(json);
            var rsa = new RSACng();
            rsa.ImportParameters(new RSAParameters
            {
                Modulus = FromBase64Url((string)values["n"]),
                Exponent = FromBase64Url((string)values["e"]),
            });
            return rsa;
        }

        private static string ToPublicJwk(RSAParameters parameters) => Json.Serialize(new Dictionary<string, object>
        {
            { "kty", "RSA" },
            { "n", ToBase64Url(parameters.Modulus) },
            { "e", ToBase64Url(parameters.Exponent) },
        });

        private static string ToBase64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private static byte[] FromBase64Url(string value)
        {
            var base64 = value.Replace('-', '+').Replace('_', '/');
            while (base64.Length % 4 != 0) base64 += "=";
            return Convert.FromBase64String(base64);
        }

        private static byte[] RandomBytes(int length)
        {
            var result = new byte[length];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(result);
            return result;
        }

        private static bool FixedEquals(byte[] left, byte[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            var value = 0;
            for (var index = 0; index < left.Length; index++) value |= left[index] ^ right[index];
            return value == 0;
        }
    }
}
