using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;

namespace SchoolIpSet.Client
{
    internal static class NetworkProbe
    {
        private static readonly string[] VirtualKeywords =
        {
            "virtual", "vmware", "virtualbox", "hyper-v", "vethernet", "tap-", "vpn", "wireguard", "hamachi", "docker", "loopback"
        };

        public static NetworkSnapshot GetActive(string interfaceHint = null)
        {
            var all = NetworkInterface.GetAllNetworkInterfaces()
                .Where(IsCandidate)
                .Select(ToSnapshot)
                .Where(snapshot => snapshot != null && !String.IsNullOrWhiteSpace(snapshot.Ip))
                .ToList();
            if (!all.Any()) return null;
            if (!String.IsNullOrWhiteSpace(interfaceHint))
            {
                var hinted = all.FirstOrDefault(item =>
                    item.InterfaceName.IndexOf(interfaceHint, StringComparison.OrdinalIgnoreCase) >= 0);
                if (hinted != null) return hinted;
            }
            return all.OrderByDescending(item => !String.IsNullOrWhiteSpace(item.Gateway)).FirstOrDefault();
        }

        public static NetworkProbeResult Verify(TargetConfiguration target, NetworkSnapshot actual)
        {
            var result = new NetworkProbeResult { Snapshot = actual };
            if (actual == null)
            {
                result.Error = "修改后未读取到活动网卡配置";
                result.SuspectedIpConflict = true;
                return result;
            }
            var targetDns = target.dns ?? new List<string>();
            var sameConfiguration = String.Equals(actual.Ip, target.ip, StringComparison.OrdinalIgnoreCase)
                && actual.Prefix == target.prefix
                && String.Equals(actual.Gateway, target.gateway, StringComparison.OrdinalIgnoreCase)
                && SameDns(actual.Dns, targetDns);
            result.GatewayReachable = !String.IsNullOrWhiteSpace(target.gateway) && PingHost(target.gateway, 1800);
            result.DnsResolved = TryResolve("baidu.com");
            result.HttpsReachable = TryConnect("baidu.com", 443, 2500);
            result.BaiduPingReachable = PingHost("baidu.com", 2500);
            result.Passed = sameConfiguration && result.GatewayReachable && result.DnsResolved && result.HttpsReachable && result.BaiduPingReachable;
            result.SuspectedIpConflict = !result.GatewayReachable || !result.BaiduPingReachable;
            if (!sameConfiguration) result.Error = "修改后读取到的网卡配置与目标配置不一致";
            else if (!result.GatewayReachable) result.Error = "目标网关不可达，疑似目标 IP 冲突或网段配置错误";
            else if (!result.DnsResolved) result.Error = "DNS 解析失败";
            else if (!result.HttpsReachable) result.Error = "HTTPS 网络连通性失败";
            else if (!result.BaiduPingReachable) result.Error = "ping baidu.com 失败，疑似目标 IP 被占用或网络策略禁止 ICMP";
            return result;
        }

        public static NetworkSnapshot GetExact(string interfaceName)
        {
            var adapter = NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(item =>
                String.Equals(item.Name, interfaceName, StringComparison.OrdinalIgnoreCase));
            return adapter == null ? null : ToSnapshot(adapter);
        }

        private static bool IsCandidate(NetworkInterface networkInterface)
        {
            if (networkInterface.OperationalStatus != OperationalStatus.Up) return false;
            if (networkInterface.NetworkInterfaceType != NetworkInterfaceType.Ethernet && networkInterface.NetworkInterfaceType != NetworkInterfaceType.Wireless80211) return false;
            var identity = (networkInterface.Name + " " + networkInterface.Description).ToLowerInvariant();
            return !VirtualKeywords.Any(identity.Contains);
        }

        private static NetworkSnapshot ToSnapshot(NetworkInterface networkInterface)
        {
            try
            {
                var properties = networkInterface.GetIPProperties();
                var unicast = properties.UnicastAddresses.FirstOrDefault(item => item.Address.AddressFamily == AddressFamily.InterNetwork);
                if (unicast == null) return null;
                var gateway = properties.GatewayAddresses
                    .Select(item => item.Address)
                    .FirstOrDefault(address => address.AddressFamily == AddressFamily.InterNetwork);
                var ipv4 = properties.GetIPv4Properties();
                var mac = BitConverter.ToString(networkInterface.GetPhysicalAddress().GetAddressBytes()).Replace("-", "");
                return new NetworkSnapshot
                {
                    InterfaceName = networkInterface.Name,
                    IsDhcpEnabled = ipv4 != null && ipv4.IsDhcpEnabled,
                    Ip = unicast.Address.ToString(),
                    Mask = unicast.IPv4Mask == null ? "" : unicast.IPv4Mask.ToString(),
                    Prefix = PrefixFromMask(unicast.IPv4Mask == null ? "" : unicast.IPv4Mask.ToString()),
                    Gateway = gateway == null ? "" : gateway.ToString(),
                    Dns = properties.DnsAddresses.Where(address => address.AddressFamily == AddressFamily.InterNetwork).Select(address => address.ToString()).ToList(),
                    Mac = mac,
                };
            }
            catch { return null; }
        }

        public static int PrefixFromMask(string mask)
        {
            if (String.IsNullOrWhiteSpace(mask)) return 0;
            var parts = mask.Split('.').Select(Int32.Parse).ToArray();
            var prefix = 0;
            var zeroSeen = false;
            foreach (var part in parts)
            {
                for (var bit = 7; bit >= 0; bit--)
                {
                    var isOne = (part & (1 << bit)) != 0;
                    if (isOne && zeroSeen) return 0;
                    if (isOne) prefix++;
                    else zeroSeen = true;
                }
            }
            return prefix;
        }

        public static string MaskFromPrefix(int prefix)
        {
            var mask = prefix == 0 ? 0u : UInt32.MaxValue << (32 - prefix);
            return String.Join(".", Enumerable.Range(0, 4).Select(index => ((mask >> (24 - index * 8)) & 255).ToString()));
        }

        private static bool PingHost(string host, int timeout)
        {
            try { using (var ping = new Ping()) return ping.Send(host, timeout)?.Status == IPStatus.Success; }
            catch { return false; }
        }

        private static bool TryResolve(string host)
        {
            try { return Dns.GetHostAddresses(host).Any(address => address.AddressFamily == AddressFamily.InterNetwork); }
            catch { return false; }
        }

        private static bool TryConnect(string host, int port, int timeout)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var asyncResult = client.BeginConnect(host, port, null, null);
                    using (asyncResult.AsyncWaitHandle)
                    {
                        if (!asyncResult.AsyncWaitHandle.WaitOne(timeout)) return false;
                        client.EndConnect(asyncResult);
                    }
                    return true;
                }
            }
            catch { return false; }
        }

        private static bool SameDns(IEnumerable<string> left, IEnumerable<string> right)
        {
            var leftValues = (left ?? Enumerable.Empty<string>())
                .Where(value => !String.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase);
            var rightValues = (right ?? Enumerable.Empty<string>())
                .Where(value => !String.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase);
            return leftValues.SequenceEqual(rightValues, StringComparer.OrdinalIgnoreCase);
        }
    }
}
