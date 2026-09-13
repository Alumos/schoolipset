using System;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace SchoolIpSet.Client
{
    internal static class NetworkConfigurator
    {
        public static ChangeExecutionResult ApplyAndVerify(TargetConfiguration target)
        {
            ValidateTarget(target);
            var previous = NetworkProbe.GetActive(target.interfaceHint);
            if (previous == null)
            {
                return new ChangeExecutionResult { Status = "verification_failed_rolled_back", Error = "未找到可修改的活动网卡" };
            }
            try
            {
                ApplyStatic(target, previous.InterfaceName);
                var after = WaitForSnapshot(previous.InterfaceName, snapshot => MatchesConfiguration(snapshot, target));
                var verification = NetworkProbe.Verify(target, after);
                if (verification.Passed)
                {
                    return new ChangeExecutionResult { Status = "success", PreviousConfig = previous, FinalConfig = after, Verification = verification };
                }
                var restored = TryRestore(previous, out var rollbackSnapshot);
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
                var restored = TryRestore(previous, out var rollbackSnapshot);
                return new ChangeExecutionResult
                {
                    Status = restored ? "verification_failed_rolled_back" : "rollback_failed",
                    PreviousConfig = previous,
                    FinalConfig = rollbackSnapshot,
                    Error = error.Message,
                };
            }
        }

        private static void ApplyStatic(TargetConfiguration target, string interfaceName)
        {
            ValidateInterfaceName(interfaceName);
            RunNetsh($"interface ipv4 set address name=\"{Escape(interfaceName)}\" source=static address={target.ip} mask={NetworkProbe.MaskFromPrefix(target.prefix)} gateway={target.gateway} gwmetric=1 store=persistent");
            RunNetsh($"interface ipv4 set dnsservers name=\"{Escape(interfaceName)}\" source=static address={target.dns[0]} register=primary validate=no");
            for (var index = 1; index < target.dns.Count; index++)
                RunNetsh($"interface ipv4 add dnsservers name=\"{Escape(interfaceName)}\" address={target.dns[index]} index={index + 1} validate=no");
        }

        private static bool TryRestore(NetworkSnapshot snapshot, out NetworkSnapshot restoredSnapshot)
        {
            restoredSnapshot = null;
            try
            {
                ValidateInterfaceName(snapshot.InterfaceName);
                if (snapshot.IsDhcpEnabled)
                {
                    RunNetsh($"interface ipv4 set address name=\"{Escape(snapshot.InterfaceName)}\" source=dhcp store=persistent");
                    RunNetsh($"interface ipv4 set dnsservers name=\"{Escape(snapshot.InterfaceName)}\" source=dhcp");
                    restoredSnapshot = WaitForSnapshot(snapshot.InterfaceName, candidate => candidate.IsDhcpEnabled);
                    return restoredSnapshot != null && restoredSnapshot.IsDhcpEnabled;
                }

                var target = new TargetConfiguration
                {
                    ip = snapshot.Ip,
                    prefix = snapshot.Prefix,
                    gateway = snapshot.Gateway,
                    dns = snapshot.Dns,
                };
                ValidateTarget(target);
                ApplyStatic(target, snapshot.InterfaceName);
                restoredSnapshot = WaitForSnapshot(snapshot.InterfaceName, candidate => MatchesConfiguration(candidate, target));
                return restoredSnapshot != null && MatchesConfiguration(restoredSnapshot, target);
            }
            catch { return false; }
        }

        private static NetworkSnapshot WaitForSnapshot(string interfaceName, Func<NetworkSnapshot, bool> condition = null)
        {
            NetworkSnapshot latest = null;
            for (var attempt = 0; attempt < 20; attempt++)
            {
                System.Threading.Thread.Sleep(500);
                latest = NetworkProbe.GetActive(interfaceName);
                if (latest != null && (condition == null || condition(latest))) return latest;
            }
            return latest;
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
                var outputTask = process.StandardOutput.ReadToEndAsync();
                var errorTask = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(15000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("netsh 执行超时");
                }
                Task.WaitAll(outputTask, errorTask);
                var error = errorTask.Result;
                var output = outputTask.Result;
                if (process.ExitCode != 0) throw new InvalidOperationException("netsh 执行失败: " + (String.IsNullOrWhiteSpace(error) ? output : error).Trim());
            }
        }

        private static void ValidateTarget(TargetConfiguration target)
        {
            if (target == null || String.IsNullOrWhiteSpace(target.ip) || String.IsNullOrWhiteSpace(target.gateway) || target.dns == null || !target.dns.Any())
                throw new InvalidOperationException("服务端下发的网络配置不完整");
            if (!IsIPv4(target.ip) || !IsIPv4(target.gateway) || target.prefix < 0 || target.prefix > 32 || target.dns.Any(dns => !IsIPv4(dns)))
                throw new InvalidOperationException("服务端下发的网络配置不合法");
        }

        private static bool IsIPv4(string value)
        {
            return IPAddress.TryParse(value, out var address) && address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork;
        }

        private static bool MatchesConfiguration(NetworkSnapshot actual, TargetConfiguration expected)
        {
            if (actual == null || expected == null) return false;
            return String.Equals(actual.Ip, expected.ip, StringComparison.OrdinalIgnoreCase)
                && actual.Prefix == expected.prefix
                && String.Equals(actual.Gateway, expected.gateway, StringComparison.OrdinalIgnoreCase)
                && SameDns(actual.Dns, expected.dns);
        }

        private static bool SameDns(System.Collections.Generic.IEnumerable<string> left, System.Collections.Generic.IEnumerable<string> right)
        {
            var leftValues = (left ?? Enumerable.Empty<string>()).Where(value => !String.IsNullOrWhiteSpace(value)).Select(value => value.Trim()).OrderBy(value => value, StringComparer.OrdinalIgnoreCase);
            var rightValues = (right ?? Enumerable.Empty<string>()).Where(value => !String.IsNullOrWhiteSpace(value)).Select(value => value.Trim()).OrderBy(value => value, StringComparer.OrdinalIgnoreCase);
            return leftValues.SequenceEqual(rightValues, StringComparer.OrdinalIgnoreCase);
        }

        private static void ValidateInterfaceName(string interfaceName)
        {
            if (String.IsNullOrWhiteSpace(interfaceName) || interfaceName.IndexOf('"') >= 0)
                throw new InvalidOperationException("活动网卡名称不合法");
        }

        private static string Escape(string value) => (value ?? "").Replace("\"", "\\\"");
    }
}
