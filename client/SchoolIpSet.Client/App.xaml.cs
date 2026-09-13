using System;
using System.Linq;
using System.Windows;
using System.Security.Principal;

namespace SchoolIpSet.Client
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            using (var identity = WindowsIdentity.GetCurrent())
            {
                if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
                {
                    MessageBox.Show("未获得管理员权限，请右键选择“以管理员身份运行”。", "IP Sentinel");
                    Shutdown();
                    return;
                }
            }
            if (e.Args.Any(argument => String.Equals(argument, "--apply-change", StringComparison.OrdinalIgnoreCase)))
            {
                var stateDirectoryArgument = e.Args.FirstOrDefault(argument => argument.StartsWith("--state-dir=", StringComparison.OrdinalIgnoreCase));
                if (stateDirectoryArgument != null)
                    LocalState.UseDirectory(stateDirectoryArgument.Substring("--state-dir=".Length));
                ShutdownMode = ShutdownMode.OnExplicitShutdown;
                ChangeWorker.Run();
                Shutdown();
                return;
            }
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
        }
    }
}
