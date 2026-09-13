using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

namespace SchoolIpSet.Client
{
    internal sealed class MonitorController : IDisposable
    {
        private readonly ApiClient api = new ApiClient();
        private readonly SemaphoreSlim checkLock = new SemaphoreSlim(1, 1);
        private readonly Timer timer;
        private DeviceState state;
        private string lastMismatchKey;
        private bool disposed;

        public event Action<NetworkSnapshot, TargetConfiguration> MismatchDetected;
        public event Action<string> Message;
        public event Action<string, NetworkSnapshot> StatusChanged;
        public event Action<ChangeProgress> ProgressChanged;

        public MonitorController()
        {
            state = LocalState.Load();
            timer = new Timer(async _ => await SafeCheckAsync().ConfigureAwait(false), null, Timeout.Infinite, Timeout.Infinite);
            NetworkChange.NetworkAddressChanged += NetworkAddressChanged;
            SystemEvents.PowerModeChanged += PowerModeChanged;
        }

        public DeviceState State => state;
        public bool NeedsRegistration => String.IsNullOrWhiteSpace(state.Name) || String.IsNullOrWhiteSpace(state.Token);

        public void Start()
        {
            if (NeedsRegistration) return;
            timer.Change(TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(60));
            _ = SafeCheckAsync();
        }

        public async Task RegisterAsync(string name)
        {
            if (String.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("请输入姓名");
            if (String.IsNullOrWhiteSpace(state.DeviceKey))
            {
                state.DeviceKey = Guid.NewGuid().ToString("N");
                LocalState.Save(state);
            }
            var response = await api.RegisterRawAsync(state, name.Trim(), NetworkProbe.GetActive()).ConfigureAwait(false);
            state.Name = name.Trim();
            state.Token = StringValue(response, "token");
            state.DeviceId = IntValue(response, "deviceId");
            state.LastRegisteredAt = DateTime.UtcNow;
            LocalState.Save(state);
            timer.Change(TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(60));
            Message?.Invoke("设备已绑定，开始监测当前网卡");
            await CheckAsync().ConfigureAwait(false);
        }

        public async Task CheckAsync()
        {
            if (disposed || NeedsRegistration) return;
            if (!await checkLock.WaitAsync(0).ConfigureAwait(false)) return;
            try
            {
                await CheckCoreAsync().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                StatusChanged?.Invoke("offline", null);
                Message?.Invoke("暂时无法连接后台：" + error.Message);
            }
            finally { checkLock.Release(); }
        }

        private async Task CheckCoreAsync()
        {
            var network = NetworkProbe.GetActive();
            var response = await api.HeartbeatAsync(state, network).ConfigureAwait(false);
            var result = StringValue(response, "result");
            var assignment = ReadAssignment(response.ContainsKey("assignment") ? response["assignment"] : null);
            StatusChanged?.Invoke(result, network);
            if (assignment != null && result != "compliant")
            {
                var mismatchKey = String.Join("|", network?.Ip, assignment.ip, result);
                if (!String.Equals(lastMismatchKey, mismatchKey, StringComparison.Ordinal))
                {
                    lastMismatchKey = mismatchKey;
                    MismatchDetected?.Invoke(network, assignment);
                }
            }
            else if (result == "compliant")
            {
                lastMismatchKey = null;
            }
        }

        public async Task AcceptAndApplyAsync()
        {
            if (NeedsRegistration) return;
            await checkLock.WaitAsync().ConfigureAwait(false);
            try
            {
            Message?.Invoke("正在向后台获取修改任务…");
            var response = await api.RequestChangeAsync(state).ConfigureAwait(false);
            var pending = new PendingChange
            {
                RequestId = IntValue(response, "requestId"),
                ChangeToken = StringValue(response, "changeToken"),
                Target = ReadAssignment(response.ContainsKey("assignment") ? response["assignment"] : null),
                DeviceKey = state.DeviceKey,
                DeviceToken = state.Token,
            };
            if (pending.RequestId < 1 || String.IsNullOrWhiteSpace(pending.ChangeToken) || pending.Target == null)
                throw new InvalidOperationException("后台返回的修改任务不完整");
            LocalState.ClearChangeFiles();
            LocalState.SavePending(pending);
            Message?.Invoke("已获得修改任务，正在使用管理员权限配置网卡并验证网络…");
            await Task.Run(() => ChangeWorker.Run(progress => ProgressChanged?.Invoke(progress))).ConfigureAwait(false);
            var result = LocalState.LoadResult();
            if (result == null) throw new InvalidOperationException("没有读取到网络修改结果");
            var detail = result.Status == "success" ? "网络配置已修改并通过验证" : "修改失败：" + result.Error;
            try { await api.ReportChangeAsync(state, pending.RequestId, pending.ChangeToken, result).ConfigureAwait(false); }
            catch (Exception error) { throw new InvalidOperationException(detail + "；结果上报失败（本地结果已保留）：" + error.Message); }
            LocalState.ClearChangeFiles();
            if (result.Status == "success")
            {
                // The change-result event records the operation immediately. A final heartbeat
                // refreshes the actual post-change IP and makes the admin list update at once.
                try { await CheckCoreAsync().ConfigureAwait(false); } catch (Exception error) { Message?.Invoke("配置已成功，但刷新后台状态失败：" + error.Message); }
                Message?.Invoke("网络配置已修改并通过连通性验证");
            }
            else
                throw new InvalidOperationException(detail + (result.Status == "rollback_failed" ? "；回滚失败，需要管理员处理。" : "；请检查目标配置和网络验证结果。"));
            }
            finally { checkLock.Release(); }
        }

        public async Task DeclineAsync()
        {
            Message?.Invoke("已记录为不修改，后台会继续标记当前异常");
            await CheckAsync().ConfigureAwait(false);
        }

        private async Task SafeCheckAsync()
        {
            try { await CheckAsync().ConfigureAwait(false); } catch { }
        }

        private void NetworkAddressChanged(object sender, EventArgs e) => _ = SafeCheckAsync();

        private void PowerModeChanged(object sender, PowerModeChangedEventArgs e)
        {
            if (e.Mode == PowerModes.Resume) _ = SafeCheckAsync();
        }

        private static TargetConfiguration ReadAssignment(object value)
        {
            if (value == null) return null;
            return Json.Deserialize<TargetConfiguration>(Json.Serialize(value));
        }

        private static string StringValue(Dictionary<string, object> dictionary, string key) => dictionary.ContainsKey(key) && dictionary[key] != null ? Convert.ToString(dictionary[key]) : "";
        private static int IntValue(Dictionary<string, object> dictionary, string key) => Int32.TryParse(StringValue(dictionary, key), out var value) ? value : 0;

        private static string QuoteArgument(string value) => "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            timer.Dispose();
            NetworkChange.NetworkAddressChanged -= NetworkAddressChanged;
            SystemEvents.PowerModeChanged -= PowerModeChanged;
            api.Dispose();
            checkLock.Dispose();
        }
    }
}
