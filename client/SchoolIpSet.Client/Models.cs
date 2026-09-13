using System;
using System.Collections.Generic;

namespace SchoolIpSet.Client
{
    public sealed class DeviceState
    {
        public string Name { get; set; }
        public string DeviceKey { get; set; }
        public string Token { get; set; }
        public string PrivateKeyXml { get; set; }
        public string PublicKeyJwk { get; set; }
        public int DeviceId { get; set; }
        public DateTime LastRegisteredAt { get; set; }
    }

    public sealed class TargetConfiguration
    {
        public string ip { get; set; }
        public int prefix { get; set; }
        public string gateway { get; set; }
        public List<string> dns { get; set; }
        public string interfaceHint { get; set; }
        public string version { get; set; }
    }

    public sealed class NetworkSnapshot
    {
        public string InterfaceName { get; set; }
        public bool IsDhcpEnabled { get; set; }
        public string Ip { get; set; }
        public string Mask { get; set; }
        public int Prefix { get; set; }
        public string Gateway { get; set; }
        public List<string> Dns { get; set; } = new List<string>();
        public string Mac { get; set; }
    }

    public sealed class NetworkProbeResult
    {
        public NetworkSnapshot Snapshot { get; set; }
        public bool GatewayReachable { get; set; }
        public bool DnsResolved { get; set; }
        public bool HttpsReachable { get; set; }
        public bool BaiduPingReachable { get; set; }
        public bool Passed { get; set; }
        public bool SuspectedIpConflict { get; set; }
        public string Error { get; set; }
    }

    public sealed class ChangeExecutionResult
    {
        public string Status { get; set; }
        public NetworkProbeResult Verification { get; set; }
        public NetworkSnapshot PreviousConfig { get; set; }
        public NetworkSnapshot FinalConfig { get; set; }
        public string Error { get; set; }
    }

    public sealed class PendingChange
    {
        public int RequestId { get; set; }
        public string ChangeToken { get; set; }
        public TargetConfiguration Target { get; set; }
        public string DeviceKey { get; set; }
        public string DeviceToken { get; set; }
    }

    public sealed class ChangeResponse
    {
        public int requestId { get; set; }
        public string changeToken { get; set; }
        public string status { get; set; }
        public TargetConfiguration assignment { get; set; }
    }
}
