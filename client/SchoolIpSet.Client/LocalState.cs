using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace SchoolIpSet.Client
{
    internal static class LocalState
    {
        private static string directoryPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "IP Sentinel");

        public static string DirectoryPath => directoryPath;

        private static string StatePath => Path.Combine(directoryPath, "device.state");
        private static string PendingPath => Path.Combine(directoryPath, "pending-change.json");
        private static string ResultPath => Path.Combine(directoryPath, "change-result.json");

        public static void UseDirectory(string path)
        {
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) return;
            try { directoryPath = Path.GetFullPath(path); } catch { }
        }

        public static DeviceState Load()
        {
            try
            {
                if (!File.Exists(StatePath)) return new DeviceState();
                var protectedBytes = Convert.FromBase64String(File.ReadAllText(StatePath));
                var bytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
                return Json.Deserialize<DeviceState>(Encoding.UTF8.GetString(bytes)) ?? new DeviceState();
            }
            catch
            {
                return new DeviceState();
            }
        }

        public static void Save(DeviceState state)
        {
            Directory.CreateDirectory(DirectoryPath);
            // Keep the device token and identity protected at rest even though
            // the transport protocol is intentionally plain JSON in simple mode.
            var bytes = Encoding.UTF8.GetBytes(Json.Serialize(state));
            var protectedBytes = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
            File.WriteAllText(StatePath, Convert.ToBase64String(protectedBytes), Encoding.UTF8);
        }

        public static void SavePending(PendingChange change)
        {
            Directory.CreateDirectory(DirectoryPath);
            File.WriteAllText(PendingPath, Json.Serialize(change), Encoding.UTF8);
        }

        public static PendingChange LoadPending()
        {
            try { return File.Exists(PendingPath) ? Json.Deserialize<PendingChange>(File.ReadAllText(PendingPath)) : null; }
            catch { return null; }
        }

        public static void SaveResult(ChangeExecutionResult result)
        {
            Directory.CreateDirectory(DirectoryPath);
            File.WriteAllText(ResultPath, Json.Serialize(result), Encoding.UTF8);
        }

        public static ChangeExecutionResult LoadResult()
        {
            try { return File.Exists(ResultPath) ? Json.Deserialize<ChangeExecutionResult>(File.ReadAllText(ResultPath)) : null; }
            catch { return null; }
        }

        public static void ClearChangeFiles()
        {
            try { if (File.Exists(PendingPath)) File.Delete(PendingPath); } catch { }
            try { if (File.Exists(ResultPath)) File.Delete(ResultPath); } catch { }
        }
    }
}
