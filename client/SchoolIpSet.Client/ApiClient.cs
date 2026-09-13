using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace SchoolIpSet.Client
{
    internal sealed class ApiClient : IDisposable
    {
        private readonly HttpClient client;
        private string serverPublicKeyJwk;

        public ApiClient()
        {
            client = new HttpClient { BaseAddress = new Uri(ServerSettings.ApiBaseUrl), Timeout = TimeSpan.FromSeconds(20) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("IP-Sentinel-Client/" + ServerSettings.ClientVersion);
        }

        public Task<Dictionary<string, object>> RegisterRawAsync(DeviceState state, string name) =>
            PostEncryptedAsync<Dictionary<string, object>>("v1/device/register", state.PrivateKeyXml, new Dictionary<string, object>
            {
                { "name", name },
                { "deviceKey", state.DeviceKey },
                { "publicKey", state.PublicKeyJwk },
                { "hostname", Environment.MachineName },
                { "clientVersion", ServerSettings.ClientVersion },
            });

        public Task<Dictionary<string, object>> HeartbeatAsync(DeviceState state, NetworkSnapshot network, string clientStatus = "normal", Dictionary<string, object> verification = null)
        {
            var payload = new Dictionary<string, object>
            {
                { "deviceKey", state.DeviceKey },
                { "token", state.Token },
                { "hostname", Environment.MachineName },
                { "clientVersion", ServerSettings.ClientVersion },
                { "mac", network?.Mac },
                { "interfaceName", network?.InterfaceName },
                { "ip", network?.Ip },
                { "prefix", network?.Prefix },
                { "gateway", network?.Gateway },
                { "dns", network?.Dns ?? new List<string>() },
                { "idempotencyKey", Guid.NewGuid().ToString("N") },
                { "source", "client" },
                { "clientStatus", clientStatus },
            };
            if (verification != null) payload["verification"] = verification;
            return PostEncryptedAsync<Dictionary<string, object>>("v1/heartbeat", state.PrivateKeyXml, payload);
        }

        public Task<Dictionary<string, object>> RequestChangeAsync(DeviceState state)
        {
            return PostEncryptedAsync<Dictionary<string, object>>("v1/change-requests", state.PrivateKeyXml, new Dictionary<string, object>
            {
                { "deviceKey", state.DeviceKey },
                { "token", state.Token },
                { "idempotencyKey", Guid.NewGuid().ToString("N") },
            });
        }

        public Task<Dictionary<string, object>> ReportChangeAsync(DeviceState state, int requestId, string changeToken, ChangeExecutionResult result)
        {
            var payload = new Dictionary<string, object>
            {
                { "deviceKey", state.DeviceKey },
                { "token", state.Token },
                { "changeToken", changeToken },
                { "status", result.Status },
                { "previousConfig", ToConfigPayload(result.PreviousConfig) },
                { "finalConfig", ToConfigPayload(result.FinalConfig) },
                { "verification", result.Verification },
            };
            return PostEncryptedAsync<Dictionary<string, object>>($"v1/change-requests/{requestId}/result", state.PrivateKeyXml, payload);
        }

        private async Task<T> PostEncryptedAsync<T>(string path, string privateXml, object payload)
        {
            var body = ClientCrypto.Encrypt(payload, await GetServerPublicKeyAsync().ConfigureAwait(false));
            using (var content = new StringContent(body, Encoding.UTF8, "application/json"))
            using (var response = await client.PostAsync(path, content).ConfigureAwait(false))
            {
                var responseText = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                {
                    try
                    {
                        var error = Json.Deserialize<Dictionary<string, object>>(responseText);
                        throw new InvalidOperationException(error.ContainsKey("message") ? StringFrom(error["message"]) : "服务端请求失败");
                    }
                    catch (InvalidOperationException) { throw; }
                    catch { throw new InvalidOperationException("服务端请求失败 (" + (int)response.StatusCode + ")"); }
                }
                var plain = ClientCrypto.DecryptResponse(responseText, privateXml);
                return Json.Deserialize<T>(plain);
            }
        }

        private static string StringFrom(object value) => value == null ? "" : System.Convert.ToString(value);

        private static Dictionary<string, object> ToConfigPayload(NetworkSnapshot snapshot)
        {
            if (snapshot == null) return null;
            return new Dictionary<string, object>
            {
                { "interfaceName", snapshot.InterfaceName },
                { "ip", snapshot.Ip },
                { "prefix", snapshot.Prefix },
                { "mask", snapshot.Mask },
                { "gateway", snapshot.Gateway },
                { "dns", snapshot.Dns },
                { "mac", snapshot.Mac },
            };
        }

        private async Task<string> GetServerPublicKeyAsync()
        {
            if (!String.IsNullOrWhiteSpace(serverPublicKeyJwk)) return serverPublicKeyJwk;
            if (!String.IsNullOrWhiteSpace(ServerSettings.ServerPublicKeyJwk) && !ServerSettings.ServerPublicKeyJwk.StartsWith("__"))
            {
                serverPublicKeyJwk = ServerSettings.ServerPublicKeyJwk;
                return serverPublicKeyJwk;
            }
            using (var response = await client.GetAsync("v1/device/server-key").ConfigureAwait(false))
            {
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("服务端加密公钥不可用");
                var json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                var values = Json.Deserialize<Dictionary<string, object>>(json);
                serverPublicKeyJwk = Json.Serialize(values["publicKey"]);
                return serverPublicKeyJwk;
            }
        }

        public void Dispose() => client.Dispose();
    }
}
