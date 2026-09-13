using System;
using System.Diagnostics;
using System.Linq;
using System.Text;

namespace SchoolIpSet.Client
{
    internal static class NetworkConfigurator
    {
        public static ChangeExecutionResult ApplyAndVerify(TargetConfiguration target)
        {
            var previous = NetworkProbe.GetActive(target.interfaceHint);
            if (previous == null)
            {
                return new ChangeExecutionResult { Status = "verification_failed_rolled_back", Error = "未找到可修改的活动网卡" };
            }
            try
            {
                ApplyStatic(target, previous.InterfaceName);
                var after = WaitForSnapshot(previous.InterfaceName);
                var verification = NetworkProbe.Verify(target, after);
                if (verification.Passed)
                {
                    return new ChangeExecutionResult { Status = "success", PreviousConfig = previous, FinalConfig = after, Verification = verification };
                }
                var restored = TryRestore(previous);
                var rollbackSnapshot = WaitForSnapshot(previous.InterfaceName);
                return new ChangeExecutionResult
                {
                    Status = restored ? (verification.SuspectedIpConflict ? "suspected_ip_conflict" : "verification_failed_rolled_back") : "rollback_failed",
                    PreviousConfig = previous,
                    FinalConfig = rollbackSnapshot,
                    Verification = verification,
                    Error = restored ? verification.Error : "网络验证失败，且恢复原配置失败",
                };
            }
            catch (Exception error)
            {
                var restored = TryRestore(previous);
                return new ChangeExecutionResult
                {
                    Status = restored ? "verification_failed_rolled_back" : "rollback_failed",
                    PreviousConfig = previous,
                    FinalConfig = WaitForSnapshot(previous.InterfaceName),
                    Error = error.Message,
                };
            }
        }

        private static void ApplyStatic(TargetConfiguration target, string interfaceName)
        {
            if (String.IsNullOrWhiteSpace(target.ip) || String.IsNullOrWhiteSpace(target.gateway) || target.dns == null || !target.dns.Any())
                throw new InvalidOperationException("服务端下发的网络配置不完整");
            RunNetsh($"interface ipv4 set address name=\"{Escape(interfaceName)}\" static {target.ip} {NetworkProbe.MaskFromPrefix(target.prefix)} {target.gateway} 1");
            RunNetsh($"interface ipv4 set dnsservers name=\"{Escape(interfaceName)}\" static address={target.dns[0]} validate=no");
            for (var index = 1; index < target.dns.Count; index++)
                RunNetsh($"interface ipv4 add dnsservers name=\"{Escape(interfaceName)}\" address={target.dns[index]} index={index + 1} validate=no");
        }

        private static bool TryRestore(NetworkSnapshot snapshot)
        {
            try
            {
                if (snapshot.IsDhcpEnabled)
                {
                    RunNetsh($"interface ipv4 set address name=\"{Escape(snapshot.InterfaceName)}\" dhcp");
                    RunNetsh($"interface ipv4 set dnsservers name=\"{Escape(snapshot.InterfaceName)}\" dhcp");
                }
                else
                {
                    var target = new TargetConfiguration
                    {
                        ip = snapshot.Ip,
                        prefix = snapshot.Prefix,
                        gateway = snapshot.Gateway,
                        dns = snapshot.Dns,
                    };
                    ApplyStatic(target, snapshot.InterfaceName);
                }
                return true;
            }
            catch { return false; }
        }

        private static NetworkSnapshot WaitForSnapshot(string interfaceName)
        {
            for (var attempt = 0; attempt < 8; attempt++)
            {
                System.Threading.Thread.Sleep(500);
                var snapshot = NetworkProbe.GetActive(interfaceName);
                if (snapshot != null) return snapshot;
            }
            return null;
        }

        private static void RunNetsh(string arguments)
        {
            var info = new ProcessStartInfo
            {
                FileName = "netsh.exe",
                Arguments = arguments,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.Default,
                StandardErrorEncoding = Encoding.Default,
            };
            using (var process = Process.Start(info))
            {
                if (process == null) throw new InvalidOperationException("无法启动 netsh");
                if (!process.WaitForExit(15000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("netsh 执行超时");
                }
                var error = process.StandardError.ReadToEnd();
                var output = process.StandardOutput.ReadToEnd();
                if (process.ExitCode != 0) throw new InvalidOperationException("netsh 执行失败: " + (String.IsNullOrWhiteSpace(error) ? output : error).Trim());
            }
        }

        private static string Escape(string value) => (value ?? "").Replace("\"", "\\\"");
    }
}
