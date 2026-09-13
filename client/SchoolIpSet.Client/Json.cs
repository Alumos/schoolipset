using System.Collections.Generic;
using Newtonsoft.Json;

namespace SchoolIpSet.Client
{
    internal static class Json
    {
        public static string Serialize(object value) => JsonConvert.SerializeObject(value);

        public static T Deserialize<T>(string value) => JsonConvert.DeserializeObject<T>(value);

        public static Dictionary<string, object> DeserializeObject(string value) =>
            JsonConvert.DeserializeObject<Dictionary<string, object>>(value);
    }
}
