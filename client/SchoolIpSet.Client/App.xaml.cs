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
