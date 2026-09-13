using System;
using System.Net.NetworkInformation;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace SchoolIpSet.Client
{
    public partial class MainWindow : Window
    {
        private readonly MonitorController controller;
        private NetworkSnapshot currentNetwork;
        private TargetConfiguration targetConfiguration;
        private bool busy;

        public MainWindow()
        {
            InitializeComponent();
            Title = "IP Sentinel v" + ServerSettings.ClientVersion + " · 管理员";
            MessageText.Text = "v" + ServerSettings.ClientVersion + " · 已获得管理员权限";
            controller = new MonitorController();
            controller.MismatchDetected += OnMismatchDetected;
            controller.StatusChanged += OnStatusChanged;
            controller.ProgressChanged += OnProgressChanged;
            controller.Message += message => Dispatcher.BeginInvoke(new Action(() => MessageText.Text = message));
            NetworkChange.NetworkAddressChanged += (_, __) => Dispatcher.BeginInvoke(new Action(() => MessageText.Text = "网络发生变化，正在重新检测…"));
            Loaded += MainWindow_Loaded;
            Closed += (_, __) => controller.Dispose();
        }

        private void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            // Names are intentionally confirmed on every launch. This supports shared
            // computers and makes the latest registering computer's MAC authoritative.
            EnrollmentCard.Visibility = Visibility.Visible;
            StatusCard.Visibility = Visibility.Collapsed;
            NameBox.Text = controller.State.Name ?? "";
            NameBox.Focus();
            NameBox.SelectAll();
        }

        private async void Register_Click(object sender, RoutedEventArgs e)
        {
            if (busy) return;
            busy = true; RegisterButton.IsEnabled = false; RegisterButton.Content = "正在连接…";
            try
            {
                await controller.RegisterAsync(NameBox.Text);
                EnrollmentCard.Visibility = Visibility.Collapsed;
                StatusCard.Visibility = Visibility.Visible;
            }
            catch (Exception error) { MessageText.Text = error.Message; }
            finally { busy = false; RegisterButton.IsEnabled = true; RegisterButton.Content = "连接并开始监测"; }
        }

        private void OnStatusChanged(string status, NetworkSnapshot network)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                currentNetwork = network;
                CurrentIpText.Text = network?.Ip ?? "—";
                StatusText.Text = StatusTitle(status);
                StatusBadgeText.Text = StatusTitle(status);
                StatusBadge.Background = StatusBackground(status);
                StatusBadgeText.Foreground = StatusForeground(status);
                DetailText.Text = network == null ? "未读取到可用的活动网卡。" : $"网卡：{network.InterfaceName}  ·  网关：{network.Gateway}\nDNS：{String.Join(", ", network.Dns)}";
            }));
        }

        private void OnMismatchDetected(NetworkSnapshot network, TargetConfiguration target)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                currentNetwork = network;
                targetConfiguration = target;
                TargetIpText.Text = target?.ip == null ? "—" : target.ip + "/" + target.prefix;
                ActionCard.Visibility = target == null ? Visibility.Collapsed : Visibility.Visible;
            }));
        }

        private void OnProgressChanged(ChangeProgress progress)
        {
            if (progress == null) return;
            Dispatcher.BeginInvoke(new Action(() =>
            {
                ProgressCard.Visibility = Visibility.Visible;
                ProgressBar.Value = Math.Max(0, Math.Min(100, progress.Percent));
                ProgressPercentText.Text = ProgressBar.Value.ToString("0") + "%";
                ProgressStageText.Text = ProgressStageTitle(progress.Stage);
                ProgressMessageText.Text = progress.Message ?? "";
                if (progress.Snapshot != null)
                {
                    currentNetwork = progress.Snapshot;
                    CurrentIpText.Text = progress.Snapshot.Ip ?? "—";
                    ProgressNetworkText.Text = $"当前配置：{progress.Snapshot.Ip ?? "—"}/{progress.Snapshot.Prefix}  ·  网关 {progress.Snapshot.Gateway ?? "—"}  ·  DNS {String.Join(", ", progress.Snapshot.Dns ?? new System.Collections.Generic.List<string>())}";
                }
                if (progress.Verification != null)
                {
                    var verification = progress.Verification;
                    ProgressVerificationText.Text = $"网关 {CheckMark(verification.GatewayReachable)}  ·  DNS {CheckMark(verification.DnsResolved)}  ·  HTTPS {CheckMark(verification.HttpsReachable)}  ·  baidu.com Ping {CheckMark(verification.BaiduPingReachable)}";
                }
            }));
        }

        private async void Apply_Click(object sender, RoutedEventArgs e)
        {
            if (busy) return;
            busy = true; ApplyButton.IsEnabled = false; DeclineButton.IsEnabled = false; ApplyButton.Content = "正在修改并验证…";
            ProgressCard.Visibility = Visibility.Visible;
            ProgressBar.Value = 0;
            ProgressPercentText.Text = "0%";
            ProgressStageText.Text = "准备修改网络配置";
            ProgressMessageText.Text = "正在请求管理员权限下的网卡配置任务…";
            ProgressNetworkText.Text = "";
            ProgressVerificationText.Text = "";
            try { await controller.AcceptAndApplyAsync(); ActionCard.Visibility = Visibility.Collapsed; }
            catch (Exception error)
            {
                MessageText.Text = error.Message;
                MessageBox.Show(this, error.Message, "修改 IP 未完成 · v" + ServerSettings.ClientVersion, MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            finally { busy = false; ApplyButton.IsEnabled = true; DeclineButton.IsEnabled = true; ApplyButton.Content = "一键修改并验证"; }
        }

        private async void Decline_Click(object sender, RoutedEventArgs e)
        {
            ActionCard.Visibility = Visibility.Collapsed;
            await controller.DeclineAsync();
        }

        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); }
        private void Close_Click(object sender, RoutedEventArgs e) => Close();

        private static string StatusTitle(string status)
        {
            switch (status)
            {
                case "compliant": return "网络配置合规";
                case "non_compliant": return "发现配置差异";
                case "modifying": return "等待修改验证";
                case "change_failed_suspected_conflict": return "疑似 IP 冲突";
                case "rollback_failed": return "需要管理员介入";
                case "offline": return "暂时离线";
                default: return "正在检测";
            }
        }

        private static string ProgressStageTitle(string stage)
        {
            switch (stage)
            {
                case "read_original": return "读取原网络配置";
                case "apply_ip": return "设置 IP、子网掩码和网关";
                case "apply_dns": return "设置 DNS 服务器";
                case "wait_refresh": return "等待 Windows 刷新网卡";
                case "read_configuration": return "核对新的网卡配置";
                case "verify_gateway": return "验证网关连通性";
                case "verify_dns": return "验证 DNS 解析";
                case "verify_https": return "验证 HTTPS 网络连接";
                case "verify_baidu_ping": return "验证 baidu.com Ping";
                case "retry_verification": return "重新读取并验证网络";
                case "verification_passed": return "验证完成";
                case "rollback": return "恢复原网络配置";
                case "rollback_complete": return "已恢复原网络配置";
                case "rollback_failed": return "原网络配置恢复失败";
                case "verification_failed": return "网络验证未通过";
                default: return "正在处理网络配置";
            }
        }

        private static string CheckMark(bool passed) => passed ? "✓" : "…";

        private static Brush StatusBackground(string status) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(status == "compliant" ? "#E9FBF3" : status == "offline" ? "#EEF2F5" : "#FFF0F2"));
        private static Brush StatusForeground(string status) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(status == "compliant" ? "#16835F" : status == "offline" ? "#718096" : "#C94B5B"));
    }
}
