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
            controller = new MonitorController();
            controller.MismatchDetected += OnMismatchDetected;
            controller.StatusChanged += OnStatusChanged;
            controller.Message += message => Dispatcher.BeginInvoke(new Action(() => MessageText.Text = message));
            NetworkChange.NetworkAddressChanged += (_, __) => Dispatcher.BeginInvoke(new Action(() => MessageText.Text = "网络发生变化，正在重新检测…"));
            Loaded += MainWindow_Loaded;
            Closed += (_, __) => controller.Dispose();
        }

        private void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            if (controller.NeedsRegistration)
            {
                EnrollmentCard.Visibility = Visibility.Visible;
                StatusCard.Visibility = Visibility.Collapsed;
                NameBox.Focus();
            }
            else
            {
                EnrollmentCard.Visibility = Visibility.Collapsed;
                controller.Start();
            }
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

        private async void Apply_Click(object sender, RoutedEventArgs e)
        {
            if (busy) return;
            busy = true; ApplyButton.IsEnabled = false; DeclineButton.IsEnabled = false; ApplyButton.Content = "正在修改并验证…";
            try { await controller.AcceptAndApplyAsync(); ActionCard.Visibility = Visibility.Collapsed; }
            catch (Exception error) { MessageText.Text = error.Message; }
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

        private static Brush StatusBackground(string status) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(status == "compliant" ? "#E9FBF3" : status == "offline" ? "#EEF2F5" : "#FFF0F2"));
        private static Brush StatusForeground(string status) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(status == "compliant" ? "#16835F" : status == "offline" ? "#718096" : "#C94B5B"));
    }
}
