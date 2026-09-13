using System;

namespace SchoolIpSet.Client
{
    internal static class ChangeWorker
    {
        public static void Run()
        {
            var pending = LocalState.LoadPending();
            if (pending == null || pending.Target == null)
            {
                LocalState.SaveResult(new ChangeExecutionResult { Status = "rollback_failed", Error = "找不到待执行的网络修改任务" });
                return;
            }
            try { LocalState.SaveResult(NetworkConfigurator.ApplyAndVerify(pending.Target)); }
            catch (Exception error) { LocalState.SaveResult(new ChangeExecutionResult { Status = "rollback_failed", Error = error.Message }); }
        }
    }
}
