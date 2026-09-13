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

        public ApiClient()
        {
            client = new HttpClient { BaseAddress = new Uri(ServerSettings.ApiBaseUrl), Timeout = TimeSpan.FromSeconds(20) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("IP-Sentinel-Client/" + ServerSettings.ClientVersion);
        }

        public Task<Dictionary<string, object>> RegisterRawAsync(DeviceState state, string name) =>
            PostAsync<Dictionary<string, object>>("v1/device/register", new Dictionary<string, object>
            {
                { "name", name },
                { "deviceKey", state.DeviceKey },
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
            return PostAsync<Dictionary<string, object>>("v1/heartbeat", payload);
        }

        public Task<Dictionary<string, object>> RequestChangeAsync(DeviceState state)
        {
            return PostAsync<Dictionary<string, object>>("v1/change-requests", new Dictionary<string, object>
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
            return PostAsync<Dictionary<string, object>>($"v1/change-requests/{requestId}/result", payload);
        }

        private async Task<T> PostAsync<T>(string path, object payload)
        {
            var body = Json.Serialize(payload);
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
                return Json.Deserialize<T>(responseText);
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

        public void Dispose() => client.Dispose();
    }
}
