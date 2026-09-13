using System;
using System.Linq;
using System.Windows;

namespace SchoolIpSet.Client
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            if (e.Args.Any(argument => String.Equals(argument, "--apply-change", StringComparison.OrdinalIgnoreCase)))
            {
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
