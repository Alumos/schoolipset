using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace SchoolIpSet.Client
{
    internal static class Json
    {
        public static string Serialize(object value) => new JavaScriptSerializer().Serialize(value);

        public static T Deserialize<T>(string value) => new JavaScriptSerializer().Deserialize<T>(value);

        public static Dictionary<string, object> DeserializeObject(string value) =>
            new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(value);
    }
}
