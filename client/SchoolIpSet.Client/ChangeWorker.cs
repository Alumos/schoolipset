using System;

namespace SchoolIpSet.Client
{
    internal static class ChangeWorker
    {
        public static void Run(Action<ChangeProgress> progress = null)
        {
            var pending = LocalState.LoadPending();
            if (pending == null || pending.Target == null)
            {
                LocalState.SaveResult(new ChangeExecutionResult { Status = "rollback_failed", Error = "找不到待执行的网络修改任务" });
                return;
            }
            try { LocalState.SaveResult(NetworkConfigurator.ApplyAndVerify(pending.Target, progress)); }
            catch (Exception error)
            {
                progress?.Invoke(new ChangeProgress { Stage = "rollback_failed", Message = error.Message, Percent = 100 });
                LocalState.SaveResult(new ChangeExecutionResult { Status = "rollback_failed", Error = error.Message });
            }
        }
    }
}
